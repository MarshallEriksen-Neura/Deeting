//! Executor - 命令执行层

mod command_builder;
mod host_executor;
mod r#trait;

pub use command_builder::CommandBuilder;
pub use host_executor::HostShellExecutor;
pub use r#trait::{
    ShellExecutionError, ShellExecutionRequest, ShellExecutionResult, ShellExecutor,
};
