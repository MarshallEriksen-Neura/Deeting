use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::types::{SandboxExecutionOutput, SandboxIdentity};

#[derive(Debug, Clone)]
pub struct HostBackendOptions {
    pub python_bin: String,
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone)]
struct PythonCommand {
    program: String,
    prefix_args: Vec<String>,
}

#[derive(Clone)]
pub struct HostPythonBackend {
    command: PythonCommand,
    options: HostBackendOptions,
}

impl HostPythonBackend {
    pub fn new(options: HostBackendOptions) -> Result<Self, SandboxError> {
        let command = resolve_python_command(&options.python_bin)?;
        Ok(Self { command, options })
    }

    pub async fn get_or_create_box(&self, box_name: &str) -> Result<SandboxIdentity, SandboxError> {
        Ok(SandboxIdentity {
            sandbox_id: box_name.to_string(),
            sandbox_name: box_name.to_string(),
        })
    }

    pub async fn stop_box(&self, _box_id_or_name: &str) -> Result<(), SandboxError> {
        Ok(())
    }

    pub async fn run_python(
        &self,
        box_id_or_name: &str,
        code: &str,
        timeout_seconds: u64,
    ) -> Result<SandboxExecutionOutput, SandboxError> {
        if code.trim().is_empty() {
            return Err(SandboxError::Validation("code is required".to_string()));
        }

        let mut command = Command::new(&self.command.program);
        command.args(&self.command.prefix_args);
        command.arg("-c").arg(code);
        command.stdin(Stdio::null());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        command.kill_on_drop(true);

        if let Some(working_dir) = self.options.working_dir.as_deref() {
            let path = Path::new(working_dir);
            if path.exists() {
                command.current_dir(path);
            }
        }

        let child = command
            .spawn()
            .map_err(|err| map_spawn_error(&self.command.program, err))?;

        let wait_result =
            tokio::time::timeout(Duration::from_secs(timeout_seconds.max(1)), child.wait_with_output())
                .await
                .map_err(|_| {
                    SandboxError::Timeout(format!(
                        "host python execution timed out (sandbox_id={box_id_or_name}, timeout={}s)",
                        timeout_seconds.max(1)
                    ))
                })?;
        let output = wait_result.map_err(|err| SandboxError::Internal(err.to_string()))?;

        let stdout = output_to_lines(output.stdout);
        let stderr = output_to_lines(output.stderr);
        let exit_code = output.status.code().unwrap_or(-1);

        Ok(SandboxExecutionOutput {
            stdout,
            stderr,
            exit_code,
            error_message: None,
        })
    }

    pub async fn shutdown(&self) -> Result<(), SandboxError> {
        Ok(())
    }
}

fn resolve_python_command(preferred: &str) -> Result<PythonCommand, SandboxError> {
    let mut candidates = candidate_python_commands(preferred);

    while let Some(candidate) = candidates.pop() {
        if is_python_available(&candidate) {
            return Ok(candidate);
        }
    }

    Err(SandboxError::Unavailable(
        "no usable python runtime found for host fallback".to_string(),
    ))
}

fn candidate_python_commands(preferred: &str) -> Vec<PythonCommand> {
    let mut commands = Vec::new();
    let trimmed = preferred.trim();

    if !trimmed.is_empty() {
        commands.push(PythonCommand {
            program: trimmed.to_string(),
            prefix_args: Vec::new(),
        });
    }

    if cfg!(target_os = "windows") {
        commands.push(PythonCommand {
            program: "py".to_string(),
            prefix_args: vec!["-3".to_string()],
        });
    }

    commands.push(PythonCommand {
        program: "python".to_string(),
        prefix_args: Vec::new(),
    });
    commands.push(PythonCommand {
        program: "python3".to_string(),
        prefix_args: Vec::new(),
    });

    commands.reverse();
    commands
}

fn is_python_available(command: &PythonCommand) -> bool {
    let mut probe = std::process::Command::new(&command.program);
    probe.args(&command.prefix_args);
    probe.arg("--version");
    probe.stdin(Stdio::null());
    probe.stdout(Stdio::null());
    probe.stderr(Stdio::null());
    match probe.status() {
        Ok(status) => status.success(),
        Err(_) => false,
    }
}

fn map_spawn_error(program: &str, err: std::io::Error) -> SandboxError {
    if err.kind() == std::io::ErrorKind::NotFound {
        return SandboxError::Unavailable(format!("python runtime not found: {program}"));
    }
    SandboxError::Internal(err.to_string())
}

fn output_to_lines(bytes: Vec<u8>) -> Vec<String> {
    let text = String::from_utf8_lossy(&bytes);
    text.lines()
        .map(|line| line.trim_end_matches('\r').to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::output_to_lines;

    #[test]
    fn output_to_lines_splits_multiline_output() {
        let lines = output_to_lines(b"line1\r\nline2\n".to_vec());
        assert_eq!(lines, vec!["line1".to_string(), "line2".to_string()]);
    }

    #[test]
    fn output_to_lines_ignores_empty_lines() {
        let lines = output_to_lines(b"\n\r\nvalue\n".to_vec());
        assert_eq!(lines, vec!["value".to_string()]);
    }
}
