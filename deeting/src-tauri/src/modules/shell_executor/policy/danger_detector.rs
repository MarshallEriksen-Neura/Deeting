//! 危险模式检测器

use super::{CommandPolicyChecker, CommandPolicy, ApprovalLevel};
use crate::modules::shell_executor::config::PolicyConfig;

/// 危险模式检测器
pub struct DangerDetector {
    dangerous_patterns: Vec<String>,
}

impl DangerDetector {
    pub fn new(config: &PolicyConfig) -> Self {
        Self {
            dangerous_patterns: config.dangerous_patterns.clone(),
        }
    }
    
    /// 检测命令是否包含危险模式
    pub fn detect_danger(&self, command: &str) -> Option<(String, ApprovalLevel)> {
        let command_lower = command.to_lowercase();
        
        // 极度危险的命令 (直接拒绝)
        let critical_patterns = [
            "rm -rf /",
            "rm -rf /*",
            "mkfs",
            "dd if=/dev/zero",
            ":(){ :|:& };:",  // Fork bomb
        ];
        
        for pattern in &critical_patterns {
            if command_lower.contains(pattern) {
                return Some((
                    format!("Critical danger detected: '{}'", pattern),
                    ApprovalLevel::Dangerous,
                ));
            }
        }
        
        // 配置的危险模式
        for pattern in &self.dangerous_patterns {
            if command_lower.contains(&pattern.to_lowercase()) {
                return Some((
                    format!("Dangerous pattern detected: '{}'", pattern),
                    ApprovalLevel::Dangerous,
                ));
            }
        }
        
        None
    }
}

impl CommandPolicyChecker for DangerDetector {
    fn check(&self, command: &str) -> CommandPolicy {
        if let Some((message, level)) = self.detect_danger(command) {
            CommandPolicy::RequiresApproval(level, message)
        } else {
            CommandPolicy::Allowed
        }
    }
}
