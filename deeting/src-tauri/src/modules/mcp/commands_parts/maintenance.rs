use serde_json::json;
use tauri::{AppHandle, Manager, State};

use crate::state::AppState;
use crate::modules::mcp::commands::assistant_management_impl::index_local_assistants;
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::mcp::commands::skill_registry_impl::{
    register_local_skills_inner, resolve_local_skill_scan_targets,
};
use crate::modules::mcp::commands::source_management_impl::{
    local_skill_registration_self_heal_needed, reset_local_asset_catalog_then_sync_inner,
    sync_local_system_assets_inner,
};
use crate::modules::mcp::types::{
    LocalMaintenanceActionRequest, LocalMaintenanceLogItem, LocalMaintenanceLogListResponse,
    LocalMaintenanceLogQuery, LocalSystemAssetRepairResponse, LocalSystemAssetSyncResponse,
};

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
        "sync_local_installs" => {
            let result = execute_sync_action(app, state.inner(), &normalized_token, page_limit, false)
                .await;
            persist_action_log(state.inner(), &kind, result).await?
        }
        "sync_reinstall_missing" => {
            let result = execute_sync_action(app, state.inner(), &normalized_token, page_limit, true)
                .await;
            persist_action_log(state.inner(), &kind, result).await?
        }
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

async fn execute_sync_action(
    app: AppHandle,
    state: &AppState,
    access_token: &str,
    limit: i64,
    reinstall_missing: bool,
) -> Result<(String, serde_json::Value), String> {
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
        access_token,
        limit,
        Some(&skills_dir),
        reinstall_missing,
    )
    .await?;
    let skill_reindexed_count = maybe_reindex_skills(&app, state, &response, &skill_scan_roots).await;
    Ok(build_sync_log_payload(response, reinstall_missing, skill_reindexed_count))
}

async fn execute_repair_action(
    app: AppHandle,
    state: &AppState,
    access_token: &str,
    limit: i64,
    reinstall_missing: bool,
) -> Result<(String, serde_json::Value), String> {
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
        access_token,
        limit,
        vector_dimension,
        Some(&skills_dir),
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

async fn maybe_reindex_skills(
    app: &AppHandle,
    state: &AppState,
    response: &LocalSystemAssetSyncResponse,
    skill_scan_roots: &[std::path::PathBuf],
) -> i64 {
    let needs_skill_reindex = if response.skill_reinstalled_count > 0 {
        true
    } else if response.skill_install_fetched_count > 0 {
        local_skill_registration_self_heal_needed(
            state.mcp.store.as_ref(),
            Some(&state.memory.service),
            skill_scan_roots,
        )
        .await
        .unwrap_or(false)
    } else {
        false
    };

    if !needs_skill_reindex {
        return 0;
    }

    match register_local_skills_inner(app.clone(), state).await {
        Ok(count) => count as i64,
        Err(err) => {
            log::warn!("maintenance skill reindex failed: {}", err);
            0
        }
    }
}

fn build_sync_log_payload(
    response: LocalSystemAssetSyncResponse,
    reinstall_missing: bool,
    skill_reindexed_count: i64,
) -> (String, serde_json::Value) {
    let message = if reinstall_missing {
        format!(
            "Synced {} local skill installs and reinstalled {} missing bundles",
            response.skill_install_upserted_count, response.skill_reinstalled_count
        )
    } else {
        format!(
            "Synced {} local skill installs from cloud",
            response.skill_install_upserted_count
        )
    };
    (
        message,
        json!({
            "reinstall_missing": reinstall_missing,
            "assets_fetched": response.fetched_count,
            "skill_install_fetched_count": response.skill_install_fetched_count,
            "skill_install_upserted_count": response.skill_install_upserted_count,
            "skill_reinstalled_count": response.skill_reinstalled_count,
            "skill_failed_count": response.skill_failed_count,
            "skill_reindexed_count": skill_reindexed_count,
        }),
    )
}

fn build_repair_log_payload(response: LocalSystemAssetRepairResponse) -> (String, serde_json::Value) {
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