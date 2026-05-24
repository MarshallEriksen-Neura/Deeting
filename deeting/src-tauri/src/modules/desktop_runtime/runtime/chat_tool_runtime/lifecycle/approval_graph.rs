use super::super::tool_meta::build_tool_call_meta_from_execution_graph;

pub(super) fn pending_approval_call_ids_from_graph(
    execution_graph: &serde_json::Value,
) -> Vec<String> {
    build_tool_call_meta_from_execution_graph(execution_graph)
        .into_iter()
        .filter(|item| {
            item.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| status.eq_ignore_ascii_case("requires_approval"))
        })
        .filter_map(|item| {
            item.get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}

pub(super) fn pending_approval_gate_ids_from_graph(
    execution_graph: &serde_json::Value,
) -> Vec<String> {
    execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|node| {
            node.get("node_type")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|node_type| node_type == "approval_gate")
        })
        .filter(|node| {
            node.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| {
                    matches!(status, "waiting_approval" | "approving" | "approval_failed")
                })
        })
        .filter_map(|node| {
            node.get("node_id")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}

pub(super) fn next_pending_approval_tokens_from_graph(
    execution_graph: &serde_json::Value,
) -> Vec<String> {
    execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|node| {
            node.get("node_type")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|node_type| node_type == "approval_gate")
        })
        .filter(|node| {
            node.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| {
                    matches!(status, "waiting_approval" | "approving" | "approval_failed")
                })
        })
        .filter_map(|node| {
            node.get("metadata")
                .and_then(|value| value.get("approval_token"))
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}
