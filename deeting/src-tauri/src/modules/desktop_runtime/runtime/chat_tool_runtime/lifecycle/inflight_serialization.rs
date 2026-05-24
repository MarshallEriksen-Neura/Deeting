use super::inflight_context_value::serialize_inflight_runtime_context_with_delegation;
use super::{InFlightExecutionStage, PersistedChatToolRuntimeContext, PersistedPendingApproval};

pub(crate) fn serialize_inflight_runtime_context(
    stage: InFlightExecutionStage,
    current_node: Option<String>,
    current_call_id: Option<String>,
    recoverable: bool,
    pending_approvals: Vec<PersistedPendingApproval>,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    session_id: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
    last_error: Option<&str>,
) -> serde_json::Value {
    serialize_inflight_runtime_context_with_delegation(
        stage,
        current_node,
        current_call_id,
        None,
        recoverable,
        pending_approvals,
        chat_runtime,
        session_id,
        trace_id,
        request_id,
        execution_graph_execution_id,
        last_error,
    )
}
