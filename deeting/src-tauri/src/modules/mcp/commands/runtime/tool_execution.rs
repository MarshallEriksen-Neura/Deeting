use super::super::{common_impl::to_string, support::*};
use super::tool_resolution::resolve_callable_mcp_tool_by_ref;

const TOOL_CALL_MARKER: &str = "__DEETING_TOOL_CALL_REQUEST__";
const MAX_MARKER_REEXEC: usize = 8;

fn parse_timeout_from_tool(tool: &McpTool) -> u64 {
    serde_json::from_str::<serde_json::Value>(&tool.config_json)
        .ok()
        .and_then(|v| v.get("execution")?.get("timeout_seconds")?.as_u64())
        .unwrap_or(60)
}

pub(crate) async fn execute_local_mcp_tool(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
    arguments: &Value,
) -> Result<Value, String> {
    let timeout_secs = parse_timeout_from_tool(tool);
    let mut tool_results: Vec<serde_json::Value> = Vec::new();
    for attempt in 0..=MAX_MARKER_REEXEC {
        let output =
            spawn_skill_subprocess(store, tool, arguments, &tool_results, timeout_secs).await?;
        let stdout_str = String::from_utf8_lossy(&output.stdout);
        if let Some(marker_payload) = extract_tool_call_marker(&stdout_str) {
            let requested_tool = marker_payload
                .get("tool_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if requested_tool.is_empty() {
                return Err("skill requested a tool call with empty tool_name".to_string());
            }
            if attempt >= MAX_MARKER_REEXEC {
                return Err(format!(
                    "skill exceeded {} marker re-execution rounds",
                    MAX_MARKER_REEXEC
                ));
            }
            log::info!(
                "marker re-exec #{}: skill {} requests tool {}",
                attempt + 1,
                tool.name,
                requested_tool
            );
            tool_results.push(serde_json::json!({
                "status": "error",
                "error": format!("cross-tool call to '{}' not yet supported in desktop Marker mode", requested_tool)
            }));
            continue;
        }
        if output.status.success() {
            if output.stdout.is_empty() {
                return Ok(serde_json::json!({ "ok": true }));
            }
            return match serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                Ok(parsed) => Ok(parsed),
                Err(_) => Ok(serde_json::json!({ "ok": true, "raw": stdout_str.to_string() })),
            };
        }
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "tool execution failed (exit={}): {}",
            output.status, stderr
        ));
    }
    Err("skill marker re-execution loop exhausted".to_string())
}

async fn spawn_skill_subprocess(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
    arguments: &Value,
    tool_results: &[serde_json::Value],
    timeout_secs: u64,
) -> Result<std::process::Output, String> {
    let command = tool
        .command
        .clone()
        .ok_or_else(|| format!("tool {} has no executable command", tool.name))?;
    let mut cmd = tokio::process::Command::new(command);
    if let Some(args) = &tool.args {
        cmd.args(args);
    }
    if let Some(env) = resolve_skill_env(store, tool).await? {
        cmd.envs(env);
    }
    if !tool_results.is_empty() {
        let ctx = serde_json::json!({ "tool_results": tool_results, "max_tool_calls": MAX_MARKER_REEXEC });
        cmd.env(
            "DEETING_RUNTIME_CONTEXT",
            serde_json::to_string(&ctx).unwrap_or_default(),
        );
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    let mut child = cmd.spawn().map_err(to_string)?;
    if let Some(mut stdin) = child.stdin.take() {
        let payload_bytes =
            serde_json::to_vec(&serde_json::json!({ "method": tool.name, "arguments": arguments }))
                .map_err(to_string)?;
        stdin.write_all(&payload_bytes).await.map_err(to_string)?;
    }
    match tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        child.wait_with_output(),
    )
    .await
    {
        Ok(result) => result.map_err(|e| format!("tool execution error: {}", e)),
        Err(_) => Err(format!("skill execution timed out after {}s", timeout_secs)),
    }
}

pub(crate) async fn resolve_skill_env(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
) -> Result<Option<HashMap<String, String>>, String> {
    let mut env = tool.env.clone().unwrap_or_default();
    let is_official_crawler_tool = tool
        .identifier
        .as_deref()
        .map(|id| id.starts_with("official.skills.crawler/"))
        .unwrap_or(false)
        || matches!(tool.name.as_str(), "fetch_web_content" | "crawl_website");
    if is_official_crawler_tool {
        env.remove(SCOUT_SERVICE_URL_ENV_KEY);
        let override_url = resolve_effective_desktop_scout_base_url(store)
            .await
            .map_err(to_string)?;
        if let Some(normalized) = override_url {
            env.insert(SCOUT_SERVICE_URL_ENV_KEY.to_string(), normalized);
        }
    }
    if env.is_empty() {
        Ok(None)
    } else {
        Ok(Some(env))
    }
}

fn extract_tool_call_marker(stdout: &str) -> Option<serde_json::Value> {
    for line in stdout.lines().rev() {
        let trimmed = line.trim();
        if let Some(json_str) = trimmed.strip_prefix(TOOL_CALL_MARKER) {
            let json_str = json_str.trim();
            if json_str.is_empty() {
                return Some(serde_json::json!({}));
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                return Some(parsed);
            }
            return Some(serde_json::json!({}));
        }
    }
    None
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn execute_or_queue_mcp_tool_call(
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_name: String,
    arguments: Value,
    require_approval: bool,
) -> Result<Value, String> {
    execute_or_queue_mcp_tool_call_with_context(
        &crate::modules::mcp::ToolApprovalContext::default(),
        None,
        Vec::new(),
        None,
        store,
        pending_tool_calls,
        tool_name,
        arguments,
        require_approval,
    )
    .await
}

pub(crate) async fn execute_or_queue_mcp_tool_call_with_context(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    risk_level: Option<&str>,
    risk_reasons: Vec<String>,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_name: String,
    arguments: Value,
    require_approval: bool,
) -> Result<Value, String> {
    execute_or_queue_mcp_tool_call_with_tool_ref(
        approval_context,
        risk_level,
        risk_reasons,
        runtime_state,
        store,
        pending_tool_calls,
        None,
        Some(tool_name),
        arguments,
        require_approval,
    )
    .await
}

pub(crate) async fn execute_or_queue_mcp_tool_call_with_tool_ref(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    risk_level: Option<&str>,
    risk_reasons: Vec<String>,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_id: Option<String>,
    tool_name: Option<String>,
    arguments: Value,
    require_approval: bool,
) -> Result<Value, String> {
    let tool = resolve_callable_mcp_tool_by_ref(store, tool_id.as_deref(), tool_name.as_deref())
        .await
        .map_err(|err| err.to_string())?;
    if require_approval {
        let approval_token = Uuid::new_v4().to_string();
        let pending = if let Some(runtime) = runtime_state {
            runtime.build_pending_tool_call(
                Some(tool.id.clone()),
                tool.name.clone(),
                arguments.clone(),
                runtime.tool_fingerprint(&tool),
                approval_context.clone(),
            )
        } else {
            let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
            crate::modules::mcp::PendingToolCall {
                tool_id: Some(tool.id.clone()),
                tool_name: tool.name.clone(),
                arguments: arguments.clone(),
                call_id: approval_context.call_id.clone(),
                execution_token: approval_context.execution_token.clone(),
                tool_fingerprint: tool.config_hash.clone(),
                created_at_unix_ms: now as i128,
                expires_at_unix_ms: now as i128 + 5 * 60 * 1000,
            }
        };
        let expires_in_ms = runtime_state
            .map(|runtime| runtime.pending_tool_call_ttl_ms())
            .unwrap_or(5 * 60 * 1000);
        pending_tool_calls
            .write()
            .await
            .insert(approval_token.clone(), pending);
        return Ok(serde_json::json!({
            "status": "REQUIRES_APPROVAL", "approval_token": approval_token,
            "tool_id": tool.id, "tool_name": tool.name,
            "arguments": arguments, "description": tool.description, "risk_level": risk_level.unwrap_or("HIGH"),
            "risk_reasons": risk_reasons, "expires_in_ms": expires_in_ms,
        }));
    }
    execute_local_mcp_tool(store, &tool, &arguments).await
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn approve_mcp_tool_inner(
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> Result<Value, String> {
    approve_mcp_tool_inner_with_context(
        &crate::modules::mcp::ToolApprovalContext::default(),
        None,
        store,
        pending_tool_calls,
        approval_token,
    )
    .await
}

pub(crate) async fn approve_mcp_tool_inner_with_context(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> Result<Value, String> {
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let pending = pending_tool_calls.read().await.get(approval_token).cloned();
    let Some(pending) = pending else {
        return Err("pending tool call not found".to_string());
    };
    if pending.expires_at_unix_ms <= now as i128 {
        pending_tool_calls.write().await.remove(approval_token);
        return Err("approval token expired; please retry the action".to_string());
    }
    if let Some(expected_call_id) = pending.call_id.as_deref() {
        if approval_context.call_id.as_deref() != Some(expected_call_id) {
            return Err("approval context mismatch (call_id)".to_string());
        }
    }
    if let Some(expected_execution_token) = pending.execution_token.as_deref() {
        if approval_context.execution_token.as_deref() != Some(expected_execution_token) {
            return Err("approval context mismatch (execution_token)".to_string());
        }
    }
    let tool = resolve_callable_mcp_tool_by_ref(
        store,
        pending.tool_id.as_deref(),
        Some(pending.tool_name.as_str()),
    )
    .await
    .map_err(|err| err.to_string())?;
    if let Some(runtime) = runtime_state {
        let current_fingerprint = runtime.tool_fingerprint(&tool);
        if current_fingerprint != pending.tool_fingerprint {
            pending_tool_calls.write().await.remove(approval_token);
            return Err(
                "tool configuration changed after approval prompt; request was cancelled"
                    .to_string(),
            );
        }
    }
    if pending_tool_calls
        .write()
        .await
        .remove(approval_token)
        .is_none()
    {
        return Err("pending tool call already consumed".to_string());
    }
    execute_local_mcp_tool(store, &tool, &pending.arguments).await
}

pub(crate) async fn reject_mcp_tool_inner(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> bool {
    pending_tool_calls
        .write()
        .await
        .remove(approval_token)
        .is_some()
}
