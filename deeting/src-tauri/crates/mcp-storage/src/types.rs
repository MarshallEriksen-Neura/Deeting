use std::collections::HashMap;

use mcp_core::types::{
    McpConflictStatus, McpSourceStatus, McpSourceType, McpToolStatus, McpTrustLevel,
};

#[derive(Debug, Clone)]
pub struct LocalConversationSummaryJob {
    pub id: String,
    pub session_id: String,
    pub attempts: i64,
    pub max_attempts: i64,
}

#[derive(Debug, Clone)]
pub struct LocalPeriodicTask {
    pub task_name: String,
    pub interval_seconds: i64,
}

#[derive(Debug, Clone)]
pub struct LocalSkillInstallSnapshot {
    pub skill_id: String,
    pub installed_version: Option<String>,
    pub is_enabled: bool,
    pub runtime: Option<String>,
    pub install_path: String,
}

#[derive(Debug, Clone)]
pub struct LocalSkillInstallDetail {
    pub skill_id: String,
    pub installed_version: Option<String>,
    pub is_enabled: bool,
    pub runtime: Option<String>,
    pub install_path: String,
    pub manifest_json: String,
    pub user_settings_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct LocalSkillToolBindingSnapshot {
    pub binding_id: String,
    pub binding_kind: String,
    pub skill_id: String,
    pub callable_name: String,
    pub tool_name: String,
    pub description: String,
    pub input_schema: Option<serde_json::Value>,
    pub output_schema: Option<serde_json::Value>,
    pub entry_path: String,
    pub runtime: String,
    pub timeout_seconds: u64,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct LocalSkillToolBindingUpsert {
    pub binding_id: String,
    pub binding_kind: String,
    pub callable_name: String,
    pub tool_name: String,
    pub description: String,
    pub input_schema_json: Option<String>,
    pub output_schema_json: Option<String>,
    pub entry_path: String,
    pub runtime: String,
    pub timeout_seconds: u64,
}

pub struct NewSource {
    pub name: String,
    pub source_type: McpSourceType,
    pub path_or_url: String,
    pub trust_level: McpTrustLevel,
    pub status: McpSourceStatus,
    pub last_synced_at: Option<String>,
    pub is_read_only: bool,
}

#[derive(Clone)]
pub struct ToolUpsert {
    pub id: Option<String>,
    pub source_id: String,
    pub identifier: Option<String>,
    pub name: String,
    pub source_type: McpSourceType,
    pub status: McpToolStatus,
    pub ping_ms: Option<i64>,
    pub capabilities: Vec<String>,
    pub description: String,
    pub error: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub config_json: String,
    pub config_hash: String,
    pub pending_config_json: Option<String>,
    pub pending_config_hash: Option<String>,
    pub conflict_status: McpConflictStatus,
    pub is_read_only: bool,
    pub is_new: bool,
}

pub struct ExtractedToolFields {
    pub name: String,
    pub description: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub capabilities: Vec<String>,
}
