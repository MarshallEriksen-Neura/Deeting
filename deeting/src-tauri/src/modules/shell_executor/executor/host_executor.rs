//! Host 执行器 - 在用户机器上执行命令

use super::command_builder::CommandBuilder;
use super::{ShellExecutionError, ShellExecutionRequest, ShellExecutionResult, ShellExecutor};
use crate::modules::mcp::{
    ApprovalBoundaryClass, RiskOperationClass, RiskTargetClass, ToolRiskAssessment,
};
use crate::modules::shell_executor::{
    AuditLogger, CommandPolicyChecker, PathGuard, ShellExecutorConfig,
};
use async_trait::async_trait;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::process::Command;

/// Host Shell 执行器
pub struct HostShellExecutor {
    policy_checker: Box<dyn CommandPolicyChecker>,
    path_guard: PathGuard,
    audit_logger: AuditLogger,
    config: ShellExecutorConfig,
}

impl HostShellExecutor {
    pub fn new(home_dir: PathBuf, config: ShellExecutorConfig) -> Self {
        Self {
            policy_checker: config.create_policy_checker(),
            path_guard: PathGuard::new(home_dir, config.path_restrictions.clone()),
            audit_logger: AuditLogger::new(config.audit.clone()),
            config,
        }
    }

    /// 评估命令风险 (复用现有系统)
    #[allow(dead_code)]
    pub fn assess_risk(&self, command: &str, arguments: &serde_json::Value) -> ToolRiskAssessment {
        let mut score = 0_i32;
        let mut reasons = Vec::new();
        let operation_class = RiskOperationClass::ProcessExec;
        let target_class = RiskTargetClass::Host;
        let mut boundary_class = ApprovalBoundaryClass::None;

        let command_lower = command.to_lowercase();
        let arg_str = arguments.to_string().to_lowercase();

        // 检查白名单
        if self.policy_checker.is_allowed(command) {
            return ToolRiskAssessment {
                requires_approval: false,
                risk_level: "LOW",
                reasons: vec!["command in whitelist".to_string()],
                operation_class,
                target_class,
                boundary_class: ApprovalBoundaryClass::None,
            };
        }

        // 检查黑名单
        if let Some(reason) = self.policy_checker.is_denied(command) {
            return ToolRiskAssessment {
                requires_approval: true,
                risk_level: "CRITICAL",
                reasons: vec![reason],
                operation_class,
                target_class,
                boundary_class: ApprovalBoundaryClass::HardBoundary,
            };
        }

        // 检查危险模式
        if self.policy_checker.is_dangerous(command) {
            score += 3;
            reasons.push("dangerous pattern detected".to_string());
            boundary_class = ApprovalBoundaryClass::HardBoundary;
        }

        // 基本风险评估
        score += 1;
        reasons.push("shell command execution".to_string());

        // 关键关键词检测
        let critical_keywords = [
            "rm -rf",
            "rm -fr",
            "del /",
            "format ",
            "dd if=",
            "mkfs",
            "fdisk",
            "> /dev/",
            "curl | bash",
            "wget |",
        ];

        for kw in critical_keywords {
            if command_lower.contains(kw) || arg_str.contains(kw) {
                score += 5;
                reasons.push(format!("critical keyword detected: {}", kw));
                boundary_class = ApprovalBoundaryClass::HardBoundary;
            }
        }

        // 警告关键词
        let warning_keywords = ["sudo", "chmod 777", "chown", ">/etc/", ">/root/"];

        for kw in warning_keywords {
            if command_lower.contains(kw) || arg_str.contains(kw) {
                score += 2;
                reasons.push(format!("warning keyword detected: {}", kw));
                boundary_class = ApprovalBoundaryClass::HardBoundary;
            }
        }

        // 确定风险级别
        let (risk_level, requires_approval) = if score >= 6 {
            ("CRITICAL", true)
        } else if score >= 4 {
            ("HIGH", true)
        } else if score >= 2 {
            ("MEDIUM", true)
        } else {
            ("LOW", true) // 默认需要审批
        };

        ToolRiskAssessment {
            requires_approval,
            risk_level,
            reasons,
            operation_class,
            target_class,
            boundary_class,
        }
    }
}

#[async_trait]
impl ShellExecutor for HostShellExecutor {
    async fn execute(
        &self,
        request: ShellExecutionRequest,
    ) -> Result<ShellExecutionResult, ShellExecutionError> {
        let start_time = Instant::now();

        // 1. 路径验证
        if let Some(ref cwd) = request.working_dir {
            self.validate_path(cwd)
                .map_err(ShellExecutionError::PathNotAllowed)?;
        }

        // 2. 执行命令
        let result = self.execute_internal(&request).await?;

        // 3. 审计日志
        self.audit_logger.log_execution(
            &request.command,
            request.working_dir.as_ref(),
            result.exit_code,
            start_time.elapsed().as_millis() as u64,
            "auto_approved", // 审批由外部系统处理
        );

        Ok(ShellExecutionResult {
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: result.exit_code,
            command: request.command,
            working_dir: request.working_dir,
            duration_ms: start_time.elapsed().as_millis() as u64,
            approval_level: "auto_approved".to_string(),
        })
    }

    fn check_policy(&self, command: &str) -> crate::modules::shell_executor::policy::CommandPolicy {
        self.policy_checker.check(command)
    }

    fn validate_path(&self, path: &PathBuf) -> Result<(), String> {
        self.path_guard.validate(path)
    }

    fn config(&self) -> &ShellExecutorConfig {
        &self.config
    }
}

impl HostShellExecutor {
    async fn execute_internal(
        &self,
        request: &ShellExecutionRequest,
    ) -> Result<InternalResult, ShellExecutionError> {
        let (program, args) = CommandBuilder::build(&request.command, &request.args);

        let mut cmd = Command::new(program);
        cmd.args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(ref cwd) = request.working_dir {
            cmd.current_dir(cwd);
        }

        for (key, value) in &request.env {
            cmd.env(key, value);
        }

        let timeout = Duration::from_secs(
            request
                .timeout_seconds
                .min(self.config.executor.max_timeout_seconds),
        );

        let output = tokio::time::timeout(timeout, cmd.output())
            .await
            .map_err(|_| ShellExecutionError::Timeout)?
            .map_err(|e| ShellExecutionError::ExecutionFailed(e.to_string()))?;

        Ok(InternalResult {
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }
}

struct InternalResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}
