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
use crate::modules::code_mode::error::CodeModeError;
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

#[derive(Debug, Clone)]
pub struct RuntimeBridgeClaims {
    pub user_id: String,
    pub session_id: String,
    pub max_calls: i64,
    pub allowed_tools: Option<Vec<String>>,
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
}

#[derive(Clone)]
pub struct CodeModeBridgeState {
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
struct CodeModeBridgeContextRequest {
    execution_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodeModeBridgeCallRequest {
    tool_name: String,
    #[serde(default)]
    arguments: HashMap<String, Value>,
    execution_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodeModeBridgeFileWriteRequest {
    name: String,
    content_base64: String,
    #[serde(default = "default_content_type")]
    content_type: String,
    execution_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodeModeBridgeFileReadRequest {
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

impl CodeModeBridgeState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn ensure_started(&self, deps: BridgeDeps) -> Result<String, CodeModeError> {
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
            .map_err(|err| CodeModeError::Bridge(err.to_string()))?;
        let addr = listener
            .local_addr()
            .map_err(|err| CodeModeError::Bridge(err.to_string()))?;
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
    ) -> Result<RuntimeBridgeIssueResult, CodeModeError> {
        let state = self.server_state().await?;
        let token = Uuid::new_v4().to_string();
        let ttl = ttl_seconds.unwrap_or(DEFAULT_TOKEN_TTL_SECONDS).max(1);
        let expires_at_unix_ms = now_unix_ms() + (ttl as i128) * 1000;
        let expires_at = now_rfc3339_offset_seconds(ttl)?;

        let entry = RuntimeBridgeEntry {
            claims,
            used_calls: 0,
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

    async fn server_state(&self) -> Result<Arc<BridgeServerState>, CodeModeError> {
        let guard = self.inner.lock().await;
        guard
            .as_ref()
            .map(|item| item.state.clone())
            .ok_or_else(|| CodeModeError::Bridge("bridge server not started".to_string()))
    }
}

async fn code_mode_get_context(
    State(state): State<Arc<BridgeServerState>>,
    headers: HeaderMap,
    Json(payload): Json<CodeModeBridgeContextRequest>,
) -> Json<Value> {
    let token = resolve_token(headers, payload.execution_token);
    match consume_claims(&state, &token).await {
        Ok((_, _, _, context)) => Json(json!({"ok": true, "context": context})),
        Err((error_code, error)) => {
            Json(json!({"ok": false, "error_code": error_code, "error": error}))
        }
    }
}

async fn code_mode_call_tool(
    State(state): State<Arc<BridgeServerState>>,
    headers: HeaderMap,
    Json(payload): Json<CodeModeBridgeCallRequest>,
) -> Json<Value> {
    let token = resolve_token(headers, payload.execution_token);
    let (claims, call_index, max_calls, _) = match consume_claims(&state, &token).await {
        Ok(consumed) => consumed,
        Err((error_code, error)) => {
            return Json(json!({"ok": false, "error_code": error_code, "error": error}));
        }
    };

    if payload.tool_name.trim().is_empty() {
        return Json(json!({
            "ok": false,
            "error_code": "CODE_MODE_BRIDGE_MISSING_TOOL_NAME",
            "error": "tool_name is required"
        }));
    }

    maybe_emit_runtime_execution_section(&state, &token).await;
    let runtime_call_id = format!("runtime-tool-{call_index}");
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
        })],
    )
    .await;

    let dispatch = dispatch_tool_call(&state, &claims, &payload.tool_name, payload.arguments).await;
    match dispatch {
        Ok(result) => {
            let mut blocks = vec![json!({
                "id": format!("{runtime_call_id}-result"),
                "type": "tool_result",
                "callId": runtime_call_id,
                "toolName": payload.tool_name.trim(),
                "status": "success",
                "result": result.clone(),
            })];
            blocks.extend(extract_runtime_ui_blocks_from_result(&result));
            emit_runtime_blocks(&state, &token, blocks).await;
            Json(json!({
                "ok": true,
                "result": result,
                "meta": {
                    "call_index": call_index,
                    "max_calls": max_calls,
                    "session_id": claims.session_id,
                }
            }))
        }
        Err((code, error)) => {
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
                })],
            )
            .await;
            Json(json!({
                "ok": false,
                "error_code": code,
                "error": error,
            }))
        }
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
    Json(payload): Json<CodeModeBridgeFileWriteRequest>,
) -> Json<Value> {
    let token = resolve_token(headers, payload.execution_token);
    let consumed = consume_claims(&state, &token).await;
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
    Json(payload): Json<CodeModeBridgeFileReadRequest>,
) -> Json<Value> {
    let token = resolve_token(headers, payload.execution_token);
    let consumed = consume_claims(&state, &token).await;
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

async fn consume_claims(
    state: &BridgeServerState,
    token: &str,
) -> Result<(RuntimeBridgeClaims, i64, i64, Value), (String, String)> {
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
            Ok((
                entry.claims.clone(),
                call_index,
                entry.claims.max_calls,
                entry.context.clone(),
            ))
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
                    let risk = state.deps.mcp.assess_tool_risk(&tool, &argument_value);
                    if risk.requires_approval {
                        return Err((
                            "CODE_MODE_BRIDGE_TOOL_REQUIRES_APPROVAL".to_string(),
                            format!(
                                "tool '{}' blocked by security policy (risk={}): {}",
                                tool_name,
                                risk.risk_level,
                                risk.reasons.join("; ")
                            ),
                        ));
                    }
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

fn now_rfc3339_offset_seconds(offset_seconds: i64) -> Result<String, CodeModeError> {
    let now = time::OffsetDateTime::now_utc() + time::Duration::seconds(offset_seconds);
    now.format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| CodeModeError::Internal(err.to_string()))
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
        };
        assert!(tool_allowed_by_claims(&claims, "search_web"));
        assert!(!tool_allowed_by_claims(&claims, "list_tools"));
    }
}
