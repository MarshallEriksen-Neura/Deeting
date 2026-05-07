use std::convert::Infallible;
use std::sync::{OnceLock, RwLock};

use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{extract::State, Json, Router};
use mcp_core::types::LocalChatInputMessage;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

use crate::modules::ai_access::commands::resolve_gateway_config;
use crate::modules::desktop_runtime::local_orchestrator::{
    execute_local_orchestrated_chat, LocalOrchestratorInput,
};
use crate::state::AppState;

const ENGINE_MODEL_ID: &str = "deeting-auto";

#[derive(Clone)]
struct CompatibleGatewayState {
    app_state: AppState,
    app_handle: AppHandle,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatCompletionRequest {
    model: String,
    messages: Vec<OpenAiChatMessage>,
    #[serde(default)]
    stream: Option<bool>,
    #[serde(default)]
    temperature: Option<f32>,
    #[serde(default)]
    max_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatMessage {
    role: String,
    content: Option<Value>,
    #[serde(default)]
    name: Option<String>,
}

static BASE_URL: OnceLock<RwLock<Option<String>>> = OnceLock::new();
static SHUTDOWN_TX: OnceLock<RwLock<Option<oneshot::Sender<()>>>> = OnceLock::new();

fn base_url_slot() -> &'static RwLock<Option<String>> {
    BASE_URL.get_or_init(|| RwLock::new(None))
}

pub fn current_base_url() -> Option<String> {
    base_url_slot().read().ok().and_then(|guard| guard.clone())
}

fn set_current_base_url(value: Option<String>) {
    if let Ok(mut guard) = base_url_slot().write() {
        *guard = value;
    }
}

fn shutdown_slot() -> &'static RwLock<Option<oneshot::Sender<()>>> {
    SHUTDOWN_TX.get_or_init(|| RwLock::new(None))
}

pub fn stop_gateway() {
    if let Ok(mut guard) = shutdown_slot().write() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }
    set_current_base_url(None);
}

pub fn spawn_if_enabled(app_state: AppState, app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        match start_if_enabled(app_state, app_handle).await {
            Ok(Some(url)) => log::info!("local AI access gateway started at {}", url),
            Ok(None) => log::info!("local AI access gateway disabled"),
            Err(err) => log::warn!("local AI access gateway startup skipped: {}", err),
        }
    });
}

pub async fn start_enabled_gateway(
    app_state: AppState,
    app_handle: AppHandle,
) -> Result<Option<String>, String> {
    start_if_enabled(app_state, app_handle).await
}

async fn start_if_enabled(
    app_state: AppState,
    app_handle: AppHandle,
) -> Result<Option<String>, String> {
    let config = resolve_gateway_config(&app_state).await?;
    if !config.enabled {
        stop_gateway();
        return Ok(None);
    }
    if let Some(url) = current_base_url() {
        return Ok(Some(url));
    }
    let host = match config.host.as_str() {
        "localhost" => "127.0.0.1",
        "127.0.0.1" => "127.0.0.1",
        _ => return Err("local AI access gateway only supports localhost binding".to_string()),
    };
    let state = CompatibleGatewayState {
        app_state,
        app_handle,
    };
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/v1/models", get(models_handler))
        .route("/v1/chat/completions", post(chat_completions_handler))
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]),
        );
    let listener = TcpListener::bind((host, config.port))
        .await
        .map_err(|err| format!("failed to bind local AI access gateway: {err}"))?;
    let addr = listener
        .local_addr()
        .map_err(|err| format!("failed to read local AI access gateway addr: {err}"))?;
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    if let Ok(mut guard) = shutdown_slot().write() {
        *guard = Some(shutdown_tx);
    }
    let base_url = format!("http://{}:{}/v1", host, addr.port());
    set_current_base_url(Some(base_url.clone()));
    tauri::async_runtime::spawn(async move {
        let server = axum::serve(listener, app).with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        });
        if let Err(err) = server.await {
            log::error!("local AI access gateway crashed: {}", err);
        }
        stop_gateway();
    });
    Ok(Some(base_url))
}

async fn health_handler() -> Json<Value> {
    Json(json!({ "status": "ok", "runtime": "deeting-engine" }))
}

async fn models_handler(
    State(state): State<CompatibleGatewayState>,
    headers: HeaderMap,
) -> Response {
    match authorize(&state.app_state, &headers).await {
        Ok(_) => Json(json!({
            "object": "list",
            "data": [{
                "id": ENGINE_MODEL_ID,
                "object": "model",
                "owned_by": "deeting-runtime"
            }]
        }))
        .into_response(),
        Err(response) => response,
    }
}

async fn chat_completions_handler(
    State(state): State<CompatibleGatewayState>,
    headers: HeaderMap,
    Json(payload): Json<OpenAiChatCompletionRequest>,
) -> Response {
    let key = match authorize(&state.app_state, &headers).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if !key.scopes.iter().any(|scope| scope == "engine:chat") {
        return openai_error(
            StatusCode::FORBIDDEN,
            "permission_denied",
            "API key is not allowed to access the Deeting chat engine",
        );
    }
    if payload.model.trim() != ENGINE_MODEL_ID {
        return openai_error(
            StatusCode::BAD_REQUEST,
            "model_not_found",
            "Only the Deeting runtime engine alias 'deeting-auto' is exposed",
        );
    }

    let messages = match normalize_messages(&payload.messages) {
        Ok(value) => value,
        Err(err) => return openai_error(StatusCode::BAD_REQUEST, "invalid_request_error", err),
    };
    let latest_user_text = messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.content.trim().to_string())
        .filter(|value| !value.is_empty());
    if latest_user_text.is_none() {
        return openai_error(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "messages must contain a non-empty user message",
        );
    }

    let secretary = match state
        .app_state
        .providers
        .store
        .get_or_create_user_secretary()
        .await
    {
        Ok(value) => value,
        Err(err) => {
            return openai_error(
                StatusCode::BAD_REQUEST,
                "engine_configuration_error",
                err.to_string(),
            )
        }
    };
    let model = secretary
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("gpt-4o-mini")
        .to_string();
    let request_id = Uuid::new_v4().to_string();
    let input = LocalOrchestratorInput {
        model,
        model_selection_mode: Some("pool".to_string()),
        provider_model_id: secretary
            .provider_model_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        explicit_task_agent_id: None,
        root_execution_id: None,
        generated_artifact_context: None,
        session_id: format!("api:{}:{}", key.id, request_id),
        capability_id: None,
        regenerate: false,
        compare_only: false,
        user_content: latest_user_text,
        provided_messages: Some(messages),
        persist_runtime_artifacts: false,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
        reasoning_enabled: None,
        reasoning_effort: None,
        terminal_context: None,
        request_id: Some(request_id),
        stream: false,
        status_stream: false,
        selected_knowledge_file_ids: Vec::new(),
        locale: None,
    };
    let trace_id = Uuid::new_v4().to_string();
    let response = match execute_local_orchestrated_chat(
        &state.app_handle,
        &state.app_state,
        input,
        trace_id,
        None,
    )
    .await
    {
        Ok(value) => openai_response_from_runtime(value, ENGINE_MODEL_ID),
        Err(err) => {
            return openai_error(StatusCode::BAD_REQUEST, "engine_error", err);
        }
    };

    if payload.stream.unwrap_or(false) {
        stream_openai_response(response)
    } else {
        Json(response).into_response()
    }
}

async fn authorize(
    app_state: &AppState,
    headers: &HeaderMap,
) -> Result<crate::modules::ai_access::types::VerifiedLocalAiAccessKey, Response> {
    let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    else {
        return Err(openai_error(
            StatusCode::UNAUTHORIZED,
            "invalid_api_key",
            "Missing Authorization bearer token",
        ));
    };
    let Some(secret) = value.trim().strip_prefix("Bearer ").map(str::trim) else {
        return Err(openai_error(
            StatusCode::UNAUTHORIZED,
            "invalid_api_key",
            "Authorization must use Bearer token",
        ));
    };
    match app_state.mcp.store.verify_local_ai_access_key(secret).await {
        Ok(Some(key)) => Ok(key),
        Ok(None) => Err(openai_error(
            StatusCode::UNAUTHORIZED,
            "invalid_api_key",
            "Invalid local Deeting AI access key",
        )),
        Err(err) => Err(openai_error(
            StatusCode::BAD_REQUEST,
            "engine_configuration_error",
            err.to_string(),
        )),
    }
}

fn normalize_messages(
    messages: &[OpenAiChatMessage],
) -> Result<Vec<LocalChatInputMessage>, String> {
    let mut output = Vec::new();
    for message in messages {
        let role = message.role.trim().to_ascii_lowercase();
        if !matches!(role.as_str(), "system" | "user" | "assistant" | "tool") {
            continue;
        }
        let content = normalize_content(message.content.as_ref());
        if content.trim().is_empty() {
            continue;
        }
        output.push(LocalChatInputMessage {
            role,
            content,
            tool_calls: Vec::new(),
            tool_call_id: None,
            name: message.name.clone(),
        });
    }
    if output.is_empty() {
        return Err("messages must include at least one supported text message".to_string());
    }
    Ok(output)
}

fn normalize_content(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };
    if let Some(text) = content.as_str() {
        return text.trim().to_string();
    }
    if let Some(parts) = content.as_array() {
        let text = parts
            .iter()
            .filter_map(|part| {
                if part.get("type").and_then(Value::as_str) == Some("text") {
                    part.get("text").and_then(Value::as_str)
                } else {
                    None
                }
            })
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return text;
    }
    String::new()
}

fn openai_response_from_runtime(mut response: Value, exposed_model: &str) -> Value {
    if let Some(object) = response.as_object_mut() {
        object.insert("model".to_string(), json!(exposed_model));
        object.remove("session_id");
        object.remove("trace_id");
        object.remove("request_id");

        if let Some(choices) = object.get_mut("choices").and_then(Value::as_array_mut) {
            for choice in choices {
                let Some(choice_object) = choice.as_object_mut() else {
                    continue;
                };
                let Some(message) = choice_object.get_mut("message") else {
                    continue;
                };
                sanitize_openai_message(message);
            }
        }
    }
    response
}

fn sanitize_openai_message(message: &mut Value) {
    let Some(object) = message.as_object_mut() else {
        return;
    };
    let role = object
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("assistant")
        .to_string();
    let content = object
        .get("content")
        .cloned()
        .unwrap_or(Value::String(String::new()));
    object.clear();
    object.insert("role".to_string(), Value::String(role));
    object.insert("content".to_string(), content);
}

fn openai_error(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (
        status,
        Json(json!({
            "error": {
                "message": message.into(),
                "type": code,
                "code": code
            }
        })),
    )
        .into_response()
}

fn stream_openai_response(response: Value) -> Response {
    let content = response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let id = response
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("chatcmpl-deeting")
        .to_string();
    let created = response
        .get("created")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let stream = async_stream::stream! {
        let chunk = json!({
            "id": id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": ENGINE_MODEL_ID,
            "choices": [{
                "index": 0,
                "delta": { "content": content },
                "finish_reason": null
            }]
        });
        yield Ok::<Event, Infallible>(Event::default().data(chunk.to_string()));
        let done = json!({
            "id": id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": ENGINE_MODEL_ID,
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": "stop"
            }]
        });
        yield Ok::<Event, Infallible>(Event::default().data(done.to_string()));
        yield Ok::<Event, Infallible>(Event::default().data("[DONE]"));
    };
    Sse::new(stream).into_response()
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_content, normalize_messages, openai_response_from_runtime, OpenAiChatMessage,
    };
    use serde_json::json;

    #[test]
    fn normalize_content_extracts_openai_text_parts() {
        let value = json!([
            { "type": "text", "text": "hello" },
            { "type": "image_url", "image_url": { "url": "https://example.test/a.png" } },
            { "type": "text", "text": "world" }
        ]);
        assert_eq!(normalize_content(Some(&value)), "hello\nworld");
    }

    #[test]
    fn normalize_messages_keeps_supported_text_roles() {
        let messages = vec![OpenAiChatMessage {
            role: "user".to_string(),
            content: Some(json!("hi")),
            name: None,
        }];
        let normalized = normalize_messages(&messages).expect("normalized");
        assert_eq!(normalized[0].role, "user");
        assert_eq!(normalized[0].content, "hi");
    }

    #[test]
    fn openai_response_from_runtime_hides_runtime_and_provider_metadata() {
        let response = json!({
            "id": "chatcmpl-local-1",
            "object": "chat.completion",
            "created": 1,
            "model": "gpt-internal",
            "session_id": "api:key:req",
            "trace_id": "trace-1",
            "request_id": "req-1",
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": "ok",
                    "meta_info": {
                        "model_id": "gpt-internal",
                        "provider_model_id": "provider-model-secret",
                        "execution_graph": {}
                    }
                }
            }]
        });
        let sanitized = openai_response_from_runtime(response, "deeting-auto");

        assert_eq!(sanitized["model"], "deeting-auto");
        assert!(sanitized.get("session_id").is_none());
        assert!(sanitized.get("trace_id").is_none());
        assert!(sanitized.get("request_id").is_none());
        let message = &sanitized["choices"][0]["message"];
        assert_eq!(message["role"], "assistant");
        assert_eq!(message["content"], "ok");
        assert!(message.get("meta_info").is_none());
    }
}
