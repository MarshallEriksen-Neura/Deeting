use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use log::warn;
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::{expand_path, ExtractedToolFields, NewSource, ToolUpsert};
use crate::modules::mcp::types::{
    CreateAssistantMessageRequest, CreateConversationMessageRequest, CreateLocalAssistantRequest,
    CreateSourceRequest, ImportConfigRequest, LocalAdminConversationListResponse,
    LocalAdminConversationQuery, LocalAdminConversationSummaryListResponse, LocalAssistant,
    LocalAssistantEntity, LocalAssistantInstallCreateRequest, LocalAssistantInstallItem,
    LocalAssistantInstallPage, LocalAssistantInstallQuery, LocalAssistantInstallUpdateRequest,
    LocalAssistantMessage, LocalAssistantPreviewRequest, LocalAssistantRatingRequest,
    LocalAssistantRatingResponse, LocalAssistantRoutingFeedbackRequest,
    LocalAssistantRoutingReportQuery, LocalAssistantRoutingReportResponse,
    LocalAssistantRoutingState, LocalAssistantTag, LocalAssistantVersion, LocalChatInputMessage,
    LocalChatRequest, LocalChatResponse,
    LocalConversationArchiveResponse, LocalConversationClearResponse,
    LocalConversationCreateRequest, LocalConversationCreateResponse,
    LocalConversationDeleteResponse, LocalConversationHistoryMessage,
    LocalConversationHistoryQuery, LocalConversationHistoryResponse,
    LocalConversationRegenerateRequest, LocalConversationRegenerateResponse,
    LocalConversationRenameRequest, LocalConversationRenameResponse,
    LocalConversationSendRequest, LocalConversationSendResponse, LocalConversationSessionPage,
    LocalConversationSessionsQuery, LocalConversationStatus, LocalConversationWindowResponse,
    LocalGatewayLogListResponse, LocalGatewayLogQuery, LocalGatewayLogStatsResponse,
    LocalTraceFeedback, LocalTraceFeedbackRequest,
    McpConfigPayload, McpConflictStatus, McpLogEntry, McpSource, McpSourceStatus, McpSourceType,
    McpTool, McpToolConfigPayload, McpToolStatus, ResolveConflictRequest, SyncSourceRequest,
    UpdateLocalAssistantRequest, UpdateToolConfigRequest,
};
use crate::modules::providers::types::BanditFeedbackRequest;
use crate::modules::mcp::McpRuntimeState;
use crate::state::AppState;

const LOCAL_CONVERSATION_SUMMARY_PROMPT: &str = "Please summarize the multi-turn conversation below.\nRequirements:\n1) Keep user intent, key decisions, and conclusions.\n2) Remove redundancy.\n3) Keep the summary concise and actionable.\n4) Output summary text only.\n\nConversation:\n";
const LOCAL_CONVERSATION_SUMMARY_MAX_CHARS: usize = 2000;
const LOCAL_CONVERSATION_SUMMARY_FALLBACK_RECENT_MESSAGES: usize = 8;
const LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS: u64 = 2;
const LOCAL_CONVERSATION_SUMMARY_WORKER_RETRY_BASE_DELAY_SECS: i64 = 5;
const LOCAL_CONVERSATION_SUMMARY_WORKER_RETRY_MAX_DELAY_SECS: i64 = 300;
const LOCAL_PERIODIC_TASK_WORKER_IDLE_INTERVAL_SECS: u64 = 5;
const LOCAL_PERIODIC_TASK_SUMMARY_JOB_GC_NAME: &str = "conversation_summary_job_gc";
const LOCAL_PERIODIC_TASK_SUMMARY_JOB_GC_INTERVAL_SECS: i64 = 10 * 60;
const LOCAL_PERIODIC_TASK_SUMMARY_JOB_GC_INITIAL_DELAY_SECS: i64 = 120;
const LOCAL_PERIODIC_TASK_SUMMARY_JOB_GC_RETENTION_SECS: i64 = 7 * 24 * 60 * 60;
const LOCAL_PERIODIC_TASK_SUMMARY_IDLE_DISPATCH_NAME: &str = "conversation_summary_idle_dispatch";
const LOCAL_PERIODIC_TASK_SUMMARY_IDLE_DISPATCH_INTERVAL_SECS: i64 = 5;
const LOCAL_PERIODIC_TASK_SUMMARY_IDLE_DISPATCH_INITIAL_DELAY_SECS: i64 = 5;

#[derive(Debug, Deserialize)]
struct CloudToolSummary {
    id: String,
    identifier: String,
    name: String,
    description: String,
    avatar_url: Option<String>,
    category: Option<String>,
    tags: Option<Vec<String>>,
    author: Option<String>,
    is_official: Option<bool>,
    install_manifest: CloudInstallManifest,
}

#[derive(Debug, Deserialize)]
struct CloudInstallManifest {
    runtime: Option<String>,
    command: String,
    args: Vec<String>,
    env_config: Option<Vec<serde_json::Map<String, serde_json::Value>>>,
}

#[derive(Debug, Deserialize)]
struct CloudSubscriptionItem {
    id: String,
    market_tool_id: String,
    config_hash_snapshot: Option<String>,
    tool: CloudToolSummary,
}

#[derive(Debug, Clone)]
struct LocalModelConnection {
    provider_model_id: String,
    model_id: String,
    base_url: String,
    secret_key: Option<String>,
}

#[derive(Debug, Clone)]
struct TraceToolCall {
    name: String,
    success: bool,
}

#[tauri::command]
pub async fn set_cloud_base_url(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let state = &state.mcp;
    let mut base = state.cloud_base_url.write().await;
    *base = url;
    Ok(())
}

#[tauri::command]
pub async fn list_mcp_sources(state: State<'_, AppState>) -> Result<Vec<McpSource>, String> {
    let state = &state.mcp;
    state.store.list_sources().await.map_err(to_string)
}

#[tauri::command]
pub async fn create_mcp_source(
    state: State<'_, AppState>,
    payload: CreateSourceRequest,
) -> Result<McpSource, String> {
    let state = &state.mcp;
    let source = state
        .store
        .insert_source(NewSource {
            name: payload.name,
            source_type: payload.source_type,
            path_or_url: payload.path_or_url,
            trust_level: payload.trust_level,
            status: McpSourceStatus::Active,
            last_synced_at: None,
            is_read_only: payload.is_read_only.unwrap_or(false),
        })
        .await
        .map_err(to_string)?;
    Ok(source)
}

#[tauri::command]
pub async fn sync_mcp_source(
    state: State<'_, AppState>,
    source_id: String,
    payload: SyncSourceRequest,
) -> Result<Vec<McpTool>, String> {
    let state = &state.mcp;
    let source = state
        .store
        .get_source(&source_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| to_string(McpError::NotFound(format!("source {source_id} not found"))))?;

    state
        .store
        .update_source_status(&source_id, McpSourceStatus::Syncing, None)
        .await
        .map_err(to_string)?;

    let result = sync_source_inner(&state, source, payload.auth_token).await;
    match result {
        Ok(tools) => {
            state
                .store
                .update_source_status(&source_id, McpSourceStatus::Active, Some(now_rfc3339()))
                .await
                .map_err(to_string)?;
            Ok(tools)
        }
        Err(err) => {
            state
                .store
                .update_source_status(&source_id, McpSourceStatus::Error, None)
                .await
                .map_err(to_string)?;
            Err(to_string(err))
        }
    }
}

#[tauri::command]
pub async fn list_mcp_tools(state: State<'_, AppState>) -> Result<Vec<McpTool>, String> {
    let state = &state.mcp;
    state.store.list_tools().await.map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistants(
    state: State<'_, AppState>,
) -> Result<Vec<LocalAssistant>, String> {
    let state = &state.mcp;
    state.store.list_local_assistants().await.map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_entities(
    state: State<'_, AppState>,
) -> Result<Vec<LocalAssistantEntity>, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_assistant_entities()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_versions(
    state: State<'_, AppState>,
    assistant_id: Option<String>,
) -> Result<Vec<LocalAssistantVersion>, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_assistant_versions(assistant_id.as_deref())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_tags(
    state: State<'_, AppState>,
) -> Result<Vec<LocalAssistantTag>, String> {
    let state = &state.mcp;
    state.store.list_local_assistant_tags().await.map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_installs(
    state: State<'_, AppState>,
    query: Option<LocalAssistantInstallQuery>,
) -> Result<LocalAssistantInstallPage, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_assistant_installs(query.unwrap_or(LocalAssistantInstallQuery {
            cursor: None,
            size: None,
        }))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn install_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: Option<LocalAssistantInstallCreateRequest>,
) -> Result<LocalAssistantInstallItem, String> {
    let state = &state.mcp;
    state
        .store
        .install_local_assistant(
            &assistant_id,
            payload.unwrap_or(LocalAssistantInstallCreateRequest {
                follow_latest: None,
                pinned_version_id: None,
            }),
        )
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_local_assistant_install(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallUpdateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    let state = &state.mcp;
    state
        .store
        .update_local_assistant_install(&assistant_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn uninstall_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .uninstall_local_assistant(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn rate_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantRatingRequest,
) -> Result<LocalAssistantRatingResponse, String> {
    let state = &state.mcp;
    state
        .store
        .rate_local_assistant(&assistant_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn record_local_assistant_routing_trial(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<LocalAssistantRoutingState, String> {
    let state = &state.mcp;
    state
        .store
        .record_local_assistant_routing_trial(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn record_local_assistant_routing_feedback(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantRoutingFeedbackRequest,
) -> Result<LocalAssistantRoutingState, String> {
    let state = &state.mcp;
    state
        .store
        .record_local_assistant_routing_feedback(&assistant_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_assistant_routing_report(
    state: State<'_, AppState>,
    query: Option<LocalAssistantRoutingReportQuery>,
) -> Result<LocalAssistantRoutingReportResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_assistant_routing_report(query.unwrap_or(LocalAssistantRoutingReportQuery {
            min_trials: None,
            min_rating: None,
            limit: None,
            sort: None,
        }))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_trace_feedback(
    state: State<'_, AppState>,
    payload: LocalTraceFeedbackRequest,
) -> Result<LocalTraceFeedback, String> {
    let app_state = state.inner();
    let mcp_state = &app_state.mcp;
    let feedback = mcp_state
        .store
        .create_local_trace_feedback(payload)
        .await
        .map_err(to_string)?;

    let trace_meta = mcp_state
        .store
        .get_local_trace_feedback_meta_by_trace_id(&feedback.trace_id)
        .await
        .map_err(to_string)?;

    if let Some(meta) = trace_meta {
        if let Some(tool_calls) = extract_tool_calls_from_trace_meta(&meta) {
            process_trace_feedback_tool_calls(app_state, feedback.score, tool_calls).await;
        } else {
            process_trace_feedback_assistant_routing(mcp_state, feedback.score, &meta).await;
        }
    }

    Ok(feedback)
}

#[tauri::command]
pub async fn list_local_gateway_logs(
    state: State<'_, AppState>,
    query: Option<LocalGatewayLogQuery>,
) -> Result<LocalGatewayLogListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_gateway_logs(query.unwrap_or(LocalGatewayLogQuery {
            skip: None,
            limit: None,
            model: None,
            status_code: None,
            is_cached: None,
        }))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_gateway_log_stats(
    state: State<'_, AppState>,
    query: Option<LocalGatewayLogQuery>,
) -> Result<LocalGatewayLogStatsResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_gateway_log_stats(query.unwrap_or(LocalGatewayLogQuery {
            skip: None,
            limit: None,
            model: None,
            status_code: None,
            is_cached: None,
        }))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_admin_conversations(
    state: State<'_, AppState>,
    query: Option<LocalAdminConversationQuery>,
) -> Result<LocalAdminConversationListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_admin_conversations(query.unwrap_or(LocalAdminConversationQuery {
            skip: None,
            limit: None,
            status: None,
            channel: None,
        }))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_admin_conversation_summaries(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalAdminConversationSummaryListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_admin_conversation_summaries(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_assistant(
    state: State<'_, AppState>,
    payload: CreateLocalAssistantRequest,
) -> Result<String, String> {
    let state = &state.mcp;
    state
        .store
        .create_local_assistant(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_local_assistant(
    state: State<'_, AppState>,
    id: String,
    payload: UpdateLocalAssistantRequest,
) -> Result<LocalAssistant, String> {
    let state = &state.mcp;
    state
        .store
        .update_local_assistant(&id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_assistant(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .delete_local_assistant(&id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_assistant_messages(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<Vec<LocalAssistantMessage>, String> {
    let state = &state.mcp;
    state
        .store
        .list_assistant_messages(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn append_assistant_message(
    state: State<'_, AppState>,
    payload: CreateAssistantMessageRequest,
) -> Result<LocalAssistantMessage, String> {
    let state = &state.mcp;
    state
        .store
        .append_assistant_message(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn local_chat_complete(
    state: State<'_, AppState>,
    payload: LocalChatRequest,
) -> Result<LocalChatResponse, String> {
    run_local_chat_complete(&state.mcp, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn preview_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantPreviewRequest,
) -> Result<LocalChatResponse, String> {
    let app_state = state.inner();
    let mcp_state = &app_state.mcp;
    let normalized_assistant_id = assistant_id.trim().to_string();
    if normalized_assistant_id.is_empty() {
        return Err(to_string(McpError::validation("assistant_id is required")));
    }

    let message = payload.message.trim().to_string();
    if message.is_empty() {
        return Err(to_string(McpError::validation("message is required")));
    }

    let entities = mcp_state
        .store
        .list_local_assistant_entities()
        .await
        .map_err(to_string)?;
    let entity = entities
        .into_iter()
        .find(|item| item.id == normalized_assistant_id)
        .ok_or_else(|| to_string(McpError::NotFound("assistant not found".to_string())))?;

    let versions = mcp_state
        .store
        .list_local_assistant_versions(Some(&normalized_assistant_id))
        .await
        .map_err(to_string)?;
    if versions.is_empty() {
        return Err(to_string(McpError::Validation(
            "assistant version not found".to_string(),
        )));
    }
    let selected_version = entity
        .current_version_id
        .as_deref()
        .and_then(|version_id| versions.iter().find(|version| version.id == version_id))
        .or_else(|| versions.first())
        .ok_or_else(|| to_string(McpError::Validation("assistant version not found".to_string())))?;

    let mut messages = Vec::new();
    let system_prompt = selected_version.system_prompt.trim().to_string();
    if !system_prompt.is_empty() {
        messages.push(LocalChatInputMessage {
            role: "system".to_string(),
            content: system_prompt,
        });
    }
    messages.push(LocalChatInputMessage {
        role: "user".to_string(),
        content: message,
    });

    let model_connection = resolve_default_local_model_connection(app_state)
        .await
        .map_err(to_string)?;

    run_local_chat_complete(
        mcp_state,
        LocalChatRequest {
            assistant_id: None,
            model: model_connection.model_id,
            messages,
            temperature: payload.temperature,
            top_p: None,
            max_tokens: payload.max_tokens,
            base_url: Some(model_connection.base_url),
            api_key: model_connection.secret_key,
        },
    )
    .await
    .map_err(to_string)
}

#[tauri::command]
pub async fn delete_assistant_messages(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .delete_assistant_messages(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversations(
    state: State<'_, AppState>,
    query: Option<LocalConversationSessionsQuery>,
) -> Result<LocalConversationSessionPage, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_conversations(query.unwrap_or(LocalConversationSessionsQuery {
            cursor: None,
            size: None,
            assistant_id: None,
            status: Some(LocalConversationStatus::Active),
        }))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_conversation(
    state: State<'_, AppState>,
    payload: Option<LocalConversationCreateRequest>,
) -> Result<LocalConversationCreateResponse, String> {
    let state = &state.mcp;
    state
        .store
        .create_local_conversation(payload.unwrap_or(LocalConversationCreateRequest {
            assistant_id: None,
            title: None,
        }))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn archive_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    let state = &state.mcp;
    state
        .store
        .update_local_conversation_status(&session_id, LocalConversationStatus::Archived)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn unarchive_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    let state = &state.mcp;
    state
        .store
        .update_local_conversation_status(&session_id, LocalConversationStatus::Active)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn rename_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
    payload: LocalConversationRenameRequest,
) -> Result<LocalConversationRenameResponse, String> {
    let state = &state.mcp;
    state
        .store
        .rename_local_conversation(&session_id, payload.title)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversation_history(
    state: State<'_, AppState>,
    session_id: String,
    query: Option<LocalConversationHistoryQuery>,
) -> Result<LocalConversationHistoryResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_conversation_history(
            &session_id,
            query.unwrap_or(LocalConversationHistoryQuery {
                cursor: None,
                limit: None,
            }),
        )
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_conversation_window(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationWindowResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_conversation_window(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn append_local_conversation_message(
    state: State<'_, AppState>,
    payload: CreateConversationMessageRequest,
) -> Result<LocalConversationHistoryMessage, String> {
    let state = &state.mcp;
    let session_id = payload.session_id.clone();
    let message = state
        .store
        .append_local_conversation_message(payload)
        .await
        .map_err(to_string)?;

    if let Err(err) = state
        .store
        .touch_local_conversation_summary_idle_task(&session_id)
        .await
    {
        warn!(
            "failed to touch local conversation summary idle task for session {}: {}",
            session_id, err
        );
    }

    if let Err(err) = state
        .store
        .try_trigger_local_conversation_summary_flush(&session_id, "flush_threshold")
        .await
    {
        warn!(
            "failed to trigger local conversation summary flush for session {}: {}",
            session_id, err
        );
    }

    Ok(message)
}

#[tauri::command]
pub async fn delete_local_conversation_message(
    state: State<'_, AppState>,
    session_id: String,
    turn_index: i64,
) -> Result<LocalConversationDeleteResponse, String> {
    let state = &state.mcp;
    state
        .store
        .delete_local_conversation_message(&session_id, turn_index)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn clear_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationClearResponse, String> {
    let state = &state.mcp;
    state
        .store
        .clear_local_conversation(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn send_local_conversation_message(
    state: State<'_, AppState>,
    session_id: String,
    payload: LocalConversationSendRequest,
) -> Result<LocalConversationSendResponse, String> {
    let app_state = state.inner();
    let mcp_state = &app_state.mcp;
    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() {
        return Err(to_string(McpError::validation("session_id is required")));
    }

    if payload.content.trim().is_empty() {
        return Err(to_string(McpError::validation("content is required")));
    }

    let user_message = mcp_state
        .store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: normalized_session_id.clone(),
            role: "user".to_string(),
            content: payload.content,
            name: None,
            meta_info: None,
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map_err(to_string)?;

    let chat_ctx = mcp_state
        .store
        .get_local_conversation_chat_context(&normalized_session_id)
        .await
        .map_err(to_string)?;
    let chat_session_id = chat_ctx.session_id.clone();

    let model_connection = resolve_local_model_connection(
        app_state,
        &payload.model,
        payload.provider_model_id.as_deref(),
    )
    .await
    .map_err(to_string)?;
    let trace_id = Uuid::new_v4().to_string();
    let input_tokens_est = estimate_local_chat_messages_tokens(&chat_ctx.messages);
    let upstream_endpoint = build_chat_endpoint(&model_connection.base_url);

    let chat_started = Instant::now();
    let chat_result = run_local_chat_complete(
        mcp_state,
        LocalChatRequest {
            assistant_id: chat_ctx.assistant_id.clone(),
            model: model_connection.model_id.clone(),
            messages: chat_ctx.messages,
            temperature: payload.temperature,
            top_p: payload.top_p,
            max_tokens: payload.max_tokens,
            base_url: Some(model_connection.base_url.clone()),
            api_key: model_connection.secret_key.clone(),
        },
    )
    .await;
    let chat_latency_ms = chat_started.elapsed().as_millis() as f64;
    let chat = match chat_result {
        Ok(value) => {
            record_local_bandit_feedback_best_effort(
                app_state,
                &model_connection.provider_model_id,
                true,
                chat_latency_ms,
            )
            .await;
            let output_tokens_est = estimate_local_text_tokens(&value.content);
            let log_meta = serde_json::json!({
                "assistant_id": chat_ctx.assistant_id,
                "session_id": normalized_session_id,
                "provider_model_id": model_connection.provider_model_id,
            });
            record_local_gateway_log_best_effort(
                mcp_state,
                Some(&trace_id),
                &model_connection.model_id,
                200,
                chat_latency_ms as i64,
                Some(chat_latency_ms as i64),
                Some(upstream_endpoint.as_str()),
                input_tokens_est,
                output_tokens_est,
                input_tokens_est + output_tokens_est,
                None,
                Some(&log_meta),
            )
            .await;
            value
        }
        Err(err) => {
            record_local_bandit_feedback_best_effort(
                app_state,
                &model_connection.provider_model_id,
                false,
                chat_latency_ms,
            )
            .await;
            let log_meta = serde_json::json!({
                "assistant_id": chat_ctx.assistant_id,
                "session_id": normalized_session_id,
                "provider_model_id": model_connection.provider_model_id,
            });
            record_local_gateway_log_best_effort(
                mcp_state,
                Some(&trace_id),
                &model_connection.model_id,
                local_gateway_status_code_from_error(&err),
                chat_latency_ms as i64,
                None,
                Some(upstream_endpoint.as_str()),
                input_tokens_est,
                0,
                input_tokens_est,
                local_gateway_error_code_from_error(&err),
                Some(&log_meta),
            )
            .await;
            return Err(to_string(err));
        }
    };

    if let Some(assistant_id) = chat_ctx.assistant_id.as_deref() {
        if let Err(err) = mcp_state
            .store
            .record_local_assistant_routing_trial(assistant_id)
            .await
        {
            warn!(
                "failed to record local assistant routing trial for assistant {}: {}",
                assistant_id, err
            );
        }
    }

    let trace_meta = serde_json::json!({
        "trace_id": trace_id,
        "assistant_id": chat_ctx.assistant_id,
        "provider_model_id": model_connection.provider_model_id,
    });

    let assistant_message = mcp_state
        .store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: normalized_session_id.clone(),
            role: "assistant".to_string(),
            content: chat.content,
            name: None,
            meta_info: Some(trace_meta),
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map_err(to_string)?;

    if let Err(err) = mcp_state
        .store
        .touch_local_conversation_summary_idle_task(&normalized_session_id)
        .await
    {
        warn!(
            "failed to touch local conversation summary idle task for session {}: {}",
            normalized_session_id, err
        );
    }

    if let Err(err) = mcp_state
        .store
        .try_trigger_local_conversation_summary_flush(&normalized_session_id, "flush_threshold")
        .await
    {
        warn!(
            "failed to trigger local conversation summary flush for session {}: {}",
            normalized_session_id, err
        );
    }

    Ok(LocalConversationSendResponse {
        session_id: chat_session_id,
        user_message,
        assistant_message,
    })
}

#[tauri::command]
pub async fn regenerate_local_conversation_reply(
    state: State<'_, AppState>,
    session_id: String,
    payload: LocalConversationRegenerateRequest,
) -> Result<LocalConversationRegenerateResponse, String> {
    let app_state = state.inner();
    let mcp_state = &app_state.mcp;
    let regenerate_ctx = mcp_state
        .store
        .prepare_local_conversation_regenerate(&session_id)
        .await
        .map_err(to_string)?;

    let model_connection = resolve_local_model_connection(
        app_state,
        &payload.model,
        payload.provider_model_id.as_deref(),
    )
    .await
    .map_err(to_string)?;
    let trace_id = Uuid::new_v4().to_string();
    let input_tokens_est = estimate_local_chat_messages_tokens(&regenerate_ctx.messages);
    let upstream_endpoint = build_chat_endpoint(&model_connection.base_url);

    let chat_started = Instant::now();
    let chat_result = run_local_chat_complete(
        mcp_state,
        LocalChatRequest {
            assistant_id: regenerate_ctx.assistant_id.clone(),
            model: model_connection.model_id.clone(),
            messages: regenerate_ctx.messages.clone(),
            temperature: payload.temperature,
            top_p: payload.top_p,
            max_tokens: payload.max_tokens,
            base_url: Some(model_connection.base_url.clone()),
            api_key: model_connection.secret_key.clone(),
        },
    )
    .await;
    let chat_latency_ms = chat_started.elapsed().as_millis() as f64;
    let chat = match chat_result {
        Ok(value) => {
            record_local_bandit_feedback_best_effort(
                app_state,
                &model_connection.provider_model_id,
                true,
                chat_latency_ms,
            )
            .await;
            let output_tokens_est = estimate_local_text_tokens(&value.content);
            let log_meta = serde_json::json!({
                "assistant_id": regenerate_ctx.assistant_id,
                "session_id": regenerate_ctx.session_id,
                "provider_model_id": model_connection.provider_model_id,
            });
            record_local_gateway_log_best_effort(
                mcp_state,
                Some(&trace_id),
                &model_connection.model_id,
                200,
                chat_latency_ms as i64,
                Some(chat_latency_ms as i64),
                Some(upstream_endpoint.as_str()),
                input_tokens_est,
                output_tokens_est,
                input_tokens_est + output_tokens_est,
                None,
                Some(&log_meta),
            )
            .await;
            value
        }
        Err(err) => {
            record_local_bandit_feedback_best_effort(
                app_state,
                &model_connection.provider_model_id,
                false,
                chat_latency_ms,
            )
            .await;
            let log_meta = serde_json::json!({
                "assistant_id": regenerate_ctx.assistant_id,
                "session_id": regenerate_ctx.session_id,
                "provider_model_id": model_connection.provider_model_id,
            });
            record_local_gateway_log_best_effort(
                mcp_state,
                Some(&trace_id),
                &model_connection.model_id,
                local_gateway_status_code_from_error(&err),
                chat_latency_ms as i64,
                None,
                Some(upstream_endpoint.as_str()),
                input_tokens_est,
                0,
                input_tokens_est,
                local_gateway_error_code_from_error(&err),
                Some(&log_meta),
            )
            .await;
            return Err(to_string(err));
        }
    };

    if let Some(assistant_id) = regenerate_ctx.assistant_id.as_deref() {
        if let Err(err) = mcp_state
            .store
            .record_local_assistant_routing_trial(assistant_id)
            .await
        {
            warn!(
                "failed to record local assistant routing trial for assistant {}: {}",
                assistant_id, err
            );
        }
    }

    let trace_meta = serde_json::json!({
        "trace_id": trace_id,
        "assistant_id": regenerate_ctx.assistant_id,
        "provider_model_id": model_connection.provider_model_id,
    });

    let message = mcp_state
        .store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: regenerate_ctx.session_id.clone(),
            role: "assistant".to_string(),
            content: chat.content,
            name: None,
            meta_info: Some(trace_meta),
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map_err(to_string)?;

    if let Err(err) = mcp_state
        .store
        .touch_local_conversation_summary_idle_task(&regenerate_ctx.session_id)
        .await
    {
        warn!(
            "failed to touch local conversation summary idle task for session {}: {}",
            regenerate_ctx.session_id, err
        );
    }

    if let Err(err) = mcp_state
        .store
        .try_trigger_local_conversation_summary_flush(
            &regenerate_ctx.session_id,
            "flush_threshold",
        )
        .await
    {
        warn!(
            "failed to trigger local conversation summary flush for session {}: {}",
            regenerate_ctx.session_id, err
        );
    }

    Ok(LocalConversationRegenerateResponse {
        session_id: regenerate_ctx.session_id,
        deleted_turn_index: regenerate_ctx.deleted_turn_index,
        message,
    })
}

#[tauri::command]
pub async fn import_mcp_config(
    state: State<'_, AppState>,
    payload: ImportConfigRequest,
) -> Result<Vec<McpTool>, String> {
    let state = &state.mcp;
    let source = if let Some(source_id) = payload.source_id {
        state
            .store
            .get_source(&source_id)
            .await
            .map_err(to_string)?
            .ok_or_else(|| to_string(McpError::NotFound(format!("source {source_id} not found"))))?
    } else {
        state.store.ensure_local_source().await.map_err(to_string)?
    };

    apply_config_payload(&state, &source, payload.config)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn start_mcp_tool(
    app: AppHandle,
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<McpTool, String> {
    let state = &state.mcp;
    let tool = state
        .store
        .get_tool(&tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| to_string(McpError::NotFound(format!("tool {tool_id} not found"))))?;

    let missing = missing_required_env(&tool).unwrap_or_default();
    if !missing.is_empty() {
        let message = format!("missing required env: {}", missing.join(", "));
        state
            .store
            .set_tool_status(
                &tool_id,
                McpToolStatus::Pending,
                None,
                Some(message.clone()),
            )
            .await
            .map_err(to_string)?;
        app.emit(
            &format!("mcp-log://{}", tool_id),
            McpLogEntry {
                timestamp: now_rfc3339(),
                stream: crate::modules::mcp::types::McpLogStream::Event,
                message,
            },
        )
        .ok();
        return Err("missing required env".to_string());
    }

    state
        .process_manager
        .start_tool(tool.clone(), true)
        .await
        .map_err(to_string)?;
    let updated = state
        .store
        .get_tool(&tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| to_string(McpError::NotFound(format!("tool {tool_id} not found"))))?;
    Ok(updated)
}

#[tauri::command]
pub async fn stop_mcp_tool(state: State<'_, AppState>, tool_id: String) -> Result<McpTool, String> {
    let state = &state.mcp;
    state
        .process_manager
        .stop_tool(&tool_id)
        .await
        .map_err(to_string)?;
    let updated = state
        .store
        .get_tool(&tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| to_string(McpError::NotFound(format!("tool {tool_id} not found"))))?;
    Ok(updated)
}

#[tauri::command]
pub async fn update_mcp_tool_env(
    state: State<'_, AppState>,
    tool_id: String,
    env: Option<HashMap<String, String>>,
) -> Result<McpTool, String> {
    let state = &state.mcp;
    state
        .store
        .update_tool_env(&tool_id, env)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn apply_pending_config(
    state: State<'_, AppState>,
    tool_id: String,
    payload: UpdateToolConfigRequest,
) -> Result<McpTool, String> {
    let state = &state.mcp;
    if !payload.apply_pending {
        return Err("apply_pending must be true".to_string());
    }
    apply_pending_update(&state, &tool_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn resolve_mcp_conflict(
    state: State<'_, AppState>,
    tool_id: String,
    payload: ResolveConflictRequest,
) -> Result<McpTool, String> {
    let state = &state.mcp;
    match payload.action.as_str() {
        "update" => apply_pending_update(&state, &tool_id)
            .await
            .map_err(to_string),
        "keep" => {
            state
                .store
                .clear_pending_update(&tool_id)
                .await
                .map_err(to_string)?;
            state
                .store
                .get_tool(&tool_id)
                .await
                .map_err(to_string)?
                .ok_or_else(|| to_string(McpError::NotFound(format!("tool {tool_id} not found"))))
        }
        _ => Err("invalid action".to_string()),
    }
}

#[tauri::command]
pub async fn get_mcp_logs(
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<Vec<McpLogEntry>, String> {
    let state = &state.mcp;
    Ok(state.process_manager.logs(&tool_id).await)
}

#[tauri::command]
pub async fn clear_mcp_logs(state: State<'_, AppState>, tool_id: String) -> Result<(), String> {
    let state = &state.mcp;
    state.process_manager.clear_logs(&tool_id).await;
    Ok(())
}

#[tauri::command]
pub async fn sync_cloud_subscriptions(
    app: AppHandle,
    state: State<'_, AppState>,
    access_token: String,
) -> Result<Vec<McpTool>, String> {
    let state = &state.mcp;
    let base_url = state.cloud_base_url.read().await.clone();
    let url = format!(
        "{}/api/v1/mcp/subscriptions",
        base_url.trim_end_matches('/')
    );
    let response = state
        .client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|err| McpError::Network(err.to_string()))
        .map_err(to_string)?;

    if !response.status().is_success() {
        return Err(format!("cloud sync failed: {}", response.status()));
    }

    let subs: Vec<CloudSubscriptionItem> = response
        .json()
        .await
        .map_err(|err| McpError::Network(err.to_string()))
        .map_err(to_string)?;

    let cloud_source = state
        .store
        .ensure_cloud_source(&base_url)
        .await
        .map_err(to_string)?;
    let mut seen_identifiers = HashSet::new();

    for sub in subs.iter() {
        let tool = &sub.tool;
        seen_identifiers.insert(tool.identifier.clone());
        let config_json = build_cloud_config_json(tool)?;
        let config_hash = state
            .store
            .compute_config_hash(&config_json)
            .map_err(to_string)?;
        let config_json_text = serde_json::to_string(&config_json)
            .map_err(|err| McpError::Storage(err.to_string()))
            .map_err(to_string)?;

        let extracted = ExtractedToolFields {
            name: tool.name.clone(),
            description: tool.description.clone(),
            command: Some(tool.install_manifest.command.clone()),
            args: Some(tool.install_manifest.args.clone()),
            env: None,
            capabilities: vec![],
        };

        let name_conflict = state
            .store
            .has_name_conflict(&extracted.name, &cloud_source.id)
            .await
            .map_err(to_string)?;

        let existing = state
            .store
            .get_tool_by_source_identifier(&cloud_source.id, &tool.identifier)
            .await
            .map_err(to_string)?;

        match existing {
            Some(existing_tool) => {
                if existing_tool.config_hash == config_hash {
                    continue;
                }
                let conflict_status = if name_conflict {
                    McpConflictStatus::Conflict
                } else {
                    McpConflictStatus::UpdateAvailable
                };
                state
                    .store
                    .mark_tool_pending_update(
                        &existing_tool.id,
                        config_json_text.clone(),
                        config_hash.clone(),
                        conflict_status,
                    )
                    .await
                    .map_err(to_string)?;
            }
            None => {
                let tool_upsert = ToolUpsert {
                    id: None,
                    source_id: cloud_source.id.clone(),
                    identifier: Some(tool.identifier.clone()),
                    name: extracted.name,
                    source_type: McpSourceType::Cloud,
                    status: McpToolStatus::Stopped,
                    ping_ms: None,
                    capabilities: extracted.capabilities,
                    description: extracted.description,
                    error: None,
                    command: extracted.command,
                    args: extracted.args,
                    env: extracted.env,
                    config_json: config_json_text.clone(),
                    config_hash: config_hash.clone(),
                    pending_config_json: None,
                    pending_config_hash: None,
                    conflict_status: if name_conflict {
                        McpConflictStatus::Conflict
                    } else {
                        McpConflictStatus::None
                    },
                    is_read_only: true,
                    is_new: true,
                };
                state
                    .store
                    .upsert_tool(tool_upsert)
                    .await
                    .map_err(to_string)?;
            }
        }
    }

    let all_tools = state.store.list_tools().await.map_err(to_string)?;
    for tool in all_tools
        .iter()
        .filter(|t| t.source_id.as_deref() == Some(&cloud_source.id))
    {
        let Some(identifier) = tool.identifier.clone() else {
            continue;
        };
        if !seen_identifiers.contains(&identifier) {
            let _ = state
                .store
                .set_tool_status(
                    &tool.id,
                    McpToolStatus::Orphaned,
                    None,
                    Some("cloud subscription removed".to_string()),
                )
                .await;
            app.emit(
                &format!("mcp-log://{}", tool.id),
                McpLogEntry {
                    timestamp: now_rfc3339(),
                    stream: crate::modules::mcp::types::McpLogStream::Event,
                    message: "cloud subscription removed".to_string(),
                },
            )
            .ok();
        }
    }

    state.store.list_tools().await.map_err(to_string)
}

pub(crate) async fn sync_source_inner(
    state: &McpRuntimeState,
    source: McpSource,
    auth_token: Option<String>,
) -> Result<Vec<McpTool>, McpError> {
    let payload = match source.source_type {
        McpSourceType::Local => {
            let path = expand_path(&source.path_or_url);
            let content = tokio::fs::read_to_string(&path)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            serde_json::from_str::<McpConfigPayload>(&content)
                .map_err(|err| McpError::Storage(err.to_string()))?
        }
        _ => {
            let mut request = state.client.get(&source.path_or_url);
            if let Some(token) = auth_token {
                request = request.bearer_auth(token);
            }
            let response = request
                .send()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;
            if !response.status().is_success() {
                return Err(McpError::Network(format!(
                    "sync failed with status {}",
                    response.status()
                )));
            }
            response
                .json::<McpConfigPayload>()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?
        }
    };

    apply_config_payload(state, &source, payload).await
}

async fn apply_config_payload(
    state: &McpRuntimeState,
    source: &McpSource,
    payload: McpConfigPayload,
) -> Result<Vec<McpTool>, McpError> {
    let mut tools = Vec::with_capacity(payload.mcp_servers.len());
    let is_read_only = source.source_type != McpSourceType::Local || source.is_read_only;

    for (name, config_payload) in payload.mcp_servers {
        let config_value = state.store.build_config_json(&name, &config_payload)?;
        let config_hash = state.store.compute_config_hash(&config_value)?;
        let config_json = serde_json::to_string(&config_value)
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let extracted: ExtractedToolFields =
            state.store.extract_tool_fields(&name, &config_payload);
        let name_conflict = state.store.has_name_conflict(&name, &source.id).await?;

        let existing = state
            .store
            .get_tool_by_source_name(&source.id, &name)
            .await?;

        let tool = match existing {
            Some(existing_tool) => {
                if existing_tool.config_hash == config_hash {
                    existing_tool
                } else if is_read_only {
                    let conflict_status = if name_conflict {
                        McpConflictStatus::Conflict
                    } else {
                        McpConflictStatus::UpdateAvailable
                    };
                    state
                        .store
                        .mark_tool_pending_update(
                            &existing_tool.id,
                            config_json,
                            config_hash,
                            conflict_status,
                        )
                        .await?;
                    state
                        .store
                        .get_tool(&existing_tool.id)
                        .await?
                        .ok_or_else(|| {
                            McpError::NotFound("tool missing after update".to_string())
                        })?
                } else {
                    state
                        .store
                        .upsert_tool(ToolUpsert {
                            id: Some(existing_tool.id.clone()),
                            source_id: source.id.clone(),
                            identifier: existing_tool.identifier.clone(),
                            name: extracted.name,
                            source_type: source.source_type.clone(),
                            status: existing_tool.status.clone(),
                            ping_ms: existing_tool.ping_ms,
                            capabilities: extracted.capabilities,
                            description: extracted.description,
                            error: existing_tool.error.clone(),
                            command: extracted.command,
                            args: extracted.args,
                            env: extracted.env,
                            config_json,
                            config_hash,
                            pending_config_json: None,
                            pending_config_hash: None,
                            conflict_status: if name_conflict {
                                McpConflictStatus::Conflict
                            } else {
                                McpConflictStatus::None
                            },
                            is_read_only,
                            is_new: existing_tool.is_new,
                        })
                        .await?
                }
            }
            None => {
                state
                    .store
                    .upsert_tool(ToolUpsert {
                        id: None,
                        source_id: source.id.clone(),
                        identifier: None,
                        name: extracted.name,
                        source_type: source.source_type.clone(),
                        status: McpToolStatus::Stopped,
                        ping_ms: None,
                        capabilities: extracted.capabilities,
                        description: extracted.description,
                        error: None,
                        command: extracted.command,
                        args: extracted.args,
                        env: extracted.env,
                        config_json,
                        config_hash,
                        pending_config_json: None,
                        pending_config_hash: None,
                        conflict_status: if name_conflict {
                            McpConflictStatus::Conflict
                        } else {
                            McpConflictStatus::None
                        },
                        is_read_only,
                        is_new: true,
                    })
                    .await?
            }
        };

        tools.push(tool);
    }

    Ok(tools)
}

async fn apply_pending_update(state: &McpRuntimeState, tool_id: &str) -> Result<McpTool, McpError> {
    let tool = state
        .store
        .get_tool(tool_id)
        .await?
        .ok_or_else(|| McpError::NotFound(format!("tool {tool_id} not found")))?;
    let source_id = tool
        .source_id
        .clone()
        .ok_or_else(|| McpError::Validation("tool missing source_id".to_string()))?;
    let pending_json = state
        .store
        .get_pending_config_json(tool_id)
        .await?
        .ok_or_else(|| McpError::Validation("no pending config".to_string()))?;

    let pending_value: serde_json::Value =
        serde_json::from_str(&pending_json).map_err(|err| McpError::Storage(err.to_string()))?;
    let pending_payload: McpToolConfigPayload = serde_json::from_value(pending_value.clone())
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let extracted = state
        .store
        .extract_tool_fields(&tool.name, &pending_payload);
    let config_hash = state.store.compute_config_hash(&pending_value)?;

    let updated = state
        .store
        .upsert_tool(ToolUpsert {
            id: Some(tool.id.clone()),
            source_id,
            identifier: tool.identifier.clone(),
            name: extracted.name,
            source_type: tool.source_type.clone(),
            status: tool.status.clone(),
            ping_ms: tool.ping_ms,
            capabilities: extracted.capabilities,
            description: extracted.description,
            error: tool.error.clone(),
            command: extracted.command,
            args: extracted.args,
            env: extracted.env,
            config_json: pending_json,
            config_hash,
            pending_config_json: None,
            pending_config_hash: None,
            conflict_status: McpConflictStatus::None,
            is_read_only: tool.is_read_only,
            is_new: tool.is_new,
        })
        .await?;

    Ok(updated)
}

fn build_cloud_config_json(tool: &CloudToolSummary) -> Result<serde_json::Value, String> {
    let mut map = serde_json::Map::new();
    map.insert(
        "identifier".to_string(),
        serde_json::Value::String(tool.identifier.clone()),
    );
    map.insert(
        "name".to_string(),
        serde_json::Value::String(tool.name.clone()),
    );
    map.insert(
        "description".to_string(),
        serde_json::Value::String(tool.description.clone()),
    );
    map.insert(
        "command".to_string(),
        serde_json::Value::String(tool.install_manifest.command.clone()),
    );
    map.insert(
        "args".to_string(),
        serde_json::Value::Array(
            tool.install_manifest
                .args
                .iter()
                .cloned()
                .map(serde_json::Value::String)
                .collect(),
        ),
    );
    if let Some(runtime) = &tool.install_manifest.runtime {
        map.insert(
            "runtime".to_string(),
            serde_json::Value::String(runtime.clone()),
        );
    }
    if let Some(env_config) = &tool.install_manifest.env_config {
        map.insert(
            "env_config".to_string(),
            serde_json::Value::Array(
                env_config
                    .iter()
                    .cloned()
                    .map(serde_json::Value::Object)
                    .collect(),
            ),
        );
    }
    if let Some(tags) = &tool.tags {
        map.insert(
            "tags".to_string(),
            serde_json::Value::Array(
                tags.iter()
                    .cloned()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
    }
    if let Some(category) = &tool.category {
        map.insert(
            "category".to_string(),
            serde_json::Value::String(category.clone()),
        );
    }
    if let Some(author) = &tool.author {
        map.insert(
            "author".to_string(),
            serde_json::Value::String(author.clone()),
        );
    }
    if let Some(is_official) = tool.is_official {
        map.insert(
            "is_official".to_string(),
            serde_json::Value::Bool(is_official),
        );
    }
    if let Some(avatar_url) = &tool.avatar_url {
        map.insert(
            "avatar_url".to_string(),
            serde_json::Value::String(avatar_url.clone()),
        );
    }
    Ok(serde_json::Value::Object(map))
}

fn missing_required_env(tool: &McpTool) -> Option<Vec<String>> {
    let config: serde_json::Value = serde_json::from_str(&tool.config_json).ok()?;
    let env_config = config.get("env_config")?.as_array()?;
    let env = tool.env.as_ref();
    let mut missing = Vec::new();
    for item in env_config {
        let key = item.get("key").and_then(|v| v.as_str()).unwrap_or("");
        let required = item
            .get("required")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !required || key.is_empty() {
            continue;
        }
        let present = env
            .and_then(|env| env.get(key))
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        if !present {
            missing.push(key.to_string());
        }
    }
    Some(missing)
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "".to_string())
}

fn to_string(err: McpError) -> String {
    err.to_string()
}

pub fn default_cloud_source_name() -> &'static str {
    "Deeting Cloud"
}

pub fn default_local_source_path() -> PathBuf {
    expand_path("~/.config/deeting/mcp.json")
}

fn build_chat_payload(
    model: String,
    messages: Vec<LocalChatInputMessage>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    max_tokens: Option<u32>,
) -> Result<serde_json::Value, String> {
    let mut payload = serde_json::Map::new();
    payload.insert("model".to_string(), serde_json::Value::String(model));

    let msgs: Vec<serde_json::Value> = messages
        .into_iter()
        .map(|m| {
            let mut map = serde_json::Map::new();
            map.insert("role".to_string(), serde_json::Value::String(m.role));
            map.insert(
                "content".to_string(),
                parse_chat_message_content(&m.content),
            );
            serde_json::Value::Object(map)
        })
        .collect();
    payload.insert("messages".to_string(), serde_json::Value::Array(msgs));

    if let Some(temp) = temperature {
        payload.insert("temperature".to_string(), serde_json::Value::from(temp));
    }
    if let Some(tp) = top_p {
        payload.insert("top_p".to_string(), serde_json::Value::from(tp));
    }
    if let Some(mt) = max_tokens {
        payload.insert("max_tokens".to_string(), serde_json::Value::from(mt));
    }

    Ok(serde_json::Value::Object(payload))
}

fn parse_chat_message_content(raw: &str) -> serde_json::Value {
    let trimmed = raw.trim();
    if trimmed.starts_with('[') {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
            return parsed;
        }
    }
    serde_json::Value::String(raw.to_string())
}

async fn run_local_chat_complete(
    state: &McpRuntimeState,
    payload: LocalChatRequest,
) -> Result<LocalChatResponse, McpError> {
    let model = payload.model.trim().to_string();
    if model.is_empty() {
        return Err(McpError::validation("model is required"));
    }
    if payload.messages.is_empty() {
        return Err(McpError::validation("messages is required"));
    }

    let base_url = payload.base_url.unwrap_or_default();
    if base_url.trim().is_empty() {
        return Err(McpError::validation("base_url is required"));
    }

    let mut messages = payload.messages;
    if let Some(assistant_id) = payload.assistant_id.as_deref() {
        let assistant = state
            .store
            .get_local_assistant(assistant_id)
            .await?
            .ok_or_else(|| McpError::NotFound(format!("assistant {assistant_id} not found")))?;
        let system_prompt = assistant.system_prompt.trim().to_string();
        if !system_prompt.is_empty() && !messages.iter().any(|msg| msg.role == "system") {
            messages.insert(
                0,
                LocalChatInputMessage {
                    role: "system".to_string(),
                    content: system_prompt,
                },
            );
        }
    }

    let request_body = build_chat_payload(
        model,
        messages,
        payload.temperature,
        payload.top_p,
        payload.max_tokens,
    )
    .map_err(McpError::validation)?;
    let endpoint = build_chat_endpoint(&base_url);

    let mut request = state.client.post(&endpoint).json(&request_body);
    if let Some(api_key) = payload.api_key {
        let header_value = normalize_bearer_token(&api_key);
        if !header_value.is_empty() {
            request = request.header("Authorization", header_value);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|err| McpError::Network(err.to_string()))?;
    let status = response.status();
    let response_json: Value = response
        .json()
        .await
        .map_err(|err| McpError::Network(err.to_string()))?;

    if !status.is_success() {
        let message = extract_error_message(&response_json)
            .unwrap_or_else(|| format!("upstream error: {}", status));
        return Err(McpError::Network(message));
    }

    let content = extract_chat_content(&response_json)
        .ok_or_else(|| McpError::Process("empty response content".to_string()))?;

    Ok(LocalChatResponse { content })
}

async fn record_local_bandit_feedback_best_effort(
    app_state: &AppState,
    provider_model_id: &str,
    success: bool,
    latency_ms: f64,
) {
    let arm_id = provider_model_id.trim();
    if arm_id.is_empty() {
        return;
    }

    let payload = BanditFeedbackRequest {
        scene: Some("router:llm".to_string()),
        arm_id: arm_id.to_string(),
        success,
        latency_ms: Some(latency_ms),
        cost: None,
        reward: Some(if success { 1.0 } else { 0.0 }),
        routing_config: None,
        reward_metric_type: Some("latency_success".to_string()),
    };

    if let Err(err) = app_state.providers.store.record_bandit_feedback(payload).await {
        warn!(
            "failed to record local bandit feedback for provider_model {}: {}",
            arm_id, err
        );
    }
}

fn estimate_local_text_tokens(text: &str) -> i64 {
    if text.trim().is_empty() {
        return 0;
    }
    let chars = text.chars().count() as i64;
    (chars / 4).max(1)
}

fn estimate_local_chat_messages_tokens(messages: &[LocalChatInputMessage]) -> i64 {
    messages
        .iter()
        .map(|message| estimate_local_text_tokens(&message.content))
        .sum()
}

fn local_gateway_status_code_from_error(err: &McpError) -> i64 {
    match err {
        McpError::Validation(_) => 400,
        McpError::NotFound(_) => 404,
        McpError::Process(_) => 502,
        McpError::Storage(_) => 500,
        McpError::Network(_) => 502,
    }
}

fn local_gateway_error_code_from_error(err: &McpError) -> Option<&'static str> {
    match err {
        McpError::Validation(_) => Some("VALIDATION_ERROR"),
        McpError::NotFound(_) => Some("UPSTREAM_NOT_FOUND"),
        McpError::Process(_) => Some("UPSTREAM_INVALID_RESPONSE"),
        McpError::Storage(_) => Some("LOCAL_STORAGE_ERROR"),
        McpError::Network(_) => Some("UPSTREAM_ERROR"),
    }
}

async fn record_local_gateway_log_best_effort(
    mcp_state: &McpRuntimeState,
    trace_id: Option<&str>,
    model: &str,
    status_code: i64,
    duration_ms: i64,
    ttft_ms: Option<i64>,
    upstream_url: Option<&str>,
    input_tokens: i64,
    output_tokens: i64,
    total_tokens: i64,
    error_code: Option<&str>,
    meta: Option<&serde_json::Value>,
) {
    if let Err(err) = mcp_state
        .store
        .create_local_gateway_log(
            trace_id,
            model,
            status_code,
            duration_ms,
            ttft_ms,
            upstream_url,
            0,
            input_tokens,
            output_tokens,
            total_tokens,
            0.0,
            0.0,
            false,
            error_code,
            meta,
        )
        .await
    {
        warn!(
            "failed to record local gateway log: trace_id={:?} model={} err={}",
            trace_id, model, err
        );
    }
}

async fn resolve_local_model_connection(
    app_state: &AppState,
    requested_model: &str,
    provider_model_id: Option<&str>,
) -> Result<LocalModelConnection, McpError> {
    let normalized_model = requested_model.trim().to_string();
    if normalized_model.is_empty() {
        return Err(McpError::validation("model is required"));
    }

    let instances = app_state
        .providers
        .store
        .list_instances()
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let enabled_instances: Vec<_> = instances
        .into_iter()
        .filter(|instance| instance.is_enabled)
        .collect();

    if enabled_instances.is_empty() {
        return Err(McpError::NotFound(
            "no enabled provider instances found".to_string(),
        ));
    }

    if let Some(raw_provider_model_id) = provider_model_id {
        let provider_model_uuid = Uuid::parse_str(raw_provider_model_id.trim())
            .map_err(|_| McpError::validation("invalid provider_model_id"))?;
        let model = app_state
            .providers
            .store
            .get_model(&provider_model_uuid)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
            .ok_or_else(|| McpError::NotFound("provider model not found".to_string()))?;

        if !model.is_active {
            return Err(McpError::validation("provider model is inactive"));
        }

        let instance = enabled_instances
            .iter()
            .find(|item| item.id == model.instance_id)
            .ok_or_else(|| {
                McpError::NotFound("provider instance not enabled for this model".to_string())
            })?;

        let connection = app_state
            .providers
            .store
            .get_instance_connection(&instance.id)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
            .ok_or_else(|| {
                McpError::NotFound("provider instance connection missing".to_string())
            })?;

        return Ok(LocalModelConnection {
            provider_model_id: model.id.to_string(),
            model_id: model.model_id,
            base_url: connection.base_url,
            secret_key: connection.secret_key,
        });
    }

    for instance in enabled_instances {
        let models = app_state
            .providers
            .store
            .list_models(&instance.id)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        let selected_model = models.into_iter().find(|item| {
            item.is_active
                && (item.model_id == normalized_model || item.id.to_string() == normalized_model)
        });

        if let Some(model) = selected_model {
            let connection = app_state
                .providers
                .store
                .get_instance_connection(&instance.id)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?
                .ok_or_else(|| {
                    McpError::NotFound("provider instance connection missing".to_string())
                })?;
            return Ok(LocalModelConnection {
                provider_model_id: model.id.to_string(),
                model_id: model.model_id,
                base_url: connection.base_url,
                secret_key: connection.secret_key,
            });
        }
    }

    Err(McpError::NotFound(format!(
        "no active local provider model matches {}",
        normalized_model
    )))
}

async fn resolve_default_local_model_connection(
    app_state: &AppState,
) -> Result<LocalModelConnection, McpError> {
    let instances = app_state
        .providers
        .store
        .list_instances()
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let enabled_instances: Vec<_> = instances
        .into_iter()
        .filter(|instance| instance.is_enabled)
        .collect();

    if enabled_instances.is_empty() {
        return Err(McpError::NotFound(
            "no enabled provider instances found".to_string(),
        ));
    }

    for instance in enabled_instances {
        let models = app_state
            .providers
            .store
            .list_models(&instance.id)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        if let Some(model) = models.into_iter().find(|item| item.is_active) {
            let connection = app_state
                .providers
                .store
                .get_instance_connection(&instance.id)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?
                .ok_or_else(|| {
                    McpError::NotFound("provider instance connection missing".to_string())
                })?;
            return Ok(LocalModelConnection {
                provider_model_id: model.id.to_string(),
                model_id: model.model_id,
                base_url: connection.base_url,
                secret_key: connection.secret_key,
            });
        }
    }

    Err(McpError::NotFound(
        "no active local provider model found".to_string(),
    ))
}

pub async fn start_local_conversation_summary_worker(app_state: AppState) {
    loop {
        let job = match app_state
            .mcp
            .store
            .claim_next_local_conversation_summary_job()
            .await
        {
            Ok(job) => job,
            Err(err) => {
                warn!("local conversation summary worker claim job failed: {}", err);
                tokio::time::sleep(Duration::from_secs(
                    LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
                ))
                .await;
                continue;
            }
        };

        let Some(job) = job else {
            tokio::time::sleep(Duration::from_secs(
                LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
            ))
            .await;
            continue;
        };

        let session_id = job.session_id.clone();
        match refresh_local_conversation_summary(&app_state, &session_id).await {
            Ok(_) => {
                if let Err(err) = app_state
                    .mcp
                    .store
                    .complete_local_conversation_summary_job(&job.id)
                    .await
                {
                    warn!(
                        "local conversation summary worker complete job failed: job_id={} session_id={} err={}",
                        job.id, session_id, err
                    );
                }
            }
            Err(McpError::NotFound(err)) | Err(McpError::Validation(err)) => {
                warn!(
                    "local conversation summary worker skip non-retriable job: job_id={} session_id={} err={}",
                    job.id, session_id, err
                );
                if let Err(mark_err) = app_state
                    .mcp
                    .store
                    .complete_local_conversation_summary_job(&job.id)
                    .await
                {
                    warn!(
                        "local conversation summary worker complete skipped job failed: job_id={} session_id={} err={}",
                        job.id, session_id, mark_err
                    );
                }
            }
            Err(err) => {
                let retry_delay_seconds =
                    compute_local_conversation_summary_retry_delay_seconds(job.attempts);
                let err_text = err.to_string();
                if let Err(mark_err) = app_state
                    .mcp
                    .store
                    .fail_local_conversation_summary_job(&job, &err_text, retry_delay_seconds)
                    .await
                {
                    warn!(
                        "local conversation summary worker mark job failed-state failed: job_id={} session_id={} err={}",
                        job.id, session_id, mark_err
                    );
                } else {
                    warn!(
                        "local conversation summary worker execution failed: job_id={} session_id={} attempts={}/{} retry_after={}s err={}",
                        job.id,
                        session_id,
                        job.attempts,
                        job.max_attempts,
                        retry_delay_seconds,
                        err_text
                    );
                }
            }
        }
    }
}

pub async fn start_local_periodic_worker(app_state: AppState) {
    if let Err(err) = app_state
        .mcp
        .store
        .upsert_local_periodic_task(
            LOCAL_PERIODIC_TASK_SUMMARY_JOB_GC_NAME,
            LOCAL_PERIODIC_TASK_SUMMARY_JOB_GC_INTERVAL_SECS,
            LOCAL_PERIODIC_TASK_SUMMARY_JOB_GC_INITIAL_DELAY_SECS,
        )
        .await
    {
        warn!("local periodic worker register builtin tasks failed: {}", err);
    }
    if let Err(err) = app_state
        .mcp
        .store
        .upsert_local_periodic_task(
            LOCAL_PERIODIC_TASK_SUMMARY_IDLE_DISPATCH_NAME,
            LOCAL_PERIODIC_TASK_SUMMARY_IDLE_DISPATCH_INTERVAL_SECS,
            LOCAL_PERIODIC_TASK_SUMMARY_IDLE_DISPATCH_INITIAL_DELAY_SECS,
        )
        .await
    {
        warn!("local periodic worker register idle-dispatch task failed: {}", err);
    }

    loop {
        let task = match app_state.mcp.store.claim_next_local_periodic_task().await {
            Ok(task) => task,
            Err(err) => {
                warn!("local periodic worker claim task failed: {}", err);
                tokio::time::sleep(Duration::from_secs(LOCAL_PERIODIC_TASK_WORKER_IDLE_INTERVAL_SECS))
                    .await;
                continue;
            }
        };

        let Some(task) = task else {
            tokio::time::sleep(Duration::from_secs(LOCAL_PERIODIC_TASK_WORKER_IDLE_INTERVAL_SECS))
                .await;
            continue;
        };

        match run_local_periodic_task(&app_state, &task.task_name).await {
            Ok(detail) => {
                if let Err(err) = app_state
                    .mcp
                    .store
                    .mark_local_periodic_task_success(&task.task_name)
                    .await
                {
                    warn!(
                        "local periodic worker mark success failed: task={} interval={}s err={}",
                        task.task_name, task.interval_seconds, err
                    );
                } else if !detail.ends_with("=0") {
                    warn!(
                        "local periodic worker task succeeded: task={} interval={}s detail={}",
                        task.task_name, task.interval_seconds, detail
                    );
                }
            }
            Err(err) => {
                let err_text = err.to_string();
                if let Err(mark_err) = app_state
                    .mcp
                    .store
                    .mark_local_periodic_task_failure(&task.task_name, &err_text)
                    .await
                {
                    warn!(
                        "local periodic worker mark failure failed: task={} interval={}s err={}",
                        task.task_name, task.interval_seconds, mark_err
                    );
                } else {
                    warn!(
                        "local periodic worker task failed: task={} interval={}s err={}",
                        task.task_name, task.interval_seconds, err_text
                    );
                }
            }
        }
    }
}

async fn run_local_periodic_task(app_state: &AppState, task_name: &str) -> Result<String, McpError> {
    match task_name {
        LOCAL_PERIODIC_TASK_SUMMARY_JOB_GC_NAME => {
            let deleted = app_state
                .mcp
                .store
                .cleanup_old_local_conversation_summary_jobs(
                    LOCAL_PERIODIC_TASK_SUMMARY_JOB_GC_RETENTION_SECS,
                )
                .await?;
            Ok(format!("deleted_summary_jobs={}", deleted))
        }
        LOCAL_PERIODIC_TASK_SUMMARY_IDLE_DISPATCH_NAME => {
            let dispatched = app_state
                .mcp
                .store
                .dispatch_due_local_conversation_summary_idle_tasks()
                .await?;
            Ok(format!("dispatched_summary_idle_checks={}", dispatched))
        }
        _ => Err(McpError::validation(format!(
            "unknown local periodic task: {}",
            task_name
        ))),
    }
}

fn compute_local_conversation_summary_retry_delay_seconds(attempts: i64) -> i64 {
    let normalized_attempt = attempts.max(1).min(8);
    let multiplier = 2_i64.pow((normalized_attempt - 1) as u32);
    LOCAL_CONVERSATION_SUMMARY_WORKER_RETRY_BASE_DELAY_SECS
        .saturating_mul(multiplier)
        .min(LOCAL_CONVERSATION_SUMMARY_WORKER_RETRY_MAX_DELAY_SECS)
}

fn extract_tool_calls_from_trace_meta(meta: &serde_json::Value) -> Option<Vec<TraceToolCall>> {
    let raw_calls = meta.get("tool_calls")?.as_array()?;
    let mut calls = Vec::new();
    for raw in raw_calls {
        let Some(item) = raw.as_object() else {
            continue;
        };
        let name = item
            .get("name")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let Some(name) = name else {
            continue;
        };
        let success = item
            .get("success")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        calls.push(TraceToolCall { name, success });
    }
    if calls.is_empty() {
        None
    } else {
        Some(calls)
    }
}

async fn process_trace_feedback_tool_calls(
    app_state: &AppState,
    score: f64,
    tool_calls: Vec<TraceToolCall>,
) {
    for call in tool_calls {
        if !call.name.starts_with("skill__") {
            continue;
        }
        let mut reward = score;
        if !call.success && reward > 0.0 {
            reward = -1.0;
        }
        let payload = BanditFeedbackRequest {
            scene: Some("retrieval:skill".to_string()),
            arm_id: call.name.clone(),
            success: call.success && reward > 0.0,
            latency_ms: None,
            cost: None,
            reward: Some(reward),
            routing_config: None,
            reward_metric_type: Some("user_feedback".to_string()),
        };
        if let Err(err) = app_state.providers.store.record_bandit_feedback(payload).await {
            warn!(
                "trace feedback bandit write failed: arm={} err={}",
                call.name, err
            );
        }
    }
}

async fn process_trace_feedback_assistant_routing(
    mcp_state: &McpRuntimeState,
    score: f64,
    meta: &serde_json::Value,
) {
    if score == 0.0 {
        return;
    }
    let assistant_id = meta
        .get("assistant_id")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(assistant_id) = assistant_id else {
        return;
    };

    let event = if score > 0.0 {
        "thumbs_up"
    } else {
        "thumbs_down"
    };
    if let Err(err) = mcp_state
        .store
        .record_local_assistant_routing_feedback(
            &assistant_id,
            LocalAssistantRoutingFeedbackRequest {
                event: event.to_string(),
            },
        )
        .await
    {
        warn!(
            "trace feedback assistant routing write failed: assistant={} err={}",
            assistant_id, err
        );
    }
}

async fn refresh_local_conversation_summary(app_state: &AppState, session_id: &str) -> Result<(), McpError> {
    let mcp_state = &app_state.mcp;
    let chat_ctx = mcp_state
        .store
        .get_local_conversation_chat_context(session_id)
        .await?;
    let (summary_text, summarizer_model) =
        generate_local_conversation_summary(app_state, mcp_state, &chat_ctx.messages).await;

    mcp_state
        .store
        .persist_local_conversation_summary(
            session_id,
            &summary_text,
            summarizer_model.as_deref(),
        )
        .await
}

async fn generate_local_conversation_summary(
    app_state: &AppState,
    mcp_state: &McpRuntimeState,
    messages: &[LocalChatInputMessage],
) -> (String, Option<String>) {
    let secretary_model_name = app_state
        .providers
        .store
        .get_or_create_user_secretary()
        .await
        .ok()
        .and_then(|secretary| secretary.model_name)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(secretary_model_name) = secretary_model_name {
        let model_connection = resolve_local_model_connection(app_state, &secretary_model_name, None).await;
        if let Ok(model_connection) = model_connection {
            let conversation_text = format_conversation_for_summary(messages);
            let prompt = build_summary_prompt(&conversation_text);
            let summarize_response = run_local_chat_complete(
                mcp_state,
                LocalChatRequest {
                    assistant_id: None,
                    model: model_connection.model_id,
                    messages: vec![LocalChatInputMessage {
                        role: "user".to_string(),
                        content: prompt,
                    }],
                    temperature: None,
                    top_p: None,
                    max_tokens: None,
                    base_url: Some(model_connection.base_url),
                    api_key: model_connection.secret_key,
                },
            )
            .await;

            if let Ok(response) = summarize_response {
                let summary = response.content.trim().to_string();
                if !summary.is_empty() {
                    return (truncate_summary_text(&summary), Some(secretary_model_name));
                }
            }
        }
    }

    (build_local_summary_fallback(messages), None)
}

fn build_summary_prompt(conversation_text: &str) -> String {
    format!(
        "{LOCAL_CONVERSATION_SUMMARY_PROMPT}{conversation_text}"
    )
}

fn format_conversation_for_summary(messages: &[LocalChatInputMessage]) -> String {
    let mut lines = Vec::with_capacity(messages.len());
    for message in messages {
        let role = message.role.trim();
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }
        lines.push(format!("[{role}] {content}"));
    }
    lines.join("\n")
}

fn build_local_summary_fallback(messages: &[LocalChatInputMessage]) -> String {
    let mut lines = Vec::new();
    for message in messages
        .iter()
        .rev()
        .take(LOCAL_CONVERSATION_SUMMARY_FALLBACK_RECENT_MESSAGES)
        .rev()
    {
        let role = message.role.trim();
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }
        lines.push(format!("[{role}] {content}"));
    }
    let joined = lines.join("\n");
    truncate_summary_text(&joined)
}

fn truncate_summary_text(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= LOCAL_CONVERSATION_SUMMARY_MAX_CHARS {
        return text.to_string();
    }
    let truncated: String = chars
        .into_iter()
        .take(LOCAL_CONVERSATION_SUMMARY_MAX_CHARS.saturating_sub(4))
        .collect();
    format!("{truncated} ...")
}

fn build_chat_endpoint(base_url: &str) -> String {
    format!("{}/v1/chat/completions", base_url.trim_end_matches('/'))
}

fn normalize_bearer_token(token: &str) -> String {
    if token.starts_with("Bearer ") {
        token.to_string()
    } else {
        format!("Bearer {}", token)
    }
}

fn extract_error_message(value: &serde_json::Value) -> Option<String> {
    value
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            value
                .get("message")
                .and_then(|m| m.as_str())
                .map(|s| s.to_string())
        })
}

fn extract_chat_content(value: &serde_json::Value) -> Option<String> {
    value
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        build_local_summary_fallback, format_conversation_for_summary, truncate_summary_text,
        LOCAL_CONVERSATION_SUMMARY_MAX_CHARS,
    };
    use crate::modules::mcp::types::LocalChatInputMessage;

    #[test]
    fn format_conversation_skips_empty_content() {
        let messages = vec![
            LocalChatInputMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            },
            LocalChatInputMessage {
                role: "assistant".to_string(),
                content: "   ".to_string(),
            },
            LocalChatInputMessage {
                role: "assistant".to_string(),
                content: "world".to_string(),
            },
        ];

        let result = format_conversation_for_summary(&messages);
        assert_eq!(result, "[user] hello\n[assistant] world");
    }

    #[test]
    fn fallback_uses_recent_messages_only() {
        let messages = (1..=10)
            .map(|idx| LocalChatInputMessage {
                role: if idx % 2 == 0 { "assistant" } else { "user" }.to_string(),
                content: format!("msg-{idx}"),
            })
            .collect::<Vec<_>>();

        let result = build_local_summary_fallback(&messages);
        let lines: Vec<&str> = result.lines().collect();
        assert!(!lines.iter().any(|line| line.ends_with("msg-1")));
        assert!(!lines.iter().any(|line| line.ends_with("msg-2")));
        assert!(lines.iter().any(|line| line.ends_with("msg-10")));
    }

    #[test]
    fn truncate_summary_limits_max_length() {
        let input = "a".repeat(LOCAL_CONVERSATION_SUMMARY_MAX_CHARS + 32);
        let result = truncate_summary_text(&input);
        assert!(result.len() <= LOCAL_CONVERSATION_SUMMARY_MAX_CHARS + 4);
        assert!(result.ends_with(" ..."));
    }
}
