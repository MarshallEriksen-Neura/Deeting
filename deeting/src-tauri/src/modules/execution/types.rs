use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionMode {
    Process,
    Shell,
    Script,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionShell {
    Auto,
    Cmd,
    Powershell,
    Pwsh,
    Sh,
    Bash,
    Zsh,
}

impl ExecutionShell {
    pub fn output_name(self) -> Option<&'static str> {
        match self {
            Self::Auto => None,
            Self::Cmd => Some("cmd"),
            Self::Powershell => Some("powershell"),
            Self::Pwsh => Some("pwsh"),
            Self::Sh => Some("sh"),
            Self::Bash => Some("bash"),
            Self::Zsh => Some("zsh"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionRequest {
    #[serde(default)]
    pub mode: Option<ExecutionMode>,

    #[serde(default)]
    pub shell: Option<ExecutionShell>,

    #[serde(default)]
    pub command: Option<String>,

    #[serde(default)]
    pub program: Option<String>,

    #[serde(default)]
    pub script: Option<String>,

    #[serde(default)]
    pub args: Vec<String>,

    pub working_dir: Option<PathBuf>,

    #[serde(default)]
    pub env: HashMap<String, String>,

    #[serde(default = "default_timeout_seconds")]
    pub timeout_seconds: u64,
}

fn default_timeout_seconds() -> u64 {
    300
}

impl Default for ExecutionRequest {
    fn default() -> Self {
        Self {
            mode: None,
            shell: None,
            command: None,
            program: None,
            script: None,
            args: Vec::new(),
            working_dir: None,
            env: HashMap::new(),
            timeout_seconds: default_timeout_seconds(),
        }
    }
}

impl ExecutionRequest {
    pub fn requested_shell(&self) -> ExecutionShell {
        self.shell.unwrap_or(ExecutionShell::Auto)
    }

    pub fn command_text(&self) -> Option<String> {
        self.command
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    pub fn program_text(&self) -> Option<String> {
        self.program
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    pub fn script_text(&self) -> Option<String> {
        self.script
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    pub fn command_label(&self) -> String {
        let base = if let Some(program) = self.program_text() {
            if self.args.is_empty() {
                program
            } else {
                format!("{program} {}", self.args.join(" "))
            }
        } else if let Some(command) = self.command_text() {
            if self.args.is_empty() {
                command
            } else {
                format!("{command} {}", self.args.join(" "))
            }
        } else if let Some(script) = self.script_text() {
            let preview = preview_script(&script);
            match self.requested_shell().output_name() {
                Some(shell) => format!("{shell} script: {preview}"),
                None => format!("script: {preview}"),
            }
        } else {
            String::new()
        };

        truncate_for_display(&base, 160)
    }
}

fn preview_script(script: &str) -> String {
    let preview = script
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("<empty>");
    truncate_for_display(preview, 96)
}

fn truncate_for_display(value: &str, max_chars: usize) -> String {
    let chars = value.chars().collect::<Vec<_>>();
    if chars.len() <= max_chars {
        return value.to_string();
    }
    let keep = max_chars.saturating_sub(3);
    let truncated = chars.into_iter().take(keep).collect::<String>();
    format!("{truncated}...")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub command: String,
    pub working_dir: Option<PathBuf>,
    pub duration_ms: u64,
    pub approval_level: String,
    pub mode: ExecutionMode,
    pub resolved_program: String,
    pub resolved_args: Vec<String>,
    pub shell_family: Option<String>,
    pub encoding_stdout: Option<String>,
    pub encoding_stderr: Option<String>,
    #[serde(default)]
    pub diagnostics: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
pub enum ExecutionError {
    #[error("Command denied: {0}")]
    Denied(String),

    #[error("Path not allowed: {0}")]
    PathNotAllowed(String),

    #[error("Execution timeout")]
    Timeout,

    #[error("Execution failed: {0}")]
    ExecutionFailed(String),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),
}
