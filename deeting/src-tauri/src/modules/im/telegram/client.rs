use super::protocol::*;
use crate::modules::im::types::*;
use async_trait::async_trait;
use log::{error, info, warn};
use reqwest::Client;
use reqwest::StatusCode;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};
use tokio::time::sleep;

/// Telegram 客户端配置
#[derive(Debug, Clone)]
pub struct TelegramConfig {
    pub bot_token: String,
    /// 轮询超时（秒）
    pub poll_timeout: i32,
    /// 重试延迟（秒）
    pub retry_delay: u64,
    /// 是否允许机器人的群组消息
    pub allow_group_message: bool,
}

impl Default for TelegramConfig {
    fn default() -> Self {
        Self {
            bot_token: String::new(),
            poll_timeout: 30,
            retry_delay: 5,
            allow_group_message: true,
        }
    }
}

/// Telegram 客户端
#[derive(Clone)]
pub struct TelegramClient {
    config: TelegramConfig,
    http: Client,
    status: Arc<RwLock<ConnectionStatus>>,
    offset: Arc<AtomicI64>,
    running: Arc<AtomicBool>,
    stop_signal: Arc<tokio::sync::Notify>,
}

impl TelegramClient {
    pub fn new(config: TelegramConfig) -> Self {
        Self {
            config,
            http: Client::builder()
                .timeout(Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
            status: Arc::new(RwLock::new(ConnectionStatus::Disconnected)),
            offset: Arc::new(AtomicI64::new(0)),
            running: Arc::new(AtomicBool::new(false)),
            stop_signal: Arc::new(tokio::sync::Notify::new()),
        }
    }

    /// 从配置 map 创建客户端
    pub fn from_config(
        platform_config: &HashMap<String, serde_json::Value>,
    ) -> Result<Self, ImError> {
        let bot_token = config_string(platform_config, "bot_token")
            .ok_or_else(|| ImError::ConfigError("缺少 bot_token".to_string()))?
            .to_string();

        let allow_group_message =
            config_bool(platform_config, "allow_group_message").unwrap_or(true);

        Ok(Self::new(TelegramConfig {
            bot_token,
            allow_group_message,
            ..Default::default()
        }))
    }

    /// 构建 API URL
    fn api_url(&self, method: &str) -> String {
        format!(
            "https://api.telegram.org/bot{}/{}",
            self.config.bot_token, method
        )
    }

    fn platform_error(code: i32, description: Option<String>) -> ImError {
        ImError::PlatformError {
            code,
            message: telegram_api_error_message(code, description.as_deref().unwrap_or("未知错误")),
        }
    }

    pub async fn probe_polling_available(&self) -> Result<(), ImError> {
        self.get_updates_with_timeout(0).await.map(|_| ())
    }

    /// 获取更新
    async fn get_updates(&self) -> Result<Vec<TelegramUpdate>, ImError> {
        self.get_updates_with_timeout(self.config.poll_timeout)
            .await
    }

    async fn get_updates_with_timeout(
        &self,
        timeout_seconds: i32,
    ) -> Result<Vec<TelegramUpdate>, ImError> {
        let url = self.api_url("getUpdates");

        let offset = self.offset.load(Ordering::SeqCst);

        let body = serde_json::json!({
            "offset": if offset > 0 { offset + 1 } else { 0 },
            "timeout": timeout_seconds,
            "allowed_updates": ["message", "callback_query"],
        });

        let resp = self
            .http
            .post(&url)
            .json(&body)
            .timeout(Duration::from_secs(timeout_seconds.max(0) as u64 + 10))
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    ImError::Timeout
                } else {
                    ImError::ConnectionError(e.to_string())
                }
            })?;

        let status = resp.status();
        let body = resp
            .bytes()
            .await
            .map_err(|e| ImError::ConnectionError(e.to_string()))?;

        if !status.is_success() {
            let payload = serde_json::from_slice::<TelegramResponse<serde_json::Value>>(&body).ok();
            let body_text = std::str::from_utf8(&body).ok();
            return Err(telegram_http_error(status, payload, body_text));
        }

        let result: TelegramResponse<Vec<TelegramUpdate>> =
            serde_json::from_slice(&body).map_err(|e| ImError::ParseError(e.to_string()))?;

        if !result.ok {
            return Err(Self::platform_error(
                result.error_code.unwrap_or(-1),
                result.description,
            ));
        }

        Ok(result.result.unwrap_or_default())
    }

    /// 处理消息更新
    fn handle_message(&self, message: &TelegramMessage) -> Option<ImEvent> {
        let parsed_content = if let Some(text) = message.text.as_ref() {
            MessageContent::Text { text: text.clone() }
        } else if let Some(document) = message.document.as_ref() {
            MessageContent::File {
                name: document
                    .file_name
                    .clone()
                    .unwrap_or_else(|| "telegram-document".to_string()),
                url: format!("telegram://document/{}", document.file_id),
            }
        } else if let Some(photo) = message.photo.as_ref().and_then(|items| items.last()) {
            let image_url = format!("telegram://photo/{}", photo.file_id);
            if let Some(caption) = message
                .caption
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                MessageContent::Mixed {
                    parts: vec![
                        MessagePart::Text {
                            text: caption.to_string(),
                        },
                        MessagePart::Image { url: image_url },
                    ],
                }
            } else {
                MessageContent::Image { url: image_url }
            }
        } else if let Some(caption) = message.caption.as_ref() {
            MessageContent::Text {
                text: caption.clone(),
            }
        } else {
            return None;
        };

        let text = match &parsed_content {
            MessageContent::Text { text } => text.as_str(),
            _ => message.caption.as_deref().unwrap_or_default(),
        };

        // 确定聊天类型
        let chat_type = match message.chat.chat_type.as_str() {
            "private" => ChatType::Private,
            "group" | "supergroup" => ChatType::Group,
            "channel" => ChatType::Channel,
            _ => return None,
        };

        // 群组消息检查
        if matches!(chat_type, ChatType::Group) && !self.config.allow_group_message {
            return None;
        }

        // 获取发送者信息
        let sender = if let Some(user) = &message.from {
            Sender {
                sender_type: if user.is_bot {
                    SenderType::Bot
                } else {
                    SenderType::User
                },
                open_id: None,
                user_id: Some(user.id.to_string()),
                name: Some(
                    format!("{} {}", user.first_name, user.last_name)
                        .trim()
                        .to_string(),
                ),
            }
        } else if let Some(chat) = &message.sender_chat {
            Sender {
                sender_type: SenderType::Bot,
                open_id: None,
                user_id: Some(chat.id.to_string()),
                name: Some(chat.title.clone()),
            }
        } else {
            Sender {
                sender_type: SenderType::System,
                open_id: None,
                user_id: None,
                name: None,
            }
        };

        // 解析提及
        let mentions = message
            .entities
            .as_ref()
            .map(|entities| {
                entities
                    .iter()
                    .filter(|e| e.entity_type == "mention" || e.entity_type == "text_mention")
                    .filter_map(|e| {
                        // 提取提及的用户名
                        let start = e.offset as usize;
                        let end = (e.offset + e.length) as usize;
                        if end <= text.len() {
                            let mention_text = &text[start..end];
                            Some(Mention {
                                key: Some(mention_text.to_string()),
                                name: e
                                    .user
                                    .as_ref()
                                    .map(|u| {
                                        format!("{} {}", u.first_name, u.last_name)
                                            .trim()
                                            .to_string()
                                    })
                                    .unwrap_or_else(|| mention_text.to_string()),
                                open_id: None,
                                user_id: e.user.as_ref().map(|u| u.id.to_string()),
                            })
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        Some(ImEvent::Message {
            platform: ImPlatform::Telegram,
            chat_id: message.chat.id.to_string(),
            chat_type,
            message_id: message.message_id.to_string(),
            sender,
            content: parsed_content,
            mentions,
            raw: serde_json::to_value(message).unwrap_or(serde_json::Value::Null),
        })
    }

    /// 处理回调查询
    fn handle_callback_query(&self, query: &TelegramCallbackQuery) -> Option<ImEvent> {
        let chat_id = query.message.as_ref().map(|m| m.chat.id.to_string())?;
        let message_id = query.message.as_ref().map(|m| m.message_id.to_string())?;

        let action_value: serde_json::Value = if query.data.starts_with('{') {
            serde_json::from_str(&query.data).ok()?
        } else {
            serde_json::json!({ "event": query.data })
        };

        let event_name = action_value
            .get("event")
            .and_then(|v| v.as_str())
            .unwrap_or(&query.data)
            .to_string();

        Some(ImEvent::CardAction {
            platform: ImPlatform::Telegram,
            chat_id,
            message_id,
            callback_token: query.id.clone(),
            action: CardAction {
                event: event_name,
                tag: None,
                name: None,
                value: action_value,
                form_value: None,
            },
            raw: serde_json::to_value(query).unwrap_or(serde_json::Value::Null),
        })
    }

    /// 运行轮询循环
    async fn run_poll_loop(&self, event_tx: mpsc::Sender<ImEvent>) {
        let mut retry_delay = self.config.retry_delay;

        while self.running.load(Ordering::SeqCst) {
            // 更新状态
            {
                let mut status = self.status.write().await;
                *status = ConnectionStatus::Connecting;
            }
            let _ = event_tx
                .send(ImEvent::ConnectionStatus {
                    platform: ImPlatform::Telegram,
                    status: ConnectionStatus::Connecting,
                })
                .await;

            info!("开始 Telegram 长轮询");

            {
                let mut status = self.status.write().await;
                *status = ConnectionStatus::Connected;
            }
            let _ = event_tx
                .send(ImEvent::ConnectionStatus {
                    platform: ImPlatform::Telegram,
                    status: ConnectionStatus::Connected,
                })
                .await;

            while self.running.load(Ordering::SeqCst) {
                // 获取更新
                match self.get_updates().await {
                    Ok(updates) => {
                        retry_delay = self.config.retry_delay;

                        for update in updates {
                            // 更新 offset
                            self.offset.store(update.update_id, Ordering::SeqCst);

                            // 处理消息
                            if let Some(message) = &update.message {
                                if let Some(event) = self.handle_message(message) {
                                    if event_tx.send(event).await.is_err() {
                                        warn!("发送事件失败");
                                    }
                                }
                            }

                            // 处理编辑的消息
                            if let Some(message) = &update.edited_message {
                                if let Some(event) = self.handle_message(message) {
                                    if event_tx.send(event).await.is_err() {
                                        warn!("发送事件失败");
                                    }
                                }
                            }

                            // 处理回调查询
                            if let Some(query) = &update.callback_query {
                                if let Some(event) = self.handle_callback_query(query) {
                                    if event_tx.send(event).await.is_err() {
                                        warn!("发送事件失败");
                                    }
                                }
                            }
                        }
                    }
                    Err(ImError::Timeout) => {
                        // 超时是正常的，继续轮询
                        continue;
                    }
                    Err(e) => {
                        error!("获取更新失败: {}", e);

                        {
                            let mut status = self.status.write().await;
                            *status = ConnectionStatus::Reconnecting;
                        }
                        let _ = event_tx
                            .send(ImEvent::ConnectionStatus {
                                platform: ImPlatform::Telegram,
                                status: ConnectionStatus::Reconnecting,
                            })
                            .await;

                        sleep(Duration::from_secs(retry_delay)).await;
                        retry_delay = (retry_delay * 2).min(60);
                        break;
                    }
                }
            }
        }

        // 更新状态
        let mut status = self.status.write().await;
        *status = ConnectionStatus::Disconnected;
    }

    /// 发送消息 API
    async fn send_message_api(
        &self,
        chat_id: i64,
        text: &str,
        reply_to: Option<i64>,
    ) -> Result<SentMessage, ImError> {
        let url = self.api_url("sendMessage");

        let body = SendMessageReq {
            chat_id,
            text: text.to_string(),
            parse_mode: Some("HTML".to_string()),
            reply_to_message_id: reply_to,
            reply_markup: None,
        };

        self.execute_send_request(&url, &body).await
    }

    async fn send_photo_api(
        &self,
        chat_id: i64,
        photo: &str,
        caption: Option<&str>,
        reply_to: Option<i64>,
    ) -> Result<SentMessage, ImError> {
        let url = self.api_url("sendPhoto");
        let body = SendPhotoReq {
            chat_id,
            photo: photo.to_string(),
            caption: caption.map(|value| value.to_string()),
            reply_to_message_id: reply_to,
        };
        self.execute_send_request(&url, &body).await
    }

    async fn send_document_api(
        &self,
        chat_id: i64,
        document: &str,
        caption: Option<&str>,
        reply_to: Option<i64>,
    ) -> Result<SentMessage, ImError> {
        let url = self.api_url("sendDocument");
        let body = SendDocumentReq {
            chat_id,
            document: document.to_string(),
            caption: caption.map(|value| value.to_string()),
            reply_to_message_id: reply_to,
        };
        self.execute_send_request(&url, &body).await
    }

    async fn execute_send_request<T>(&self, url: &str, body: &T) -> Result<SentMessage, ImError>
    where
        T: serde::Serialize + ?Sized,
    {
        let resp = self
            .http
            .post(url)
            .json(body)
            .send()
            .await
            .map_err(|e| ImError::SendError(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(ImError::SendError(format!("HTTP {}", resp.status())));
        }

        let result: TelegramResponse<SentMessage> = resp
            .json()
            .await
            .map_err(|e| ImError::ParseError(e.to_string()))?;

        if !result.ok {
            return Err(Self::platform_error(
                result.error_code.unwrap_or(-1),
                result.description,
            ));
        }

        result
            .result
            .ok_or_else(|| ImError::SendError("响应数据为空".to_string()))
    }

    /// 回答回调查询 API
    async fn answer_callback_query_api(
        &self,
        callback_query_id: &str,
        text: Option<&str>,
        show_alert: bool,
    ) -> Result<(), ImError> {
        let url = self.api_url("answerCallbackQuery");

        let body = AnswerCallbackQueryReq {
            callback_query_id: callback_query_id.to_string(),
            text: text.map(|s| s.to_string()),
            show_alert,
            url: None,
            cache_time: 0,
        };

        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| ImError::SendError(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(ImError::SendError(format!("HTTP {}", resp.status())));
        }

        let result: TelegramResponse<bool> = resp
            .json()
            .await
            .map_err(|e| ImError::ParseError(e.to_string()))?;

        if !result.ok {
            return Err(Self::platform_error(
                result.error_code.unwrap_or(-1),
                result.description,
            ));
        }

        Ok(())
    }
}

fn summarize_telegram_mixed_parts(parts: &[MessagePart]) -> (Option<String>, String) {
    let mut first_image = None;
    let mut text_parts = Vec::new();
    for part in parts {
        match part {
            MessagePart::Text { text } => {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    text_parts.push(trimmed.to_string());
                }
            }
            MessagePart::Image { url } => {
                if first_image.is_none() {
                    first_image = Some(url.clone());
                }
            }
        }
    }
    (first_image, text_parts.join("\n\n"))
}

fn telegram_api_error_message(code: i32, description: &str) -> String {
    let trimmed = description.trim();
    if code == 409 && trimmed.to_ascii_lowercase().contains("webhook") {
        return format!(
            "Telegram getUpdates is unavailable because a webhook is still configured: {}",
            trimmed
        );
    }
    if code == 409 && trimmed.to_ascii_lowercase().contains("getupdates") {
        return format!(
            "Telegram getUpdates is unavailable because another poller appears to be active: {}",
            trimmed
        );
    }
    if trimmed.is_empty() {
        return "未知错误".to_string();
    }
    trimmed.to_string()
}

fn telegram_http_error(
    status: StatusCode,
    payload: Option<TelegramResponse<serde_json::Value>>,
    body_text: Option<&str>,
) -> ImError {
    if let Some(payload) = payload {
        if let Some(description) = payload.description {
            return TelegramClient::platform_error(
                payload.error_code.unwrap_or(status.as_u16() as i32),
                Some(description),
            );
        }
    }

    let body_preview = body_text
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            if value.len() > 200 {
                format!("{}…", value.chars().take(199).collect::<String>())
            } else {
                value.to_string()
            }
        });

    match body_preview {
        Some(body_preview) => {
            ImError::ConnectionError(format!("HTTP {}: {}", status, body_preview))
        }
        None => ImError::ConnectionError(format!("HTTP {}", status)),
    }
}

#[async_trait]
impl ImClient for TelegramClient {
    fn platform(&self) -> ImPlatform {
        ImPlatform::Telegram
    }

    fn status(&self) -> ConnectionStatus {
        match self.status.try_read() {
            Ok(guard) => *guard,
            Err(_) => ConnectionStatus::Disconnected,
        }
    }

    async fn start(&self, event_tx: mpsc::Sender<ImEvent>) -> Result<(), ImError> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(ImError::Other("客户端已在运行".to_string()));
        }

        // 验证配置
        if self.config.bot_token.is_empty() {
            return Err(ImError::ConfigError("bot_token 未配置".to_string()));
        }

        info!("启动 Telegram 轮询客户端");

        // 在后台运行轮询循环
        let client = self.clone();
        tokio::spawn(async move {
            client.run_poll_loop(event_tx).await;
        });

        Ok(())
    }

    async fn stop(&self) -> Result<(), ImError> {
        if !self.running.swap(false, Ordering::SeqCst) {
            return Ok(());
        }

        info!("停止 Telegram 轮询客户端");

        self.stop_signal.notify_waiters();

        let mut status = self.status.write().await;
        *status = ConnectionStatus::Disconnected;

        Ok(())
    }

    async fn send_message(
        &self,
        request: SendMessageRequest,
    ) -> Result<SendMessageResponse, ImError> {
        let chat_id: i64 = request
            .chat_id
            .parse()
            .map_err(|_| ImError::SendError("无效的 chat_id".to_string()))?;

        let reply_to = request
            .reply_to
            .map(|s| s.parse())
            .transpose()
            .map_err(|_| ImError::SendError("无效的 reply_to".to_string()))?;

        let sent = match request.content {
            MessageContent::Text { text } => {
                self.send_message_api(chat_id, &text, reply_to).await?
            }
            MessageContent::Image { url } => {
                self.send_photo_api(chat_id, &url, None, reply_to).await?
            }
            MessageContent::File { name: _, url } => {
                self.send_document_api(chat_id, &url, None, reply_to)
                    .await?
            }
            MessageContent::Card { .. } => {
                self.send_message_api(
                    chat_id,
                    "Interactive card content is available in the desktop app.",
                    reply_to,
                )
                .await?
            }
            MessageContent::Mixed { parts } => {
                let (first_image, caption) = summarize_telegram_mixed_parts(&parts);
                if let Some(image_url) = first_image {
                    self.send_photo_api(
                        chat_id,
                        &image_url,
                        (!caption.trim().is_empty()).then_some(caption.as_str()),
                        reply_to,
                    )
                    .await?
                } else {
                    let text = if caption.trim().is_empty() {
                        "Mixed content is available in the desktop app.".to_string()
                    } else {
                        caption
                    };
                    self.send_message_api(chat_id, &text, reply_to).await?
                }
            }
        };

        Ok(SendMessageResponse {
            message_id: sent.message_id.to_string(),
            timestamp: sent.date,
        })
    }

    async fn reply_card_action(
        &self,
        message_id: &str,
        response: CardActionResponse,
    ) -> Result<(), ImError> {
        // message_id 在 Telegram 中是 callback_query_id
        let toast = response.toast.as_ref();
        let text = toast.map(|t| t.content.as_str());
        let show_alert = toast
            .map(|t| matches!(t.toast_type, ToastType::Error | ToastType::Warning))
            .unwrap_or(false);

        self.answer_callback_query_api(message_id, text, show_alert)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_client(allow_group_message: bool) -> TelegramClient {
        TelegramClient::new(TelegramConfig {
            bot_token: "telegram-token".to_string(),
            allow_group_message,
            ..Default::default()
        })
    }

    fn sample_message(chat_type: &str, text: Option<&str>) -> TelegramMessage {
        TelegramMessage {
            message_id: 42,
            from: Some(TelegramUser {
                id: 7,
                is_bot: false,
                first_name: "Alice".to_string(),
                last_name: "Example".to_string(),
                username: String::new(),
                language_code: String::new(),
            }),
            sender_chat: None,
            chat: TelegramChat {
                id: 99,
                chat_type: chat_type.to_string(),
                title: String::new(),
                username: String::new(),
                first_name: "Alice".to_string(),
                last_name: "Example".to_string(),
            },
            date: 1_717_171_717,
            text: text.map(str::to_string),
            caption: None,
            photo: None,
            document: None,
            entities: None,
            reply_to_message: None,
        }
    }

    fn sample_photo_message() -> TelegramMessage {
        TelegramMessage {
            text: None,
            caption: Some("photo caption".to_string()),
            photo: Some(vec![TelegramPhotoSize {
                file_id: "photo-file-id".to_string(),
                file_unique_id: "photo-unique".to_string(),
                width: 512,
                height: 512,
                file_size: Some(1024),
            }]),
            ..sample_message("private", None)
        }
    }

    fn sample_document_message() -> TelegramMessage {
        TelegramMessage {
            text: None,
            caption: Some("document caption".to_string()),
            photo: None,
            document: Some(TelegramDocument {
                file_id: "document-file-id".to_string(),
                file_unique_id: "document-unique".to_string(),
                file_name: Some("report.pdf".to_string()),
                mime_type: Some("application/pdf".to_string()),
                file_size: Some(2048),
            }),
            ..sample_message("private", None)
        }
    }

    #[test]
    fn handle_message_returns_private_text_event() {
        let client = make_client(false);

        let event = client
            .handle_message(&sample_message("private", Some("hello telegram")))
            .expect("private text should become an event");

        match event {
            ImEvent::Message {
                platform,
                chat_type,
                chat_id,
                content: MessageContent::Text { text },
                ..
            } => {
                assert_eq!(platform, ImPlatform::Telegram);
                assert_eq!(chat_type, ChatType::Private);
                assert_eq!(chat_id, "99");
                assert_eq!(text, "hello telegram");
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn handle_message_ignores_group_messages_when_group_mode_is_disabled() {
        let client = make_client(false);

        let event = client.handle_message(&sample_message("group", Some("hello group")));

        assert!(event.is_none(), "group messages should be ignored");
    }

    #[test]
    fn handle_message_maps_photo_to_image_content() {
        let client = make_client(false);
        let event = client
            .handle_message(&sample_photo_message())
            .expect("photo message should become an event");

        match event {
            ImEvent::Message {
                content: MessageContent::Mixed { parts },
                ..
            } => {
                assert_eq!(parts.len(), 2);
                assert!(matches!(
                    &parts[0],
                    MessagePart::Text { text } if text == "photo caption"
                ));
                assert!(matches!(
                    &parts[1],
                    MessagePart::Image { url } if url == "telegram://photo/photo-file-id"
                ));
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn handle_message_maps_document_to_file_content() {
        let client = make_client(false);
        let event = client
            .handle_message(&sample_document_message())
            .expect("document message should become an event");

        match event {
            ImEvent::Message {
                content: MessageContent::File { name, url },
                ..
            } => {
                assert_eq!(name, "report.pdf");
                assert_eq!(url, "telegram://document/document-file-id");
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn telegram_api_error_message_mentions_webhook_conflict() {
        let message = telegram_api_error_message(
            409,
            "Conflict: can't use getUpdates method while webhook is active",
        );

        assert!(message.contains("webhook"));
        assert!(message.contains("getUpdates"));
    }

    #[test]
    fn telegram_http_error_prefers_platform_conflict_payload() {
        let error = telegram_http_error(
            StatusCode::CONFLICT,
            Some(TelegramResponse {
                ok: false,
                result: None,
                description: Some(
                    "Conflict: can't use getUpdates method while webhook is active".to_string(),
                ),
                error_code: Some(409),
            }),
            Some("{\"ok\":false}"),
        );

        let rendered = error.to_string();

        assert!(rendered.contains("webhook"));
        assert!(rendered.contains("getUpdates"));
        assert!(rendered.contains("409"));
    }

    #[test]
    fn summarize_telegram_mixed_parts_extracts_first_image_and_caption() {
        let (image, caption) = summarize_telegram_mixed_parts(&[
            MessagePart::Text {
                text: "hello".to_string(),
            },
            MessagePart::Image {
                url: "https://example.com/image.png".to_string(),
            },
            MessagePart::Text {
                text: "world".to_string(),
            },
        ]);

        assert_eq!(image.as_deref(), Some("https://example.com/image.png"));
        assert_eq!(caption, "hello\n\nworld");
    }
}
