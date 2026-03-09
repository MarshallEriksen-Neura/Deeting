pub(crate) fn extract_assistant_transition_blocks(
    item: &serde_json::Value,
    call_id: &str,
    tool_name: &str,
) -> Vec<serde_json::Value> {
    let result = item.get("result").and_then(|value| value.as_object());
    let Some(result) = result else {
        return Vec::new();
    };

    let transition = result
        .get("assistant_transition")
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
    let assistant_id = transition
        .get("assistant_id")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let assistant_name = transition
        .get("assistant_name")
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
        "id": format!("{id_seed}-assistant-transition"),
        "type": "assistant_transition",
        "action": action,
        "assistantId": assistant_id,
        "assistantName": assistant_name,
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
