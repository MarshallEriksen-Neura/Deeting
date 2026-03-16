//! 白名单检查器

use super::{CommandPolicyChecker, CommandPolicy};
use crate::modules::shell_executor::config::PolicyConfig;

/// 白名单检查器
pub struct WhitelistChecker {
    whitelist: Vec<String>,
}

impl WhitelistChecker {
    pub fn new(config: &PolicyConfig) -> Self {
        Self {
            whitelist: config.whitelist.clone(),
        }
    }
    
    /// 检查命令是否在白名单中
    pub fn is_whitelisted(&self, command: &str) -> bool {
        let command_lower = command.to_lowercase().trim().to_string();
        
        self.whitelist.iter().any(|pattern| {
            let pattern_lower = pattern.to_lowercase().trim().to_string();
            
            // 完全匹配
            if command_lower == pattern_lower {
                return true;
            }
            
            // 前缀匹配 (例如: "git status" 匹配 "git")
            if command_lower.starts_with(&format!("{} ", pattern_lower)) {
                return true;
            }
            
            false
        })
    }
}

impl CommandPolicyChecker for WhitelistChecker {
    fn check(&self, command: &str) -> CommandPolicy {
        if self.is_whitelisted(command) {
            CommandPolicy::Allowed
        } else {
            // 白名单检查器不拒绝,只是不匹配
            CommandPolicy::RequiresApproval(
                super::ApprovalLevel::Standard,
                "Command not in whitelist".to_string(),
            )
        }
    }
}
