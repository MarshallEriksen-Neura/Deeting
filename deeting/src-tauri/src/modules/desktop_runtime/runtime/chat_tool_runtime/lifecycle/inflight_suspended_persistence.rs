use super::{
    persisted_chat_runtime_context_from_suspended, serialize_inflight_runtime_context,
    InFlightExecutionStage, PersistedPendingApproval, SuspendedChatToolExecution,
};
use crate::modules::desktop_runtime::runtime::{
    persist_execution_graph_runtime_context, persist_execution_graph_snapshot,
};

/// Logs a warning when the persisted `pending_approvals` list disagrees with the
/// authoritative graph projection. Observation-only: does not alter behavior.
///
/// - `persisted_extra`: tokens present in `pending_approvals` but NOT reported as
///   waiting in the graph (likely zombies -- already consumed or in-flight).
/// - `graph_missing`: tokens the graph reports as waiting but that are absent
///   from `pending_approvals` (list drifted behind the graph).
fn log_pending_approvals_drift(
    suspended: &SuspendedChatToolExecution,
    pending_approvals: &[PersistedPendingApproval],
    source_kind: &str,
    stage: &InFlightExecutionStage,
) {
    let graph_tokens =
        super::collect_waiting_approval_tokens_from_graph(suspended.execution_graph());
    let persisted_tokens: std::collections::HashSet<String> = pending_approvals
        .iter()
        .map(|pending| pending.approval_token.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();

    let persisted_extra: Vec<&String> = persisted_tokens.difference(&graph_tokens).collect();
    let graph_missing: Vec<&String> = graph_tokens.difference(&persisted_tokens).collect();

    if persisted_extra.is_empty() && graph_missing.is_empty() {
        return;
    }

    log::warn!(
        "pending_approvals_drift source_kind={} stage={:?} execution_id={:?} persisted_extra={:?} graph_missing={:?}",
        source_kind,
        stage,
        suspended.graph_execution_id(),
        persisted_extra,
        graph_missing,
    );
}

pub(crate) async fn persist_suspended_execution_graph_runtime(
    store: &crate::modules::mcp::store::McpStore,
    suspended: &SuspendedChatToolExecution,
    pending_approvals: &[PersistedPendingApproval],
    source_kind: &str,
    status: &str,
    stage: InFlightExecutionStage,
    last_error: Option<&str>,
) -> Result<(), String> {
    log_pending_approvals_drift(suspended, pending_approvals, source_kind, &stage);

    persist_execution_graph_snapshot(
        store,
        suspended.execution_graph(),
        suspended.session_id.as_str(),
        source_kind,
        suspended.request_id.as_deref(),
        Some(status),
    )
    .await
    .map_err(|err| err.to_string())?;

    if let Some(execution_id) = suspended.graph_execution_id() {
        let context = serialize_inflight_runtime_context(
            stage,
            Some(suspended.pending_gate_node_id().to_string()),
            Some(suspended.pending_call_id().to_string()),
            true,
            pending_approvals.to_vec(),
            Some(persisted_chat_runtime_context_from_suspended(suspended)),
            suspended.session_id.as_str(),
            suspended.trace_id.as_str(),
            suspended.request_id.as_deref(),
            Some(execution_id),
            last_error,
        );
        persist_execution_graph_runtime_context(store, execution_id, &context)
            .await
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}
