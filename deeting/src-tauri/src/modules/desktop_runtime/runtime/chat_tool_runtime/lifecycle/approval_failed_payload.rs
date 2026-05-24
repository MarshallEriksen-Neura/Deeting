use super::approval_graph::{
    next_pending_approval_tokens_from_graph, pending_approval_gate_ids_from_graph,
};

pub(super) fn build_local_chat_resume_failed_payload(
    approval_token: &str,
    resolved_gate_node_id: Option<&str>,
    resolved_call_id: Option<&str>,
    approved_tool_result: &serde_json::Value,
    execution_graph: &serde_json::Value,
    execution_graph_execution_id: Option<&str>,
    error_code: &str,
    error: &str,
    retryable: bool,
) -> serde_json::Value {
    serde_json::json!({
        "status": "LOCAL_CHAT_RESUME_FAILED",
        "approval_token": approval_token,
        "resolved_gate_node_id": resolved_gate_node_id,
        "resolved_call_id": resolved_call_id,
        "approved_tool_result": approved_tool_result,
        "continuation_blocks": [],
        "execution_graph": execution_graph,
        "execution_graph_execution_id": execution_graph_execution_id,
        "pending_approval_gate_ids": pending_approval_gate_ids_from_graph(execution_graph),
        "next_pending_approval_tokens": next_pending_approval_tokens_from_graph(execution_graph),
        "error_code": error_code,
        "error": error,
        "retryable": retryable,
    })
}
