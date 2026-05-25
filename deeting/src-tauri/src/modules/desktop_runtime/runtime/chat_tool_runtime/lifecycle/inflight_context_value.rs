use super::{
    now_unix_ms_i64, InFlightExecutionStage, PersistedChatToolRuntimeContext,
    PersistedDelegationWait, PersistedInFlightExecutionContext, PersistedPendingApproval,
};

#[allow(clippy::too_many_arguments)]
pub(super) fn serialize_inflight_runtime_context_with_delegation(
    stage: InFlightExecutionStage,
    current_node: Option<String>,
    current_call_id: Option<String>,
    delegation: Option<PersistedDelegationWait>,
    task_input_source: Option<serde_json::Value>,
    recoverable: bool,
    pending_approvals: Vec<PersistedPendingApproval>,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    session_id: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
    last_error: Option<&str>,
) -> serde_json::Value {
    let schema_version = if delegation.is_some() { 2 } else { 1 };
    serde_json::to_value(PersistedInFlightExecutionContext {
        schema_version,
        session_id: session_id.to_string(),
        trace_id: trace_id.to_string(),
        request_id: request_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        execution_graph_execution_id: execution_graph_execution_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        stage,
        current_node,
        current_call_id,
        delegation,
        task_input_source,
        started_at_unix_ms: now_unix_ms_i64(),
        last_heartbeat_at_unix_ms: now_unix_ms_i64(),
        recoverable,
        pending_approvals,
        chat_runtime,
        last_error: last_error
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        recovery_notice_emitted_at_unix_ms: None,
    })
    .unwrap_or_else(|_| serde_json::json!({}))
}
