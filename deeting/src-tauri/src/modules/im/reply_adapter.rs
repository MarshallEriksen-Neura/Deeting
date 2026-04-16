use serde_json::Value;

use crate::modules::conversation::service as conversation;

use super::MessageContent;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ImReplyCapability {
    PlainText { text: String },
    InteractiveCard { card: Value },
    ImageRef { url: String },
    FileRef { name: String, url: String },
    MixedParts { parts: Vec<super::MessagePart> },
    UnsupportedRichContent { reason: String },
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ImReplyDelivery {
    Native(MessageContent),
    DowngradedText(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ImPlatformAdapter {
    Feishu,
    Telegram,
    Wechat,
    Relay,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ExtractedReplyCapabilities {
    pub primary: ImReplyCapability,
    pub fallbacks: Vec<ImReplyCapability>,
}

fn non_empty_trimmed_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn is_remote_media_url(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized.starts_with("https://") || normalized.starts_with("http://")
}

fn block_text_from_payload(payload: &Value) -> Option<String> {
    payload
        .get("text")
        .and_then(Value::as_str)
        .and_then(non_empty_trimmed_text)
        .or_else(|| {
            payload
                .get("content")
                .and_then(Value::as_str)
                .and_then(non_empty_trimmed_text)
        })
        .or_else(|| {
            payload
                .get("summary")
                .and_then(Value::as_str)
                .and_then(non_empty_trimmed_text)
        })
}

fn capability_from_ui_block(block: &Value) -> Option<ImReplyCapability> {
    let view_type = block.get("viewType").and_then(Value::as_str)?.trim();
    let payload = block.get("payload").cloned().unwrap_or(Value::Null);
    let metadata = block.get("metadata").cloned().unwrap_or(Value::Null);

    if view_type.eq_ignore_ascii_case("html.v1") || view_type.eq_ignore_ascii_case("table.simple") {
        let summary = block_text_from_payload(&payload)
            .or_else(|| block_text_from_payload(&metadata))
            .unwrap_or_else(|| {
                format!("Structured UI block `{view_type}` is only available in desktop.")
            });
        return Some(ImReplyCapability::UnsupportedRichContent { reason: summary });
    }

    if view_type.eq_ignore_ascii_case("image.result") || view_type.contains("image") {
        let image_url = payload
            .get("url")
            .and_then(Value::as_str)
            .or_else(|| payload.get("image_url").and_then(Value::as_str))
            .or_else(|| payload.get("asset_url").and_then(Value::as_str))
            .and_then(non_empty_trimmed_text);
        return Some(match image_url {
            Some(url) => ImReplyCapability::ImageRef { url },
            None => ImReplyCapability::UnsupportedRichContent {
                reason: format!("Image result `{view_type}` is only available in desktop."),
            },
        });
    }

    if view_type.eq_ignore_ascii_case("file.preview") || view_type.contains("file") {
        let file_name = payload
            .get("name")
            .and_then(Value::as_str)
            .and_then(non_empty_trimmed_text)
            .unwrap_or_else(|| "attachment".to_string());
        let file_url = payload
            .get("url")
            .and_then(Value::as_str)
            .or_else(|| payload.get("download_url").and_then(Value::as_str))
            .and_then(non_empty_trimmed_text);
        return Some(match file_url {
            Some(url) => ImReplyCapability::FileRef {
                name: file_name,
                url,
            },
            None => ImReplyCapability::UnsupportedRichContent {
                reason: format!("File result `{view_type}` is only available in desktop."),
            },
        });
    }

    None
}

fn first_rich_block_capability(response: &Value) -> Option<ImReplyCapability> {
    let blocks = conversation::extract_chat_response(response)?
        .get("meta_info")
        .and_then(|value| value.get("blocks"))
        .and_then(Value::as_array)?;

    for block in blocks.iter().rev() {
        match block
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "ui" => {
                if let Some(capability) = capability_from_ui_block(block) {
                    return Some(capability);
                }
            }
            "file_preview" => {
                let payload = block.get("data").cloned().unwrap_or(Value::Null);
                let name = payload
                    .get("name")
                    .and_then(Value::as_str)
                    .and_then(non_empty_trimmed_text)
                    .unwrap_or_else(|| "attachment".to_string());
                if let Some(url) = payload
                    .get("url")
                    .and_then(Value::as_str)
                    .or_else(|| payload.get("download_url").and_then(Value::as_str))
                    .and_then(non_empty_trimmed_text)
                {
                    return Some(ImReplyCapability::FileRef { name, url });
                }
            }
            _ => {}
        }
    }

    None
}

pub(crate) fn extract_reply_capabilities(response: &Value) -> Option<ExtractedReplyCapabilities> {
    if let Some(card_payload) = conversation::extract_approval_payload(response) {
        let card = serde_json::json!({
            "approval_token": card_payload.approval_token,
            "tool_name": card_payload.tool_name,
            "description": card_payload.description,
            "risk_level": card_payload.risk_level,
            "risk_reasons": card_payload.risk_reasons,
            "arguments": card_payload.arguments,
        });
        return Some(ExtractedReplyCapabilities {
            primary: ImReplyCapability::InteractiveCard { card },
            fallbacks: vec![],
        });
    }

    if let Some(rich_capability) = first_rich_block_capability(response) {
        let mut fallbacks = Vec::new();
        if let Some(text) = conversation::extract_reply_text(response) {
            fallbacks.push(ImReplyCapability::PlainText { text });
        }
        return Some(ExtractedReplyCapabilities {
            primary: rich_capability,
            fallbacks,
        });
    }

    conversation::extract_reply_text(response).map(|text| ExtractedReplyCapabilities {
        primary: ImReplyCapability::PlainText { text },
        fallbacks: Vec::new(),
    })
}

pub(crate) fn adapt_reply_for_platform(
    capability: &ImReplyCapability,
    platform: ImPlatformAdapter,
    channel_label: &str,
) -> ImReplyDelivery {
    match capability {
        ImReplyCapability::PlainText { text } => {
            ImReplyDelivery::Native(MessageContent::Text { text: text.clone() })
        }
        ImReplyCapability::InteractiveCard { card } => match platform {
            ImPlatformAdapter::Feishu => {
                ImReplyDelivery::Native(MessageContent::Card { card: card.clone() })
            }
            _ => ImReplyDelivery::DowngradedText(format!(
                "当前{}通道暂不支持交互卡片，请在桌面端查看完整结果。",
                channel_label
            )),
        },
        ImReplyCapability::ImageRef { url } => match platform {
            ImPlatformAdapter::Feishu if url.starts_with("feishu://image/") => {
                ImReplyDelivery::Native(MessageContent::Image { url: url.clone() })
            }
            ImPlatformAdapter::Telegram | ImPlatformAdapter::Wechat if is_remote_media_url(url) => {
                ImReplyDelivery::Native(MessageContent::Image { url: url.clone() })
            }
            _ => ImReplyDelivery::DowngradedText(format!(
                "当前{}通道暂不支持原生图片回复，请在桌面端查看完整结果：{}",
                channel_label, url
            )),
        },
        ImReplyCapability::FileRef { name, url } => match platform {
            ImPlatformAdapter::Feishu if url.starts_with("feishu://file/") => {
                ImReplyDelivery::Native(MessageContent::File {
                    name: name.clone(),
                    url: url.clone(),
                })
            }
            ImPlatformAdapter::Telegram | ImPlatformAdapter::Wechat if is_remote_media_url(url) => {
                ImReplyDelivery::Native(MessageContent::File {
                    name: name.clone(),
                    url: url.clone(),
                })
            }
            _ => ImReplyDelivery::DowngradedText(format!(
                "当前{}通道暂不支持原生文件回复，请在桌面端查看完整结果：{} ({})",
                channel_label, name, url
            )),
        },
        ImReplyCapability::MixedParts { parts } => match platform {
            ImPlatformAdapter::Feishu => ImReplyDelivery::Native(MessageContent::Mixed {
                parts: parts.clone(),
            }),
            _ => ImReplyDelivery::DowngradedText(format!(
                "当前{}通道暂不支持混合内容回复，请在桌面端查看完整结果。",
                channel_label
            )),
        },
        ImReplyCapability::UnsupportedRichContent { reason } => {
            ImReplyDelivery::DowngradedText(reason.clone())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_reply_capabilities_prefers_image_ui_block() {
        let response = serde_json::json!({
            "choices": [{
                "message": {
                    "content": "desktop image ready",
                    "meta_info": {
                        "blocks": [{
                            "type": "ui",
                            "viewType": "image.result",
                            "payload": {
                                "url": "https://example.com/generated.png"
                            }
                        }]
                    }
                }
            }]
        });

        let extracted = extract_reply_capabilities(&response).expect("reply capability");
        assert_eq!(
            extracted.primary,
            ImReplyCapability::ImageRef {
                url: "https://example.com/generated.png".to_string(),
            }
        );
        assert_eq!(
            extracted.fallbacks,
            vec![ImReplyCapability::PlainText {
                text: "desktop image ready".to_string(),
            }]
        );
    }

    #[test]
    fn adapt_image_to_telegram_keeps_native_image_delivery() {
        let result = adapt_reply_for_platform(
            &ImReplyCapability::ImageRef {
                url: "https://example.com/image.png".to_string(),
            },
            ImPlatformAdapter::Telegram,
            "Telegram",
        );

        match result {
            ImReplyDelivery::Native(MessageContent::Image { url }) => {
                assert_eq!(url, "https://example.com/image.png")
            }
            _ => panic!("telegram image replies should stay native"),
        }
    }

    #[test]
    fn adapt_card_to_feishu_keeps_native_card() {
        let result = adapt_reply_for_platform(
            &ImReplyCapability::InteractiveCard {
                card: serde_json::json!({"header": {"title": {"content": "审批确认"}}}),
            },
            ImPlatformAdapter::Feishu,
            "飞书",
        );

        match result {
            ImReplyDelivery::Native(MessageContent::Card { .. }) => {}
            _ => panic!("feishu card replies should stay native"),
        }
    }

    #[test]
    fn adapt_http_image_to_feishu_downgrades() {
        let result = adapt_reply_for_platform(
            &ImReplyCapability::ImageRef {
                url: "https://example.com/image.png".to_string(),
            },
            ImPlatformAdapter::Feishu,
            "飞书",
        );

        match result {
            ImReplyDelivery::DowngradedText(text) => {
                assert!(text.contains("飞书"));
                assert!(text.contains("image.png"));
            }
            _ => panic!("http image should downgrade for feishu"),
        }
    }

    #[test]
    fn adapt_file_to_telegram_keeps_native_file_delivery() {
        let result = adapt_reply_for_platform(
            &ImReplyCapability::FileRef {
                name: "report.pdf".to_string(),
                url: "https://example.com/report.pdf".to_string(),
            },
            ImPlatformAdapter::Telegram,
            "Telegram",
        );

        match result {
            ImReplyDelivery::Native(MessageContent::File { name, url }) => {
                assert_eq!(name, "report.pdf");
                assert_eq!(url, "https://example.com/report.pdf");
            }
            _ => panic!("telegram file replies should stay native"),
        }
    }

    #[test]
    fn adapt_image_to_wechat_keeps_native_image_delivery() {
        let result = adapt_reply_for_platform(
            &ImReplyCapability::ImageRef {
                url: "https://example.com/image.png".to_string(),
            },
            ImPlatformAdapter::Wechat,
            "微信",
        );

        match result {
            ImReplyDelivery::Native(MessageContent::Image { url }) => {
                assert_eq!(url, "https://example.com/image.png");
            }
            _ => panic!("wechat image replies should stay native"),
        }
    }

    #[test]
    fn adapt_local_file_to_wechat_downgrades() {
        let result = adapt_reply_for_platform(
            &ImReplyCapability::FileRef {
                name: "report.pdf".to_string(),
                url: "file:///tmp/report.pdf".to_string(),
            },
            ImPlatformAdapter::Wechat,
            "微信",
        );

        match result {
            ImReplyDelivery::DowngradedText(text) => {
                assert!(text.contains("report.pdf"));
                assert!(text.contains("微信"));
            }
            _ => panic!("local files should downgrade for wechat"),
        }
    }
}
