use super::{
    assistant_management_impl::index_local_assistants,
    assistants_knowledge_admin_impl::{index_mcp_tools, sync_cloud_subscriptions_inner},
    common_impl::to_string,
    runtime::{build_desktop_mcp_tool_views, now_rfc3339, sync_source_inner, DesktopMcpToolView},
    skill_registry_impl::{
        is_hidden_name, materialize_skill_repo_to_dir, register_local_skills_inner,
        resolve_local_skill_definition, resolve_local_skill_scan_targets,
    },
    support::*,
};

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

#[derive(Debug, Clone, Deserialize)]
struct CloudSystemAssetSkillUserInstallMetadata {
    alias: Option<String>,
    #[serde(default)]
    config_json: Value,
    #[serde(default)]
    granted_permissions: Vec<String>,
    installed_revision: Option<String>,
    is_enabled: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
struct CloudSystemAssetSkillMetadata {
    registry_entity: Option<String>,
    skill_id: Option<String>,
    runtime: Option<String>,
    #[serde(default)]
    manifest: Value,
    user_install: Option<CloudSystemAssetSkillUserInstallMetadata>,
}

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

fn skill_metadata_from_system_asset(
    item: &CloudSystemAssetSyncItem,
) -> Option<(String, CloudSystemAssetSkillMetadata)> {
    let skill_id = item
        .asset_id
        .strip_prefix("skill:")
        .map(str::to_string)
        .filter(|raw| !raw.trim().is_empty())?;
    let metadata: CloudSystemAssetSkillMetadata =
        serde_json::from_value(item.metadata_json.clone()).ok()?;
    if metadata.registry_entity.as_deref() != Some("skill") {
        return None;
    }
    let metadata_skill_id = metadata.skill_id.clone().unwrap_or(skill_id.clone());
    if metadata_skill_id.trim().is_empty() {
        return None;
    }
    Some((metadata_skill_id.trim().to_string(), metadata))
}

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

fn read_skill_manifest_json(manifest_path: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(manifest_path).ok()?;
    serde_json::from_str::<Value>(&raw).ok()
}

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

pub(crate) async fn sync_local_system_assets_inner(
    store: &crate::modules::mcp::store::McpStore,
    client: &reqwest::Client,
    base_url: &str,
    access_token: &str,
    limit: i64,
    skills_dir: Option<&Path>,
    reinstall_missing: bool,
) -> Result<LocalSystemAssetSyncResponse, String> {
    let normalized_base_url = base_url.trim_end_matches('/');
    let assistants_url = format!("{normalized_base_url}/api/v1/system-assets/assistants");
    let skills_url = format!("{normalized_base_url}/api/v1/system-assets/skills");
    let assistant_response =
        fetch_system_asset_sync_feed(client, &assistants_url, access_token, limit).await?;
    let skill_response =
        fetch_system_asset_sync_feed(client, &skills_url, access_token, limit).await?;
    let assistant_fetched_count = assistant_response.items.len() as i64;
    let skill_fetched_count = skill_response.items.len() as i64;
    let mut items = assistant_response.items;
    items.extend(skill_response.items);

    let mut upserted_count = 0_i64;
    let mut hidden_count = 0_i64;
    let mut metadata_only_count = 0_i64;
    let mut executable_count = 0_i64;
    let mut skill_install_fetched_count = 0_i64;
    let mut skill_install_upserted_count = 0_i64;
    let mut skill_reinstalled_count = 0_i64;
    let mut skill_failed_count = 0_i64;
    let mut asset_ids = Vec::new();
    let mut skill_ids_to_disable: HashSet<String> = HashSet::new();
    let mut cloud_installed_skill_ids: Vec<String> = Vec::new();
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

        if let Some(skill_id) = item.asset_id.strip_prefix("skill:") {
            if let Some((installed_skill_id, skill_metadata)) =
                skill_metadata_from_system_asset(item)
            {
                if let Some(user_install) = skill_metadata.user_install {
                    skill_install_fetched_count += 1;
                    cloud_installed_skill_ids.push(installed_skill_id.clone());

                    if let Some(skills_root) = skills_dir {
                        let install_path = skills_root.join(&installed_skill_id);
                        let install_path_str = install_path.to_string_lossy().to_string();
                        let is_enabled = user_install.is_enabled.unwrap_or(true);
                        let mut status = "synced".to_string();
                        let mut reinstalled = false;
                        let installed_revision = user_install
                            .installed_revision
                            .clone()
                            .or_else(|| item.checksum.clone());

                        if reinstall_missing && is_enabled && !install_path.exists() {
                            if let Some(repo_url) = item
                                .artifact_ref
                                .as_deref()
                                .filter(|raw| !raw.trim().is_empty())
                            {
                                match materialize_skill_repo_to_dir(
                                    skills_root,
                                    repo_url,
                                    installed_revision.as_deref(),
                                    "user_skill",
                                    Some(&installed_skill_id),
                                )
                                .await
                                {
                                    Ok(_) => {
                                        reinstalled = true;
                                        skill_reinstalled_count += 1;
                                    }
                                    Err(_err) => {
                                        status = "failed_reinstall".to_string();
                                    }
                                }
                            } else {
                                status = "failed_reinstall".to_string();
                            }
                        }

                        let manifest_path = install_path.join("deeting.json");
                        let manifest =
                            read_skill_manifest_json(&manifest_path).unwrap_or_else(|| {
                                let mut manifest = match skill_metadata.manifest.clone() {
                                    Value::Object(map) => Value::Object(map),
                                    _ => serde_json::json!({}),
                                };
                                if let Some(obj) = manifest.as_object_mut() {
                                    obj.entry("id")
                                        .or_insert_with(|| serde_json::json!(installed_skill_id));
                                    obj.entry("name")
                                        .or_insert_with(|| serde_json::json!(item.title));
                                    if let Some(description) = item.description.as_ref() {
                                        obj.entry("description")
                                            .or_insert_with(|| serde_json::json!(description));
                                    }
                                    if !item.version.trim().is_empty() {
                                        obj.entry("version")
                                            .or_insert_with(|| serde_json::json!(item.version));
                                    }
                                    if let Some(repo_url) = item.artifact_ref.as_ref() {
                                        obj.entry("source_repo")
                                            .or_insert_with(|| serde_json::json!(repo_url));
                                    }
                                    if let Some(revision) =
                                        installed_revision.as_ref().or(item.checksum.as_ref())
                                    {
                                        obj.entry("source_revision")
                                            .or_insert_with(|| serde_json::json!(revision));
                                    }
                                    if let Some(runtime) = skill_metadata.runtime.as_ref() {
                                        obj.entry("runtime")
                                            .or_insert_with(|| serde_json::json!(runtime));
                                    }
                                }
                                manifest
                            });
                        let manifest_json = serde_json::to_string(&manifest).map_err(to_string)?;
                        let runtime = manifest
                            .get("runtime")
                            .and_then(|value| value.as_str())
                            .or(skill_metadata.runtime.as_deref());
                        let installed_version = installed_revision
                            .clone()
                            .or_else(|| {
                                manifest
                                    .get("version")
                                    .and_then(|value| value.as_str())
                                    .map(|value| value.to_string())
                            })
                            .or_else(|| {
                                let value = item.version.trim();
                                if value.is_empty() {
                                    None
                                } else {
                                    Some(value.to_string())
                                }
                            });
                        let user_settings = serde_json::json!({
                            "alias": user_install.alias,
                            "config_json": user_install.config_json,
                            "granted_permissions": user_install.granted_permissions,
                            "sync_source": "cloud_plugin_market",
                        });

                        match store
                            .upsert_local_skill_install_state(
                                &installed_skill_id,
                                installed_version.as_deref(),
                                is_enabled,
                                runtime,
                                &manifest_json,
                                &install_path_str,
                                Some(&user_settings),
                            )
                            .await
                        {
                            Ok(_) => {
                                skill_install_upserted_count += 1;
                                if status == "synced" && !is_enabled {
                                    status = "disabled_synced".to_string();
                                } else if status == "synced" && reinstalled {
                                    status = "reinstalled".to_string();
                                } else if status == "synced" && !install_path.exists() {
                                    status = "metadata_synced".to_string();
                                }
                            }
                            Err(_err) => {
                                status = "failed".to_string();
                            }
                        }

                        if status.starts_with("failed") {
                            skill_failed_count += 1;
                        }
                    }
                }
            }
            if matches!(state, "hidden" | "metadata_only") {
                skill_ids_to_disable.insert(skill_id.to_string());
            }
        } else if item.asset_id.strip_prefix("assistant:").is_some() {
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
    let disabled_hidden_skill_count = store
        .disable_local_skills_by_ids(&skill_ids_to_disable.into_iter().collect::<Vec<_>>())
        .await
        .map_err(to_string)?;
    let disabled_missing_skill_count = store
        .disable_missing_cloud_managed_local_skills(&cloud_installed_skill_ids)
        .await
        .map_err(to_string)?;
    let disabled_skill_count = disabled_hidden_skill_count + disabled_missing_skill_count;
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
pub async fn sync_local_system_assets(
    app: AppHandle,
    state: State<'_, AppState>,
    access_token: String,
    limit: Option<i64>,
    reinstall_missing: Option<bool>,
) -> Result<LocalSystemAssetSyncResponse, String> {
    let normalized_token = access_token.trim().to_string();
    if normalized_token.is_empty() {
        return Err("access token is required".to_string());
    }
    let page_limit = limit.unwrap_or(500).clamp(1, 500);
    let enable_reinstall = reinstall_missing.unwrap_or(false);
    let base_url = state.mcp.cloud_base_url.read().await.clone();
    let skills_dir = app.path().app_data_dir().map_err(to_string)?.join("skills");
    std::fs::create_dir_all(&skills_dir).map_err(to_string)?;
    let skill_scan_roots = resolve_local_skill_scan_targets(&app)?
        .into_iter()
        .map(|(path, _)| path)
        .collect::<Vec<_>>();
    let response = sync_local_system_assets_inner(
        state.mcp.store.as_ref(),
        &state.mcp.client,
        &base_url,
        normalized_token.as_str(),
        page_limit,
        Some(&skills_dir),
        enable_reinstall,
    )
    .await?;

    let needs_skill_reindex = if response.skill_reinstalled_count > 0 {
        true
    } else if response.skill_install_fetched_count > 0 {
        match local_skill_registration_self_heal_needed(
            state.mcp.store.as_ref(),
            Some(&state.memory.service),
            &skill_scan_roots,
        )
        .await
        {
            Ok(value) => value,
            Err(err) => {
                warn!("sync_local_system_assets self-heal check failed: {}", err);
                false
            }
        }
    } else {
        false
    };

    if needs_skill_reindex {
        if let Err(err) = register_local_skills_inner(app, state.inner()).await {
            warn!(
                "sync_local_system_assets register_local_skills failed: {}",
                err
            );
        }
    }

    Ok(response)
}

#[tauri::command]
pub async fn repair_local_system_asset_index(
    app: AppHandle,
    state: State<'_, AppState>,
    access_token: String,
    limit: Option<i64>,
    reinstall_missing: Option<bool>,
) -> Result<LocalSystemAssetRepairResponse, String> {
    let normalized_token = access_token.trim().to_string();
    if normalized_token.is_empty() {
        return Err("access token is required".to_string());
    }
    let page_limit = limit.unwrap_or(500).clamp(1, 500);
    let enable_reinstall = reinstall_missing.unwrap_or(false);
    let base_url = state.mcp.cloud_base_url.read().await.clone();
    let skills_dir = app.path().app_data_dir().map_err(to_string)?.join("skills");
    std::fs::create_dir_all(&skills_dir).map_err(to_string)?;

    let probe_vector = state
        .providers
        .embedding
        .embed_text("local_system_asset_index_repair_probe")
        .await
        .map_err(to_string)?;
    let vector_dimension = i32::try_from(probe_vector.len())
        .map_err(|_| "embedding vector dimension is too large".to_string())?;
    if vector_dimension <= 0 {
        return Err("embedding model returned empty vector".to_string());
    }

    let sync = reset_local_asset_catalog_then_sync_inner(
        &state.memory.service,
        state.mcp.store.as_ref(),
        &state.mcp.client,
        &base_url,
        normalized_token.as_str(),
        page_limit,
        vector_dimension,
        Some(&skills_dir),
        enable_reinstall,
    )
    .await?;

    let skill_reindexed_count =
        register_local_skills_inner(app.clone(), state.inner()).await? as i64;
    let assistants = state
        .mcp
        .store
        .list_local_assistants()
        .await
        .map_err(to_string)?;
    let enabled_assistant_ids = state
        .mcp
        .store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_default();
    let assistant_reindexed_count = assistants
        .iter()
        .filter(|assistant| enabled_assistant_ids.contains(assistant.id.as_str()))
        .count() as i64;
    index_local_assistants(state.inner(), &assistants).await;

    Ok(LocalSystemAssetRepairResponse {
        vector_dimension: vector_dimension as i64,
        skill_reindexed_count,
        assistant_reindexed_count,
        sync,
    })
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
