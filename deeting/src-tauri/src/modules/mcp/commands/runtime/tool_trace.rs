use super::tool_result_blocks::{
    extract_capability_transition_blocks, extract_ui_blocks_from_tool_result,
};

pub(crate) fn build_local_tool_trace_blocks(
    tool_call_meta: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    if tool_call_meta.is_empty() {
        return Vec::new();
    }

    let mut blocks = Vec::with_capacity(1 + tool_call_meta.len() * 2);
    blocks.push(serde_json::json!({
        "type": "execution_section",
        "title": "Local Tool Actions"
    }));

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
        let call_status = if status.eq_ignore_ascii_case("success") {
            "success"
        } else if status.eq_ignore_ascii_case("running") {
            "running"
        } else {
            "error"
        };

        blocks.push(serde_json::json!({
            "type": "tool_call",
            "callId": call_id,
            "toolName": tool_name,
            "status": call_status,
        }));

        if status.eq_ignore_ascii_case("success") {
            blocks.push(serde_json::json!({
                "type": "tool_result",
                "callId": call_id,
                "toolName": tool_name,
                "status": "success",
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

    if status.eq_ignore_ascii_case("success") {
        blocks.push(serde_json::json!({
            "id": format!("{call_id}-tool-result"),
            "type": "tool_result",
            "callId": call_id,
            "toolName": tool_name,
            "status": "success",
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
