//! IM (Instant Messaging) 模块
//!
//! 提供多平台即时消息集成支持，包括：
//! - 飞书 (WebSocket 长连接)
//! - Telegram (HTTP 长轮询)
//!
//! 特性：
//! - 统一的事件模型
//! - 可扩展的平台支持
//! - 无需公网 IP (飞书、Telegram)

pub(crate) mod handlers;
mod manager;
mod profile;
pub mod runtime;
mod types;

pub mod feishu;
pub mod telegram;

pub use manager::{ImManager, ImManagerBuilder};
pub use profile::*;
pub use types::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_im_platform_display() {
        assert_eq!(ImPlatform::Feishu.to_string(), "feishu");
        assert_eq!(ImPlatform::Telegram.to_string(), "telegram");
        assert_eq!(ImPlatform::Wechat.to_string(), "wechat");
    }

    #[test]
    fn test_im_event_serialization() {
        let event = ImEvent::Message {
            platform: ImPlatform::Feishu,
            chat_id: "oc_123".to_string(),
            chat_type: ChatType::Group,
            message_id: "om_456".to_string(),
            sender: Sender {
                sender_type: SenderType::User,
                open_id: Some("ou_789".to_string()),
                user_id: None,
                name: Some("张三".to_string()),
            },
            content: MessageContent::Text {
                text: "你好".to_string(),
            },
            mentions: vec![],
            raw: serde_json::Value::Null,
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"kind\":\"message\""));
        assert!(json.contains("\"platform\":\"feishu\""));
    }

    #[test]
    fn test_card_action_response() {
        let response = CardActionResponse {
            toast: Some(ToastResponse {
                toast_type: ToastType::Success,
                content: "操作成功".to_string(),
            }),
            update_card: None,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"type\":\"success\""));
    }

    #[test]
    fn test_im_manager_builder() {
        let manager = ImManagerBuilder::new()
            .with_feishu("app_id_123".to_string(), "app_secret_456".to_string())
            .with_telegram("bot_token_789".to_string())
            .build();

        // 验证配置已正确添加
        assert_eq!(manager.config.clients.len(), 2);
    }
}
