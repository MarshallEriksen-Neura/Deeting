use mcp_core::types::McpTool;
use mcp_storage::types::LocalSkillToolBindingSnapshot;
use serde_json::Value;

use crate::modules::mcp::risk::{
    assess_core_tool_risk, assess_mcp_tool_risk, assess_skill_binding_risk,
};
use crate::modules::mcp::{ApprovalBoundaryClass, RiskOperationClass, ToolRiskAssessment};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalDecision {
    Allow,
    RequireApproval,
    Deny,
}

pub fn resolve_approval_decision(
    risk: &ToolRiskAssessment,
    approved_by_session_grant: bool,
) -> ApprovalDecision {
    if risk.risk_level == "CRITICAL"
        && risk.boundary_class == ApprovalBoundaryClass::HardBoundary
        && risk.operation_class == RiskOperationClass::ProcessExec
    {
        ApprovalDecision::Deny
    } else if risk.requires_approval && !approved_by_session_grant {
        ApprovalDecision::RequireApproval
    } else {
        ApprovalDecision::Allow
    }
}

pub enum PolicyTargetRef<'a> {
    CoreTool {
        tool_name: &'a str,
        arguments: &'a Value,
    },
    McpTool {
        tool: &'a McpTool,
        arguments: &'a Value,
    },
    SkillBinding {
        binding: &'a LocalSkillToolBindingSnapshot,
        arguments: &'a Value,
    },
}

pub fn assess_policy_risk(target: PolicyTargetRef<'_>) -> ToolRiskAssessment {
    match target {
        PolicyTargetRef::CoreTool {
            tool_name,
            arguments,
        } => assess_core_tool_risk(tool_name, arguments),
        PolicyTargetRef::McpTool { tool, arguments } => assess_mcp_tool_risk(tool, arguments),
        PolicyTargetRef::SkillBinding { binding, arguments } => {
            assess_skill_binding_risk(binding, arguments)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcp::RiskTargetClass;
    use mcp_core::types::{McpConflictStatus, McpSourceType, McpToolStatus};

    fn high_risk() -> ToolRiskAssessment {
        ToolRiskAssessment {
            requires_approval: true,
            risk_level: "HIGH",
            reasons: vec!["test".to_string()],
            operation_class: RiskOperationClass::ProcessExec,
            target_class: RiskTargetClass::Host,
            boundary_class: ApprovalBoundaryClass::HardBoundary,
        }
    }

    fn critical_process_exec() -> ToolRiskAssessment {
        ToolRiskAssessment {
            requires_approval: true,
            risk_level: "CRITICAL",
            reasons: vec!["critical".to_string()],
            operation_class: RiskOperationClass::ProcessExec,
            target_class: RiskTargetClass::Host,
            boundary_class: ApprovalBoundaryClass::HardBoundary,
        }
    }

    #[test]
    fn resolve_approval_decision_requires_approval_without_grant() {
        let decision = resolve_approval_decision(&high_risk(), false);
        assert_eq!(decision, ApprovalDecision::RequireApproval);
    }

    #[test]
    fn resolve_approval_decision_allows_when_grant_exists() {
        let decision = resolve_approval_decision(&high_risk(), true);
        assert_eq!(decision, ApprovalDecision::Allow);
    }

    #[test]
    fn resolve_approval_decision_denies_critical_process_exec() {
        let decision = resolve_approval_decision(&critical_process_exec(), false);
        assert_eq!(decision, ApprovalDecision::Deny);
    }

    #[test]
    fn assess_policy_risk_uses_core_tool_mapping() {
        let risk = assess_policy_risk(PolicyTargetRef::CoreTool {
            tool_name: "browser_open_tab",
            arguments: &serde_json::json!({"url":"https://example.com"}),
        });
        assert!(risk.requires_approval);
        assert_eq!(risk.operation_class, RiskOperationClass::NetworkRead);
    }

    #[test]
    fn assess_policy_risk_uses_mcp_tool_mapping() {
        let tool = McpTool {
            id: "tool-policy-1".to_string(),
            identifier: None,
            name: "fetch_docs".to_string(),
            source_type: McpSourceType::Cloud,
            source_id: Some("remote".to_string()),
            status: McpToolStatus::Healthy,
            ping_ms: None,
            capabilities: vec!["network".to_string()],
            description: "Fetch docs".to_string(),
            error: None,
            command: None,
            args: None,
            env: None,
            pending_config_json: None,
            config_json: "{}".to_string(),
            config_hash: "hash".to_string(),
            pending_config_hash: None,
            conflict_status: McpConflictStatus::None,
            is_read_only: true,
            is_new: false,
            created_at: "2026-03-26T00:00:00Z".to_string(),
            updated_at: "2026-03-26T00:00:00Z".to_string(),
        };
        let risk = assess_policy_risk(PolicyTargetRef::McpTool {
            tool: &tool,
            arguments: &serde_json::json!({"url":"https://example.com"}),
        });
        assert!(risk.requires_approval);
    }
}
