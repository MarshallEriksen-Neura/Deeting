//! 命令策略检查器 Trait 定义

use serde::{Deserialize, Serialize};

/// 命令策略
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CommandPolicy {
    /// 允许执行
    Allowed,

    /// 需要用户确认
    RequiresApproval(ApprovalLevel, String),

    /// 拒绝执行
    Denied(String),
}

/// 确认级别
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ApprovalLevel {
    /// 标准确认
    Standard,

    /// 危险操作确认
    Dangerous,
}

/// 命令策略检查器 Trait
pub trait CommandPolicyChecker: Send + Sync {
    /// 检查命令策略
    fn check(&self, command: &str) -> CommandPolicy;

    /// 检查命令是否在白名单中 (可选实现)
    fn is_allowed(&self, _command: &str) -> bool {
        matches!(self.check(_command), CommandPolicy::Allowed)
    }

    /// 检查命令是否在黑名单中 (可选实现)
    fn is_denied(&self, _command: &str) -> Option<String> {
        match self.check(_command) {
            CommandPolicy::Denied(reason) => Some(reason),
            _ => None,
        }
    }

    /// 检查命令是否危险 (可选实现)
    fn is_dangerous(&self, _command: &str) -> bool {
        matches!(
            self.check(_command),
            CommandPolicy::RequiresApproval(ApprovalLevel::Dangerous, _)
        )
    }
}
