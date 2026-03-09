pub(crate) fn extract_text_from_chat_completion_response(
    response_body: &serde_json::Value,
) -> Option<String> {
    if let Some(content) = response_body
        .get("content")
        .and_then(|value| value.as_str())
    {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(choice) = response_body
        .get("choices")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
    {
        if let Some(message_content) = choice
            .get("message")
            .and_then(|value| value.get("content"))
            .and_then(|value| value.as_str())
        {
            let trimmed = message_content.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        if let Some(text) = choice.get("text").and_then(|value| value.as_str()) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    response_body
        .get("completion")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn truncate_text_chars(input: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    let mut out = input.chars().take(max_chars).collect::<String>();
    out.push_str("...");
    out
}
