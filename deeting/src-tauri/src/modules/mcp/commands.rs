use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;

use log::warn;
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::modules::code_mode::types::ExecuteLocalCodeModeRequest;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::{
    expand_path, LocalConversationChatContext, NewSource, ToolUpsert,
};
use crate::modules::mcp::types::*;
use crate::modules::mcp::McpRuntimeState;
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize)]
struct CloudSubscriptionTool {
    identifier: String,
    name: String,
    source_url: Option<String>,
    capabilities: Vec<String>,
    description: String,
    config_json: String,
    config_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CloudSubscriptionItem {
    tool: CloudSubscriptionTool,
}

#[derive(Debug, Clone)]
struct LocalModelConnection {
    provider_model_id: String,
    model_id: String,
}

pub(crate) async fn index_local_assistants(app_state: &AppState, assistants: &[LocalAssistant]) {
    for assistant in assistants {
        let tags = if assistant.tags.is_empty() {
            String::new()
        } else {
            assistant.tags.join(", ")
        };
        let text = format!(
            "name: {}\ndescription: {}\ntags: {}",
            assistant.name,
            assistant.description.as_deref().unwrap_or(""),
            tags
        );
        if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            let _ = app_state
                .memory
                .store
                .upsert_asset(
                    assistant.id.clone(),
                    assistant.name.clone(),
                    assistant.description.clone().unwrap_or_default(),
                    "assistant".to_string(),
                    "local_assistant".to_string(),
                    None,
                    vector,
                    None,
                )
                .await;
        }
    }
}

fn to_string<T: std::fmt::Display>(err: T) -> String {
    err.to_string()
}

#[tauri::command]
pub async fn register_local_skills(
    app: AppHandle,
    app_state: State<'_, AppState>,
) -> Result<usize, String> {
    register_local_skills_inner(app, app_state.inner()).await
}

pub(crate) async fn register_local_skills_inner(
    app: AppHandle,
    app_state: &AppState,
) -> Result<usize, String> {
    let project_root = std::env::current_dir().unwrap();

    // 1. Official System Skills (Bundled with source)
    let official_skills_dir = project_root.join("packages/official-skills");

    // 2. User/Dynamic Skills (Standard App Data Directory)
    let user_skills_dir = app.path().app_data_dir().map_err(to_string)?.join("skills");

    if !user_skills_dir.exists() {
        let _ = std::fs::create_dir_all(&user_skills_dir);
    }

    let scan_targets = vec![
        (official_skills_dir, "system_plugin"),
        (user_skills_dir, "user_skill"),
    ];

    let mcp = &app_state.mcp;
    let store = &mcp.store;
    let mut total_indexed = 0;

    for (dir_path, source_prefix) in scan_targets {
        if !dir_path.exists() {
            continue;
        }

        for entry in std::fs::read_dir(dir_path).map_err(to_string)? {
            let skill_path = entry.map_err(to_string)?.path();
            if !skill_path.is_dir() {
                continue;
            }

            let deeting_json_path = skill_path.join("deeting.json");
            if !deeting_json_path.exists() {
                continue;
            }

            let deeting_json_str =
                std::fs::read_to_string(&deeting_json_path).map_err(to_string)?;
            let manifest: serde_json::Value =
                serde_json::from_str(&deeting_json_str).map_err(to_string)?;

            let id = manifest["id"].as_str().unwrap_or("");
            let tool_desc_prefix = manifest["description"].as_str().unwrap_or("");
            let source_id = format!("{}_{}", source_prefix, id);

            // Extract tools from llm-tool.yaml
            let llm_tool_path = skill_path.join("llm-tool.yaml");
            if !llm_tool_path.exists() {
                continue;
            }
            let llm_tool_str = std::fs::read_to_string(llm_tool_path).map_err(to_string)?;
            let llm_tools: serde_json::Value =
                serde_yaml::from_str(&llm_tool_str).map_err(to_string)?;

            // Prepare generic environment variables
            let mut env = HashMap::new();
            if let Some(reqs) = manifest.get("env_requirements").and_then(|v| v.as_array()) {
                for req in reqs {
                    if let Some(env_name) = req.as_str() {
                        if let Ok(val) = std::env::var(env_name) {
                            env.insert(env_name.to_string(), val);
                        }
                    }
                }
            }

            if let Some(tools_array) = llm_tools.get("tools").and_then(|v| v.as_array()) {
                for tool_def in tools_array {
                    let tool_name = tool_def["name"].as_str().unwrap();
                    let tool_desc = tool_def["description"].as_str().unwrap_or(tool_desc_prefix);
                    let config_json = serde_json::to_string(tool_def).unwrap();

                    let full_main_path = skill_path.join("main.py");
                    let pkg_name = id.split('.').last().unwrap_or(id);

                    let upsert = ToolUpsert {
                        id: None,
                        source_id: source_id.clone(),
                        identifier: Some(format!("{}/{}", id, tool_name)),
                        name: tool_name.to_string(),
                        source_type: McpSourceType::Local,
                        status: McpToolStatus::Healthy,
                        ping_ms: None,
                        capabilities: vec![source_prefix.to_string()],
                        description: tool_desc.to_string(),
                        error: None,
                        command: Some("python3".to_string()),
                        args: Some(vec![full_main_path.to_string_lossy().to_string()]),
                        env: if env.is_empty() {
                            None
                        } else {
                            Some(env.clone())
                        },
                        config_json,
                        config_hash: "system_builtin".to_string(),
                        pending_config_json: None,
                        pending_config_hash: None,
                        conflict_status: McpConflictStatus::None,
                        is_read_only: true,
                        is_new: false,
                    };

                    if let Ok(tool) = store.upsert_tool(upsert).await {
                        total_indexed += 1;
                        let app_state_clone = app_state.clone();
                        let tool_id = tool.id.clone();
                        let tool_name = tool.name.clone();
                        let tool_desc = tool.description.clone();
                        let final_pkg_name = pkg_name.to_string();
                        let final_source_type = if source_prefix == "system_plugin" {
                            "builtin"
                        } else {
                            "user"
                        };

                        tauri::async_runtime::spawn(async move {
                            let text = format!("name: {}\ndescription: {}", tool_name, tool_desc);
                            if let Ok(vector) =
                                app_state_clone.providers.embedding.embed_text(&text).await
                            {
                                let _ = app_state_clone
                                    .memory
                                    .store
                                    .upsert_asset(
                                        tool_id,
                                        tool_name,
                                        tool_desc,
                                        "tool".to_string(),
                                        final_source_type.to_string(),
                                        Some(final_pkg_name),
                                        vector,
                                        None,
                                    )
                                    .await;
                            }
                        });
                    }
                }
            }
        }
    }

    Ok(total_indexed)
}

#[tauri::command]
pub async fn sync_cloud_subscriptions(
    _app: AppHandle,
    state: State<'_, AppState>,
    access_token: String,
) -> Result<Vec<McpTool>, String> {
    sync_cloud_subscriptions_inner(&state.mcp, access_token).await
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
    let source = NewSource {
        name: payload.name,
        source_type: payload.source_type,
        path_or_url: payload.path_or_url,
        trust_level: payload.trust_level,
        status: McpSourceStatus::Active,
        last_synced_at: None,
        is_read_only: payload.is_read_only.unwrap_or(false),
    };
    state.store.insert_source(source).await.map_err(to_string)
}

#[tauri::command]
pub async fn sync_mcp_source(
    app_state: State<'_, AppState>,
    source_id: String,
    payload: SyncSourceRequest,
) -> Result<Vec<McpTool>, String> {
    let state = &app_state.mcp;
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

            // Background indexing for semantic search
            let app_state_clone = app_state.inner().clone();
            let tools_clone = tools.clone();
            tauri::async_runtime::spawn(async move {
                let _ = index_mcp_tools(&app_state_clone, &tools_clone).await;
            });

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
pub async fn list_local_assistant_tags(
    state: State<'_, AppState>,
) -> Result<Vec<LocalAssistantTag>, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_assistant_tags()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_assistant(
    app_state: State<'_, AppState>,
    payload: CreateLocalAssistantRequest,
) -> Result<String, String> {
    let state = &app_state.mcp;
    let assistant_id = state
        .store
        .create_local_assistant(payload)
        .await
        .map_err(to_string)?;

    // Index for semantic search
    if let Ok(Some(assistant)) = state.store.get_local_assistant(&assistant_id).await {
        let app_state_clone = app_state.inner().clone();
        tauri::async_runtime::spawn(async move {
            index_local_assistants(&app_state_clone, &[assistant]).await;
        });
    }

    Ok(assistant_id)
}

#[tauri::command]
pub async fn update_local_assistant(
    app_state: State<'_, AppState>,
    id: String,
    payload: UpdateLocalAssistantRequest,
) -> Result<LocalAssistant, String> {
    let state = &app_state.mcp;
    let assistant = state
        .store
        .update_local_assistant(&id, payload)
        .await
        .map_err(to_string)?;

    // Update index
    let app_state_clone = app_state.inner().clone();
    let assistant_clone = assistant.clone();
    tauri::async_runtime::spawn(async move {
        index_local_assistants(&app_state_clone, &[assistant_clone]).await;
    });

    Ok(assistant)
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
pub async fn create_assistant_message(
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
pub async fn update_assistant_message(
    _state: State<'_, AppState>,
    _id: String,
    _content: String,
) -> Result<LocalAssistantMessage, String> {
    Err("update assistant message is not supported in local store".to_string())
}

#[tauri::command]
pub async fn delete_assistant_message(
    _state: State<'_, AppState>,
    _id: String,
) -> Result<(), String> {
    Err("delete assistant message by message id is not supported in local store".to_string())
}

#[tauri::command]
pub async fn list_local_conversation_sessions(
    state: State<'_, AppState>,
    query: LocalConversationSessionsQuery,
) -> Result<LocalConversationSessionPage, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_conversations(query)
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
pub async fn create_local_conversation_session(
    state: State<'_, AppState>,
    payload: LocalConversationCreateRequest,
) -> Result<LocalConversationCreateResponse, String> {
    let state = &state.mcp;
    state
        .store
        .create_local_conversation(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn rename_local_conversation_session(
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
pub async fn delete_local_conversation_session(
    _state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationDeleteResponse, String> {
    Err(format!(
        "delete conversation session is not supported, use close/archive instead: {}",
        session_id
    ))
}

#[tauri::command]
pub async fn archive_local_conversation_session(
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
pub async fn clear_local_conversation_session(
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
pub async fn list_local_conversation_history(
    state: State<'_, AppState>,
    query: LocalConversationHistoryQuery,
) -> Result<LocalConversationHistoryResponse, String> {
    let state = &state.mcp;
    let session_id = query
        .session_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "session_id is required".to_string())?;
    state
        .store
        .get_local_conversation_history(&session_id, query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn send_local_conversation_message(
    app: AppHandle,
    app_state: State<'_, AppState>,
    payload: LocalConversationSendRequest,
) -> Result<LocalConversationSendResponse, String> {
    let state = &app_state.mcp;
    let conversation_repo = &state.store;

    let trace_id = Uuid::new_v4().to_string();
    let request_id = payload
        .request_id
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let session_id = payload.session_id.clone();

    emit_local_chat_stream_status(
        &app,
        request_id.as_deref(),
        &trace_id,
        "request_received",
        "local_send_start",
        Some(serde_json::json!({ "session_id": session_id })),
    );

    let execution: Result<LocalConversationSendResponse, String> = async {
        let user_message = conversation_repo
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session_id.clone(),
                role: "user".to_string(),
                content: payload.content.clone(),
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .map_err(to_string)?;
        let chat_ctx = conversation_repo
            .get_local_conversation_chat_context(&session_id)
            .await
            .map_err(to_string)?;

        emit_local_chat_stream_status(
            &app,
            request_id.as_deref(),
            &trace_id,
            "context_ready",
            "local_send_context_ready",
            Some(serde_json::json!({
                "assistant_id": chat_ctx.assistant_id,
                "provider_model_id": payload.provider_model_id,
            })),
        );

        let model_connection = resolve_local_model_connection(
            app_state.inner(),
            &payload.model,
            payload.provider_model_id.as_deref(),
        )
            .await
            .map_err(to_string)?;

        emit_local_chat_stream_status(
            &app,
            request_id.as_deref(),
            &trace_id,
            "model_request",
            "local_send_model_request",
            Some(serde_json::json!({
                "provider_model_id": model_connection.provider_model_id,
                "model_id": model_connection.model_id,
            })),
        );

        let response_json = run_local_chat_complete_with_auto_code_mode(
            app_state.inner(),
            &model_connection,
            chat_ctx.messages.clone(),
            &chat_ctx,
        )
        .await?;

        let response_text = response_json["content"].as_str().unwrap_or("").to_string();

        emit_local_chat_stream_status(
            &app,
            request_id.as_deref(),
            &trace_id,
            "assistant_stream",
            "local_send_assistant_stream",
            None,
        );
        emit_local_chat_stream_delta_chunks(
            &app,
            request_id.as_deref(),
            &trace_id,
            &response_text,
        );
        if !response_text.trim().is_empty() {
            emit_local_chat_stream_blocks(
                &app,
                request_id.as_deref(),
                &trace_id,
                serde_json::json!([{ "type": "text", "content": response_text }]),
            );
        }

        let assistant_message = conversation_repo
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session_id.clone(),
                role: "assistant".to_string(),
                content: response_text.clone(),
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .map_err(to_string)?;

        let _ = conversation_repo
            .touch_local_conversation_summary_idle_task(&session_id)
            .await;

        Ok(LocalConversationSendResponse {
            session_id: session_id.clone(),
            user_message,
            assistant_message,
        })
    }
    .await;

    match execution {
        Ok(response) => {
            emit_local_chat_stream_done(&app, request_id.as_deref(), &trace_id);
            Ok(response)
        }
        Err(err) => {
            emit_local_chat_stream_error(&app, request_id.as_deref(), &trace_id, &err);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn regenerate_local_conversation_reply(
    app: AppHandle,
    app_state: State<'_, AppState>,
    payload: LocalConversationRegenerateRequest,
) -> Result<LocalConversationRegenerateResponse, String> {
    let state = &app_state.mcp;
    let conversation_repo = &state.store;
    let trace_id = Uuid::new_v4().to_string();
    let request_id = payload
        .request_id
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    emit_local_chat_stream_status(
        &app,
        request_id.as_deref(),
        &trace_id,
        "request_received",
        "local_regenerate_start",
        Some(serde_json::json!({ "session_id": payload.session_id })),
    );

    let execution: Result<LocalConversationRegenerateResponse, String> = async {
        let regenerate_ctx = conversation_repo
            .prepare_local_conversation_regenerate(&payload.session_id)
            .await
            .map_err(to_string)?;

        let model_connection = resolve_local_model_connection(
            app_state.inner(),
            &payload.model,
            payload.provider_model_id.as_deref(),
        )
            .await
            .map_err(to_string)?;
        let chat_ctx = LocalConversationChatContext {
            session_id: regenerate_ctx.session_id.clone(),
            assistant_id: regenerate_ctx.assistant_id.clone(),
            messages: regenerate_ctx.messages.clone(),
        };

        emit_local_chat_stream_status(
            &app,
            request_id.as_deref(),
            &trace_id,
            "model_request",
            "local_regenerate_model_request",
            Some(serde_json::json!({
                "provider_model_id": model_connection.provider_model_id,
                "model_id": model_connection.model_id,
            })),
        );

        let response_json = run_local_chat_complete_with_auto_code_mode(
            app_state.inner(),
            &model_connection,
            regenerate_ctx.messages,
            &chat_ctx,
        )
        .await?;

        let response_text = response_json["content"].as_str().unwrap_or("").to_string();

        emit_local_chat_stream_status(
            &app,
            request_id.as_deref(),
            &trace_id,
            "assistant_stream",
            "local_regenerate_assistant_stream",
            None,
        );
        emit_local_chat_stream_delta_chunks(
            &app,
            request_id.as_deref(),
            &trace_id,
            &response_text,
        );
        if !response_text.trim().is_empty() {
            emit_local_chat_stream_blocks(
                &app,
                request_id.as_deref(),
                &trace_id,
                serde_json::json!([{ "type": "text", "content": response_text }]),
            );
        }

        let assistant_message = conversation_repo
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: payload.session_id.clone(),
                role: "assistant".to_string(),
                content: response_text,
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .map_err(to_string)?;
        let _ = conversation_repo
            .touch_local_conversation_summary_idle_task(&payload.session_id)
            .await;

        Ok(LocalConversationRegenerateResponse {
            session_id: payload.session_id.clone(),
            deleted_turn_index: regenerate_ctx.deleted_turn_index,
            message: assistant_message,
        })
    }
    .await;

    match execution {
        Ok(response) => {
            emit_local_chat_stream_done(&app, request_id.as_deref(), &trace_id);
            Ok(response)
        }
        Err(err) => {
            emit_local_chat_stream_error(&app, request_id.as_deref(), &trace_id, &err);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn import_mcp_config(
    app_state: State<'_, AppState>,
    payload: ImportConfigRequest,
) -> Result<Vec<McpTool>, String> {
    let state = &app_state.mcp;
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

    let tools = apply_config_payload(&state, &source, payload.config)
        .await
        .map_err(to_string)?;

    // Background indexing for semantic search
    let app_state_clone = app_state.inner().clone();
    let tools_clone = tools.clone();
    tauri::async_runtime::spawn(async move {
        let _ = index_mcp_tools(&app_state_clone, &tools_clone).await;
    });

    Ok(tools)
}

#[tauri::command]
pub async fn start_mcp_tool(
    _app: AppHandle,
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<(), String> {
    let state = &state.mcp;
    let tool = state
        .store
        .get_tool(&tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", tool_id))?;

    if tool.command.is_none() {
        return Err("tool is not executable (no command)".to_string());
    }

    state
        .process_manager
        .start_tool(tool, true)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn stop_mcp_tool(state: State<'_, AppState>, tool_id: String) -> Result<(), String> {
    let state = &state.mcp;
    state
        .process_manager
        .stop_tool(&tool_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn execute_mcp_tool_raw(
    _app: AppHandle,
    state: State<'_, AppState>,
    tool_name: String,
    arguments: Value,
) -> Result<Value, String> {
    let require_approval = state.mcp.is_high_risk_tool(&tool_name);
    execute_or_queue_mcp_tool_call(
        state.mcp.store.as_ref(),
        state.mcp.pending_tool_calls.as_ref(),
        tool_name,
        arguments,
        require_approval,
    )
    .await
}

#[tauri::command]
pub async fn update_mcp_tool_env(
    state: State<'_, AppState>,
    tool_id: String,
    payload: UpdateToolConfigRequest,
) -> Result<(), String> {
    let state = &state.mcp;
    if payload.apply_pending {
        state
            .store
            .clear_pending_update(&tool_id)
            .await
            .map_err(to_string)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn apply_pending_config(
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .clear_pending_update(&tool_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn resolve_mcp_conflict(
    _state: State<'_, AppState>,
    _payload: ResolveConflictRequest,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn get_mcp_logs(
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<Vec<Value>, String> {
    let state = &state.mcp;
    let logs = state.process_manager.logs(&tool_id).await;
    Ok(logs.into_iter().map(|l| serde_json::json!(l)).collect())
}

#[tauri::command]
pub async fn clear_mcp_logs(state: State<'_, AppState>, tool_id: String) -> Result<(), String> {
    let state = &state.mcp;
    state.process_manager.clear_logs(&tool_id).await;
    Ok(())
}

pub(crate) async fn index_mcp_tools(app_state: &AppState, tools: &[McpTool]) {
    for tool in tools {
        let text = format!("name: {}\ndescription: {}", tool.name, tool.description);
        if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            let _ = app_state
                .memory
                .store
                .upsert_asset(
                    tool.id.clone(),
                    tool.name.clone(),
                    tool.description.clone(),
                    "tool".to_string(),
                    "mcp".to_string(),
                    tool.identifier.clone(),
                    vector,
                    None,
                )
                .await;
        }
    }
}

#[tauri::command]
pub async fn sync_cloud_subscriptions_v2(
    _app: AppHandle,
    state: State<'_, AppState>,
    access_token: String,
) -> Result<Vec<McpTool>, String> {
    sync_cloud_subscriptions_inner(&state.mcp, access_token).await
}

async fn sync_cloud_subscriptions_inner(
    state: &McpRuntimeState,
    access_token: String,
) -> Result<Vec<McpTool>, String> {
    let base_url = state.cloud_base_url.read().await.clone();
    let url = format!(
        "{}/api/v1/mcp/subscriptions",
        base_url.trim_end_matches('/')
    );
    let response = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(to_string)?;

    if !response.status().is_success() {
        return Err(format!(
            "failed to sync subscriptions: {}",
            response.status()
        ));
    }

    let subscriptions: Vec<CloudSubscriptionItem> = response.json().await.map_err(to_string)?;
    let mut synced_tools = Vec::new();

    for sub in subscriptions {
        let source_url = sub
            .tool
            .source_url
            .clone()
            .unwrap_or_else(|| base_url.clone());
        let cloud_source = state
            .store
            .ensure_cloud_source(&source_url)
            .await
            .map_err(to_string)?;

        let tool = sub.tool;
        let upsert = ToolUpsert {
            id: None,
            source_id: cloud_source.id.clone(),
            identifier: Some(tool.identifier.clone()),
            name: tool.name.clone(),
            source_type: McpSourceType::Cloud,
            status: McpToolStatus::Healthy,
            ping_ms: None,
            capabilities: tool.capabilities.clone(),
            description: tool.description.clone(),
            error: None,
            command: None,
            args: None,
            env: None,
            config_json: tool.config_json.clone(),
            config_hash: tool.config_hash.clone(),
            pending_config_json: None,
            pending_config_hash: None,
            conflict_status: McpConflictStatus::None,
            is_read_only: false,
            is_new: false,
        };

        if let Ok(synced) = state.store.upsert_tool(upsert).await {
            synced_tools.push(synced);
        }
    }

    Ok(synced_tools)
}

#[tauri::command]
pub async fn list_local_knowledge_files(
    state: State<'_, AppState>,
    query: LocalUserDocumentListQuery,
) -> Result<Vec<LocalKnowledgeFile>, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_user_documents(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_knowledge_folders(
    state: State<'_, AppState>,
) -> Result<Vec<LocalKnowledgeFolder>, String> {
    let state = &state.mcp;
    let tree = state
        .store
        .get_local_knowledge_tree(LocalKnowledgeTreeQuery {
            parent_id: None,
            q: None,
            sort_field: None,
            sort_direction: None,
        })
        .await
        .map_err(to_string)?;
    Ok(tree.folders)
}

#[tauri::command]
pub async fn get_local_knowledge_tree(
    state: State<'_, AppState>,
    query: LocalKnowledgeTreeQuery,
) -> Result<LocalKnowledgeTreeResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_knowledge_tree(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_knowledge_folder(
    state: State<'_, AppState>,
    payload: CreateLocalKnowledgeFolderRequest,
) -> Result<LocalKnowledgeFolder, String> {
    let state = &state.mcp;
    state
        .store
        .create_local_knowledge_folder(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_local_knowledge_folder(
    state: State<'_, AppState>,
    id: String,
    payload: UpdateLocalKnowledgeFolderRequest,
) -> Result<LocalKnowledgeFolder, String> {
    let state = &state.mcp;
    state
        .store
        .update_local_knowledge_folder(&id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_knowledge_folder(
    state: State<'_, AppState>,
    id: String,
    recursive: Option<bool>,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .delete_local_knowledge_folder(&id, recursive.unwrap_or(false))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_user_document(
    state: State<'_, AppState>,
    payload: CreateLocalUserDocumentRequest,
) -> Result<LocalKnowledgeFile, String> {
    let state = &state.mcp;
    state
        .store
        .create_local_user_document(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_knowledge_stats(
    state: State<'_, AppState>,
) -> Result<LocalKnowledgeStatsResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_knowledge_stats()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_trace_feedback(
    state: State<'_, AppState>,
    payload: LocalTraceFeedbackRequest,
) -> Result<LocalTraceFeedback, String> {
    let state = &state.mcp;
    state
        .store
        .create_local_trace_feedback(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_assistant_routing_report(
    state: State<'_, AppState>,
    query: LocalAssistantRoutingReportQuery,
) -> Result<LocalAssistantRoutingReportResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_assistant_routing_report(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn record_local_assistant_routing_feedback(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantRoutingFeedbackRequest,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .record_local_assistant_routing_feedback(&assistant_id, payload)
        .await
        .map_err(to_string)?;
    Ok(())
}

#[tauri::command]
pub async fn get_local_assistant_preview(
    state: State<'_, AppState>,
    assistant_id: String,
    _payload: LocalAssistantPreviewRequest,
) -> Result<LocalAssistant, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_assistant(&assistant_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "assistant not found".to_string())
}

#[tauri::command]
pub async fn record_local_assistant_rating(
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
pub async fn list_local_assistant_installations(
    state: State<'_, AppState>,
    query: LocalAssistantInstallQuery,
) -> Result<LocalAssistantInstallPage, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_assistant_installs(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_assistant_installation(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallCreateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    let state = &state.mcp;
    state
        .store
        .install_local_assistant(&assistant_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_local_assistant_installation(
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
pub async fn delete_local_assistant_installation(
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
pub async fn list_local_admin_conversations(
    state: State<'_, AppState>,
    query: LocalAdminConversationQuery,
) -> Result<LocalAdminConversationListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_admin_conversations(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_admin_conversation_messages(
    state: State<'_, AppState>,
    session_id: String,
    query: LocalAdminConversationMessageQuery,
) -> Result<LocalAdminConversationMessageListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_admin_conversation_messages(&session_id, query)
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
pub async fn get_local_conversation_summary_queue_stats(
    state: State<'_, AppState>,
) -> Result<LocalConversationSummaryQueueStats, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_conversation_summary_queue_stats()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversation_summary_jobs(
    state: State<'_, AppState>,
    query: LocalConversationSummaryJobQuery,
) -> Result<LocalConversationSummaryJobListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_conversation_summary_jobs(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversation_summary_idle_tasks(
    state: State<'_, AppState>,
    query: LocalConversationSummaryIdleTaskQuery,
) -> Result<LocalConversationSummaryIdleTaskListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_conversation_summary_idle_tasks(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn enqueue_local_conversation_summary(
    state: State<'_, AppState>,
    session_id: String,
    _assistant_id: String,
) -> Result<LocalConversationSummaryEnqueueResponse, String> {
    let state = &state.mcp;
    state
        .store
        .trigger_local_conversation_summary_job(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn retry_local_conversation_summary_batch(
    state: State<'_, AppState>,
    payload: LocalConversationSummaryBatchRetryRequest,
) -> Result<LocalConversationSummaryBatchRetryResponse, String> {
    let state = &state.mcp;
    state
        .store
        .retry_local_conversation_summary_jobs(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_gateway_logs(
    state: State<'_, AppState>,
    query: LocalGatewayLogQuery,
) -> Result<LocalGatewayLogListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_gateway_logs(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_gateway_log(
    state: State<'_, AppState>,
    payload: LocalGatewayLogItem,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .create_local_gateway_log(
            payload.trace_id.as_deref(),
            &payload.model,
            payload.status_code,
            payload.duration_ms,
            payload.ttft_ms,
            None,
            0,
            payload.input_tokens,
            payload.output_tokens,
            payload.input_tokens.saturating_add(payload.output_tokens),
            payload.cost_user,
            payload.cost_user,
            payload.is_cached,
            payload.error_code.as_deref(),
            None,
        )
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_gateway_log_stats(
    state: State<'_, AppState>,
) -> Result<LocalGatewayLogStatsResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_gateway_log_stats(LocalGatewayLogQuery {
            skip: None,
            limit: None,
            model: None,
            status_code: None,
            is_cached: None,
        })
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn sync_official_skills_index(app_state: State<'_, AppState>) -> Result<usize, String> {
    let state = &app_state.mcp;
    let base_url = state.cloud_base_url.read().await.clone();
    let url = format!(
        "{}/api/v1/plugin-market/?limit=100",
        base_url.trim_end_matches('/')
    );

    let response = state.client.get(&url).send().await.map_err(to_string)?;
    if !response.status().is_success() {
        return Err("failed to fetch marketplace index".to_string());
    }

    let skills: Vec<serde_json::Value> = response.json().await.map_err(to_string)?;
    let count = skills.len();

    for skill in skills {
        let id = skill["id"].as_str().unwrap_or("").to_string();
        let name = skill["name"].as_str().unwrap_or("").to_string();
        let desc = skill["description"].as_str().unwrap_or("").to_string();

        let app_state_clone = app_state.inner().clone();
        tauri::async_runtime::spawn(async move {
            let text = format!("name: {}\ndescription: {}", name, desc);
            if let Ok(vector) = app_state_clone.providers.embedding.embed_text(&text).await {
                let _ = app_state_clone
                    .memory
                    .store
                    .upsert_asset(
                        id,
                        name,
                        desc,
                        "skill".to_string(),
                        "cloud_mirror".to_string(),
                        None,
                        vector,
                        Some(skill),
                    )
                    .await;
            }
        });
    }

    Ok(count)
}

#[tauri::command]
pub async fn set_cloud_base_url(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let normalized = url.trim().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return Err("cloud base url is required".to_string());
    }
    *state.mcp.cloud_base_url.write().await = normalized;
    Ok(())
}

#[tauri::command]
pub async fn list_local_assistant_versions(
    state: State<'_, AppState>,
    assistant_id: Option<String>,
) -> Result<Vec<LocalAssistantVersion>, String> {
    state
        .mcp
        .store
        .list_local_assistant_versions(assistant_id.as_deref())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_installs(
    state: State<'_, AppState>,
    query: LocalAssistantInstallQuery,
) -> Result<LocalAssistantInstallPage, String> {
    list_local_assistant_installations(state, query).await
}

#[tauri::command]
pub async fn install_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallCreateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    create_local_assistant_installation(state, assistant_id, payload).await
}

#[tauri::command]
pub async fn update_local_assistant_install(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallUpdateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    update_local_assistant_installation(state, assistant_id, payload).await
}

#[tauri::command]
pub async fn uninstall_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<(), String> {
    delete_local_assistant_installation(state, assistant_id).await
}

#[tauri::command]
pub async fn rate_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantRatingRequest,
) -> Result<LocalAssistantRatingResponse, String> {
    record_local_assistant_rating(state, assistant_id, payload).await
}

#[tauri::command]
pub async fn record_local_assistant_routing_trial(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<LocalAssistantRoutingState, String> {
    state
        .mcp
        .store
        .record_local_assistant_routing_trial(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_user_documents(
    state: State<'_, AppState>,
    query: LocalUserDocumentListQuery,
) -> Result<Vec<LocalKnowledgeFile>, String> {
    state
        .mcp
        .store
        .list_local_user_documents(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<LocalKnowledgeFile, String> {
    state
        .mcp
        .store
        .get_local_user_document(&file_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
    payload: UpdateLocalUserDocumentRequest,
) -> Result<LocalKnowledgeFile, String> {
    state
        .mcp
        .store
        .update_local_user_document(&file_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<(), String> {
    state
        .mcp
        .store
        .delete_local_user_document(&file_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn retry_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<LocalKnowledgeFile, String> {
    state
        .mcp
        .store
        .retry_local_user_document(&file_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_user_document_chunks(
    state: State<'_, AppState>,
    file_id: String,
    query: LocalUserDocumentChunkListQuery,
) -> Result<LocalKnowledgeChunkListResponse, String> {
    state
        .mcp
        .store
        .list_local_user_document_chunks(&file_id, query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_admin_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalAdminConversationItem, String> {
    state
        .mcp
        .store
        .get_local_admin_conversation(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn trigger_local_conversation_summary_job(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationSummaryEnqueueResponse, String> {
    state
        .mcp
        .store
        .trigger_local_conversation_summary_job(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn retry_local_conversation_summary_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<LocalConversationSummaryEnqueueResponse, String> {
    state
        .mcp
        .store
        .retry_local_conversation_summary_job(&job_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn retry_local_conversation_summary_jobs(
    state: State<'_, AppState>,
    payload: LocalConversationSummaryBatchRetryRequest,
) -> Result<LocalConversationSummaryBatchRetryResponse, String> {
    state
        .mcp
        .store
        .retry_local_conversation_summary_jobs(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn append_assistant_message(
    state: State<'_, AppState>,
    payload: CreateAssistantMessageRequest,
) -> Result<LocalAssistantMessage, String> {
    create_assistant_message(state, payload).await
}

#[tauri::command]
pub async fn preview_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantPreviewRequest,
) -> Result<serde_json::Value, String> {
    let assistant = state
        .mcp
        .store
        .get_local_assistant(&assistant_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "assistant not found".to_string())?;

    let model_from_config = assistant
        .model_config
        .as_ref()
        .and_then(|value| value.get("model"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "default".to_string());
    let provider_model_id = assistant
        .model_config
        .as_ref()
        .and_then(|value| value.get("provider_model_id"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let model_connection = resolve_local_model_connection(
        state.inner(),
        &model_from_config,
        provider_model_id.as_deref(),
    )
    .await?;

    let messages = vec![
        LocalChatInputMessage {
            role: "system".to_string(),
            content: assistant.system_prompt,
        },
        LocalChatInputMessage {
            role: "user".to_string(),
            content: payload.message,
        },
    ];
    let response = request_provider_chat_completion(
        state.inner(),
        &model_connection.provider_model_id,
        &model_connection.model_id,
        messages,
        None,
        payload.temperature,
        payload.max_tokens,
    )
    .await?;
    let content = response
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    Ok(serde_json::json!({ "content": content }))
}

#[tauri::command]
pub async fn delete_assistant_messages(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<(), String> {
    state
        .mcp
        .store
        .delete_assistant_messages(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversations(
    state: State<'_, AppState>,
    query: LocalConversationSessionsQuery,
) -> Result<LocalConversationSessionPage, String> {
    list_local_conversation_sessions(state, query).await
}

#[tauri::command]
pub async fn create_local_conversation(
    state: State<'_, AppState>,
    payload: LocalConversationCreateRequest,
) -> Result<LocalConversationCreateResponse, String> {
    create_local_conversation_session(state, payload).await
}

#[tauri::command]
pub async fn archive_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    archive_local_conversation_session(state, session_id).await
}

#[tauri::command]
pub async fn close_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    state
        .mcp
        .store
        .update_local_conversation_status(&session_id, LocalConversationStatus::Closed)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn unarchive_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    state
        .mcp
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
    rename_local_conversation_session(state, session_id, payload).await
}

#[tauri::command]
pub async fn append_local_conversation_message(
    state: State<'_, AppState>,
    payload: CreateConversationMessageRequest,
) -> Result<LocalConversationHistoryMessage, String> {
    state
        .mcp
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
    state
        .mcp
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
    state
        .mcp
        .store
        .clear_local_conversation(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn approve_mcp_tool(
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
) -> Result<Value, String> {
    let token = approval_token
        .or(approvalToken)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "approval token is required".to_string())?;

    approve_mcp_tool_inner(
        state.mcp.store.as_ref(),
        state.mcp.pending_tool_calls.as_ref(),
        &token,
    )
    .await
}

#[tauri::command]
pub async fn reject_mcp_tool(
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
) -> Result<(), String> {
    let token = approval_token
        .or(approvalToken)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "approval token is required".to_string())?;
    reject_mcp_tool_inner(state.mcp.pending_tool_calls.as_ref(), &token).await;
    Ok(())
}

pub(crate) async fn rebuild_local_knowledge_vector_index(app_state: &AppState) -> Result<usize, String> {
    let files = app_state
        .mcp
        .store
        .list_local_user_documents(LocalUserDocumentListQuery {
            folder_id: None,
            status: None,
            q: None,
        })
        .await
        .map_err(to_string)?;
    let mut indexed = 0usize;
    for file in files {
        let text = format!(
            "name: {}\nstatus: {}\nsize: {}\nchunks: {}",
            file.name,
            file.status,
            file.size,
            file.chunks.unwrap_or(0)
        );
        if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            let _ = app_state
                .memory
                .store
                .upsert_asset(
                    file.id,
                    file.name,
                    format!("local knowledge file ({})", file.file_type),
                    "knowledge_file".to_string(),
                    "local_knowledge".to_string(),
                    None,
                    vector,
                    None,
                )
                .await;
            indexed = indexed.saturating_add(1);
        }
    }
    Ok(indexed)
}

async fn resolve_local_model_connection(
    app_state: &AppState,
    requested_model: &str,
    requested_provider_model_id: Option<&str>,
) -> Result<LocalModelConnection, String> {
    if let Some(provider_model_id) = requested_provider_model_id {
        let provider_model_id = provider_model_id.trim();
        if !provider_model_id.is_empty() {
            let model_uuid = Uuid::parse_str(provider_model_id).map_err(to_string)?;
            let model = app_state
                .providers
                .store
                .get_model(&model_uuid)
                .await
                .map_err(to_string)?
                .ok_or_else(|| "provider model not found".to_string())?;
            return Ok(LocalModelConnection {
                provider_model_id: model.id.to_string(),
                model_id: model.model_id,
            });
        }
    }

    let models = app_state
        .providers
        .store
        .list_active_models()
        .await
        .map_err(to_string)?;
    if models.is_empty() {
        return Err("no active provider model configured".to_string());
    }
    let requested = requested_model.trim().to_lowercase();
    let selected = models
        .iter()
        .find(|model| {
            if requested.is_empty() {
                return false;
            }
            model.model_id.eq_ignore_ascii_case(&requested)
                || model
                    .unified_model_id
                    .as_deref()
                    .map(|value| value.eq_ignore_ascii_case(&requested))
                    .unwrap_or(false)
                || model
                    .display_name
                    .as_deref()
                    .map(|value| value.eq_ignore_ascii_case(&requested))
                    .unwrap_or(false)
        })
        .cloned()
        .unwrap_or_else(|| models[0].clone());

    Ok(LocalModelConnection {
        provider_model_id: selected.id.to_string(),
        model_id: selected.model_id,
    })
}

async fn request_provider_chat_completion(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    messages: Vec<LocalChatInputMessage>,
    tools: Option<serde_json::Value>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
) -> Result<serde_json::Value, String> {
    let provider_model_uuid = Uuid::parse_str(provider_model_id).map_err(to_string)?;
    let model = app_state
        .providers
        .store
        .get_model(&provider_model_uuid)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider model not found".to_string())?;
    let connection = app_state
        .providers
        .store
        .get_instance_connection(&model.instance_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider instance not found".to_string())?;

    let endpoint = build_upstream_endpoint(&connection.base_url, &model.upstream_path);
    let mut body = serde_json::json!({
        "model": if model_id.trim().is_empty() { model.model_id.clone() } else { model_id.to_string() },
        "messages": messages,
        "stream": false
    });
    if let Some(temperature) = temperature {
        body["temperature"] = serde_json::json!(temperature);
    }
    if let Some(max_tokens) = max_tokens {
        body["max_tokens"] = serde_json::json!(max_tokens);
    }
    if let Some(tools) = tools {
        body["tools_catalog"] = tools;
    }

    let mut request = reqwest::Client::new().post(&endpoint).json(&body);
    if let Some(secret_key) = connection.secret_key.as_deref() {
        if !secret_key.trim().is_empty() {
            request = request.bearer_auth(secret_key.trim());
        }
    }

    let response = request.send().await.map_err(to_string)?;
    let status = response.status();
    let raw: serde_json::Value = response.json().await.map_err(to_string)?;
    if !status.is_success() {
        return Err(
            raw.get("error")
                .and_then(|value| value.get("message"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
                .unwrap_or_else(|| format!("upstream status {}", status.as_u16())),
        );
    }
    Ok(normalize_chat_completion_response(raw))
}

fn normalize_chat_completion_response(raw: serde_json::Value) -> serde_json::Value {
    if raw.get("content").is_some() && raw.get("tool_calls").is_some() {
        return raw;
    }

    let mut content = raw
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let mut normalized_tool_calls = Vec::<serde_json::Value>::new();

    if let Some(choice) = raw
        .get("choices")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
    {
        if let Some(message) = choice.get("message") {
            if content.is_empty() {
                content = message
                    .get("content")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string();
            }
            if let Some(tool_calls) = message.get("tool_calls").and_then(|value| value.as_array()) {
                for call in tool_calls {
                    let function_name = call
                        .get("function")
                        .and_then(|value| value.get("name"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    let arguments = call
                        .get("function")
                        .and_then(|value| value.get("arguments"))
                        .and_then(|value| value.as_str())
                        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
                        .unwrap_or_else(|| serde_json::json!({}));
                    normalized_tool_calls.push(serde_json::json!({
                        "id": call.get("id").and_then(|value| value.as_str()).unwrap_or_default(),
                        "name": function_name,
                        "arguments": arguments
                    }));
                }
            }
        }
    }

    serde_json::json!({
        "content": content,
        "tool_calls": normalized_tool_calls
    })
}

fn build_upstream_endpoint(base_url: &str, upstream_path: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    let path = upstream_path.trim().trim_start_matches('/').to_string();
    if path.is_empty() {
        if base.ends_with("/v1") {
            return format!("{base}/chat/completions");
        }
        return format!("{base}/v1/chat/completions");
    }
    format!("{base}/{path}")
}

async fn execute_local_mcp_tool(tool: &McpTool, arguments: &Value) -> Result<Value, String> {
    let command = tool
        .command
        .clone()
        .ok_or_else(|| format!("tool {} has no executable command", tool.name))?;
    let mut cmd = tokio::process::Command::new(command);
    if let Some(args) = &tool.args {
        cmd.args(args);
    }
    if let Some(env) = &tool.env {
        cmd.envs(env);
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(to_string)?;
    if let Some(mut stdin) = child.stdin.take() {
        let payload = serde_json::json!({
            "method": tool.name,
            "arguments": arguments
        });
        let payload_bytes = serde_json::to_vec(&payload).map_err(to_string)?;
        stdin.write_all(&payload_bytes).await.map_err(to_string)?;
    }

    let output = child.wait_with_output().await.map_err(to_string)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "tool execution failed (exit={}): {}",
            output.status, stderr
        ));
    }
    if output.stdout.is_empty() {
        return Ok(serde_json::json!({ "ok": true }));
    }
    match serde_json::from_slice::<serde_json::Value>(&output.stdout) {
        Ok(parsed) => Ok(parsed),
        Err(_) => Ok(serde_json::json!({
            "ok": true,
            "raw": String::from_utf8_lossy(&output.stdout).to_string()
        })),
    }
}

pub(crate) async fn sync_source_inner(
    state: &McpRuntimeState,
    source: McpSource,
    auth_token: Option<String>,
) -> Result<Vec<McpTool>, McpError> {
    let tools = match source.source_type {
        McpSourceType::Local => {
            let path = expand_path(&source.path_or_url);
            let config_json =
                std::fs::read_to_string(path).map_err(|err| McpError::Storage(err.to_string()))?;
            let config: McpConfigPayload = serde_json::from_str(&config_json)
                .map_err(|err| McpError::Storage(err.to_string()))?;
            apply_config_payload(state, &source, config).await?
        }
        McpSourceType::Cloud | McpSourceType::Modelscope | McpSourceType::Github | McpSourceType::Url => {
            let mut request = state.client.get(&source.path_or_url);
            if let Some(token) = auth_token {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
            let response = request
                .send()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;

            if !response.status().is_success() {
                return Err(McpError::Network(format!(
                    "failed to fetch cloud config: {}",
                    response.status()
                )));
            }

            let config: McpConfigPayload = response
                .json()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;
            apply_config_payload(state, &source, config).await?
        }
    };

    Ok(tools)
}

async fn apply_config_payload(
    state: &McpRuntimeState,
    source: &McpSource,
    payload: McpConfigPayload,
) -> Result<Vec<McpTool>, McpError> {
    let mut tools = Vec::new();
    let is_read_only = source.source_type == McpSourceType::Cloud;

    for (name, config) in payload.mcp_servers {
        let identifier = format!("{}/{}", source.id, name);
        let existing_tool = state
            .store
            .get_tool_by_source_name(&source.id, &name)
            .await?;

        let tool = match existing_tool {
            Some(existing_tool) => {
                let config_json = serde_json::to_string(&config).unwrap();
                let config_hash = hash_config(&config_json);

                if config_hash == existing_tool.config_hash {
                    state
                        .store
                        .set_tool_status(&existing_tool.id, McpToolStatus::Healthy, None, None)
                        .await?;
                    existing_tool
                } else {
                    state
                        .store
                        .upsert_tool(ToolUpsert {
                            id: Some(existing_tool.id.clone()),
                            source_id: source.id.clone(),
                            identifier: Some(identifier),
                            name: name.clone(),
                            source_type: source.source_type.clone(),
                            status: McpToolStatus::Healthy,
                            ping_ms: None,
                            capabilities: config.capabilities.clone().unwrap_or_default(),
                            description: config.description.clone().unwrap_or_default(),
                            error: None,
                            command: config.command.clone(),
                            args: config.args.clone(),
                            env: config.env.clone(),
                            config_json,
                            config_hash,
                            pending_config_json: None,
                            pending_config_hash: None,
                            conflict_status: McpConflictStatus::None,
                            is_read_only,
                            is_new: existing_tool.is_new,
                        })
                        .await?
                }
            }
            None => {
                let config_json = serde_json::to_string(&config).unwrap();
                let config_hash = hash_config(&config_json);

                state
                    .store
                    .upsert_tool(ToolUpsert {
                        id: None,
                        source_id: source.id.clone(),
                        identifier: Some(identifier),
                        name: name.clone(),
                        source_type: source.source_type.clone(),
                        status: McpToolStatus::Healthy,
                        ping_ms: None,
                        capabilities: config.capabilities.unwrap_or_default(),
                        description: config.description.unwrap_or_default(),
                        error: None,
                        command: config.command,
                        args: config.args,
                        env: config.env,
                        config_json,
                        config_hash,
                        pending_config_json: None,
                        pending_config_hash: None,
                        conflict_status: McpConflictStatus::None,
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

fn hash_config(config_json: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(config_json.as_bytes());
    hex::encode(hasher.finalize())
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

pub(crate) async fn start_local_conversation_summary_worker(state: McpRuntimeState) {
    let mut interval = tokio::time::interval(Duration::from_secs(
        LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
    ));
    loop {
        interval.tick().await;
        if let Err(err) = process_next_local_conversation_summary_job(&state).await {
            warn!("conversation summary worker error: {}", err);
        }
    }
}

pub(crate) async fn start_local_periodic_worker(state: McpRuntimeState) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        if let Err(err) = state.store.dispatch_due_local_conversation_summary_idle_tasks().await {
            warn!("periodic worker dispatch idle task error: {}", err);
        }
        if let Err(err) = state
            .store
            .cleanup_old_local_conversation_summary_jobs(7 * 24 * 60 * 60)
            .await
        {
            warn!("periodic worker cleanup old jobs error: {}", err);
        }
    }
}

async fn process_next_local_conversation_summary_job(state: &McpRuntimeState) -> Result<(), McpError> {
    process_next_local_conversation_summary_job_with_store(state.store.as_ref()).await
}

async fn execute_or_queue_mcp_tool_call(
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_name: String,
    arguments: Value,
    require_approval: bool,
) -> Result<Value, String> {
    let tool = store
        .get_tool_by_name(&tool_name)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", tool_name))?;

    if require_approval {
        let approval_token = Uuid::new_v4().to_string();
        pending_tool_calls.write().await.insert(
            approval_token.clone(),
            crate::modules::mcp::PendingToolCall {
                tool_name: tool_name.clone(),
                arguments: arguments.clone(),
            },
        );
        return Ok(serde_json::json!({
            "status": "REQUIRES_APPROVAL",
            "approval_token": approval_token,
            "tool_name": tool_name,
            "arguments": arguments,
            "description": tool.description,
        }));
    }

    execute_local_mcp_tool(&tool, &arguments).await
}

async fn approve_mcp_tool_inner(
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> Result<Value, String> {
    let pending = pending_tool_calls.write().await.remove(approval_token);
    let Some(pending) = pending else {
        return Err("pending tool call not found".to_string());
    };
    let tool = store
        .get_tool_by_name(&pending.tool_name)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", pending.tool_name))?;
    execute_local_mcp_tool(&tool, &pending.arguments).await
}

async fn reject_mcp_tool_inner(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> bool {
    pending_tool_calls
        .write()
        .await
        .remove(approval_token)
        .is_some()
}

async fn process_next_local_conversation_summary_job_with_store(
    store: &crate::modules::mcp::store::McpStore,
) -> Result<(), McpError> {
    let Some(job) = store.claim_next_local_conversation_summary_job().await? else {
        return Ok(());
    };

    let processing = async {
        let window = store.get_local_conversation_window(&job.session_id).await?;
        let summary = build_local_summary_from_window(&window.messages);
        if summary.trim().is_empty() {
            return Err(McpError::validation("conversation summary content is empty"));
        }
        store
            .persist_local_conversation_summary(&job.session_id, &summary, Some("local-worker"))
            .await?;
        Ok::<(), McpError>(())
    }
    .await;

    match processing {
        Ok(()) => store.complete_local_conversation_summary_job(&job.id).await,
        Err(err) => {
            let message = err.to_string();
            let _ = store
                .fail_local_conversation_summary_job(&job, &message, 30)
                .await;
            Err(err)
        }
    }
}

fn build_local_summary_from_window(messages: &[LocalConversationHistoryMessage]) -> String {
    let mut lines = Vec::new();
    for message in messages {
        let role = message.role.trim();
        let text = message
            .content
            .as_ref()
            .and_then(|value| {
                if let Some(text) = value.as_str() {
                    Some(text.to_string())
                } else {
                    serde_json::to_string(value).ok()
                }
            })
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_default();
        if text.is_empty() {
            continue;
        }
        lines.push(format!("{}: {}", role, text));
        if lines.len() >= LOCAL_CONVERSATION_SUMMARY_FALLBACK_RECENT_MESSAGES {
            break;
        }
    }

    if lines.is_empty() {
        return String::new();
    }

    let joined = lines.join("\n");
    truncate_text_chars(&joined, LOCAL_CONVERSATION_SUMMARY_MAX_CHARS)
}

async fn run_local_chat_complete_with_auto_code_mode(
    app_state: &AppState,
    model_connection: &LocalModelConnection,
    messages: Vec<LocalChatInputMessage>,
    chat_ctx: &LocalConversationChatContext,
) -> Result<serde_json::Value, String> {
    let provider_model_id = &model_connection.provider_model_id;
    let model_id = &model_connection.model_id;
    let mut orchestrated_messages = messages;
    let mut round: usize = 0;

    loop {
        round = round.saturating_add(1);
        let search_query = orchestrated_messages
            .last()
            .map(|m| &m.content)
            .cloned()
            .unwrap_or_default();
        let tools = build_local_sdk_search_result(app_state, &search_query).await;

        let response = request_provider_chat_completion(
            app_state,
            provider_model_id,
            model_id,
            orchestrated_messages.clone(),
            Some(tools),
            None,
            None,
        )
            .await
            .map_err(to_string)?;

        let tool_calls = extract_chat_tool_calls(&response);
        if tool_calls.is_empty() {
            return Ok(response);
        }

        let (synthesized, tool_call_meta, results) =
            maybe_handle_local_code_mode_tool_calls(app_state, &response, chat_ctx).await;
        if !synthesized {
            return Ok(response);
        }

        let tool_feedback = build_auto_code_mode_tool_feedback(round, &tool_call_meta, &results);
        let assistant_content = response
            .get("content")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        if !assistant_content.is_empty() {
            orchestrated_messages.push(LocalChatInputMessage {
                role: "assistant".to_string(),
                content: assistant_content,
            });
        }
        orchestrated_messages.push(LocalChatInputMessage {
            role: "user".to_string(),
            content: tool_feedback,
        });
    }
}

async fn maybe_handle_local_code_mode_tool_calls(
    app_state: &AppState,
    chat_response: &serde_json::Value,
    chat_ctx: &LocalConversationChatContext,
) -> (bool, Vec<serde_json::Value>, Vec<String>) {
    let tool_calls = extract_chat_tool_calls(chat_response);
    if tool_calls.is_empty() {
        return (false, Vec::new(), Vec::new());
    }

    let mut tool_call_meta = Vec::new();
    let mut results = Vec::new();
    let mut synthesized = false;

    for call in tool_calls {
        let tool_name = call.name.trim().to_lowercase();
        if tool_name == "execute_code_plan" {
            let code = call
                .arguments
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let language = call
                .arguments
                .get("language")
                .and_then(|v| v.as_str())
                .unwrap_or("python");
            let execution_timeout = call
                .arguments
                .get("execution_timeout")
                .and_then(|v| v.as_u64())
                .map(|v| v.max(1));
            let dry_run = call
                .arguments
                .get("dry_run")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if !code.is_empty() {
                let execution_res =
                    crate::modules::code_mode::commands::execute_local_code_mode_inner(
                        app_state,
                        ExecuteLocalCodeModeRequest {
                            code: code.to_string(),
                            session_id: Some(chat_ctx.session_id.clone()),
                            language: Some(language.to_string()),
                            execution_timeout,
                            dry_run: Some(dry_run),
                            context: None,
                            max_calls: None,
                        },
                    )
                    .await;

                match execution_res {
                    Ok(res) => {
                        synthesized = true;
                        tool_call_meta.push(serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "success",
                            "result": res,
                        }));
                        results.push(format!(
                            "Code Execution Result:\n{}",
                            res.result.join("\n")
                        ));
                    }
                    Err(err) => {
                        tool_call_meta.push(serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "error",
                            "error": err.to_string(),
                        }));
                        results.push(format!("Code Execution Failed: {}", err));
                    }
                }
            }
        } else if tool_name == "search_sdk" {
            let query = call
                .arguments
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let search_res = build_local_sdk_search_result(app_state, query).await;
            synthesized = true;
            tool_call_meta.push(serde_json::json!({
                "id": call.id,
                "name": tool_name,
                "status": "success",
                "result": search_res,
            }));
            results.push(format!(
                "SDK Search Result for '{}':\n{}",
                query,
                serde_json::to_string_pretty(&search_res).unwrap()
            ));
        } else if tool_name == "sys_submit_onboarding_request" {
            let asset_type = call
                .arguments
                .get("asset_type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let payload = call
                .arguments
                .get("payload")
                .cloned()
                .unwrap_or(serde_json::json!({}));

            if asset_type == "assistant" {
                let create_req: Result<crate::modules::mcp::types::CreateLocalAssistantRequest, _> =
                    serde_json::from_value(payload);
                if let Ok(req) = create_req {
                    match app_state.mcp.store.create_local_assistant(req).await {
                        Ok(id) => {
                            synthesized = true;
                            tool_call_meta.push(serde_json::json!({
                                "id": call.id,
                                "name": tool_name,
                                "status": "success",
                                "result": {"action": "created", "id": id},
                            }));
                            results.push(format!("Assistant created successfully with ID: {}", id));
                        }
                        Err(err) => {
                            tool_call_meta.push(serde_json::json!({
                                "id": call.id,
                                "name": tool_name,
                                "status": "error",
                                "error": err.to_string(),
                            }));
                        }
                    }
                }
            }
        }
    }

    (synthesized, tool_call_meta, results)
}

async fn build_local_sdk_search_result(app_state: &AppState, query: &str) -> serde_json::Value {
    let normalized = query.trim().to_lowercase();
    let mut catalog = vec![
        serde_json::json!({
            "name": "execute_code_plan",
            "description": "Execute python code in local sandbox and bridge",
            "source": "code_mode_core",
            "parameters": {
                "code": "string(required)",
                "language": "string(optional, default=python)",
                "execution_timeout": "number(optional)",
                "dry_run": "boolean(optional)",
            }
        }),
        serde_json::json!({
            "name": "search_sdk",
            "description": "Search tool signatures in local desktop runtime",
            "source": "code_mode_core",
            "parameters": {
                "query": "string(optional)",
            }
        }),
    ];

    // Single Path Local Discovery via Unified Assets
    if !normalized.is_empty() {
        if let Ok(vector) = app_state.providers.embedding.embed_text(&normalized).await {
            if let Ok(asset_hits) = app_state.memory.store.search_assets(vector, 15, None).await {
                for hit in asset_hits {
                    let source_type = hit
                        .get("source_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let name = hit["name"].as_str().unwrap_or("").to_string();
                    let desc = hit["description"].as_str().unwrap_or("").to_string();
                    let pkg_name = hit.get("pkg_name").and_then(|v| v.as_str());

                    catalog.push(serde_json::json!({
                        "name": name,
                        "description": desc,
                        "source": format!("local_{}", source_type),
                        "pkg_name": pkg_name,
                        "score": hit.get("_distance"),
                        "needs_provisioning": source_type == "cloud_mirror",
                        "asset_type": hit.get("asset_type"),
                    }));
                }
            }
        }
    }

    // Keep memory core tools always visible
    catalog.push(serde_json::json!({
        "name": "list_user_memories",
        "description": "List local memories for current desktop session",
        "source": "code_mode_bridge",
    }));

    let matches = catalog
        .into_iter()
        .filter(|item| {
            if normalized.is_empty() {
                return true;
            }
            let name_hit = item
                .get("name")
                .and_then(|v| v.as_str())
                .map(|n| n.to_lowercase().contains(&normalized))
                .unwrap_or(false);
            let desc_hit = item
                .get("description")
                .and_then(|v| v.as_str())
                .map(|d| d.to_lowercase().contains(&normalized))
                .unwrap_or(false);
            name_hit || desc_hit || item.get("score").is_some()
        })
        .collect::<Vec<_>>();

    serde_json::json!({
        "query": query,
        "mode": "unified_local_discovery",
        "items": matches,
    })
}

fn extract_chat_tool_calls(response: &serde_json::Value) -> Vec<LocalChatToolCall> {
    let mut calls = Vec::new();
    if let Some(tc_array) = response.get("tool_calls").and_then(|v| v.as_array()) {
        for tc in tc_array {
            if let (Some(id), Some(name)) = (
                tc.get("id").and_then(|v| v.as_str()),
                tc.get("name").and_then(|v| v.as_str()),
            ) {
                calls.push(LocalChatToolCall {
                    id: Some(id.to_string()),
                    name: name.to_string(),
                    arguments: tc
                        .get("arguments")
                        .cloned()
                        .unwrap_or(serde_json::json!({})),
                });
            }
        }
    }
    calls
}

fn build_auto_code_mode_tool_feedback(
    round: usize,
    tool_call_meta: &[serde_json::Value],
    results: &[String],
) -> String {
    let payload = serde_json::json!({
        "round": round,
        "tool_calls": tool_call_meta,
        "results": results,
    });
    let serialized = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| {
        serde_json::json!({
            "round": round,
            "results": results,
        })
        .to_string()
    });
    let content = format!(
        "Auto tool execution round {} completed. Continue based on these tool results. If all tasks are complete, return the final answer.\n{}",
        round, serialized
    );
    truncate_text_chars(&content, LOCAL_CODE_MODE_TOOL_RESULTS_MAX_CHARS)
}

fn truncate_text_chars(input: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    let mut out = input.chars().take(max_chars).collect::<String>();
    out.push_str("...");
    out
}

fn emit_local_chat_stream_payload(
    app: &AppHandle,
    request_id: Option<&str>,
    trace_id: &str,
    payload: serde_json::Value,
) {
    let mut envelope = serde_json::json!({
        "trace_id": trace_id,
    });
    if let Some(request_id) = request_id {
        if !request_id.trim().is_empty() {
            envelope["request_id"] = serde_json::json!(request_id);
        }
    }
    if let (Some(target), Some(source)) = (envelope.as_object_mut(), payload.as_object()) {
        for (key, value) in source {
            target.insert(key.to_string(), value.clone());
        }
    }
    if let Err(err) = app.emit(LOCAL_CHAT_STREAM_EVENT, envelope) {
        warn!("failed to emit local chat stream event: {}", err);
    }
}

fn emit_local_chat_stream_status(
    app: &AppHandle,
    request_id: Option<&str>,
    trace_id: &str,
    stage: &str,
    code: &str,
    meta: Option<serde_json::Value>,
) {
    emit_local_chat_stream_payload(
        app,
        request_id,
        trace_id,
        serde_json::json!({
            "type": "status",
            "stage": stage,
            "code": code,
            "meta": meta,
        }),
    );
}

fn emit_local_chat_stream_blocks(
    app: &AppHandle,
    request_id: Option<&str>,
    trace_id: &str,
    blocks: serde_json::Value,
) {
    emit_local_chat_stream_payload(
        app,
        request_id,
        trace_id,
        serde_json::json!({
            "type": "blocks",
            "blocks": blocks,
        }),
    );
}

fn emit_local_chat_stream_error(
    app: &AppHandle,
    request_id: Option<&str>,
    trace_id: &str,
    message: &str,
) {
    emit_local_chat_stream_payload(
        app,
        request_id,
        trace_id,
        serde_json::json!({
            "type": "error",
            "code": "local_chat_failed",
            "message": message,
        }),
    );
}

fn emit_local_chat_stream_done(app: &AppHandle, request_id: Option<&str>, trace_id: &str) {
    emit_local_chat_stream_payload(
        app,
        request_id,
        trace_id,
        serde_json::json!({
            "type": "done",
        }),
    );
}

fn emit_local_chat_stream_delta_chunks(
    app: &AppHandle,
    request_id: Option<&str>,
    trace_id: &str,
    content: &str,
) {
    if content.is_empty() {
        return;
    }

    let mut chunk = String::new();
    let mut chunk_chars = 0usize;
    for ch in content.chars() {
        chunk.push(ch);
        chunk_chars += 1;
        if chunk_chars >= LOCAL_CHAT_STREAM_DELTA_CHUNK_CHARS {
            emit_local_chat_stream_payload(
                app,
                request_id,
                trace_id,
                serde_json::json!({
                    "type": "delta",
                    "delta": chunk,
                }),
            );
            chunk = String::new();
            chunk_chars = 0;
        }
    }

    if !chunk.is_empty() {
        emit_local_chat_stream_payload(
            app,
            request_id,
            trace_id,
            serde_json::json!({
                "type": "delta",
                "delta": chunk,
            }),
        );
    }
}

const LOCAL_CONVERSATION_SUMMARY_MAX_CHARS: usize = 2000;
const LOCAL_CODE_MODE_TOOL_RESULTS_MAX_CHARS: usize = 8000;
const LOCAL_CHAT_STREAM_EVENT: &str = "local-chat-stream";
const LOCAL_CHAT_STREAM_DELTA_CHUNK_CHARS: usize = 64;
const LOCAL_CONVERSATION_SUMMARY_FALLBACK_RECENT_MESSAGES: usize = 8;
const LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS: u64 = 2;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tokio::sync::RwLock;

    async fn create_test_store(test_name: &str) -> crate::modules::mcp::store::McpStore {
        let mut db_path = std::env::temp_dir();
        db_path.push(format!(
            "deeting-tauri-{test_name}-{}.db",
            Uuid::new_v4()
        ));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));

        let store = crate::modules::mcp::store::McpStore::new(&database_url)
            .await
            .expect("create test mcp store");
        store.init().await.expect("init test mcp store");
        let _ = store
            .ensure_cloud_source("http://127.0.0.1:8000")
            .await
            .expect("ensure cloud source");
        let _ = store
            .ensure_local_source()
            .await
            .expect("ensure local source");
        store
    }

    async fn upsert_test_tool(
        store: &crate::modules::mcp::store::McpStore,
        name: &str,
        command: &str,
    ) -> McpTool {
        let source = store
            .ensure_local_source()
            .await
            .expect("ensure local source for test tool");
        let config_json = serde_json::json!({
            "command": command,
            "args": [],
            "capabilities": ["test"],
            "description": "test tool",
        })
        .to_string();
        store
            .upsert_tool(ToolUpsert {
                id: None,
                source_id: source.id.clone(),
                identifier: Some(format!("test/{name}")),
                name: name.to_string(),
                source_type: McpSourceType::Local,
                status: McpToolStatus::Healthy,
                ping_ms: None,
                capabilities: vec!["test".to_string()],
                description: "test tool".to_string(),
                error: None,
                command: Some(command.to_string()),
                args: None,
                env: None,
                config_json: config_json.clone(),
                config_hash: hash_config(&config_json),
                pending_config_json: None,
                pending_config_hash: None,
                conflict_status: McpConflictStatus::None,
                is_read_only: false,
                is_new: false,
            })
            .await
            .expect("upsert test tool")
    }

    #[test]
    fn extract_chat_tool_calls_works() {
        let payload = serde_json::json!({
            "content": "hello",
            "tool_calls": [
                {
                    "id": "call_1",
                    "name": "execute_code_plan",
                    "arguments": {"code": "print(1)"}
                }
            ]
        });

        let calls = extract_chat_tool_calls(&payload);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "execute_code_plan");
        assert_eq!(
            calls[0].arguments.get("code").and_then(|v| v.as_str()),
            Some("print(1)")
        );
    }

    #[test]
    fn build_auto_code_mode_tool_feedback_contains_round() {
        let feedback = build_auto_code_mode_tool_feedback(
            2,
            &[serde_json::json!({"id":"call_1","status":"success"})],
            &["ok".to_string()],
        );
        assert!(feedback.contains("round 2"));
        assert!(feedback.contains("\"tool_calls\""));
        assert!(feedback.contains("\"results\""));
    }

    #[test]
    fn normalize_chat_completion_response_supports_openai_shape() {
        let raw = serde_json::json!({
            "id": "chatcmpl_xxx",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "hello",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "search_sdk",
                                    "arguments": "{\"query\":\"sdk\"}"
                                }
                            }
                        ]
                    }
                }
            ]
        });
        let normalized = normalize_chat_completion_response(raw);
        assert_eq!(
            normalized.get("content").and_then(|v| v.as_str()),
            Some("hello")
        );
        let calls = normalized
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].get("name").and_then(|v| v.as_str()), Some("search_sdk"));
        assert_eq!(
            calls[0]
                .get("arguments")
                .and_then(|v| v.get("query"))
                .and_then(|v| v.as_str()),
            Some("sdk")
        );
    }

    #[test]
    fn build_upstream_endpoint_uses_v1_default() {
        assert_eq!(
            build_upstream_endpoint("https://api.example.com", ""),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            build_upstream_endpoint("https://api.example.com/v1", ""),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            build_upstream_endpoint("https://api.example.com/", "/custom/path"),
            "https://api.example.com/custom/path"
        );
    }

    #[tokio::test]
    async fn process_summary_job_persists_summary_and_marks_completed() {
        let store = create_test_store("summary-ok").await;
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("smoke-summary".to_string()),
            })
            .await
            .expect("create conversation");
        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "user".to_string(),
                content: "请帮我总结一下这次对话".to_string(),
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append user message");
        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "assistant".to_string(),
                content: "已记录你的需求，准备生成摘要".to_string(),
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append assistant message");
        store
            .enqueue_local_conversation_summary_job(&session.session_id, "test")
            .await
            .expect("enqueue summary job");

        process_next_local_conversation_summary_job_with_store(&store)
            .await
            .expect("process summary job");

        let window = store
            .get_local_conversation_window(&session.session_id)
            .await
            .expect("get conversation window");
        let summary_text = window
            .summary
            .as_ref()
            .and_then(|value| value.get("summary_text"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        assert!(summary_text.contains("user:"));
        assert!(summary_text.contains("assistant:"));

        let jobs = store
            .list_local_conversation_summary_jobs(LocalConversationSummaryJobQuery {
                skip: None,
                limit: None,
                status: None,
                session_id: Some(session.session_id.clone()),
                error_contains: None,
            })
            .await
            .expect("list summary jobs");
        assert_eq!(jobs.total, 1);
        assert_eq!(jobs.items[0].status, "completed");
    }

    #[tokio::test]
    async fn process_summary_job_requeues_when_conversation_is_empty() {
        let store = create_test_store("summary-empty").await;
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("empty-summary".to_string()),
            })
            .await
            .expect("create conversation");
        store
            .enqueue_local_conversation_summary_job(&session.session_id, "test")
            .await
            .expect("enqueue summary job");

        let err = process_next_local_conversation_summary_job_with_store(&store)
            .await
            .expect_err("empty conversation should fail");
        assert!(err.to_string().contains("content is empty"));

        let jobs = store
            .list_local_conversation_summary_jobs(LocalConversationSummaryJobQuery {
                skip: None,
                limit: None,
                status: Some("pending".to_string()),
                session_id: Some(session.session_id.clone()),
                error_contains: None,
            })
            .await
            .expect("list summary jobs");
        assert_eq!(jobs.total, 1);
        assert_eq!(jobs.items[0].status, "pending");
        assert!(
            jobs.items[0]
                .last_error
                .as_deref()
                .unwrap_or("")
                .contains("content is empty")
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn approval_flow_reject_and_approve_execute_paths_work() {
        let store = create_test_store("approval-flow").await;
        let _ = upsert_test_tool(&store, "execute_demo", "cat").await;
        let pending_tool_calls =
            RwLock::new(HashMap::<String, crate::modules::mcp::PendingToolCall>::new());

        let queued = execute_or_queue_mcp_tool_call(
            &store,
            &pending_tool_calls,
            "execute_demo".to_string(),
            serde_json::json!({"x": 1}),
            true,
        )
        .await
        .expect("queue pending approval");
        let token = queued
            .get("approval_token")
            .and_then(|value| value.as_str())
            .expect("approval token")
            .to_string();
        assert_eq!(
            queued.get("status").and_then(|value| value.as_str()),
            Some("REQUIRES_APPROVAL")
        );

        let removed = reject_mcp_tool_inner(&pending_tool_calls, &token).await;
        assert!(removed);
        assert!(pending_tool_calls.read().await.is_empty());

        let queued_again = execute_or_queue_mcp_tool_call(
            &store,
            &pending_tool_calls,
            "execute_demo".to_string(),
            serde_json::json!({"x": 2}),
            true,
        )
        .await
        .expect("queue second pending approval");
        let token_again = queued_again
            .get("approval_token")
            .and_then(|value| value.as_str())
            .expect("approval token")
            .to_string();

        let approved = approve_mcp_tool_inner(&store, &pending_tool_calls, &token_again)
            .await
            .expect("approve and execute");
        assert_eq!(
            approved.get("method").and_then(|value| value.as_str()),
            Some("execute_demo")
        );
        assert_eq!(
            approved
                .get("arguments")
                .and_then(|value| value.get("x"))
                .and_then(|value| value.as_i64()),
            Some(2)
        );
        assert!(pending_tool_calls.read().await.is_empty());
    }
}
