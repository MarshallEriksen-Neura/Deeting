use super::approval_payloads::build_local_chat_waiting_approval_payload;
use super::approval_waiting_payload_guard::build_failed_payload_if_waiting_invariant_breaks;
use super::{
    build_local_chat_resume_continuation_blocks, derive_pending_approvals_from_graph,
    persist_suspended_execution_graph_runtime, InFlightExecutionStage, SuspendedChatToolExecution,
};
use crate::state::AppState;

pub(super) async fn build_waiting_payload_for_remaining_approvals(
    app_state: &AppState,
    suspended: &SuspendedChatToolExecution,
    consumed_approval_token: Option<&str>,
    resolved_gate_node_id: &str,
    resolved_call_id: &str,
    approved_tool_result: &serde_json::Value,
    root_execution_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    // Graph-authoritative: use the graph projection instead of the in-memory list.
    // `sync_remaining_pending_approvals` already trimmed consumed entries above, but
    // this second filter guarantees nothing that has drifted past `waiting_approval`
    // can sneak back into the persisted snapshot.
    let persisted_pending_approvals = derive_pending_approvals_from_graph(suspended);
    if let Err(err) = persist_suspended_execution_graph_runtime(
        app_state.mcp.store.as_ref(),
        suspended,
        &persisted_pending_approvals,
        "desktop_local_chat_approval_applied",
        "waiting_approval",
        InFlightExecutionStage::WaitingApproval,
        None,
    )
    .await
    {
        log::warn!(
            "persist approved execution graph failed approval_token={} err={}",
            consumed_approval_token.unwrap_or("resume"),
            err
        );
    }

    if let Some(failed_payload) = build_failed_payload_if_waiting_invariant_breaks(
        consumed_approval_token,
        resolved_gate_node_id,
        Some(resolved_call_id),
        approved_tool_result,
        suspended.execution_graph(),
        root_execution_id,
    ) {
        return Ok(failed_payload);
    }

    Ok(build_local_chat_waiting_approval_payload(
        consumed_approval_token.unwrap_or_default(),
        resolved_gate_node_id,
        resolved_call_id,
        suspended.execution_graph(),
        approved_tool_result,
        build_local_chat_resume_continuation_blocks(
            &serde_json::json!({
                "execution_graph": suspended.execution_graph().clone(),
                "content": "",
            }),
            &suspended.pending_tool_call_meta(),
        ),
        root_execution_id,
    ))
}
