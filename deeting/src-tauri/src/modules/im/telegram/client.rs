use super::protocol::*;
use crate::modules::im::types::*;
use async_trait::async_trait;
use log::{error, info, warn};
use reqwest::Client;
use reqwest::StatusCode;
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};
use tokio::task::JoinHandle;
use tokio::time::sleep;

/// Telegram client config.
#[derive(Clone)]
pub struct TelegramConfig {
    pub bot_token: String,
    pub poll_timeout: i32,
    pub retry_delay: u64,
    /// Whether group messages are allowed.
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

/// Telegram client.
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

    /// Build a client from a config map.
    pub fn from_config(
        platform_config: &HashMap<String, serde_json::Value>,
    ) -> Result<Self, ImError> {
        let bot_token = config_string(platform_config, "bot_token")
            .ok_or_else(|| ImError::ConfigError("missing bot_token".to_string()))?
            .to_string();

        let allow_group_message =
            config_bool(platform_config, "allow_group_message").unwrap_or(true);

        Ok(Self::new(TelegramConfig {
            bot_token,
            allow_group_message,
            ..Default::default()
        }))
    }

    /// Build an API URL.
    fn api_url(&self, method: &str) -> String {
        format!(
            "https://api.telegram.org/bot{}/{}",
            self.config.bot_token, method
        )
    }

    fn platform_error(code: i32, description: Option<String>) -> ImError {
        ImError::PlatformError {
            code,
            message: telegram_api_error_message(
                code,
                description.as_deref().unwrap_or("unknown error"),
            ),
        }
    }

    fn summarize_message_raw(message: &TelegramMessage) -> serde_json::Value {
        json!({
            "message_id": message.message_id,
            "chat": {
                "id": message.chat.id,
                "type": message.chat.chat_type,
                "title": (!message.chat.title.is_empty()).then(|| message.chat.title.clone()),
                "username": (!message.chat.username.is_empty()).then(|| message.chat.username.clone()),
                "first_name": (!message.chat.first_name.is_empty()).then(|| message.chat.first_name.clone()),
                "last_name": (!message.chat.last_name.is_empty()).then(|| message.chat.last_name.clone()),
            },
            "from": message.from.as_ref().map(|user| json!({
                "id": user.id,
                "is_bot": user.is_bot,
                "first_name": user.first_name,
                "last_name": (!user.last_name.is_empty()).then(|| user.last_name.clone()),
                "username": (!user.username.is_empty()).then(|| user.username.clone()),
            })),
            "sender_chat": message.sender_chat.as_ref().map(|chat| json!({
                "id": chat.id,
                "type": chat.chat_type,
                "title": (!chat.title.is_empty()).then(|| chat.title.clone()),
                "username": (!chat.username.is_empty()).then(|| chat.username.clone()),
            })),
            "date": message.date,
            "text": message.text,
            "caption": message.caption,
            "entity_count": message.entities.as_ref().map(|items| items.len()).unwrap_or(0),
            "has_photo": message.photo.as_ref().map(|items| !items.is_empty()).unwrap_or(false),
            "document": message.document.as_ref().map(|document| json!({
                "file_id": document.file_id,
                "file_name": document.file_name,
                "mime_type": document.mime_type,
                "file_size": document.file_size,
            })),
            "reply_to_message": message.reply_to_message.as_ref().map(|reply| json!({
                "message_id": reply.message_id,
                "from": reply.from.as_ref().map(|user| json!({
                    "id": user.id,
                    "is_bot": user.is_bot,
                })),
                "chat": {
                    "id": reply.chat.id,
                    "type": reply.chat.chat_type,
                },
                "text": reply.text,
                "caption": reply.caption,
            })),
        })
    }

    fn summarize_callback_query_raw(query: &TelegramCallbackQuery) -> serde_json::Value {
        json!({
            "id": query.id,
            "from": {
                "id": query.from.id,
                "is_bot": query.from.is_bot,
                "first_name": query.from.first_name,
                "last_name": (!query.from.last_name.is_empty()).then(|| query.from.last_name.clone()),
                "username": (!query.from.username.is_empty()).then(|| query.from.username.clone()),
            },
            "chat_instance": (!query.chat_instance.is_empty()).then(|| query.chat_instance.clone()),
            "data": (!query.data.is_empty()).then(|| query.data.clone()),
            "game_short_name": (!query.game_short_name.is_empty()).then(|| query.game_short_name.clone()),
            "message": query.message.as_ref().map(Self::summarize_message_raw),
        })
    }

    pub(crate) fn start_background_loop(
        &self,
        event_tx: mpsc::Sender<ImEvent>,
    ) -> Result<JoinHandle<()>, ImError> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(ImError::Other(
                "telegram client is already running".to_string(),
            ));
        }

        if self.config.bot_token.is_empty() {
            self.running.store(false, Ordering::SeqCst);
            return Err(ImError::ConfigError(
                "bot_token is not configured".to_string(),
            ));
        }

        info!("starting Telegram polling client");

        let client = self.clone();
        Ok(tokio::spawn(async move {
            client.run_poll_loop(event_tx).await;
        }))
    }

    pub async fn probe_polling_available(&self) -> Result<(), ImError> {
        self.get_updates_with_timeout(0).await.map(|_| ())
    }

    /// Fetch updates.
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

    /// Handle a message update.
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

        // Resolve chat type.
        let chat_type = match message.chat.chat_type.as_str() {
            "private" => ChatType::Private,
            "group" | "supergroup" => ChatType::Group,
            "channel" => ChatType::Channel,
            _ => return None,
        };

        if matches!(chat_type, ChatType::Group) && !self.config.allow_group_message {
            return None;
        }

        // Resolve sender details.
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

        // Parse mentions.
        let mentions = message
            .entities
            .as_ref()
            .map(|entities| {
                entities
                    .iter()
                    .filter(|e| e.entity_type == "mention" || e.entity_type == "text_mention")
                    .filter_map(|e| {
                        // Extract the mentioned username.
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
            raw: Self::summarize_message_raw(message),
        })
    }

    /// Handle a callback query.
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
            raw: Self::summarize_callback_query_raw(query),
        })
    }

    /// Run the polling loop.
    async fn run_poll_loop(&self, event_tx: mpsc::Sender<ImEvent>) {
        let mut retry_delay = self.config.retry_delay;

        while self.running.load(Ordering::SeqCst) {
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

            info!("starting Telegram long polling");

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
                // Fetch updates.
                match self.get_updates().await {
                    Ok(updates) => {
                        retry_delay = self.config.retry_delay;

                        for update in updates {
                            // Update the offset.
                            self.offset.store(update.update_id, Ordering::SeqCst);

                            // Handle inbound messages.
                            if let Some(message) = &update.message {
                                if let Some(event) = self.handle_message(message) {
                                    if event_tx.send(event).await.is_err() {
                                        warn!("failed to send event");
                                    }
                                }
                            }

                            if let Some(message) = &update.edited_message {
                                if let Some(event) = self.handle_message(message) {
                                    if event_tx.send(event).await.is_err() {
                                        warn!("failed to send event");
                                    }
                                }
                            }

                            // Handle callback queries.
                            if let Some(query) = &update.callback_query {
                                if let Some(event) = self.handle_callback_query(query) {
                                    if event_tx.send(event).await.is_err() {
                                        warn!("failed to send event");
                                    }
                                }
                            }
                        }
                    }
                    Err(ImError::Timeout) => {
                        continue;
                    }
                    Err(e) => {
                        error!("failed to fetch updates: {}", e);

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

        let mut status = self.status.write().await;
        *status = ConnectionStatus::Disconnected;
    }

    /// Send a text/media message through the Telegram API.
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
            .ok_or_else(|| ImError::SendError("response payload is empty".to_string()))
    }

    /// Answer a callback query through the Telegram API.
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
        return "unknown error".to_string();
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
                format!("{}...", value.chars().take(199).collect::<String>())
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
            return Err(ImError::Other(
                "telegram client is already running".to_string(),
            ));
        }

        // Validate config.
        if self.config.bot_token.is_empty() {
            return Err(ImError::ConfigError(
                "bot_token is not configured".to_string(),
            ));
        }

        info!("starting Telegram polling client");

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

        info!("stopping Telegram polling client");

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
            .map_err(|_| ImError::SendError("invalid chat_id".to_string()))?;

        let reply_to = request
            .reply_to
            .map(|s| s.parse())
            .transpose()
            .map_err(|_| ImError::SendError("invalid reply_to".to_string()))?;

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
        // message_id is the callback_query_id on Telegram.
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
    fn handle_message_raw_summary_does_not_embed_recursive_reply_chain() {
        let client = make_client(false);
        let event = client
            .handle_message(&TelegramMessage {
                reply_to_message: Some(Box::new(TelegramMessage {
                    message_id: 41,
                    text: Some("previous".to_string()),
                    reply_to_message: Some(Box::new(TelegramMessage {
                        message_id: 40,
                        text: Some("older".to_string()),
                        reply_to_message: None,
                        ..sample_message("private", None)
                    })),
                    ..sample_message("private", None)
                })),
                ..sample_message("private", Some("hello telegram"))
            })
            .expect("private text should become an event");

        match event {
            ImEvent::Message { raw, .. } => {
                let reply = raw
                    .get("reply_to_message")
                    .and_then(|value| value.as_object())
                    .expect("reply summary should exist");
                assert_eq!(
                    reply.get("message_id").and_then(|value| value.as_i64()),
                    Some(41)
                );
                assert!(
                    reply.get("reply_to_message").is_none(),
                    "raw summary should stay shallow"
                );
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn handle_callback_query_raw_summary_keeps_nested_message_shallow() {
        let client = make_client(false);
        let event = client
            .handle_callback_query(&TelegramCallbackQuery {
                id: "callback-1".to_string(),
                from: TelegramUser {
                    id: 7,
                    is_bot: false,
                    first_name: "Alice".to_string(),
                    last_name: "Example".to_string(),
                    username: String::new(),
                    language_code: String::new(),
                },
                message: Some(TelegramMessage {
                    reply_to_message: Some(Box::new(TelegramMessage {
                        message_id: 41,
                        text: Some("previous".to_string()),
                        reply_to_message: Some(Box::new(TelegramMessage {
                            message_id: 40,
                            text: Some("older".to_string()),
                            reply_to_message: None,
                            ..sample_message("private", None)
                        })),
                        ..sample_message("private", None)
                    })),
                    ..sample_message("private", Some("hello telegram"))
                }),
                chat_instance: "instance-1".to_string(),
                data: "approve_tool".to_string(),
                game_short_name: String::new(),
            })
            .expect("callback query should become an event");

        match event {
            ImEvent::CardAction { raw, .. } => {
                let message = raw
                    .get("message")
                    .and_then(|value| value.as_object())
                    .expect("callback message summary should exist");
                let reply = message
                    .get("reply_to_message")
                    .and_then(|value| value.as_object())
                    .expect("reply summary should exist");
                assert_eq!(
                    reply.get("message_id").and_then(|value| value.as_i64()),
                    Some(41)
                );
                assert!(
                    reply.get("reply_to_message").is_none(),
                    "callback raw summary should stay shallow"
                );
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
