use mcp_registry::diagnostics::{
    build_control_plane_asset_map, build_parity_item, build_registry_buckets,
};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::modules::desktop_runtime::runtime::e3_readiness;
use crate::modules::desktop_runtime::runtime::execution_graph_store::{
    summarize_frame_route_overlap_readiness, FrameRouteOverlapReadiness,
};
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
    LocalConversationSummaryJobQuery, LocalConversationSummaryQueueStats,
    LocalEvolutionSignalListResponse, LocalEvolutionSignalQuery, LocalGatewayLogItem,
    LocalGatewayLogListResponse, LocalGatewayLogQuery, LocalGatewayLogStatsResponse,
    LocalMaintenanceActionRequest, LocalMaintenanceLogItem, LocalMaintenanceLogListResponse,
    LocalMaintenanceLogQuery, LocalTaskLearningManualRevisionRequest,
    LocalTaskLearningReplayRequest, LocalTaskLearningRunDetail, LocalTaskLearningRunListResponse,
    LocalTaskLearningRunQuery, LocalTaskPolicyPriorListResponse, LocalTaskPolicyPriorQuery,
    LocalTraceFeedback, LocalTraceFeedbackRequest,
};

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalFrameRouteOverlapReadinessResponse {
    pub metric: &'static str,
    pub contract_schema_version: i64,
    pub observation_window: &'static str,
    pub window_start_unix_ms: Option<i64>,
    pub window_end_unix_ms: Option<i64>,
    pub observed_payload_start_unix_ms: Option<i64>,
    pub observed_payload_end_unix_ms: Option<i64>,
    pub eligible_sample_start_unix_ms: Option<i64>,
    pub eligible_sample_end_unix_ms: Option<i64>,
    pub observation_window_ms: Option<i64>,
    pub minimum_observation_window_ms: i64,
    pub observation_window_met: bool,
    pub graph_count: usize,
    pub malformed_payload_count: usize,
    pub malformed_graph_payload_count: usize,
    pub malformed_e3_payload_count: usize,
    pub missing_e3_payload_count: usize,
    pub observed_payload_count: usize,
    pub eligible_sample_count: usize,
    pub matched_sample_count: usize,
    pub mismatched_sample_count: usize,
    pub excluded_sample_count: usize,
    pub overlap_ratio: Option<f64>,
    pub minimum_overlap_ratio: f64,
    pub overlap_threshold_met: bool,
    pub e3_payload_coverage_met: bool,
    pub e3_payload_health_met: bool,
    pub threshold_met: bool,
}

impl From<FrameRouteOverlapReadiness> for LocalFrameRouteOverlapReadinessResponse {
    fn from(readiness: FrameRouteOverlapReadiness) -> Self {
        Self {
            metric: readiness.metric,
            contract_schema_version: readiness.contract_schema_version,
            observation_window: readiness.observation_window,
            window_start_unix_ms: readiness.window_start_unix_ms,
            window_end_unix_ms: readiness.window_end_unix_ms,
            observed_payload_start_unix_ms: readiness.observed_payload_start_unix_ms,
            observed_payload_end_unix_ms: readiness.observed_payload_end_unix_ms,
            eligible_sample_start_unix_ms: readiness.eligible_sample_start_unix_ms,
            eligible_sample_end_unix_ms: readiness.eligible_sample_end_unix_ms,
            observation_window_ms: readiness.observation_window_ms,
            minimum_observation_window_ms: readiness.minimum_observation_window_ms,
            observation_window_met: readiness.observation_window_met,
            graph_count: readiness.graph_count,
            malformed_payload_count: readiness.malformed_payload_count,
            malformed_graph_payload_count: readiness.malformed_graph_payload_count,
            malformed_e3_payload_count: readiness.malformed_e3_payload_count,
            missing_e3_payload_count: readiness.missing_e3_payload_count,
            observed_payload_count: readiness.observed_payload_count,
            eligible_sample_count: readiness.eligible_sample_count,
            matched_sample_count: readiness.matched_sample_count,
            mismatched_sample_count: readiness.mismatched_sample_count,
            excluded_sample_count: readiness.excluded_sample_count,
            overlap_ratio: readiness.overlap_ratio,
            minimum_overlap_ratio: readiness.minimum_overlap_ratio,
            overlap_threshold_met: readiness.overlap_threshold_met,
            e3_payload_coverage_met: readiness.e3_payload_coverage_met,
            e3_payload_health_met: readiness.e3_payload_health_met,
            threshold_met: readiness.threshold_met,
        }
    }
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
    let feedback = state
        .mcp
        .store
        .create_local_trace_feedback(payload)
        .await
        .map_err(to_string)?;
    let posterior_signal = crate::modules::desktop_runtime::runtime::resolve_posterior_signal(
        &crate::modules::desktop_runtime::runtime::PosteriorSignalInput {
            trace_id: Some(feedback.trace_id.clone()),
            feedback_score: Some(feedback.score),
            feedback_comment: feedback.comment.clone(),
            ..Default::default()
        },
    );
    let posterior_signal_input_json = serde_json::to_string(
        &crate::modules::desktop_runtime::runtime::PosteriorSignalInput {
            trace_id: Some(feedback.trace_id.clone()),
            feedback_score: Some(feedback.score),
            feedback_comment: feedback.comment.clone(),
            ..Default::default()
        },
    )
    .ok();
    if let Err(err) = state
        .mcp
        .store
        .record_posterior_signal_event(
            None,
            None,
            Some(feedback.trace_id.as_str()),
            posterior_signal.source.as_str(),
            posterior_signal.signal.as_str(),
            posterior_signal.confidence,
            posterior_signal_input_json.as_deref(),
            feedback.comment.as_deref(),
        )
        .await
    {
        log::warn!(
            "posterior signal event persist failed trace_id={} err={}",
            feedback.trace_id,
            err
        );
    }
    // Look up the latest task-learning run once and reuse for both the
    // legacy revision path and the evolution-signal emission below.
    let latest_run = match state
        .mcp
        .store
        .get_latest_task_learning_run_by_trace_id(feedback.trace_id.as_str())
        .await
    {
        Ok(value) => value,
        Err(err) => {
            log::warn!(
                "trace feedback run lookup failed trace_id={} err={}",
                feedback.trace_id,
                err
            );
            None
        }
    };
    if crate::modules::desktop_runtime::runtime::should_apply_posterior_signal(&posterior_signal) {
        if let Some(run) = latest_run.as_ref() {
            if let Err(err) =
                crate::modules::desktop_runtime::runtime::apply_task_learning_revision(
                    state.mcp.store.as_ref(),
                    run.run_id.as_str(),
                    posterior_signal.signal.as_str(),
                    "trace_feedback",
                    feedback.comment.as_deref(),
                )
                .await
            {
                log::warn!(
                    "trace feedback task learning revision failed trace_id={} err={}",
                    feedback.trace_id,
                    err
                );
            }
        }
    }
    // Slice 1 evolution-signal emission. Additive — failures here never
    // affect the legacy posterior/revision flow above.
    {
        use crate::modules::desktop_runtime::runtime::evolution::{
            submit_evolution_signal, EvolutionSignalClassification, EvolutionSignalDraft,
            EvolutionSignalSource,
        };
        let classification =
            EvolutionSignalClassification::from_canonical_str(posterior_signal.signal.as_str())
                .unwrap_or(EvolutionSignalClassification::Unknown);
        let draft = EvolutionSignalDraft {
            source: EvolutionSignalSource::ExplicitTraceFeedback,
            classification,
            session_id: None,
            trace_id: Some(feedback.trace_id.clone()),
            run_id: latest_run.as_ref().map(|run| run.run_id.clone()),
            monitor_task_id: None,
            monitor_log_id: None,
            fingerprint_key: latest_run.as_ref().map(|run| run.fingerprint_key.clone()),
            confidence: posterior_signal.confidence,
            payload_json: serde_json::json!({
                "feedback_score": feedback.score,
                "feedback_comment": feedback.comment.clone(),
                "feedback_tags": feedback.tags.clone(),
                "trace_id": feedback.trace_id.clone(),
                "posterior_source": posterior_signal.source.as_str(),
                "posterior_signal": posterior_signal.signal.as_str(),
            }),
            note: feedback.comment.clone(),
        };
        if let Err(err) = submit_evolution_signal(state.mcp.store.as_ref(), draft).await {
            log::warn!(
                "evolution signal submission failed trace_id={} err={}",
                feedback.trace_id,
                err
            );
        }
    }
    Ok(feedback)
}

#[tauri::command]
pub async fn list_local_task_learning_runs(
    state: State<'_, AppState>,
    query: LocalTaskLearningRunQuery,
) -> Result<LocalTaskLearningRunListResponse, String> {
    crate::modules::desktop_runtime::runtime::list_task_learning_runs_for_query(
        state.mcp.store.as_ref(),
        &query,
    )
    .await
    .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_task_learning_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<LocalTaskLearningRunDetail, String> {
    crate::modules::desktop_runtime::runtime::load_task_learning_run_detail(
        state.mcp.store.as_ref(),
        &run_id,
    )
    .await
    .map_err(to_string)?
    .ok_or_else(|| format!("task learning run not found: {}", run_id))
}

#[tauri::command]
pub async fn list_local_task_policy_priors(
    state: State<'_, AppState>,
    query: LocalTaskPolicyPriorQuery,
) -> Result<LocalTaskPolicyPriorListResponse, String> {
    crate::modules::desktop_runtime::runtime::list_task_policy_priors_for_query(
        state.mcp.store.as_ref(),
        &query,
    )
    .await
    .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_evolution_signals(
    state: State<'_, AppState>,
    query: LocalEvolutionSignalQuery,
) -> Result<LocalEvolutionSignalListResponse, String> {
    crate::modules::desktop_runtime::runtime::evolution::list_evolution_signals_for_query(
        state.mcp.store.as_ref(),
        &query,
    )
    .await
    .map_err(to_string)
}

#[tauri::command]
pub async fn revise_local_task_learning_run(
    state: State<'_, AppState>,
    payload: LocalTaskLearningManualRevisionRequest,
) -> Result<LocalTaskLearningRunDetail, String> {
    let detail = crate::modules::desktop_runtime::runtime::apply_task_learning_revision(
        state.mcp.store.as_ref(),
        payload.run_id.as_str(),
        payload.user_response_signal.as_str(),
        payload
            .trigger_source
            .as_deref()
            .unwrap_or("admin_manual_revision"),
        payload.note.as_deref(),
    )
    .await
    .map_err(to_string)?
    .ok_or_else(|| format!("task learning run not found: {}", payload.run_id))?;
    // Slice 2 evolution-signal emission. Additive — failures here never
    // affect the revision behavior above. classification mirrors the
    // canonical user_response_signal; an unrecognized value collapses to
    // Unknown so the signal still lands as audit evidence.
    {
        use crate::modules::desktop_runtime::runtime::evolution::{
            submit_evolution_signal, EvolutionSignalClassification, EvolutionSignalDraft,
            EvolutionSignalSource,
        };
        let classification = EvolutionSignalClassification::from_canonical_str(
            payload.user_response_signal.as_str(),
        )
        .unwrap_or(EvolutionSignalClassification::Unknown);
        let draft = EvolutionSignalDraft {
            source: EvolutionSignalSource::ManualTaskLearningRevision,
            classification,
            session_id: Some(detail.session_id.clone()),
            trace_id: detail.trace_id.clone(),
            run_id: Some(detail.run_id.clone()),
            monitor_task_id: None,
            monitor_log_id: None,
            fingerprint_key: Some(detail.fingerprint_key.clone()),
            confidence: 0.95,
            payload_json: serde_json::json!({
                "user_response_signal": payload.user_response_signal,
                "trigger_source": payload.trigger_source,
                "run_id": detail.run_id,
                "fingerprint_key": detail.fingerprint_key,
            }),
            note: payload.note.clone(),
        };
        if let Err(err) = submit_evolution_signal(state.mcp.store.as_ref(), draft).await {
            log::warn!(
                "manual revision evolution signal submission failed run_id={} err={}",
                payload.run_id,
                err
            );
        }
    }
    Ok(detail)
}

#[tauri::command]
pub async fn replay_local_task_learning_run(
    state: State<'_, AppState>,
    payload: LocalTaskLearningReplayRequest,
) -> Result<LocalTaskLearningRunDetail, String> {
    crate::modules::desktop_runtime::runtime::replay_task_learning_run(
        state.mcp.store.as_ref(),
        payload.run_id.as_str(),
        payload.note.as_deref(),
    )
    .await
    .map_err(to_string)?
    .ok_or_else(|| format!("task learning run not found: {}", payload.run_id))
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
            payload.meta.as_ref(),
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
pub async fn get_local_frame_route_overlap_readiness(
    state: State<'_, AppState>,
    window_start_unix_ms: Option<i64>,
    window_end_unix_ms: Option<i64>,
) -> Result<LocalFrameRouteOverlapReadinessResponse, String> {
    e3_readiness::validate_frame_route_overlap_readiness_window(
        window_start_unix_ms,
        window_end_unix_ms,
    )
    .map_err(str::to_string)?;
    summarize_frame_route_overlap_readiness(
        state.mcp.store.as_ref(),
        window_start_unix_ms,
        window_end_unix_ms,
    )
    .await
    .map(LocalFrameRouteOverlapReadinessResponse::from)
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

#[cfg(test)]
mod tests {
    use crate::modules::desktop_runtime::runtime::e3_readiness::{
        validate_frame_route_overlap_readiness_window, WINDOW_END_NEGATIVE_ERROR,
        WINDOW_REVERSED_ERROR, WINDOW_START_NEGATIVE_ERROR,
    };

    #[test]
    fn frame_route_overlap_readiness_window_accepts_open_and_ordered_bounds() {
        assert!(validate_frame_route_overlap_readiness_window(None, None).is_ok());
        assert!(validate_frame_route_overlap_readiness_window(Some(0), None).is_ok());
        assert!(validate_frame_route_overlap_readiness_window(None, Some(100)).is_ok());
        assert!(validate_frame_route_overlap_readiness_window(Some(0), Some(100)).is_ok());
        assert!(validate_frame_route_overlap_readiness_window(Some(100), Some(100)).is_ok());
    }

    #[test]
    fn frame_route_overlap_readiness_window_rejects_negative_bounds() {
        assert_eq!(
            validate_frame_route_overlap_readiness_window(Some(-1), Some(100)),
            Err(WINDOW_START_NEGATIVE_ERROR)
        );
        assert_eq!(
            validate_frame_route_overlap_readiness_window(Some(0), Some(-1)),
            Err(WINDOW_END_NEGATIVE_ERROR)
        );
    }

    #[test]
    fn frame_route_overlap_readiness_window_rejects_reversed_bounds() {
        assert_eq!(
            validate_frame_route_overlap_readiness_window(Some(101), Some(100)),
            Err(WINDOW_REVERSED_ERROR)
        );
    }
}
