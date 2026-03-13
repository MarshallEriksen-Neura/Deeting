pub mod bridge;
pub mod commands;
pub mod error;
pub mod gateway;
pub mod local_orchestrator;
pub mod process;
pub mod risk;
pub mod store;
pub mod types;

use std::collections::HashMap;
use std::sync::Arc;

use reqwest::Client;
use serde_json::Value;
use tokio::sync::RwLock;
use tokio::task::AbortHandle;

use crate::modules::mcp::bridge::McpBridgeState;
use crate::modules::mcp::process::ProcessManager;
pub use crate::modules::mcp::risk::{
    assess_mcp_tool_risk, assess_skill_binding_risk, is_high_risk_tool_name,
    ApprovalBoundaryClass, RiskOperationClass, RiskTargetClass, SessionApprovalGrant,
    ToolRiskAssessment,
};
use crate::modules::mcp::store::McpStore;
use crate::modules::mcp::types::McpTool;

#[derive(Clone)]
pub struct PendingToolCall {
    pub tool_id: Option<String>,
    pub tool_name: String,
    pub arguments: Value,
    pub call_id: Option<String>,
    pub execution_token: Option<String>,
    pub tool_fingerprint: String,
    pub approval_grant_key: Option<String>,
    pub created_at_unix_ms: i128,
    pub expires_at_unix_ms: i128,
}

#[derive(Clone)]
pub struct SuspendedLocalChatExecutionEnvelope {
    pub approved_tool_result: Value,
    pub continuation_blocks: Vec<Value>,
    pub response: Option<Value>,
    pub error: Option<String>,
}

#[derive(Clone, Default)]
pub struct ToolApprovalContext {
    pub call_id: Option<String>,
    pub execution_token: Option<String>,
}

const PENDING_TOOL_CALL_TTL_MS: i128 = 5 * 60 * 1000;

fn normalize_optional(value: Option<&str>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn now_unix_ms() -> i128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_millis(0))
        .as_millis() as i128
}

#[derive(Clone)]
pub struct McpRuntimeState {
    pub store: Arc<McpStore>,
    pub process_manager: ProcessManager,
    pub cloud_base_url: Arc<RwLock<String>>,
    pub client: Client,
    pub bridge: Arc<McpBridgeState>,
    pub pending_tool_calls: Arc<RwLock<HashMap<String, PendingToolCall>>>,
    pub(crate) session_approval_grants: Arc<RwLock<HashMap<String, SessionApprovalGrant>>>,
    pub(crate) suspended_local_chat_executions:
        Arc<RwLock<HashMap<String, crate::modules::mcp::commands::runtime::SuspendedLocalChatExecution>>>,
    pub local_chat_tasks: Arc<RwLock<HashMap<String, AbortHandle>>>,
    pub local_gateway: Arc<crate::modules::mcp::gateway::LocalGatewayServer>,
}

impl McpRuntimeState {
    pub fn new(
        store: Arc<McpStore>,
        process_manager: ProcessManager,
        cloud_base_url: String,
    ) -> Self {
        Self {
            store,
            process_manager,
            cloud_base_url: Arc::new(RwLock::new(cloud_base_url.clone())),
            client: Client::new(),
            bridge: Arc::new(McpBridgeState::new(cloud_base_url)),
            pending_tool_calls: Arc::new(RwLock::new(HashMap::new())),
            session_approval_grants: Arc::new(RwLock::new(HashMap::new())),
            suspended_local_chat_executions: Arc::new(RwLock::new(HashMap::new())),
            local_chat_tasks: Arc::new(RwLock::new(HashMap::new())),
            local_gateway: Arc::new(crate::modules::mcp::gateway::LocalGatewayServer::new()),
        }
    }

    pub fn pending_tool_call_ttl_ms(&self) -> i128 {
        PENDING_TOOL_CALL_TTL_MS
    }

    pub fn tool_fingerprint(&self, tool: &McpTool) -> String {
        use sha2::{Digest, Sha256};

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

    pub fn is_high_risk_tool(&self, tool_name: &str) -> bool {
        is_high_risk_tool_name(tool_name)
    }

    pub fn assess_tool_risk(&self, tool: &McpTool, arguments: &Value) -> ToolRiskAssessment {
        assess_mcp_tool_risk(tool, arguments)
    }

    pub fn assess_skill_binding_risk(
        &self,
        binding: &crate::modules::mcp::store::LocalSkillToolBindingSnapshot,
        arguments: &Value,
    ) -> ToolRiskAssessment {
        assess_skill_binding_risk(binding, arguments)
    }

    pub fn build_approval_context(
        &self,
        call_id: Option<&str>,
        execution_token: Option<&str>,
    ) -> ToolApprovalContext {
        ToolApprovalContext {
            call_id: normalize_optional(call_id),
            execution_token: normalize_optional(execution_token),
        }
    }

    pub fn build_pending_tool_call(
        &self,
        tool_id: Option<String>,
        tool_name: String,
        arguments: Value,
        tool_fingerprint: String,
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
            tool_fingerprint,
            approval_grant_key,
            created_at_unix_ms: created_at,
            expires_at_unix_ms: created_at + self.pending_tool_call_ttl_ms(),
        }
    }
}
