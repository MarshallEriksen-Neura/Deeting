use super::config::ExecutionConfig;
use super::types::ExecutionRequest;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApprovalLevel {
    Standard,
    Dangerous,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionPolicyDecision {
    Allowed,
    RequiresApproval(ApprovalLevel, String),
    Denied(String),
}

#[derive(Debug, Clone)]
pub struct ExecutionPolicy {
    auto_approve_exact_commands: Vec<String>,
    denied_patterns: Vec<String>,
    dangerous_patterns: Vec<String>,
}

impl ExecutionPolicy {
    pub fn new(config: &ExecutionConfig) -> Self {
        Self {
            auto_approve_exact_commands: config
                .auto_approve_exact_commands
                .iter()
                .map(|value| normalize(value))
                .collect(),
            denied_patterns: config
                .denied_patterns
                .iter()
                .map(|value| normalize(value))
                .collect(),
            dangerous_patterns: config
                .dangerous_patterns
                .iter()
                .map(|value| normalize(value))
                .collect(),
        }
    }

    pub fn check(&self, request: &ExecutionRequest) -> ExecutionPolicyDecision {
        let label = normalize(&request.command_label());
        if label.is_empty() {
            return ExecutionPolicyDecision::Denied(
                "execution request is missing command, program, or script".to_string(),
            );
        }

        if let Some(pattern) = self
            .denied_patterns
            .iter()
            .find(|pattern| label.contains(pattern.as_str()))
        {
            return ExecutionPolicyDecision::Denied(format!(
                "command matches denied pattern: {pattern}"
            ));
        }

        if let Some(pattern) = self
            .dangerous_patterns
            .iter()
            .find(|pattern| label.contains(pattern.as_str()))
        {
            return ExecutionPolicyDecision::RequiresApproval(
                ApprovalLevel::Dangerous,
                format!("command matches dangerous pattern: {pattern}"),
            );
        }

        if self
            .auto_approve_exact_commands
            .iter()
            .any(|entry| entry == &label)
        {
            return ExecutionPolicyDecision::Allowed;
        }

        ExecutionPolicyDecision::RequiresApproval(
            ApprovalLevel::Standard,
            "command requires user approval".to_string(),
        )
    }
}

fn normalize(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}
