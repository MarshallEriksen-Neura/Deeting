//! 黑名单检查器

use super::{CommandPolicyChecker, CommandPolicy};
use crate::modules::shell_executor::config::PolicyConfig;

/// 黑名单检查器
pub struct BlacklistChecker {
    blacklist_patterns: Vec<String>,
}

impl BlacklistChecker {
    pub fn new(config: &PolicyConfig) -> Self {
        Self {
            blacklist_patterns: config.blacklist_patterns.clone(),
        }
    }
    
    /// 检查命令是否在黑名单中
    pub fn is_blacklisted(&self, command: &str) -> Option<String> {
        let command_lower = command.to_lowercase();
        
        for pattern in &self.blacklist_patterns {
            let pattern_lower = pattern.to_lowercase();
            
            // 子串匹配
            if command_lower.contains(&pattern_lower) {
                return Some(format!(
                    "Command matches blacklisted pattern: '{}'",
                    pattern
                ));
            }
        }
        
        None
    }
}

impl CommandPolicyChecker for BlacklistChecker {
    fn check(&self, command: &str) -> CommandPolicy {
        if let Some(reason) = self.is_blacklisted(command) {
            CommandPolicy::Denied(reason)
        } else {
            // 黑名单检查器不自动允许,只是不拒绝
            CommandPolicy::Allowed
        }
    }
}
