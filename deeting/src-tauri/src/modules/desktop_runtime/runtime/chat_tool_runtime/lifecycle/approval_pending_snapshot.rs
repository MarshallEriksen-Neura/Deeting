use super::approval_runtime_lookup::{
    list_canonical_waiting_approval_contexts, CanonicalPendingLocalApprovalMatch,
};

fn pending_approval_snapshot_from_canonical_match(
    matched: &CanonicalPendingLocalApprovalMatch,
    now_unix_ms: i128,
) -> serde_json::Value {
    serde_json::json!({
        "status": "REQUIRES_APPROVAL",
        "approval_token": matched.pending.approval_token.clone(),
        "tool_id": matched.pending.tool_id.clone(),
        "tool_name": matched.pending.tool_name.clone(),
        "arguments": matched.pending.arguments.clone(),
        "description": matched.pending.description.clone(),
        "risk_level": matched.pending.risk_level.clone().unwrap_or_else(|| "HIGH".to_string()),
        "risk_reasons": matched.pending.risk_reasons.clone(),
        "call_id": matched.pending.call_id.clone(),
        "execution_token": matched.pending.execution_token.clone(),
        "session_id": matched.pending.session_id.clone(),
        "created_at_unix_ms": matched.pending.created_at_unix_ms,
        "expires_at_unix_ms": matched.pending.expires_at_unix_ms,
        "expires_in_ms": matched.pending.expires_at_unix_ms.saturating_sub(now_unix_ms),
        "execution_graph_execution_id": matched
            .pending
            .execution_graph_execution_id
            .clone()
            .or_else(|| Some(matched.execution_id.clone())),
        "execution_graph_gate_node_id": matched.pending.execution_graph_gate_node_id.clone(),
        "execution_graph_tool_node_id": matched.pending.execution_graph_tool_node_id.clone(),
        "approval_status": matched.pending.approval_status.clone().unwrap_or_else(|| "waiting_approval".to_string()),
    })
}

pub(crate) async fn list_canonical_pending_local_approval_snapshots(
    store: &crate::modules::mcp::store::McpStore,
    session_id: Option<&str>,
) -> Result<Vec<serde_json::Value>, String> {
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let contexts = list_canonical_waiting_approval_contexts(store, session_id, None).await?;
    let mut snapshots = Vec::new();

    for (execution_id, context) in contexts {
        for pending in &context.pending_approvals {
            if pending.expires_at_unix_ms <= now as i128 {
                continue;
            }
            snapshots.push(pending_approval_snapshot_from_canonical_match(
                &CanonicalPendingLocalApprovalMatch {
                    execution_id: execution_id.clone(),
                    pending: pending.clone(),
                },
                now as i128,
            ));
        }
    }

    snapshots.sort_by(|left, right| {
        let left_created = left
            .get("created_at_unix_ms")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or_default();
        let right_created = right
            .get("created_at_unix_ms")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or_default();
        right_created.cmp(&left_created)
    });

    Ok(snapshots)
}
