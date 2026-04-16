use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxIdentity {
    pub sandbox_id: String,
    pub sandbox_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxLeaseInfo {
    pub session_id: String,
    pub sandbox_id: String,
    pub sandbox_name: String,
    pub expires_at_unix_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxExecutionOutput {
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
    pub exit_code: i32,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxBoxSpec {
    pub image: String,
    pub cpus: Option<u8>,
    pub memory_mib: Option<u32>,
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxFilePayload {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxExecutionRequest {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub files: Vec<SandboxFilePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdin: Option<String>,
    pub timeout_seconds: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxRunResult {
    pub sandbox_id: String,
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
    pub result: Vec<String>,
    pub exit_code: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxRuntimeMode {
    Sandbox,
    HostFallback,
    Disabled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxReadinessStatus {
    Ready,
    NeedsWsl,
    #[serde(rename = "needs_boxlite")]
    NeedsBoxLite,
    RepairNeeded,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxExecutionProbeStatus {
    Passed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxSnippetLanguage {
    Python,
    Go,
    Rust,
    Java,
}

impl SandboxSnippetLanguage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Python => "python",
            Self::Go => "go",
            Self::Rust => "rust",
            Self::Java => "java",
        }
    }

    pub fn image(&self) -> &'static str {
        match self {
            Self::Python => "python:slim",
            Self::Go => "golang",
            Self::Rust => "rust",
            Self::Java => "openjdk",
        }
    }

    pub fn box_spec(&self) -> SandboxBoxSpec {
        SandboxBoxSpec {
            image: self.image().to_string(),
            cpus: Some(1),
            memory_mib: Some(512),
            working_dir: Some("/workspace".to_string()),
        }
    }

    pub fn build_execution_request(
        &self,
        code: &str,
        timeout_seconds: u64,
    ) -> SandboxExecutionRequest {
        let (command, args, file_name) = match self {
            Self::Python => ("python", vec!["main.py".to_string()], "main.py"),
            Self::Go => (
                "go",
                vec!["run".to_string(), "main.go".to_string()],
                "main.go",
            ),
            Self::Rust => (
                "sh",
                vec![
                    "-lc".to_string(),
                    "rustc main.rs -o main && ./main".to_string(),
                ],
                "main.rs",
            ),
            Self::Java => (
                "sh",
                vec![
                    "-lc".to_string(),
                    "javac Main.java && java Main".to_string(),
                ],
                "Main.java",
            ),
        };

        SandboxExecutionRequest {
            command: command.to_string(),
            args,
            files: vec![SandboxFilePayload {
                path: file_name.to_string(),
                content: code.to_string(),
            }],
            stdin: None,
            timeout_seconds: timeout_seconds.max(1),
            working_dir: Some("/workspace".to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxWslStatus {
    pub installed: bool,
    pub ready: bool,
    pub detail: Option<String>,
    pub recommended_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxBoxLiteStatus {
    pub binary_found: bool,
    pub binary_path: Option<String>,
    pub endpoint: Option<String>,
    pub reachable: bool,
    pub managed_by_deeting: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxExecutionProbe {
    pub status: SandboxExecutionProbeStatus,
    pub detail: Option<String>,
    pub checked_at_unix_ms: Option<i64>,
}

impl Default for SandboxExecutionProbe {
    fn default() -> Self {
        Self {
            status: SandboxExecutionProbeStatus::Skipped,
            detail: None,
            checked_at_unix_ms: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxReadinessReport {
    pub platform: String,
    pub platform_supported: bool,
    pub status: SandboxReadinessStatus,
    pub provider_name: String,
    pub runtime_mode: SandboxRuntimeMode,
    pub wsl: Option<SandboxWslStatus>,
    pub boxlite: SandboxBoxLiteStatus,
    pub execution_probe: SandboxExecutionProbe,
    pub blocking_reason: Option<String>,
    pub next_actions: Vec<String>,
    pub can_auto_prepare: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxInstallGuide {
    pub status: SandboxReadinessStatus,
    pub title: String,
    pub description: String,
    pub steps: Vec<String>,
    pub primary_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxSnippetRunRequest {
    pub session_id: String,
    pub language: SandboxSnippetLanguage,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxSnippetRunResponse {
    pub success: bool,
    pub status: String,
    pub language: String,
    pub image: String,
    pub sandbox_id: Option<String>,
    pub runtime_mode: SandboxRuntimeMode,
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
    pub result: Vec<String>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readiness: Option<SandboxReadinessReport>,
}

#[cfg(test)]
mod tests {
    use super::{SandboxReadinessStatus, SandboxSnippetLanguage};

    #[test]
    fn needs_boxlite_serializes_without_extra_underscore() {
        let value = serde_json::to_string(&SandboxReadinessStatus::NeedsBoxLite).unwrap();
        assert_eq!(value, "\"needs_boxlite\"");
    }

    #[test]
    fn snippet_language_builds_expected_images_and_commands() {
        let python = SandboxSnippetLanguage::Python;
        let request = python.build_execution_request("print('hi')", 30);
        assert_eq!(python.image(), "python:slim");
        assert_eq!(request.command, "python");
        assert_eq!(request.args, vec!["main.py".to_string()]);
        assert_eq!(request.files[0].path, "main.py");

        let java = SandboxSnippetLanguage::Java;
        let request = java.build_execution_request("class Main {}", 30);
        assert_eq!(java.image(), "openjdk");
        assert_eq!(request.command, "sh");
        assert!(request
            .args
            .iter()
            .any(|arg| arg.contains("javac Main.java")));
    }
}
