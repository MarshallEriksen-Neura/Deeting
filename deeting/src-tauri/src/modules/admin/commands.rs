use mcp_registry::diagnostics::{
    build_control_plane_asset_map, build_parity_item, build_registry_buckets,
};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::state::AppState;
use mcp_registry::types::{
    LocalCapabilityRegistryDiagnosticsItem, LocalCapabilityRegistryDiagnosticsResponse,
};
use mcp_session::admin::{
    LocalAdminConversationItem, LocalAdminConversationListResponse,
    LocalAdminConversationMessageListResponse, LocalAdminConversationMessageQuery,
    LocalAdminConversationQuery, LocalAdminConversationSummaryListResponse,
    LocalConversationSummaryBatchRetryRequest, LocalConversationSummaryBatchRetryResponse,
    LocalConversationSummaryEnqueueResponse, LocalConversationSummaryIdleTaskListResponse,
    LocalConversationSummaryIdleTaskQuery, LocalConversationSummaryJobListResponse,
    LocalConversationSummaryJobQuery, LocalConversationSummaryQueueStats, LocalGatewayLogItem,
    LocalGatewayLogListResponse, LocalGatewayLogQuery, LocalGatewayLogStatsResponse,
    LocalMaintenanceActionRequest, LocalMaintenanceLogItem, LocalMaintenanceLogListResponse,
    LocalMaintenanceLogQuery, LocalTraceFeedback, LocalTraceFeedbackRequest,
};

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
pub async fn list_local_admin_conversations(
    state: State<'_, AppState>,
    query: LocalAdminConversationQuery,
) -> Result<LocalAdminConversationListResponse, String> {
    state
        .mcp
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
    state
        .mcp
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
    state
        .mcp
        .store
        .list_local_admin_conversation_summaries(&session_id)
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
pub async fn create_local_trace_feedback(
    state: State<'_, AppState>,
    payload: LocalTraceFeedbackRequest,
) -> Result<LocalTraceFeedback, String> {
    state
        .mcp
        .store
        .create_local_trace_feedback(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_gateway_logs(
    state: State<'_, AppState>,
    query: LocalGatewayLogQuery,
) -> Result<LocalGatewayLogListResponse, String> {
    state
        .mcp
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
    state
        .mcp
        .store
        .create_local_gateway_log(
            payload.trace_id.as_deref(),
            payload.user_id.as_deref(),
            payload.api_key_id.as_deref(),
            payload.preset_id.as_deref(),
            &payload.model,
            payload.status_code,
            payload.duration_ms,
            payload.ttft_ms,
            None,
            0,
            payload.input_tokens,
            payload.output_tokens,
            payload.total_tokens,
            payload.cost_upstream,
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
    query: Option<LocalGatewayLogQuery>,
) -> Result<LocalGatewayLogStatsResponse, String> {
    state
        .mcp
        .store
        .get_local_gateway_log_stats(query.unwrap_or_default())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_conversation_summary_queue_stats(
    state: State<'_, AppState>,
) -> Result<LocalConversationSummaryQueueStats, String> {
    state
        .mcp
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
    state
        .mcp
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
    state
        .mcp
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
    state
        .mcp
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
    state
        .mcp
        .store
        .retry_local_conversation_summary_jobs(payload)
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
pub async fn run_local_maintenance_action(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LocalMaintenanceActionRequest,
) -> Result<LocalMaintenanceLogItem, String> {
    let kind = request.kind.trim().to_string();
    if kind.is_empty() {
        return Err("maintenance action kind is required".to_string());
    }

    let log_item = match kind.as_str() {
        "repair_local_index" => {
            let result = execute_repair_action(app, state.inner()).await;
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
    let cache_status =
        crate::modules::mcp::commands::runtime::capability_registry_cache::capability_registry_cache_diagnostics(&state.mcp.store);
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
        crate::modules::code_mode::core_tool_contracts::build_core_tool_registry_entries(0).len();
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
        cache_status: Some(cache_status),
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
) -> Result<(String, serde_json::Value), String> {
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

    state
        .memory
        .service
        .recreate_local_asset_table(vector_dimension)
        .await
        .map_err(to_string)?;

    let core_registry_count =
        crate::modules::code_mode::core_tool_contracts::sync_core_tool_registry_entries(
            state.mcp.store.as_ref(),
        )
        .await? as i64;
    let mcp_registry_count = state
        .mcp
        .store
        .sync_all_mcp_tool_registry_entries()
        .await
        .map_err(to_string)?;
    let assistant_registry_count = state
        .mcp
        .store
        .sync_all_assistant_registry_entries()
        .await
        .map_err(to_string)?;
    let skill_reindexed_count =
        crate::modules::skills::commands::register_local_skills_inner(app.clone(), state).await?
            as i64;
    let tools = state.mcp.store.list_tools().await.map_err(to_string)?;
    let mcp_tool_reindexed_count = tools.len() as i64;
    crate::modules::knowledge::tool_index::index_mcp_tools(state, &tools).await;

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
    crate::modules::assistants::commands::index_local_assistants(state, &assistants).await;
    let knowledge_reindexed_count =
        crate::modules::knowledge::asset_indexing::rebuild_local_knowledge_vector_index(state)
            .await? as i64;

    Ok(build_repair_log_payload(
        vector_dimension as i64,
        core_registry_count,
        mcp_registry_count,
        assistant_registry_count,
        skill_reindexed_count,
        mcp_tool_reindexed_count,
        assistant_reindexed_count,
        knowledge_reindexed_count,
    ))
}

fn build_repair_log_payload(
    vector_dimension: i64,
    core_registry_count: i64,
    mcp_registry_count: i64,
    assistant_registry_count: i64,
    skill_reindexed_count: i64,
    mcp_tool_reindexed_count: i64,
    assistant_reindexed_count: i64,
    knowledge_reindexed_count: i64,
) -> (String, serde_json::Value) {
    (
        format!(
            "Rebuilt local asset index and reindexed {} skills / {} MCP tools / {} assistants / {} knowledge assets",
            skill_reindexed_count,
            mcp_tool_reindexed_count,
            assistant_reindexed_count,
            knowledge_reindexed_count
        ),
        json!({
            "vector_dimension": vector_dimension,
            "core_registry_count": core_registry_count,
            "mcp_registry_count": mcp_registry_count,
            "assistant_registry_count": assistant_registry_count,
            "skill_reindexed_count": skill_reindexed_count,
            "mcp_tool_reindexed_count": mcp_tool_reindexed_count,
            "assistant_reindexed_count": assistant_reindexed_count,
            "knowledge_reindexed_count": knowledge_reindexed_count,
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
