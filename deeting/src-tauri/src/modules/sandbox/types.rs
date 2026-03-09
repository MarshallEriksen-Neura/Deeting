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
    NeedsPython,
    #[serde(rename = "needs_boxlite")]
    NeedsBoxLite,
    RepairNeeded,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxWslStatus {
    pub installed: bool,
    pub ready: bool,
    pub detail: Option<String>,
    pub recommended_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxPythonStatus {
    pub installed: bool,
    pub abi: Option<String>,
    pub supported: bool,
    pub detail: Option<String>,
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
pub struct SandboxReadinessReport {
    pub platform: String,
    pub platform_supported: bool,
    pub status: SandboxReadinessStatus,
    pub provider_name: String,
    pub runtime_mode: SandboxRuntimeMode,
    pub wsl: Option<SandboxWslStatus>,
    pub python: Option<SandboxPythonStatus>,
    pub boxlite: SandboxBoxLiteStatus,
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

#[cfg(test)]
mod tests {
    use super::SandboxReadinessStatus;

    #[test]
    fn needs_boxlite_serializes_without_extra_underscore() {
        let value = serde_json::to_string(&SandboxReadinessStatus::NeedsBoxLite).unwrap();
        assert_eq!(value, "\"needs_boxlite\"");
    }
}
