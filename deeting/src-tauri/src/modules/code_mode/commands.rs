use std::collections::BTreeSet;
use std::time::Instant;

use serde_json::{json, Value};
use tauri::State;

use crate::modules::code_mode::bridge::{
    BridgeDeps, RuntimeBridgeClaims, RuntimeBridgeStreamTarget,
};
use crate::modules::code_mode::contract::{
    BRIDGE_EXECUTION_TOKEN_HEADER, EXECUTION_FORMAT_VERSION, RUNTIME_PROTOCOL_VERSION,
    RUNTIME_RENDER_BLOCK_MARKER, RUNTIME_TOOL_CALL_MARKER,
};
use crate::modules::code_mode::error::CodeModeError;
use crate::modules::code_mode::protocol::{
    extract_runtime_render_blocks, extract_runtime_tool_calls, strip_runtime_signal_lines,
};
use crate::modules::code_mode::types::{
    CodeModeExecutionDetail, CodeModeExecutionPage, ExecuteLocalCodeModeRequest,
    ExecuteLocalCodeModeResponse, ListCodeModeExecutionsQuery, LocalCodeModeBridgeStatus,
    ReplayLocalCodeModeRequest, ReplayLocalCodeModeResponse, RuntimeToolCallsEnvelope,
};
use crate::modules::sandbox::manager::SandboxLaunchPolicy;
use crate::modules::sandbox::types::{
    SandboxReadinessReport, SandboxReadinessStatus, SandboxRuntimeMode,
};
use crate::state::AppState;

const LOCAL_DEFAULT_USER_ID: &str = "00000000-0000-0000-0000-000000000000";

#[tauri::command]
pub async fn get_local_code_mode_bridge_status(
    state: State<'_, AppState>,
) -> Result<LocalCodeModeBridgeStatus, String> {
    let base_url = state.code_mode.bridge.get_base_url().await;
    Ok(LocalCodeModeBridgeStatus {
        running: base_url.is_some(),
        base_url,
    })
}

#[tauri::command]
pub async fn execute_local_code_mode(
    state: State<'_, AppState>,
    payload: ExecuteLocalCodeModeRequest,
) -> Result<ExecuteLocalCodeModeResponse, String> {
    execute_local_code_mode_inner(&state, payload, None)
        .await
        .map_err(|err| err.to_string())
}

pub(crate) async fn execute_local_code_mode_inner(
    state: &AppState,
    payload: ExecuteLocalCodeModeRequest,
    stream_target: Option<RuntimeBridgeStreamTarget>,
) -> Result<ExecuteLocalCodeModeResponse, CodeModeError> {
    run_execute_local_code_mode(state, payload, stream_target).await
}

#[tauri::command]
pub async fn list_local_code_mode_executions(
    state: State<'_, AppState>,
    query: ListCodeModeExecutionsQuery,
) -> Result<CodeModeExecutionPage, String> {
    let _cursor = query.cursor;
    let page = state
        .code_mode
        .execution_store
        .list(
            query.size.unwrap_or(20).max(1) as usize,
            query.status.as_deref(),
            query.session_id.as_deref(),
        )
        .await
        .map_err(|err| err.to_string())?;
    Ok(page)
}

#[tauri::command]
pub async fn get_local_code_mode_execution(
    state: State<'_, AppState>,
    execution_identifier: String,
) -> Result<CodeModeExecutionDetail, String> {
    state
        .code_mode
        .execution_store
        .get_by_identifier(&execution_identifier)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "execution not found".to_string())
}

#[tauri::command]
pub async fn replay_local_code_mode_execution(
    state: State<'_, AppState>,
    execution_identifier: String,
    payload: ReplayLocalCodeModeRequest,
) -> Result<ReplayLocalCodeModeResponse, String> {
    let source = state
        .code_mode
        .execution_store
        .get_by_identifier(&execution_identifier)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "execution not found".to_string())?;

    let code = payload
        .code
        .or_else(|| {
            source
                .runtime_context
                .get("code")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        })
        .ok_or_else(|| "source execution code missing".to_string())?;

    let result = run_execute_local_code_mode(
        &state,
        ExecuteLocalCodeModeRequest {
            code,
            session_id: payload.session_id.or(Some(source.session_id.clone())),
            language: payload.language.or(Some(source.language.clone())),
            execution_timeout: payload.execution_timeout,
            dry_run: payload.dry_run,
            context: None,
            max_calls: Some(16),
            allowed_tools: source
                .request_meta
                .get("allowed_tools")
                .and_then(value_to_string_vec),
            capability_snapshot: source.request_meta.get("capability_snapshot").cloned(),
        },
        None,
    )
    .await
    .map_err(|err| err.to_string())?;

    let _tool_plan = payload.tool_plan;
    Ok(ReplayLocalCodeModeResponse {
        replay_of: source.id,
        source_execution_id: source.execution_id,
        result,
    })
}

#[tauri::command]
pub async fn approve_pending_local_code_mode_execution(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
) -> Result<Value, String> {
    let token = approval_token
        .or(approvalToken)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "approval token is required".to_string())?;
    let pending = state
        .code_mode
        .pending_local_approvals
        .write()
        .await
        .remove(&token)
        .ok_or_else(|| "approval token not found".to_string())?;
    let session_id = pending.chat_ctx.session_id.clone();
    let model_id = pending.model_connection.model_id.clone();
    let provider_model_id = pending.model_connection.provider_model_id.clone();

    let now_unix_ms = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    if pending.expires_at_unix_ms < now_unix_ms as i128 {
        return Err("approval token expired; please retry the action".to_string());
    }

    let response = crate::modules::mcp::commands::runtime::approve_pending_local_code_mode_execution(
        &app,
        &state,
        pending,
    )
    .await?;

    if let Some((response_text, assistant_blocks)) =
        extract_local_chat_approval_message(&response)
    {
        state
            .mcp
            .store
            .append_local_conversation_message(
                crate::modules::mcp::types::CreateConversationMessageRequest {
                    session_id,
                    role: "assistant".to_string(),
                    content: response_text,
                    name: None,
                    meta_info: build_local_chat_approval_meta(
                        assistant_blocks,
                        &model_id,
                        &provider_model_id,
                    ),
                    is_truncated: Some(false),
                    parent_message_id: None,
                },
            )
            .await
            .map_err(|err| err.to_string())?;
    }

    Ok(response)
}

#[tauri::command]
pub async fn reject_pending_local_code_mode_execution(
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
) -> Result<bool, String> {
    let token = approval_token
        .or(approvalToken)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "approval token is required".to_string())?;
    Ok(state
        .code_mode
        .pending_local_approvals
        .write()
        .await
        .remove(&token)
        .is_some())
}

fn extract_local_chat_approval_message(payload: &Value) -> Option<(String, Vec<Value>)> {
    let response = payload.get("response")?;
    let response_text = response
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let mut assistant_blocks = payload
        .get("blocks")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    if !response_text.trim().is_empty() {
        assistant_blocks.push(json!({
            "type": "text",
            "content": response_text,
        }));
    }
    if response_text.trim().is_empty() && assistant_blocks.is_empty() {
        return None;
    }
    Some((response_text, assistant_blocks))
}

fn build_local_chat_approval_meta(
    assistant_blocks: Vec<Value>,
    model_id: &str,
    provider_model_id: &str,
) -> Option<Value> {
    let mut meta = serde_json::Map::new();
    if !assistant_blocks.is_empty() {
        meta.insert("blocks".to_string(), Value::Array(assistant_blocks));
    }
    meta.insert("model_id".to_string(), Value::String(model_id.to_string()));
    meta.insert(
        "provider_model_id".to_string(),
        Value::String(provider_model_id.to_string()),
    );
    Some(Value::Object(meta))
}

async fn run_execute_local_code_mode(
    state: &AppState,
    payload: ExecuteLocalCodeModeRequest,
    stream_target: Option<RuntimeBridgeStreamTarget>,
) -> Result<ExecuteLocalCodeModeResponse, CodeModeError> {
    let started = Instant::now();
    let source_code = payload.code.trim().to_string();
    if source_code.is_empty() {
        return Err(CodeModeError::validation("code is required"));
    }
    let language = payload
        .language
        .clone()
        .unwrap_or_else(|| "python".to_string())
        .trim()
        .to_lowercase();
    if language != "python" {
        return Err(CodeModeError::validation("only python is supported"));
    }

    let session_id = payload
        .session_id
        .clone()
        .unwrap_or_else(|| format!("local-{}", uuid::Uuid::new_v4().simple()));
    let dry_run = payload.dry_run.unwrap_or(false);
    if dry_run {
        let response = ExecuteLocalCodeModeResponse {
            success: true,
            status: "dry_run".to_string(),
            format_version: EXECUTION_FORMAT_VERSION.to_string(),
            runtime_protocol_version: RUNTIME_PROTOCOL_VERSION.to_string(),
            session_id,
            bridge_endpoint: "".to_string(),
            exit_code: 0,
            stdout: vec![],
            stderr: vec![],
            result: vec![],
            runtime_tool_calls: vec![],
            render_blocks: vec![],
            error: None,
            error_code: None,
            runtime_mode: SandboxRuntimeMode::Disabled,
        };
        persist_execution(state, &payload, &response, &source_code, 0).await;
        return Ok(response);
    }

    let sandbox_report = state
        .sandbox
        .manager
        .ensure_launch_policy(SandboxLaunchPolicy::StrictSandbox)
        .await
        .map_err(|err| CodeModeError::Sandbox(err.to_string()))?;
    if sandbox_report.runtime_mode != SandboxRuntimeMode::Sandbox {
        let response = build_sandbox_blocked_response(&session_id, &sandbox_report);
        persist_execution(
            state,
            &payload,
            &response,
            &source_code,
            started.elapsed().as_millis() as i64,
        )
        .await;
        return Ok(response);
    }

    let bridge_base = state
        .code_mode
        .bridge
        .ensure_started(BridgeDeps {
            mcp: state.mcp.clone(),
            memory: state.memory.clone(),
            providers: state.providers.clone(),
        })
        .await?;

    let max_calls = payload.max_calls.unwrap_or(16).max(1);
    let allowed_tools = resolve_allowed_tools(
        payload.allowed_tools.as_ref(),
        payload.capability_snapshot.as_ref(),
    );
    let capability_snapshot = payload
        .capability_snapshot
        .clone()
        .filter(|value| value.is_object());
    let context = with_capability_contract(
        payload.context.clone().unwrap_or_else(|| {
            json!({
                "identity": {
                    "user_id": LOCAL_DEFAULT_USER_ID,
                },
                "request": {
                    "channel": "desktop",
                    "session_id": session_id.clone(),
                }
            })
        }),
        allowed_tools.as_ref(),
        capability_snapshot.as_ref(),
    );
    let issued = state
        .code_mode
        .bridge
        .issue_token(
            RuntimeBridgeClaims {
                user_id: LOCAL_DEFAULT_USER_ID.to_string(),
                session_id: session_id.clone(),
                max_calls,
                allowed_tools: allowed_tools.clone(),
            },
            context,
            Some(600),
            stream_target,
        )
        .await?;

    let runtime = build_runtime_preamble(
        &(bridge_base.clone() + "/call"),
        &issued.token,
        payload.execution_timeout.unwrap_or(30),
        max_calls,
    );

    let final_code = format!("{}\n\n{}", runtime, source_code);
    let run_result = state
        .sandbox
        .manager
        .run_code(
            &session_id,
            &final_code,
            Some("python"),
            payload.execution_timeout,
            SandboxLaunchPolicy::StrictSandbox,
        )
        .await
        .map_err(|err| CodeModeError::Sandbox(err.to_string()))?;

    let mut io_lines = Vec::new();
    io_lines.extend(run_result.stdout.clone());
    io_lines.extend(run_result.stderr.clone());
    io_lines.extend(run_result.result.clone());

    let runtime_tool_calls = extract_runtime_tool_calls(&io_lines);
    let render_blocks = extract_runtime_render_blocks(&io_lines);

    let response = ExecuteLocalCodeModeResponse {
        success: run_result.exit_code == 0,
        status: if run_result.exit_code == 0 {
            "success".to_string()
        } else {
            "failed".to_string()
        },
        format_version: EXECUTION_FORMAT_VERSION.to_string(),
        runtime_protocol_version: RUNTIME_PROTOCOL_VERSION.to_string(),
        session_id,
        bridge_endpoint: bridge_base,
        exit_code: run_result.exit_code,
        stdout: strip_runtime_signal_lines(run_result.stdout),
        stderr: strip_runtime_signal_lines(run_result.stderr),
        result: strip_runtime_signal_lines(run_result.result),
        runtime_tool_calls,
        render_blocks,
        error: if run_result.exit_code == 0 {
            None
        } else {
            Some("sandbox execution failed".to_string())
        },
        error_code: if run_result.exit_code == 0 {
            None
        } else {
            Some("SANDBOX_EXECUTION_FAILED".to_string())
        },
        runtime_mode: SandboxRuntimeMode::Sandbox,
    };
    persist_execution(
        state,
        &payload,
        &response,
        &source_code,
        started.elapsed().as_millis() as i64,
    )
    .await;
    Ok(response)
}

async fn persist_execution(
    state: &AppState,
    request: &ExecuteLocalCodeModeRequest,
    response: &ExecuteLocalCodeModeResponse,
    source_code: &str,
    duration_ms: i64,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let execution_id = format!("local_exec_{}", uuid::Uuid::new_v4().simple());
    let created_at = now_rfc3339();

    let detail = CodeModeExecutionDetail {
        id,
        execution_id,
        user_id: LOCAL_DEFAULT_USER_ID.to_string(),
        session_id: response.session_id.clone(),
        trace_id: None,
        language: request
            .language
            .clone()
            .unwrap_or_else(|| "python".to_string()),
        status: response.status.clone(),
        format_version: Some(response.format_version.clone()),
        runtime_protocol_version: Some(response.runtime_protocol_version.clone()),
        runtime_context: json!({
            "code": source_code,
            "bridge_endpoint": response.bridge_endpoint,
            "runtime_mode": response.runtime_mode,
            "capability_snapshot": request.capability_snapshot.clone().unwrap_or(Value::Null),
        }),
        tool_plan_results: json!({}),
        runtime_tool_calls: RuntimeToolCallsEnvelope {
            calls: response.runtime_tool_calls.clone(),
        },
        render_blocks: Value::Array(response.render_blocks.clone()),
        error: response.error.clone(),
        error_code: response.error_code.clone(),
        runtime_mode: Some(response.runtime_mode),
        duration_ms,
        request_meta: json!({
            "dry_run": request.dry_run.unwrap_or(false),
            "execution_timeout": request.execution_timeout,
            "runtime_mode": response.runtime_mode,
            "allowed_tools": request.allowed_tools.clone().unwrap_or_default(),
            "capability_snapshot": request.capability_snapshot.clone().unwrap_or(Value::Null),
        }),
        created_at: Some(created_at),
    };

    if let Err(err) = state.code_mode.execution_store.insert(detail).await {
        log::warn!("persist local code mode execution failed: {}", err);
    }
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "".to_string())
}

fn resolve_allowed_tools(
    request_allowed_tools: Option<&Vec<String>>,
    capability_snapshot: Option<&Value>,
) -> Option<Vec<String>> {
    let mut names = BTreeSet::new();
    if let Some(items) = request_allowed_tools {
        for item in items {
            let normalized = item.trim().to_lowercase();
            if !normalized.is_empty() {
                names.insert(normalized);
            }
        }
    }
    if let Some(snapshot) = capability_snapshot {
        if let Some(callable_now) = snapshot
            .get("callable_now")
            .and_then(|value| value.as_array())
        {
            for item in callable_now {
                if let Some(name) = item.get("name").and_then(|value| value.as_str()) {
                    let normalized = name.trim().to_lowercase();
                    if !normalized.is_empty() {
                        names.insert(normalized);
                    }
                }
            }
        }
    }
    if names.is_empty() {
        None
    } else {
        Some(names.into_iter().collect())
    }
}

fn with_capability_contract(
    mut context: Value,
    allowed_tools: Option<&Vec<String>>,
    capability_snapshot: Option<&Value>,
) -> Value {
    let contract = json!({
        "allowed_tools": allowed_tools.cloned().unwrap_or_default(),
        "capability_snapshot": capability_snapshot.cloned().unwrap_or(Value::Null),
    });
    if let Some(object) = context.as_object_mut() {
        object.insert("capability_contract".to_string(), contract);
        context
    } else {
        json!({
            "request_context": context,
            "capability_contract": contract,
        })
    }
}

fn value_to_string_vec(value: &Value) -> Option<Vec<String>> {
    let array = value.as_array()?;
    let items = array
        .iter()
        .filter_map(|item| item.as_str())
        .map(|item| item.trim().to_lowercase())
        .filter(|item| !item.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if items.is_empty() {
        None
    } else {
        Some(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_allowed_tools_merges_request_and_snapshot() {
        let request_allowed = vec!["search_web".to_string(), "search_web".to_string()];
        let snapshot = json!({
            "callable_now": [
                { "name": "fetch_page" },
                { "name": "search_web" }
            ]
        });
        assert_eq!(
            resolve_allowed_tools(Some(&request_allowed), Some(&snapshot)),
            Some(vec!["fetch_page".to_string(), "search_web".to_string()])
        );
    }

    #[test]
    fn with_capability_contract_embeds_contract_into_context() {
        let context = json!({"request": {"channel": "desktop"}});
        let result = with_capability_contract(
            context,
            Some(&vec!["search_web".to_string()]),
            Some(&json!({"callable_now": [{"name": "search_web"}]})),
        );
        assert_eq!(
            result["capability_contract"]["allowed_tools"],
            json!(["search_web"])
        );
    }
}

fn build_sandbox_blocked_response(
    session_id: &str,
    report: &SandboxReadinessReport,
) -> ExecuteLocalCodeModeResponse {
    let error_code = sandbox_status_error_code(report.status).to_string();
    ExecuteLocalCodeModeResponse {
        success: false,
        status: "blocked".to_string(),
        format_version: EXECUTION_FORMAT_VERSION.to_string(),
        runtime_protocol_version: RUNTIME_PROTOCOL_VERSION.to_string(),
        session_id: session_id.to_string(),
        bridge_endpoint: "".to_string(),
        exit_code: 1,
        stdout: vec![],
        stderr: vec![],
        result: vec![],
        runtime_tool_calls: vec![],
        render_blocks: vec![],
        error: Some(report.blocking_reason.clone().unwrap_or_else(|| {
            "sandbox is not ready; install or repair the desktop sandbox before running Code Mode"
                .to_string()
        })),
        error_code: Some(error_code),
        runtime_mode: report.runtime_mode,
    }
}

fn sandbox_status_error_code(status: SandboxReadinessStatus) -> &'static str {
    match status {
        SandboxReadinessStatus::NeedsWsl => "SANDBOX_NEEDS_WSL",
        SandboxReadinessStatus::NeedsPython => "SANDBOX_NEEDS_PYTHON",
        SandboxReadinessStatus::NeedsBoxLite => "SANDBOX_NEEDS_BOXLITE",
        SandboxReadinessStatus::RepairNeeded => "SANDBOX_REPAIR_REQUIRED",
        SandboxReadinessStatus::Unsupported => "SANDBOX_UNSUPPORTED_PLATFORM",
        SandboxReadinessStatus::Ready => "SANDBOX_REQUIRED",
    }
}

fn build_runtime_preamble(
    bridge_call_endpoint: &str,
    execution_token: &str,
    timeout_seconds: u64,
    max_tool_calls: i64,
) -> String {
    let escaped_endpoint = bridge_call_endpoint
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    let escaped_token = execution_token.replace('\\', "\\\\").replace('"', "\\\"");

    format!(
        r#"import json
import urllib.request

class DeetingRuntime:
    def __init__(self):
        self.version = "1.2.0"
        self._call_index = 0
        self._max_tool_calls = {max_tool_calls}
        self._bridge_call = "{escaped_endpoint}"
        self._execution_token = "{escaped_token}"
        self._timeout_seconds = float({timeout_seconds})

    def log(self, *args):
        print("[deeting.log]", *args)

    def section(self, title):
        print(f"\\n[deeting.section] {{title}}")

    def get_context(self):
        endpoint = self._bridge_call.replace("/call", "/context")
        req = urllib.request.Request(
            endpoint,
            data=json.dumps({{"execution_token": self._execution_token}}, ensure_ascii=False).encode("utf-8"),
            headers={{
                "Content-Type": "application/json",
                "{BRIDGE_EXECUTION_TOKEN_HEADER}": self._execution_token,
            }},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self._timeout_seconds) as response:
            raw = response.read().decode("utf-8")
        parsed = json.loads(raw) if raw else {{}}
        if isinstance(parsed, dict) and parsed.get("ok") and isinstance(parsed.get("context"), dict):
            return parsed.get("context")
        return {{}}

    def render(self, view_type, payload=None, title=None, metadata=None):
        block = {{"view_type": str(view_type or "").strip(), "payload": payload if payload is not None else {{}}}}
        if title is not None:
            block["title"] = title
        if metadata is not None:
            block["metadata"] = metadata
        print("{RUNTIME_RENDER_BLOCK_MARKER}" + json.dumps(block, ensure_ascii=False, default=str))
        return block

    def call_tool(self, tool_name, *args, **kwargs):
        if args:
            if len(args) == 1 and isinstance(args[0], dict):
                merged = dict(args[0])
                merged.update(kwargs or {{}})
                kwargs = merged
            else:
                raise TypeError("deeting.call_tool expects keyword args")

        idx = self._call_index
        self._call_index += 1
        if idx >= self._max_tool_calls:
            raise RuntimeError("runtime tool call limit exceeded")

        request_payload = {{
            "tool_name": str(tool_name or "").strip(),
            "arguments": kwargs or {{}},
            "execution_token": self._execution_token,
        }}
        req = urllib.request.Request(
            self._bridge_call,
            data=json.dumps(request_payload, ensure_ascii=False).encode("utf-8"),
            headers={{
                "Content-Type": "application/json",
                "{BRIDGE_EXECUTION_TOKEN_HEADER}": self._execution_token,
            }},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self._timeout_seconds) as response:
            raw = response.read().decode("utf-8")
        parsed = json.loads(raw) if raw else {{}}
        if isinstance(parsed, dict) and parsed.get("ok"):
            return parsed.get("result")
        if isinstance(parsed, dict):
            err = parsed.get("error") or parsed.get("message") or "bridge call failed"
            return {{"error": str(err), "error_code": parsed.get("error_code")}}

        payload = {{"index": idx, "tool_name": str(tool_name or ""), "arguments": kwargs or {{}}}}
        print("{RUNTIME_TOOL_CALL_MARKER}" + json.dumps(payload, ensure_ascii=False))
        return {{"error": "bridge call failed", "error_code": "CODE_MODE_BRIDGE_INVALID_RESPONSE"}}

deeting = DeetingRuntime()
"#
    )
}
