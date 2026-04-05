use std::collections::HashMap;
use std::sync::Arc;

use mcp_core::types::McpTool;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;
use tokio::task::AbortHandle;

#[derive(Clone, Serialize, Deserialize)]
pub struct PendingToolCall {
    pub tool_id: Option<String>,
    pub tool_name: String,
    pub arguments: Value,
    pub call_id: Option<String>,
    pub execution_token: Option<String>,
    pub session_id: Option<String>,
    pub description: Option<String>,
    pub risk_level: Option<String>,
    pub risk_reasons: Vec<String>,
    pub tool_fingerprint: String,
    pub policy_rule_key: Option<String>,
    pub approval_grant_key: Option<String>,
    pub created_at_unix_ms: i128,
    pub expires_at_unix_ms: i128,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct ToolApprovalContext {
    pub call_id: Option<String>,
    pub execution_token: Option<String>,
    pub session_id: Option<String>,
}

pub const PENDING_TOOL_CALL_TTL_MS: i128 = 5 * 60 * 1000;

#[derive(Clone)]
pub struct McpTransportFacade<Bridge, Gateway> {
    pub cloud_base_url: Arc<RwLock<String>>,
    pub client: reqwest::Client,
    pub bridge: Arc<Bridge>,
    pub local_gateway: Arc<Gateway>,
}

impl<Bridge, Gateway> McpTransportFacade<Bridge, Gateway> {
    pub fn new(cloud_base_url: String, bridge: Bridge, local_gateway: Gateway) -> Self {
        Self {
            cloud_base_url: Arc::new(RwLock::new(cloud_base_url)),
            client: reqwest::Client::new(),
            bridge: Arc::new(bridge),
            local_gateway: Arc::new(local_gateway),
        }
    }
}

#[derive(Clone)]
pub struct McpApprovalFacade<Grant, SuspendedExecution> {
    pub pending_tool_calls: Arc<RwLock<HashMap<String, PendingToolCall>>>,
    pub session_approval_grants: Arc<RwLock<HashMap<String, Grant>>>,
    pub suspended_local_chat_executions: Arc<RwLock<HashMap<String, SuspendedExecution>>>,
    pub local_chat_tasks: Arc<RwLock<HashMap<String, AbortHandle>>>,
}

impl<Grant, SuspendedExecution> Default for McpApprovalFacade<Grant, SuspendedExecution> {
    fn default() -> Self {
        Self {
            pending_tool_calls: Arc::new(RwLock::new(HashMap::new())),
            session_approval_grants: Arc::new(RwLock::new(HashMap::new())),
            suspended_local_chat_executions: Arc::new(RwLock::new(HashMap::new())),
            local_chat_tasks: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

pub fn pending_tool_call_ttl_ms() -> i128 {
    PENDING_TOOL_CALL_TTL_MS
}

pub fn normalize_optional(value: Option<&str>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn now_unix_ms() -> i128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_millis(0))
        .as_millis() as i128
}

pub fn tool_fingerprint(tool: &McpTool) -> String {
    let mut env_pairs: Vec<(String, String)> =
        tool.env.clone().unwrap_or_default().into_iter().collect();
    env_pairs.sort_by(|a, b| a.0.cmp(&b.0));

    let args = tool.args.clone().unwrap_or_default().join("\u{1f}");
    let env_text = env_pairs
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("\u{1e}");
    let remote_identity = [
        tool.remote_server_name().unwrap_or_default(),
        tool.remote_tool_name().unwrap_or_default(),
        tool.remote_sse_url().unwrap_or_default(),
    ]
    .join("\u{1d}");
    let canonical = format!(
        "{}|{}|{}|{}|{}|{}|{}",
        tool.name,
        tool.transport_label(),
        tool.command.clone().unwrap_or_default(),
        args,
        env_text,
        remote_identity,
        tool.config_hash
    );

    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn build_approval_context(
    call_id: Option<&str>,
    execution_token: Option<&str>,
    session_id: Option<&str>,
) -> ToolApprovalContext {
    ToolApprovalContext {
        call_id: normalize_optional(call_id),
        execution_token: normalize_optional(execution_token),
        session_id: normalize_optional(session_id),
    }
}

pub fn build_pending_tool_call(
    tool_id: Option<String>,
    tool_name: String,
    arguments: Value,
    description: Option<String>,
    risk_level: Option<String>,
    risk_reasons: Vec<String>,
    tool_fingerprint: String,
    policy_rule_key: Option<String>,
    approval_grant_key: Option<String>,
    approval_context: ToolApprovalContext,
) -> PendingToolCall {
    let created_at = now_unix_ms();
    PendingToolCall {
        tool_id,
        tool_name,
        arguments,
        call_id: approval_context.call_id,
        execution_token: approval_context.execution_token,
        session_id: approval_context.session_id,
        description,
        risk_level,
        risk_reasons,
        tool_fingerprint,
        policy_rule_key,
        approval_grant_key,
        created_at_unix_ms: created_at,
        expires_at_unix_ms: created_at + pending_tool_call_ttl_ms(),
    }
}
