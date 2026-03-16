//! Shell Executor Trait 定义

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::modules::shell_executor::config::ShellExecutorConfig;
use crate::modules::shell_executor::policy::CommandPolicy;

/// Shell 执行器 Trait
#[async_trait]
pub trait ShellExecutor: Send + Sync {
    /// 执行命令
    async fn execute(
        &self,
        request: ShellExecutionRequest,
    ) -> Result<ShellExecutionResult, ShellExecutionError>;

    /// 检查命令策略(不执行)
    fn check_policy(&self, command: &str) -> CommandPolicy;

    /// 验证路径
    fn validate_path(&self, path: &PathBuf) -> Result<(), String>;

    /// 获取配置
    fn config(&self) -> &ShellExecutorConfig;
}

/// 请求结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellExecutionRequest {
    /// 命令
    pub command: String,

    /// 参数
    #[serde(default)]
    pub args: Vec<String>,

    /// 工作目录
    pub working_dir: Option<PathBuf>,

    /// 环境变量
    #[serde(default)]
    pub env: HashMap<String, String>,

    /// 超时时间(秒)
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
}

fn default_timeout() -> u64 {
    300
}

impl Default for ShellExecutionRequest {
    fn default() -> Self {
        Self {
            command: String::new(),
            args: Vec::new(),
            working_dir: None,
            env: HashMap::new(),
            timeout_seconds: default_timeout(),
        }
    }
}

/// 执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellExecutionResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub command: String,
    pub working_dir: Option<PathBuf>,
    pub duration_ms: u64,
    pub approval_level: String,
}

/// 执行错误
#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
pub enum ShellExecutionError {
    #[error("Command denied: {0}")]
    Denied(String),

    #[error("User denied execution")]
    UserDenied,

    #[error("Path not allowed: {0}")]
    PathNotAllowed(String),

    #[error("Execution timeout")]
    Timeout,

    #[error("Execution failed: {0}")]
    ExecutionFailed(String),

    #[error("Approval request failed: {0}")]
    ApprovalFailed(String),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),
}
