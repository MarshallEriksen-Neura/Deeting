pub mod bridge;
pub mod commands;
pub(crate) mod compat;
pub mod error;
pub mod process;
pub mod risk;
pub mod store;
pub mod types;

use std::sync::Arc;

use mcp_storage::types::LocalSkillToolBindingSnapshot;
use serde_json::Value;

use crate::modules::mcp::bridge::McpBridgeState;
use crate::modules::mcp::process::ProcessManager;
pub use crate::modules::mcp::risk::{
    assess_mcp_tool_risk, assess_skill_binding_risk, is_high_risk_tool_name, ApprovalBoundaryClass,
    RiskOperationClass, RiskTargetClass, SessionApprovalGrant, ToolRiskAssessment,
};
use crate::modules::mcp::store::McpStore;
use mcp_core::types::McpTool;
pub use mcp_facade::runtime::{
    build_approval_context as facade_build_approval_context,
    build_pending_tool_call as facade_build_pending_tool_call,
    pending_tool_call_ttl_ms as facade_pending_tool_call_ttl_ms,
    tool_fingerprint as facade_tool_fingerprint, McpApprovalFacade, McpTransportFacade,
    PendingToolCall, ToolApprovalContext,
};

#[derive(Clone)]
pub struct SuspendedLocalChatExecutionEnvelope {
    pub approved_tool_result: Value,
    pub continuation_blocks: Vec<Value>,
    pub response: Option<Value>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct McpRuntimeState {
    pub store: Arc<McpStore>,
    pub process_manager: ProcessManager,
    pub transport: McpTransportFacade<
        McpBridgeState,
        crate::modules::desktop_runtime::local_gateway::LocalGatewayServer,
    >,
    pub(crate) approvals: McpApprovalFacade<
        SessionApprovalGrant,
        crate::modules::desktop_runtime::runtime::SuspendedLocalChatExecution,
    >,
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
            transport: McpTransportFacade::new(
                cloud_base_url.clone(),
                McpBridgeState::new(cloud_base_url),
                crate::modules::desktop_runtime::local_gateway::LocalGatewayServer::new(),
            ),
            approvals: McpApprovalFacade::default(),
        }
    }

    pub fn pending_tool_call_ttl_ms(&self) -> i128 {
        facade_pending_tool_call_ttl_ms()
    }

    pub fn tool_fingerprint(&self, tool: &McpTool) -> String {
        facade_tool_fingerprint(tool)
    }

    pub fn is_high_risk_tool(&self, tool_name: &str) -> bool {
        is_high_risk_tool_name(tool_name)
    }

    pub fn assess_tool_risk(&self, tool: &McpTool, arguments: &Value) -> ToolRiskAssessment {
        assess_mcp_tool_risk(tool, arguments)
    }

    pub fn assess_skill_binding_risk(
        &self,
        binding: &LocalSkillToolBindingSnapshot,
        arguments: &Value,
    ) -> ToolRiskAssessment {
        assess_skill_binding_risk(binding, arguments)
    }

    pub fn build_approval_context(
        &self,
        call_id: Option<&str>,
        execution_token: Option<&str>,
        session_id: Option<&str>,
    ) -> ToolApprovalContext {
        facade_build_approval_context(call_id, execution_token, session_id)
    }

    pub fn build_pending_tool_call(
        &self,
        tool_id: Option<String>,
        tool_name: String,
        arguments: Value,
        description: Option<String>,
        risk_level: Option<String>,
        risk_reasons: Vec<String>,
        tool_fingerprint: String,
        approval_grant_key: Option<String>,
        approval_context: ToolApprovalContext,
    ) -> PendingToolCall {
        facade_build_pending_tool_call(
            tool_id,
            tool_name,
            arguments,
            description,
            risk_level,
            risk_reasons,
            tool_fingerprint,
            approval_grant_key,
            approval_context,
        )
    }
}
