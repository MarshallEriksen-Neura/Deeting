use mcp_core::types::LocalChatInputMessage;
use serde_json::Value;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct LatestUserImageInput {
    pub(super) prompt: String,
    pub(super) image_urls: Vec<String>,
    pub(super) raw_text: String,
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn latest_user_message(messages: &[LocalChatInputMessage]) -> Option<String> {
    messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.content.clone())
}

pub(super) fn latest_user_image_input(messages: &[LocalChatInputMessage]) -> LatestUserImageInput {
    let Some(message) = messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
    else {
        return LatestUserImageInput::default();
    };

    let raw_text = message.content.trim().to_string();
    if raw_text.is_empty() {
        return LatestUserImageInput::default();
    }

    let trimmed = raw_text.trim();
    if !(trimmed.starts_with('[') || trimmed.starts_with('{')) {
        return LatestUserImageInput {
            prompt: raw_text.clone(),
            image_urls: Vec::new(),
            raw_text,
        };
    }

    let parsed = match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => value,
        Err(_) => {
            return LatestUserImageInput {
                prompt: raw_text.clone(),
                image_urls: Vec::new(),
                raw_text,
            }
        }
    };
    let items = parsed.as_array().cloned().unwrap_or_else(|| vec![parsed]);
    let mut text_parts = Vec::new();
    let mut image_urls = Vec::new();

    for item in items {
        let Some(object) = item.as_object() else {
            continue;
        };
        let block_type = object
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        match block_type {
            "text" => {
                if let Some(text) = object
                    .get("text")
                    .and_then(|value| value.as_str())
                    .or_else(|| object.get("content").and_then(|value| value.as_str()))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    text_parts.push(text.to_string());
                }
            }
            "image_url" => {
                if let Some(url) = object
                    .get("image_url")
                    .and_then(|value| {
                        value.as_str().map(str::to_string).or_else(|| {
                            value
                                .get("url")
                                .and_then(|entry| entry.as_str())
                                .map(str::to_string)
                        })
                    })
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                {
                    image_urls.push(url);
                }
            }
            _ => {}
        }
    }

    LatestUserImageInput {
        prompt: text_parts.join("\n"),
        image_urls,
        raw_text,
    }
}

#[cfg(test)]
mod tests {
    use super::{latest_user_image_input, LatestUserImageInput};
    use mcp_core::types::LocalChatInputMessage;

    #[test]
    fn latest_user_image_input_reads_structured_text_and_images() {
        let input = latest_user_image_input(&[LocalChatInputMessage {
            role: "user".to_string(),
            content: r#"[{"type":"text","text":"draw a cat"},{"type":"image_url","image_url":{"url":"asset://chat-assets/demo.png"}},{"type":"image_url","image_url":{"url":"local-asset://abc123"}}]"#.to_string(),
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        }]);

        assert_eq!(input.prompt, "draw a cat");
        assert_eq!(
            input.image_urls,
            vec![
                "asset://chat-assets/demo.png".to_string(),
                "local-asset://abc123".to_string()
            ]
        );
    }

    #[test]
    fn latest_user_image_input_keeps_plain_text_messages() {
        let input = latest_user_image_input(&[LocalChatInputMessage {
            role: "user".to_string(),
            content: "@image-agent draw a cat".to_string(),
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        }]);

        assert_eq!(
            input,
            LatestUserImageInput {
                prompt: "@image-agent draw a cat".to_string(),
                image_urls: vec![],
                raw_text: "@image-agent draw a cat".to_string(),
            }
        );
    }
}
