use super::recovery_prompt::append_recovery_assistant_message_if_missing;
use super::{collect_waiting_approval_tokens_from_graph, PersistedInFlightExecutionContext};
use crate::modules::desktop_runtime::runtime::load_execution_graph_snapshot;

pub(super) async fn recover_waiting_approval_runtime_context(
    store: &crate::modules::mcp::store::McpStore,
    execution_id: &str,
    persisted: &PersistedInFlightExecutionContext,
) -> Result<(), String> {
    // Graph is authoritative. Load it first and compute which tokens are
    // STILL waiting; only those are safe to resurrect into the in-memory
    // map. Anything else in `persisted.pending_approvals` is a zombie left
    // behind by a prior approve/reject that crashed before the runtime
    // context could be cleared. Fixes Vector D (cold-start replay).
    let graph_snapshot = load_execution_graph_snapshot(store, execution_id)
        .await
        .map_err(|err| err.to_string())?;
    let waiting_tokens = graph_snapshot
        .as_ref()
        .map(collect_waiting_approval_tokens_from_graph)
        .unwrap_or_default();

    let skipped_stale = persisted
        .pending_approvals
        .iter()
        .filter(|pending| !waiting_tokens.contains(pending.approval_token.trim()))
        .count();
    if skipped_stale > 0 {
        log::warn!(
            "recovery_skipped_stale_pending_approvals execution_id={} skipped={} total_persisted={}",
            execution_id,
            skipped_stale,
            persisted.pending_approvals.len(),
        );
    }
    if let Some(execution_graph) = graph_snapshot {
        append_recovery_assistant_message_if_missing(
            store,
            persisted.session_id.as_str(),
            &execution_graph,
            execution_id,
            "waiting_approval",
            "The previous run stopped at a tool approval gate. Approval state has been restored.",
            &["approve", "reject"],
        )
        .await?;
    }

    Ok(())
}
