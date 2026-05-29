use super::suspended_default_context::fallback_chat_runtime_context_for_execution_graph;
use super::{
    filter_pending_approvals_by_graph, persistable_inflight_context_from_value,
    runtime_state_from_persisted_context, SuspendedChatToolExecution,
};
use crate::modules::desktop_runtime::runtime::{
    load_execution_graph_runtime_context, load_execution_graph_snapshot,
};
use crate::state::AppState;

pub(super) async fn suspended_from_persisted_execution(
    app_state: &AppState,
    execution_id: &str,
) -> Result<Option<SuspendedChatToolExecution>, String> {
    let Some(execution_graph) =
        load_execution_graph_snapshot(app_state.mcp.store.as_ref(), execution_id)
            .await
            .map_err(|err| err.to_string())?
    else {
        return Ok(None);
    };

    let Some(runtime_context) =
        load_execution_graph_runtime_context(app_state.mcp.store.as_ref(), execution_id)
            .await
            .map_err(|err| err.to_string())?
    else {
        return Ok(None);
    };

    let persisted_inflight = persistable_inflight_context_from_value(&runtime_context);
    let raw_pending_approvals = persisted_inflight
        .as_ref()
        .map(|context| context.pending_approvals.clone())
        .unwrap_or_default();
    let persisted_pending_approvals =
        filter_pending_approvals_by_graph(&execution_graph, &raw_pending_approvals);
    if raw_pending_approvals.len() != persisted_pending_approvals.len() {
        log::warn!(
            "pending_approvals_drift_on_load execution_id={} dropped={} kept={}",
            execution_id,
            raw_pending_approvals.len() - persisted_pending_approvals.len(),
            persisted_pending_approvals.len(),
        );
    }
    let persisted_context = persisted_inflight
        .and_then(|context| context.chat_runtime)
        .unwrap_or_else(|| {
            serde_json::from_value(runtime_context).unwrap_or_else(|_| {
                fallback_chat_runtime_context_for_execution_graph(execution_id, &execution_graph)
            })
        });
    let state = runtime_state_from_persisted_context(persisted_context);
    Ok(Some(SuspendedChatToolExecution {
        max_rounds: state.max_rounds,
        round: state.round,
        trace_id: state.trace_id.clone(),
        request_id: state.request_id.clone(),
        execution_policy: state.execution_policy.clone(),
        model_connection: state.model_connection.clone(),
        orchestrated_messages: state.orchestrated_messages.clone(),
        world_model_frame: state.world_model_frame.clone(),
        task_query: state.task_query.clone(),
        session_id: state.session_id.clone(),
        temperature: state.temperature,
        max_tokens: state.max_tokens,
        reasoning_enabled: state.reasoning_enabled,
        reasoning_effort: state.reasoning_effort.clone(),
        active_capability: state.active_capability.clone(),
        active_skill_context: state.active_skill_context.clone(),
        captured_world_model_update: state.captured_world_model_update.clone(),
        runtime_metrics: state.runtime_metrics.clone(),
        last_capability_snapshot: state.last_capability_snapshot.clone(),
        terminal_context: state.terminal_context.clone(),
        workflow_context: state.workflow_context.clone(),
        last_response: state.last_response.clone(),
        pending_approvals: persisted_pending_approvals,
        execution_graph,
        selected_knowledge_file_ids: state.selected_knowledge_file_ids.clone(),
    }))
}
