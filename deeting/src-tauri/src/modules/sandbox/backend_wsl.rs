use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::provider::SandboxProvider;
use crate::modules::sandbox::types::{SandboxExecutionOutput, SandboxIdentity, SandboxWslStatus};
use crate::utils::configure_background_std_command;

const BOXRUN_API_PREFIX: &str = "v1";
const BOXLITE_API_PREFIX: &str = "default";

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

    async fn list_boxes(&self) -> Result<Vec<BoxResponse>, SandboxError> {
        let url = self.url("/boxes");
        let response = self.authorized(self.client.get(url)).send().await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(SandboxError::Internal(format!(
                "list boxes failed: status={status} body={body}"
            )));
        }
        let list: ListBoxesResponse = response.json().await?;
        Ok(list.boxes)
    }

    async fn get_box(&self, box_id_or_name: &str) -> Result<Option<SandboxIdentity>, SandboxError> {
        let boxes = self.list_boxes().await?;
        let found = boxes.into_iter().find(|box_resp| {
            box_resp.box_id == box_id_or_name
                || box_resp.name.as_deref() == Some(box_id_or_name)
        });
        Ok(found.map(|box_resp| SandboxIdentity {
            sandbox_id: box_resp.box_id,
            sandbox_name: box_resp
                .name
                .unwrap_or_else(|| box_id_or_name.to_string()),
        }))
    }

    async fn close_execution_stdin(
        &self,
        box_id: &str,
        execution_id: &str,
    ) -> Result<(), SandboxError> {
        let url = self.url(&format!("/boxes/{box_id}/executions/{execution_id}/input"));
        let response = self
            .authorized(
                self.client
                    .post(url)
                    .header("X-Close-Stdin", "true")
                    .body(Vec::new()),
            )
            .send()
            .await?;
        if response.status().is_success() {
            return Ok(());
        }

        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(classify_exec_error(status, &body))
    }

    async fn collect_execution_output(
        &self,
        box_id: &str,
        execution_id: &str,
    ) -> Result<SandboxExecutionOutput, SandboxError> {
        let url = self.url(&format!("/boxes/{box_id}/executions/{execution_id}/output"));
        let response = self
            .authorized(
                self.client
                    .get(url)
                    .header("Accept", "text/event-stream"),
            )
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(classify_exec_error(status, &body));
        }

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = -1;
        let mut error_message = None;

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut current_event = String::new();
        let mut current_data = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|err| SandboxError::Network(err.to_string()))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() {
                    dispatch_sse_event(
                        &current_event,
                        &current_data,
                        &mut stdout,
                        &mut stderr,
                        &mut exit_code,
                        &mut error_message,
                    );
                    current_event.clear();
                    current_data.clear();
                } else if let Some(value) = line.strip_prefix("event: ") {
                    current_event = value.to_string();
                } else if let Some(value) = line.strip_prefix("data: ") {
                    if !current_data.is_empty() {
                        current_data.push('\n');
                    }
                    current_data.push_str(value);
                }
            }
        }

        if !current_event.is_empty() || !current_data.is_empty() {
            dispatch_sse_event(
                &current_event,
                &current_data,
                &mut stdout,
                &mut stderr,
                &mut exit_code,
                &mut error_message,
            );
        }

        Ok(SandboxExecutionOutput {
            stdout,
            stderr,
            exit_code,
            error_message,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.api_base(), path)
    }

    fn api_base(&self) -> String {
        format!(
            "{}/{}/{}",
            self.options.base_url.trim_end_matches('/'),
            BOXRUN_API_PREFIX,
            BOXLITE_API_PREFIX
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
            rootfs_path: None,
            cpus: self.options.cpus,
            memory_mib: self.options.memory_mib,
            disk_size_gb: None,
            working_dir: self.options.working_dir.clone(),
            env: Option::<HashMap<String, String>>::None,
            entrypoint: None,
            cmd: None,
            user: None,
            auto_remove: Some(false),
            detach: Some(true),
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
        Ok(SandboxIdentity {
            sandbox_id: created.box_id,
            sandbox_name: created.name.unwrap_or_else(|| box_name.to_string()),
        })
    }

    async fn stop_box(&self, box_id_or_name: &str) -> Result<(), SandboxError> {
        let Some(identity) = self.get_box(box_id_or_name).await? else {
            return Ok(());
        };

        let url = self.url(&format!("/boxes/{}/stop", identity.sandbox_id));
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
            command: self.options.python_bin.clone(),
            args: vec!["-c".to_string(), code.to_string()],
            stdin: None,
            env: None,
            timeout_seconds: Some(timeout_seconds.max(1) as f64),
            working_dir: self.options.working_dir.clone(),
            tty: false,
        };

        let exec_url = self.url(&format!("/boxes/{}/exec", identity.sandbox_id));
        let response = self
            .authorized(self.client.post(exec_url))
            .json(&request)
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(classify_exec_error(status, &body));
        }

        let exec: ExecResponse = response.json().await?;
        let _ = self
            .close_execution_stdin(&identity.sandbox_id, &exec.execution_id)
            .await;

        self.collect_execution_output(&identity.sandbox_id, &exec.execution_id)
            .await
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
    let mut command = Command::new("wsl.exe");
    configure_background_std_command(&mut command);
    match command.arg("--status").output() {
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
    let mut command = Command::new("wsl.exe");
    configure_background_std_command(&mut command);
    let output = command
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

pub fn detect_wsl_arch() -> Result<String, SandboxError> {
    ensure_wsl_available()?;
    let mut command = Command::new("wsl.exe");
    configure_background_std_command(&mut command);
    let output = command
        .args(["--", "sh", "-lc", "uname -m"])
        .output()
        .map_err(|err| {
            SandboxError::Unavailable(format!("failed to inspect WSL architecture: {err}"))
        })?;
    if !output.status.success() {
        let detail = decode_wsl_text(&output.stderr);
        return Err(SandboxError::Unavailable(format!(
            "failed to inspect WSL architecture: {detail}"
        )));
    }
    let arch = decode_wsl_text(&output.stdout);
    if arch.is_empty() {
        return Err(SandboxError::Unavailable(
            "failed to detect the WSL architecture".to_string(),
        ));
    }
    Ok(arch)
}

pub fn windows_path_to_wsl(path: &Path) -> Result<String, SandboxError> {
    ensure_wsl_available()?;
    let raw = normalize_windows_path_for_wsl(&path.display().to_string());
    let mut command = Command::new("wsl.exe");
    configure_background_std_command(&mut command);
    let output = command
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
    rootfs_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpus: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    memory_mib: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    disk_size_gb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    working_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    entrypoint: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cmd: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_remove: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detach: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ListBoxesResponse {
    boxes: Vec<BoxResponse>,
}

#[derive(Debug, Deserialize)]
struct BoxResponse {
    box_id: String,
    name: Option<String>,
}

#[derive(Debug, Serialize)]
struct ExecRequest {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stdin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    working_dir: Option<String>,
    #[serde(default)]
    tty: bool,
}

#[derive(Debug, Deserialize)]
struct ExecResponse {
    execution_id: String,
}

fn classify_exec_error(status: reqwest::StatusCode, body: &str) -> SandboxError {
    let detail = format!("execution failed: status={status} body={body}");
    if status.as_u16() == 404 || missing_box_detail(body) {
        return SandboxError::NotFound(detail);
    }
    if status.as_u16() == 409 {
        return SandboxError::Busy(detail);
    }
    if status.as_u16() == 408 {
        return SandboxError::Timeout(detail);
    }
    SandboxError::Internal(detail)
}

fn missing_box_detail(body: &str) -> bool {
    let lowered = body.to_lowercase();
    (lowered.contains("not found") && (lowered.contains("box") || lowered.contains("sandbox")))
        || lowered.contains("does not exist")
        || lowered.contains("no such box")
}

fn dispatch_sse_event(
    event: &str,
    data: &str,
    stdout: &mut Vec<String>,
    stderr: &mut Vec<String>,
    exit_code: &mut i32,
    error_message: &mut Option<String>,
) {
    if data.is_empty() {
        return;
    }

    match event {
        "stdout" => {
            if let Some(decoded) = extract_and_decode_b64(data) {
                stdout.extend(split_output_lines(decoded));
            }
        }
        "stderr" => {
            if let Some(decoded) = extract_and_decode_b64(data) {
                stderr.extend(split_output_lines(decoded));
            }
        }
        "exit" => {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                *exit_code = parsed
                    .get("exit_code")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(-1) as i32;
                *error_message = parsed
                    .get("error")
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string());
            }
        }
        "error" => {
            *error_message = Some(data.to_string());
        }
        _ => {}
    }
}

fn extract_and_decode_b64(data: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
    let encoded = parsed.get("data")?.as_str()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .ok()?;
    String::from_utf8(bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::{decode_wsl_text, normalize_windows_path_for_wsl};

    #[test]
    fn normalize_windows_path_replaces_backslashes() {
        assert_eq!(
            normalize_windows_path_for_wsl(
                r"C:\Users\timeline\AppData\Roaming\com.deeting.app\boxrun\sandbox\downloads\boxlite.tar.gz"
            ),
            "C:/Users/timeline/AppData/Roaming/com.deeting.app/boxrun/sandbox/downloads/boxlite.tar.gz"
        );
    }

    #[test]
    fn decode_wsl_text_supports_utf16le_output() {
        let utf16: Vec<u8> = "wslpath: C:/Users/timeline/boxlite.tar.gz"
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect();
        assert_eq!(
            decode_wsl_text(&utf16),
            "wslpath: C:/Users/timeline/boxlite.tar.gz"
        );
    }
}
