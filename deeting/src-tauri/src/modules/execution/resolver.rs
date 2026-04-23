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
                    let command = flatten_bash_continuations(&command);
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
    if looks_like_powershell(text) || contains_non_ascii(text) || looks_like_bash(text) {
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

#[cfg(target_os = "windows")]
fn contains_non_ascii(text: &str) -> bool {
    text.chars().any(|ch| !ch.is_ascii())
}

#[cfg(target_os = "windows")]
fn looks_like_bash(text: &str) -> bool {
    let t = text.trim();
    // bash 风格的行继续符（\ 后跟换行）
    if t.contains("\\\n") || t.contains("\\\r\n") {
        return true;
    }
    // 单引号字符串：bash 常用，但 cmd 不支持单引号作为引号
    if t.contains('\'') && !t.contains('"') {
        return true;
    }
    false
}

/// 将 bash 风格的 \ 行继续符扁平化为单行。
/// 例如 `"curl ... \\\n  -H ..."` → `"curl ... -H ..."`
fn flatten_bash_continuations(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            // 跳过 \ 后面的空格/Tab
            while matches!(chars.peek(), Some(' ') | Some('\t')) {
                chars.next();
            }
            // 如果遇到换行，说明是续行符
            if matches!(chars.peek(), Some('\n') | Some('\r')) {
                if chars.peek() == Some(&'\r') {
                    chars.next();
                }
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                // 跳过新行前面的缩进
                while matches!(chars.peek(), Some(' ') | Some('\t')) {
                    chars.next();
                }
                if !result.is_empty() && !result.ends_with(' ') {
                    result.push(' ');
                }
                continue;
            }
        }
        result.push(ch);
    }
    result
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    use super::looks_like_bash;
    use super::{flatten_bash_continuations, resolve_request};
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

    #[cfg(target_os = "windows")]
    #[test]
    fn resolve_request_prefers_powershell_for_non_ascii_command() {
        let request = ExecutionRequest {
            command: Some("echo 你好".to_string()),
            ..ExecutionRequest::default()
        };
        let plan = resolve_request(&request).expect("resolve shell plan");
        assert_eq!(plan.shell_family, Some(ExecutionShell::Powershell));
    }

    #[test]
    fn flatten_bash_continuations_removes_backslash_newline() {
        assert_eq!(
            flatten_bash_continuations("curl hello \\\n  -H foo"),
            "curl hello -H foo"
        );
    }

    #[test]
    fn flatten_bash_continuations_handles_crlf() {
        assert_eq!(
            flatten_bash_continuations("curl hello \\\r\n  -H foo"),
            "curl hello -H foo"
        );
    }

    #[test]
    fn flatten_bash_continuations_preserves_non_continuation_backslash() {
        assert_eq!(
            flatten_bash_continuations("echo path\\to\\file"),
            "echo path\\to\\file"
        );
    }

    #[test]
    fn flatten_bash_continuations_handles_multiple_continuations() {
        assert_eq!(flatten_bash_continuations("a \\\n  b \\\n  c"), "a b c");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn looks_like_bash_detects_continuation() {
        assert!(looks_like_bash("curl \\\n  -H foo"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn looks_like_bash_detects_single_quotes() {
        assert!(looks_like_bash("echo 'hello world'"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn looks_like_bash_ignores_double_quoted_text() {
        // 包含双引号时认为不是纯 bash 单引号风格
        assert!(!looks_like_bash("echo \"hello world\""));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn resolve_request_prefers_powershell_for_bash_curl_command() {
        let request = ExecutionRequest {
            command: Some("curl -s -X POST https://example.com/hello \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"k\":\"v\"}'".to_string()),
            ..ExecutionRequest::default()
        };
        let plan = resolve_request(&request).expect("resolve shell plan");
        assert_eq!(plan.mode, ExecutionMode::Shell);
        assert_eq!(plan.shell_family, Some(ExecutionShell::Powershell));
        // 验证续行被扁平化
        if let super::ResolvedInvocation::Shell { command, .. } = &plan.invocation {
            assert!(!command.contains('\\'));
            assert!(command.contains("-H 'Content-Type: application/json'"));
        } else {
            panic!("expected Shell invocation");
        }
    }
}
