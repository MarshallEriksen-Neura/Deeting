use mcp_core::types::LocalChatInputMessage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::conversation::LocalConversationHistoryMessage;

pub struct LocalConversationRegenerateContext {
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub deleted_turn_index: Option<i64>,
    pub messages: Vec<LocalChatInputMessage>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct LocalConversationChatContext {
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub messages: Vec<LocalChatInputMessage>,
}

pub struct LocalConversationRuntimeWindow {
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub messages: Vec<LocalConversationHistoryMessage>,
    pub meta: Option<Value>,
    pub summary: Option<Value>,
}

pub struct LocalConversationTitleContext {
    pub session_id: String,
    pub title: Option<String>,
    pub message_count: i64,
    pub first_user_message: Option<String>,
}
