use super::tool_result_blocks::{
    extract_capability_transition_blocks, extract_ui_blocks_from_tool_result,
};

fn trimmed_json_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn call_id_from_execution_graph_node_id(value: Option<&serde_json::Value>) -> Option<String> {
    let node_id = trimmed_json_string(value)?;
    let call_id = node_id
        .strip_prefix("tool_call:")
        .or_else(|| node_id.strip_prefix("approval_gate:"))
        .unwrap_or(node_id.as_str())
        .trim()
        .to_string();
    if call_id.is_empty() {
        None
    } else {
        Some(call_id)
    }
}

fn sanitize_tool_call_segment(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else if ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let sanitized = sanitized.trim_matches('_');
    if sanitized.is_empty() {
        "tool".to_string()
    } else {
        sanitized.to_string()
    }
}

fn synthesize_missing_tool_call_id(tool_name: &str, index: usize) -> String {
    format!(
        "local-missing-call:{index}:{}",
        sanitize_tool_call_segment(tool_name)
    )
}

pub(crate) fn resolve_tool_trace_call_id(item: &serde_json::Value, index: usize) -> String {
    if let Some(call_id) = trimmed_json_string(item.get("id")) {
        return call_id;
    }

    let result = item.get("result");
    if let Some(call_id) = call_id_from_execution_graph_node_id(
        result.and_then(|value| value.get("execution_graph_tool_node_id")),
    ) {
        return call_id;
    }
    if let Some(call_id) = call_id_from_execution_graph_node_id(
        result.and_then(|value| value.get("execution_graph_gate_node_id")),
    ) {
        return call_id;
    }
    if let Some(approval_token) =
        trimmed_json_string(result.and_then(|value| value.get("approval_token")))
    {
        return format!("approval-token:{approval_token}");
    }

    let tool_name = item
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown_tool");
    synthesize_missing_tool_call_id(tool_name, index)
}

fn resolve_tool_trace_result(item: &serde_json::Value) -> serde_json::Value {
    if let Some(reasoning) = trimmed_json_string(item.get("reasoning")) {
        return serde_json::Value::String(reasoning);
    }
    item.get("result")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}))
}

pub(crate) fn build_local_tool_trace_blocks(
    tool_call_meta: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    if tool_call_meta.is_empty() {
        return Vec::new();
    }

    let has_code_execution = tool_call_meta.iter().any(|item| {
        item.get("name")
            .and_then(|v| v.as_str())
            .map(|n| n.eq_ignore_ascii_case("execute_code_plan"))
            .unwrap_or(false)
    });

    let mut blocks = Vec::with_capacity(1 + tool_call_meta.len() * 2);
    if has_code_execution {
        blocks.push(serde_json::json!({
            "type": "execution_section",
            "title": "Codemode Tool"
        }));
    }

    for (index, item) in tool_call_meta.iter().enumerate() {
        let tool_name = item
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown_tool");
        let call_id = resolve_tool_trace_call_id(item, index);
        let status = item
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        let requires_approval = status.eq_ignore_ascii_case("requires_approval");
        let call_status = if status.eq_ignore_ascii_case("success") {
            "success"
        } else if status.eq_ignore_ascii_case("running") {
            "running"
        } else if requires_approval {
            "success"
        } else {
            "error"
        };

        blocks.push(serde_json::json!({
            "type": "tool_call",
            "callId": call_id,
            "toolName": tool_name,
            "status": call_status,
        }));

        if status.eq_ignore_ascii_case("success") || requires_approval {
            blocks.push(serde_json::json!({
                "type": "tool_result",
                "callId": call_id,
                "toolName": tool_name,
                "status": if requires_approval { "requires_approval" } else { "success" },
                "result": resolve_tool_trace_result(item),
            }));
            blocks.extend(extract_capability_transition_blocks(
                item, &call_id, tool_name,
            ));
            blocks.extend(extract_ui_blocks_from_tool_result(
                item, &call_id, tool_name,
            ));
        } else if status.eq_ignore_ascii_case("error") {
            blocks.push(serde_json::json!({
                "type": "tool_result",
                "callId": call_id,
                "toolName": tool_name,
                "status": "error",
                "result": {
                    "error": item.get("error").cloned().unwrap_or_else(|| serde_json::json!("tool call failed")),
                    "error_code": item.get("error_code").cloned().unwrap_or_else(|| serde_json::json!(null)),
                },
            }));
        }
    }

    blocks
}

pub(crate) fn append_streamable_local_tool_result_blocks(
    blocks: &mut Vec<serde_json::Value>,
    item: &serde_json::Value,
) {
    let tool_name = item
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown_tool");
    let call_id = resolve_tool_trace_call_id(item, 0);
    let status = item
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    let requires_approval = status.eq_ignore_ascii_case("requires_approval");

    if status.eq_ignore_ascii_case("success") || requires_approval {
        blocks.push(serde_json::json!({
            "id": format!("{call_id}-tool-result"),
            "type": "tool_result",
            "callId": call_id,
            "toolName": tool_name,
            "status": if requires_approval { "requires_approval" } else { "success" },
            "result": resolve_tool_trace_result(item),
        }));
        blocks.extend(extract_capability_transition_blocks(
            item, &call_id, tool_name,
        ));
        blocks.extend(extract_ui_blocks_from_tool_result(
            item, &call_id, tool_name,
        ));
    } else if status.eq_ignore_ascii_case("error") {
        blocks.push(serde_json::json!({
            "id": format!("{call_id}-tool-result"),
            "type": "tool_result",
            "callId": call_id,
            "toolName": tool_name,
            "status": "error",
            "result": {
                "error": item.get("error").cloned().unwrap_or_else(|| serde_json::json!("tool call failed")),
                "error_code": item.get("error_code").cloned().unwrap_or_else(|| serde_json::json!(null)),
            },
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_local_tool_trace_blocks_preserves_requires_approval_result() {
        let blocks = build_local_tool_trace_blocks(&[serde_json::json!({
            "id": "call-1",
            "name": "skill.official.skills.crawler.fetch_web_content",
            "status": "requires_approval",
            "result": {
                "status": "REQUIRES_APPROVAL",
                "approval_token": "approval-1",
            }
        })]);

        assert!(blocks.iter().any(|block| {
            block.get("type").and_then(|value| value.as_str()) == Some("tool_result")
                && block.get("callId").and_then(|value| value.as_str()) == Some("call-1")
                && block.get("status").and_then(|value| value.as_str()) == Some("requires_approval")
                && block
                    .get("result")
                    .and_then(|value| value.get("approval_token"))
                    .and_then(|value| value.as_str())
                    == Some("approval-1")
        }));
    }

    #[test]
    fn append_streamable_local_tool_result_blocks_preserves_requires_approval_result() {
        let mut blocks = Vec::new();
        append_streamable_local_tool_result_blocks(
            &mut blocks,
            &serde_json::json!({
                "id": "call-2",
                "name": "skill.official.skills.crawler.fetch_web_content",
                "status": "requires_approval",
                "result": {
                    "status": "REQUIRES_APPROVAL",
                    "approval_token": "approval-2",
                }
            }),
        );

        assert_eq!(blocks.len(), 1);
        assert_eq!(
            blocks[0].get("status").and_then(|value| value.as_str()),
            Some("requires_approval")
        );
        assert_eq!(
            blocks[0]
                .get("result")
                .and_then(|value| value.get("approval_token"))
                .and_then(|value| value.as_str()),
            Some("approval-2")
        );
    }

    #[test]
    fn build_local_tool_trace_blocks_synthesizes_distinct_call_ids_when_missing() {
        let blocks = build_local_tool_trace_blocks(&[
            serde_json::json!({
                "name": "search_notes",
                "status": "success",
                "result": { "ok": true }
            }),
            serde_json::json!({
                "name": "search_notes",
                "status": "success",
                "result": { "ok": true }
            }),
        ]);

        let call_ids = blocks
            .iter()
            .filter(|block| block.get("type").and_then(|value| value.as_str()) == Some("tool_call"))
            .filter_map(|block| {
                block
                    .get("callId")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })
            .collect::<Vec<_>>();

        assert_eq!(
            call_ids,
            vec![
                "local-missing-call:0:search_notes".to_string(),
                "local-missing-call:1:search_notes".to_string(),
            ]
        );
    }

    #[test]
    fn append_streamable_local_tool_result_blocks_uses_approval_token_as_fallback_call_id() {
        let mut blocks = Vec::new();
        append_streamable_local_tool_result_blocks(
            &mut blocks,
            &serde_json::json!({
                "name": "search_notes",
                "status": "requires_approval",
                "result": {
                    "status": "REQUIRES_APPROVAL",
                    "approval_token": "approval-missing-id-1"
                }
            }),
        );

        assert_eq!(
            blocks[0].get("callId").and_then(|value| value.as_str()),
            Some("approval-token:approval-missing-id-1")
        );
    }
}
