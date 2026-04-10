use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use crate::modules::code_mode::contract::BRIDGE_EXECUTION_TOKEN_HEADER;
use crate::modules::code_mode::error::CodemodeToolError;
use crate::modules::mcp::commands::runtime::{
    resolve_callable_mcp_tool_by_name, ToolResolutionError,
};
use crate::modules::mcp::McpRuntimeState;
use crate::modules::memory::types::{
    CreateLocalMemoryRequest, LocalMemoryClearRequest, LocalMemoryListQuery,
};
use crate::modules::memory::MemoryState;
use crate::modules::providers::ProviderState;
use crate::modules::skill_runtime::execute_local_mcp_tool;

const DEFAULT_TOKEN_TTL_SECONDS: i64 = 600;

#[derive(Clone)]
pub struct BridgeDeps {
    pub mcp: McpRuntimeState,
    pub memory: Arc<MemoryState>,
    pub providers: Arc<ProviderState>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RuntimeToolRetryPolicy {
    None,
    SafeReadonly,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RuntimeToolSideEffectLevel {
    ReadOnly,
    SessionWrite,
    ExternalWrite,
    HighRisk,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RuntimeToolExecutionState {
    InProgress,
    NotExecuted,
    Completed,
    AlreadyExecuted,
    TimedOutMayHaveExecuted,
}

#[derive(Debug, Clone, Serialize)]
struct RuntimeToolExecutionContract {
    call_id: String,
    idempotency_key: String,
    timeout_ms: u64,
    retry_policy: RuntimeToolRetryPolicy,
    side_effect_level: RuntimeToolSideEffectLevel,
}

#[derive(Debug, Clone)]
struct RuntimeToolExecutionReceipt {
    contract: RuntimeToolExecutionContract,
    state: RuntimeToolExecutionState,
    ok: bool,
    result: Option<Value>,
    error_code: Option<String>,
    error: Option<String>,
    attempts: u32,
}

#[derive(Debug, Clone)]
pub struct RuntimeBridgeClaims {
    pub user_id: String,
    pub session_id: String,
    pub max_calls: i64,
    pub allowed_tools: Option<Vec<String>>,
    pub execution_scope: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeBridgeIssueResult {
    pub token: String,
    pub expires_at: String,
}

#[derive(Debug, Clone)]
pub struct RuntimeBridgeStreamTarget {
    pub tx: UnboundedSender<String>,
    pub trace_id: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone)]
struct RuntimeBridgeEntry {
    claims: RuntimeBridgeClaims,
    used_calls: i64,
    call_slots: HashMap<String, i64>,
    expires_at_unix_ms: i128,
    context: Value,
    stream_target: Option<RuntimeBridgeStreamTarget>,
    emitted_execution_section: bool,
}

#[derive(Debug, Clone)]
enum StoredFileContent {
    Inline(Vec<u8>),
    ObjectStorage { object_key: String },
}

#[derive(Debug, Clone)]
struct StoredFile {
    meta: Value,
    content: StoredFileContent,
    owner_token: String,
}

#[derive(Default)]
struct RuntimeBridgeStore {
    tokens: HashMap<String, RuntimeBridgeEntry>,
    files: HashMap<String, StoredFile>,
    tool_execution_receipts: HashMap<String, RuntimeToolExecutionReceipt>,
}

#[derive(Clone)]
pub struct CodemodeToolBridgeState {
    inner: Arc<Mutex<Option<BridgeServerHandle>>>,
}

#[derive(Clone)]
struct BridgeServerHandle {
    base_url: String,
    state: Arc<BridgeServerState>,
}

#[derive(Clone)]
struct BridgeServerState {
    deps: BridgeDeps,
    store: Arc<RwLock<RuntimeBridgeStore>>,
}

#[derive(Debug, Deserialize)]
struct CodemodeToolBridgeContextRequest {
    execution_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodemodeToolBridgeCallRequest {
    tool_name: String,
    #[serde(default)]
    arguments: HashMap<String, Value>,
    call_id: Option<String>,
    execution_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodemodeToolBridgeFileWriteRequest {
    name: String,
    content_base64: String,
    #[serde(default = "default_content_type")]
    content_type: String,
    execution_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodemodeToolBridgeFileReadRequest {
    ref_id: String,
    execution_token: Option<String>,
}

fn default_content_type() -> String {
    "application/octet-stream".to_string()
}

fn build_bridge_object_key(name: &str, ref_id: &str) -> String {
    let safe_name = name
        .trim()
        .replace(
            |ch: char| !ch.is_ascii_alphanumeric() && !matches!(ch, '.' | '_' | '-'),
            "-",
        )
        .trim_matches('-')
        .to_string();
    if safe_name.is_empty() {
        format!("code-mode-files/{ref_id}")
    } else {
        format!("code-mode-files/{ref_id}-{safe_name}")
    }
}

async fn cleanup_bridge_files_for_token(state: &BridgeServerState, token: &str) {
    let removed_files = {
        let mut store = state.store.write().await;
        let file_ids = store
            .files
            .iter()
            .filter_map(|(file_id, file)| {
                if file.owner_token == token {
                    Some(file_id.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        file_ids
            .into_iter()
            .filter_map(|file_id| store.files.remove(&file_id))
            .collect::<Vec<_>>()
    };

    for file in removed_files {
        if let StoredFileContent::ObjectStorage { object_key } = file.content {
            if let Err(err) = state
                .deps
                .providers
                .store
                .delete_local_desktop_object_storage_object(&object_key)
                .await
            {
                log::warn!(
                    "code mode bridge cleanup failed for object {}: {}",
                    object_key,
                    err
                );
            }
        }
    }
}

impl CodemodeToolBridgeState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn ensure_started(&self, deps: BridgeDeps) -> Result<String, CodemodeToolError> {
        let mut guard = self.inner.lock().await;
        if let Some(handle) = guard.as_ref() {
            return Ok(handle.base_url.clone());
        }

        let state = Arc::new(BridgeServerState {
            deps,
            store: Arc::new(RwLock::new(RuntimeBridgeStore::default())),
        });

        let app = Router::new()
            .route("/context", post(code_mode_get_context))
            .route("/call", post(code_mode_call_tool))
            .route("/file/write", post(code_mode_file_write))
            .route("/file/read", post(code_mode_file_read))
            .with_state(state.clone());

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|err| CodemodeToolError::Bridge(err.to_string()))?;
        let addr = listener
            .local_addr()
            .map_err(|err| CodemodeToolError::Bridge(err.to_string()))?;
        let base_url = format!("http://{}:{}", addr.ip(), addr.port());

        tauri::async_runtime::spawn(async move {
            if let Err(err) = axum::serve(listener, app).await {
                log::warn!("code mode bridge stopped: {}", err);
            }
        });

        *guard = Some(BridgeServerHandle {
            base_url: base_url.clone(),
            state,
        });
        Ok(base_url)
    }

    pub async fn issue_token(
        &self,
        claims: RuntimeBridgeClaims,
        context: Value,
        ttl_seconds: Option<i64>,
        stream_target: Option<RuntimeBridgeStreamTarget>,
    ) -> Result<RuntimeBridgeIssueResult, CodemodeToolError> {
        let state = self.server_state().await?;
        let token = Uuid::new_v4().to_string();
        let ttl = ttl_seconds.unwrap_or(DEFAULT_TOKEN_TTL_SECONDS).max(1);
        let expires_at_unix_ms = now_unix_ms() + (ttl as i128) * 1000;
        let expires_at = now_rfc3339_offset_seconds(ttl)?;

        let entry = RuntimeBridgeEntry {
            claims,
            used_calls: 0,
            call_slots: HashMap::new(),
            expires_at_unix_ms,
            context,
            stream_target,
            emitted_execution_section: false,
        };
        let mut store = state.store.write().await;
        store.tokens.insert(token.clone(), entry);
        Ok(RuntimeBridgeIssueResult { token, expires_at })
    }

    pub async fn get_base_url(&self) -> Option<String> {
        let guard = self.inner.lock().await;
        guard.as_ref().map(|item| item.base_url.clone())
    }

    async fn server_state(&self) -> Result<Arc<BridgeServerState>, CodemodeToolError> {
        let guard = self.inner.lock().await;
        guard
            .as_ref()
            .map(|item| item.state.clone())
            .ok_or_else(|| CodemodeToolError::Bridge("bridge server not started".to_string()))
    }
}

async fn code_mode_get_context(
    State(state): State<Arc<BridgeServerState>>,
    headers: HeaderMap,
    Json(payload): Json<CodemodeToolBridgeContextRequest>,
) -> Json<Value> {
    let token = resolve_token(headers, payload.execution_token);
    match consume_claims(&state, &token, None).await {
        Ok((_, _, _, _, context)) => Json(json!({"ok": true, "context": context})),
        Err((error_code, error)) => {
            Json(json!({"ok": false, "error_code": error_code, "error": error}))
        }
    }
}

async fn code_mode_call_tool(
    State(state): State<Arc<BridgeServerState>>,
    headers: HeaderMap,
    Json(payload): Json<CodemodeToolBridgeCallRequest>,
) -> Json<Value> {
    let token = resolve_token(headers, payload.execution_token);
    if payload.tool_name.trim().is_empty() {
        return Json(json!({
            "ok": false,
            "error_code": "CODE_MODE_BRIDGE_MISSING_TOOL_NAME",
            "error": "tool_name is required"
        }));
    }

    let (claims, runtime_call_id, call_index, max_calls, _) =
        match consume_claims(&state, &token, payload.call_id.as_deref()).await {
            Ok(consumed) => consumed,
            Err((error_code, error)) => {
                return Json(json!({"ok": false, "error_code": error_code, "error": error}));
            }
        };

    let contract = build_runtime_tool_execution_contract(
        &state,
        &claims,
        &runtime_call_id,
        payload.tool_name.trim(),
        &payload.arguments,
    )
    .await;
    let existing_receipt = {
        let store = state.store.read().await;
        store
            .tool_execution_receipts
            .get(&contract.idempotency_key)
            .cloned()
    };
    if let Some(receipt) = existing_receipt {
        if receipt.state == RuntimeToolExecutionState::InProgress {
            return Json(json!({
                "ok": false,
                "error_code": "CODE_MODE_BRIDGE_CALL_IN_PROGRESS",
                "error": "tool call with the same idempotency key is already running",
                "meta": build_runtime_tool_meta(
                    &claims,
                    call_index,
                    max_calls,
                    &contract,
                    RuntimeToolExecutionState::TimedOutMayHaveExecuted,
                    receipt.attempts,
                    true,
                ),
            }));
        }
        return cached_tool_execution_response(&claims, call_index, max_calls, &receipt, &contract);
    }

    maybe_emit_runtime_execution_section(&state, &token).await;
    emit_runtime_blocks(
        &state,
        &token,
        vec![json!({
            "id": format!("{runtime_call_id}-call"),
            "type": "tool_call",
            "callId": runtime_call_id,
            "toolName": payload.tool_name.trim(),
            "toolArgs": payload.arguments.clone(),
            "status": "running",
            "executionContract": &contract,
        })],
    )
    .await;

    store_runtime_tool_execution_receipt(
        &state,
        RuntimeToolExecutionReceipt {
            contract: contract.clone(),
            state: RuntimeToolExecutionState::InProgress,
            ok: false,
            result: None,
            error_code: None,
            error: None,
            attempts: 0,
        },
    )
    .await;

    let max_attempts = match contract.retry_policy {
        RuntimeToolRetryPolicy::SafeReadonly => 2,
        RuntimeToolRetryPolicy::None => 1,
    };
    let mut attempts = 0_u32;
    loop {
        attempts = attempts.saturating_add(1);
        let dispatch = tokio::time::timeout(
            Duration::from_millis(contract.timeout_ms.max(1)),
            dispatch_tool_call(
                &state,
                &claims,
                &payload.tool_name,
                payload.arguments.clone(),
            ),
        )
        .await;
        match dispatch {
            Ok(Ok(result)) => {
                let receipt = RuntimeToolExecutionReceipt {
                    contract: contract.clone(),
                    state: RuntimeToolExecutionState::Completed,
                    ok: true,
                    result: Some(result.clone()),
                    error_code: None,
                    error: None,
                    attempts,
                };
                store_runtime_tool_execution_receipt(&state, receipt.clone()).await;
                let mut blocks = vec![json!({
                    "id": format!("{runtime_call_id}-result"),
                    "type": "tool_result",
                    "callId": runtime_call_id,
                    "toolName": payload.tool_name.trim(),
                    "status": "success",
                    "result": result.clone(),
                    "meta": build_runtime_tool_meta(
                        &claims,
                        call_index,
                        max_calls,
                        &contract,
                        RuntimeToolExecutionState::Completed,
                        attempts,
                        false,
                    ),
                })];
                blocks.extend(extract_runtime_ui_blocks_from_result(&result));
                emit_runtime_blocks(&state, &token, blocks).await;
                return Json(json!({
                    "ok": true,
                    "result": result,
                    "meta": build_runtime_tool_meta(
                        &claims,
                        call_index,
                        max_calls,
                        &contract,
                        RuntimeToolExecutionState::Completed,
                        attempts,
                        false,
                    ),
                }));
            }
            Ok(Err((code, error))) => {
                let execution_state = runtime_tool_error_state(&code);
                let receipt = RuntimeToolExecutionReceipt {
                    contract: contract.clone(),
                    state: execution_state.clone(),
                    ok: false,
                    result: None,
                    error_code: Some(code.clone()),
                    error: Some(error.clone()),
                    attempts,
                };
                store_runtime_tool_execution_receipt(&state, receipt).await;
                emit_runtime_blocks(
                    &state,
                    &token,
                    vec![json!({
                        "id": format!("{runtime_call_id}-result"),
                        "type": "tool_result",
                        "callId": runtime_call_id,
                        "toolName": payload.tool_name.trim(),
                        "status": "error",
                        "result": {
                            "error": error.clone(),
                            "error_code": code.clone(),
                        },
                        "meta": build_runtime_tool_meta(
                            &claims,
                            call_index,
                            max_calls,
                            &contract,
                            execution_state.clone(),
                            attempts,
                            false,
                        ),
                    })],
                )
                .await;
                return Json(json!({
                    "ok": false,
                    "error_code": code,
                    "error": error,
                    "meta": build_runtime_tool_meta(
                        &claims,
                        call_index,
                        max_calls,
                        &contract,
                        execution_state,
                        attempts,
                        false,
                    ),
                }));
            }
            Err(_)
                if contract.retry_policy == RuntimeToolRetryPolicy::SafeReadonly
                    && attempts < max_attempts =>
            {
                continue;
            }
            Err(_) => {
                let timeout_error = format!(
                    "tool '{}' timed out after {}ms; the tool may have executed, so Deeting did not automatically replay it",
                    payload.tool_name.trim(),
                    contract.timeout_ms
                );
                let receipt = RuntimeToolExecutionReceipt {
                    contract: contract.clone(),
                    state: RuntimeToolExecutionState::TimedOutMayHaveExecuted,
                    ok: false,
                    result: None,
                    error_code: Some("CODE_MODE_BRIDGE_TIMEOUT".to_string()),
                    error: Some(timeout_error.clone()),
                    attempts,
                };
                store_runtime_tool_execution_receipt(&state, receipt).await;
                emit_runtime_blocks(
                    &state,
                    &token,
                    vec![json!({
                        "id": format!("{runtime_call_id}-result"),
                        "type": "tool_result",
                        "callId": runtime_call_id,
                        "toolName": payload.tool_name.trim(),
                        "status": "error",
                        "result": {
                            "error": timeout_error.clone(),
                            "error_code": "CODE_MODE_BRIDGE_TIMEOUT",
                            "execution_state": "timed_out_may_have_executed",
                        },
                        "meta": build_runtime_tool_meta(
                            &claims,
                            call_index,
                            max_calls,
                            &contract,
                            RuntimeToolExecutionState::TimedOutMayHaveExecuted,
                            attempts,
                            false,
                        ),
                    })],
                )
                .await;
                return Json(json!({
                    "ok": false,
                    "error_code": "CODE_MODE_BRIDGE_TIMEOUT",
                    "error": timeout_error,
                    "meta": build_runtime_tool_meta(
                        &claims,
                        call_index,
                        max_calls,
                        &contract,
                        RuntimeToolExecutionState::TimedOutMayHaveExecuted,
                        attempts,
                        false,
                    ),
                }));
            }
        }
    }
}

fn build_runtime_tool_meta(
    claims: &RuntimeBridgeClaims,
    call_index: i64,
    max_calls: i64,
    contract: &RuntimeToolExecutionContract,
    execution_state: RuntimeToolExecutionState,
    attempts: u32,
    cached: bool,
) -> Value {
    json!({
        "call_index": call_index,
        "max_calls": max_calls,
        "session_id": claims.session_id,
        "execution_scope": claims.execution_scope,
        "execution_state": execution_state,
        "attempts": attempts,
        "cached": cached,
        "execution_contract": contract,
    })
}

async fn build_runtime_tool_execution_contract(
    state: &BridgeServerState,
    claims: &RuntimeBridgeClaims,
    call_id: &str,
    tool_name: &str,
    arguments: &HashMap<String, Value>,
) -> RuntimeToolExecutionContract {
    if let Some((side_effect_level, timeout_ms)) = built_in_contract_profile(tool_name, arguments) {
        return RuntimeToolExecutionContract {
            call_id: call_id.to_string(),
            idempotency_key: format!("{}:{}", claims.execution_scope, call_id),
            timeout_ms,
            retry_policy: retry_policy_for_side_effect_level(side_effect_level),
            side_effect_level,
        };
    }

    let argument_value = serde_json::to_value(arguments).unwrap_or_else(|_| json!({}));
    let (side_effect_level, timeout_ms) =
        match resolve_callable_mcp_tool_by_name(state.deps.mcp.store.as_ref(), tool_name).await {
            Ok(tool) => {
                let risk = state.deps.mcp.assess_tool_risk(&tool, &argument_value);
                (
                    side_effect_level_from_mcp_tool(&tool, &risk),
                    tool_timeout_ms(&tool).unwrap_or_else(|| {
                        default_timeout_ms_for_side_effect_level(side_effect_level_from_mcp_tool(
                            &tool, &risk,
                        ))
                    }),
                )
            }
            Err(_) => (
                RuntimeToolSideEffectLevel::HighRisk,
                default_timeout_ms_for_side_effect_level(RuntimeToolSideEffectLevel::HighRisk),
            ),
        };

    RuntimeToolExecutionContract {
        call_id: call_id.to_string(),
        idempotency_key: format!("{}:{}", claims.execution_scope, call_id),
        timeout_ms,
        retry_policy: retry_policy_for_side_effect_level(side_effect_level),
        side_effect_level,
    }
}

fn built_in_contract_profile(
    tool_name: &str,
    _arguments: &HashMap<String, Value>,
) -> Option<(RuntimeToolSideEffectLevel, u64)> {
    let normalized = tool_name.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "list_local_memories"
        | "list_user_memories"
        | "search_user_memories"
        | "list_mcp_tools"
        | "list_tools"
        | "list_local_provider_instances"
        | "list_provider_instances" => Some((
            RuntimeToolSideEffectLevel::ReadOnly,
            default_timeout_ms_for_side_effect_level(RuntimeToolSideEffectLevel::ReadOnly),
        )),
        "append_local_memory" | "add_knowledge_chunk" => Some((
            RuntimeToolSideEffectLevel::SessionWrite,
            default_timeout_ms_for_side_effect_level(RuntimeToolSideEffectLevel::SessionWrite),
        )),
        "clear_local_memories" => Some((
            RuntimeToolSideEffectLevel::HighRisk,
            default_timeout_ms_for_side_effect_level(RuntimeToolSideEffectLevel::HighRisk),
        )),
        _ => None,
    }
}

fn retry_policy_for_side_effect_level(
    side_effect_level: RuntimeToolSideEffectLevel,
) -> RuntimeToolRetryPolicy {
    match side_effect_level {
        RuntimeToolSideEffectLevel::ReadOnly => RuntimeToolRetryPolicy::SafeReadonly,
        RuntimeToolSideEffectLevel::SessionWrite
        | RuntimeToolSideEffectLevel::ExternalWrite
        | RuntimeToolSideEffectLevel::HighRisk => RuntimeToolRetryPolicy::None,
    }
}

fn default_timeout_ms_for_side_effect_level(side_effect_level: RuntimeToolSideEffectLevel) -> u64 {
    match side_effect_level {
        RuntimeToolSideEffectLevel::ReadOnly => 15_000,
        RuntimeToolSideEffectLevel::SessionWrite => 20_000,
        RuntimeToolSideEffectLevel::ExternalWrite => 30_000,
        RuntimeToolSideEffectLevel::HighRisk => 45_000,
    }
}

fn side_effect_level_from_mcp_tool(
    tool: &mcp_core::types::McpTool,
    risk: &crate::modules::mcp::ToolRiskAssessment,
) -> RuntimeToolSideEffectLevel {
    use crate::modules::mcp::{ApprovalBoundaryClass, RiskOperationClass};

    if tool.is_read_only {
        return RuntimeToolSideEffectLevel::ReadOnly;
    }

    match (&risk.operation_class, &risk.boundary_class) {
        (RiskOperationClass::NetworkRead | RiskOperationClass::FilesystemRead, _)
            if !risk.requires_approval =>
        {
            RuntimeToolSideEffectLevel::ReadOnly
        }
        (_, ApprovalBoundaryClass::HardBoundary) | (RiskOperationClass::ProcessExec, _) => {
            RuntimeToolSideEffectLevel::HighRisk
        }
        (RiskOperationClass::FilesystemWrite, _) => RuntimeToolSideEffectLevel::ExternalWrite,
        _ => RuntimeToolSideEffectLevel::ExternalWrite,
    }
}

fn tool_timeout_ms(tool: &mcp_core::types::McpTool) -> Option<u64> {
    serde_json::from_str::<Value>(&tool.config_json)
        .ok()
        .and_then(|value| {
            value
                .get("execution")
                .and_then(|execution| execution.get("timeout_seconds"))
                .and_then(Value::as_u64)
        })
        .map(|seconds| seconds.max(1).saturating_mul(1000))
}

fn runtime_tool_error_state(error_code: &str) -> RuntimeToolExecutionState {
    match error_code {
        "CODE_MODE_BRIDGE_TOOL_NOT_IN_CAPABILITY_SNAPSHOT"
        | "CODE_MODE_BRIDGE_TOOL_NOT_ALLOWED"
        | "CODE_MODE_BRIDGE_TOOL_NOT_RUNNABLE"
        | "CODE_MODE_BRIDGE_MISSING_TOOL_NAME" => RuntimeToolExecutionState::NotExecuted,
        _ => RuntimeToolExecutionState::Completed,
    }
}

async fn store_runtime_tool_execution_receipt(
    state: &BridgeServerState,
    receipt: RuntimeToolExecutionReceipt,
) {
    let mut store = state.store.write().await;
    store
        .tool_execution_receipts
        .insert(receipt.contract.idempotency_key.clone(), receipt);
}

fn cached_tool_execution_response(
    claims: &RuntimeBridgeClaims,
    call_index: i64,
    max_calls: i64,
    receipt: &RuntimeToolExecutionReceipt,
    contract: &RuntimeToolExecutionContract,
) -> Json<Value> {
    let execution_state = match receipt.state {
        RuntimeToolExecutionState::Completed | RuntimeToolExecutionState::NotExecuted => {
            RuntimeToolExecutionState::AlreadyExecuted
        }
        RuntimeToolExecutionState::TimedOutMayHaveExecuted => {
            RuntimeToolExecutionState::TimedOutMayHaveExecuted
        }
        RuntimeToolExecutionState::InProgress => RuntimeToolExecutionState::TimedOutMayHaveExecuted,
        RuntimeToolExecutionState::AlreadyExecuted => RuntimeToolExecutionState::AlreadyExecuted,
    };
    if receipt.ok {
        Json(json!({
            "ok": true,
            "result": receipt.result.clone().unwrap_or(Value::Null),
            "meta": build_runtime_tool_meta(
                claims,
                call_index,
                max_calls,
                contract,
                execution_state,
                receipt.attempts,
                true,
            ),
        }))
    } else {
        Json(json!({
            "ok": false,
            "error_code": receipt.error_code.clone().unwrap_or_else(|| "CODE_MODE_BRIDGE_EXECUTION_FAILED".to_string()),
            "error": receipt.error.clone().unwrap_or_else(|| "bridge call failed".to_string()),
            "result": receipt.result.clone(),
            "meta": build_runtime_tool_meta(
                claims,
                call_index,
                max_calls,
                contract,
                execution_state,
                receipt.attempts,
                true,
            ),
        }))
    }
}

async fn maybe_emit_runtime_execution_section(state: &BridgeServerState, token: &str) {
    let normalized = token.trim();
    if normalized.is_empty() {
        return;
    }
    let stream_target = {
        let mut store = state.store.write().await;
        let Some(entry) = store.tokens.get_mut(normalized) else {
            return;
        };
        if entry.emitted_execution_section {
            None
        } else {
            entry.emitted_execution_section = true;
            entry.stream_target.clone()
        }
    };
    let Some(stream_target) = stream_target else {
        return;
    };
    send_runtime_blocks(
        &stream_target,
        vec![json!({
            "type": "execution_section",
            "title": "Runtime Tool Actions",
        })],
    );
}

async fn emit_runtime_blocks(state: &BridgeServerState, token: &str, blocks: Vec<Value>) {
    if blocks.is_empty() {
        return;
    }
    let normalized = token.trim();
    if normalized.is_empty() {
        return;
    }
    let stream_target = {
        let store = state.store.read().await;
        store
            .tokens
            .get(normalized)
            .and_then(|entry| entry.stream_target.clone())
    };
    let Some(stream_target) = stream_target else {
        return;
    };
    send_runtime_blocks(&stream_target, blocks);
}

fn send_runtime_blocks(stream_target: &RuntimeBridgeStreamTarget, blocks: Vec<Value>) {
    let mut payload = json!({
        "type": "blocks",
        "blocks": blocks,
    });
    if let Some(object) = payload.as_object_mut() {
        if let Some(trace_id) = stream_target
            .trace_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            object.insert("trace_id".to_string(), json!(trace_id));
        }
        if let Some(request_id) = stream_target
            .request_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            object.insert("request_id".to_string(), json!(request_id));
        }
    }
    if let Ok(serialized) = serde_json::to_string(&payload) {
        let _ = stream_target.tx.send(serialized);
    }
}

fn extract_runtime_ui_blocks_from_result(result: &Value) -> Vec<Value> {
    let Some(object) = result.as_object() else {
        return Vec::new();
    };

    let mut blocks = Vec::new();
    if let Some(ui_blocks) = object
        .get("ui")
        .and_then(|value| value.get("blocks"))
        .and_then(|value| value.as_array())
    {
        blocks.extend(ui_blocks.iter().cloned());
    }
    if let Some(render) = object.get("__render__") {
        blocks.push(render.clone());
    }
    blocks
}

async fn code_mode_file_write(
    State(state): State<Arc<BridgeServerState>>,
    headers: HeaderMap,
    Json(payload): Json<CodemodeToolBridgeFileWriteRequest>,
) -> Json<Value> {
    let token = resolve_token(headers, payload.execution_token);
    let consumed = consume_claims(&state, &token, None).await;
    if let Err((error_code, error)) = consumed {
        return Json(json!({"ok": false, "error_code": error_code, "error": error}));
    }

    let bytes =
        match base64::engine::general_purpose::STANDARD.decode(payload.content_base64.as_bytes()) {
            Ok(bytes) => bytes,
            Err(_) => {
                return Json(
                    json!({"ok": false, "error_code": "INVALID_BASE64", "error": "invalid base64"}),
                );
            }
        };
    let ref_id = format!("fref_{}", Uuid::new_v4().simple());
    let file_ref = json!({
        "__file_ref__": true,
        "id": ref_id,
        "name": payload.name,
        "content_type": payload.content_type,
        "size": bytes.len(),
    });
    let object_key = build_bridge_object_key(
        file_ref["name"].as_str().unwrap_or("file"),
        file_ref["id"].as_str().unwrap_or_default(),
    );
    let stored_content = match state
        .deps
        .providers
        .store
        .put_local_desktop_object_storage_bytes(
            &object_key,
            file_ref["content_type"]
                .as_str()
                .unwrap_or("application/octet-stream"),
            &bytes,
        )
        .await
    {
        Ok(Some(saved_object_key)) => StoredFileContent::ObjectStorage {
            object_key: saved_object_key,
        },
        Ok(None) | Err(_) => StoredFileContent::Inline(bytes),
    };
    let mut store = state.store.write().await;
    store.files.insert(
        file_ref["id"].as_str().unwrap_or_default().to_string(),
        StoredFile {
            meta: file_ref.clone(),
            content: stored_content,
            owner_token: token.clone(),
        },
    );
    Json(json!({"ok": true, "file_ref": file_ref}))
}

async fn code_mode_file_read(
    State(state): State<Arc<BridgeServerState>>,
    headers: HeaderMap,
    Json(payload): Json<CodemodeToolBridgeFileReadRequest>,
) -> Json<Value> {
    let token = resolve_token(headers, payload.execution_token);
    let consumed = consume_claims(&state, &token, None).await;
    if let Err((error_code, error)) = consumed {
        return Json(json!({"ok": false, "error_code": error_code, "error": error}));
    }

    let entry = {
        let store = state.store.read().await;
        let Some(entry) = store.files.get(payload.ref_id.trim()) else {
            return Json(
                json!({"ok": false, "error_code": "FILE_NOT_FOUND", "error": "file ref not found"}),
            );
        };
        entry.clone()
    };
    let bytes = match &entry.content {
        StoredFileContent::Inline(bytes) => bytes.clone(),
        StoredFileContent::ObjectStorage { object_key } => match state
            .deps
            .providers
            .store
            .read_local_desktop_object_storage_bytes(object_key)
            .await
        {
            Ok(Some(bytes)) => bytes,
            _ => {
                return Json(
                    json!({"ok": false, "error_code": "FILE_NOT_FOUND", "error": "file ref not found"}),
                );
            }
        },
    };
    Json(json!({
        "ok": true,
        "file_ref": entry.meta,
        "content_base64": base64::engine::general_purpose::STANDARD.encode(bytes.as_slice())
    }))
}

fn resolve_token(headers: HeaderMap, body_token: Option<String>) -> String {
    if let Some(value) = headers.get(BRIDGE_EXECUTION_TOKEN_HEADER) {
        if let Ok(text) = value.to_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    body_token.unwrap_or_default().trim().to_string()
}

fn normalize_call_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

async fn consume_claims(
    state: &BridgeServerState,
    token: &str,
    call_id: Option<&str>,
) -> Result<(RuntimeBridgeClaims, String, i64, i64, Value), (String, String)> {
    let normalized = token.trim();
    if normalized.is_empty() {
        return Err((
            "CODE_MODE_BRIDGE_MISSING_TOKEN".to_string(),
            "missing execution token".to_string(),
        ));
    }
    let now_ms = now_unix_ms();
    let result = {
        let mut store = state.store.write().await;
        let Some(entry) = store.tokens.get_mut(normalized) else {
            return Err((
                "CODE_MODE_BRIDGE_INVALID_TOKEN".to_string(),
                "execution token not found".to_string(),
            ));
        };
        if entry.expires_at_unix_ms <= now_ms {
            store.tokens.remove(normalized);
            Err((
                "CODE_MODE_BRIDGE_TOKEN_EXPIRED".to_string(),
                "execution token expired".to_string(),
            ))
        } else {
            let normalized_call_id = normalize_call_id(call_id);
            if let Some(call_id) = normalized_call_id
                .as_ref()
                .and_then(|value| entry.call_slots.get(value).map(|index| (value, *index)))
            {
                Ok((
                    entry.claims.clone(),
                    call_id.0.clone(),
                    call_id.1,
                    entry.claims.max_calls,
                    entry.context.clone(),
                ))
            } else if entry.used_calls >= entry.claims.max_calls {
                Err((
                    "CODE_MODE_BRIDGE_CALL_LIMIT".to_string(),
                    format!(
                        "runtime bridge call limit exceeded ({})",
                        entry.claims.max_calls
                    ),
                ))
            } else {
                let call_index = entry.used_calls;
                entry.used_calls += 1;
                let assigned_call_id =
                    normalized_call_id.unwrap_or_else(|| format!("runtime-tool-{call_index}"));
                entry
                    .call_slots
                    .insert(assigned_call_id.clone(), call_index);
                Ok((
                    entry.claims.clone(),
                    assigned_call_id,
                    call_index,
                    entry.claims.max_calls,
                    entry.context.clone(),
                ))
            }
        }
    };

    if matches!(
        result,
        Err((ref code, _)) if code == "CODE_MODE_BRIDGE_TOKEN_EXPIRED"
    ) {
        cleanup_bridge_files_for_token(state, normalized).await;
    }
    result
}

async fn dispatch_tool_call(
    state: &BridgeServerState,
    claims: &RuntimeBridgeClaims,
    tool_name: &str,
    arguments: HashMap<String, Value>,
) -> Result<Value, (String, String)> {
    if !tool_allowed_by_claims(claims, tool_name) {
        let allowed = claims
            .allowed_tools
            .clone()
            .unwrap_or_default()
            .into_iter()
            .filter(|name| !name.trim().is_empty())
            .collect::<Vec<_>>()
            .join(", ");
        return Err((
            "CODE_MODE_BRIDGE_TOOL_NOT_IN_CAPABILITY_SNAPSHOT".to_string(),
            format!(
                "tool '{}' is not allowed for this execution contract; allowed tools: {}",
                tool_name.trim(),
                if allowed.is_empty() {
                    "<none>"
                } else {
                    allowed.as_str()
                }
            ),
        ));
    }
    match tool_name.trim() {
        "list_local_memories" | "list_user_memories" | "search_user_memories" => {
            let query = LocalMemoryListQuery {
                cursor: value_to_string(arguments.get("cursor")),
                limit: value_to_i64(arguments.get("limit")),
                session_id: value_to_string(arguments.get("session_id"))
                    .or_else(|| Some(claims.session_id.clone())),
                capability_id: value_to_string(arguments.get("capability_id"))
                    .or_else(|| value_to_string(arguments.get("assistant_id"))),
            };
            let result = state
                .deps
                .memory
                .service
                .list(query)
                .await
                .map_err(|err| ("LOCAL_MEMORY_ERROR".to_string(), err.to_string()))?;
            serde_json::to_value(result)
                .map_err(|err| ("LOCAL_MEMORY_ERROR".to_string(), err.to_string()))
        }
        "append_local_memory" | "add_knowledge_chunk" => {
            let content = value_to_string(arguments.get("content")).unwrap_or_default();
            let resolved_content = if content.is_empty() {
                value_to_string(arguments.get("chunk"))
                    .or_else(|| value_to_string(arguments.get("text")))
                    .unwrap_or_default()
            } else {
                content
            };
            let payload = CreateLocalMemoryRequest {
                content: resolved_content,
                session_id: value_to_string(arguments.get("session_id"))
                    .or_else(|| Some(claims.session_id.clone())),
                capability_id: value_to_string(arguments.get("capability_id"))
                    .or_else(|| value_to_string(arguments.get("assistant_id"))),
                meta_info: arguments.get("meta_info").cloned(),
                category: None,
                source: None,
                tags: None,
            };
            let result = state
                .deps
                .memory
                .service
                .append(payload)
                .await
                .map_err(|err| ("LOCAL_MEMORY_ERROR".to_string(), err.to_string()))?;
            serde_json::to_value(result)
                .map_err(|err| ("LOCAL_MEMORY_ERROR".to_string(), err.to_string()))
        }
        "clear_local_memories" => {
            let payload = LocalMemoryClearRequest {
                session_id: value_to_string(arguments.get("session_id"))
                    .or_else(|| Some(claims.session_id.clone())),
                capability_id: value_to_string(arguments.get("capability_id"))
                    .or_else(|| value_to_string(arguments.get("assistant_id"))),
            };
            let cleared = state
                .deps
                .memory
                .service
                .clear(payload)
                .await
                .map_err(|err| ("LOCAL_MEMORY_ERROR".to_string(), err.to_string()))?;
            Ok(json!({"cleared": cleared}))
        }
        "list_mcp_tools" | "list_tools" => {
            let tools = state
                .deps
                .mcp
                .store
                .list_tools()
                .await
                .map_err(|err| ("MCP_ERROR".to_string(), err.to_string()))?;
            let filtered = tools
                .into_iter()
                .filter(|tool| {
                    !tool
                        .identifier
                        .as_deref()
                        .is_some_and(|identifier| identifier.trim().starts_with("skill."))
                })
                .collect::<Vec<_>>();
            serde_json::to_value(filtered).map_err(|err| ("MCP_ERROR".to_string(), err.to_string()))
        }
        "list_local_provider_instances" | "list_provider_instances" => {
            let instances = state
                .deps
                .providers
                .store
                .list_instances()
                .await
                .map_err(|err| ("PROVIDER_ERROR".to_string(), err.to_string()))?;
            serde_json::to_value(instances)
                .map_err(|err| ("PROVIDER_ERROR".to_string(), err.to_string()))
        }
        _ => {
            // Attempt to resolve as an MCP or System Plugin tool
            match resolve_callable_mcp_tool_by_name(state.deps.mcp.store.as_ref(), tool_name).await
            {
                Ok(tool) => {
                    let argument_value =
                        serde_json::to_value(&arguments).unwrap_or_else(|_| json!({}));
                    // Code mode execution is already constrained by the issued bridge token contract.
                    execute_local_mcp_tool(state.deps.mcp.store.as_ref(), &tool, &argument_value)
                        .await
                        .map_err(|err| ("PROCESS_EXECUTION_FAILED".to_string(), err))
                }
                Err(ToolResolutionError::ToolNotFound { .. }) => Err((
                    "CODE_MODE_BRIDGE_TOOL_NOT_ALLOWED".to_string(),
                    format!("tool '{}' is not supported by local bridge", tool_name),
                )),
                Err(err) => Err((
                    "CODE_MODE_BRIDGE_TOOL_NOT_RUNNABLE".to_string(),
                    err.to_string(),
                )),
            }
        }
    }
}

fn tool_allowed_by_claims(claims: &RuntimeBridgeClaims, tool_name: &str) -> bool {
    let Some(allowed_tools) = claims.allowed_tools.as_ref() else {
        return true;
    };
    let normalized = tool_name.trim().to_lowercase();
    if normalized.is_empty() {
        return false;
    }
    let allowed = allowed_tools
        .iter()
        .map(|name| name.trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .collect::<HashSet<_>>();
    allowed.contains(&normalized)
}

fn value_to_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn value_to_i64(value: Option<&Value>) -> Option<i64> {
    value.and_then(|v| v.as_i64())
}

fn now_unix_ms() -> i128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as i128
}

fn now_rfc3339_offset_seconds(offset_seconds: i64) -> Result<String, CodemodeToolError> {
    let now = time::OffsetDateTime::now_utc() + time::Duration::seconds(offset_seconds);
    now.format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| CodemodeToolError::Internal(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_allowed_by_claims_allows_anything_without_contract() {
        let claims = RuntimeBridgeClaims {
            user_id: "user".to_string(),
            session_id: "session".to_string(),
            max_calls: 4,
            allowed_tools: None,
            execution_scope: "trace-1".to_string(),
        };
        assert!(tool_allowed_by_claims(&claims, "search_web"));
    }

    #[test]
    fn tool_allowed_by_claims_enforces_allowlist() {
        let claims = RuntimeBridgeClaims {
            user_id: "user".to_string(),
            session_id: "session".to_string(),
            max_calls: 4,
            allowed_tools: Some(vec!["search_web".to_string(), "fetch_page".to_string()]),
            execution_scope: "trace-2".to_string(),
        };
        assert!(tool_allowed_by_claims(&claims, "search_web"));
        assert!(!tool_allowed_by_claims(&claims, "list_tools"));
    }

    #[test]
    fn built_in_contract_profile_retries_only_read_only_tools() {
        let (side_effect_level, timeout_ms) =
            built_in_contract_profile("list_local_memories", &HashMap::new())
                .expect("read-only profile");
        assert_eq!(side_effect_level, RuntimeToolSideEffectLevel::ReadOnly);
        assert_eq!(
            retry_policy_for_side_effect_level(side_effect_level),
            RuntimeToolRetryPolicy::SafeReadonly
        );
        assert_eq!(timeout_ms, 15_000);
    }

    #[test]
    fn built_in_contract_profile_disables_auto_retry_for_mutations() {
        let (side_effect_level, timeout_ms) =
            built_in_contract_profile("clear_local_memories", &HashMap::new())
                .expect("mutating profile");
        assert_eq!(side_effect_level, RuntimeToolSideEffectLevel::HighRisk);
        assert_eq!(
            retry_policy_for_side_effect_level(side_effect_level),
            RuntimeToolRetryPolicy::None
        );
        assert_eq!(timeout_ms, 45_000);
    }
}
