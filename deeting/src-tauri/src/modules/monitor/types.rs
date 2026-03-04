use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
pub struct MonitorWorkerStartRequest {
    pub access_token: String,
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

#[derive(Debug, Clone, Deserialize)]
pub struct MonitorLocalTaskPayload {
    pub task_id: String,
    pub title: String,
    pub objective: String,
    pub cron_expr: String,
    pub model_id: Option<String>,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub last_snapshot: Value,
    #[serde(default)]
    pub notify_config: Value,
    pub execution_target: String,
    pub claimed_until: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MonitorLocalPullResponse {
    #[serde(default)]
    pub items: Vec<MonitorLocalTaskPayload>,
    #[serde(default)]
    pub claimed: i64,
    pub server_time: Option<String>,
}
