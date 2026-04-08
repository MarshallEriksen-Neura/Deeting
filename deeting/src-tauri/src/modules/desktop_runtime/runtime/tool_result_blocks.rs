pub(crate) fn extract_capability_transition_blocks(
    item: &serde_json::Value,
    call_id: &str,
    tool_name: &str,
) -> Vec<serde_json::Value> {
    let result = item.get("result").and_then(|value| value.as_object());
    let Some(result) = result else {
        return Vec::new();
    };

    let transition = result
        .get("capability_transition")
        .and_then(|value| value.as_object());
    let Some(transition) = transition else {
        return Vec::new();
    };

    let action = transition
        .get("action")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("updated");
    let capability_id = transition
        .get("capability_id")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let capability_name = transition
        .get("capability_name")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let reason = transition
        .get("reason")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());

    let id_seed = if call_id.trim().is_empty() {
        tool_name
    } else {
        call_id
    };
    vec![serde_json::json!({
        "id": format!("{id_seed}-capability-transition"),
        "type": "capability_transition",
        "action": action,
        "capabilityId": capability_id,
        "capabilityName": capability_name,
        "reason": reason,
    })]
}

pub(crate) fn extract_ui_blocks_from_tool_result(
    item: &serde_json::Value,
    call_id: &str,
    tool_name: &str,
) -> Vec<serde_json::Value> {
    let result = item.get("result").and_then(|value| value.as_object());
    let Some(result) = result else {
        return Vec::new();
    };

    if let Some(result_blocks) = result
        .get("result_blocks")
        .and_then(|value| value.as_array())
    {
        let normalized = result_blocks
            .iter()
            .enumerate()
            .filter_map(|(idx, block)| normalize_result_block(block, call_id, tool_name, idx))
            .collect::<Vec<_>>();
        if !normalized.is_empty() {
            return normalized;
        }
    }

    let Some(raw_blocks) = result
        .get("render_blocks")
        .and_then(|value| value.as_array())
    else {
        return Vec::new();
    };

    raw_blocks
        .iter()
        .enumerate()
        .filter_map(|(idx, raw)| map_render_block_to_ui_block(raw, call_id, tool_name, idx))
        .collect()
}

fn normalize_result_block(
    raw: &serde_json::Value,
    call_id: &str,
    tool_name: &str,
    index: usize,
) -> Option<serde_json::Value> {
    let object = raw.as_object()?;
    let block_type = object.get("type").and_then(|value| value.as_str())?;
    if block_type == "ui" {
        let mut block = object.clone();
        block.entry("id".to_string()).or_insert_with(|| {
            serde_json::Value::String(format!(
                "{}-ui-{}",
                if call_id.trim().is_empty() {
                    tool_name
                } else {
                    call_id
                },
                index
            ))
        });
        if !call_id.trim().is_empty() {
            block
                .entry("callId".to_string())
                .or_insert_with(|| serde_json::Value::String(call_id.to_string()));
        }
        if !tool_name.trim().is_empty() {
            block
                .entry("toolName".to_string())
                .or_insert_with(|| serde_json::Value::String(tool_name.to_string()));
        }
        return Some(serde_json::Value::Object(block));
    }
    map_render_block_to_ui_block(raw, call_id, tool_name, index)
}

fn map_render_block_to_ui_block(
    raw: &serde_json::Value,
    call_id: &str,
    tool_name: &str,
    index: usize,
) -> Option<serde_json::Value> {
    let object = raw.as_object()?;
    let view_type = object
        .get("view_type")
        .or_else(|| object.get("viewType"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())?;
    let payload = object
        .get("payload")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let id_seed = if call_id.trim().is_empty() {
        tool_name
    } else {
        call_id
    };

    let mut block = serde_json::Map::new();
    block.insert(
        "id".to_string(),
        serde_json::Value::String(format!("{id_seed}-ui-{index}")),
    );
    block.insert(
        "type".to_string(),
        serde_json::Value::String("ui".to_string()),
    );
    if !call_id.trim().is_empty() {
        block.insert(
            "callId".to_string(),
            serde_json::Value::String(call_id.to_string()),
        );
    }
    if !tool_name.trim().is_empty() {
        block.insert(
            "toolName".to_string(),
            serde_json::Value::String(tool_name.to_string()),
        );
    }
    block.insert(
        "viewType".to_string(),
        serde_json::Value::String(view_type.to_string()),
    );
    block.insert("payload".to_string(), payload);
    block.insert(
        "displayMode".to_string(),
        serde_json::Value::String("widget".to_string()),
    );

    if let Some(title) = object
        .get("title")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        block.insert(
            "title".to_string(),
            serde_json::Value::String(title.to_string()),
        );
    }
    if let Some(metadata) = object.get("metadata").and_then(|value| value.as_object()) {
        block.insert(
            "metadata".to_string(),
            serde_json::Value::Object(metadata.clone()),
        );
    }

    Some(serde_json::Value::Object(block))
}
