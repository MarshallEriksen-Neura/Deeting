use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalTraceFeedbackRequest {
    pub trace_id: String,
    pub score: f64,
    pub comment: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalTraceFeedback {
    pub id: String,
    pub trace_id: String,
    pub user_id: Option<String>,
    pub score: f64,
    pub comment: Option<String>,
    pub tags: Option<Vec<String>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LocalGatewayLogQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub user_id: Option<String>,
    pub api_key_id: Option<String>,
    pub preset_id: Option<String>,
    pub model: Option<String>,
    pub status_code: Option<i64>,
    pub is_cached: Option<bool>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMaintenanceActionRequest {
    pub kind: String,
    pub limit: Option<i64>,
    pub reinstall_missing: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMaintenanceLogQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub kind: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMaintenanceLogItem {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub message: String,
    pub details: Option<Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMaintenanceLogListResponse {
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
    pub items: Vec<LocalMaintenanceLogItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGatewayLogItem {
    pub id: String,
    pub trace_id: Option<String>,
    pub user_id: Option<String>,
    pub api_key_id: Option<String>,
    pub preset_id: Option<String>,
    pub model: String,
    pub status_code: i64,
    pub duration_ms: i64,
    pub ttft_ms: Option<i64>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub cost_upstream: f64,
    pub cost_user: f64,
    pub is_cached: bool,
    pub error_code: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGatewayLogListResponse {
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
    pub items: Vec<LocalGatewayLogItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGatewayLogStatsBucket {
    pub key: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGatewayLogStatsResponse {
    pub total: i64,
    pub success_rate: f64,
    pub cache_hit_rate: f64,
    pub avg_duration_ms: i64,
    pub total_cost_user: f64,
    pub error_distribution: Vec<LocalGatewayLogStatsBucket>,
    pub model_ranking: Vec<LocalGatewayLogStatsBucket>,
    pub latency_histogram: Vec<LocalGatewayLogStatsBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub status: Option<String>,
    pub channel: Option<String>,
    pub user_id: Option<String>,
    pub assistant_id: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationItem {
    pub id: String,
    pub title: Option<String>,
    pub user_id: Option<String>,
    pub assistant_id: Option<String>,
    pub channel: String,
    pub status: String,
    pub message_count: i64,
    pub first_message_at: Option<String>,
    pub last_active_at: Option<String>,
    pub last_summary_version: i64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationListResponse {
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
    pub items: Vec<LocalAdminConversationItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationMessageQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub include_deleted: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationMessageItem {
    pub id: String,
    pub session_id: String,
    pub turn_index: i64,
    pub role: String,
    pub content: Option<String>,
    pub name: Option<String>,
    pub token_estimate: i64,
    pub meta_info: Option<Value>,
    pub used_persona_id: Option<String>,
    pub is_deleted: bool,
    pub parent_message_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationMessageListResponse {
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
    pub items: Vec<LocalAdminConversationMessageItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationSummaryItem {
    pub id: String,
    pub session_id: String,
    pub version: i64,
    pub summary_text: String,
    pub covered_from_turn: i64,
    pub covered_to_turn: i64,
    pub token_estimate: i64,
    pub summarizer_model: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationSummaryListResponse {
    pub items: Vec<LocalAdminConversationSummaryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryJobQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub status: Option<String>,
    pub session_id: Option<String>,
    pub error_contains: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryJobItem {
    pub id: String,
    pub session_id: String,
    pub status: String,
    pub trigger_source: Option<String>,
    pub attempts: i64,
    pub max_attempts: i64,
    pub available_after_epoch: i64,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryJobListResponse {
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
    pub items: Vec<LocalConversationSummaryJobItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryIdleTaskQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryIdleTaskItem {
    pub session_id: String,
    pub last_active_epoch: i64,
    pub run_after_epoch: i64,
    pub is_due: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryIdleTaskListResponse {
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
    pub items: Vec<LocalConversationSummaryIdleTaskItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryQueueStats {
    pub pending_jobs: i64,
    pub running_jobs: i64,
    pub completed_jobs: i64,
    pub failed_jobs: i64,
    pub idle_due_tasks: i64,
    pub idle_total_tasks: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryEnqueueResponse {
    pub session_id: String,
    pub queued: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryBatchRetryRequest {
    pub limit: Option<i64>,
    pub status: Option<String>,
    pub session_id: Option<String>,
    pub error_contains: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryBatchRetryResponse {
    pub matched_count: i64,
    pub queued_count: i64,
}
