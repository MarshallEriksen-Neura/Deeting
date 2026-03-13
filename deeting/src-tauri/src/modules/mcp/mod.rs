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
    pub tool_id: Option<String>,
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

        if tool.is_remote_sse() {
            score += 1;
            reasons.push("tool calls a remote MCP server".to_string());
        } else if tool.supports_local_process_lifecycle() {
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

    pub fn assess_skill_binding_risk(
        &self,
        binding: &crate::modules::mcp::store::LocalSkillToolBindingSnapshot,
        arguments: &Value,
    ) -> ToolRiskAssessment {
        let mut score = 0_i32;
        let mut reasons = Vec::new();

        // Base score for skill binding execution
        score += 1;
        reasons.push("skill binding executes local runtime".to_string());

        // === Binding Kind Risk ===
        match binding.binding_kind.as_str() {
            "script_runner" => {
                score += 1;
                reasons.push("auto-generated from scripts/ directory".to_string());
            }
            "deeting_tool" => {
                // Official tools have lower base risk
            }
            other => {
                score += 1;
                reasons.push(format!("binding kind: {}", other));
            }
        }

        // === Runtime Risk ===
        let runtime = binding.runtime.to_lowercase();
        match runtime.as_str() {
            "bash" => {
                score += 3;
                reasons.push("bash runtime has full shell access".to_string());
            }
            "python" => {
                score += 2;
                reasons.push("python runtime can access filesystem/network".to_string());
            }
            "node" => {
                score += 2;
                reasons.push("node runtime can access filesystem/network".to_string());
            }
            _ => {
                score += 1;
                reasons.push(format!("unknown runtime: {}", runtime));
            }
        }

        // === Argument Risk Detection ===
        let arg_str = arguments.to_string().to_lowercase();

        // Critical keywords (immediate high risk)
        let critical_keywords = [
            "rm -rf",
            "rm -fr",
            "del /",
            "format ",
            "dd if=",
            "mkfs",
            "fdisk",
            "> /dev/",
            "curl | bash",
            "curl | sh",
            "wget |",
            "eval (",
            "exec (",
            "/bin/sh -c",
            "/bin/bash -c",
        ];
        for kw in critical_keywords {
            if arg_str.contains(kw) {
                score += 3;
                reasons.push(format!("critical keyword detected: {}", kw));
            }
        }

        // Warning keywords (medium risk)
        let warning_keywords = [
            "powershell",
            "pwsh",
            "cmd.exe",
            "wscript",
            "cscript",
            "rundll32",
            "mshta",
            "shutdown",
            "reboot",
            "sudo ",
            "chmod 777",
            "chown ",
            ">/etc/",
            ">/root/",
            ">/home/",
        ];
        for kw in warning_keywords {
            if arg_str.contains(kw) {
                score += 2;
                reasons.push(format!("warning keyword detected: {}", kw));
            }
        }

        // === Path Sensitivity Check ===
        if let Some(path) = arguments.get("path").and_then(Value::as_str) {
            let sensitive_paths = ["/etc", "/root", "/home", "/usr", "/bin", "/sbin", "/boot"];
            for sensitive in sensitive_paths {
                if path.starts_with(sensitive) {
                    score += 2;
                    reasons.push(format!("access to sensitive path: {}", sensitive));
                    break;
                }
            }
        }

        // === Network Risk Check ===
        if let Some(url) = arguments.get("url").and_then(Value::as_str) {
            if url.starts_with("http://") {
                score += 1;
                reasons.push("network request over insecure HTTP".to_string());
            }
            if url.contains("localhost") || url.contains("127.0.0.1") {
                score += 1;
                reasons.push("network request to local endpoint".to_string());
            }
        }

        // === High-Risk Tool Name Check ===
        if self.is_high_risk_tool(&binding.tool_name) {
            score += 2;
            reasons.push("tool name matches high-risk pattern".to_string());
        }

        // === Risk Level Determination ===
        let (risk_level, requires_approval) = if score >= 6 {
            ("CRITICAL", true)
        } else if score >= 4 {
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
        tool_id: Option<String>,
        tool_name: String,
        arguments: Value,
        tool_fingerprint: String,
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
            created_at_unix_ms: created_at,
            expires_at_unix_ms: created_at + self.pending_tool_call_ttl_ms(),
        }
    }
}
