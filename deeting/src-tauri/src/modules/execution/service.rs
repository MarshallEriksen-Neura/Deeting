use super::adapters::{build_shell_command, prepare_script, PreparedCommand};
use super::audit::ExecutionAuditLogger;
use super::config::ExecutionConfig;
use super::decoder::decode_output;
use super::paths::WorkingDirectoryPolicy;
use super::policy::{ApprovalLevel, ExecutionPolicy, ExecutionPolicyDecision};
use super::resolver::{resolve_request, ResolvedInvocation};
use super::types::{ExecutionError, ExecutionRequest, ExecutionResult};
use crate::modules::mcp::{
    ApprovalBoundaryClass, RiskOperationClass, RiskTargetClass, ToolRiskAssessment,
};
use crate::utils::configure_background_tokio_command;
use async_trait::async_trait;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::process::Command;

pub struct ExecutionService {
    config: ExecutionConfig,
    policy: ExecutionPolicy,
    working_dir_policy: WorkingDirectoryPolicy,
    audit_logger: ExecutionAuditLogger,
}

impl ExecutionService {
    pub fn new(home_dir: PathBuf, config: Option<ExecutionConfig>) -> Self {
        let config = config.unwrap_or_default();
        let policy = ExecutionPolicy::new(&config);
        let working_dir_policy = WorkingDirectoryPolicy::new(home_dir.clone(), &config);
        let audit_logger = ExecutionAuditLogger::new(&config, &home_dir);
        Self {
            config,
            policy,
            working_dir_policy,
            audit_logger,
        }
    }

    pub fn assess_risk(&self, request: &ExecutionRequest) -> ToolRiskAssessment {
        match self.policy.check(request) {
            ExecutionPolicyDecision::Allowed => ToolRiskAssessment {
                requires_approval: false,
                risk_level: "LOW",
                reasons: vec!["command in allowlist".to_string()],
                operation_class: RiskOperationClass::ProcessExec,
                target_class: RiskTargetClass::Host,
                boundary_class: ApprovalBoundaryClass::None,
            },
            ExecutionPolicyDecision::Denied(reason) => ToolRiskAssessment {
                requires_approval: true,
                risk_level: "CRITICAL",
                reasons: vec![reason],
                operation_class: RiskOperationClass::ProcessExec,
                target_class: RiskTargetClass::Host,
                boundary_class: ApprovalBoundaryClass::HardBoundary,
            },
            ExecutionPolicyDecision::RequiresApproval(level, message) => {
                let (risk_level, boundary_class) = match level {
                    ApprovalLevel::Standard => ("MEDIUM", ApprovalBoundaryClass::SoftBoundary),
                    ApprovalLevel::Dangerous => ("HIGH", ApprovalBoundaryClass::HardBoundary),
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

    pub async fn execute(
        &self,
        request: ExecutionRequest,
    ) -> Result<ExecutionResult, ExecutionError> {
        let display_command = request.command_label();
        if display_command.is_empty() {
            return Err(ExecutionError::InvalidRequest(
                "execution request must include command, program, or script".to_string(),
            ));
        }

        if let Some(working_dir) = request.working_dir.as_ref() {
            self.working_dir_policy
                .validate(working_dir)
                .map_err(|err| {
                    self.audit_logger.log_denied(&display_command, &err);
                    ExecutionError::PathNotAllowed(err)
                })?;
        }

        if let ExecutionPolicyDecision::Denied(reason) = self.policy.check(&request) {
            self.audit_logger.log_denied(&display_command, &reason);
            return Err(ExecutionError::Denied(reason));
        }

        let plan = resolve_request(&request)?;
        let timeout_seconds = request
            .timeout_seconds
            .min(self.config.max_timeout_seconds)
            .max(1);
        let start = Instant::now();
        let output = self
            .execute_plan(&request, &plan.invocation, timeout_seconds)
            .await;

        let output = match output {
            Ok(output) => output,
            Err(ExecutionError::Timeout) => {
                self.audit_logger.log_timeout(&display_command);
                return Err(ExecutionError::Timeout);
            }
            Err(err) => {
                self.audit_logger
                    .log_failed(&display_command, &err.to_string());
                return Err(err);
            }
        };

        let stdout = decode_output(&output.stdout);
        let stderr = decode_output(&output.stderr);

        let mut warnings = plan.warnings;
        warnings.extend(stdout.warnings.clone());
        warnings.extend(stderr.warnings.clone());

        self.audit_logger.log_execution(
            &display_command,
            request.working_dir.as_ref(),
            output.exit_code,
            start.elapsed().as_millis() as u64,
            "auto_approved",
        );

        Ok(ExecutionResult {
            stdout: stdout.text,
            stderr: stderr.text,
            exit_code: output.exit_code,
            command: display_command,
            working_dir: request.working_dir,
            duration_ms: start.elapsed().as_millis() as u64,
            approval_level: "auto_approved".to_string(),
            mode: plan.mode,
            resolved_program: output.program,
            resolved_args: output.args,
            shell_family: plan
                .shell_family
                .and_then(|shell| shell.output_name().map(str::to_string)),
            encoding_stdout: Some(stdout.encoding_used),
            encoding_stderr: Some(stderr.encoding_used),
            diagnostics: output.diagnostics,
            warnings,
        })
    }

    async fn execute_plan(
        &self,
        request: &ExecutionRequest,
        invocation: &ResolvedInvocation,
        timeout_seconds: u64,
    ) -> Result<RawCommandOutput, ExecutionError> {
        let prepared = match invocation {
            ResolvedInvocation::Process { program, args } => PreparedCommand {
                program: program.clone(),
                args: args.clone(),
                cleanup_path: None,
            },
            ResolvedInvocation::Shell { shell, command } => build_shell_command(*shell, command)?,
            ResolvedInvocation::Script { shell, script } => {
                if script.len() > self.config.max_script_bytes {
                    return Err(ExecutionError::InvalidRequest(format!(
                        "script exceeds max size of {} bytes",
                        self.config.max_script_bytes
                    )));
                }
                prepare_script(*shell, script)?
            }
        };

        let mut diagnostics = Vec::new();
        let result = run_command(
            &prepared.program,
            &prepared.args,
            request.working_dir.as_ref(),
            &request.env,
            timeout_seconds,
        )
        .await;

        if let Some(path) = prepared.cleanup_path {
            if let Err(err) = std::fs::remove_file(&path) {
                diagnostics.push(format!(
                    "failed to remove temp script {}: {}",
                    path.display(),
                    err
                ));
            }
        }

        result.map(|raw| RawCommandOutput {
            program: prepared.program,
            args: prepared.args,
            diagnostics,
            ..raw
        })
    }
}

struct RawCommandOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_code: i32,
    program: String,
    args: Vec<String>,
    diagnostics: Vec<String>,
}

async fn run_command(
    program: &str,
    args: &[String],
    working_dir: Option<&PathBuf>,
    env: &std::collections::HashMap<String, String>,
    timeout_seconds: u64,
) -> Result<RawCommandOutput, ExecutionError> {
    let mut command = Command::new(program);
    configure_background_tokio_command(&mut command);
    #[cfg(target_os = "windows")]
    apply_windows_utf8_env_defaults(&mut command, env);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(working_dir) = working_dir {
        command.current_dir(working_dir);
    }
    for (key, value) in env {
        command.env(key, value);
    }

    let output = tokio::time::timeout(Duration::from_secs(timeout_seconds), command.output())
        .await
        .map_err(|_| ExecutionError::Timeout)?
        .map_err(|err| ExecutionError::ExecutionFailed(err.to_string()))?;

    Ok(RawCommandOutput {
        stdout: output.stdout,
        stderr: output.stderr,
        exit_code: output.status.code().unwrap_or(-1),
        program: program.to_string(),
        args: args.to_vec(),
        diagnostics: Vec::new(),
    })
}

#[cfg(target_os = "windows")]
fn apply_windows_utf8_env_defaults(
    command: &mut Command,
    env: &std::collections::HashMap<String, String>,
) {
    for (key, value) in [
        ("PYTHONIOENCODING", "utf-8"),
        ("PYTHONUTF8", "1"),
        ("LANG", "C.UTF-8"),
        ("LC_ALL", "C.UTF-8"),
    ] {
        if !env.contains_key(key) {
            command.env(key, value);
        }
    }
}

#[async_trait]
pub trait ExecutionEngine: Send + Sync {
    async fn execute(&self, request: ExecutionRequest) -> Result<ExecutionResult, ExecutionError>;
    fn assess_risk(&self, request: &ExecutionRequest) -> ToolRiskAssessment;
}

#[async_trait]
impl ExecutionEngine for ExecutionService {
    async fn execute(&self, request: ExecutionRequest) -> Result<ExecutionResult, ExecutionError> {
        ExecutionService::execute(self, request).await
    }

    fn assess_risk(&self, request: &ExecutionRequest) -> ToolRiskAssessment {
        ExecutionService::assess_risk(self, request)
    }
}
