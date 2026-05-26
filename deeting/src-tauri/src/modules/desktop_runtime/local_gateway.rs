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
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, RwLock};
use tower_http::cors::{AllowOrigin, CorsLayer};
use uuid::Uuid;

use crate::modules::conversations::fact_sync::sync_compare_finalize_memories;
use crate::modules::desktop_runtime::local_orchestrator::{
    execute_local_orchestrated_chat, extract_user_text_from_messages, LocalOrchestratorInput,
};
use crate::modules::mcp::commands::tool_approval_impl::{
    approve_mcp_tool_payload, reject_mcp_tool_payload,
};
use crate::modules::workflow::types::{CompileResult, UpdateProposalRequest, WorkflowRunDetail};
use crate::state::AppState;
use mcp_session::conversation::LocalConversationCompareFinalizeRequest;
use mcp_transport::gateway::{
    build_stream_error_payload, extract_generated_artifact_context, extract_root_execution_id,
    extract_selected_knowledge_file_ids, normalize_optional_string, GatewayHealthResponse,
    LocalChatCancelResponse, LocalChatCompletionRequest, LocalCompareFinalizeErrorResponse,
};

pub struct LocalGatewayState {
    pub app_state: AppState,
    pub app_handle: AppHandle,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct LocalToolApprovalRequest {
    #[serde(default, alias = "approvalToken")]
    approval_token: Option<String>,
    #[serde(default, alias = "approvalMode")]
    approval_mode: Option<String>,
    #[serde(default, alias = "callId")]
    call_id: Option<String>,
    #[serde(default, alias = "executionToken")]
    execution_token: Option<String>,
    #[serde(default, alias = "executionGraphExecutionId")]
    execution_graph_execution_id: Option<String>,
    #[serde(default)]
    stream: Option<bool>,
    #[serde(default, alias = "statusStream")]
    status_stream: Option<bool>,
    #[serde(default, alias = "requestId")]
    request_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct LocalToolRejectRequest {
    #[serde(default, alias = "approvalToken")]
    approval_token: Option<String>,
    #[serde(default, alias = "executionGraphExecutionId")]
    execution_graph_execution_id: Option<String>,
    #[serde(default, alias = "rejectMode")]
    reject_mode: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct LocalWorkflowCompileAndStartRequest {
    #[serde(default, alias = "proposalText")]
    proposal_text: Option<String>,
    #[serde(default, alias = "proposalDirty")]
    proposal_dirty: Option<bool>,
    #[serde(default, alias = "requestId")]
    request_id: Option<String>,
    #[serde(default, alias = "executionModelId")]
    execution_model_id: Option<String>,
    #[serde(default, alias = "executionProviderModelId")]
    execution_provider_model_id: Option<String>,
}

fn build_approval_status_payload(trace_id: &str, request_id: Option<&str>) -> serde_json::Value {
    json!({
        "type": "status",
        "stage": "approval",
        "code": "approval.executing",
        "trace_id": trace_id,
        "request_id": normalize_optional_string(request_id),
    })
}

fn build_blocks_stream_payload(
    blocks: &[serde_json::Value],
    trace_id: &str,
    request_id: Option<&str>,
) -> serde_json::Value {
    json!({
        "type": "blocks",
        "blocks": blocks,
        "trace_id": trace_id,
        "request_id": normalize_optional_string(request_id),
    })
}

#[derive(Clone)]
pub struct LocalGatewayServer {
    pub base_url: Arc<RwLock<Option<String>>>,
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
            base_url: Arc::new(RwLock::new(None)),
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
                "/v1/workflows/:run_id/compile-and-start",
                post(workflow_compile_and_start_handler),
            )
            .route("/v1/mcp/tool-approvals/approve", post(approve_tool_handler))
            .route("/v1/mcp/tool-approvals/reject", post(reject_tool_handler))
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

async fn workflow_compile_and_start_handler(
    Path(run_id): Path<String>,
    State(state): State<Arc<LocalGatewayState>>,
    Json(payload): Json<LocalWorkflowCompileAndStartRequest>,
) -> Sse<impl futures_util::stream::Stream<Item = Result<Event, Infallible>>> {
    let trace_id = Uuid::new_v4().to_string();
    let request_id = normalize_optional_string(payload.request_id.as_deref());
    let normalized_run_id = run_id.trim().to_string();
    let (tx, mut rx) = mpsc::unbounded_channel::<serde_json::Value>();

    tokio::spawn(async move {
        let finish = |tx: &mpsc::UnboundedSender<serde_json::Value>| {
            let _ = tx.send(serde_json::Value::String("[DONE]".to_string()));
        };

        if normalized_run_id.is_empty() {
            let _ = tx.send(build_stream_error_payload(
                "LOCAL_BAD_REQUEST",
                "run_id is required",
                &trace_id,
                request_id.as_deref(),
            ));
            finish(&tx);
            return;
        }

        let _ = tx.send(json!({
            "type": "workflow.compile_started",
            "run_id": normalized_run_id,
            "trace_id": trace_id,
            "request_id": request_id,
        }));

        let proposal_with_execution_model = payload.proposal_text.as_ref().map(|proposal_text| {
            crate::modules::workflow::service::apply_execution_model_to_default_worker_refs(
                proposal_text.clone(),
                payload.execution_model_id.as_deref(),
                payload.execution_provider_model_id.as_deref(),
            )
        });
        let proposal_changed_by_execution_model = match (
            payload.proposal_text.as_deref(),
            proposal_with_execution_model.as_deref(),
        ) {
            (Some(original), Some(updated)) => original != updated,
            _ => false,
        };

        if payload.proposal_dirty.unwrap_or(false) || proposal_changed_by_execution_model {
            match normalize_optional_string(payload.proposal_text.as_deref()) {
                Some(_) => {
                    let proposal_text = proposal_with_execution_model
                        .clone()
                        .unwrap_or_else(|| payload.proposal_text.clone().unwrap_or_default());
                    let update = UpdateProposalRequest {
                        run_id: normalized_run_id.clone(),
                        proposal_text,
                    };
                    if let Err(err) = crate::modules::workflow::service::update_proposal_workflow(
                        state.app_state.mcp.store.as_ref(),
                        state.app_handle.path().app_data_dir().ok(),
                        update,
                    )
                    .await
                    {
                        let _ = tx.send(build_stream_error_payload(
                            "LOCAL_WORKFLOW_UPDATE_FAILED",
                            err,
                            &trace_id,
                            request_id.as_deref(),
                        ));
                        finish(&tx);
                        return;
                    }
                }
                None => {
                    let _ = tx.send(build_stream_error_payload(
                        "LOCAL_BAD_REQUEST",
                        "proposal_text is required when proposal_dirty is true",
                        &trace_id,
                        request_id.as_deref(),
                    ));
                    finish(&tx);
                    return;
                }
            }
        }

        let compile_result = crate::modules::workflow::service::compile_current_proposal(
            state.app_state.mcp.store.as_ref(),
            state.app_handle.path().app_data_dir().ok(),
            &normalized_run_id,
        )
        .await;

        let compile_result = match compile_result {
            Ok(result) => result,
            Err(err) => {
                let _ = tx.send(build_stream_error_payload(
                    "LOCAL_WORKFLOW_COMPILE_FAILED",
                    err,
                    &trace_id,
                    request_id.as_deref(),
                ));
                finish(&tx);
                return;
            }
        };

        let _ = tx.send(build_workflow_compile_result_payload(&compile_result));
        if !compile_result.errors.is_empty() {
            finish(&tx);
            return;
        }

        match crate::modules::workflow::service::get_workflow_run_status(
            &state.app_state,
            &normalized_run_id,
        )
        .await
        {
            Ok(detail) => {
                let _ = tx.send(build_workflow_detail_payload("workflow.ready", detail));
            }
            Err(err) => {
                let _ = tx.send(build_stream_error_payload(
                    "LOCAL_WORKFLOW_STATUS_FAILED",
                    err,
                    &trace_id,
                    request_id.as_deref(),
                ));
            }
        }

        let run_result = crate::modules::workflow::service::start_workflow_run_with_stream(
            &state.app_handle,
            &state.app_state,
            &normalized_run_id,
            tx.clone(),
        )
        .await;

        match run_result {
            Ok(_) => {
                if let Ok(detail) = crate::modules::workflow::service::get_workflow_run_status(
                    &state.app_state,
                    &normalized_run_id,
                )
                .await
                {
                    let _ = tx.send(build_workflow_detail_payload(
                        "workflow.final_detail",
                        detail,
                    ));
                }
            }
            Err(err) => {
                let _ = tx.send(build_stream_error_payload(
                    "LOCAL_WORKFLOW_RUN_FAILED",
                    err,
                    &trace_id,
                    request_id.as_deref(),
                ));
            }
        }

        finish(&tx);
    });

    let stream = async_stream::stream! {
        while let Some(payload) = rx.recv().await {
            let is_done = payload.as_str() == Some("[DONE]");
            yield Ok(Event::default().data(payload.to_string()));
            if is_done {
                break;
            }
        }
    };

    Sse::new(stream)
}

fn build_workflow_compile_result_payload(result: &CompileResult) -> serde_json::Value {
    json!({
        "type": "workflow.compile_result",
        "compile_result": result,
    })
}

fn build_workflow_detail_payload(event_type: &str, detail: WorkflowRunDetail) -> serde_json::Value {
    json!({
        "type": event_type,
        "detail": detail,
    })
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
            let task = tokio::spawn(async move {
                execute_local_orchestrated_chat(
                    &worker_state.app_handle,
                    &worker_state.app_state,
                    input,
                    worker_trace_id,
                    Some(tx_clone),
                )
                .await
            });

            {
                let mut tasks = run_state
                    .app_state
                    .mcp
                    .approvals
                    .local_chat_tasks
                    .write()
                    .await;
                tasks.insert(request_id_value.clone(), task.abort_handle());
            }

            let join_result = task.await;
            {
                let mut tasks = run_state
                    .app_state
                    .mcp
                    .approvals
                    .local_chat_tasks
                    .write()
                    .await;
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

async fn approve_tool_handler(
    State(state): State<Arc<LocalGatewayState>>,
    Json(payload): Json<LocalToolApprovalRequest>,
) -> Response {
    let stream_enabled = payload.stream.unwrap_or(true);
    let status_stream_enabled = payload.status_stream.unwrap_or(true);
    if stream_enabled || status_stream_enabled {
        return stream_approve_tool(state, payload).await.into_response();
    }

    let trace_id = Uuid::new_v4().to_string();
    let approval_token = match normalize_optional_string(payload.approval_token.as_deref()) {
        Some(value) => value,
        None => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({
                    "code": "LOCAL_BAD_REQUEST",
                    "message": "approval_token is required",
                    "source": "desktop",
                    "trace_id": trace_id,
                })),
            )
                .into_response();
        }
    };

    match approve_mcp_tool_payload(
        &state.app_handle,
        &state.app_state,
        &approval_token,
        normalize_optional_string(payload.execution_graph_execution_id.as_deref()).as_deref(),
        normalize_optional_string(payload.approval_mode.as_deref()).as_deref(),
        normalize_optional_string(payload.call_id.as_deref()).as_deref(),
        normalize_optional_string(payload.execution_token.as_deref()).as_deref(),
    )
    .await
    {
        Ok(response_body) => Json(response_body).into_response(),
        Err(err) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "code": "LOCAL_TOOL_APPROVAL_FAILED",
                "message": err,
                "source": "desktop",
                "trace_id": trace_id,
            })),
        )
            .into_response(),
    }
}

async fn stream_approve_tool(
    state: Arc<LocalGatewayState>,
    payload: LocalToolApprovalRequest,
) -> Sse<impl futures_util::stream::Stream<Item = Result<Event, Infallible>>> {
    let trace_id = Uuid::new_v4().to_string();
    let request_id = normalize_optional_string(payload.request_id.as_deref());
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    tokio::spawn(async move {
        let approval_token = match normalize_optional_string(payload.approval_token.as_deref()) {
            Some(value) => value,
            None => {
                let _ = tx.send(
                    build_stream_error_payload(
                        "LOCAL_BAD_REQUEST",
                        "approval_token is required",
                        &trace_id,
                        request_id.as_deref(),
                    )
                    .to_string(),
                );
                let _ = tx.send("[DONE]".to_string());
                return;
            }
        };

        if payload.status_stream.unwrap_or(true) {
            let _ = tx
                .send(build_approval_status_payload(&trace_id, request_id.as_deref()).to_string());
        }

        match approve_mcp_tool_payload(
            &state.app_handle,
            &state.app_state,
            &approval_token,
            normalize_optional_string(payload.execution_graph_execution_id.as_deref()).as_deref(),
            normalize_optional_string(payload.approval_mode.as_deref()).as_deref(),
            normalize_optional_string(payload.call_id.as_deref()).as_deref(),
            normalize_optional_string(payload.execution_token.as_deref()).as_deref(),
        )
        .await
        {
            Ok(response_body) => {
                if let Some(blocks) = response_body
                    .get("continuation_blocks")
                    .and_then(|value| value.as_array())
                    .filter(|items| !items.is_empty())
                {
                    let _ = tx.send(
                        build_blocks_stream_payload(blocks, &trace_id, request_id.as_deref())
                            .to_string(),
                    );
                }
                let _ = tx.send(response_body.to_string());
            }
            Err(err) => {
                let _ = tx.send(
                    build_stream_error_payload(
                        "LOCAL_TOOL_APPROVAL_FAILED",
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

async fn reject_tool_handler(
    State(state): State<Arc<LocalGatewayState>>,
    Json(payload): Json<LocalToolRejectRequest>,
) -> Response {
    let trace_id = Uuid::new_v4().to_string();
    let approval_token = match normalize_optional_string(payload.approval_token.as_deref()) {
        Some(value) => value,
        None => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({
                    "code": "LOCAL_BAD_REQUEST",
                    "message": "approval_token is required",
                    "source": "desktop",
                    "trace_id": trace_id,
                })),
            )
                .into_response();
        }
    };

    match reject_mcp_tool_payload(
        &state.app_state,
        &approval_token,
        normalize_optional_string(payload.execution_graph_execution_id.as_deref()).as_deref(),
        normalize_optional_string(payload.reject_mode.as_deref()).as_deref(),
    )
    .await
    {
        Ok(response_body) => Json(response_body).into_response(),
        Err(err) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "code": "LOCAL_TOOL_REJECT_FAILED",
                "message": err,
                "source": "desktop",
                "trace_id": trace_id,
            })),
        )
            .into_response(),
    }
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
        .approvals
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
                    "compare finalize fact sync failed session={} err={}",
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

fn map_request_to_orchestrator_input(
    payload: LocalChatCompletionRequest,
) -> Result<LocalOrchestratorInput, String> {
    let selected_knowledge_file_ids =
        extract_selected_knowledge_file_ids(payload.metadata.as_ref());
    let root_execution_id = extract_root_execution_id(payload.metadata.as_ref());
    let generated_artifact_context = extract_generated_artifact_context(payload.metadata.as_ref());
    let user_interruption = extract_user_interruption(payload.metadata.as_ref());
    let terminal_context = payload
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("terminal_context"))
        .cloned();
    let workflow_context = payload
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("workflow_context"))
        .cloned();
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
        model_selection_mode: normalize_optional_string(payload.model_selection_mode.as_deref()),
        provider_model_id: normalize_optional_string(payload.provider_model_id.as_deref()),
        explicit_task_agent_id: normalize_optional_string(
            payload.explicit_task_agent_id.as_deref(),
        ),
        root_execution_id,
        task_input_source: None,
        user_interruption,
        generated_artifact_context,
        session_id,
        capability_id: normalize_optional_string(payload.assistant_id.as_deref()),
        regenerate: payload.regenerate.unwrap_or(false),
        compare_only: payload.compare_only.unwrap_or(false),
        user_content,
        provided_messages: None,
        persist_runtime_artifacts: true,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
        reasoning_enabled: payload.reasoning_enabled,
        reasoning_effort: normalize_optional_string(payload.reasoning_effort.as_deref()),
        terminal_context,
        workflow_context,
        request_id: normalize_optional_string(payload.request_id.as_deref()),
        stream,
        status_stream,
        selected_knowledge_file_ids,
        locale: normalize_optional_string(payload.locale.as_deref()),
    })
}

fn extract_user_interruption(
    metadata: Option<&serde_json::Value>,
) -> Option<desktop_runtime_core::UserInterruption> {
    let value = metadata.and_then(|metadata| {
        metadata
            .get("user_interruption")
            .or_else(|| metadata.get("interruption"))
    })?;
    let content = value
        .get("content")
        .or_else(|| value.get("message"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let interruption_id = value
        .get("interruption_id")
        .or_else(|| value.get("id"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("chat-interruption:{}", uuid::Uuid::new_v4()));
    Some(desktop_runtime_core::UserInterruption {
        interruption_id,
        content,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_approval_status_payload, build_stream_error_payload, LocalToolApprovalRequest,
        LocalToolRejectRequest,
    };
    use serde_json::json;

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

    #[test]
    fn build_approval_status_payload_uses_typed_status_event_shape() {
        let payload = build_approval_status_payload("trace-approval-1", Some("request-approval-1"));

        assert_eq!(
            payload.get("type").and_then(|value| value.as_str()),
            Some("status")
        );
        assert_eq!(
            payload.get("stage").and_then(|value| value.as_str()),
            Some("approval")
        );
        assert_eq!(
            payload.get("code").and_then(|value| value.as_str()),
            Some("approval.executing")
        );
        assert_eq!(
            payload.get("trace_id").and_then(|value| value.as_str()),
            Some("trace-approval-1")
        );
        assert_eq!(
            payload.get("request_id").and_then(|value| value.as_str()),
            Some("request-approval-1")
        );
    }

    #[test]
    fn local_tool_approval_request_accepts_camel_case_fields() {
        let payload: LocalToolApprovalRequest = serde_json::from_value(json!({
            "approvalToken": "approval-1",
            "approvalMode": "allow_once",
            "callId": "call-1",
            "executionToken": "exec-1",
            "executionGraphExecutionId": "graph-1",
            "statusStream": true,
            "requestId": "request-1"
        }))
        .expect("approval request should deserialize");

        assert_eq!(payload.approval_token.as_deref(), Some("approval-1"));
        assert_eq!(payload.approval_mode.as_deref(), Some("allow_once"));
        assert_eq!(payload.call_id.as_deref(), Some("call-1"));
        assert_eq!(payload.execution_token.as_deref(), Some("exec-1"));
        assert_eq!(
            payload.execution_graph_execution_id.as_deref(),
            Some("graph-1")
        );
        assert_eq!(payload.status_stream, Some(true));
        assert_eq!(payload.request_id.as_deref(), Some("request-1"));
    }

    #[test]
    fn local_tool_reject_request_accepts_camel_case_fields() {
        let payload: LocalToolRejectRequest = serde_json::from_value(json!({
            "approvalToken": "approval-2",
            "executionGraphExecutionId": "graph-2",
            "rejectMode": "deny_always"
        }))
        .expect("reject request should deserialize");

        assert_eq!(payload.approval_token.as_deref(), Some("approval-2"));
        assert_eq!(
            payload.execution_graph_execution_id.as_deref(),
            Some("graph-2")
        );
        assert_eq!(payload.reject_mode.as_deref(), Some("deny_always"));
    }
}
