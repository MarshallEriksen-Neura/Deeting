use super::{
    persistable_inflight_context_from_value, InFlightExecutionStage,
    PersistedInFlightExecutionContext,
};
use crate::modules::desktop_runtime::runtime::load_execution_graph_runtime_context;

pub(super) fn canonical_waiting_approval_context(
    context: serde_json::Value,
    execution_id: &str,
    session_id: Option<&str>,
    approval_token: Option<&str>,
) -> Option<PersistedInFlightExecutionContext> {
    let persisted = persistable_inflight_context_from_value(&context)?;
    if persisted.stage != InFlightExecutionStage::WaitingApproval {
        return None;
    }
    if let Some(expected_session_id) = session_id {
        if persisted.session_id.trim() != expected_session_id {
            return None;
        }
    }
    let normalized_execution_id = execution_id.trim();
    if normalized_execution_id.is_empty() {
        return None;
    }
    if let Some(expected_approval_token) = approval_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let has_matching_token = persisted
            .pending_approvals
            .iter()
            .any(|pending| pending.approval_token.trim() == expected_approval_token);
        if !has_matching_token {
            return None;
        }
    }
    Some(persisted)
}

pub(super) async fn load_canonical_waiting_approval_context_by_execution_id(
    store: &crate::modules::mcp::store::McpStore,
    execution_id: &str,
    session_id: Option<&str>,
    approval_token: Option<&str>,
) -> Result<Option<(String, PersistedInFlightExecutionContext)>, String> {
    let normalized_execution_id = execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Ok(None);
    }
    let Some(context) = load_execution_graph_runtime_context(store, normalized_execution_id)
        .await
        .map_err(|err| err.to_string())?
    else {
        return Ok(None);
    };
    Ok(canonical_waiting_approval_context(
        context,
        normalized_execution_id,
        session_id,
        approval_token,
    )
    .map(|persisted| (normalized_execution_id.to_string(), persisted)))
}
