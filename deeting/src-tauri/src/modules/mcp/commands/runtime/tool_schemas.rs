use super::super::support::*;

pub(crate) fn normalize_tool_schema_for_llm(raw: &serde_json::Value) -> Option<serde_json::Value> {
    let object = raw.as_object()?;
    if object.get("type").and_then(|value| value.as_str()) == Some("function")
        && object.get("function").and_then(|value| value.as_object()).is_some()
    {
        return Some(raw.clone());
    }

    let name = object
        .get("name")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())?;
    let description = object
        .get("description")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .unwrap_or_default();
    let parameters = object
        .get("parameters")
        .cloned()
        .or_else(|| object.get("input_schema").cloned())
        .unwrap_or_else(|| serde_json::json!({}));

    Some(serde_json::json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        }
    }))
}

pub(crate) fn merge_wrapped_tool_payload(
    base: &serde_json::Value,
    extra_tools: &[serde_json::Value],
) -> serde_json::Value {
    let mut merged = base
        .get("tools")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut existing_names: HashSet<String> = merged
        .iter()
        .filter_map(|tool| {
            tool.get("function")
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .collect();

    for raw in extra_tools {
        let Some(tool) = normalize_tool_schema_for_llm(raw) else {
            continue;
        };
        let Some(name) = tool
            .get("function")
            .and_then(|value| value.get("name"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if existing_names.insert(name) {
            merged.push(tool);
        }
    }

    serde_json::json!({ "tools": merged })
}