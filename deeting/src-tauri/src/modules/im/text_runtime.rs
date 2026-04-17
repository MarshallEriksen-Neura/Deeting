use std::collections::HashMap;
use std::future::Future;

use crate::modules::conversation::service as conversation;
use crate::modules::im::handlers::{
    build_direct_card_action_outcome, generate_local_chat_reply_outcome,
};
use crate::modules::im::{
    adapt_reply_for_platform, ImConnectionProfile, ImPlatform, ImPlatformAdapter,
    ImReplyCapability, ImReplyDelivery, MessageContent, MessagePart,
};
use crate::state::AppState;

#[derive(Debug, Clone)]
struct PendingTextApproval {
    approval_token: String,
    call_id: Option<String>,
    tool_name: String,
}

#[derive(Debug, Default)]
pub(crate) struct TextImConversationRuntime {
    pending_text_approvals: HashMap<String, PendingTextApproval>,
}

impl TextImConversationRuntime {
    pub async fn handle_incoming_text<F, Fut>(
        &mut self,
        app_state: &AppState,
        app_handle: &tauri::AppHandle,
        profile: &ImConnectionProfile,
        peer_id: &str,
        text: &str,
        channel_label: &str,
        mut send_message: F,
    ) -> Result<(), String>
    where
        F: FnMut(MessageContent) -> Fut,
        Fut: Future<Output = Result<(), String>>,
    {
        if let Some(pending) = self.pending_text_approvals.get(peer_id).cloned() {
            if let Some(approved) = parse_text_approval_command(text) {
                self.pending_text_approvals.remove(peer_id);
                let outcome = build_direct_card_action_outcome(
                    app_handle,
                    app_state,
                    if approved {
                        "approve_tool"
                    } else {
                        "reject_tool"
                    },
                    &serde_json::json!({
                        "approval_token": pending.approval_token,
                        "call_id": pending.call_id,
                        "tool_name": pending.tool_name,
                    }),
                )
                .await?;

                let mut sent_any = false;
                for follow_up in outcome.follow_up_messages {
                    send_message(follow_up).await?;
                    sent_any = true;
                }
                if !sent_any {
                    send_message(MessageContent::Text {
                        text: if approved {
                            "已批准，当前流程继续执行。"
                        } else {
                            "已拒绝，本次工具调用不会继续执行。"
                        }
                        .to_string(),
                    })
                    .await?;
                }
                return Ok(());
            }

            send_message(MessageContent::Text {
                text: "当前有待审批操作，请先回复 `1` 确认执行，或回复 `0` 拒绝执行。".to_string(),
            })
            .await?;
            return Ok(());
        }

        let session_id = format!("im:{}:chat:{}", profile.id, peer_id);
        send_message(MessageContent::Text {
            text: "收到，正在处理中…".to_string(),
        })
        .await?;

        let Some(reply_outcome) =
            generate_local_chat_reply_outcome(app_state, app_handle, text, session_id.as_str())
                .await?
        else {
            return Ok(());
        };

        if let Some(approval_request) = reply_outcome.approval_request {
            let approval_prompt = conversation::build_text_approval_prompt(&approval_request);
            self.pending_text_approvals.insert(
                peer_id.to_string(),
                PendingTextApproval {
                    approval_token: approval_request.approval_token,
                    call_id: approval_request.call_id,
                    tool_name: approval_request.tool_name,
                },
            );
            send_message(MessageContent::Text {
                text: approval_prompt,
            })
            .await?;
            return Ok(());
        }

        let fallback_text = reply_outcome.fallback_text.clone();

        match reply_outcome.content {
            MessageContent::Text { text } => {
                match adapt_reply_for_platform(
                    &ImReplyCapability::PlainText { text },
                    platform_adapter_for_profile(profile),
                    channel_label,
                ) {
                    ImReplyDelivery::Native(content) => {
                        send_message(content).await?;
                    }
                    ImReplyDelivery::DowngradedText(text) => {
                        send_message(MessageContent::Text {
                            text: fallback_text.clone().unwrap_or(text),
                        })
                        .await?;
                    }
                }
            }
            MessageContent::Card { card } => {
                match adapt_reply_for_platform(
                    &ImReplyCapability::InteractiveCard { card },
                    platform_adapter_for_profile(profile),
                    channel_label,
                ) {
                    ImReplyDelivery::Native(content) => {
                        send_message(content).await?;
                    }
                    ImReplyDelivery::DowngradedText(text) => {
                        send_message(MessageContent::Text {
                            text: fallback_text.clone().unwrap_or(text),
                        })
                        .await?;
                    }
                }
            }
            MessageContent::Image { url } => {
                match adapt_reply_for_profile(
                    &ImReplyCapability::ImageRef { url },
                    profile,
                    channel_label,
                ) {
                    ImReplyDelivery::Native(content) => {
                        send_message(content).await?;
                    }
                    ImReplyDelivery::DowngradedText(text) => {
                        send_message(MessageContent::Text {
                            text: fallback_text.clone().unwrap_or(text),
                        })
                        .await?;
                    }
                }
            }
            MessageContent::File { name, url } => {
                match adapt_reply_for_profile(
                    &ImReplyCapability::FileRef { name, url },
                    profile,
                    channel_label,
                ) {
                    ImReplyDelivery::Native(content) => {
                        send_message(content).await?;
                    }
                    ImReplyDelivery::DowngradedText(text) => {
                        send_message(MessageContent::Text {
                            text: fallback_text.clone().unwrap_or(text),
                        })
                        .await?;
                    }
                }
            }
            MessageContent::Mixed { parts } => {
                match adapt_reply_for_profile(
                    &ImReplyCapability::MixedParts { parts },
                    profile,
                    channel_label,
                ) {
                    ImReplyDelivery::Native(content) => {
                        send_message(content).await?;
                    }
                    ImReplyDelivery::DowngradedText(text) => {
                        send_message(MessageContent::Text {
                            text: fallback_text.clone().unwrap_or(text),
                        })
                        .await?;
                    }
                }
            }
        }

        Ok(())
    }
}

fn platform_adapter_for_profile(profile: &ImConnectionProfile) -> ImPlatformAdapter {
    match profile.platform {
        crate::modules::im::ImPlatform::Feishu => ImPlatformAdapter::Feishu,
        crate::modules::im::ImPlatform::Telegram => ImPlatformAdapter::Telegram,
        crate::modules::im::ImPlatform::Wechat => ImPlatformAdapter::Wechat,
        _ => ImPlatformAdapter::Relay,
    }
}

fn adapt_reply_for_profile(
    capability: &ImReplyCapability,
    profile: &ImConnectionProfile,
    channel_label: &str,
) -> ImReplyDelivery {
    if profile.platform == ImPlatform::Telegram {
        return adapt_telegram_reply_for_profile(capability, profile, channel_label);
    }
    if profile.platform == ImPlatform::Wechat {
        return adapt_wechat_reply_for_profile(capability, channel_label);
    }

    adapt_reply_for_platform(
        capability,
        platform_adapter_for_profile(profile),
        channel_label,
    )
}

fn adapt_telegram_reply_for_profile(
    capability: &ImReplyCapability,
    profile: &ImConnectionProfile,
    channel_label: &str,
) -> ImReplyDelivery {
    match capability {
        ImReplyCapability::ImageRef { .. } | ImReplyCapability::FileRef { .. }
            if !profile.direct_config.telegram_media_enabled =>
        {
            ImReplyDelivery::DowngradedText(format!(
                "当前{}通道的媒体回复能力未开启，请在桌面端查看完整结果。",
                channel_label
            ))
        }
        ImReplyCapability::MixedParts { parts } => {
            let has_image = parts
                .iter()
                .any(|part| matches!(part, MessagePart::Image { .. }));
            let all_remote_images = parts.iter().all(|part| match part {
                MessagePart::Text { .. } => true,
                MessagePart::Image { url } => {
                    let normalized = url.trim().to_ascii_lowercase();
                    normalized.starts_with("https://") || normalized.starts_with("http://")
                }
            });

            if has_image && !profile.direct_config.telegram_media_enabled {
                return ImReplyDelivery::DowngradedText(format!(
                    "当前{}通道的媒体回复能力未开启，请在桌面端查看完整结果。",
                    channel_label
                ));
            }

            if all_remote_images {
                return ImReplyDelivery::Native(MessageContent::Mixed {
                    parts: parts.clone(),
                });
            }

            ImReplyDelivery::DowngradedText(format!(
                "当前{}通道暂不支持发送本地或平台私有图片引用，请在桌面端查看完整结果。",
                channel_label
            ))
        }
        _ => adapt_reply_for_platform(
            capability,
            platform_adapter_for_profile(profile),
            channel_label,
        ),
    }
}

fn adapt_wechat_reply_for_profile(
    capability: &ImReplyCapability,
    channel_label: &str,
) -> ImReplyDelivery {
    match capability {
        ImReplyCapability::MixedParts { parts } => {
            let all_remote_images = parts.iter().all(|part| match part {
                MessagePart::Text { .. } => true,
                MessagePart::Image { url } => {
                    let normalized = url.trim().to_ascii_lowercase();
                    normalized.starts_with("https://") || normalized.starts_with("http://")
                }
            });

            if all_remote_images {
                return ImReplyDelivery::Native(MessageContent::Mixed {
                    parts: parts.clone(),
                });
            }

            ImReplyDelivery::DowngradedText(format!(
                "当前{}通道暂不支持发送本地或平台私有图片引用，请在桌面端查看完整结果。",
                channel_label
            ))
        }
        _ => adapt_reply_for_platform(capability, ImPlatformAdapter::Wechat, channel_label),
    }
}

pub(crate) fn parse_text_approval_command(text: &str) -> Option<bool> {
    match text.trim() {
        "1" => Some(true),
        "0" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{adapt_reply_for_profile, parse_text_approval_command};
    use crate::modules::im::{
        ImConnectionProfile, ImPlatform, ImReplyCapability, ImReplyDelivery, MessageContent,
        MessagePart,
    };

    #[test]
    fn parse_text_approval_command_accepts_numeric_choices() {
        assert_eq!(parse_text_approval_command("1"), Some(true));
        assert_eq!(parse_text_approval_command("0"), Some(false));
        assert_eq!(parse_text_approval_command(" yes "), None);
    }

    fn telegram_profile(media_enabled: bool) -> ImConnectionProfile {
        let mut profile = ImConnectionProfile::default_telegram();
        profile.platform = ImPlatform::Telegram;
        profile.direct_config.telegram_media_enabled = media_enabled;
        profile
    }

    #[test]
    fn telegram_mixed_parts_stay_native_when_media_gate_is_enabled() {
        let delivery = adapt_reply_for_profile(
            &ImReplyCapability::MixedParts {
                parts: vec![
                    MessagePart::Text {
                        text: "summary".to_string(),
                    },
                    MessagePart::Image {
                        url: "https://example.com/image.png".to_string(),
                    },
                ],
            },
            &telegram_profile(true),
            "Telegram",
        );

        match delivery {
            ImReplyDelivery::Native(MessageContent::Mixed { parts }) => {
                assert_eq!(parts.len(), 2);
            }
            other => panic!("expected native mixed delivery, got {other:?}"),
        }
    }

    #[test]
    fn telegram_mixed_parts_downgrade_when_media_gate_is_disabled() {
        let delivery = adapt_reply_for_profile(
            &ImReplyCapability::MixedParts {
                parts: vec![MessagePart::Image {
                    url: "https://example.com/image.png".to_string(),
                }],
            },
            &telegram_profile(false),
            "Telegram",
        );

        match delivery {
            ImReplyDelivery::DowngradedText(text) => {
                assert!(text.contains("媒体回复能力未开启"));
            }
            other => panic!("expected downgraded delivery, got {other:?}"),
        }
    }

    #[test]
    fn telegram_mixed_parts_downgrade_when_image_is_not_remote() {
        let delivery = adapt_reply_for_profile(
            &ImReplyCapability::MixedParts {
                parts: vec![MessagePart::Image {
                    url: "file:///tmp/image.png".to_string(),
                }],
            },
            &telegram_profile(true),
            "Telegram",
        );

        match delivery {
            ImReplyDelivery::DowngradedText(text) => {
                assert!(text.contains("本地或平台私有图片引用"));
            }
            other => panic!("expected downgraded delivery, got {other:?}"),
        }
    }

    #[test]
    fn wechat_mixed_parts_stay_native_when_images_are_remote() {
        let mut profile = ImConnectionProfile::default_telegram();
        profile.platform = ImPlatform::Wechat;

        let delivery = adapt_reply_for_profile(
            &ImReplyCapability::MixedParts {
                parts: vec![
                    MessagePart::Text {
                        text: "summary".to_string(),
                    },
                    MessagePart::Image {
                        url: "https://example.com/image.png".to_string(),
                    },
                ],
            },
            &profile,
            "微信",
        );

        match delivery {
            ImReplyDelivery::Native(MessageContent::Mixed { parts }) => {
                assert_eq!(parts.len(), 2);
            }
            other => panic!("expected native mixed delivery, got {other:?}"),
        }
    }

    #[test]
    fn wechat_mixed_parts_downgrade_when_image_is_not_remote() {
        let mut profile = ImConnectionProfile::default_telegram();
        profile.platform = ImPlatform::Wechat;

        let delivery = adapt_reply_for_profile(
            &ImReplyCapability::MixedParts {
                parts: vec![MessagePart::Image {
                    url: "file:///tmp/image.png".to_string(),
                }],
            },
            &profile,
            "微信",
        );

        match delivery {
            ImReplyDelivery::DowngradedText(text) => {
                assert!(text.contains("本地或平台私有图片引用"));
            }
            other => panic!("expected downgraded delivery, got {other:?}"),
        }
    }
}
