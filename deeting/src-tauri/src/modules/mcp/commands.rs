use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use log::warn;
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::modules::code_mode::prompt::render_code_mode_capability_prompt;
use crate::modules::code_mode::types::ExecuteLocalCodeModeRequest;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::{expand_path, ExtractedToolFields, NewSource, ToolUpsert};
use crate::modules::mcp::types::*;
use crate::modules::mcp::McpRuntimeState;
use crate::modules::providers::types::BanditFeedbackRequest;
use crate::state::AppState;

pub(crate) async fn index_local_assistants(app_state: &AppState, assistants: &[LocalAssistant]) {
    for assistant in assistants {
        let text = format!(
            "name: {}\ndescription: {}\ntags: {}",
            assistant.name,
            assistant.description.as_deref().unwrap_or(""),
            assistant.tags.as_deref().unwrap_or("")
        );
        if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            let _ = app_state
                .memory
                .store
                .append_assistant(
                    assistant.id.clone(),
                    assistant.name.clone(),
                    assistant.description.clone().unwrap_or_default(),
                    assistant.tags.clone(),
                    vector,
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
                        let app_state_clone = app_state.inner().clone();
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

    let subscriptions: Vec<McpSubscriptionItem> = response.json().await.map_err(to_string)?;
    let mut synced_tools = Vec::new();

    for sub in subscriptions {
        let cloud_source = state
            .store
            .ensure_cloud_source(&sub.tool.source_name, &sub.tool.source_url)
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
    };
    state.store.create_source(source).await.map_err(to_string)
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
        .create_assistant_message(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_assistant_message(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<LocalAssistantMessage, String> {
    let state = &state.mcp;
    state
        .store
        .update_assistant_message(&id, &content)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_assistant_message(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .delete_assistant_message(&id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversation_sessions(
    state: State<'_, AppState>,
    query: LocalConversationSessionsQuery,
) -> Result<LocalConversationSessionPage, String> {
    let state = &state.mcp;
    state
        .store
        .list_conversation_sessions(query)
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
        .get_conversation_window(&session_id)
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
        .create_conversation_session(payload)
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
        .rename_conversation_session(&session_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_conversation_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationDeleteResponse, String> {
    let state = &state.mcp;
    state
        .store
        .delete_conversation_session(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn archive_local_conversation_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    let state = &state.mcp;
    state
        .store
        .archive_conversation_session(&session_id)
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
        .clear_conversation_session(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversation_history(
    state: State<'_, AppState>,
    query: LocalConversationHistoryQuery,
) -> Result<LocalConversationHistoryResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_conversation_history(query)
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
        let assistant_id = payload.assistant_id.clone();
        let chat_ctx = conversation_repo
            .get_chat_context(&session_id, assistant_id.as_deref())
            .await
            .map_err(to_string)?;

        emit_local_chat_stream_status(
            &app,
            request_id.as_deref(),
            &trace_id,
            "context_ready",
            "local_send_context_ready",
            Some(serde_json::json!({ "assistant_id": chat_ctx.assistant_id })),
        );

        let model_connection = conversation_repo
            .resolve_chat_model(&chat_ctx)
            .await
            .map_err(to_string)?;

        let messages = conversation_repo
            .prepare_chat_messages(&chat_ctx, &payload.content)
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
            &app_state,
            &model_connection,
            messages,
            &chat_ctx,
        )
        .await?;

        let response_text = response_json["content"].as_str().unwrap_or("").to_string();
        let tool_calls = extract_chat_tool_calls(&response_json);

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

        let saved_messages = conversation_repo
            .save_chat_turn(&session_id, &payload.content, &response_text, &tool_calls)
            .await
            .map_err(to_string)?;

        let assistant_id = chat_ctx.assistant_id.clone();
        if let Some(assistant_id) = assistant_id {
            if let Err(err) = conversation_repo
                .enqueue_conversation_summary(&session_id, &assistant_id)
                .await
            {
                warn!(
                    "failed to enqueue summary session={} assistant={} error={}",
                    session_id, assistant_id, err
                );
            }
        }

        let trace_meta = serde_json::json!({
            "trace_id": trace_id,
            "assistant_id": chat_ctx.assistant_id,
            "provider_model_id": model_connection.provider_model_id,
            "model_id": model_connection.model_id,
        });

        Ok(LocalConversationSendResponse {
            session_id: session_id.clone(),
            messages: saved_messages,
            trace_meta: Some(trace_meta),
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
        let chat_ctx = conversation_repo
            .get_chat_context(&payload.session_id, None)
            .await
            .map_err(to_string)?;

        let model_connection = conversation_repo
            .resolve_chat_model(&chat_ctx)
            .await
            .map_err(to_string)?;

        let history = conversation_repo
            .list_conversation_history(LocalConversationHistoryQuery {
                session_id: Some(payload.session_id.clone()),
                cursor: None,
                limit: Some(20),
            })
            .await
            .map_err(to_string)?;

        let mut messages: Vec<LocalChatInputMessage> = history
            .messages
            .into_iter()
            .map(|m| LocalChatInputMessage {
                role: m.role,
                content: m.content,
                name: None,
            })
            .collect();

        if messages.is_empty() {
            return Err("no message to regenerate".to_string());
        }

        if messages.last().map(|m| &m.role) == Some(&LocalConversationStatus::Assistant) {
            messages.pop();
        }

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
            &app_state,
            &model_connection,
            messages,
            &chat_ctx,
        )
        .await?;

        let response_text = response_json["content"].as_str().unwrap_or("").to_string();
        let tool_calls = extract_chat_tool_calls(&response_json);

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
            .save_regenerated_reply(&payload.session_id, &response_text, &tool_calls)
            .await
            .map_err(to_string)?;

        Ok(LocalConversationRegenerateResponse {
            session_id: payload.session_id.clone(),
            deleted_turn_index: None,
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
    app: AppHandle,
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
        .start_process(app, tool)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn stop_mcp_tool(state: State<'_, AppState>, tool_id: String) -> Result<(), String> {
    let state = &state.mcp;
    state
        .process_manager
        .stop_process(&tool_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn execute_mcp_tool_raw(
    app: AppHandle,
    state: State<'_, AppState>,
    tool_name: String,
    arguments: Value,
) -> Result<Value, String> {
    let mcp = &state.mcp;

    // 1. Resolve tool by name
    let tool = mcp
        .store
        .get_tool_by_name(&tool_name)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", tool_name))?;

    // 2. Ensure process is running or start it
    mcp.process_manager
        .ensure_process(app, &tool)
        .await
        .map_err(to_string)?;

    // 3. Call tool via process manager
    mcp.process_manager
        .call_tool(&tool.id, &tool.name, arguments)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_mcp_tool_env(
    state: State<'_, AppState>,
    tool_id: String,
    payload: UpdateToolConfigRequest,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .update_tool_config(&tool_id, payload)
        .await
        .map_err(to_string)?;
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
        .apply_pending_config(&tool_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn resolve_mcp_conflict(
    state: State<'_, AppState>,
    payload: ResolveConflictRequest,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .resolve_conflict(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_mcp_logs(
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<Vec<Value>, String> {
    let state = &state.mcp;
    let logs = state.process_manager.get_logs(&tool_id).await;
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
                .append_tool(
                    tool.id.clone(),
                    tool.name.clone(),
                    tool.description.clone(),
                    tool.identifier.clone(),
                    vector,
                )
                .await;
        }
    }
}

#[tauri::command]
pub async fn sync_cloud_subscriptions_v2(
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

    let subscriptions: Vec<McpSubscriptionItem> = response.json().await.map_err(to_string)?;
    let mut synced_tools = Vec::new();

    for sub in subscriptions {
        let cloud_source = state
            .store
            .ensure_cloud_source(&sub.tool.source_name, &sub.tool.source_url)
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
        .list_local_knowledge_files(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_knowledge_folders(
    state: State<'_, AppState>,
) -> Result<Vec<LocalKnowledgeFolder>, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_knowledge_folders()
        .await
        .map_err(to_string)
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
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .delete_local_knowledge_folder(&id)
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
    payload: LocalAssistantRoutingFeedbackRequest,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .record_local_assistant_routing_feedback(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_assistant_preview(
    state: State<'_, AppState>,
    payload: LocalAssistantPreviewRequest,
) -> Result<LocalAssistant, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_assistant_preview(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn record_local_assistant_rating(
    state: State<'_, AppState>,
    payload: LocalAssistantRatingRequest,
) -> Result<LocalAssistantRatingResponse, String> {
    let state = &state.mcp;
    state
        .store
        .record_local_assistant_rating(payload)
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
        .list_local_assistant_installations(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_assistant_installation(
    state: State<'_, AppState>,
    payload: LocalAssistantInstallCreateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    let state = &state.mcp;
    state
        .store
        .create_local_assistant_installation(payload)
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
        .update_local_assistant_installation(&assistant_id, payload)
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
        .delete_local_assistant_installation(&assistant_id)
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
    query: LocalAdminConversationMessageQuery,
) -> Result<LocalAdminConversationMessageListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_admin_conversation_messages(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_admin_conversation_summaries(
    state: State<'_, AppState>,
    query: LocalAdminConversationQuery,
) -> Result<LocalAdminConversationSummaryListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_admin_conversation_summaries(query)
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
        .get_conversation_summary_queue_stats()
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
        .list_conversation_summary_jobs(query)
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
        .list_conversation_summary_idle_tasks(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn enqueue_local_conversation_summary(
    state: State<'_, AppState>,
    session_id: String,
    assistant_id: String,
) -> Result<LocalConversationSummaryEnqueueResponse, String> {
    let state = &state.mcp;
    state
        .store
        .enqueue_conversation_summary(&session_id, &assistant_id)
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
        .retry_conversation_summary_batch(payload)
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
        .create_local_gateway_log(payload)
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
        .get_local_gateway_log_stats()
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
        McpSourceType::Cloud => {
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
                        .update_tool_status(&existing_tool.id, McpToolStatus::Healthy, None)
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
        if let Err(err) = state.store.process_next_conversation_summary_job().await {
            warn!("conversation summary worker error: {}", err);
        }
    }
}

pub(crate) async fn start_local_periodic_worker(state: McpRuntimeState) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        if let Err(err) = state.store.cleanup_stale_data().await {
            warn!("periodic worker cleanup error: {}", err);
        }
    }
}

async fn run_local_chat_complete_with_auto_code_mode(
    app_state: &AppState,
    model_connection: &LocalModelConnection,
    messages: Vec<LocalChatInputMessage>,
    chat_ctx: &LocalChatContext,
) -> Result<serde_json::Value, String> {
    let provider_model_id = &model_connection.provider_model_id;
    let model_id = &model_connection.model_id;
    let mut orchestrated_messages = messages;
    let mut last_response: Option<serde_json::Value> = None;
    let mut last_results: Vec<String> = Vec::new();

    for round in 0..LOCAL_CHAT_AUTO_CODE_MODE_MAX_ROUNDS {
        let search_query = orchestrated_messages
            .last()
            .map(|m| &m.content)
            .cloned()
            .unwrap_or_default();
        let tools = build_local_sdk_search_result(app_state, &search_query).await;

        let response = app_state
            .providers
            .store
            .chat_completion(
                provider_model_id,
                model_id,
                orchestrated_messages.clone(),
                Some(tools),
                None, // temperature
                None, // max_tokens
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

        let tool_feedback =
            build_auto_code_mode_tool_feedback(round + 1, &tool_call_meta, &results);
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

        last_results = results;
        last_response = Some(response);
    }

    if let Some(mut response) = last_response {
        let notice = build_auto_code_mode_round_limit_notice(
            LOCAL_CHAT_AUTO_CODE_MODE_MAX_ROUNDS,
            &last_results,
        );
        if let Some(content) = response.get_mut("content") {
            *content = serde_json::json!(notice);
        } else if let Some(obj) = response.as_object_mut() {
            obj.insert("content".to_string(), serde_json::Value::String(notice));
        }
        return Ok(response);
    }

    Err("local auto code mode orchestration produced no response".to_string())
}

async fn maybe_handle_local_code_mode_tool_calls(
    app_state: &AppState,
    chat_response: &serde_json::Value,
    chat_ctx: &LocalChatContext,
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
                .map(|v| v as i32);
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
                            language: language.to_string(),
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
                        results.push(format!("Code Execution Result:\n{}", res.result));
                    }
                    Err(err) => {
                        tool_call_meta.push(serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "error",
                            "error": err,
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

fn extract_tool_signature_from_config_json(config_json: &str) -> serde_json::Value {
    let parsed: Result<serde_json::Value, _> = serde_json::from_str(config_json);
    let Ok(value) = parsed else {
        return serde_json::json!({});
    };

    for key in [
        "parameters",
        "input_schema",
        "inputSchema",
        "tool_schema",
        "schema",
        "args_schema",
    ] {
        if let Some(schema) = value.get(key) {
            return schema.clone();
        }
    }
    serde_json::json!({})
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
                    id: id.to_string(),
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

fn build_auto_code_mode_round_limit_notice(max_rounds: usize, latest_results: &[String]) -> String {
    let mut content = format!(
        "Auto tool orchestration reached max rounds ({}). Returning latest available results.",
        max_rounds
    );
    if !latest_results.is_empty() {
        let joined = latest_results.join("\n\n");
        content.push_str("\n\n");
        content.push_str(&joined);
    }
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
const LOCAL_CHAT_AUTO_CODE_MODE_MAX_ROUNDS: usize = 30;
const LOCAL_CHAT_STREAM_EVENT: &str = "local-chat-stream";
const LOCAL_CHAT_STREAM_DELTA_CHUNK_CHARS: usize = 64;
const LOCAL_CONVERSATION_SUMMARY_FALLBACK_RECENT_MESSAGES: usize = 8;
const LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS: u64 = 2;

#[cfg(test)]
mod tests {
    use super::*;

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
    fn build_auto_code_mode_round_limit_notice_contains_limit() {
        let notice = build_auto_code_mode_round_limit_notice(30, &["result".to_string()]);
        assert!(notice.contains("30"));
        assert!(notice.contains("result"));
    }
}
