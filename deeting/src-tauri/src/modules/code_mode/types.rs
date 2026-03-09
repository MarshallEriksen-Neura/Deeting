use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::modules::sandbox::types::SandboxRuntimeMode;

#[derive(Debug, Clone, Deserialize)]
pub struct ExecuteLocalCodeModeRequest {
    pub code: String,
    pub session_id: Option<String>,
    pub language: Option<String>,
    pub execution_timeout: Option<u64>,
    pub dry_run: Option<bool>,
    pub context: Option<Value>,
    pub max_calls: Option<i64>,
    pub allowed_tools: Option<Vec<String>>,
    pub capability_snapshot: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeToolCall {
    pub index: Option<i64>,
    pub tool_name: Option<String>,
    pub arguments: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RuntimeToolCallsEnvelope {
    pub calls: Vec<RuntimeToolCall>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeModeExecutionItem {
    pub id: String,
    pub execution_id: String,
    pub session_id: String,
    pub language: String,
    pub status: String,
    pub error: Option<String>,
    pub error_code: Option<String>,
    pub runtime_mode: Option<SandboxRuntimeMode>,
    pub duration_ms: i64,
    pub tool_call_count: i64,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeModeExecutionPage {
    pub items: Vec<CodeModeExecutionItem>,
    pub next_page: Option<String>,
    pub previous_page: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeModeExecutionDetail {
    pub id: String,
    pub execution_id: String,
    pub user_id: String,
    pub session_id: String,
    pub trace_id: Option<String>,
    pub language: String,
    pub status: String,
    pub format_version: Option<String>,
    pub runtime_protocol_version: Option<String>,
    pub runtime_context: Value,
    pub tool_plan_results: Value,
    pub runtime_tool_calls: RuntimeToolCallsEnvelope,
    pub render_blocks: Value,
    pub error: Option<String>,
    pub error_code: Option<String>,
    pub runtime_mode: Option<SandboxRuntimeMode>,
    pub duration_ms: i64,
    pub request_meta: Value,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListCodeModeExecutionsQuery {
    pub cursor: Option<String>,
    pub size: Option<i64>,
    pub status: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReplayLocalCodeModeRequest {
    pub code: Option<String>,
    pub session_id: Option<String>,
    pub language: Option<String>,
    pub execution_timeout: Option<u64>,
    pub dry_run: Option<bool>,
    pub tool_plan: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteLocalCodeModeResponse {
    pub success: bool,
    pub status: String,
    pub format_version: String,
    pub runtime_protocol_version: String,
    pub session_id: String,
    pub bridge_endpoint: String,
    pub exit_code: i32,
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
    pub result: Vec<String>,
    pub runtime_tool_calls: Vec<RuntimeToolCall>,
    pub render_blocks: Vec<Value>,
    pub error: Option<String>,
    pub error_code: Option<String>,
    pub runtime_mode: SandboxRuntimeMode,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplayLocalCodeModeResponse {
    pub replay_of: String,
    pub source_execution_id: String,
    pub result: ExecuteLocalCodeModeResponse,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalCodeModeBridgeStatus {
    pub running: bool,
    pub base_url: Option<String>,
}
