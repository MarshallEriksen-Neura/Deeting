use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::modules::mcp::commands::assistant_management_impl::index_local_assistants;
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::mcp::commands::skill_registry_impl::register_local_skills_inner;
use crate::modules::mcp::commands::source_management_impl::reset_local_asset_catalog_then_sync_inner;
use crate::modules::mcp::types::{
    LocalCapabilityRegistryDiagnosticsBucket, LocalCapabilityRegistryDiagnosticsItem,
    LocalCapabilityRegistryDiagnosticsResponse, LocalCapabilityRegistryParityItem,
    LocalMaintenanceActionRequest, LocalMaintenanceLogItem, LocalMaintenanceLogListResponse,
    LocalMaintenanceLogQuery, LocalSystemAssetRepairResponse,
};
use crate::state::AppState;

#[tauri::command]
pub async fn run_local_maintenance_action(
    app: AppHandle,
    state: State<'_, AppState>,
    access_token: String,
    request: LocalMaintenanceActionRequest,
) -> Result<LocalMaintenanceLogItem, String> {
    let normalized_token = access_token.trim().to_string();
    if normalized_token.is_empty() {
        return Err("access token is required".to_string());
    }

    let kind = request.kind.trim().to_string();
    if kind.is_empty() {
        return Err("maintenance action kind is required".to_string());
    }

    let page_limit = request.limit.unwrap_or(500).clamp(1, 500);
    let enable_reinstall = request.reinstall_missing.unwrap_or(false);
    let log_item = match kind.as_str() {
        "repair_local_index" => {
            let result = execute_repair_action(
                app,
                state.inner(),
                &normalized_token,
                page_limit,
                enable_reinstall,
            )
            .await;
            persist_action_log(state.inner(), &kind, result).await?
        }
        other => return Err(format!("unsupported maintenance action: {}", other)),
    };

    Ok(log_item)
}

#[tauri::command]
pub async fn list_local_maintenance_logs(
    state: State<'_, AppState>,
    query: LocalMaintenanceLogQuery,
) -> Result<LocalMaintenanceLogListResponse, String> {
    state
        .mcp
        .store
        .list_local_maintenance_logs(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_capability_registry_diagnostics(
    state: State<'_, AppState>,
) -> Result<LocalCapabilityRegistryDiagnosticsResponse, String> {
    build_local_capability_registry_diagnostics(state.inner()).await
}

pub(crate) async fn build_local_capability_registry_diagnostics(
    state: &AppState,
) -> Result<LocalCapabilityRegistryDiagnosticsResponse, String> {
    let read_path_mode =
        crate::modules::mcp::commands::runtime::CapabilityRegistryReadMode::RegistryFirst;
    let entries = state
        .mcp
        .store
        .list_local_capability_registry_entries()
        .await
        .map_err(to_string)?;
    let memory_assets = state
        .memory
        .service
        .list_assets_catalog()
        .await
        .map_err(to_string)?;
    let registry_first_assets =
        crate::modules::mcp::commands::runtime::build_capability_assets_for_read_mode(
            memory_assets.clone(),
            &entries,
            crate::modules::mcp::commands::runtime::CapabilityRegistryReadMode::RegistryFirst,
        );
    let registry_first_asset_map = build_control_plane_asset_map(registry_first_assets);
    let legacy_only_asset_map =
        crate::modules::mcp::commands::runtime::build_capability_assets_for_read_mode(
            memory_assets.clone(),
            &entries,
            crate::modules::mcp::commands::runtime::CapabilityRegistryReadMode::LegacyOnly,
        );
    let legacy_control_plane_asset_map = build_control_plane_asset_map(legacy_only_asset_map);
    let current_generation = state
        .mcp
        .store
        .current_local_capability_registry_generation()
        .await
        .map_err(to_string)?;
    let read_path_enabled = true;
    let legacy_control_plane_reads_enabled = false;
    let registry_mcp_count = entries
        .iter()
        .filter(|entry| entry.source_kind == "mcp")
        .count();
    let registry_skill_packages = entries
        .iter()
        .filter(|entry| matches!(entry.asset_kind.as_str(), "skill_bundle" | "skill_tool"))
        .map(|entry| entry.package_id.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let registry_core_count = entries
        .iter()
        .filter(|entry| entry.asset_kind == "core_tool")
        .count();
    let local_skill_install_count = state
        .mcp
        .store
        .list_local_skill_installs()
        .await
        .map_err(to_string)?
        .len();
    let mcp_tool_count = state.mcp.store.list_tools().await.map_err(to_string)?.len();
    let core_tool_count =
        crate::modules::mcp::commands::runtime::build_core_tool_registry_entries(0).len();
    let assistant_count = state
        .mcp
        .store
        .list_local_assistants()
        .await
        .map_err(to_string)?
        .len();
    let registry_assistant_count = entries
        .iter()
        .filter(|entry| entry.source_kind == "assistant")
        .count();
    let legacy_only_assets = legacy_control_plane_asset_map
        .iter()
        .filter(|(key, _)| !registry_first_asset_map.contains_key(*key))
        .filter_map(|(key, asset)| build_parity_item(key, asset))
        .collect::<Vec<_>>();
    let registry_first_only_assets = registry_first_asset_map
        .iter()
        .filter(|(key, _)| !legacy_control_plane_asset_map.contains_key(*key))
        .filter_map(|(key, asset)| build_parity_item(key, asset))
        .collect::<Vec<_>>();
    let mut migration_gaps = Vec::new();
    if registry_core_count < core_tool_count {
        migration_gaps.push("core".to_string());
    }
    if registry_mcp_count < mcp_tool_count {
        migration_gaps.push("mcp".to_string());
    }
    if registry_skill_packages.len() < local_skill_install_count {
        migration_gaps.push("skill".to_string());
    }
    if registry_assistant_count < assistant_count {
        migration_gaps.push("assistant".to_string());
    }

    Ok(LocalCapabilityRegistryDiagnosticsResponse {
        read_path_enabled,
        read_path_mode: read_path_mode.as_str().to_string(),
        legacy_control_plane_reads_enabled,
        current_generation,
        total: entries.len() as i64,
        direct_callable_count: entries
            .iter()
            .filter(|entry| entry.is_direct_callable)
            .count() as i64,
        source_kind_counts: build_registry_buckets(
            entries.iter().map(|entry| entry.source_kind.as_str()),
        ),
        memory_source_type_counts: build_registry_buckets(
            memory_assets
                .iter()
                .filter_map(|asset| asset.get("source_type").and_then(Value::as_str)),
        ),
        asset_kind_counts: build_registry_buckets(
            entries.iter().map(|entry| entry.asset_kind.as_str()),
        ),
        activation_state_counts: build_registry_buckets(
            entries.iter().map(|entry| entry.activation_state.as_str()),
        ),
        runtime_state_counts: build_registry_buckets(
            entries.iter().map(|entry| entry.runtime_state.as_str()),
        ),
        search_index_state_counts: build_registry_buckets(
            entries
                .iter()
                .map(|entry| entry.search_index_state.as_str()),
        ),
        legacy_only_asset_count: legacy_only_assets.len() as i64,
        registry_first_only_asset_count: registry_first_only_assets.len() as i64,
        migration_gaps,
        legacy_only_assets,
        registry_first_only_assets,
        items: entries
            .into_iter()
            .map(|entry| LocalCapabilityRegistryDiagnosticsItem {
                capability_id: entry.capability_id,
                source_kind: entry.source_kind,
                asset_kind: entry.asset_kind,
                package_id: entry.package_id,
                package_version: entry.package_version,
                title: entry.title,
                tool_name: entry.tool_name,
                callable_name: entry.callable_name,
                execution_surface: entry.execution_surface,
                activation_state: entry.activation_state,
                runtime_state: entry.runtime_state,
                search_index_state: entry.search_index_state,
                generation: entry.generation,
                is_direct_callable: entry.is_direct_callable,
                updated_at: entry.updated_at,
            })
            .collect(),
    })
}

async fn execute_repair_action(
    app: AppHandle,
    state: &AppState,
    access_token: &str,
    limit: i64,
    reinstall_missing: bool,
) -> Result<(String, serde_json::Value), String> {
    let base_url = state.mcp.cloud_base_url.read().await.clone();
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
        access_token,
        limit,
        vector_dimension,
        None,
        reinstall_missing,
    )
    .await?;
    let skill_reindexed_count = register_local_skills_inner(app.clone(), state).await? as i64;
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
    index_local_assistants(state, &assistants).await;

    let response = LocalSystemAssetRepairResponse {
        vector_dimension: vector_dimension as i64,
        skill_reindexed_count,
        assistant_reindexed_count,
        sync,
    };
    Ok(build_repair_log_payload(response))
}

fn build_repair_log_payload(
    response: LocalSystemAssetRepairResponse,
) -> (String, serde_json::Value) {
    (
        format!(
            "Rebuilt local asset index and reindexed {} skills / {} assistants",
            response.skill_reindexed_count, response.assistant_reindexed_count
        ),
        json!({
            "vector_dimension": response.vector_dimension,
            "skill_reindexed_count": response.skill_reindexed_count,
            "assistant_reindexed_count": response.assistant_reindexed_count,
            "sync": {
                "assets_fetched": response.sync.fetched_count,
                "skill_install_fetched_count": response.sync.skill_install_fetched_count,
                "skill_install_upserted_count": response.sync.skill_install_upserted_count,
                "skill_reinstalled_count": response.sync.skill_reinstalled_count,
                "skill_failed_count": response.sync.skill_failed_count,
            }
        }),
    )
}

async fn persist_action_log(
    state: &AppState,
    kind: &str,
    result: Result<(String, serde_json::Value), String>,
) -> Result<LocalMaintenanceLogItem, String> {
    let (status, message, details) = match result {
        Ok((message, details)) => ("success", message, Some(details)),
        Err(error) => ("failed", error.clone(), Some(json!({ "error": error }))),
    };
    state
        .mcp
        .store
        .create_local_maintenance_log(kind, status, &message, details.as_ref())
        .await
        .map_err(to_string)
}

fn build_control_plane_asset_map(assets: Vec<Value>) -> std::collections::BTreeMap<String, Value> {
    assets
        .into_iter()
        .filter(|asset| {
            crate::modules::mcp::commands::runtime::is_legacy_control_plane_asset(asset)
        })
        .filter_map(|asset| {
            let key = crate::modules::mcp::commands::runtime::capability_asset_match_key(&asset)?;
            Some((key, asset))
        })
        .collect()
}

fn build_parity_item(key: &str, asset: &Value) -> Option<LocalCapabilityRegistryParityItem> {
    let source_type = asset.get("source_type").and_then(Value::as_str)?.trim();
    let asset_type = asset.get("asset_type").and_then(Value::as_str)?.trim();
    if source_type.is_empty() || asset_type.is_empty() {
        return None;
    }
    let asset_id = asset
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let name = asset
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let package_id = asset
        .get("pkg_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            asset
                .get("metadata")
                .and_then(|metadata| metadata.get("skill_id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        });

    Some(LocalCapabilityRegistryParityItem {
        key: key.to_string(),
        asset_id,
        name,
        source_type: source_type.to_string(),
        asset_type: asset_type.to_string(),
        package_id,
    })
}

fn build_registry_buckets<'a>(
    values: impl Iterator<Item = &'a str>,
) -> Vec<LocalCapabilityRegistryDiagnosticsBucket> {
    let mut counts = std::collections::BTreeMap::<String, i64>::new();
    for value in values {
        let normalized = value.trim();
        if normalized.is_empty() {
            continue;
        }
        *counts.entry(normalized.to_string()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .map(|(key, count)| LocalCapabilityRegistryDiagnosticsBucket { key, count })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_registry_buckets_counts_sorted_values() {
        let buckets =
            build_registry_buckets(["pending", "registered", "pending", "ready"].into_iter());
        assert_eq!(buckets.len(), 3);
        assert_eq!(buckets[0].key, "pending");
        assert_eq!(buckets[0].count, 2);
        assert_eq!(buckets[1].key, "ready");
        assert_eq!(buckets[1].count, 1);
        assert_eq!(buckets[2].key, "registered");
        assert_eq!(buckets[2].count, 1);
    }

    #[test]
    fn build_control_plane_asset_map_filters_to_cutover_assets() {
        let map = build_control_plane_asset_map(vec![
            json!({
                "id": "skill.alpha",
                "asset_type": "skill",
                "source_type": "user",
                "pkg_name": "skill.alpha",
            }),
            json!({
                "id": "cloud.skill.alpha",
                "asset_type": "skill",
                "source_type": "cloud_mirror",
            }),
        ]);

        assert_eq!(map.len(), 1);
        assert!(map.contains_key("skill_bundle:skill.alpha"));
    }

    #[test]
    fn build_parity_item_extracts_display_fields() {
        let item = build_parity_item(
            "skill_tool:skill.alpha::install",
            &json!({
                "id": "skill_binding::skill.alpha::install",
                "name": "skill.skill.alpha.install",
                "asset_type": "skill_tool",
                "source_type": "user",
                "pkg_name": "skill.alpha",
            }),
        )
        .expect("parity item");

        assert_eq!(item.key, "skill_tool:skill.alpha::install");
        assert_eq!(
            item.asset_id.as_deref(),
            Some("skill_binding::skill.alpha::install")
        );
        assert_eq!(item.package_id.as_deref(), Some("skill.alpha"));
    }
}
