use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MonitorRunEventKind {
    RunStarted,
    StageChanged,
    ToolCalled,
    ToolSucceeded,
    ToolFailed,
    RunCompleted,
    RunFailed,
    DeliveryFailed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MonitorDeliveryDetailLevel {
    Summary,
    Stage,
    Detailed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MonitorDeliveryPolicy {
    pub notify_on_change: bool,
    pub notify_on_failure: bool,
    pub heartbeat_enabled: bool,
    pub notify_on_start: bool,
    pub detail_level: MonitorDeliveryDetailLevel,
}

impl Default for MonitorDeliveryPolicy {
    fn default() -> Self {
        Self {
            notify_on_change: true,
            notify_on_failure: true,
            heartbeat_enabled: true,
            notify_on_start: false,
            detail_level: MonitorDeliveryDetailLevel::Stage,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MonitorRunEvent {
    pub event_id: String,
    pub execution_id: String,
    pub task_id: String,
    pub occurred_at: String,
    pub seq: u32,
    pub kind: MonitorRunEventKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

impl MonitorRunEvent {
    pub fn new(execution_id: String, task_id: String, seq: u32, kind: MonitorRunEventKind) -> Self {
        Self {
            event_id: uuid::Uuid::new_v4().to_string(),
            execution_id,
            task_id,
            occurred_at: time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string()),
            seq,
            kind,
            stage: None,
            step: None,
            state: None,
            summary: None,
            meta: None,
        }
    }

    pub fn with_stage(
        mut self,
        stage: Option<&str>,
        step: Option<&str>,
        state: Option<&str>,
    ) -> Self {
        self.stage = stage.map(str::to_string);
        self.step = step.map(str::to_string);
        self.state = state.map(str::to_string);
        self
    }

    pub fn with_summary(mut self, summary: impl Into<String>) -> Self {
        self.summary = Some(summary.into());
        self
    }

    pub fn with_meta(mut self, meta: Option<Value>) -> Self {
        self.meta = meta;
        self
    }
}

pub fn monitor_delivery_policy_from_notify_config(notify_config: &Value) -> MonitorDeliveryPolicy {
    let default_policy = MonitorDeliveryPolicy::default();
    let policy = notify_config
        .get("delivery_policy")
        .and_then(Value::as_object);

    let detail_level = match policy
        .and_then(|policy| policy.get("detail_level"))
        .and_then(Value::as_str)
        .unwrap_or("stage")
    {
        "summary" => MonitorDeliveryDetailLevel::Summary,
        "detailed" => MonitorDeliveryDetailLevel::Detailed,
        _ => MonitorDeliveryDetailLevel::Stage,
    };

    MonitorDeliveryPolicy {
        notify_on_change: policy
            .and_then(|policy| policy.get("notify_on_change"))
            .and_then(Value::as_bool)
            .unwrap_or(default_policy.notify_on_change),
        notify_on_failure: policy
            .and_then(|policy| policy.get("notify_on_failure"))
            .and_then(Value::as_bool)
            .unwrap_or(default_policy.notify_on_failure),
        heartbeat_enabled: policy
            .and_then(|policy| policy.get("heartbeat_enabled"))
            .and_then(Value::as_bool)
            .unwrap_or(default_policy.heartbeat_enabled),
        notify_on_start: policy
            .and_then(|policy| policy.get("notify_on_start"))
            .and_then(Value::as_bool)
            .unwrap_or(default_policy.notify_on_start),
        detail_level,
    }
}

pub fn normalize_monitor_notify_config(notify_config: &Value) -> Value {
    let mut normalized = notify_config.as_object().cloned().unwrap_or_default();
    let policy_value =
        serde_json::to_value(monitor_delivery_policy_from_notify_config(notify_config))
            .unwrap_or_else(|_| serde_json::json!({}));
    normalized.insert("delivery_policy".to_string(), policy_value);
    Value::Object(normalized)
}

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
    pub display_status: String,
    pub strategy_variants: Option<Value>,
    pub analysis_mode: String,
    pub policy_state: Value,
    pub binding_state: String,
    pub binding_error: Option<String>,
    pub assistant_id: Option<String>,
    pub assistant_name: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMonitorDeliveryStateRecord {
    pub task_id: String,
    pub channel_id: String,
    pub channel_kind: String,
    pub channel_display_name: Option<String>,
    pub status: String,
    pub target_key: String,
    pub anchor_message_id: Option<String>,
    pub anchor_context: Value,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMonitorDeliveryStateListResponse {
    pub items: Vec<LocalMonitorDeliveryStateRecord>,
    pub total: i64,
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
    pub assistant_id: String,
    pub cron_expr: Option<String>,
    pub analysis_mode: Option<String>,
    pub notify_config: Option<Value>,
    pub allowed_tools: Option<Vec<String>>,
    pub execution_target: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LocalMonitorTaskUpdateRequest {
    pub title: Option<String>,
    pub objective: Option<String>,
    pub assistant_id: Option<String>,
    pub cron_expr: Option<String>,
    pub analysis_mode: Option<String>,
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
    pub analysis_mode: String,
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
    pub strategy_tag: Option<String>,
    pub observations: Option<Value>,
    pub tokens_used: i64,
    pub model_id: String,
    pub events: Vec<Value>,
}

#[cfg(test)]
mod tests {
    use super::{
        monitor_delivery_policy_from_notify_config, normalize_monitor_notify_config,
        LocalMonitorTaskCreateRequest, MonitorDeliveryDetailLevel, MonitorRunEvent,
        MonitorRunEventKind,
    };

    #[test]
    fn create_request_requires_assistant_id_when_deserializing() {
        let error = serde_json::from_value::<LocalMonitorTaskCreateRequest>(serde_json::json!({
            "title": "monitor",
            "objective": "watch this"
        }))
        .expect_err("assistant_id should be required");

        assert!(
            error.to_string().contains("assistant_id"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn normalize_notify_config_injects_default_delivery_policy() {
        let normalized = normalize_monitor_notify_config(&serde_json::json!({
            "channel_ids": ["channel-1"]
        }));

        assert_eq!(
            normalized
                .get("channel_ids")
                .and_then(serde_json::Value::as_array)
                .map(|items| items.len()),
            Some(1)
        );
        let policy = monitor_delivery_policy_from_notify_config(&normalized);
        assert!(policy.notify_on_change);
        assert!(policy.notify_on_failure);
        assert!(policy.heartbeat_enabled);
        assert!(!policy.notify_on_start);
        assert_eq!(policy.detail_level, MonitorDeliveryDetailLevel::Stage);
    }

    #[test]
    fn monitor_run_event_serializes_canonical_kind_names() {
        let event = MonitorRunEvent::new(
            "execution-1".to_string(),
            "task-1".to_string(),
            1,
            MonitorRunEventKind::RunStarted,
        )
        .with_summary("started");

        let value = serde_json::to_value(&event).expect("event should serialize");

        assert_eq!(
            value.get("kind").and_then(serde_json::Value::as_str),
            Some("run_started")
        );
        assert_eq!(
            value
                .get("execution_id")
                .and_then(serde_json::Value::as_str),
            Some("execution-1")
        );
        assert_eq!(
            value.get("task_id").and_then(serde_json::Value::as_str),
            Some("task-1")
        );
        assert_eq!(
            value.get("seq").and_then(serde_json::Value::as_u64),
            Some(1)
        );
        assert_eq!(
            value.get("summary").and_then(serde_json::Value::as_str),
            Some("started")
        );
    }
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
