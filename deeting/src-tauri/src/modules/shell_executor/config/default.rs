//! 默认配置

use super::ShellExecutorConfig;

/// 生成默认配置
pub fn default_config() -> ShellExecutorConfig {
    ShellExecutorConfig {
        executor: super::types::ExecutorConfig::default(),
        policy: super::types::PolicyConfig::default(),
        path_restrictions: super::types::PathRestrictionsConfig::default(),
        approval: super::types::ApprovalConfig::default(),
        audit: super::types::AuditConfig::default(),
    }
}
