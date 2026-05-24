pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn serialize_tool_replay_content(
    item: &serde_json::Value,
) -> String {
    serialize_tool_replay_content_with_options(item, false)
}

pub(super) fn serialize_tool_replay_content_with_options(
    item: &serde_json::Value,
    preserve_structured_envelope: bool,
) -> String {
    if let Some(result) = item.get("result") {
        let result = unwrap_nested_tool_result_payload(result);
        if let Some(text) = result.as_str() {
            return text.to_string();
        }
        if let Some(structured) = result
            .get("structuredContent")
            .filter(|value| !value.is_null())
        {
            if preserve_structured_envelope {
                return serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string());
            }
            return serde_json::to_string(structured).unwrap_or_else(|_| "{}".to_string());
        }
        if let Some(extracted) = extract_mcp_result_text_content(result) {
            return extracted;
        }
        return serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string());
    }

    serde_json::to_string(&serde_json::json!({
        "status": item.get("status").cloned().unwrap_or(serde_json::json!("unknown")),
        "error": item.get("error").cloned().unwrap_or(serde_json::json!(null)),
        "error_code": item.get("error_code").cloned().unwrap_or(serde_json::json!(null)),
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

fn unwrap_nested_tool_result_payload<'a>(value: &'a serde_json::Value) -> &'a serde_json::Value {
    let mut current = value;
    for _ in 0..6 {
        let Some(object) = current.as_object() else {
            break;
        };
        let looks_like_tool_result_envelope =
            object.get("type").and_then(serde_json::Value::as_str) == Some("tool_result")
                || object.contains_key("callId")
                || object.contains_key("toolName");
        if !looks_like_tool_result_envelope {
            break;
        }
        let Some(next) = object.get("result").filter(|value| !value.is_null()) else {
            break;
        };
        current = next;
    }
    current
}

fn extract_mcp_result_text_content(result: &serde_json::Value) -> Option<String> {
    let object = result.as_object()?;
    let content = object.get("content")?.as_array()?;
    let mut parts = Vec::new();

    for item in content {
        let Some(block) = item.as_object() else {
            continue;
        };
        let block_type = block
            .get("type")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or_default();

        match block_type {
            "text" => {
                let text = block
                    .get("text")
                    .or_else(|| block.get("content"))
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                if let Some(text) = text {
                    parts.push(text.to_string());
                }
            }
            "image" => parts.push("[Image Content]".to_string()),
            _ => {}
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}
