use super::{
    collect_waiting_approval_tokens_from_graph, PersistedPendingApproval,
    SuspendedChatToolExecution,
};

/// Filters `pending_approvals` to retain only entries whose `approval_token` the
/// execution graph currently reports as waiting.
pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn filter_pending_approvals_by_graph(
    execution_graph: &serde_json::Value,
    pending_approvals: &[PersistedPendingApproval],
) -> Vec<PersistedPendingApproval> {
    let waiting_tokens = collect_waiting_approval_tokens_from_graph(execution_graph);
    pending_approvals
        .iter()
        .filter(|pending| waiting_tokens.contains(pending.approval_token.trim()))
        .cloned()
        .collect()
}

/// Projects the authoritative `pending_approvals` list for `suspended` by keeping
/// only the entries whose `approval_token` the execution graph currently reports
/// as waiting.
pub(crate) fn derive_pending_approvals_from_graph(
    suspended: &SuspendedChatToolExecution,
) -> Vec<PersistedPendingApproval> {
    filter_pending_approvals_by_graph(suspended.execution_graph(), suspended.pending_approvals())
}
