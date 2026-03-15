use super::protocol::*;
use crate::modules::im::types::*;
use async_trait::async_trait;
use log::{error, info, warn};
use reqwest::Client;
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
    pub fn from_config(platform_config: &HashMap<String, serde_json::Value>) -> Result<Self, ImError> {
        let bot_token = config_string(platform_config, "bot_token")
            .ok_or_else(|| ImError::ConfigError("缺少 bot_token".to_string()))?
            .to_string();
        
        let allow_group_message = config_bool(platform_config, "allow_group_message").unwrap_or(true);
        
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
    
    /// 获取更新
    async fn get_updates(&self) -> Result<Vec<TelegramUpdate>, ImError> {
        let url = self.api_url("getUpdates");
        
        let offset = self.offset.load(Ordering::SeqCst);
        
        let body = serde_json::json!({
            "offset": if offset > 0 { offset + 1 } else { 0 },
            "timeout": self.config.poll_timeout,
            "allowed_updates": ["message", "callback_query"],
        });
        
        let resp = self.http
            .post(&url)
            .json(&body)
            .timeout(Duration::from_secs(self.config.poll_timeout as u64 + 10))
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    ImError::Timeout
                } else {
                    ImError::ConnectionError(e.to_string())
                }
            })?;
        
        if !resp.status().is_success() {
            return Err(ImError::ConnectionError(format!("HTTP {}", resp.status())));
        }
        
        let result: TelegramResponse<Vec<TelegramUpdate>> = resp
            .json()
            .await
            .map_err(|e| ImError::ParseError(e.to_string()))?;
        
        if !result.ok {
            return Err(ImError::PlatformError {
                code: result.error_code.unwrap_or(-1),
                message: result.description.unwrap_or_else(|| "未知错误".to_string()),
            });
        }
        
        Ok(result.result.unwrap_or_default())
    }
    
    /// 处理消息更新
    fn handle_message(&self, message: &TelegramMessage) -> Option<ImEvent> {
        // 获取文本内容
        let text = message.text.as_ref().or(message.caption.as_ref())?;
        
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
                sender_type: if user.is_bot { SenderType::Bot } else { SenderType::User },
                open_id: None,
                user_id: Some(user.id.to_string()),
                name: Some(format!("{} {}", user.first_name, user.last_name).trim().to_string()),
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
        let mentions = message.entities
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
                                name: e.user.as_ref()
                                    .map(|u| format!("{} {}", u.first_name, u.last_name).trim().to_string())
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
            content: MessageContent::Text { text: text.clone() },
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
            let _ = event_tx.send(ImEvent::ConnectionStatus {
                platform: ImPlatform::Telegram,
                status: ConnectionStatus::Connecting,
            }).await;
            
            info!("开始 Telegram 长轮询");
            
            {
                let mut status = self.status.write().await;
                *status = ConnectionStatus::Connected;
            }
            let _ = event_tx.send(ImEvent::ConnectionStatus {
                platform: ImPlatform::Telegram,
                status: ConnectionStatus::Connected,
            }).await;
            
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
                        let _ = event_tx.send(ImEvent::ConnectionStatus {
                            platform: ImPlatform::Telegram,
                            status: ConnectionStatus::Reconnecting,
                        }).await;
                        
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
        
        let resp = self.http
            .post(&url)
            .json(&body)
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
            return Err(ImError::PlatformError {
                code: result.error_code.unwrap_or(-1),
                message: result.description.unwrap_or_else(|| "未知错误".to_string()),
            });
        }
        
        result.result.ok_or_else(|| ImError::SendError("响应数据为空".to_string()))
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
        
        let resp = self.http
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
            return Err(ImError::PlatformError {
                code: result.error_code.unwrap_or(-1),
                message: result.description.unwrap_or_else(|| "未知错误".to_string()),
            });
        }
        
        Ok(())
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
    
    async fn send_message(&self, request: SendMessageRequest) -> Result<SendMessageResponse, ImError> {
        let chat_id: i64 = request.chat_id.parse()
            .map_err(|_| ImError::SendError("无效的 chat_id".to_string()))?;
        
        let text = match request.content {
            MessageContent::Text { text } => text,
            _ => return Err(ImError::NotImplemented),
        };
        
        let reply_to = request.reply_to
            .map(|s| s.parse())
            .transpose()
            .map_err(|_| ImError::SendError("无效的 reply_to".to_string()))?;
        
        let sent = self.send_message_api(chat_id, &text, reply_to).await?;
        
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
        
        self.answer_callback_query_api(message_id, text, show_alert).await
    }
}
