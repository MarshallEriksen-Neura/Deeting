use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::{expand_path, ExtractedToolFields, NewSource, ToolUpsert};
use crate::modules::mcp::types::{
    CreateAssistantMessageRequest, CreateConversationMessageRequest, CreateLocalAssistantRequest,
    CreateSourceRequest, ImportConfigRequest, LocalAssistant, LocalAssistantEntity, LocalAssistantMessage,
    LocalAssistantVersion, LocalChatInputMessage, LocalChatRequest, LocalChatResponse, LocalConversationArchiveResponse,
    LocalConversationClearResponse, LocalConversationCreateRequest, LocalConversationCreateResponse,
    LocalConversationDeleteResponse, LocalConversationHistoryQuery, LocalConversationHistoryMessage,
    LocalConversationHistoryResponse, LocalConversationRegenerateRequest,
    LocalConversationRegenerateResponse, LocalConversationRenameRequest,
    LocalConversationRenameResponse, LocalConversationSessionPage, LocalConversationSessionsQuery,
    LocalConversationSendRequest, LocalConversationSendResponse, LocalConversationStatus,
    McpConfigPayload, McpConflictStatus, McpLogEntry, McpSource,
    McpSourceStatus, McpSourceType, McpTool, McpToolConfigPayload, McpToolStatus,
    ResolveConflictRequest, SyncSourceRequest, UpdateLocalAssistantRequest, UpdateToolConfigRequest,
};
use crate::modules::mcp::McpRuntimeState;
use crate::state::AppState;

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

#[tauri::command]
pub async fn set_cloud_base_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<(), String> {
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
pub async fn delete_local_assistant(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
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
pub async fn append_local_conversation_message(
    state: State<'_, AppState>,
    payload: CreateConversationMessageRequest,
) -> Result<LocalConversationHistoryMessage, String> {
    let state = &state.mcp;
    state
        .store
        .append_local_conversation_message(payload)
        .await
        .map_err(to_string)
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

    let (model_id, base_url, secret_key) = resolve_local_model_connection(
        app_state,
        &payload.model,
        payload.provider_model_id.as_deref(),
    )
    .await
    .map_err(to_string)?;

    let chat = run_local_chat_complete(
        mcp_state,
        LocalChatRequest {
            assistant_id: chat_ctx.assistant_id,
            model: model_id,
            messages: chat_ctx.messages,
            temperature: payload.temperature,
            top_p: payload.top_p,
            max_tokens: payload.max_tokens,
            base_url: Some(base_url),
            api_key: secret_key,
        },
    )
    .await
    .map_err(to_string)?;

    let assistant_message = mcp_state
        .store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: normalized_session_id.clone(),
            role: "assistant".to_string(),
            content: chat.content,
            name: None,
            meta_info: None,
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map_err(to_string)?;

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

    let (model_id, base_url, secret_key) = resolve_local_model_connection(
        app_state,
        &payload.model,
        payload.provider_model_id.as_deref(),
    )
    .await
    .map_err(to_string)?;

    let chat = run_local_chat_complete(
        mcp_state,
        LocalChatRequest {
            assistant_id: regenerate_ctx.assistant_id.clone(),
            model: model_id,
            messages: regenerate_ctx.messages.clone(),
            temperature: payload.temperature,
            top_p: payload.top_p,
            max_tokens: payload.max_tokens,
            base_url: Some(base_url),
            api_key: secret_key,
        },
    )
    .await
    .map_err(to_string)?;

    let message = mcp_state
        .store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: regenerate_ctx.session_id.clone(),
            role: "assistant".to_string(),
            content: chat.content,
            name: None,
            meta_info: None,
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map_err(to_string)?;

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
            .set_tool_status(&tool_id, McpToolStatus::Pending, None, Some(message.clone()))
            .await
            .map_err(to_string)?;
        app.emit(&format!("mcp-log://{}", tool_id), McpLogEntry {
            timestamp: now_rfc3339(),
            stream: crate::modules::mcp::types::McpLogStream::Event,
            message,
        }).ok();
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
pub async fn stop_mcp_tool(
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<McpTool, String> {
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
    state.store.update_tool_env(&tool_id, env).await.map_err(to_string)
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
    apply_pending_update(&state, &tool_id).await.map_err(to_string)
}

#[tauri::command]
pub async fn resolve_mcp_conflict(
    state: State<'_, AppState>,
    tool_id: String,
    payload: ResolveConflictRequest,
) -> Result<McpTool, String> {
    let state = &state.mcp;
    match payload.action.as_str() {
        "update" => apply_pending_update(&state, &tool_id).await.map_err(to_string),
        "keep" => {
            state.store.clear_pending_update(&tool_id).await.map_err(to_string)?;
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
pub async fn clear_mcp_logs(
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<(), String> {
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
    let url = format!("{}/api/v1/mcp/subscriptions", base_url.trim_end_matches('/'));
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

    let cloud_source = state.store.ensure_cloud_source(&base_url).await.map_err(to_string)?;
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
                state.store.upsert_tool(tool_upsert).await.map_err(to_string)?;
            }
        }
    }

    let all_tools = state.store.list_tools().await.map_err(to_string)?;
    for tool in all_tools.iter().filter(|t| t.source_id.as_deref() == Some(&cloud_source.id)) {
        let Some(identifier) = tool.identifier.clone() else { continue };
        if !seen_identifiers.contains(&identifier) {
            let _ = state
                .store
                .set_tool_status(&tool.id, McpToolStatus::Orphaned, None, Some("cloud subscription removed".to_string()))
                .await;
            app.emit(&format!("mcp-log://{}", tool.id), McpLogEntry {
                timestamp: now_rfc3339(),
                stream: crate::modules::mcp::types::McpLogStream::Event,
                message: "cloud subscription removed".to_string(),
            }).ok();
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
        let extracted: ExtractedToolFields = state.store.extract_tool_fields(&name, &config_payload);
        let name_conflict = state
            .store
            .has_name_conflict(&name, &source.id)
            .await?;

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
                        .ok_or_else(|| McpError::NotFound("tool missing after update".to_string()))?
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
            None => state
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
                .await?,
        };

        tools.push(tool);
    }

    Ok(tools)
}

async fn apply_pending_update(
    state: &McpRuntimeState,
    tool_id: &str,
) -> Result<McpTool, McpError> {
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
    let pending_payload: McpToolConfigPayload =
        serde_json::from_value(pending_value.clone()).map_err(|err| McpError::Storage(err.to_string()))?;
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
    map.insert("identifier".to_string(), serde_json::Value::String(tool.identifier.clone()));
    map.insert("name".to_string(), serde_json::Value::String(tool.name.clone()));
    map.insert("description".to_string(), serde_json::Value::String(tool.description.clone()));
    map.insert("command".to_string(), serde_json::Value::String(tool.install_manifest.command.clone()));
    map.insert(
        "args".to_string(),
        serde_json::Value::Array(tool.install_manifest.args.iter().cloned().map(serde_json::Value::String).collect()),
    );
    if let Some(runtime) = &tool.install_manifest.runtime {
        map.insert("runtime".to_string(), serde_json::Value::String(runtime.clone()));
    }
    if let Some(env_config) = &tool.install_manifest.env_config {
        map.insert("env_config".to_string(), serde_json::Value::Array(
            env_config.iter().cloned().map(serde_json::Value::Object).collect()
        ));
    }
    if let Some(tags) = &tool.tags {
        map.insert("tags".to_string(), serde_json::Value::Array(
            tags.iter().cloned().map(serde_json::Value::String).collect()
        ));
    }
    if let Some(category) = &tool.category {
        map.insert("category".to_string(), serde_json::Value::String(category.clone()));
    }
    if let Some(author) = &tool.author {
        map.insert("author".to_string(), serde_json::Value::String(author.clone()));
    }
    if let Some(is_official) = tool.is_official {
        map.insert("is_official".to_string(), serde_json::Value::Bool(is_official));
    }
    if let Some(avatar_url) = &tool.avatar_url {
        map.insert("avatar_url".to_string(), serde_json::Value::String(avatar_url.clone()));
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
        let required = item.get("required").and_then(|v| v.as_bool()).unwrap_or(false);
        if !required || key.is_empty() {
            continue;
        }
        let present = env.and_then(|env| env.get(key)).map(|v| !v.is_empty()).unwrap_or(false);
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
            map.insert("content".to_string(), parse_chat_message_content(&m.content));
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
            .ok_or_else(|| {
                McpError::NotFound(format!("assistant {assistant_id} not found"))
            })?;
        let system_prompt = assistant.system_prompt.trim().to_string();
        if !system_prompt.is_empty()
            && !messages.iter().any(|msg| msg.role == "system")
        {
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

async fn resolve_local_model_connection(
    app_state: &AppState,
    requested_model: &str,
    provider_model_id: Option<&str>,
) -> Result<(String, String, Option<String>), McpError> {
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
            .ok_or_else(|| McpError::NotFound("provider instance connection missing".to_string()))?;

        return Ok((model.model_id, connection.base_url, connection.secret_key));
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
            return Ok((model.model_id, connection.base_url, connection.secret_key));
        }
    }

    Err(McpError::NotFound(format!(
        "no active local provider model matches {}",
        normalized_model
    )))
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
