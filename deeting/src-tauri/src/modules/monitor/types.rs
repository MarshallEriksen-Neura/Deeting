use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
pub struct MonitorWorkerStartRequest {
    pub access_token: Option<String>,
    pub agent_id: Option<String>,
    pub poll_interval_seconds: Option<u64>,
    pub pull_limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MonitorWorkerStatus {
    pub running: bool,
    pub agent_id: Option<String>,
    pub poll_interval_seconds: u64,
    pub pull_limit: u32,
    pub last_tick_at: Option<String>,
    pub last_error: Option<String>,
    pub last_claimed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMonitorTask {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub objective: String,
    pub cron_expr: String,
    pub status: String,
    pub last_snapshot: Option<Value>,
    pub last_executed_at: Option<String>,
    pub next_run_at: Option<String>,
    pub current_interval_minutes: Option<i64>,
    pub strategy_variants: Option<Value>,
    pub assistant_id: Option<String>,
    pub model_id: Option<String>,
    pub error_count: i64,
    pub notify_config: Value,
    pub allowed_tools: Vec<String>,
    pub execution_target: String,
    pub total_tokens: i64,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMonitorTaskListResponse {
    pub items: Vec<LocalMonitorTask>,
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMonitorStatsResponse {
    pub total_tasks: i64,
    pub active_tasks: i64,
    pub paused_tasks: i64,
    pub failed_suspended_tasks: i64,
    pub total_tokens: i64,
    pub total_executions: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMonitorExecutionLog {
    pub id: String,
    pub task_id: String,
    pub triggered_at: String,
    pub status: String,
    pub input_data: Option<Value>,
    pub output_data: Option<Value>,
    pub tokens_used: i64,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMonitorExecutionLogListResponse {
    pub items: Vec<LocalMonitorExecutionLog>,
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LocalMonitorListQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LocalMonitorLogsQuery {
    pub task_id: String,
    pub skip: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LocalMonitorTaskCreateRequest {
    pub title: String,
    pub objective: String,
    pub cron_expr: Option<String>,
    pub notify_config: Option<Value>,
    pub allowed_tools: Option<Vec<String>>,
    pub execution_target: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LocalMonitorTaskUpdateRequest {
    pub title: Option<String>,
    pub objective: Option<String>,
    pub cron_expr: Option<String>,
    pub status: Option<String>,
    pub notify_config: Option<Value>,
    pub allowed_tools: Option<Vec<String>>,
    pub execution_target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMonitorActionResponse {
    pub id: String,
    pub status: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMonitorCreateResponse {
    pub id: String,
    pub title: String,
    pub status: String,
    pub message: String,
    pub assistant_id: Option<String>,
    pub execution_target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMonitorTriggerResponse {
    pub task_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LocalMonitorTaskIdRequest {
    pub task_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LocalMonitorFeedbackRequest {
    pub task_id: String,
    pub log_id: String,
    pub score: f64,
}

#[derive(Debug, Clone)]
pub struct LocalExecutionResult {
    pub is_significant_change: bool,
    pub change_summary: String,
    pub new_snapshot: Value,
    pub tokens_used: i64,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalNotificationChannel {
    pub id: String,
    pub user_id: String,
    pub channel: String,
    pub config: Value,
    pub display_name: Option<String>,
    pub is_active: bool,
    pub priority: i64,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalNotificationChannelListResponse {
    pub items: Vec<LocalNotificationChannel>,
    pub total: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LocalNotificationChannelCreateRequest {
    pub channel: String,
    pub config: Value,
    pub display_name: Option<String>,
    pub priority: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LocalNotificationChannelUpdateRequest {
    pub config: Option<Value>,
    pub display_name: Option<String>,
    pub priority: Option<i64>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalNotificationChannelCreateResponse {
    pub id: String,
    pub channel: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalNotificationChannelUpdateResponse {
    pub id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalNotificationChannelDeleteResponse {
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LocalNotificationChannelTestRequest {
    pub channel: String,
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalNotificationChannelTestResponse {
    pub success: bool,
    pub channel: String,
    pub message: Option<String>,
}
