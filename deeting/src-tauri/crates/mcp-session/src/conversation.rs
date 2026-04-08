use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalConversationStatus {
    Active,
    Archived,
    Closed,
}

impl LocalConversationStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            LocalConversationStatus::Active => "active",
            LocalConversationStatus::Archived => "archived",
            LocalConversationStatus::Closed => "closed",
        }
    }
}

impl std::str::FromStr for LocalConversationStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "active" => Ok(LocalConversationStatus::Active),
            "archived" => Ok(LocalConversationStatus::Archived),
            "closed" => Ok(LocalConversationStatus::Closed),
            _ => Err(format!("unknown conversation status: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSessionItem {
    pub session_id: String,
    pub title: Option<String>,
    pub summary_text: Option<String>,
    pub message_count: i64,
    pub first_message_at: Option<String>,
    pub last_active_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSessionPage {
    pub items: Vec<LocalConversationSessionItem>,
    pub next_page: Option<String>,
    pub previous_page: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationCreateRequest {
    pub assistant_id: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationCreateResponse {
    pub session_id: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationArchiveResponse {
    pub session_id: String,
    pub status: LocalConversationStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationDeleteResponse {
    pub session_id: String,
    pub turn_index: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationClearResponse {
    pub session_id: String,
    pub cleared: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSendRequest {
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub content: String,
    pub model: String,
    pub provider_model_id: Option<String>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSendResponse {
    pub session_id: String,
    pub user_message: LocalConversationHistoryMessage,
    pub assistant_message: LocalConversationHistoryMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationCancelResponse {
    pub request_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationRenameRequest {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationRenameResponse {
    pub session_id: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationHistoryMessage {
    pub role: String,
    pub content: Option<Value>,
    pub turn_index: Option<i64>,
    pub created_at: Option<String>,
    pub is_truncated: Option<bool>,
    pub name: Option<String>,
    pub meta_info: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationHistoryResponse {
    pub session_id: String,
    pub messages: Vec<LocalConversationHistoryMessage>,
    pub next_cursor: Option<i64>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationWindowResponse {
    pub session_id: String,
    pub messages: Vec<LocalConversationHistoryMessage>,
    pub meta: Option<Value>,
    pub summary: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSessionsQuery {
    pub cursor: Option<String>,
    pub size: Option<i64>,
    pub assistant_id: Option<String>,
    pub status: Option<LocalConversationStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationHistoryQuery {
    pub session_id: Option<String>,
    pub cursor: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateConversationMessageRequest {
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub name: Option<String>,
    pub meta_info: Option<Value>,
    pub is_truncated: Option<bool>,
    pub parent_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationRegenerateRequest {
    pub session_id: String,
    pub model: String,
    pub provider_model_id: Option<String>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationRegenerateResponse {
    pub session_id: String,
    pub deleted_turn_index: Option<i64>,
    pub message: LocalConversationHistoryMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationCompareFinalizeRequest {
    pub session_id: String,
    pub model_id: String,
    pub provider_model_id: Option<String>,
    pub blocks: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationCompareFinalizeResponse {
    pub session_id: String,
    pub replaced_turn_index: i64,
    pub message: LocalConversationHistoryMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationExecutionRoot {
    pub root_execution_id: String,
    pub session_id: String,
    pub message_id: String,
    pub turn_index: i64,
    pub schema_version: i64,
    pub execution_id: String,
    pub execution_kind: String,
    pub execution_status: String,
    pub terminal_status: String,
    pub target_id: Option<String>,
    pub target_name: Option<String>,
    pub target_invocation_kind: Option<String>,
    pub target_worker_ref: Option<String>,
    pub target_workflow_run_id: Option<String>,
    pub selection: Option<Value>,
    pub available_actions: Option<Value>,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub result_payload: Option<Value>,
    pub raw_json: Option<Value>,
    pub started_at_ms: Option<i64>,
    pub completed_at_ms: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationExecutionChild {
    pub id: String,
    pub root_execution_id: String,
    pub session_id: String,
    pub message_id: String,
    pub phase_id: Option<String>,
    pub step_type: Option<String>,
    pub title: String,
    pub status: String,
    pub worker_ref: Option<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub available_actions: Option<Value>,
    pub raw_json: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationExecutionTreeResponse {
    pub root: LocalConversationExecutionRoot,
    pub children: Vec<LocalConversationExecutionChild>,
}

#[cfg(test)]
mod tests {
    use super::LocalConversationStatus;
    use std::str::FromStr;

    #[test]
    fn conversation_status_roundtrips() {
        assert_eq!(
            LocalConversationStatus::from_str("active")
                .unwrap()
                .as_str(),
            "active"
        );
        assert!(LocalConversationStatus::from_str("unknown").is_err());
    }
}
