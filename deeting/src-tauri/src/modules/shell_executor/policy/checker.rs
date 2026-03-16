//! 默认策略检查器 - 组合所有检查器

use super::{CommandPolicyChecker, CommandPolicy, WhitelistChecker, BlacklistChecker, DangerDetector};
use crate::modules::shell_executor::config::PolicyConfig;

/// 默认策略检查器
/// 
/// 按顺序执行检查:
/// 1. 黑名单检查 -> 如果匹配则直接拒绝
/// 2. 危险模式检测 -> 如果匹配则要求危险确认
/// 3. 白名单检查 -> 如果匹配则自动允许
/// 4. 其他 -> 要求标准确认
pub struct DefaultPolicyChecker {
    blacklist: BlacklistChecker,
    danger_detector: DangerDetector,
    whitelist: WhitelistChecker,
}

impl DefaultPolicyChecker {
    pub fn new(config: &PolicyConfig) -> Self {
        Self {
            blacklist: BlacklistChecker::new(config),
            danger_detector: DangerDetector::new(config),
            whitelist: WhitelistChecker::new(config),
        }
    }
}

impl CommandPolicyChecker for DefaultPolicyChecker {
    fn check(&self, command: &str) -> CommandPolicy {
        // 1. 黑名单检查 (最高优先级)
        match self.blacklist.check(command) {
            CommandPolicy::Denied(reason) => return CommandPolicy::Denied(reason),
            _ => {}
        }
        
        // 2. 危险模式检测
        match self.danger_detector.check(command) {
            CommandPolicy::RequiresApproval(level, message) => {
                return CommandPolicy::RequiresApproval(level, message);
            }
            _ => {}
        }
        
        // 3. 白名单检查
        if self.whitelist.is_whitelisted(command) {
            return CommandPolicy::Allowed;
        }
        
        // 4. 默认: 要求标准确认
        CommandPolicy::RequiresApproval(
            super::ApprovalLevel::Standard,
            "Command requires user approval".to_string(),
        )
    }
}
