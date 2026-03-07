use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
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
    CodeModeExecutionDetail, CodeModeExecutionPage, CodeModeSyncResultItem, CodeModeSyncSummary,
    ExecuteLocalCodeModeRequest, ExecuteLocalCodeModeResponse, ListCodeModeExecutionsQuery,
    LocalCodeModeBridgeStatus, ReplayLocalCodeModeRequest, ReplayLocalCodeModeResponse,
    RuntimeToolCallsEnvelope, SyncLocalCodeModeExecutionsResponse,
};
use crate::state::AppState;

const LOCAL_DEFAULT_USER_ID: &str = "00000000-0000-0000-0000-000000000000";
const DEFAULT_SYNC_BATCH_SIZE: i64 = 50;
const MAX_SYNC_BATCH_SIZE: i64 = 200;

fn user_cloud_sync_enabled() -> bool {
    let parse_flag = |raw: Option<String>| {
        matches!(
            raw.as_deref()
                .map(|v| v.trim().to_ascii_lowercase())
                .as_deref(),
            Some("1") | Some("true") | Some("yes") | Some("on")
        )
    };

    parse_flag(std::env::var("DESKTOP_ALLOW_USER_CLOUD_SYNC").ok())
        || parse_flag(std::env::var("NEXT_PUBLIC_DESKTOP_ALLOW_USER_CLOUD_SYNC").ok())
}

#[derive(Debug, Serialize)]
struct CloudSyncCodeModeExecutionsRequest {
    executions: Vec<CloudSyncCodeModeExecutionItem>,
}

#[derive(Debug, Serialize)]
struct CloudSyncCodeModeExecutionItem {
    execution_id: String,
    session_id: String,
    trace_id: Option<String>,
    language: String,
    status: String,
    format_version: Option<String>,
    runtime_protocol_version: Option<String>,
    code: String,
    runtime_context: Value,
    tool_plan_results: Value,
    runtime_tool_calls: Value,
    render_blocks: Value,
    error: Option<String>,
    error_code: Option<String>,
    duration_ms: i64,
    request_meta: Value,
    created_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CloudSyncCodeModeExecutionsResponse {
    results: Vec<CloudSyncCodeModeResultItem>,
    summary: CloudSyncCodeModeSummary,
}

#[derive(Debug, Clone, Deserialize)]
struct CloudSyncCodeModeResultItem {
    execution_id: String,
    status: String,
    id: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CloudSyncCodeModeSummary {
    synced: i64,
    exists: i64,
    failed: i64,
}

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
pub async fn sync_local_code_mode_executions(
    state: State<'_, AppState>,
    access_token: String,
    limit: Option<i64>,
) -> Result<SyncLocalCodeModeExecutionsResponse, String> {
    if !user_cloud_sync_enabled() {
        return Ok(SyncLocalCodeModeExecutionsResponse {
            results: vec![],
            summary: CodeModeSyncSummary {
                synced: 0,
                exists: 0,
                failed: 0,
            },
        });
    }

    let normalized_token = access_token.trim().to_string();
    if normalized_token.is_empty() {
        return Err("access token is required".to_string());
    }
    let batch_size = limit
        .unwrap_or(DEFAULT_SYNC_BATCH_SIZE)
        .clamp(1, MAX_SYNC_BATCH_SIZE) as usize;

    let local_records = state
        .code_mode
        .execution_store
        .list_pending_sync(batch_size)
        .await
        .map_err(|err| err.to_string())?;
    if local_records.is_empty() {
        return Ok(SyncLocalCodeModeExecutionsResponse {
            results: vec![],
            summary: CodeModeSyncSummary {
                synced: 0,
                exists: 0,
                failed: 0,
            },
        });
    }

    let request_payload = CloudSyncCodeModeExecutionsRequest {
        executions: local_records
            .iter()
            .map(|record| CloudSyncCodeModeExecutionItem {
                execution_id: record.execution_id.clone(),
                session_id: record.session_id.clone(),
                trace_id: record.trace_id.clone(),
                language: record.language.clone(),
                status: record.status.clone(),
                format_version: record.format_version.clone(),
                runtime_protocol_version: record.runtime_protocol_version.clone(),
                code: record.code.clone(),
                runtime_context: record.runtime_context.clone(),
                tool_plan_results: record.tool_plan_results.clone(),
                runtime_tool_calls: serde_json::to_value(&record.runtime_tool_calls)
                    .unwrap_or_else(|_| json!({ "calls": [] })),
                render_blocks: record.render_blocks.clone(),
                error: record.error.clone(),
                error_code: record.error_code.clone(),
                duration_ms: record.duration_ms,
                request_meta: record.request_meta.clone(),
                created_at: record.created_at.clone(),
            })
            .collect(),
    };

    let base_url = state.mcp.cloud_base_url.read().await.clone();
    let url = format!(
        "{}/api/v1/internal/code-mode/executions/sync",
        base_url.trim_end_matches('/')
    );
    let response = match state
        .mcp
        .client
        .post(&url)
        .bearer_auth(normalized_token)
        .json(&request_payload)
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(err) => {
            let error_text = format!("cloud code mode sync request failed: {}", err);
            for record in local_records.iter() {
                let _ = state
                    .code_mode
                    .execution_store
                    .mark_sync_failed_by_execution_id(&record.execution_id, &error_text)
                    .await;
            }
            return Err(error_text);
        }
    };

    if !response.status().is_success() {
        let status_text = response.status().to_string();
        let error_text = format!("cloud code mode sync failed: {}", status_text);
        for record in local_records.iter() {
            let _ = state
                .code_mode
                .execution_store
                .mark_sync_failed_by_execution_id(&record.execution_id, &error_text)
                .await;
        }
        return Err(error_text);
    }

    let parsed: CloudSyncCodeModeExecutionsResponse = match response.json().await {
        Ok(value) => value,
        Err(err) => {
            let error_text = format!("decode cloud code mode sync response failed: {}", err);
            for record in local_records.iter() {
                let _ = state
                    .code_mode
                    .execution_store
                    .mark_sync_failed_by_execution_id(&record.execution_id, &error_text)
                    .await;
            }
            return Err(error_text);
        }
    };

    let CloudSyncCodeModeExecutionsResponse {
        results,
        summary: cloud_summary,
    } = parsed;
    let _cloud_counts = (
        cloud_summary.synced,
        cloud_summary.exists,
        cloud_summary.failed,
    );

    let mut pending = HashMap::new();
    for record in local_records.iter() {
        pending.insert(record.execution_id.clone(), true);
    }

    let mut final_results = Vec::with_capacity(results.len());
    for item in results {
        let status = item.status.trim().to_string();
        let normalized_status = status.to_ascii_lowercase();
        if pending.remove(&item.execution_id).is_some() {
            if normalized_status == "synced" || normalized_status == "exists" {
                let _ = state
                    .code_mode
                    .execution_store
                    .mark_sync_success_by_execution_id(
                        &item.execution_id,
                        item.id.as_deref(),
                        &now_rfc3339(),
                    )
                    .await;
            } else {
                let err = item
                    .error
                    .clone()
                    .unwrap_or_else(|| "cloud sync failed".to_string());
                let _ = state
                    .code_mode
                    .execution_store
                    .mark_sync_failed_by_execution_id(&item.execution_id, &err)
                    .await;
            }
        }

        final_results.push(CodeModeSyncResultItem {
            execution_id: item.execution_id,
            status,
            id: item.id,
            error: item.error,
        });
    }

    for execution_id in pending.keys() {
        let err = "execution missing from cloud sync response".to_string();
        let _ = state
            .code_mode
            .execution_store
            .mark_sync_failed_by_execution_id(execution_id, &err)
            .await;
        final_results.push(CodeModeSyncResultItem {
            execution_id: execution_id.clone(),
            status: "failed".to_string(),
            id: None,
            error: Some(err),
        });
    }

    let mut summary = CodeModeSyncSummary {
        synced: 0,
        exists: 0,
        failed: 0,
    };
    for result in final_results.iter() {
        match result.status.to_ascii_lowercase().as_str() {
            "synced" => summary.synced += 1,
            "exists" => summary.exists += 1,
            _ => summary.failed += 1,
        }
    }

    Ok(SyncLocalCodeModeExecutionsResponse {
        results: final_results,
        summary,
    })
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
        };
        persist_execution(state, &payload, &response, &source_code, 0).await;
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
    let context = payload.context.clone().unwrap_or_else(|| {
        json!({
            "identity": {
                "user_id": LOCAL_DEFAULT_USER_ID,
            },
            "request": {
                "channel": "desktop",
                "session_id": session_id.clone(),
            }
        })
    });
    let issued = state
        .code_mode
        .bridge
        .issue_token(
            RuntimeBridgeClaims {
                user_id: LOCAL_DEFAULT_USER_ID.to_string(),
                session_id: session_id.clone(),
                max_calls,
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
        }),
        tool_plan_results: json!({}),
        runtime_tool_calls: RuntimeToolCallsEnvelope {
            calls: response.runtime_tool_calls.clone(),
        },
        render_blocks: Value::Array(response.render_blocks.clone()),
        error: response.error.clone(),
        error_code: if response.success {
            None
        } else {
            Some("SANDBOX_EXECUTION_FAILED".to_string())
        },
        duration_ms,
        request_meta: json!({
            "dry_run": request.dry_run.unwrap_or(false),
            "execution_timeout": request.execution_timeout,
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
