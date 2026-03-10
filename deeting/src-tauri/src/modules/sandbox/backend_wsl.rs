use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::installer::{is_supported_python_abi, supported_python_abis_label};
use crate::modules::sandbox::provider::SandboxProvider;
use crate::modules::sandbox::types::{
    SandboxExecutionOutput, SandboxIdentity, SandboxPythonStatus, SandboxWslStatus,
};

const BOXRUN_API_PREFIX: &str = "v1";

#[derive(Debug, Clone)]
pub struct WslBackendOptions {
    pub base_url: String,
    pub api_key: Option<String>,
    pub image: String,
    pub cpus: Option<u8>,
    pub memory_mib: Option<u32>,
    pub working_dir: Option<String>,
    pub python_bin: String,
}

#[derive(Clone)]
pub struct WslBoxrunBackend {
    client: Client,
    options: WslBackendOptions,
}

impl WslBoxrunBackend {
    pub fn new(options: WslBackendOptions) -> Result<Self, SandboxError> {
        ensure_wsl_available()?;

        if options.base_url.trim().is_empty() {
            return Err(SandboxError::Unavailable(
                "missing BOXRUN endpoint for WSL backend".to_string(),
            ));
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|err| SandboxError::Internal(err.to_string()))?;

        Ok(Self { client, options })
    }

    async fn get_box(&self, box_id_or_name: &str) -> Result<Option<SandboxIdentity>, SandboxError> {
        let url = self.url(&format!("/boxes/{box_id_or_name}"));
        let response = self.authorized(self.client.get(url)).send().await?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(SandboxError::Internal(format!(
                "get box failed: status={status} body={body}"
            )));
        }
        let box_resp: BoxResponse = response.json().await?;
        let sandbox_id = box_resp.id;
        Ok(Some(SandboxIdentity {
            sandbox_id,
            sandbox_name: box_resp.name.unwrap_or_else(|| box_id_or_name.to_string()),
        }))
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.api_base(), path)
    }

    fn api_base(&self) -> String {
        format!(
            "{}/{}",
            self.options.base_url.trim_end_matches('/'),
            BOXRUN_API_PREFIX
        )
    }

    fn authorized(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(api_key) = self.options.api_key.as_deref() {
            return builder.header("x-api-key", api_key);
        }
        builder
    }
}

#[async_trait]
impl SandboxProvider for WslBoxrunBackend {
    fn provider_name(&self) -> &str {
        "boxlite"
    }

    async fn probe(&self) -> Result<(), SandboxError> {
        let url = self.url("/boxes");
        let response = self.authorized(self.client.get(url)).send().await?;
        let status = response.status();
        if status.is_success() || status.as_u16() == 401 || status.as_u16() == 403 {
            return Ok(());
        }
        Err(SandboxError::Unavailable(format!(
            "boxrun WSL probe failed with status {}",
            status
        )))
    }

    async fn get_or_create_box(&self, box_name: &str) -> Result<SandboxIdentity, SandboxError> {
        if let Some(existing) = self.get_box(box_name).await? {
            return Ok(existing);
        }

        let payload = CreateBoxRequest {
            name: Some(box_name.to_string()),
            image: Some(self.options.image.clone()),
            cpu: self.options.cpus.map(|v| v.to_string()),
            memory: self.options.memory_mib.map(|v| format!("{v}Mi")),
            disk: None,
            cwd: self.options.working_dir.clone(),
            env: Option::<HashMap<String, String>>::None,
            entrypoint: None,
            cmd: None,
            user: None,
        };

        let url = self.url("/boxes");
        let response = self
            .authorized(self.client.post(url))
            .json(&payload)
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(SandboxError::Internal(format!(
                "create box failed: status={status} body={body}"
            )));
        }

        let created: BoxResponse = response.json().await?;
        let sandbox_id = created.id;
        Ok(SandboxIdentity {
            sandbox_id,
            sandbox_name: created.name.unwrap_or_else(|| box_name.to_string()),
        })
    }

    async fn stop_box(&self, box_id_or_name: &str) -> Result<(), SandboxError> {
        if self.get_box(box_id_or_name).await?.is_none() {
            return Ok(());
        }
        let url = self.url(&format!("/boxes/{box_id_or_name}:stop"));
        let response = self.authorized(self.client.post(url)).send().await?;
        if response.status().is_success() || response.status().as_u16() == 404 {
            return Ok(());
        }
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(SandboxError::Internal(format!(
            "stop box failed: status={status} body={body}"
        )))
    }

    async fn run_python(
        &self,
        box_id_or_name: &str,
        code: &str,
        timeout_seconds: u64,
    ) -> Result<SandboxExecutionOutput, SandboxError> {
        let identity = self
            .get_box(box_id_or_name)
            .await?
            .ok_or_else(|| SandboxError::NotFound(format!("sandbox {box_id_or_name} not found")))?;

        let request = ExecRequest {
            cmd: vec![
                self.options.python_bin.clone(),
                "-c".to_string(),
                code.to_string(),
            ],
            env: None,
            timeout_ms: Some(timeout_seconds.max(1).saturating_mul(1000)),
            cwd: self.options.working_dir.clone(),
        };

        let exec_url = self.url(&format!("/boxes/{}/exec-sync", identity.sandbox_id));
        let response = self
            .authorized(self.client.post(exec_url))
            .json(&request)
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if status.as_u16() == 409 {
                return Err(SandboxError::Busy(format!(
                    "synchronous execution failed: status={status} body={body}"
                )));
            }
            if status.as_u16() == 408 {
                return Err(SandboxError::Timeout(body));
            }
            return Err(classify_exec_error(status, &body));
        }

        let exec: SyncExecResponse = response.json().await?;

        Ok(SandboxExecutionOutput {
            stdout: split_output_lines(exec.stdout),
            stderr: split_output_lines(exec.stderr),
            exit_code: exec.exit_code,
            error_message: exec.error,
        })
    }
}

fn ensure_wsl_available() -> Result<(), SandboxError> {
    let status = diagnose_wsl_availability();
    if status.ready {
        return Ok(());
    }
    Err(SandboxError::Unavailable(status.detail.unwrap_or_else(
        || "wsl is installed but not ready; run `wsl --install` and initialize distro".to_string(),
    )))
}

pub fn diagnose_wsl_availability() -> SandboxWslStatus {
    match Command::new("wsl.exe").arg("--status").output() {
        Ok(output) if output.status.success() => SandboxWslStatus {
            installed: true,
            ready: true,
            detail: None,
            recommended_command: None,
        },
        Ok(output) => {
            let stderr = decode_wsl_text(&output.stderr);
            let stdout = decode_wsl_text(&output.stdout);
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                "wsl is installed but not ready; run `wsl --install` and initialize distro"
                    .to_string()
            };
            SandboxWslStatus {
                installed: true,
                ready: false,
                detail: Some(detail),
                recommended_command: Some("wsl --install".to_string()),
            }
        }
        Err(err) => SandboxWslStatus {
            installed: false,
            ready: false,
            detail: Some(format!("wsl unavailable: {err}")),
            recommended_command: Some("wsl --install".to_string()),
        },
    }
}

pub fn resolve_wsl_home_dir() -> Result<String, SandboxError> {
    ensure_wsl_available()?;
    let output = Command::new("wsl.exe")
        .args(["--", "sh", "-lc", "printf %s \"$HOME\""])
        .output()
        .map_err(|err| SandboxError::Unavailable(format!("failed to resolve WSL home: {err}")))?;
    if !output.status.success() {
        let detail = decode_wsl_text(&output.stderr);
        return Err(SandboxError::Unavailable(format!(
            "failed to resolve WSL home directory: {detail}"
        )));
    }
    let home = decode_wsl_text(&output.stdout);
    if home.is_empty() {
        return Err(SandboxError::Unavailable(
            "failed to resolve WSL home directory".to_string(),
        ));
    }
    Ok(home)
}

pub fn detect_wsl_python_abi(python_bin: &str) -> Result<String, SandboxError> {
    ensure_wsl_available()?;
    let script = format!(
        "{} -c 'import sys; print(f\"cp{{sys.version_info.major}}{{sys.version_info.minor}}\")'",
        shell_quote(python_bin)
    );
    let output = Command::new("wsl.exe")
        .args(["--", "sh", "-lc", &script])
        .output()
        .map_err(|err| SandboxError::Unavailable(format!("failed to inspect WSL python: {err}")))?;
    if !output.status.success() {
        let detail = decode_wsl_text(&output.stderr);
        return Err(SandboxError::Unavailable(format!(
            "WSL python3 is required for BoxLite installation: {detail}"
        )));
    }
    let abi = decode_wsl_text(&output.stdout);
    if abi.is_empty() {
        return Err(SandboxError::Unavailable(
            "failed to detect the WSL Python ABI".to_string(),
        ));
    }
    Ok(abi)
}

pub fn inspect_wsl_python(python_bin: &str) -> SandboxPythonStatus {
    match detect_wsl_python_abi(python_bin) {
        Ok(abi) => {
            let supported = is_supported_python_abi(&abi);
            SandboxPythonStatus {
                installed: true,
                abi: Some(abi.clone()),
                supported,
                detail: if supported {
                    None
                } else {
                    Some(format!(
                        "WSL Python ABI {abi} is not supported for the pinned BoxLite release. Supported ABIs: {}",
                        supported_python_abis_label()
                    ))
                },
            }
        }
        Err(err) => SandboxPythonStatus {
            installed: false,
            abi: None,
            supported: false,
            detail: Some(err.to_string()),
        },
    }
}

pub fn windows_path_to_wsl(path: &Path) -> Result<String, SandboxError> {
    ensure_wsl_available()?;
    let raw = normalize_windows_path_for_wsl(&path.display().to_string());
    let output = Command::new("wsl.exe")
        .args(["--", "wslpath", "-a", raw.as_str()])
        .output()
        .map_err(|err| {
            SandboxError::Unavailable(format!("failed to convert Windows path for WSL: {err}"))
        })?;
    if !output.status.success() {
        let detail = decode_wsl_text(&output.stderr);
        return Err(SandboxError::Unavailable(format!(
            "failed to convert Windows path for WSL: {detail}"
        )));
    }
    Ok(decode_wsl_text(&output.stdout))
}

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn normalize_windows_path_for_wsl(raw: &str) -> String {
    raw.trim().replace('\\', "/")
}

fn decode_wsl_text(bytes: &[u8]) -> String {
    let trimmed_bytes = if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        &bytes[2..]
    } else {
        bytes
    };

    if should_decode_as_utf16le(trimmed_bytes) {
        let mut units = Vec::with_capacity(trimmed_bytes.len() / 2);
        for chunk in trimmed_bytes.chunks_exact(2) {
            units.push(u16::from_le_bytes([chunk[0], chunk[1]]));
        }
        let decoded = String::from_utf16_lossy(&units);
        return decoded.trim_matches(char::from(0)).trim().to_string();
    }

    String::from_utf8_lossy(trimmed_bytes).trim().to_string()
}

fn should_decode_as_utf16le(bytes: &[u8]) -> bool {
    if bytes.len() < 2 || bytes.len() % 2 != 0 {
        return false;
    }
    let zero_bytes = bytes
        .iter()
        .skip(1)
        .step_by(2)
        .filter(|byte| **byte == 0)
        .count();
    zero_bytes * 2 >= bytes.len() / 2
}

fn split_output_lines(raw: String) -> Vec<String> {
    if raw.is_empty() {
        return Vec::new();
    }
    raw.lines().map(|line| line.to_string()).collect()
}

#[derive(Debug, Serialize)]
struct CreateBoxRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpu: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    memory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    disk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    entrypoint: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cmd: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BoxResponse {
    id: String,
    name: Option<String>,
}

#[derive(Debug, Serialize)]
struct ExecRequest {
    cmd: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SyncExecResponse {
    stdout: String,
    stderr: String,
    exit_code: i32,
    error: Option<String>,
}

fn classify_exec_error(status: reqwest::StatusCode, body: &str) -> SandboxError {
    let detail = format!("synchronous execution failed: status={status} body={body}");
    if status.as_u16() == 404 || missing_box_detail(body) {
        return SandboxError::NotFound(detail);
    }
    SandboxError::Internal(detail)
}

fn missing_box_detail(body: &str) -> bool {
    let lowered = body.to_lowercase();
    (lowered.contains("not found") && (lowered.contains("box") || lowered.contains("sandbox")))
        || lowered.contains("does not exist")
        || lowered.contains("no such box")
}

#[cfg(test)]
mod tests {
    use super::{
        classify_exec_error, decode_wsl_text, normalize_windows_path_for_wsl, SandboxError,
    };

    #[test]
    fn classify_exec_error_maps_404_to_not_found() {
        let err = classify_exec_error(reqwest::StatusCode::NOT_FOUND, "{\"error\":\"not found\"}");
        assert!(matches!(err, SandboxError::NotFound(_)));
    }

    #[test]
    fn classify_exec_error_maps_missing_id_body_to_not_found() {
        let err = classify_exec_error(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            "box id does not exist",
        );
        assert!(matches!(err, SandboxError::NotFound(_)));
    }

    #[test]
    fn normalize_windows_path_replaces_backslashes() {
        assert_eq!(
            normalize_windows_path_for_wsl(
                r"C:\Users\timeline\AppData\Roaming\com.deeting.app\boxrun\sandbox\downloads\boxlite.whl"
            ),
            "C:/Users/timeline/AppData/Roaming/com.deeting.app/boxrun/sandbox/downloads/boxlite.whl"
        );
    }

    #[test]
    fn decode_wsl_text_supports_utf16le_output() {
        let utf16: Vec<u8> = "wslpath: C:/Users/timeline/boxlite.whl"
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect();
        assert_eq!(
            decode_wsl_text(&utf16),
            "wslpath: C:/Users/timeline/boxlite.whl"
        );
    }
}
