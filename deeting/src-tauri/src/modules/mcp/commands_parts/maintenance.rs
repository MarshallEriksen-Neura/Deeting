use serde_json::json;
use tauri::{AppHandle, State};

use crate::modules::mcp::commands::assistant_management_impl::index_local_assistants;
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::mcp::commands::skill_registry_impl::register_local_skills_inner;
use crate::modules::mcp::commands::source_management_impl::{
    reset_local_asset_catalog_then_sync_inner,
};
use crate::modules::mcp::types::{
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
