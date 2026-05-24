/// Collects the set of approval tokens that the execution graph currently reports
/// as "still waiting for user approval".
///
/// The graph is the authoritative source of approval state. A token is considered
/// still-pending only when an `approval_gate` node carries it in
/// `metadata.approval_token` AND the node status is `waiting_approval` or
/// `approval_failed`.
///
/// `"approving"` is intentionally EXCLUDED: that status marks an approve that has
/// started consuming the token but has not finished advancing the runtime. Such a
/// token is not safe to resurrect as a fresh approval dialog; it must be
/// resolved through the recovery-notice path, not replayed.
pub(crate) fn collect_waiting_approval_tokens_from_graph(
    execution_graph: &serde_json::Value,
) -> std::collections::HashSet<String> {
    execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|node| {
            node.get("node_type").and_then(serde_json::Value::as_str) == Some("approval_gate")
        })
        .filter(|node| {
            node.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| matches!(status, "waiting_approval" | "approval_failed"))
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

#[cfg(test)]
mod tests {
    use super::collect_waiting_approval_tokens_from_graph;

    fn approval_gate_node(
        node_id: &str,
        status: &str,
        approval_token: Option<&str>,
    ) -> serde_json::Value {
        let metadata = match approval_token {
            Some(token) => serde_json::json!({ "approval_token": token }),
            None => serde_json::json!({}),
        };
        serde_json::json!({
            "node_id": node_id,
            "node_type": "approval_gate",
            "status": status,
            "metadata": metadata,
        })
    }

    fn graph_with_nodes(nodes: Vec<serde_json::Value>) -> serde_json::Value {
        serde_json::json!({ "nodes": nodes })
    }

    #[test]
    fn collects_tokens_only_from_waiting_approval_gates() {
        let graph = graph_with_nodes(vec![
            approval_gate_node("gate-1", "waiting_approval", Some("token-1")),
            approval_gate_node("gate-2", "completed", Some("token-2")),
            approval_gate_node("gate-3", "approving", Some("token-3")),
            approval_gate_node("gate-4", "approval_failed", Some("token-4")),
        ]);

        let tokens = collect_waiting_approval_tokens_from_graph(&graph);

        assert!(
            tokens.contains("token-1"),
            "waiting_approval must be collected"
        );
        assert!(
            tokens.contains("token-4"),
            "approval_failed must be collected"
        );
        assert!(
            !tokens.contains("token-3"),
            "approving MUST be excluded to prevent replay of an in-flight approve"
        );
        assert!(!tokens.contains("token-2"));
        assert_eq!(tokens.len(), 2);
    }

    #[test]
    fn ignores_non_approval_gate_nodes() {
        let graph = serde_json::json!({
            "nodes": [
                {
                    "node_id": "tool-1",
                    "node_type": "tool_call",
                    "status": "waiting_approval",
                    "metadata": { "approval_token": "ghost-token" }
                }
            ]
        });

        let tokens = collect_waiting_approval_tokens_from_graph(&graph);
        assert!(tokens.is_empty());
    }

    #[test]
    fn skips_gates_missing_or_empty_tokens() {
        let graph = graph_with_nodes(vec![
            approval_gate_node("gate-1", "waiting_approval", None),
            approval_gate_node("gate-2", "waiting_approval", Some("   ")),
            approval_gate_node("gate-3", "waiting_approval", Some("valid")),
        ]);

        let tokens = collect_waiting_approval_tokens_from_graph(&graph);
        assert_eq!(tokens.len(), 1);
        assert!(tokens.contains("valid"));
    }

    #[test]
    fn handles_missing_or_malformed_graph() {
        assert!(collect_waiting_approval_tokens_from_graph(&serde_json::json!({})).is_empty());
        assert!(collect_waiting_approval_tokens_from_graph(&serde_json::json!(null)).is_empty());
        assert!(collect_waiting_approval_tokens_from_graph(
            &serde_json::json!({ "nodes": "not-an-array" })
        )
        .is_empty());
    }
}
