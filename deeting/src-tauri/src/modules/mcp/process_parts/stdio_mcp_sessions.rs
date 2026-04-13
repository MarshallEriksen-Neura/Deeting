use mcp_transport::remote::{unbounded_stderr_channel, LocalStdioMcpClient};
use serde_json::Value;
use uuid::Uuid;

#[derive(Default)]
struct LocalStdioSessionState {
    sessions: HashMap<String, Arc<Mutex<LocalStdioSessionHandle>>>,
    tool_bindings: HashMap<String, String>,
}

struct LocalStdioSessionHandle {
    client: LocalStdioMcpClient,
    instance_id: String,
}

#[derive(Clone)]
pub struct LocalStdioMcpSessionManager {
    state: Arc<Mutex<LocalStdioSessionState>>,
    logs: Arc<RwLock<HashMap<String, LogBuffer>>>,
    log_buffer_size: usize,
}

impl LocalStdioMcpSessionManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(LocalStdioSessionState::default())),
            logs: Arc::new(RwLock::new(HashMap::new())),
            log_buffer_size: DEFAULT_LOG_BUFFER_SIZE,
        }
    }

    pub async fn ensure_tool_session(
        &self,
        tool: &McpTool,
        env: Option<&HashMap<String, String>>,
    ) -> Result<(), String> {
        let (_, _, created) = self.ensure_session_handle(tool, env).await?;
        let message = if created {
            format!(
                "stdio MCP session started for {}",
                stdio_session_label(tool)
            )
        } else {
            format!("stdio MCP session reused for {}", stdio_session_label(tool))
        };
        self.emit_log(&tool.id, McpLogStream::Event, message).await;
        self.ensure_log_buffer(&tool.id).await;
        Ok(())
    }

    pub async fn call_tool(
        &self,
        tool: &McpTool,
        env: Option<&HashMap<String, String>>,
        arguments: &Value,
    ) -> Result<Value, String> {
        let tool_name = tool
            .stdio_mcp_tool_name()
            .ok_or_else(|| format!("stdio MCP tool {} is missing tool metadata", tool.name))?;
        let (session_key, handle, _) = self.ensure_session_handle(tool, env).await?;

        match Self::call_with_handle(&handle, &tool_name, arguments).await {
            Ok(result) => Ok(result),
            Err(first_error) => {
                self.emit_log(
                    &tool.id,
                    McpLogStream::Event,
                    format!(
                        "stdio MCP session call failed for {}; reconnecting: {}",
                        stdio_session_label(tool),
                        first_error
                    ),
                )
                .await;
                self.invalidate_session(&session_key, Some(first_error.clone()))
                    .await;

                let (_, retry_handle, _) = self.ensure_session_handle(tool, env).await?;
                match Self::call_with_handle(&retry_handle, &tool_name, arguments).await {
                    Ok(result) => Ok(result),
                    Err(retry_error) => {
                        self.invalidate_session(&session_key, Some(retry_error.clone()))
                            .await;
                        Err(retry_error)
                    }
                }
            }
        }
    }

    pub async fn close_tool_session(
        &self,
        tool: &McpTool,
        env: Option<&HashMap<String, String>>,
    ) -> Result<bool, String> {
        let session_key = build_stdio_session_key(tool, env)?;
        let (handle, affected_tool_ids) = {
            let mut state = self.state.lock().await;
            let handle = state.sessions.remove(&session_key);
            let affected_tool_ids = state
                .tool_bindings
                .iter()
                .filter(|(_, key)| *key == &session_key)
                .map(|(tool_id, _)| tool_id.clone())
                .collect::<Vec<_>>();
            state
                .tool_bindings
                .retain(|_, key| key.as_str() != session_key.as_str());
            (handle, affected_tool_ids)
        };

        let Some(handle) = handle else {
            return Ok(false);
        };

        Self::close_handle(handle).await;
        if affected_tool_ids.is_empty() {
            self.emit_log(
                &tool.id,
                McpLogStream::Event,
                format!(
                    "stdio MCP session stopped for {}",
                    stdio_session_label(tool)
                ),
            )
            .await;
        } else {
            for tool_id in affected_tool_ids {
                self.emit_log(
                    &tool_id,
                    McpLogStream::Event,
                    format!(
                        "stdio MCP session stopped for {}",
                        stdio_session_label(tool)
                    ),
                )
                .await;
            }
        }

        Ok(true)
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

    async fn ensure_session_handle(
        &self,
        tool: &McpTool,
        env: Option<&HashMap<String, String>>,
    ) -> Result<(String, Arc<Mutex<LocalStdioSessionHandle>>, bool), String> {
        let session_key = build_stdio_session_key(tool, env)?;
        let command = tool
            .command
            .as_deref()
            .ok_or_else(|| format!("stdio MCP tool {} has no executable command", tool.name))?;
        let args = tool.args.clone().unwrap_or_default();

        let (handle, created, stale_handle) = {
            let mut state = self.state.lock().await;
            let (handle, created) =
                if let Some(existing) = state.sessions.get(&session_key).cloned() {
                    (existing, false)
                } else {
                    let (stderr_sender, stderr_receiver) = unbounded_stderr_channel();
                    let instance_id = Uuid::new_v4().to_string();
                    let client = LocalStdioMcpClient::connect_with_stderr(
                        command,
                        &args,
                        env,
                        Some(stderr_sender),
                    )
                    .await?;
                    let handle = Arc::new(Mutex::new(LocalStdioSessionHandle {
                        client,
                        instance_id: instance_id.clone(),
                    }));
                    state.sessions.insert(session_key.clone(), handle.clone());
                    self.spawn_stderr_forwarder(session_key.clone(), instance_id, stderr_receiver);
                    (handle, true)
                };
            let stale_handle = rebind_tool_session_locked(&mut state, &tool.id, &session_key);
            (handle, created, stale_handle)
        };

        if let Some(stale_handle) = stale_handle {
            Self::close_handle(stale_handle).await;
        }

        Ok((session_key, handle, created))
    }

    async fn invalidate_session(&self, session_key: &str, reason: Option<String>) {
        let (handle, affected_tool_ids) = {
            let mut state = self.state.lock().await;
            let handle = state.sessions.remove(session_key);
            let affected_tool_ids = state
                .tool_bindings
                .iter()
                .filter(|(_, key)| key.as_str() == session_key)
                .map(|(tool_id, _)| tool_id.clone())
                .collect::<Vec<_>>();
            state
                .tool_bindings
                .retain(|_, key| key.as_str() != session_key);
            (handle, affected_tool_ids)
        };

        if let Some(handle) = handle {
            Self::close_handle(handle).await;
        }

        if let Some(reason) = reason {
            for tool_id in affected_tool_ids {
                self.emit_log(
                    &tool_id,
                    McpLogStream::Event,
                    format!("stdio MCP session invalidated: {reason}"),
                )
                .await;
            }
        }
    }
    async fn ensure_log_buffer(&self, tool_id: &str) {
        let mut logs = self.logs.write().await;
        logs.entry(tool_id.to_string())
            .or_insert_with(|| LogBuffer::new(self.log_buffer_size));
    }

    fn spawn_stderr_forwarder(
        &self,
        session_key: String,
        instance_id: String,
        mut stderr_receiver: tokio::sync::mpsc::UnboundedReceiver<String>,
    ) {
        let manager = self.clone();
        tokio::spawn(async move {
            while let Some(line) = stderr_receiver.recv().await {
                manager
                    .emit_session_stderr(&session_key, &instance_id, line)
                    .await;
            }
        });
    }

    async fn emit_session_stderr(&self, session_key: &str, instance_id: &str, message: String) {
        let current_handle = {
            let state = self.state.lock().await;
            state.sessions.get(session_key).cloned()
        };

        let Some(current_handle) = current_handle else {
            return;
        };

        let current_instance_id = {
            let handle = current_handle.lock().await;
            handle.instance_id.clone()
        };
        if current_instance_id != instance_id {
            return;
        }

        let tool_ids = {
            let state = self.state.lock().await;
            state
                .tool_bindings
                .iter()
                .filter(|(_, bound_key)| bound_key.as_str() == session_key)
                .map(|(tool_id, _)| tool_id.clone())
                .collect::<Vec<_>>()
        };

        for tool_id in tool_ids {
            self.emit_log(&tool_id, McpLogStream::Stderr, message.clone())
                .await;
        }
    }

    async fn emit_log(&self, tool_id: &str, stream: McpLogStream, message: String) {
        let entry = McpLogEntry {
            timestamp: now_rfc3339(),
            stream,
            message,
        };
        let mut logs = self.logs.write().await;
        logs.entry(tool_id.to_string())
            .or_insert_with(|| LogBuffer::new(self.log_buffer_size))
            .push(entry.clone());

        if let Some(app_handle) = crate::state::global_app_handle() {
            let event_name = format!("mcp-log://{}", tool_id);
            let _ = app_handle.emit(&event_name, entry);
        }
    }

    async fn call_with_handle(
        handle: &Arc<Mutex<LocalStdioSessionHandle>>,
        tool_name: &str,
        arguments: &Value,
    ) -> Result<Value, String> {
        let mut handle = handle.lock().await;
        handle.client.call_tool(tool_name, arguments).await
    }

    async fn close_handle(handle: Arc<Mutex<LocalStdioSessionHandle>>) {
        let mut handle = handle.lock().await;
        let _ = handle.client.close().await;
    }

    #[cfg(test)]
    async fn session_count(&self) -> usize {
        self.state.lock().await.sessions.len()
    }
}

fn rebind_tool_session_locked(
    state: &mut LocalStdioSessionState,
    tool_id: &str,
    session_key: &str,
) -> Option<Arc<Mutex<LocalStdioSessionHandle>>> {
    match state
        .tool_bindings
        .insert(tool_id.to_string(), session_key.to_string())
    {
        Some(previous_key) if previous_key != session_key => {
            let still_bound = state
                .tool_bindings
                .values()
                .any(|bound_key| bound_key == &previous_key);
            if still_bound {
                None
            } else {
                state.sessions.remove(&previous_key)
            }
        }
        _ => None,
    }
}

fn build_stdio_session_key(
    tool: &McpTool,
    env: Option<&HashMap<String, String>>,
) -> Result<String, String> {
    let command = tool
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("stdio MCP tool {} has no executable command", tool.name))?;
    let args = tool.args.clone().unwrap_or_default().join("\u{1f}");
    let mut env_pairs = env
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .collect::<Vec<_>>();
    env_pairs.sort_by(|a, b| a.0.cmp(&b.0));
    let env_text = env_pairs
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("\u{1e}");
    let source_id = tool.source_id.clone().unwrap_or_default();
    let server_name = tool
        .remote_server_name()
        .unwrap_or_else(|| tool.name.clone());
    Ok(format!(
        "{}|{}|{}|{}|{}",
        source_id, server_name, command, args, env_text
    ))
}

fn stdio_session_label(tool: &McpTool) -> String {
    tool.remote_server_name()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            tool.command
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| tool.name.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mcp_core::types::{McpConflictStatus, McpSourceType, McpToolStatus};
    use serde_json::json;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use uuid::Uuid;

    fn write_mock_stdio_mcp_server_script(counter_path: &Path) -> PathBuf {
        let mut script_path = std::env::temp_dir();
        script_path.push(format!("deeting-stdio-session-reuse-{}.py", Uuid::new_v4()));

        let counter_literal = counter_path.to_string_lossy().replace('\\', "\\\\");
        let script = format!(
            r#"import json
import pathlib
import sys

counter_path = pathlib.Path(r"{counter_literal}")
counter_path.parent.mkdir(parents=True, exist_ok=True)
current = int(counter_path.read_text(encoding="utf-8").strip() or "0") if counter_path.exists() else 0
counter_path.write_text(str(current + 1), encoding="utf-8")
print("mock stdio session stderr", file=sys.stderr, flush=True)

TOOL = {{
    "name": "echo",
    "description": "Echo test payload",
    "inputSchema": {{
        "type": "object",
        "properties": {{
            "message": {{"type": "string"}}
        }}
    }}
}}

for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue
    msg = json.loads(line)
    method = msg.get("method")

    if method == "notifications/initialized":
        continue
    if method == "initialize":
        result = {{
            "protocolVersion": "2025-06-18",
            "capabilities": {{"tools": {{}}}},
            "serverInfo": {{"name": "mock-stdio-mcp", "version": "0.1.0"}}
        }}
    elif method == "tools/list":
        result = {{"tools": [TOOL]}}
    elif method == "tools/call":
        params = msg.get("params") or {{}}
        args = params.get("arguments") or {{}}
        result = {{
            "content": [{{
                "type": "text",
                "text": args.get("message", "")
            }}],
            "structuredContent": {{"message": args.get("message", "")}}
        }}
    else:
        result = {{}}

    if "id" in msg:
        print(json.dumps({{"jsonrpc": "2.0", "id": msg["id"], "result": result}}), flush=True)
"#
        );
        std::fs::write(&script_path, script).expect("write mock stdio mcp server script");
        script_path
    }

    fn resolve_python_command(script_path: &Path) -> Option<(String, Vec<String>)> {
        let candidates: &[(&str, &[&str])] = if cfg!(target_os = "windows") {
            &[("py", &["-3"]), ("python", &[]), ("python3", &[])]
        } else {
            &[("python3", &[]), ("python", &[])]
        };

        for (command, prefix_args) in candidates {
            let mut probe = Command::new(command);
            probe.args(*prefix_args).arg("--version");
            if probe
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
            {
                let mut args = prefix_args
                    .iter()
                    .map(|value| value.to_string())
                    .collect::<Vec<_>>();
                args.push(script_path.to_string_lossy().to_string());
                return Some(((*command).to_string(), args));
            }
        }

        None
    }

    fn build_test_stdio_tool(script_path: &Path) -> Option<McpTool> {
        let (command, args) = resolve_python_command(script_path)?;
        let config_json = json!({
            "type": "stdio",
            "transport": "stdio",
            "server_type": "stdio",
            "server_name": "mock_stdio",
            "source_entry_name": "mock_stdio",
            "runtime_protocol": "mcp",
            "mcp_tool_name": "echo",
            "command": command,
            "args": args,
        })
        .to_string();

        Some(McpTool {
            id: format!("tool-{}", Uuid::new_v4()),
            identifier: Some("source-1/stdio/mock_stdio/echo".to_string()),
            name: "echo".to_string(),
            service_key: None,
            service_display_name: None,
            service_description: None,
            source_type: McpSourceType::Local,
            source_id: Some("source-1".to_string()),
            status: McpToolStatus::Healthy,
            ping_ms: None,
            capabilities: vec!["mcp".to_string()],
            description: "stdio mcp test tool".to_string(),
            error: None,
            command: Some(command),
            args: Some(args),
            env: None,
            config_json,
            pending_config_json: None,
            config_hash: "test-config-hash".to_string(),
            pending_config_hash: None,
            conflict_status: McpConflictStatus::None,
            is_read_only: false,
            is_new: false,
            created_at: "".to_string(),
            updated_at: "".to_string(),
        })
    }

    #[tokio::test]
    async fn reuses_stdio_mcp_session_for_repeated_calls() {
        let mut counter_path = std::env::temp_dir();
        counter_path.push(format!(
            "deeting-stdio-session-counter-{}.txt",
            Uuid::new_v4()
        ));
        let script_path = write_mock_stdio_mcp_server_script(&counter_path);
        let Some(tool) = build_test_stdio_tool(&script_path) else {
            return;
        };
        let manager = LocalStdioMcpSessionManager::new();

        let first = manager
            .call_tool(&tool, None, &json!({"message": "first"}))
            .await
            .expect("first stdio MCP session call");
        let second = manager
            .call_tool(&tool, None, &json!({"message": "second"}))
            .await
            .expect("second stdio MCP session call");

        assert_eq!(
            first["structuredContent"]["message"].as_str(),
            Some("first")
        );
        assert_eq!(
            second["structuredContent"]["message"].as_str(),
            Some("second")
        );
        assert_eq!(manager.session_count().await, 1);
        assert_eq!(
            std::fs::read_to_string(&counter_path)
                .expect("read startup counter")
                .trim(),
            "1"
        );

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let logs = manager.logs(&tool.id).await;
        assert!(logs.iter().any(|entry| {
            entry.stream == McpLogStream::Stderr
                && entry.message.contains("mock stdio session stderr")
        }));

        let stopped = manager
            .close_tool_session(&tool, None)
            .await
            .expect("close stdio MCP session");
        assert!(stopped);
    }
}
