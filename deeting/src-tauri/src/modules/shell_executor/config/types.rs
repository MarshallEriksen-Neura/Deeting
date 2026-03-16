//! 配置类型定义

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Shell Executor 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellExecutorConfig {
    pub executor: ExecutorConfig,
    pub policy: PolicyConfig,
    pub path_restrictions: PathRestrictionsConfig,
    pub approval: ApprovalConfig,
    pub audit: AuditConfig,
}

impl Default for ShellExecutorConfig {
    fn default() -> Self {
        super::default::default_config()
    }
}

/// 执行器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutorConfig {
    #[serde(default = "default_timeout")]
    pub default_timeout_seconds: u64,
    
    #[serde(default = "default_max_timeout")]
    pub max_timeout_seconds: u64,
    
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent_executions: usize,
}

fn default_timeout() -> u64 { 300 }
fn default_max_timeout() -> u64 { 1800 }
fn default_max_concurrent() -> usize { 10 }

impl Default for ExecutorConfig {
    fn default() -> Self {
        Self {
            default_timeout_seconds: default_timeout(),
            max_timeout_seconds: default_max_timeout(),
            max_concurrent_executions: default_max_concurrent(),
        }
    }
}

/// 策略配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyConfig {
    #[serde(default)]
    pub whitelist: Vec<String>,
    
    #[serde(default)]
    pub blacklist_patterns: Vec<String>,
    
    #[serde(default)]
    pub dangerous_patterns: Vec<String>,
}

impl Default for PolicyConfig {
    fn default() -> Self {
        Self {
            whitelist: vec![
                "git status".to_string(),
                "git log".to_string(),
                "git diff".to_string(),
                "git branch".to_string(),
                "ls".to_string(),
                "dir".to_string(),
                "cat".to_string(),
                "pwd".to_string(),
                "echo".to_string(),
                "node --version".to_string(),
                "npm --version".to_string(),
                "python --version".to_string(),
            ],
            blacklist_patterns: vec![
                "rm -rf /".to_string(),
                "rm -rf /*".to_string(),
                "del /s /q C:\\".to_string(),
                "curl | bash".to_string(),
                "wget | sh".to_string(),
                ":(){ :|:& };:".to_string(),  // Fork bomb
            ],
            dangerous_patterns: vec![
                "rm -rf".to_string(),
                "sudo".to_string(),
                "chmod 777".to_string(),
                "mkfs".to_string(),
                "dd if=".to_string(),
                "> /dev/sd".to_string(),
            ],
        }
    }
}

/// 路径限制配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathRestrictionsConfig {
    #[serde(default = "default_allowed_paths")]
    pub allowed_paths: Vec<String>,
    
    #[serde(default = "default_forbidden_paths")]
    pub forbidden_paths: Vec<String>,
}

fn default_allowed_paths() -> Vec<String> {
    vec![
        "$HOME".to_string(),
        "$HOME/Documents".to_string(),
        "$HOME/Desktop".to_string(),
        "$HOME/Projects".to_string(),
        "$HOME/workspace".to_string(),
    ]
}

fn default_forbidden_paths() -> Vec<String> {
    vec![
        "/etc".to_string(),
        "/usr".to_string(),
        "/bin".to_string(),
        "/sbin".to_string(),
        "C:\\Windows".to_string(),
        "C:\\Program Files".to_string(),
        "C:\\Program Files (x86)".to_string(),
    ]
}

impl Default for PathRestrictionsConfig {
    fn default() -> Self {
        Self {
            allowed_paths: default_allowed_paths(),
            forbidden_paths: default_forbidden_paths(),
        }
    }
}

/// 确认配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalConfig {
    #[serde(default = "default_auto_approve_whitelist")]
    pub auto_approve_whitelist: bool,
    
    #[serde(default = "default_require_confirmation_dangerous")]
    pub require_confirmation_dangerous: bool,
    
    #[serde(default = "default_cache_ttl")]
    pub cache_ttl_seconds: u64,
}

fn default_auto_approve_whitelist() -> bool { true }
fn default_require_confirmation_dangerous() -> bool { true }
fn default_cache_ttl() -> u64 { 3600 } // 1 hour

impl Default for ApprovalConfig {
    fn default() -> Self {
        Self {
            auto_approve_whitelist: default_auto_approve_whitelist(),
            require_confirmation_dangerous: default_require_confirmation_dangerous(),
            cache_ttl_seconds: default_cache_ttl(),
        }
    }
}

/// 审计配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditConfig {
    #[serde(default = "default_audit_enabled")]
    pub enabled: bool,
    
    #[serde(default = "default_log_file")]
    pub log_file: String,
    
    #[serde(default = "default_retention_days")]
    pub retention_days: u64,
}

fn default_audit_enabled() -> bool { true }
fn default_log_file() -> String { 
    "$APP_DATA/deeting/logs/shell_executor.log".to_string() 
}
fn default_retention_days() -> u64 { 30 }

impl Default for AuditConfig {
    fn default() -> Self {
        Self {
            enabled: default_audit_enabled(),
            log_file: default_log_file(),
            retention_days: default_retention_days(),
        }
    }
}

/// 为 ShellExecutorConfig 实现 create_policy_checker 方法
impl ShellExecutorConfig {
    pub fn create_policy_checker(&self) -> Box<dyn crate::modules::shell_executor::policy::CommandPolicyChecker> {
        Box::new(crate::modules::shell_executor::policy::DefaultPolicyChecker::new(&self.policy))
    }
}
