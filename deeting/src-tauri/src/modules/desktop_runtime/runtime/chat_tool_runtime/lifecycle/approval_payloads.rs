use super::approval_graph::{
    next_pending_approval_tokens_from_graph, pending_approval_gate_ids_from_graph,
};
use super::build_local_chat_resume_continuation_blocks;

pub(super) fn build_local_chat_waiting_approval_payload(
    approval_token: &str,
    resolved_gate_node_id: &str,
    resolved_call_id: &str,
    execution_graph: &serde_json::Value,
    approved_tool_result: &serde_json::Value,
    continuation_blocks: Vec<serde_json::Value>,
    execution_graph_execution_id: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "status": "LOCAL_CHAT_WAITING_APPROVAL",
        "approval_token": approval_token,
        "resolved_gate_node_id": resolved_gate_node_id,
        "resolved_call_id": resolved_call_id,
        "approved_tool_result": approved_tool_result,
        "continuation_blocks": continuation_blocks,
        "execution_graph": execution_graph,
        "execution_graph_execution_id": execution_graph_execution_id,
        "pending_approval_gate_ids": pending_approval_gate_ids_from_graph(execution_graph),
        "next_pending_approval_tokens": next_pending_approval_tokens_from_graph(execution_graph),
    })
}

pub(super) fn build_local_chat_resumed_payload(
    approval_token: &str,
    resolved_gate_node_id: &str,
    resolved_call_id: &str,
    approved_tool_result: &serde_json::Value,
    resumed_response: &serde_json::Value,
    continuation_meta: &[serde_json::Value],
) -> serde_json::Value {
    let execution_graph = resumed_response.get("execution_graph").cloned();
    serde_json::json!({
        "status": "LOCAL_CHAT_RESUMED",
        "approval_token": approval_token,
        "resolved_gate_node_id": resolved_gate_node_id,
        "resolved_call_id": resolved_call_id,
        "approved_tool_result": approved_tool_result,
        "continuation_blocks": build_local_chat_resume_continuation_blocks(
            resumed_response,
            continuation_meta,
        ),
        "execution_graph": execution_graph,
        "execution_graph_execution_id": resumed_response
            .get("execution_graph")
            .and_then(|value| value.get("execution_id"))
            .cloned(),
        "pending_approval_gate_ids": execution_graph
            .as_ref()
            .map(pending_approval_gate_ids_from_graph)
            .unwrap_or_default(),
        "next_pending_approval_tokens": execution_graph
            .as_ref()
            .map(next_pending_approval_tokens_from_graph)
            .unwrap_or_default(),
        "response": resumed_response,
    })
}
