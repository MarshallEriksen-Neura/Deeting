use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use log::warn;
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Deserialize)]
struct CloudPluginInstallItem {
    skill_id: String,
    alias: Option<String>,
    #[serde(default)]
    config_json: serde_json::Value,
    #[serde(default)]
    granted_permissions: Vec<String>,
    installed_revision: Option<String>,
    is_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct CloudPluginMarketSkillItem {
    id: String,
    name: String,
    description: Option<String>,
    version: Option<String>,
    source_repo: Option<String>,
    source_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalSkillInstallSyncItem {
    pub skill_id: String,
    pub is_enabled: bool,
    pub installed_revision: Option<String>,
    pub install_path: String,
    pub status: String,
    pub reinstalled: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalSkillInstallSyncResponse {
    pub fetched_count: i64,
    pub upserted_count: i64,
    pub reinstalled_count: i64,
    pub failed_count: i64,
    pub items: Vec<LocalSkillInstallSyncItem>,
}

#[derive(Debug, Clone)]
pub(crate) struct LocalModelConnection {
    pub(crate) provider_model_id: String,
    pub(crate) model_id: String,
}

pub(crate) async fn index_local_assistants(app_state: &AppState, assistants: &[LocalAssistant]) {
    let enabled_assistant_ids = app_state
        .mcp
        .store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_default();

    for assistant in assistants {
        if !enabled_assistant_ids.contains(assistant.id.as_str()) {
            continue;
        }
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

fn normalize_skill_dir_name(skill_id: &str) -> String {
    let mut out = String::with_capacity(skill_id.len());
    for ch in skill_id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let normalized = out.trim_matches('_').trim().to_string();
    if normalized.is_empty() {
        "skill".to_string()
    } else {
        normalized
    }
}

fn is_allowed_skill_repo_url(repo_url: &str) -> bool {
    let normalized = repo_url.trim().to_ascii_lowercase();
    normalized.starts_with("https://github.com/") || normalized.starts_with("git@github.com:")
}

fn read_manifest_json(manifest_path: &Path) -> Option<serde_json::Value> {
    let raw = std::fs::read_to_string(manifest_path).ok()?;
    serde_json::from_str::<serde_json::Value>(&raw).ok()
}

async fn fetch_cloud_plugin_market_skill(
    client: &reqwest::Client,
    base_url: &str,
    access_token: &str,
    skill_id: &str,
) -> Result<Option<CloudPluginMarketSkillItem>, String> {
    let url = format!(
        "{}/api/v1/plugin-market/plugins",
        base_url.trim_end_matches('/')
    );
    let rows: Vec<CloudPluginMarketSkillItem> = client
        .get(&url)
        .bearer_auth(access_token)
        .query(&[("q", skill_id), ("limit", "20")])
        .send()
        .await
        .map_err(to_string)?
        .error_for_status()
        .map_err(to_string)?
        .json()
        .await
        .map_err(to_string)?;

    Ok(rows.into_iter().find(|row| row.id == skill_id))
}

async fn fetch_cloud_plugin_installs(
    client: &reqwest::Client,
    base_url: &str,
    access_token: &str,
) -> Result<Vec<CloudPluginInstallItem>, String> {
    let installs_url = format!(
        "{}/api/v1/plugin-market/installs",
        base_url.trim_end_matches('/')
    );
    client
        .get(&installs_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(to_string)?
        .error_for_status()
        .map_err(to_string)?
        .json()
        .await
        .map_err(to_string)
}

async fn try_clone_skill_repo(
    target_dir: &Path,
    repo_url: &str,
    revision: Option<&str>,
) -> Result<(), String> {
    if let Some(parent) = target_dir.parent() {
        std::fs::create_dir_all(parent).map_err(to_string)?;
    }

    if target_dir.exists() {
        return Ok(());
    }

    let normalized_repo = repo_url.trim();
    if normalized_repo.is_empty() {
        return Err("source repo is empty".to_string());
    }
    if !is_allowed_skill_repo_url(normalized_repo) {
        return Err("source repo is not in the allowed host list".to_string());
    }
    let revision = revision
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
        .ok_or_else(|| "pinned revision is required for reinstall".to_string())?;

    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("clone").arg("--depth").arg("1");
    cmd.arg("--branch").arg(revision);
    cmd.arg(normalized_repo).arg(target_dir);
    let output = cmd.output().await.map_err(to_string)?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let _ = std::fs::remove_dir_all(target_dir);
    Err(if stderr.is_empty() {
        "git clone failed".to_string()
    } else {
        format!("git clone failed: {}", stderr)
    })
}

async fn sync_local_skill_installs_from_cloud_inner(
    store: &crate::modules::mcp::store::McpStore,
    client: &reqwest::Client,
    base_url: &str,
    access_token: &str,
    skills_dir: &Path,
    reinstall_missing: bool,
) -> Result<LocalSkillInstallSyncResponse, String> {
    let installs = fetch_cloud_plugin_installs(client, base_url, access_token).await?;
    let enable_reinstall = reinstall_missing;

    let mut upserted_count = 0_i64;
    let mut reinstalled_count = 0_i64;
    let mut failed_count = 0_i64;
    let mut items = Vec::new();
    let mut cloud_installed_skill_ids = Vec::new();

    for install in installs.iter() {
        let skill_id = install.skill_id.trim().to_string();
        if skill_id.is_empty() {
            continue;
        }
        cloud_installed_skill_ids.push(skill_id.clone());

        let install_path = skills_dir.join(normalize_skill_dir_name(&skill_id));
        let install_path_str = install_path.to_string_lossy().to_string();
        let mut status = "synced".to_string();
        let mut reinstalled = false;
        let mut error: Option<String> = None;

        let market_skill =
            fetch_cloud_plugin_market_skill(client, base_url, access_token, &skill_id)
                .await
                .ok()
                .flatten();

        if enable_reinstall && install.is_enabled && !install_path.exists() {
            if let Some(cloud_skill) = market_skill.as_ref() {
                if let Some(repo_url) = cloud_skill.source_repo.as_deref() {
                    let revision = install
                        .installed_revision
                        .as_deref()
                        .or(cloud_skill.source_revision.as_deref());
                    match try_clone_skill_repo(&install_path, repo_url, revision).await {
                        Ok(_) => {
                            reinstalled = true;
                            reinstalled_count += 1;
                        }
                        Err(err) => {
                            status = "failed_reinstall".to_string();
                            error = Some(err);
                        }
                    }
                } else {
                    status = "failed_reinstall".to_string();
                    error = Some("market skill source_repo is missing".to_string());
                }
            } else {
                status = "failed_reinstall".to_string();
                error = Some("market skill metadata not found".to_string());
            }
        }

        let manifest_path = install_path.join("deeting.json");
        let manifest = read_manifest_json(&manifest_path).unwrap_or_else(|| {
            serde_json::json!({
                "id": skill_id,
                "name": market_skill
                    .as_ref()
                    .map(|s| s.name.clone())
                    .unwrap_or_else(|| install.skill_id.clone()),
                "description": market_skill
                    .as_ref()
                    .and_then(|s| s.description.clone()),
                "version": market_skill
                    .as_ref()
                    .and_then(|s| s.version.clone()),
                "source_repo": market_skill
                    .as_ref()
                    .and_then(|s| s.source_repo.clone()),
                "source_revision": install
                    .installed_revision
                    .clone()
                    .or_else(|| market_skill.as_ref().and_then(|s| s.source_revision.clone())),
            })
        });
        let manifest_json = serde_json::to_string(&manifest).map_err(to_string)?;

        let runtime = manifest.get("runtime").and_then(|v| v.as_str());
        let installed_version = install
            .installed_revision
            .clone()
            .or_else(|| {
                manifest
                    .get("version")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string())
            })
            .or_else(|| market_skill.as_ref().and_then(|s| s.version.clone()));
        let user_settings = serde_json::json!({
            "alias": install.alias,
            "config_json": install.config_json,
            "granted_permissions": install.granted_permissions,
            "sync_source": "cloud_plugin_market",
        });

        match store
            .upsert_local_skill_install_state(
                &skill_id,
                installed_version.as_deref(),
                install.is_enabled,
                runtime,
                &manifest_json,
                &install_path_str,
                Some(&user_settings),
            )
            .await
        {
            Ok(_) => {
                upserted_count += 1;
                if status == "synced" && !install.is_enabled {
                    status = "disabled_synced".to_string();
                } else if status == "synced" && reinstalled {
                    status = "reinstalled".to_string();
                } else if status == "synced" && !install_path.exists() {
                    status = "metadata_synced".to_string();
                }
            }
            Err(err) => {
                status = "failed".to_string();
                error = Some(err.to_string());
            }
        }

        if status.starts_with("failed") {
            failed_count += 1;
        }

        items.push(LocalSkillInstallSyncItem {
            skill_id,
            is_enabled: install.is_enabled,
            installed_revision: installed_version,
            install_path: install_path_str,
            status,
            reinstalled,
            error,
        });
    }

    if let Err(err) = store
        .disable_missing_cloud_managed_local_skills(&cloud_installed_skill_ids)
        .await
    {
        warn!(
            "sync_local_skill_installs_from_cloud disable missing cloud installs failed: {}",
            err
        );
    }

    Ok(LocalSkillInstallSyncResponse {
        fetched_count: installs.len() as i64,
        upserted_count,
        reinstalled_count,
        failed_count,
        items,
    })
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
            if id.trim().is_empty() {
                continue;
            }
            let tool_desc_prefix = manifest["description"].as_str().unwrap_or("");
            let source_id = format!("{}_{}", source_prefix, id);
            let version = manifest.get("version").and_then(|v| v.as_str());
            let runtime = manifest.get("runtime").and_then(|v| v.as_str());

            store
                .upsert_local_skill_install(
                    id,
                    version,
                    runtime,
                    &deeting_json_str,
                    &skill_path.to_string_lossy(),
                )
                .await
                .map_err(to_string)?;

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
                        let final_pkg_name = id.to_string();
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
pub async fn sync_local_skill_installs_from_cloud(
    app: AppHandle,
    state: State<'_, AppState>,
    access_token: String,
    reinstall_missing: Option<bool>,
) -> Result<LocalSkillInstallSyncResponse, String> {
    let normalized_token = access_token.trim().to_string();
    if normalized_token.is_empty() {
        return Err("access token is required".to_string());
    }

    let app_state = state.inner();
    let base_url = app_state.mcp.cloud_base_url.read().await.clone();
    let enable_reinstall = reinstall_missing.unwrap_or(false);
    let skills_dir = app.path().app_data_dir().map_err(to_string)?.join("skills");
    std::fs::create_dir_all(&skills_dir).map_err(to_string)?;
    let response = sync_local_skill_installs_from_cloud_inner(
        app_state.mcp.store.as_ref(),
        &app_state.mcp.client,
        &base_url,
        normalized_token.as_str(),
        &skills_dir,
        enable_reinstall,
    )
    .await?;

    if let Err(err) = register_local_skills_inner(app, app_state).await {
        warn!(
            "sync_local_skill_installs_from_cloud register_local_skills failed: {}",
            err
        );
    }

    Ok(response)
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
