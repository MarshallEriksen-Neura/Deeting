//! Core Tool 集成适配器
//!
//! 将 Shell Executor 暴露为 Core Tool,供 MCP 系统使用。
//! 复用现有的风险评估和审批流程。

use super::{create_shell_executor, ShellExecutionRequest, ShellExecutor};
use serde_json::{json, Value};
use std::path::PathBuf;

/// Core Tool 定义
pub fn get_shell_execute_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "shell_execute",
            "description": "Execute shell commands on the user's machine with security checks and user approval. Supports cross-platform command execution (Windows: cmd, Linux/Mac: sh). Automatically handles encoding (UTF-8/GBK) and provides timeout control.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command to execute (e.g., 'npm install', 'git status')"
                    },
                    "args": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional arguments for the command"
                    },
                    "working_dir": {
                        "type": "string",
                        "description": "Working directory for command execution. Must be within allowed paths (user directories)."
                    },
                    "timeout_seconds": {
                        "type": "integer",
                        "description": "Execution timeout in seconds",
                        "default": 300,
                        "minimum": 5,
                        "maximum": 1800
                    },
                    "env": {
                        "type": "object",
                        "additionalProperties": { "type": "string" },
                        "description": "Environment variables for the command"
                    }
                },
                "required": ["command"]
            }
        }
    })
}

/// Core Tool 执行器
///
/// 注意: 实际的审批流程由外部系统处理
/// 这个结构体只负责执行命令，不处理审批逻辑
pub struct ShellExecuteCoreTool {
    executor: Box<dyn ShellExecutor>,
}

impl ShellExecuteCoreTool {
    pub fn new(home_dir: PathBuf) -> Self {
        Self {
            executor: create_shell_executor(home_dir, None),
        }
    }

    pub fn new_with_config(home_dir: PathBuf, config: super::ShellExecutorConfig) -> Self {
        Self {
            executor: create_shell_executor(home_dir, Some(config)),
        }
    }

    /// 执行命令 (不包含审批逻辑)
    ///
    /// 注意: 审批逻辑由 MCP 系统的 execute_or_queue_mcp_tool_call 处理
    pub async fn execute(&self, arguments: Value) -> Result<Value, String> {
        let request: ShellExecutionRequest =
            serde_json::from_value(arguments).map_err(|e| format!("Invalid arguments: {}", e))?;

        let result = self
            .executor
            .execute(request)
            .await
            .map_err(|e| e.to_string())?;

        serde_json::to_value(result).map_err(|e| format!("Failed to serialize result: {}", e))
    }

    /// 评估命令风险
    ///
    /// 用于集成到现有的风险评估系统
    pub fn assess_risk(
        &self,
        command: &str,
        arguments: &Value,
    ) -> crate::modules::mcp::ToolRiskAssessment {
        use crate::modules::mcp::{
            ApprovalBoundaryClass, RiskOperationClass, RiskTargetClass, ToolRiskAssessment,
        };

        let policy = self.executor.check_policy(command);

        match policy {
            super::CommandPolicy::Allowed => ToolRiskAssessment {
                requires_approval: false,
                risk_level: "LOW",
                reasons: vec!["command in whitelist".to_string()],
                operation_class: RiskOperationClass::ProcessExec,
                target_class: RiskTargetClass::Host,
                boundary_class: ApprovalBoundaryClass::None,
            },

            super::CommandPolicy::Denied(reason) => ToolRiskAssessment {
                requires_approval: true,
                risk_level: "CRITICAL",
                reasons: vec![reason],
                operation_class: RiskOperationClass::ProcessExec,
                target_class: RiskTargetClass::Host,
                boundary_class: ApprovalBoundaryClass::HardBoundary,
            },

            super::CommandPolicy::RequiresApproval(level, message) => {
                let (risk_level, boundary_class) = match level {
                    super::ApprovalLevel::Standard => {
                        ("MEDIUM", ApprovalBoundaryClass::SoftBoundary)
                    }
                    super::ApprovalLevel::Dangerous => {
                        ("HIGH", ApprovalBoundaryClass::HardBoundary)
                    }
                };

                ToolRiskAssessment {
                    requires_approval: true,
                    risk_level,
                    reasons: vec![message],
                    operation_class: RiskOperationClass::ProcessExec,
                    target_class: RiskTargetClass::Host,
                    boundary_class,
                }
            }
        }
    }

    /// 获取工具定义
    pub fn definition() -> Value {
        get_shell_execute_tool_definition()
    }
}
