use serde::{Deserialize, Serialize};
use serde_json::Value;

use mcp_core::types::{LocalChatInputMessage, LocalChatToolCall};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistant {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub system_prompt: String,
    pub model_config: Option<Value>,
    pub tags: Vec<String>,
    pub visibility: String,
    pub source: String,
    pub cloud_id: Option<String>,
    pub is_deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantEntity {
    pub id: String,
    pub owner_user_id: Option<String>,
    pub visibility: String,
    pub status: String,
    pub share_slug: Option<String>,
    pub summary: Option<String>,
    pub icon_id: Option<String>,
    pub install_count: i64,
    pub rating_avg: f64,
    pub rating_count: i64,
    pub current_version_id: Option<String>,
    pub published_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantVersion {
    pub id: String,
    pub assistant_id: String,
    pub version: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub model_config: Option<Value>,
    pub tags: Vec<String>,
    pub changelog: Option<String>,
    pub published_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantSummaryVersion {
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub tags: Vec<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSystemAssistantVersionSnapshot {
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub tags: Vec<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSystemAssistantSnapshot {
    pub assistant_id: String,
    pub icon_id: Option<String>,
    pub share_slug: Option<String>,
    pub summary: Option<String>,
    pub published_at: Option<String>,
    pub install_count: i64,
    pub rating_avg: f64,
    pub rating_count: i64,
    pub version: CloudSystemAssistantVersionSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantSummary {
    pub assistant_id: String,
    pub owner_user_id: Option<String>,
    pub icon_id: Option<String>,
    pub share_slug: Option<String>,
    pub summary: Option<String>,
    pub published_at: Option<String>,
    pub current_version_id: Option<String>,
    pub install_count: i64,
    pub rating_avg: f64,
    pub rating_count: i64,
    pub tags: Vec<String>,
    pub version: LocalAssistantSummaryVersion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantInstallItem {
    pub id: String,
    pub assistant_id: String,
    pub alias: Option<String>,
    pub icon_override: Option<String>,
    pub pinned_version_id: Option<String>,
    pub follow_latest: bool,
    pub is_enabled: bool,
    pub sort_order: i64,
    pub assistant: LocalAssistantSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantInstallPage {
    pub items: Vec<LocalAssistantInstallItem>,
    pub next_page: Option<String>,
    pub previous_page: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantTag {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantInstallQuery {
    pub cursor: Option<String>,
    pub size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantInstallCreateRequest {
    pub follow_latest: Option<bool>,
    pub pinned_version_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantInstallUpdateRequest {
    pub alias: Option<String>,
    pub icon_override: Option<String>,
    pub pinned_version_id: Option<String>,
    pub follow_latest: Option<bool>,
    pub is_enabled: Option<bool>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRatingRequest {
    pub rating: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRatingResponse {
    pub assistant_id: String,
    pub rating_avg: f64,
    pub rating_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingState {
    pub assistant_id: String,
    pub total_trials: i64,
    pub positive_feedback: i64,
    pub negative_feedback: i64,
    pub last_used_at: Option<String>,
    pub last_feedback_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingFeedbackRequest {
    pub event: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingReportQuery {
    pub min_trials: Option<i64>,
    pub min_rating: Option<f64>,
    pub limit: Option<i64>,
    pub sort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingReportItem {
    pub assistant_id: String,
    pub name: Option<String>,
    pub summary: Option<String>,
    pub total_trials: i64,
    pub positive_feedback: i64,
    pub negative_feedback: i64,
    pub rating_score: f64,
    pub mab_score: f64,
    pub routing_score: f64,
    pub exploration_bonus: f64,
    pub last_used_at: Option<String>,
    pub last_feedback_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingReportSummary {
    pub total_assistants: i64,
    pub total_trials: i64,
    pub total_positive: i64,
    pub total_negative: i64,
    pub overall_rating: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingReportResponse {
    pub summary: LocalAssistantRoutingReportSummary,
    pub items: Vec<LocalAssistantRoutingReportItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantPreviewRequest {
    pub message: String,
    pub stream: Option<bool>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLocalAssistantRequest {
    pub name: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub system_prompt: String,
    pub model_config: Option<Value>,
    pub tags: Option<Vec<String>>,
    pub visibility: Option<String>,
    pub source: Option<String>,
    pub cloud_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateLocalAssistantRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub system_prompt: Option<String>,
    pub model_config: Option<Value>,
    pub tags: Option<Vec<String>>,
    pub visibility: Option<String>,
    pub source: Option<String>,
    pub cloud_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantMessage {
    pub id: String,
    pub assistant_id: String,
    pub role: String,
    pub content: String,
    pub is_deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAssistantMessageRequest {
    pub assistant_id: String,
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatRequest {
    pub assistant_id: Option<String>,
    pub model: String,
    pub messages: Vec<LocalChatInputMessage>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatResponse {
    pub content: String,
    pub tool_calls: Vec<LocalChatToolCall>,
}
