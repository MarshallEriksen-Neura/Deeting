//! Shell Executor Module
//!
//! 提供安全的 shell 命令执行能力,支持跨平台和多层安全检查。
//! 审批流程复用现有 MCP 系统的机制。

mod audit;
mod config;
mod executor;
mod guard;
mod policy;

// 公开的 trait
pub use audit::AuditLogger;
pub use executor::ShellExecutor;
pub use guard::PathGuard;
pub use policy::CommandPolicyChecker;

// 公开的类型
pub use executor::{ShellExecutionError, ShellExecutionRequest, ShellExecutionResult};

pub use policy::{ApprovalLevel, CommandPolicy};

pub use config::{ShellExecutorConfig, ShellExecutorConfigLoader};

// 公开的 Core Tool 集成
pub mod core_tool;

/// Shell Executor 实例的工厂方法
pub fn create_shell_executor(
    home_dir: std::path::PathBuf,
    config: Option<ShellExecutorConfig>,
) -> Box<dyn ShellExecutor> {
    let config = config.unwrap_or_default();
    Box::new(executor::HostShellExecutor::new(home_dir, config))
}
