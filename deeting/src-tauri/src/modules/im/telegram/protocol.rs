use serde::{Deserialize, Serialize};

/// Telegram Update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramUpdate {
    pub update_id: i64,
    pub message: Option<TelegramMessage>,
    pub edited_message: Option<TelegramMessage>,
    pub channel_post: Option<TelegramMessage>,
    pub edited_channel_post: Option<TelegramMessage>,
    pub callback_query: Option<TelegramCallbackQuery>,
}

/// Telegram 消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramMessage {
    pub message_id: i64,
    pub from: Option<TelegramUser>,
    pub sender_chat: Option<TelegramChat>,
    pub chat: TelegramChat,
    pub date: i64,
    pub text: Option<String>,
    pub caption: Option<String>,
    pub entities: Option<Vec<TelegramEntity>>,
    #[serde(default)]
    pub reply_to_message: Option<Box<TelegramMessage>>,
}

/// Telegram 用户
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramUser {
    pub id: i64,
    pub is_bot: bool,
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub language_code: String,
}

/// Telegram 聊天
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramChat {
    pub id: i64,
    #[serde(rename = "type")]
    pub chat_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
}

/// Telegram 实体（消息中的特殊内容）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramEntity {
    #[serde(rename = "type")]
    pub entity_type: String,
    pub offset: i64,
    pub length: i64,
    pub url: Option<String>,
    pub user: Option<TelegramUser>,
}

/// Telegram 回调查询
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramCallbackQuery {
    pub id: String,
    pub from: TelegramUser,
    pub message: Option<TelegramMessage>,
    #[serde(default)]
    pub chat_instance: String,
    #[serde(default)]
    pub data: String,
    #[serde(default)]
    pub game_short_name: String,
}

/// Telegram API 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramResponse<T> {
    pub ok: bool,
    pub result: Option<T>,
    pub description: Option<String>,
    pub error_code: Option<i32>,
}

/// 发送消息请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageReq {
    pub chat_id: i64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to_message_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_markup: Option<InlineKeyboardMarkup>,
}

/// 内联键盘
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineKeyboardMarkup {
    pub inline_keyboard: Vec<Vec<InlineKeyboardButton>>,
}

/// 内联键盘按钮
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineKeyboardButton {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub callback_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// 发送的消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentMessage {
    pub message_id: i64,
    pub chat: TelegramChat,
    pub date: i64,
}

/// 回答回调查询请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerCallbackQueryReq {
    pub callback_query_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default)]
    pub show_alert: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default)]
    pub cache_time: i32,
}
