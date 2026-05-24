pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn extract_resume_response_text(
    content: &serde_json::Value,
) -> String {
    match content {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(items) => {
            let mut out = Vec::new();
            for item in items {
                let Some(object) = item.as_object() else {
                    continue;
                };
                let text = object
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| object.get("content").and_then(serde_json::Value::as_str))
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                if let Some(text) = text {
                    out.push(text.to_string());
                }
            }
            out.join("\n")
        }
        serde_json::Value::Object(object) => object
            .get("text")
            .and_then(serde_json::Value::as_str)
            .or_else(|| object.get("content").and_then(serde_json::Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| {
                serde_json::to_string(&serde_json::Value::Object(object.clone()))
                    .unwrap_or_default()
            }),
        serde_json::Value::Null => String::new(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}
