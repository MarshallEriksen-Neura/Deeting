use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::{Mutex, RwLock};

use crate::mcp::error::McpError;
use crate::mcp::store::McpStore;
use crate::mcp::types::{McpLogEntry, McpLogStream, McpTool, McpToolStatus};

const DEFAULT_LOG_BUFFER_SIZE: usize = 1000;

#[derive(Clone)]
pub struct ProcessManager {
    store: Arc<McpStore>,
    app_handle: AppHandle,
    processes: Arc<RwLock<HashMap<String, ProcessHandle>>>,
    logs: Arc<RwLock<HashMap<String, LogBuffer>>>,
    log_buffer_size: usize,
}

impl ProcessManager {
    pub fn new(store: Arc<McpStore>, app_handle: AppHandle) -> Self {
        Self {
            store,
            app_handle,
            processes: Arc::new(RwLock::new(HashMap::new())),
            logs: Arc::new(RwLock::new(HashMap::new())),
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

        self.ensure_log_buffer(&tool.id).await;

        if let Some(stdout) = stdout {
            let tool_id = tool.id.clone();
            let manager = self.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    manager
                        .emit_log(&tool_id, McpLogStream::Stdout, line)
                        .await;
                }
            });
        }

        if let Some(stderr) = stderr {
            let tool_id = tool.id.clone();
            let manager = self.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    manager
                        .emit_log(&tool_id, McpLogStream::Stderr, line)
                        .await;
                }
            });
        }

        self.store
            .set_tool_status(&tool.id, McpToolStatus::Healthy, None, None)
            .await?;
        self.emit_log(&tool.id, McpLogStream::Event, "process started".to_string())
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
        self.emit_log(tool_id, McpLogStream::Event, "process stopped".to_string())
            .await;

        Ok(())
    }

    pub async fn logs(&self, tool_id: &str) -> Vec<McpLogEntry> {
        let logs = self.logs.read().await;
        logs.get(tool_id)
            .map(|buffer| buffer.entries.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub async fn clear_logs(&self, tool_id: &str) {
        let mut logs = self.logs.write().await;
        logs.insert(tool_id.to_string(), LogBuffer::new(self.log_buffer_size));
    }

    async fn ensure_log_buffer(&self, tool_id: &str) {
        let mut logs = self.logs.write().await;
        logs.entry(tool_id.to_string())
            .or_insert_with(|| LogBuffer::new(self.log_buffer_size));
    }

    async fn emit_log(&self, tool_id: &str, stream: McpLogStream, message: String) {
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

        let event_name = format!("mcp-log://{}", tool_id);
        let _ = self.app_handle.emit_all(&event_name, entry);
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
                            .emit_log(&tool_id, McpLogStream::Event, message.clone())
                            .await;
                        let status = if exit_code == 0 {
                            McpToolStatus::Stopped
                        } else {
                            McpToolStatus::Crashed
                        };
                        let _ = manager
                            .store
                            .set_tool_status(&tool_id, status, None, Some(message))
                            .await;
                        manager.processes.write().await.remove(&tool_id);
                        break;
                    }
                    Ok(None) => continue,
                    Err(_) => break,
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
