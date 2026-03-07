pub mod bridge;
pub mod commands;
pub mod error;
pub mod gateway;
pub mod local_orchestrator;
pub mod process;
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
use crate::modules::mcp::store::McpStore;
use crate::modules::mcp::types::{McpSourceType, McpTool};

#[derive(Clone)]
pub struct PendingToolCall {
    pub tool_name: String,
    pub arguments: Value,
    pub call_id: Option<String>,
    pub execution_token: Option<String>,
    pub tool_fingerprint: String,
    pub created_at_unix_ms: i128,
    pub expires_at_unix_ms: i128,
}

#[derive(Clone, Default)]
pub struct ToolApprovalContext {
    pub call_id: Option<String>,
    pub execution_token: Option<String>,
}

#[derive(Clone)]
pub struct ToolRiskAssessment {
    pub requires_approval: bool,
    pub risk_level: &'static str,
    pub reasons: Vec<String>,
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
        let canonical = format!(
            "{}|{}|{}|{}|{}",
            tool.name,
            tool.command.clone().unwrap_or_default(),
            args,
            env_text,
            tool.config_hash
        );

        let mut hasher = Sha256::new();
        hasher.update(canonical.as_bytes());
        hex::encode(hasher.finalize())
    }

    pub fn is_high_risk_tool(&self, tool_name: &str) -> bool {
        let name = tool_name.to_lowercase();
        name.contains("delete")
            || name.contains("remove")
            || name.contains("write")
            || name.contains("shell")
            || name.contains("execute")
            || name.contains("update")
            || name.contains("terminal")
    }

    pub fn assess_tool_risk(&self, tool: &McpTool, arguments: &Value) -> ToolRiskAssessment {
        let mut score = 0_i32;
        let mut reasons = Vec::new();

        if tool.command.is_some() {
            // Any host command execution is a privileged action by default.
            score += 3;
            reasons.push("tool executes local host command".to_string());
        }

        if !matches!(tool.source_type, McpSourceType::Local) {
            score += 2;
            reasons.push(format!("tool source is {}", tool.source_type.as_str()));
        }

        let command = tool.command.clone().unwrap_or_default().to_lowercase();
        let args_text = tool
            .args
            .clone()
            .unwrap_or_default()
            .join(" ")
            .to_lowercase();
        let argument_json = arguments.to_string().to_lowercase();

        let dangerous_keywords = [
            "powershell",
            "pwsh",
            "cmd.exe",
            "wscript",
            "cscript",
            "rundll32",
            "mshta",
            "bash",
            "sh ",
            " rm ",
            " del ",
            " rmdir ",
            " format ",
            " diskpart",
            " reg delete",
            "shutdown",
            "reboot",
        ];

        if dangerous_keywords.iter().any(|k| command.contains(k))
            || dangerous_keywords.iter().any(|k| args_text.contains(k))
            || dangerous_keywords.iter().any(|k| argument_json.contains(k))
            || self.is_high_risk_tool(&tool.name)
        {
            score += 3;
            reasons.push("command/args contain destructive or shell-like indicators".to_string());
        }

        let capabilities = tool
            .capabilities
            .iter()
            .map(|c| c.to_lowercase())
            .collect::<Vec<_>>();
        if capabilities.iter().any(|c| {
            c.contains("shell")
                || c.contains("terminal")
                || c.contains("write")
                || c.contains("network")
                || c.contains("filesystem")
        }) {
            score += 1;
            reasons.push("tool capabilities include privileged operations".to_string());
        }

        let (risk_level, requires_approval) = if score >= 3 {
            ("HIGH", true)
        } else if score >= 2 {
            ("MEDIUM", true)
        } else {
            ("LOW", false)
        };

        ToolRiskAssessment {
            requires_approval,
            risk_level,
            reasons,
        }
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
        tool_name: String,
        arguments: Value,
        tool_fingerprint: String,
        approval_context: ToolApprovalContext,
    ) -> PendingToolCall {
        let created_at = now_unix_ms();
        PendingToolCall {
            tool_name,
            arguments,
            call_id: approval_context.call_id,
            execution_token: approval_context.execution_token,
            tool_fingerprint,
            created_at_unix_ms: created_at,
            expires_at_unix_ms: created_at + self.pending_tool_call_ttl_ms(),
        }
    }
}
