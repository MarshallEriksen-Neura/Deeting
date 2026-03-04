use std::collections::{HashMap, HashSet};
use std::path::Path;
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

#[derive(Debug, Clone, Deserialize)]
struct CloudAssistantMarketPage {
    items: Vec<CloudAssistantMarketItem>,
    next_page: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CloudAssistantMarketItem {
    assistant_id: String,
    owner_user_id: Option<String>,
    icon_id: Option<String>,
    share_slug: Option<String>,
    summary: Option<String>,
    published_at: Option<String>,
    install_count: Option<i64>,
    rating_avg: Option<f64>,
    rating_count: Option<i64>,
    version: CloudAssistantMarketVersion,
}

#[derive(Debug, Clone, Deserialize)]
struct CloudAssistantMarketVersion {
    id: String,
    version: String,
    name: String,
    description: Option<String>,
    system_prompt: Option<String>,
    tags: Option<Vec<String>>,
    published_at: Option<String>,
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
pub async fn sync_local_system_assistants(
    state: State<'_, AppState>,
    access_token: String,
    size: Option<i64>,
) -> Result<LocalSystemAssistantSyncResponse, String> {
    let normalized_token = access_token.trim().to_string();
    if normalized_token.is_empty() {
        return Err("access token is required".to_string());
    }

    let page_size = size.unwrap_or(100).clamp(1, 200);
    let mut cursor: Option<String> = None;
    let mut page_guard = 0_i32;
    let mut fetched_count = 0_i64;
    let mut system_items: Vec<CloudSystemAssistantSnapshot> = Vec::new();
    let mut dedupe_ids: HashSet<String> = HashSet::new();

    loop {
        page_guard += 1;
        if page_guard > 30 {
            break;
        }

        let base_url = state.mcp.cloud_base_url.read().await.clone();
        let url = format!(
            "{}/api/v1/assistants/market",
            base_url.trim_end_matches('/')
        );
        let mut request = state
            .mcp
            .client
            .get(&url)
            .bearer_auth(normalized_token.as_str())
            .query(&[("size", page_size.to_string())]);
        if let Some(cursor_value) = cursor.as_deref() {
            request = request.query(&[("cursor", cursor_value)]);
        }

        let response = request.send().await.map_err(to_string)?;
        if !response.status().is_success() {
            return Err(format!(
                "failed to sync system assistants: {}",
                response.status()
            ));
        }

        let page: CloudAssistantMarketPage = response.json().await.map_err(to_string)?;
        fetched_count += page.items.len() as i64;

        for item in page.items {
            if item.owner_user_id.is_some() {
                continue;
            }
            if !dedupe_ids.insert(item.assistant_id.clone()) {
                continue;
            }

            system_items.push(CloudSystemAssistantSnapshot {
                assistant_id: item.assistant_id,
                icon_id: item.icon_id,
                share_slug: item.share_slug,
                summary: item.summary,
                published_at: item.published_at,
                install_count: item.install_count.unwrap_or(0),
                rating_avg: item.rating_avg.unwrap_or(0.0),
                rating_count: item.rating_count.unwrap_or(0),
                version: CloudSystemAssistantVersionSnapshot {
                    id: item.version.id,
                    version: item.version.version,
                    name: item.version.name,
                    description: item.version.description,
                    system_prompt: item.version.system_prompt,
                    tags: item.version.tags.unwrap_or_default(),
                    published_at: item.version.published_at,
                },
            });
        }

        cursor = page.next_page;
        if cursor.is_none() {
            break;
        }
    }

    let (synced_count, archived_count) = state
        .mcp
        .store
        .sync_cloud_system_assistants(&system_items)
        .await
        .map_err(to_string)?;

    if let Ok(assistants) = state.mcp.store.list_local_assistants().await {
        let app_state_clone = state.inner().clone();
        tauri::async_runtime::spawn(async move {
            index_local_assistants(&app_state_clone, &assistants).await;
        });
    }

    Ok(LocalSystemAssistantSyncResponse {
        fetched_count,
        synced_count,
        archived_count,
    })
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
