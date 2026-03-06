use std::convert::Infallible;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
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
use uuid::Uuid;

use crate::modules::mcp::local_orchestrator::{
    execute_local_orchestrated_chat, extract_user_text_from_messages, LocalOrchestratorInput,
};
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

pub struct LocalGatewayState {
    pub app_state: AppState,
    pub app_handle: AppHandle,
}

pub struct LocalGatewayServer {
    pub base_url: RwLock<Option<String>>,
}

impl LocalGatewayServer {
    pub fn new() -> Self {
        Self {
            base_url: RwLock::new(None),
        }
    }

    pub async fn start(&self, app_state: AppState, app_handle: AppHandle) -> Result<String, String> {
        let state = Arc::new(LocalGatewayState {
            app_state,
            app_handle,
        });

        let app = Router::new()
            .route("/health", get(health_handler))
            .route("/v1/chat/completions", post(chat_completions_handler))
            .route(
                "/v1/chat/completions/:request_id/cancel",
                post(cancel_chat_completions_handler),
            )
            .with_state(state);

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
                    json!({
                        "code": "LOCAL_BAD_REQUEST",
                        "message": err,
                        "source": "desktop",
                        "trace_id": trace_id,
                        "request_id": request_id,
                    })
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
                Err(err) if err.is_cancelled() => {
                    Err("local chat request cancelled".to_string())
                }
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
                    json!({
                        "code": "LOCAL_CHAT_FAILED",
                        "message": err,
                        "source": "desktop",
                        "trace_id": trace_id,
                        "request_id": request_id,
                    })
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

fn map_request_to_orchestrator_input(
    payload: LocalChatCompletionRequest,
) -> Result<LocalOrchestratorInput, String> {
    let session_id = normalize_optional_string(payload.session_id.as_deref())
        .ok_or_else(|| "session_id is required for desktop local chat".to_string())?;
    let stream = payload.stream.unwrap_or(true);
    let status_stream = payload.status_stream.unwrap_or(true);

    let user_content = if payload.regenerate.unwrap_or(false) {
        None
    } else {
        extract_user_text_from_messages(&payload.messages)
    };

    Ok(LocalOrchestratorInput {
        model: payload.model,
        provider_model_id: normalize_optional_string(payload.provider_model_id.as_deref()),
        session_id,
        assistant_id: normalize_optional_string(payload.assistant_id.as_deref()),
        regenerate: payload.regenerate.unwrap_or(false),
        user_content,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
        request_id: normalize_optional_string(payload.request_id.as_deref()),
        stream,
        status_stream,
    })
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}
