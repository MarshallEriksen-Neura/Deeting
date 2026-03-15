use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::mpsc;

/// IM 平台类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImPlatform {
    Feishu,
    Telegram,
    Wechat,
    Dingtalk,
    QQ,
}

impl std::fmt::Display for ImPlatform {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImPlatform::Feishu => write!(f, "feishu"),
            ImPlatform::Telegram => write!(f, "telegram"),
            ImPlatform::Wechat => write!(f, "wechat"),
            ImPlatform::Dingtalk => write!(f, "dingtalk"),
            ImPlatform::QQ => write!(f, "qq"),
        }
    }
}

/// IM 事件类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ImEvent {
    /// 收到消息
    Message {
        platform: ImPlatform,
        chat_id: String,
        chat_type: ChatType,
        message_id: String,
        sender: Sender,
        content: MessageContent,
        #[serde(default)]
        mentions: Vec<Mention>,
        raw: serde_json::Value,
    },
    /// 卡片交互回调
    CardAction {
        platform: ImPlatform,
        chat_id: String,
        message_id: String,
        callback_token: String,
        action: CardAction,
        raw: serde_json::Value,
    },
    /// 连接状态变化
    ConnectionStatus {
        platform: ImPlatform,
        status: ConnectionStatus,
    },
}

/// 聊天类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatType {
    Private,
    Group,
    SuperGroup,
    Channel,
}

/// 发送者信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sender {
    pub sender_type: SenderType,
    pub open_id: Option<String>,
    pub user_id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SenderType {
    User,
    Bot,
    System,
}

/// 消息内容
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MessageContent {
    Text { text: String },
    Image { url: String },
    File { name: String, url: String },
    Mixed { parts: Vec<MessagePart> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MessagePart {
    Text { text: String },
    Image { url: String },
}

/// @提及
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mention {
    pub key: Option<String>,
    pub name: String,
    pub open_id: Option<String>,
    pub user_id: Option<String>,
}

/// 卡片动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardAction {
    pub event: String,
    pub tag: Option<String>,
    pub name: Option<String>,
    pub value: serde_json::Value,
    pub form_value: Option<serde_json::Value>,
}

/// 连接状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error,
}

/// 发送消息请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub chat_id: String,
    pub content: MessageContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
}

/// 发送消息响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageResponse {
    pub message_id: String,
    pub timestamp: i64,
}

/// IM 客户端配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImClientConfig {
    /// 平台类型
    pub platform: ImPlatform,
    /// 是否启用
    pub enabled: bool,
    /// 连接模式
    pub mode: ConnectionMode,
    /// 平台特定配置
    pub platform_config: HashMap<String, serde_json::Value>,
}

/// 连接模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionMode {
    /// WebSocket 长连接 (飞书、QQ)
    WebSocket,
    /// HTTP 长轮询 (Telegram)
    LongPolling,
    /// Webhook 回调 (微信、钉钉) - 需要中转服务
    Webhook,
}

/// IM 客户端 Trait
#[async_trait::async_trait]
pub trait ImClient: Send + Sync {
    /// 获取平台类型
    fn platform(&self) -> ImPlatform;

    /// 获取当前连接状态
    fn status(&self) -> ConnectionStatus;

    /// 启动客户端
    async fn start(&self, event_tx: mpsc::Sender<ImEvent>) -> Result<(), ImError>;

    /// 停止客户端
    async fn stop(&self) -> Result<(), ImError>;

    /// 发送消息
    async fn send_message(
        &self,
        request: SendMessageRequest,
    ) -> Result<SendMessageResponse, ImError>;

    /// 回复卡片动作
    async fn reply_card_action(
        &self,
        message_id: &str,
        response: CardActionResponse,
    ) -> Result<(), ImError>;
}

/// 卡片动作响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardActionResponse {
    /// Toast 提示
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toast: Option<ToastResponse>,
    /// 更新卡片内容
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_card: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToastResponse {
    #[serde(rename = "type")]
    pub toast_type: ToastType,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToastType {
    Info,
    Success,
    Error,
    Warning,
}

/// IM 错误类型
#[derive(Debug, thiserror::Error)]
pub enum ImError {
    #[error("配置错误: {0}")]
    ConfigError(String),

    #[error("连接错误: {0}")]
    ConnectionError(String),

    #[error("认证错误: {0}")]
    AuthError(String),

    #[error("发送失败: {0}")]
    SendError(String),

    #[error("解析错误: {0}")]
    ParseError(String),

    #[error("平台错误 [{code}]: {message}")]
    PlatformError { code: i32, message: String },

    #[error("超时")]
    Timeout,

    #[error("未实现")]
    NotImplemented,

    #[error("{0}")]
    Other(String),
}

/// 平台配置提取辅助函数
pub fn config_string<'a>(
    config: &'a HashMap<String, serde_json::Value>,
    key: &str,
) -> Option<&'a str> {
    config.get(key).and_then(|v| v.as_str())
}

pub fn config_i64(config: &HashMap<String, serde_json::Value>, key: &str) -> Option<i64> {
    config.get(key).and_then(|v| v.as_i64())
}

pub fn config_bool(config: &HashMap<String, serde_json::Value>, key: &str) -> Option<bool> {
    config.get(key).and_then(|v| v.as_bool())
}
