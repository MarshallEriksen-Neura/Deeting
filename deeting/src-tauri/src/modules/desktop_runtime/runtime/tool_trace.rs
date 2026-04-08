use super::tool_result_blocks::{
    extract_capability_transition_blocks, extract_ui_blocks_from_tool_result,
};

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

    for item in tool_call_meta {
        let tool_name = item
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown_tool");
        let call_id = item
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
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
                "result": item.get("result").cloned().unwrap_or_else(|| serde_json::json!({})),
            }));
            blocks.extend(extract_capability_transition_blocks(
                item, call_id, tool_name,
            ));
            blocks.extend(extract_ui_blocks_from_tool_result(item, call_id, tool_name));
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
    let call_id = item
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
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
            "result": item.get("result").cloned().unwrap_or_else(|| serde_json::json!({})),
        }));
        blocks.extend(extract_capability_transition_blocks(
            item, call_id, tool_name,
        ));
        blocks.extend(extract_ui_blocks_from_tool_result(item, call_id, tool_name));
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
}
