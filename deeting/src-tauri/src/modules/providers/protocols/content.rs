use serde_json::Value;

fn is_structured_chat_content(value: &Value) -> bool {
    match value {
        Value::Array(items) => {
            !items.is_empty()
                && items.iter().all(|item| {
                    item.as_object()
                        .and_then(|object| object.get("type").and_then(|entry| entry.as_str()))
                        .is_some()
                })
        }
        Value::Object(object) => object
            .get("type")
            .and_then(|entry| entry.as_str())
            .is_some(),
        _ => false,
    }
}

pub(crate) fn parse_structured_message_content(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !(trimmed.starts_with('[') || trimmed.starts_with('{')) {
        return None;
    }
    let parsed = serde_json::from_str::<Value>(trimmed).ok()?;
    if is_structured_chat_content(&parsed) {
        Some(parsed)
    } else {
        None
    }
}

pub(crate) fn normalize_message_content_value(role: &str, value: Option<&Value>) -> Value {
    match value {
        Some(Value::String(text)) if role.trim().eq_ignore_ascii_case("user") => {
            parse_structured_message_content(text).unwrap_or_else(|| Value::String(text.clone()))
        }
        Some(Value::String(text)) => Value::String(text.clone()),
        Some(other) => other.clone(),
        None => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_message_content_value, parse_structured_message_content};
    use serde_json::json;

    #[test]
    fn parse_structured_message_content_accepts_user_multimodal_blocks() {
        let raw =
            "[{\"type\":\"text\",\"text\":\"describe this\"},{\"type\":\"image_url\",\"image_url\":{\"url\":\"https://example.com/a.png\"}}]";

        let parsed =
            parse_structured_message_content(raw).expect("structured content should parse");

        assert!(parsed.is_array());
        assert_eq!(parsed[0]["type"], json!("text"));
        assert_eq!(parsed[1]["type"], json!("image_url"));
    }

    #[test]
    fn normalize_message_content_value_keeps_tool_json_strings_plain() {
        let raw =
            "[{\"type\":\"text\",\"text\":\"Detailed Results:\"},{\"type\":\"text\",\"text\":\"1. Example\"}]";

        let normalized = normalize_message_content_value("tool", Some(&json!(raw)));

        assert_eq!(normalized, json!(raw));
    }
}
