use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::{broadcast, Mutex, RwLock};
use tracing::warn;

use super::types::{McpLogEntry, McpLogStream, McpTool, McpToolStatus};
use super::{McpError, McpStore};

const DEFAULT_LOG_BUFFER_SIZE: usize = 1000;
const DEFAULT_BROADCAST_CAPACITY: usize = 512;

#[derive(Clone)]
pub struct ProcessManager {
    store: Arc<McpStore>,
    processes: Arc<RwLock<HashMap<String, ProcessHandle>>>,
    logs: Arc<RwLock<HashMap<String, LogBuffer>>>,
    broadcasters: Arc<RwLock<HashMap<String, broadcast::Sender<McpLogEntry>>>>,
    log_buffer_size: usize,
}

impl ProcessManager {
    pub fn new(store: Arc<McpStore>) -> Self {
        Self {
            store,
            processes: Arc::new(RwLock::new(HashMap::new())),
            logs: Arc::new(RwLock::new(HashMap::new())),
            broadcasters: Arc::new(RwLock::new(HashMap::new())),
            log_buffer_size: DEFAULT_LOG_BUFFER_SIZE,
        }
    }

    pub async fn start_tool(&self, tool: McpTool) -> Result<(), McpError> {
        let mut processes = self.processes.write().await;
        if processes.contains_key(&tool.id) {
            return Err(McpError::Process(format!(
                "tool {} already running",
                tool.id
            )));
        }

        let command = tool
            .command
            .clone()
            .ok_or_else(|| McpError::Validation("missing command".to_string()))?;

        let args = tool.args.clone().unwrap_or_default();
        let mut cmd = tokio::process::Command::new(command);
        cmd.args(args);
        if let Some(env) = &tool.env {
            cmd.envs(env);
        }
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        self.store
            .set_tool_status(&tool.id, McpToolStatus::Starting, None, None)
            .await?;

        let mut child = cmd
            .spawn()
            .map_err(|err| McpError::Process(err.to_string()))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let child = Arc::new(Mutex::new(child));
        processes.insert(
            tool.id.clone(),
            ProcessHandle {
                child: child.clone(),
            },
        );
        drop(processes);

        let log_sender = self.ensure_broadcaster(&tool.id).await;
        self.ensure_log_buffer(&tool.id).await;

        if let Some(stdout) = stdout {
            let tool_id = tool.id.clone();
            let sender = log_sender.clone();
            let manager = self.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    manager
                        .emit_log(&tool_id, McpLogStream::Stdout, line, Some(&sender))
                        .await;
                }
            });
        }

        if let Some(stderr) = stderr {
            let tool_id = tool.id.clone();
            let sender = log_sender.clone();
            let manager = self.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    manager
                        .emit_log(&tool_id, McpLogStream::Stderr, line, Some(&sender))
                        .await;
                }
            });
        }

        self.store
            .set_tool_status(&tool.id, McpToolStatus::Healthy, None, None)
            .await?;
        self.emit_log(&tool.id, McpLogStream::Event, "process started".to_string(), None)
            .await;

        self.spawn_monitor(tool.id.clone(), child).await;

        Ok(())
    }

    pub async fn stop_tool(&self, tool_id: &str) -> Result<(), McpError> {
        let handle = {
            let processes = self.processes.read().await;
            processes.get(tool_id).cloned()
        };

        let Some(handle) = handle else {
            self.store
                .set_tool_status(tool_id, McpToolStatus::Stopped, None, None)
                .await?;
            return Ok(());
        };

        let mut child = handle.child.lock().await;
        if let Err(err) = child.kill().await {
            return Err(McpError::Process(format!("failed to stop tool: {err}")));
        }

        self.store
            .set_tool_status(tool_id, McpToolStatus::Stopped, None, None)
            .await?;
        self.emit_log(tool_id, McpLogStream::Event, "process stopped".to_string(), None)
            .await;

        Ok(())
    }

    pub async fn logs(&self, tool_id: &str) -> Vec<McpLogEntry> {
        let logs = self.logs.read().await;
        logs.get(tool_id)
            .map(|buffer| buffer.entries.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub async fn subscribe_logs(
        &self,
        tool_id: &str,
    ) -> broadcast::Receiver<McpLogEntry> {
        self.ensure_broadcaster(tool_id).await.subscribe()
    }

    async fn ensure_broadcaster(&self, tool_id: &str) -> broadcast::Sender<McpLogEntry> {
        let mut broadcasters = self.broadcasters.write().await;
        broadcasters
            .entry(tool_id.to_string())
            .or_insert_with(|| {
                let (sender, _) = broadcast::channel(DEFAULT_BROADCAST_CAPACITY);
                sender
            })
            .clone()
    }

    async fn ensure_log_buffer(&self, tool_id: &str) {
        let mut logs = self.logs.write().await;
        logs.entry(tool_id.to_string())
            .or_insert_with(|| LogBuffer::new(self.log_buffer_size));
    }

    async fn emit_log(
        &self,
        tool_id: &str,
        stream: McpLogStream,
        message: String,
        sender: Option<&broadcast::Sender<McpLogEntry>>,
    ) {
        let entry = McpLogEntry {
            timestamp: now_rfc3339(),
            stream,
            message,
        };

        {
            let mut logs = self.logs.write().await;
            logs.entry(tool_id.to_string())
                .or_insert_with(|| LogBuffer::new(self.log_buffer_size))
                .push(entry.clone());
        }

        if let Some(sender) = sender {
            let _ = sender.send(entry);
            return;
        }

        let broadcasters = self.broadcasters.read().await;
        if let Some(sender) = broadcasters.get(tool_id) {
            let _ = sender.send(entry);
        }
    }

    async fn spawn_monitor(&self, tool_id: String, child: Arc<Mutex<Child>>) {
        let manager = self.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(500)).await;
                let mut child_guard = child.lock().await;
                match child_guard.try_wait() {
                    Ok(Some(status)) => {
                        let exit_code = status.code().unwrap_or(-1);
                        let message = format!("process exited with code {exit_code}");
                        manager
                            .emit_log(&tool_id, McpLogStream::Event, message.clone(), None)
                            .await;
                        let status = if exit_code == 0 {
                            McpToolStatus::Stopped
                        } else {
                            McpToolStatus::Crashed
                        };
                        if let Err(err) = manager
                            .store
                            .set_tool_status(&tool_id, status, None, Some(message))
                            .await
                        {
                            warn!("failed to update status for {}: {}", tool_id, err);
                        }
                        manager.processes.write().await.remove(&tool_id);
                        break;
                    }
                    Ok(None) => continue,
                    Err(err) => {
                        warn!("failed to poll tool {}: {}", tool_id, err);
                        break;
                    }
                }
            }
        });
    }
}

#[derive(Clone)]
struct ProcessHandle {
    child: Arc<Mutex<Child>>,
}

struct LogBuffer {
    entries: VecDeque<McpLogEntry>,
    capacity: usize,
}

impl LogBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            entries: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    fn push(&mut self, entry: McpLogEntry) {
        if self.entries.len() >= self.capacity {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_buffer_eviction_keeps_latest() {
        let mut buffer = LogBuffer::new(3);
        buffer.push(McpLogEntry {
            timestamp: "t1".to_string(),
            stream: McpLogStream::Event,
            message: "one".to_string(),
        });
        buffer.push(McpLogEntry {
            timestamp: "t2".to_string(),
            stream: McpLogStream::Event,
            message: "two".to_string(),
        });
        buffer.push(McpLogEntry {
            timestamp: "t3".to_string(),
            stream: McpLogStream::Event,
            message: "three".to_string(),
        });
        buffer.push(McpLogEntry {
            timestamp: "t4".to_string(),
            stream: McpLogStream::Event,
            message: "four".to_string(),
        });

        let messages: Vec<_> = buffer
            .entries
            .iter()
            .map(|entry| entry.message.as_str())
            .collect();
        assert_eq!(messages, vec!["two", "three", "four"]);
    }
}
