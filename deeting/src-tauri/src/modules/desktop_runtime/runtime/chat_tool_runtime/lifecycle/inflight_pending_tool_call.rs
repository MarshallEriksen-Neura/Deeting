use super::PersistedPendingApproval;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn pending_tool_call_from_persisted_approval(
    pending: &PersistedPendingApproval,
    default_execution_id: Option<&str>,
    expires_at_unix_ms: i128,
) -> crate::modules::mcp::PendingToolCall {
    crate::modules::mcp::PendingToolCall {
        tool_id: pending.tool_id.clone(),
        tool_name: pending.tool_name.clone(),
        arguments: pending.arguments.clone(),
        call_id: pending.call_id.clone(),
        execution_token: pending.execution_token.clone(),
        session_id: pending.session_id.clone(),
        description: pending.description.clone(),
        risk_level: pending.risk_level.clone(),
        risk_reasons: pending.risk_reasons.clone(),
        tool_fingerprint: pending.tool_fingerprint.clone(),
        policy_rule_key: pending.policy_rule_key.clone(),
        approval_grant_key: pending.approval_grant_key.clone(),
        execution_graph_execution_id: pending
            .execution_graph_execution_id
            .clone()
            .or_else(|| default_execution_id.map(str::to_string)),
        execution_graph_gate_node_id: pending.execution_graph_gate_node_id.clone(),
        execution_graph_tool_node_id: pending.execution_graph_tool_node_id.clone(),
        approval_status: pending.approval_status.clone(),
        created_at_unix_ms: pending.created_at_unix_ms,
        expires_at_unix_ms,
    }
}
