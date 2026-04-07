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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalPolicyLevel {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PersistedApprovalAction {
    AllowOnce,
    AllowAlways,
    DenyAlways,
}

impl PersistedApprovalAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AllowOnce => "allow_once",
            Self::AllowAlways => "allow_always",
            Self::DenyAlways => "deny_always",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "allow_once" => Some(Self::AllowOnce),
            "allow_always" => Some(Self::AllowAlways),
            "deny_always" => Some(Self::DenyAlways),
            _ => None,
        }
    }
}

pub fn resolve_approval_decision(
    risk: &ToolRiskAssessment,
    approved_by_session_grant: bool,
    policy_level: ApprovalPolicyLevel,
    persisted_action: Option<PersistedApprovalAction>,
) -> ApprovalDecision {
    if matches!(persisted_action, Some(PersistedApprovalAction::DenyAlways)) {
        ApprovalDecision::Deny
    } else if matches!(persisted_action, Some(PersistedApprovalAction::AllowAlways))
        && policy_level != ApprovalPolicyLevel::High
    {
        ApprovalDecision::Allow
    } else if risk.risk_level == "CRITICAL"
        && risk.boundary_class == ApprovalBoundaryClass::HardBoundary
        && risk.operation_class == RiskOperationClass::ProcessExec
    {
        match policy_level {
            ApprovalPolicyLevel::Low => ApprovalDecision::Allow,
            ApprovalPolicyLevel::High | ApprovalPolicyLevel::Medium => ApprovalDecision::Deny,
        }
    } else {
        match policy_level {
            ApprovalPolicyLevel::Low => ApprovalDecision::Allow,
            ApprovalPolicyLevel::High => {
                if risk.requires_approval {
                    ApprovalDecision::RequireApproval
                } else {
                    ApprovalDecision::Allow
                }
            }
            ApprovalPolicyLevel::Medium => {
                if risk.requires_approval && !approved_by_session_grant {
                    ApprovalDecision::RequireApproval
                } else {
                    ApprovalDecision::Allow
                }
            }
        }
    }
}

pub fn calculate_medium_rule_confidence(
    last_approved_at_unix_ms: Option<i64>,
    half_life_days: i64,
    now_unix_ms: i64,
) -> f32 {
    let Some(last_approved_at_unix_ms) = last_approved_at_unix_ms else {
        return 0.0;
    };
    let age_days =
        ((now_unix_ms - last_approved_at_unix_ms).max(0) as f32) / (24.0 * 60.0 * 60.0 * 1000.0);
    if age_days <= 3.0 {
        1.0
    } else {
        let half_life = half_life_days.max(1) as f32;
        2_f32.powf(-((age_days - 3.0) / half_life))
    }
}

pub fn should_auto_promote_medium_rule(
    approve_count: i64,
    reject_count: i64,
    created_at_unix_ms: i64,
    last_rejected_at_unix_ms: Option<i64>,
    now_unix_ms: i64,
) -> bool {
    let window_ms = 7_i64 * 24 * 60 * 60 * 1000;
    approve_count >= 3
        && reject_count == 0
        && now_unix_ms.saturating_sub(created_at_unix_ms) <= window_ms
        && last_rejected_at_unix_ms.is_none()
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
        let decision =
            resolve_approval_decision(&high_risk(), false, ApprovalPolicyLevel::Medium, None);
        assert_eq!(decision, ApprovalDecision::RequireApproval);
    }

    #[test]
    fn resolve_approval_decision_allows_when_grant_exists() {
        let decision =
            resolve_approval_decision(&high_risk(), true, ApprovalPolicyLevel::Medium, None);
        assert_eq!(decision, ApprovalDecision::Allow);
    }

    #[test]
    fn resolve_approval_decision_denies_critical_process_exec() {
        let decision = resolve_approval_decision(
            &critical_process_exec(),
            false,
            ApprovalPolicyLevel::Medium,
            None,
        );
        assert_eq!(decision, ApprovalDecision::Deny);
    }

    #[test]
    fn resolve_approval_decision_high_ignores_session_grant() {
        let decision =
            resolve_approval_decision(&high_risk(), true, ApprovalPolicyLevel::High, None);
        assert_eq!(decision, ApprovalDecision::RequireApproval);
    }

    #[test]
    fn resolve_approval_decision_low_overrides_risk_gate() {
        let decision = resolve_approval_decision(
            &critical_process_exec(),
            false,
            ApprovalPolicyLevel::Low,
            None,
        );
        assert_eq!(decision, ApprovalDecision::Allow);
    }

    #[test]
    fn resolve_approval_decision_persisted_allow_overrides_medium() {
        let decision = resolve_approval_decision(
            &critical_process_exec(),
            false,
            ApprovalPolicyLevel::Medium,
            Some(PersistedApprovalAction::AllowAlways),
        );
        assert_eq!(decision, ApprovalDecision::Allow);
    }

    #[test]
    fn resolve_approval_decision_persisted_deny_wins() {
        let decision = resolve_approval_decision(
            &high_risk(),
            true,
            ApprovalPolicyLevel::Low,
            Some(PersistedApprovalAction::DenyAlways),
        );
        assert_eq!(decision, ApprovalDecision::Deny);
    }

    #[test]
    fn calculate_medium_rule_confidence_keeps_recent_rules_strong() {
        let now = 10_i64 * 24 * 60 * 60 * 1000;
        let recent =
            calculate_medium_rule_confidence(Some(now - 2_i64 * 24 * 60 * 60 * 1000), 7, now);
        assert!((recent - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn calculate_medium_rule_confidence_decays_after_strong_window() {
        let now = 20_i64 * 24 * 60 * 60 * 1000;
        let decayed =
            calculate_medium_rule_confidence(Some(now - 10_i64 * 24 * 60 * 60 * 1000), 7, now);
        assert!(decayed < 1.0);
        assert!(decayed > 0.0);
    }

    #[test]
    fn should_auto_promote_medium_rule_requires_repeat_approval_without_rejection() {
        let now = 5_i64 * 24 * 60 * 60 * 1000;
        assert!(should_auto_promote_medium_rule(3, 0, 0, None, now));
        assert!(!should_auto_promote_medium_rule(2, 0, 0, None, now));
        assert!(!should_auto_promote_medium_rule(3, 1, 0, None, now));
        assert!(!should_auto_promote_medium_rule(3, 0, 0, Some(1), now));
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
