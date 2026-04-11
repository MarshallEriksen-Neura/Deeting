use super::types::{ExecutionError, ExecutionMode, ExecutionRequest, ExecutionShell};

#[derive(Debug, Clone)]
pub enum ResolvedInvocation {
    Process {
        program: String,
        args: Vec<String>,
    },
    Shell {
        shell: ExecutionShell,
        command: String,
    },
    Script {
        shell: ExecutionShell,
        script: String,
    },
}

#[derive(Debug, Clone)]
pub struct ResolvedExecutionPlan {
    pub mode: ExecutionMode,
    pub shell_family: Option<ExecutionShell>,
    pub invocation: ResolvedInvocation,
    pub warnings: Vec<String>,
}

pub fn resolve_request(
    request: &ExecutionRequest,
) -> Result<ResolvedExecutionPlan, ExecutionError> {
    let command = request.command_text();
    let program = request.program_text();
    let script = request.script_text();
    let inferred_mode = infer_mode(
        request,
        command.as_deref(),
        program.as_deref(),
        script.as_deref(),
    )?;
    let mut warnings = Vec::new();

    match inferred_mode {
        ExecutionMode::Process => {
            let program = program.or(command).ok_or_else(|| {
                ExecutionError::InvalidRequest(
                    "process mode requires a non-empty program or command".to_string(),
                )
            })?;
            Ok(ResolvedExecutionPlan {
                mode: ExecutionMode::Process,
                shell_family: None,
                invocation: ResolvedInvocation::Process {
                    program,
                    args: request.args.clone(),
                },
                warnings,
            })
        }
        ExecutionMode::Shell => {
            let command = match (command, program) {
                (Some(command), _) => {
                    if request.args.is_empty() {
                        command
                    } else {
                        format!("{command} {}", request.args.join(" "))
                    }
                }
                (None, Some(program)) => {
                    if request.args.is_empty() {
                        program
                    } else {
                        format!("{program} {}", request.args.join(" "))
                    }
                }
                _ => {
                    return Err(ExecutionError::InvalidRequest(
                        "shell mode requires a command or program".to_string(),
                    ));
                }
            };
            let shell = resolve_shell(request, &command);
            Ok(ResolvedExecutionPlan {
                mode: ExecutionMode::Shell,
                shell_family: Some(shell),
                invocation: ResolvedInvocation::Shell { shell, command },
                warnings,
            })
        }
        ExecutionMode::Script => {
            let script = if let Some(script) = script {
                if !request.args.is_empty() {
                    warnings.push(
                        "script mode ignores args; use program/process mode for argv".to_string(),
                    );
                }
                script
            } else if let Some(command) = command {
                if !request.args.is_empty() {
                    warnings.push(
                        "script mode ignores args; use program/process mode for argv".to_string(),
                    );
                }
                command
            } else {
                return Err(ExecutionError::InvalidRequest(
                    "script mode requires a script body".to_string(),
                ));
            };
            let shell = resolve_shell(request, &script);
            Ok(ResolvedExecutionPlan {
                mode: ExecutionMode::Script,
                shell_family: Some(shell),
                invocation: ResolvedInvocation::Script { shell, script },
                warnings,
            })
        }
    }
}

fn infer_mode(
    request: &ExecutionRequest,
    command: Option<&str>,
    program: Option<&str>,
    script: Option<&str>,
) -> Result<ExecutionMode, ExecutionError> {
    if let Some(mode) = request.mode.clone() {
        return Ok(mode);
    }

    if script.is_some() {
        return Ok(ExecutionMode::Script);
    }
    if program.is_some() {
        return Ok(ExecutionMode::Process);
    }
    if let Some(command) = command {
        if command.contains('\n') || command.contains('\r') {
            return Ok(ExecutionMode::Script);
        }
        if !request.args.is_empty() {
            return Ok(ExecutionMode::Process);
        }
        return Ok(ExecutionMode::Shell);
    }

    Err(ExecutionError::InvalidRequest(
        "execution request must include command, program, or script".to_string(),
    ))
}

fn resolve_shell(request: &ExecutionRequest, text: &str) -> ExecutionShell {
    match request.requested_shell() {
        ExecutionShell::Auto => auto_shell_for_text(text),
        shell => shell,
    }
}

#[cfg(target_os = "windows")]
fn auto_shell_for_text(text: &str) -> ExecutionShell {
    if looks_like_powershell(text) {
        ExecutionShell::Powershell
    } else {
        ExecutionShell::Cmd
    }
}

#[cfg(not(target_os = "windows"))]
fn auto_shell_for_text(_text: &str) -> ExecutionShell {
    ExecutionShell::Sh
}

#[cfg(target_os = "windows")]
fn looks_like_powershell(text: &str) -> bool {
    let lowered = text.to_ascii_lowercase();
    [
        "$env:",
        "[system.",
        "convertto-json",
        "select-object",
        "where-object",
        "get-childitem",
        "get-item",
        "get-content",
        "write-host",
        "write-output",
        "out-string",
        "format-table",
        "@'",
        "'@",
    ]
    .iter()
    .any(|marker| lowered.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::resolve_request;
    use crate::modules::execution::{ExecutionMode, ExecutionRequest, ExecutionShell};

    #[test]
    fn resolve_request_prefers_process_for_program_and_args() {
        let request = ExecutionRequest {
            program: Some("git".to_string()),
            args: vec!["status".to_string()],
            ..ExecutionRequest::default()
        };
        let plan = resolve_request(&request).expect("resolve process plan");
        assert!(matches!(plan.mode, ExecutionMode::Process));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn resolve_request_prefers_powershell_for_powershell_like_command() {
        let request = ExecutionRequest {
            command: Some("[System.Environment]::Version.ToString()".to_string()),
            ..ExecutionRequest::default()
        };
        let plan = resolve_request(&request).expect("resolve shell plan");
        assert_eq!(plan.shell_family, Some(ExecutionShell::Powershell));
    }
}
