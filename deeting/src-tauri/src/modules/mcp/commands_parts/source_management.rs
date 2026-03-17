use super::{
    assistants_knowledge_admin_impl::{index_mcp_tools, sync_cloud_subscriptions_inner},
    common_impl::to_string,
    runtime::{build_desktop_mcp_tool_views, now_rfc3339, sync_source_inner, DesktopMcpToolView},
    support::*,
};
#[cfg(test)]
use super::{is_hidden_name, resolve_local_skill_definition};

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CloudSubscriptionTool {
    pub(crate) identifier: String,
    pub(crate) name: String,
    pub(crate) source_url: Option<String>,
    pub(crate) capabilities: Vec<String>,
    pub(crate) description: String,
    pub(crate) config_json: String,
    pub(crate) config_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CloudSubscriptionItem {
    pub(crate) tool: CloudSubscriptionTool,
}

#[cfg(test)]
#[derive(Debug, Clone, Deserialize)]
struct CloudSystemAssetAssistantMetadataVersion {
    id: Option<String>,
    version: Option<String>,
    name: Option<String>,
    description: Option<String>,
    system_prompt: Option<String>,
    tags: Option<Vec<String>>,
    published_at: Option<String>,
}

#[cfg(test)]
#[derive(Debug, Clone, Deserialize)]
struct CloudSystemAssetAssistantMetadata {
    registry_entity: Option<String>,
    assistant_id: Option<String>,
    current_version_id: Option<String>,
    summary: Option<String>,
    icon_id: Option<String>,
    share_slug: Option<String>,
    published_at: Option<String>,
    install_count: Option<i64>,
    rating_avg: Option<f64>,
    rating_count: Option<i64>,
    version: Option<CloudSystemAssetAssistantMetadataVersion>,
}

#[cfg(test)]
fn assistant_snapshot_from_system_asset(
    item: &CloudSystemAssetSyncItem,
) -> Option<CloudSystemAssistantSnapshot> {
    let assistant_id = item
        .asset_id
        .strip_prefix("assistant:")
        .map(str::to_string)
        .filter(|raw| !raw.trim().is_empty())?;
    let metadata: CloudSystemAssetAssistantMetadata =
        serde_json::from_value(item.metadata_json.clone()).ok()?;
    if metadata.registry_entity.as_deref() != Some("assistant") {
        return None;
    }

    let version = metadata.version?;
    let version_id = metadata
        .current_version_id
        .or_else(|| version.id.clone())?
        .trim()
        .to_string();
    if version_id.is_empty() {
        return None;
    }

    let version_name = version
        .name
        .clone()
        .unwrap_or_else(|| item.title.clone())
        .trim()
        .to_string();
    if version_name.is_empty() {
        return None;
    }

    Some(CloudSystemAssistantSnapshot {
        assistant_id: metadata
            .assistant_id
            .unwrap_or(assistant_id)
            .trim()
            .to_string(),
        icon_id: metadata.icon_id,
        share_slug: metadata.share_slug,
        summary: metadata.summary.or_else(|| item.description.clone()),
        published_at: metadata
            .published_at
            .clone()
            .or_else(|| version.published_at.clone()),
        install_count: metadata.install_count.unwrap_or_default(),
        rating_avg: metadata.rating_avg.unwrap_or_default(),
        rating_count: metadata.rating_count.unwrap_or_default(),
        version: CloudSystemAssistantVersionSnapshot {
            id: version_id,
            version: version.version.unwrap_or_else(|| item.version.clone()),
            name: version_name,
            description: version.description.or_else(|| item.description.clone()),
            system_prompt: version.system_prompt,
            tags: version.tags.unwrap_or_default(),
            published_at: version.published_at.or(metadata.published_at),
        },
    })
}

#[cfg(test)]
async fn fetch_system_asset_sync_feed(
    client: &reqwest::Client,
    url: &str,
    access_token: &str,
    limit: i64,
) -> Result<CloudSystemAssetSyncResponse, String> {
    client
        .get(url)
        .bearer_auth(access_token)
        .query(&[("limit", limit.to_string())])
        .send()
        .await
        .map_err(to_string)?
        .error_for_status()
        .map_err(to_string)?
        .json()
        .await
        .map_err(to_string)
}

#[cfg(test)]
async fn local_skill_registration_needs_reindex(
    store: &crate::modules::mcp::store::McpStore,
    memory_service: Option<&crate::modules::memory::service::MemoryService>,
    skill_id: &str,
    skill_path: &Path,
) -> Result<bool, String> {
    let Some(install_path) = store
        .get_local_skill_install_path(skill_id)
        .await
        .map_err(to_string)?
    else {
        return Ok(true);
    };

    if install_path.trim() != skill_path.to_string_lossy() {
        return Ok(true);
    }

    if let Some(memory_service) = memory_service {
        if memory_service
            .get_asset_by_id(skill_id)
            .await
            .map_err(to_string)?
            .is_none()
        {
            return Ok(true);
        }
    }

    Ok(false)
}

#[cfg(test)]
pub(crate) async fn local_skill_registration_self_heal_needed(
    store: &crate::modules::mcp::store::McpStore,
    memory_service: Option<&crate::modules::memory::service::MemoryService>,
    skill_roots: &[std::path::PathBuf],
) -> Result<bool, String> {
    for skills_root in skill_roots {
        if !skills_root.exists() {
            continue;
        }

        let entries = std::fs::read_dir(skills_root).map_err(to_string)?;
        for entry in entries {
            let entry = match entry.map_err(to_string) {
                Ok(entry) => entry,
                Err(err) => return Err(err),
            };
            if is_hidden_name(&entry.file_name()) {
                continue;
            }
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let Some(skill_def) =
                resolve_local_skill_definition(&path, "reindex", None, None).map_err(to_string)?
            else {
                continue;
            };

            if local_skill_registration_needs_reindex(
                store,
                memory_service,
                &skill_def.skill_id,
                &path,
            )
            .await?
            {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

#[cfg(test)]
pub(crate) async fn sync_local_system_assets_inner(
    store: &crate::modules::mcp::store::McpStore,
    client: &reqwest::Client,
    base_url: &str,
    access_token: &str,
    limit: i64,
    _skills_dir: Option<&Path>,
    _reinstall_missing: bool,
) -> Result<LocalSystemAssetSyncResponse, String> {
    let normalized_base_url = base_url.trim_end_matches('/');
    let assistants_url = format!("{normalized_base_url}/api/v1/system-assets/assistants");
    let assistant_response =
        fetch_system_asset_sync_feed(client, &assistants_url, access_token, limit).await?;
    let assistant_fetched_count = assistant_response.items.len() as i64;
    let skill_fetched_count = 0_i64;
    let items = assistant_response.items;

    let mut upserted_count = 0_i64;
    let mut hidden_count = 0_i64;
    let mut metadata_only_count = 0_i64;
    let mut executable_count = 0_i64;
    let skill_install_fetched_count = 0_i64;
    let skill_install_upserted_count = 0_i64;
    let skill_reinstalled_count = 0_i64;
    let skill_failed_count = 0_i64;
    let mut asset_ids = Vec::new();
    let mut active_assistant_snapshots: Vec<CloudSystemAssistantSnapshot> = Vec::new();
    let mut active_assistant_ids: HashSet<String> = HashSet::new();

    for item in &items {
        store
            .upsert_cloud_system_asset(item)
            .await
            .map_err(to_string)?;
        upserted_count += 1;
        asset_ids.push(item.asset_id.clone());

        let state = item.policy_snapshot.materialization_state.trim();
        match state {
            "hidden" => hidden_count += 1,
            "metadata_only" => metadata_only_count += 1,
            _ => executable_count += 1,
        }

        if item.asset_id.strip_prefix("assistant:").is_some() {
            if state != "hidden" {
                if let Some(snapshot) = assistant_snapshot_from_system_asset(item) {
                    active_assistant_ids.insert(snapshot.assistant_id.clone());
                    active_assistant_snapshots.push(snapshot);
                }
            }
        }
    }

    store
        .upsert_cloud_system_assistants(&active_assistant_snapshots)
        .await
        .map_err(to_string)?;

    let archived_count = store
        .archive_missing_cloud_system_assets(&asset_ids)
        .await
        .map_err(to_string)?;
    let disabled_skill_count = 0_i64;
    let archived_assistant_count = store
        .archive_missing_cloud_system_assistants_by_ids(
            &active_assistant_ids.into_iter().collect::<Vec<_>>(),
        )
        .await
        .map_err(to_string)?;
    Ok(LocalSystemAssetSyncResponse {
        fetched_count: items.len() as i64,
        assistant_fetched_count,
        skill_fetched_count,
        upserted_count,
        hidden_count,
        metadata_only_count,
        executable_count,
        archived_count,
        skill_install_fetched_count,
        skill_install_upserted_count,
        skill_reinstalled_count,
        skill_failed_count,
        disabled_skill_count,
        archived_assistant_count,
    })
}

#[cfg(test)]
pub(crate) async fn reset_local_asset_catalog_then_sync_inner(
    memory_service: &crate::modules::memory::service::MemoryService,
    store: &crate::modules::mcp::store::McpStore,
    client: &reqwest::Client,
    base_url: &str,
    access_token: &str,
    limit: i64,
    vector_dimension: i32,
    skills_dir: Option<&Path>,
    reinstall_missing: bool,
) -> Result<LocalSystemAssetSyncResponse, String> {
    memory_service
        .recreate_local_asset_table(vector_dimension)
        .await
        .map_err(to_string)?;
    sync_local_system_assets_inner(
        store,
        client,
        base_url,
        access_token,
        limit,
        skills_dir,
        reinstall_missing,
    )
    .await
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
    state.mcp.store.list_sources().await.map_err(to_string)
}

#[tauri::command]
pub async fn create_mcp_source(
    state: State<'_, AppState>,
    payload: CreateSourceRequest,
) -> Result<McpSource, String> {
    let source = NewSource {
        name: payload.name,
        source_type: payload.source_type,
        path_or_url: payload.path_or_url,
        trust_level: payload.trust_level,
        status: McpSourceStatus::Active,
        last_synced_at: None,
        is_read_only: payload.is_read_only.unwrap_or(false),
    };
    state
        .mcp
        .store
        .insert_source(source)
        .await
        .map_err(to_string)
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

    if state.store.is_internal_skill_source(&source) {
        return Err(to_string(McpError::validation(
            "skill-backed sources are managed internally and cannot be synced as MCP config sources",
        )));
    }

    state
        .store
        .update_source_status(&source_id, McpSourceStatus::Syncing, None)
        .await
        .map_err(to_string)?;

    let result = sync_source_inner(state, source, payload.auth_token).await;
    match result {
        Ok(tools) => {
            state
                .store
                .update_source_status(&source_id, McpSourceStatus::Active, Some(now_rfc3339()))
                .await
                .map_err(to_string)?;
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
pub async fn list_mcp_tools(state: State<'_, AppState>) -> Result<Vec<DesktopMcpToolView>, String> {
    let indexed_tool_ids = match state.memory.service.list_assets_catalog().await {
        Ok(assets) => Some(
            assets
                .into_iter()
                .filter(|asset| asset.get("asset_type").and_then(Value::as_str) == Some("tool"))
                .filter_map(|asset| asset.get("id").and_then(Value::as_str).map(str::to_string))
                .collect::<HashSet<_>>(),
        ),
        Err(err) => {
            warn!("failed to read local MCP asset index status: {}", err);
            None
        }
    };

    build_desktop_mcp_tool_views(&state.mcp.store, indexed_tool_ids.as_ref()).await
}
