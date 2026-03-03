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
pub async fn register_system_plugins(app_state: State<'_, AppState>) -> Result<(), String> {
    let project_root = std::env::current_dir().unwrap();
    let official_skills_dir = project_root.join("packages/official-skills");

    if !official_skills_dir.exists() {
        return Ok(());
    }

    let mcp = &app_state.mcp;
    let store = &mcp.store;

    for entry in std::fs::read_dir(official_skills_dir).map_err(to_string)? {
        let skill_path = entry.map_err(to_string)?.path();
        if !skill_path.is_dir() {
            continue;
        }

        let deeting_json_path = skill_path.join("deeting.json");
        if !deeting_json_path.exists() {
            continue;
        }

        let deeting_json_str = std::fs::read_to_string(&deeting_json_path).map_err(to_string)?;
        let manifest: serde_json::Value =
            serde_json::from_str(&deeting_json_str).map_err(to_string)?;

        let id = manifest["id"].as_str().unwrap_or("");
        let name = manifest["name"].as_str().unwrap_or(id);
        let description = manifest["description"].as_str().unwrap_or("");
        let source_id = format!("system_plugin_{}", id);

        // Extract tools from llm-tool.yaml
        let llm_tool_path = skill_path.join("llm-tool.yaml");
        if !llm_tool_path.exists() {
            continue;
        }
        let llm_tool_str = std::fs::read_to_string(llm_tool_path).map_err(to_string)?;
        let llm_tools: serde_json::Value =
            serde_yaml::from_str(&llm_tool_str).map_err(to_string)?;

        // Prepare generic environment variables based on manifest
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
                let tool_desc = tool_def["description"].as_str().unwrap_or("");
                let config_json = serde_json::to_string(tool_def).unwrap();

                let full_main_path = skill_path.join("main.py");

                let upsert = ToolUpsert {
                    id: None,
                    source_id: source_id.clone(),
                    identifier: Some(format!("{}/{}", id, tool_name)),
                    name: tool_name.to_string(),
                    source_type: McpSourceType::Local,
                    status: McpToolStatus::Healthy,
                    ping_ms: None,
                    capabilities: vec!["system_plugin".to_string()],
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
                    let app_state_clone = app_state.inner().clone();
                    tauri::async_runtime::spawn(async move {
                        index_mcp_tools(&app_state_clone, &[tool]).await;
                    });
                }
            }
        }
    }

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
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(to_string)?;

    if !response.status().is_success() {
        return Err(format!("failed to sync subscriptions: {}", response.status()));
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
    state.store.delete_local_assistant(&id).await.map_err(to_string)
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
pub async fn delete_assistant_message(state: State<'_, AppState>, id: String) -> Result<(), String> {
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
    let session_id = payload.session_id.clone();

    let assistant_id = payload.assistant_id.clone();
    let chat_ctx = conversation_repo
        .get_chat_context(&session_id, assistant_id.as_deref())
        .await
        .map_err(to_string)?;

    let model_connection = conversation_repo
        .resolve_chat_model(&chat_ctx)
        .await
        .map_err(to_string)?;

    let messages = conversation_repo
        .prepare_chat_messages(&chat_ctx, &payload.content)
        .await
        .map_err(to_string)?;

    let response_json = run_local_chat_complete_with_auto_code_mode(
        &app_state,
        &model_connection,
        messages,
        &chat_ctx,
    )
    .await?;

    let response_text = response_json["content"].as_str().unwrap_or("").to_string();
    let tool_calls = extract_chat_tool_calls(&response_json);

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
        session_id,
        messages: saved_messages,
        trace_meta: Some(trace_meta),
    })
}

#[tauri::command]
pub async fn regenerate_local_conversation_reply(
    app_state: State<'_, AppState>,
    payload: LocalConversationRegenerateRequest,
) -> Result<LocalConversationRegenerateResponse, String> {
    let state = &app_state.mcp;
    let conversation_repo = &state.store;

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
            session_id: payload.session_id.clone(),
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

    let response_json = run_local_chat_complete_with_auto_code_mode(
        &app_state,
        &model_connection,
        messages,
        &chat_ctx,
    )
    .await?;

    let response_text = response_json["content"].as_str().unwrap_or("").to_string();
    let tool_calls = extract_chat_tool_calls(&response_json);

    let assistant_message = conversation_repo
        .save_regenerated_reply(&payload.session_id, &response_text, &tool_calls)
        .await
        .map_err(to_string)?;

    Ok(LocalConversationRegenerateResponse {
        session_id: payload.session_id,
        message: assistant_message,
    })
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
pub async fn apply_pending_config(state: State<'_, AppState>, tool_id: String) -> Result<(), String> {
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
pub async fn get_mcp_logs(state: State<'_, AppState>, tool_id: String) -> Result<Vec<Value>, String> {
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
        return Err(format!("failed to sync subscriptions: {}", response.status()));
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
    state.store.list_local_knowledge_folders().await.map_err(to_string)
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
    state.store.get_local_knowledge_stats().await.map_err(to_string)
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
pub async fn get_local_gateway_log_stats(
    state: State<'_, AppState>,
) -> Result<LocalGatewayLogStatsResponse, String> {
    let state = &state.mcp;
    state.store.get_local_gateway_log_stats().await.map_err(to_string)
}

pub(crate) async fn sync_source_inner(
    state: &McpRuntimeState,
    source: McpSource,
    auth_token: Option<String>,
) -> Result<Vec<McpTool>, McpError> {
    let tools = match source.source_type {
        McpSourceType::Local => {
            let path = expand_path(&source.path_or_url);
            let config_json = std::fs::read_to_string(path)
                .map_err(|err| McpError::Storage(err.to_string()))?;
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
        let existing_tool = state.store.get_tool_by_source_name(&source.id, &name).await?;

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

    let search_query = messages.last().map(|m| &m.content).cloned().unwrap_or_default();
    let mut tools = build_local_sdk_search_result(app_state, &search_query).await;

    let response = app_state
        .providers
        .store
        .chat_completion(
            provider_model_id,
            model_id,
            messages,
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

    let (synthesized, _tool_call_meta, results) = maybe_handle_local_code_mode_tool_calls(
        app_state,
        &response,
        chat_ctx,
    )
    .await;

    if synthesized {
        let mut final_response = response.clone();
        if let Some(content) = final_response.get_mut("content") {
            *content = serde_json::json!(results.join("\n\n"));
        }
        return Ok(final_response);
    }

    Ok(response)
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
            let code = call.arguments.get("code").and_then(|v| v.as_str()).unwrap_or("");
            let language = call.arguments.get("language").and_then(|v| v.as_str()).unwrap_or("python");
            let execution_timeout = call.arguments.get("execution_timeout").and_then(|v| v.as_u64()).map(|v| v as i32);
            let dry_run = call.arguments.get("dry_run").and_then(|v| v.as_bool()).unwrap_or(false);

            if !code.is_empty() {
                let execution_res = crate::modules::code_mode::commands::execute_local_code_mode_inner(
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
            let query = call.arguments.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let search_res = build_local_sdk_search_result(app_state, query).await;
            synthesized = true;
            tool_call_meta.push(serde_json::json!({
                "id": call.id,
                "name": tool_name,
                "status": "success",
                "result": search_res,
            }));
            results.push(format!("SDK Search Result for '{}':\n{}", query, serde_json::to_string_pretty(&search_res).unwrap()));
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
        serde_json::json!({
            "name": "list_user_memories",
            "description": "List local memories for current desktop session",
            "source": "code_mode_bridge",
            "parameters": {
                "session_id": "string(optional)",
                "assistant_id": "string(optional)",
                "cursor": "string(optional)",
                "limit": "number(optional)",
            }
        }),
        serde_json::json!({
            "name": "add_knowledge_chunk",
            "description": "Append local memory chunk",
            "source": "code_mode_bridge",
            "parameters": {
                "content": "string(optional)",
                "chunk": "string(optional)",
                "text": "string(optional)",
                "session_id": "string(optional)",
                "assistant_id": "string(optional)",
            }
        }),
    ];

    // Semantic search for tools and assistants via LanceDB
    if !normalized.is_empty() {
        if let Ok(vector) = app_state.providers.embedding.embed_text(&normalized).await {
            // Search tools
            if let Ok(vector_hits) = app_state.memory.store.search_tools(vector.clone(), 10).await {
                for hit in vector_hits {
                    if let Some(tool_id) = hit.get("id").and_then(|v| v.as_str()) {
                         if let Ok(Some(tool)) = app_state.mcp.store.get_tool(tool_id).await {
                             let name = tool.name.trim().to_string();
                             let status = tool.status.as_str().to_string();
                             let availability = matches!(
                                 tool.status,
                                 crate::modules::mcp::types::McpToolStatus::Healthy
                                     | crate::modules::mcp::types::McpToolStatus::Degraded
                             );
                             let signature = extract_tool_signature_from_config_json(&tool.config_json);
                             catalog.push(serde_json::json!({
                                 "name": name,
                                 "identifier": tool.identifier,
                                 "description": tool.description,
                                 "source": "local_mcp_semantic",
                                 "status": status,
                                 "available": availability,
                                 "capabilities": tool.capabilities,
                                 "parameters": signature,
                                 "score": hit.get("_distance"),
                             }));
                         }
                    }
                }
            }

            // Search assistants (Skills)
            if let Ok(assistant_hits) = app_state.memory.store.search_assistants(vector, 10).await {
                for hit in assistant_hits {
                    catalog.push(serde_json::json!({
                        "name": hit.get("name"),
                        "description": hit.get("description"),
                        "identifier": hit.get("id"),
                        "source": "local_assistant_semantic",
                        "tags": hit.get("tags"),
                        "score": hit.get("_distance"),
                    }));
                }
            }
        }
    }

    if let Ok(tools) = app_state.mcp.store.list_tools().await {
        for tool in tools {
            let name = tool.name.trim().to_string();
            if name.is_empty() {
                continue;
            }

            // Avoid duplicate with semantic hits
            if catalog.iter().any(|item| {
                item.get("source").and_then(|v| v.as_str()) == Some("local_mcp_semantic") &&
                item.get("name").and_then(|v| v.as_str()) == Some(&name)
            }) {
                continue;
            }

            let status = tool.status.as_str().to_string();
            let availability = matches!(
                tool.status,
                crate::modules::mcp::types::McpToolStatus::Healthy
                    | crate::modules::mcp::types::McpToolStatus::Degraded
            );
            let signature = extract_tool_signature_from_config_json(&tool.config_json);
            catalog.push(serde_json::json!({
                "name": name,
                "identifier": tool.identifier,
                "description": tool.description,
                "source": "local_mcp",
                "status": status,
                "available": availability,
                "capabilities": tool.capabilities,
                "parameters": signature,
            }));
        }
    }

    let matches = catalog
        .into_iter()
        .filter(|item| {
            if normalized.is_empty() {
                return true;
            }
            let name_hit = item
                .get("name")
                .and_then(|value| value.as_str())
                .map(|name| name.to_lowercase().contains(&normalized))
                .unwrap_or(false);
            if name_hit {
                return true;
            }
            let desc_hit = item.get("description")
                .and_then(|value| value.as_str())
                .map(|desc| desc.to_lowercase().contains(&normalized))
                .unwrap_or(false);
            if desc_hit {
                return true;
            }
            let source = item.get("source").and_then(|v| v.as_str()).unwrap_or("");
            source == "local_mcp_semantic" || source == "local_assistant_semantic"
        })
        .collect::<Vec<serde_json::Value>>();

    serde_json::json!({
        "query": query,
        "mode": "dynamic_local_scan",
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
                    arguments: tc.get("arguments").cloned().unwrap_or(serde_json::json!({})),
                });
            }
        }
    }
    calls
}

const LOCAL_CONVERSATION_SUMMARY_MAX_CHARS: usize = 2000;
const LOCAL_CODE_MODE_TOOL_RESULTS_MAX_CHARS: usize = 8000;
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
}
