use super::approval_canonical_context::{
    canonical_waiting_approval_context, load_canonical_waiting_approval_context_by_execution_id,
};
use super::{PersistedInFlightExecutionContext, PersistedPendingApproval};
use crate::modules::desktop_runtime::runtime::list_execution_graph_runtime_contexts;

#[derive(Debug, Clone)]
pub(super) struct CanonicalPendingLocalApprovalMatch {
    pub(super) execution_id: String,
    pub(super) pending: PersistedPendingApproval,
}

pub(crate) async fn list_canonical_waiting_approval_contexts(
    store: &crate::modules::mcp::store::McpStore,
    session_id: Option<&str>,
    approval_token: Option<&str>,
) -> Result<Vec<(String, PersistedInFlightExecutionContext)>, String> {
    let rows = list_execution_graph_runtime_contexts(store)
        .await
        .map_err(|err| err.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            canonical_waiting_approval_context(
                row.context,
                row.execution_id.as_str(),
                session_id,
                approval_token,
            )
            .map(|persisted| (row.execution_id, persisted))
        })
        .collect())
}

pub(super) async fn find_canonical_pending_local_approval_match(
    store: &crate::modules::mcp::store::McpStore,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
) -> Result<Option<CanonicalPendingLocalApprovalMatch>, String> {
    let normalized_token = approval_token.trim();
    if normalized_token.is_empty() {
        return Ok(None);
    }

    let Some(execution_id) = execution_graph_execution_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(
            "execution_graph_execution_id is required for canonical approval lookup".to_string(),
        );
    };

    let contexts = load_canonical_waiting_approval_context_by_execution_id(
        store,
        execution_id,
        None,
        Some(normalized_token),
    )
    .await?
    .into_iter()
    .collect::<Vec<_>>();

    for (execution_id, context) in contexts {
        for pending in &context.pending_approvals {
            if pending.approval_token.trim() != normalized_token {
                continue;
            }
            return Ok(Some(CanonicalPendingLocalApprovalMatch {
                execution_id,
                pending: pending.clone(),
            }));
        }
    }

    Ok(None)
}
