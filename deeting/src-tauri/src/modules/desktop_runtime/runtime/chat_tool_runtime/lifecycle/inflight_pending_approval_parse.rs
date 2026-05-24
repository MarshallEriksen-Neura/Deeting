use super::PersistedPendingApproval;

fn as_trimmed_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn pending_approval_record_from_tool_call_meta(
    item: &serde_json::Value,
    default_session_id: &str,
    now_unix_ms: i128,
) -> Option<PersistedPendingApproval> {
    let result = item.get("result")?.as_object()?;
    let approval_token = as_trimmed_string(result.get("approval_token"))?;
    let expires_at_unix_ms = result
        .get("expires_at_unix_ms")
        .and_then(serde_json::Value::as_i64)
        .map(|value| value as i128)
        .or_else(|| {
            result
                .get("expires_in_ms")
                .and_then(serde_json::Value::as_i64)
                .map(|value| now_unix_ms + value as i128)
        })
        .unwrap_or(now_unix_ms + 5 * 60 * 1000);

    Some(PersistedPendingApproval {
        approval_token,
        tool_id: as_trimmed_string(result.get("tool_id")),
        tool_name: as_trimmed_string(item.get("name"))
            .or_else(|| as_trimmed_string(result.get("tool_name")))
            .unwrap_or_else(|| "unknown_tool".to_string()),
        arguments: result
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        call_id: as_trimmed_string(item.get("id")),
        execution_token: as_trimmed_string(result.get("execution_token")),
        session_id: as_trimmed_string(result.get("session_id"))
            .or_else(|| Some(default_session_id.to_string())),
        description: as_trimmed_string(result.get("description")),
        risk_level: as_trimmed_string(result.get("risk_level")),
        risk_reasons: result
            .get("risk_reasons")
            .and_then(serde_json::Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::trim))
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        tool_fingerprint: as_trimmed_string(result.get("tool_fingerprint"))
            .unwrap_or_else(|| "unknown-fingerprint".to_string()),
        policy_rule_key: as_trimmed_string(result.get("policy_rule_key")),
        approval_grant_key: as_trimmed_string(result.get("approval_grant_key")),
        execution_graph_execution_id: as_trimmed_string(
            result.get("execution_graph_execution_id"),
        ),
        execution_graph_gate_node_id: as_trimmed_string(
            result.get("execution_graph_gate_node_id"),
        ),
        execution_graph_tool_node_id: as_trimmed_string(
            result.get("execution_graph_tool_node_id"),
        ),
        approval_status: as_trimmed_string(result.get("approval_status"))
            .or_else(|| Some("waiting_approval".to_string())),
        created_at_unix_ms: result
            .get("created_at_unix_ms")
            .and_then(serde_json::Value::as_i64)
            .map(|value| value as i128)
            .unwrap_or(now_unix_ms),
        expires_at_unix_ms,
    })
}
