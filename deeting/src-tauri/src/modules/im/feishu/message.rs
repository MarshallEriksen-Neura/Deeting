use super::protocol::*;
use crate::modules::im::types::*;
use serde_json::Value;

/// 解析飞书消息内容
pub fn parse_message_content(message: &FeishuMessage) -> MessageContent {
    let content_str = message.content.trim();

    // 内容可能是 JSON 字符串或已解析的 JSON
    let content_json: Value = if content_str.starts_with('{') || content_str.starts_with('[') {
        serde_json::from_str(content_str).unwrap_or(Value::String(content_str.to_string()))
    } else {
        // 尝试解析为 JSON 字符串
        if let Ok(parsed) = serde_json::from_str::<Value>(content_str) {
            parsed
        } else {
            Value::String(content_str.to_string())
        }
    };

    match message.message_type.as_str() {
        "text" => {
            let text = content_json
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or(content_str);
            MessageContent::Text {
                text: text.to_string(),
            }
        }
        "image" => {
            let image_key = content_json
                .get("image_key")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            MessageContent::Image {
                url: format!("feishu://image/{}", image_key),
            }
        }
        "file" => {
            let file_key = content_json
                .get("file_key")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let file_name = content_json
                .get("file_name")
                .and_then(|v| v.as_str())
                .unwrap_or("file");
            MessageContent::File {
                name: file_name.to_string(),
                url: format!("feishu://file/{}", file_key),
            }
        }
        "post" => MessageContent::Mixed {
            parts: extract_post_parts(&content_json),
        }
        _ => MessageContent::Text {
            text: content_str.to_string(),
        },
    }
}

/// 从富文本消息中提取文本
fn extract_post_parts(content: &Value) -> Vec<MessagePart> {
    let mut parts = Vec::new();

    if let Some(zh_cn) = content.get("zh_cn") {
        if let Some(paragraphs) = zh_cn.get("content").and_then(|c| c.as_array()) {
            for para in paragraphs {
                if let Some(elements) = para.as_array() {
                    for elem in elements {
                        if let Some(text) = elem.get("text").and_then(|t| t.as_str()) {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                parts.push(MessagePart::Text {
                                    text: trimmed.to_string(),
                                });
                            }
                        }
                        if let Some(tag) = elem.get("tag").and_then(|value| value.as_str()) {
                            if tag == "img" {
                                if let Some(image_key) = elem
                                    .get("image_key")
                                    .and_then(|value| value.as_str())
                                    .map(str::trim)
                                    .filter(|value| !value.is_empty())
                                {
                                    parts.push(MessagePart::Image {
                                        url: format!("feishu://image/{}", image_key),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if parts.is_empty() {
        let text = content
            .to_string()
            .trim()
            .to_string();
        if !text.is_empty() {
            parts.push(MessagePart::Text { text });
        }
    }

    parts
}

/// 解析飞书提及列表
pub fn parse_mentions(mentions: &[FeishuMention]) -> Vec<Mention> {
    mentions
        .iter()
        .map(|m| Mention {
            key: if m.key.is_empty() {
                None
            } else {
                Some(m.key.clone())
            },
            name: m.name.clone(),
            open_id: if m.id.open_id.is_empty() {
                None
            } else {
                Some(m.id.open_id.clone())
            },
            user_id: if m.id.user_id.is_empty() {
                None
            } else {
                Some(m.id.user_id.clone())
            },
        })
        .collect()
}

/// 解析聊天类型
pub fn parse_chat_type(chat_type: &str) -> ChatType {
    match chat_type.to_lowercase().as_str() {
        "p2p" | "private" => ChatType::Private,
        "group" => ChatType::Group,
        "supergroup" => ChatType::SuperGroup,
        "channel" => ChatType::Channel,
        _ => ChatType::Private,
    }
}

/// 将飞书消息事件转换为 IM 事件
pub fn convert_message_event(
    event: &FeishuMessageEvent,
    _header: &WsHeader,
    raw: Value,
) -> ImEvent {
    let content = parse_message_content(&event.message);
    let mentions = parse_mentions(&event.message.mentions);
    let chat_type = parse_chat_type(&event.message.chat_type);

    ImEvent::Message {
        platform: ImPlatform::Feishu,
        chat_id: event.message.chat_id.clone(),
        chat_type,
        message_id: event.message.message_id.clone(),
        sender: Sender {
            sender_type: match event.sender.sender_type.to_lowercase().as_str() {
                "user" => SenderType::User,
                "app" | "bot" => SenderType::Bot,
                _ => SenderType::System,
            },
            open_id: if event.sender.sender_id.open_id.is_empty() {
                None
            } else {
                Some(event.sender.sender_id.open_id.clone())
            },
            user_id: if event.sender.sender_id.user_id.is_empty() {
                None
            } else {
                Some(event.sender.sender_id.user_id.clone())
            },
            name: None,
        },
        content,
        mentions,
        raw,
    }
}

/// 将飞书卡片事件转换为 IM 事件
pub fn convert_card_event(event: &FeishuCardEvent, _header: &WsHeader, raw: Value) -> ImEvent {
    let action_value = event.action.value.clone();
    let event_name = action_value
        .get("event")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    ImEvent::CardAction {
        platform: ImPlatform::Feishu,
        chat_id: event.context.open_chat_id.clone(),
        message_id: event.context.open_message_id.clone(),
        callback_token: event.token.clone(),
        action: CardAction {
            event: event_name,
            tag: if event.action.tag.is_empty() {
                None
            } else {
                Some(event.action.tag.clone())
            },
            name: if event.action.name.is_empty() {
                None
            } else {
                Some(event.action.name.clone())
            },
            value: event.action.value.clone(),
            form_value: if event.action.form_value.is_null() {
                None
            } else {
                Some(event.action.form_value.clone())
            },
        },
        raw,
    }
}

/// 构建发送消息的内容 JSON
pub fn build_message_content(content: &MessageContent) -> Result<String, ImError> {
    let json = match content {
        MessageContent::Text { text } => {
            serde_json::to_string(&serde_json::json!({ "text": text }))
                .map_err(|e| ImError::ParseError(e.to_string()))?
        }
        MessageContent::Image { url } => {
            let image_key = url.strip_prefix("feishu://image/").unwrap_or(url);
            serde_json::to_string(&serde_json::json!({ "image_key": image_key }))
                .map_err(|e| ImError::ParseError(e.to_string()))?
        }
        MessageContent::File { name, url } => {
            let file_key = url.strip_prefix("feishu://file/").unwrap_or(url);
            serde_json::to_string(&serde_json::json!({
                "file_key": file_key,
                "file_name": name
            }))
            .map_err(|e| ImError::ParseError(e.to_string()))?
        }
        MessageContent::Card { card } => {
            serde_json::to_string(card).map_err(|e| ImError::ParseError(e.to_string()))?
        }
        MessageContent::Mixed { parts } => {
            let content = build_post_content(parts);
            serde_json::to_string(&content).map_err(|e| ImError::ParseError(e.to_string()))?
        }
    };
    Ok(json)
}

pub fn message_type_for_content(content: &MessageContent) -> &'static str {
    match content {
        MessageContent::Card { .. } => "interactive",
        MessageContent::Image { .. } => "image",
        MessageContent::File { .. } => "file",
        MessageContent::Mixed { .. } => "post",
        MessageContent::Text { .. } => "text",
    }
}

fn build_post_content(parts: &[MessagePart]) -> Value {
    let paragraph = parts
        .iter()
        .filter_map(|part| match part {
            MessagePart::Text { text } => Some(serde_json::json!({
                "tag": "text",
                "text": text,
            })),
            MessagePart::Image { url } => {
                let image_key = url.strip_prefix("feishu://image/")?;
                Some(serde_json::json!({
                    "tag": "img",
                    "image_key": image_key,
                }))
            }
        })
        .collect::<Vec<_>>();

    serde_json::json!({
        "zh_cn": {
            "title": "Deeting",
            "content": [paragraph]
        }
    })
}

/// 构建卡片动作响应
pub fn build_card_response(response: &CardActionResponse) -> Value {
    let mut result = serde_json::Map::new();

    if let Some(toast) = &response.toast {
        result.insert(
            "toast".to_string(),
            serde_json::json!({
                "type": match toast.toast_type {
                    ToastType::Info => "info",
                    ToastType::Success => "success",
                    ToastType::Error => "error",
                    ToastType::Warning => "warning",
                },
                "content": toast.content,
            }),
        );
    }

    if let Some(card) = &response.update_card {
        result.insert("card".to_string(), card.clone());
    }

    Value::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_type_for_card_content_is_interactive() {
        let msg_type = message_type_for_content(&MessageContent::Card {
            card: serde_json::json!({
                "header": {
                    "title": {
                        "tag": "plain_text",
                        "content": "审批确认"
                    },
                    "template": "orange"
                },
                "elements": []
            }),
        });

        assert_eq!(msg_type, "interactive");
    }

    #[test]
    fn build_message_content_serializes_card_payload() {
        let content = build_message_content(&MessageContent::Card {
            card: serde_json::json!({
                "header": {
                    "title": {
                        "tag": "plain_text",
                        "content": "审批确认"
                    }
                },
                "elements": [
                    {
                        "tag": "markdown",
                        "content": "需要确认"
                    }
                ]
            }),
        })
        .expect("card content should serialize");

        let payload: Value =
            serde_json::from_str(&content).expect("serialized card should be json");
        assert_eq!(
            payload
                .get("header")
                .and_then(|value| value.get("title"))
                .and_then(|value| value.get("content"))
                .and_then(Value::as_str),
            Some("审批确认")
        );
    }

    #[test]
    fn message_type_for_mixed_content_is_post() {
        let msg_type = message_type_for_content(&MessageContent::Mixed {
            parts: vec![
                MessagePart::Text {
                    text: "hello".to_string(),
                },
                MessagePart::Image {
                    url: "feishu://image/img-key".to_string(),
                },
            ],
        });

        assert_eq!(msg_type, "post");
    }

    #[test]
    fn build_message_content_serializes_mixed_content_as_post() {
        let content = build_message_content(&MessageContent::Mixed {
            parts: vec![
                MessagePart::Text {
                    text: "hello".to_string(),
                },
                MessagePart::Image {
                    url: "feishu://image/img-key".to_string(),
                },
            ],
        })
        .expect("mixed content should serialize");

        let payload: Value = serde_json::from_str(&content).expect("valid post payload");
        let first_paragraph = payload
            .get("zh_cn")
            .and_then(|value| value.get("content"))
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(Value::as_array)
            .expect("paragraph array");
        assert_eq!(first_paragraph.len(), 2);
        assert_eq!(
            first_paragraph[1]
                .get("image_key")
                .and_then(Value::as_str),
            Some("img-key")
        );
    }
}
