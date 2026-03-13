use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Path, State},
    http::{header, HeaderValue, Method},
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, RwLock};
use tower_http::cors::{AllowOrigin, CorsLayer};
use uuid::Uuid;

use crate::modules::mcp::local_orchestrator::{
    execute_local_orchestrated_chat, extract_user_text_from_messages, LocalOrchestratorInput,
};
use crate::modules::mcp::store::LocalConversationRuntimeWindow;
use crate::modules::mcp::types::{
    LocalConversationCompareFinalizeRequest, LocalConversationCompareFinalizeResponse,
};
use crate::modules::memory::service::MemoryService;
use crate::modules::memory::types::{LocalMemoryItem, LocalMemoryListQuery};
use crate::state::AppState;

#[derive(Deserialize, Debug, Clone)]
pub struct LocalChatCompletionRequest {
    pub model: String,
    pub messages: Vec<Value>,
    pub stream: Option<bool>,
    pub status_stream: Option<bool>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub request_id: Option<String>,
    pub provider_model_id: Option<String>,
    pub assistant_id: Option<String>,
    pub session_id: Option<String>,
    pub regenerate: Option<bool>,
    pub compare_only: Option<bool>,
    pub metadata: Option<Value>,
}

#[derive(Serialize)]
struct GatewayHealthResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct LocalChatCancelResponse {
    request_id: String,
    status: String,
}

#[derive(Serialize)]
struct LocalCompareFinalizeErrorResponse {
    code: &'static str,
    message: String,
    source: &'static str,
}

pub struct LocalGatewayState {
    pub app_state: AppState,
    pub app_handle: AppHandle,
}

pub struct LocalGatewayServer {
    pub base_url: RwLock<Option<String>>,
}

const LOCAL_GATEWAY_ALLOWED_ORIGINS: [&str; 5] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
];

impl LocalGatewayServer {
    pub fn new() -> Self {
        Self {
            base_url: RwLock::new(None),
        }
    }

    pub async fn start(
        &self,
        app_state: AppState,
        app_handle: AppHandle,
    ) -> Result<String, String> {
        let state = Arc::new(LocalGatewayState {
            app_state,
            app_handle,
        });
        let cors_layer = build_local_gateway_cors_layer()?;

        let app = Router::new()
            .route("/health", get(health_handler))
            .route("/v1/chat/completions", post(chat_completions_handler))
            .route(
                "/v1/chat/comparisons/finalize",
                post(finalize_compare_handler),
            )
            .route(
                "/v1/chat/completions/:request_id/cancel",
                post(cancel_chat_completions_handler),
            )
            .with_state(state)
            .layer(cors_layer);

        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| format!("failed to bind local gateway listener: {e}"))?;
        let addr = listener
            .local_addr()
            .map_err(|e| format!("failed to resolve local gateway address: {e}"))?;
        let base_url = format!("http://127.0.0.1:{}", addr.port());

        {
            let mut writer = self.base_url.write().await;
            *writer = Some(base_url.clone());
        }

        let logged_base_url = base_url.clone();
        tauri::async_runtime::spawn(async move {
            log::info!("local gateway server started at {}", logged_base_url);
            if let Err(err) = axum::serve(listener, app).await {
                log::error!("local gateway server crashed: {}", err);
            }
        });

        Ok(base_url)
    }
}

fn build_local_gateway_cors_layer() -> Result<CorsLayer, String> {
    let origins = LOCAL_GATEWAY_ALLOWED_ORIGINS
        .iter()
        .map(|value| HeaderValue::from_str(value).map_err(|err| err.to_string()))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::ACCEPT, header::AUTHORIZATION, header::CONTENT_TYPE])
        .max_age(Duration::from_secs(600)))
}

async fn health_handler() -> Json<GatewayHealthResponse> {
    Json(GatewayHealthResponse { status: "ok" })
}

async fn chat_completions_handler(
    State(state): State<Arc<LocalGatewayState>>,
    Json(payload): Json<LocalChatCompletionRequest>,
) -> Response {
    let stream_enabled = payload.stream.unwrap_or(true);
    let status_stream_enabled = payload.status_stream.unwrap_or(true);
    if stream_enabled || status_stream_enabled {
        return stream_chat_completion(state, payload).await.into_response();
    }

    let trace_id = Uuid::new_v4().to_string();
    let input = match map_request_to_orchestrator_input(payload) {
        Ok(value) => value,
        Err(err) => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({
                    "code": "LOCAL_BAD_REQUEST",
                    "message": err,
                    "source": "desktop",
                    "trace_id": trace_id,
                })),
            )
                .into_response();
        }
    };

    match execute_local_orchestrated_chat(
        &state.app_handle,
        &state.app_state,
        input,
        trace_id.clone(),
        None,
    )
    .await
    {
        Ok(response_body) => Json(response_body).into_response(),
        Err(err) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "code": "LOCAL_CHAT_FAILED",
                "message": err,
                "source": "desktop",
                "trace_id": trace_id,
            })),
        )
            .into_response(),
    }
}

async fn stream_chat_completion(
    state: Arc<LocalGatewayState>,
    payload: LocalChatCompletionRequest,
) -> Sse<impl futures_util::stream::Stream<Item = Result<Event, Infallible>>> {
    let trace_id = Uuid::new_v4().to_string();
    let request_id = normalize_optional_string(payload.request_id.as_deref());
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let run_state = state.clone();
    tokio::spawn(async move {
        let input = match map_request_to_orchestrator_input(payload) {
            Ok(value) => value,
            Err(err) => {
                let _ = tx.send(
                    build_stream_error_payload(
                        "LOCAL_BAD_REQUEST",
                        err,
                        &trace_id,
                        request_id.as_deref(),
                    )
                    .to_string(),
                );
                let _ = tx.send("[DONE]".to_string());
                return;
            }
        };

        let outcome = if let Some(request_id_value) = input.request_id.clone() {
            let worker_state = run_state.clone();
            let worker_trace_id = trace_id.clone();
            let tx_clone = tx.clone();
            let input_clone = input.clone();
            let task = tokio::spawn(async move {
                execute_local_orchestrated_chat(
                    &worker_state.app_handle,
                    &worker_state.app_state,
                    input_clone,
                    worker_trace_id,
                    Some(tx_clone),
                )
                .await
            });

            {
                let mut tasks = run_state.app_state.mcp.local_chat_tasks.write().await;
                tasks.insert(request_id_value.clone(), task.abort_handle());
            }

            let join_result = task.await;
            {
                let mut tasks = run_state.app_state.mcp.local_chat_tasks.write().await;
                tasks.remove(&request_id_value);
            }
            match join_result {
                Ok(result) => result,
                Err(err) if err.is_cancelled() => Err("local chat request cancelled".to_string()),
                Err(err) => Err(format!("local chat join error: {err}")),
            }
        } else {
            execute_local_orchestrated_chat(
                &run_state.app_handle,
                &run_state.app_state,
                input,
                trace_id.clone(),
                Some(tx.clone()),
            )
            .await
        };

        match outcome {
            Ok(response_body) => {
                let _ = tx.send(response_body.to_string());
            }
            Err(err) => {
                let _ = tx.send(
                    build_stream_error_payload(
                        "LOCAL_CHAT_FAILED",
                        err,
                        &trace_id,
                        request_id.as_deref(),
                    )
                    .to_string(),
                );
            }
        }

        let _ = tx.send("[DONE]".to_string());
    });

    let stream = async_stream::stream! {
        while let Some(payload) = rx.recv().await {
            yield Ok(Event::default().data(payload.clone()));
            if payload == "[DONE]" {
                break;
            }
        }
    };

    Sse::new(stream)
}

async fn cancel_chat_completions_handler(
    Path(request_id): Path<String>,
    State(state): State<Arc<LocalGatewayState>>,
) -> impl IntoResponse {
    let normalized = request_id.trim().to_string();
    if normalized.is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "code": "LOCAL_BAD_REQUEST",
                "message": "request_id is required",
                "source": "desktop",
            })),
        )
            .into_response();
    }

    let removed = state
        .app_state
        .mcp
        .local_chat_tasks
        .write()
        .await
        .remove(&normalized);
    let cancelled = removed.is_some();
    if let Some(abort_handle) = removed {
        abort_handle.abort();
    }

    Json(LocalChatCancelResponse {
        request_id: normalized,
        status: if cancelled {
            "cancelled".to_string()
        } else {
            "not_found".to_string()
        },
    })
    .into_response()
}

async fn finalize_compare_handler(
    State(state): State<Arc<LocalGatewayState>>,
    Json(payload): Json<LocalConversationCompareFinalizeRequest>,
) -> impl IntoResponse {
    let finalize_payload = payload.clone();
    match state
        .app_state
        .mcp
        .store
        .finalize_local_compare_winner(payload)
        .await
    {
        Ok(response) => {
            if let Err(err) = sync_compare_finalize_memories(
                state.app_state.clone(),
                &finalize_payload,
                &response,
            )
            .await
            {
                log::warn!(
                    "compare finalize memory sync skipped for session {}: {}",
                    response.session_id,
                    err
                );
            }
            Json(response).into_response()
        }
        Err(err) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(LocalCompareFinalizeErrorResponse {
                code: "LOCAL_COMPARE_FINALIZE_FAILED",
                message: err.to_string(),
                source: "desktop",
            }),
        )
            .into_response(),
    }
}

async fn sync_compare_finalize_memories(
    app_state: AppState,
    payload: &LocalConversationCompareFinalizeRequest,
    response: &LocalConversationCompareFinalizeResponse,
) -> Result<(), String> {
    let deleted = clear_session_auto_extraction_memories(
        app_state.memory.service.as_ref(),
        &response.session_id,
    )
    .await?;

    let runtime_window = app_state
        .mcp
        .store
        .load_local_conversation_runtime_window(&response.session_id)
        .await
        .map_err(|err| err.to_string())?;

    let Some(provider_model_id) = resolve_finalize_provider_model_id(payload, response) else {
        log::warn!(
            "compare finalize fact rebuild skipped for session {}: provider_model_id missing",
            response.session_id
        );
        return Ok(());
    };

    let Some(conversation_text) = build_fact_rebuild_conversation_text(&runtime_window) else {
        log::warn!(
            "compare finalize fact rebuild skipped for session {}: empty canonical conversation",
            response.session_id
        );
        return Ok(());
    };

    log::info!(
        "compare finalize cleared {} auto-extracted memories for session {} before rebuilding facts",
        deleted,
        response.session_id
    );

    let fact_app_state = app_state.clone();
    let fact_memory_service = app_state.memory.service.clone();
    let fact_session_id = response.session_id.clone();
    let fact_assistant_id = runtime_window.assistant_id.clone();
    let fact_provider_model_id = provider_model_id;
    let fact_model_id = payload.model_id.clone();

    tauri::async_runtime::spawn(async move {
        crate::modules::memory::fact_extractor::extract_and_store_facts(
            &fact_app_state,
            fact_memory_service,
            &fact_provider_model_id,
            &fact_model_id,
            &conversation_text,
            &fact_session_id,
            fact_assistant_id.as_deref(),
        )
        .await;
    });

    Ok(())
}

async fn clear_session_auto_extraction_memories(
    memory_service: &MemoryService,
    session_id: &str,
) -> Result<usize, String> {
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Ok(0);
    }

    let mut deleted = 0usize;
    let mut cursor = None;
    loop {
        let page = memory_service
            .list(LocalMemoryListQuery {
                cursor: cursor.clone(),
                limit: Some(200),
                session_id: Some(normalized_session_id.to_string()),
                capability_id: None,
            })
            .await
            .map_err(|err| err.to_string())?;

        for item in &page.items {
            if !is_auto_extracted_memory(item) {
                continue;
            }
            let removed = memory_service
                .delete(&item.id)
                .await
                .map_err(|err| err.to_string())?;
            if removed {
                deleted += 1;
            }
        }

        if !page.has_more {
            break;
        }
        cursor = page.next_cursor;
    }

    Ok(deleted)
}

fn is_auto_extracted_memory(item: &LocalMemoryItem) -> bool {
    item.source
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("auto_extraction"))
        .unwrap_or(false)
        || item
            .meta_info
            .as_ref()
            .and_then(|value| value.get("source"))
            .and_then(|value| value.as_str())
            .map(|value| value.eq_ignore_ascii_case("auto_extraction"))
            .unwrap_or(false)
}

fn resolve_finalize_provider_model_id(
    payload: &LocalConversationCompareFinalizeRequest,
    response: &LocalConversationCompareFinalizeResponse,
) -> Option<String> {
    normalize_optional_string(payload.provider_model_id.as_deref()).or_else(|| {
        response
            .message
            .meta_info
            .as_ref()
            .and_then(|value| value.get("provider_model_id"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn build_fact_rebuild_conversation_text(
    runtime_window: &LocalConversationRuntimeWindow,
) -> Option<String> {
    let mut sections = Vec::new();
    if let Some(summary_text) = extract_summary_text(runtime_window.summary.as_ref()) {
        sections.push(format!("Summary: {}", summary_text));
    }

    for message in &runtime_window.messages {
        let Some(content) = history_message_text(message.content.as_ref()) else {
            continue;
        };
        let role = match message.role.trim().to_ascii_lowercase().as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            "system" => "System",
            _ => "Message",
        };
        sections.push(format!("{}: {}", role, content));
    }

    let conversation = sections.join("\n").trim().to_string();
    if conversation.is_empty() {
        None
    } else {
        Some(conversation)
    }
}

fn extract_summary_text(summary: Option<&Value>) -> Option<String> {
    summary
        .and_then(|value| value.get("summary_text"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn history_message_text(content: Option<&Value>) -> Option<String> {
    content
        .and_then(|value| {
            if let Some(text) = value.as_str() {
                Some(text.to_string())
            } else {
                serde_json::to_string(value).ok()
            }
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn map_request_to_orchestrator_input(
    payload: LocalChatCompletionRequest,
) -> Result<LocalOrchestratorInput, String> {
    let selected_knowledge_file_ids =
        extract_selected_knowledge_file_ids(payload.metadata.as_ref());
    let session_id = normalize_optional_string(payload.session_id.as_deref())
        .ok_or_else(|| "session_id is required for desktop local chat".to_string())?;
    let stream = payload.stream.unwrap_or(true);
    let status_stream = payload.status_stream.unwrap_or(true);

    let user_content =
        if payload.regenerate.unwrap_or(false) || payload.compare_only.unwrap_or(false) {
            None
        } else {
            extract_user_text_from_messages(&payload.messages)
        };

    Ok(LocalOrchestratorInput {
        model: payload.model,
        provider_model_id: normalize_optional_string(payload.provider_model_id.as_deref()),
        session_id,
        capability_id: normalize_optional_string(payload.assistant_id.as_deref()),
        regenerate: payload.regenerate.unwrap_or(false),
        compare_only: payload.compare_only.unwrap_or(false),
        user_content,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
        request_id: normalize_optional_string(payload.request_id.as_deref()),
        stream,
        status_stream,
        selected_knowledge_file_ids,
    })
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn extract_selected_knowledge_file_ids(metadata: Option<&Value>) -> Vec<String> {
    let mut ids = Vec::new();
    let Some(metadata) = metadata else {
        return ids;
    };

    let from_knowledge = metadata
        .get("knowledge")
        .and_then(|value| value.get("doc_ids"))
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for value in from_knowledge {
        let normalized = value.trim();
        if normalized.is_empty() || ids.iter().any(|existing| existing == normalized) {
            continue;
        }
        ids.push(normalized.to_string());
    }

    let fallback = metadata
        .get("selected_doc_ids")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for value in fallback {
        let normalized = value.trim();
        if normalized.is_empty() || ids.iter().any(|existing| existing == normalized) {
            continue;
        }
        ids.push(normalized.to_string());
    }

    ids
}

fn build_stream_error_payload(
    error_code: &str,
    message: impl Into<String>,
    trace_id: &str,
    request_id: Option<&str>,
) -> Value {
    json!({
        "type": "error",
        "message": message.into(),
        "error_code": error_code,
        "source": "desktop",
        "trace_id": trace_id,
        "request_id": normalize_optional_string(request_id),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_fact_rebuild_conversation_text, build_stream_error_payload,
        clear_session_auto_extraction_memories,
    };
    use crate::modules::mcp::store::LocalConversationRuntimeWindow;
    use crate::modules::mcp::types::LocalConversationHistoryMessage;
    use crate::modules::memory::types::{CreateLocalMemoryRequest, LocalMemoryListQuery};
    use serde_json::json;
    use uuid::Uuid;

    async fn create_test_memory_state(test_name: &str) -> crate::modules::memory::MemoryState {
        let mut lancedb_path = std::env::temp_dir();
        lancedb_path.push(format!(
            "deeting-tauri-gateway-lancedb-{test_name}-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&lancedb_path).expect("create lancedb dir");
        let lancedb_uri = lancedb_path.to_string_lossy().replace('\\', "/");
        crate::modules::memory::MemoryState::new(&lancedb_uri)
            .await
            .expect("create test memory state")
    }

    #[tokio::test]
    async fn clear_session_auto_extraction_memories_pages_and_preserves_manual_rows() {
        let memory_state = create_test_memory_state("compare-finalize-cleanup").await;
        let session_id = "session-compare-finalize";

        for index in 0..35 {
            memory_state
                .service
                .append(CreateLocalMemoryRequest {
                    content: format!("auto fact {index}"),
                    session_id: Some(session_id.to_string()),
                    capability_id: None,
                    meta_info: Some(json!({ "source": "auto_extraction" })),
                    category: Some("fact".to_string()),
                    source: Some("auto_extraction".to_string()),
                    tags: None,
                })
                .await
                .expect("append auto-extracted memory");
        }

        for index in 0..2 {
            memory_state
                .service
                .append(CreateLocalMemoryRequest {
                    content: format!("manual note {index}"),
                    session_id: Some(session_id.to_string()),
                    capability_id: None,
                    meta_info: Some(json!({ "source": "manual" })),
                    category: Some("note".to_string()),
                    source: Some("manual".to_string()),
                    tags: None,
                })
                .await
                .expect("append manual memory");
        }

        let deleted =
            clear_session_auto_extraction_memories(memory_state.service.as_ref(), session_id)
                .await
                .expect("clear auto-extracted memories");

        assert_eq!(deleted, 35);

        let remaining = memory_state
            .service
            .list(LocalMemoryListQuery {
                cursor: None,
                limit: Some(100),
                session_id: Some(session_id.to_string()),
                capability_id: None,
            })
            .await
            .expect("list remaining memories");

        assert_eq!(remaining.items.len(), 2);
        assert!(remaining
            .items
            .iter()
            .all(|item| item.source.as_deref() == Some("manual")));
    }

    #[test]
    fn build_fact_rebuild_conversation_text_uses_summary_and_canonical_messages() {
        let runtime_window = LocalConversationRuntimeWindow {
            session_id: "session-1".to_string(),
            assistant_id: Some("assistant-1".to_string()),
            meta: None,
            summary: Some(json!({ "summary_text": "User is building desktop compare mode." })),
            messages: vec![
                LocalConversationHistoryMessage {
                    role: "user".to_string(),
                    content: Some(json!("Please compare these answers.")),
                    turn_index: Some(1),
                    created_at: None,
                    is_truncated: Some(false),
                    name: None,
                    meta_info: None,
                },
                LocalConversationHistoryMessage {
                    role: "assistant".to_string(),
                    content: Some(json!("Winner answer kept in canonical history.")),
                    turn_index: Some(2),
                    created_at: None,
                    is_truncated: Some(false),
                    name: None,
                    meta_info: None,
                },
            ],
        };

        let conversation = build_fact_rebuild_conversation_text(&runtime_window)
            .expect("build fact rebuild conversation");

        assert!(conversation.contains("Summary: User is building desktop compare mode."));
        assert!(conversation.contains("User: Please compare these answers."));
        assert!(conversation.contains("Assistant: Winner answer kept in canonical history."));
    }

    #[test]
    fn build_stream_error_payload_uses_typed_error_event_shape() {
        let payload = build_stream_error_payload(
            "LOCAL_CHAT_FAILED",
            "upstream exploded with full body",
            "trace-123",
            Some("request-456"),
        );

        assert_eq!(
            payload.get("type").and_then(|value| value.as_str()),
            Some("error")
        );
        assert_eq!(
            payload.get("message").and_then(|value| value.as_str()),
            Some("upstream exploded with full body")
        );
        assert_eq!(
            payload.get("error_code").and_then(|value| value.as_str()),
            Some("LOCAL_CHAT_FAILED")
        );
        assert_eq!(
            payload.get("trace_id").and_then(|value| value.as_str()),
            Some("trace-123")
        );
        assert_eq!(
            payload.get("request_id").and_then(|value| value.as_str()),
            Some("request-456")
        );
        assert_eq!(
            payload.get("source").and_then(|value| value.as_str()),
            Some("desktop")
        );
        assert_eq!(payload.get("code").and_then(|value| value.as_str()), None);
    }

    #[test]
    fn build_stream_error_payload_keeps_request_id_key_when_missing() {
        let payload = build_stream_error_payload(
            "LOCAL_BAD_REQUEST",
            "session_id is required for desktop local chat",
            "trace-999",
            None,
        );

        assert!(payload.get("request_id").is_some());
        assert!(payload
            .get("request_id")
            .is_some_and(|value| value.is_null()));
    }
}
