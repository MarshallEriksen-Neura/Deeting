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
