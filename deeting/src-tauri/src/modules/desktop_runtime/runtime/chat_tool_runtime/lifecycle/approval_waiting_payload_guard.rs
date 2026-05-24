use super::approval_failed_payload::build_local_chat_resume_failed_payload;
use super::approval_graph::next_pending_approval_tokens_from_graph;

fn validate_waiting_approval_payload_consistency(
    consumed_approval_token: Option<&str>,
    resolved_gate_node_id: &str,
    execution_graph: &serde_json::Value,
) -> Result<(), String> {
    let pending_tokens = next_pending_approval_tokens_from_graph(execution_graph);
    let gate_still_waiting = execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .find(|node| {
            node.get("node_id").and_then(serde_json::Value::as_str) == Some(resolved_gate_node_id)
        })
        .and_then(|node| node.get("status").and_then(serde_json::Value::as_str))
        .is_some_and(|status| status.eq_ignore_ascii_case("waiting_approval"));

    if gate_still_waiting {
        return Err(format!(
            "resolved approval gate '{}' is still waiting_approval in the returned graph",
            resolved_gate_node_id
        ));
    }

    if let Some(consumed_token) = consumed_approval_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if pending_tokens.iter().any(|token| token == consumed_token) {
            return Err(format!(
                "consumed approval token '{}' still appears in next_pending_approval_tokens",
                consumed_token
            ));
        }
    }

    Ok(())
}

pub(super) fn build_failed_payload_if_waiting_invariant_breaks(
    consumed_approval_token: Option<&str>,
    resolved_gate_node_id: &str,
    resolved_call_id: Option<&str>,
    approved_tool_result: &serde_json::Value,
    execution_graph: &serde_json::Value,
    root_execution_id: Option<&str>,
) -> Option<serde_json::Value> {
    let Err(err) = validate_waiting_approval_payload_consistency(
        consumed_approval_token,
        resolved_gate_node_id,
        execution_graph,
    ) else {
        return None;
    };

    log::error!(
        "approval_waiting_payload_invariant_failed approval_token={} resolved_gate={} err={}",
        consumed_approval_token.unwrap_or_default(),
        resolved_gate_node_id,
        err
    );
    Some(build_local_chat_resume_failed_payload(
        consumed_approval_token.unwrap_or_default(),
        Some(resolved_gate_node_id),
        resolved_call_id,
        approved_tool_result,
        execution_graph,
        root_execution_id,
        "LOCAL_CHAT_WAITING_PAYLOAD_INVARIANT_FAILED",
        err.as_str(),
        false,
    ))
}
