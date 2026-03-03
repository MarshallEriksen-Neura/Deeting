use std::collections::HashMap;
use std::process::Command;
use std::time::Duration;

use base64::Engine;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::types::{SandboxExecutionOutput, SandboxIdentity};

#[derive(Debug, Clone)]
pub struct WslBackendOptions {
    pub base_url: String,
    pub api_prefix: String,
    pub image: String,
    pub cpus: Option<u8>,
    pub memory_mib: Option<u32>,
    pub working_dir: Option<String>,
    pub python_bin: String,
}

#[derive(Clone)]
pub struct WslBoxliteBackend {
    client: Client,
    options: WslBackendOptions,
}

impl WslBoxliteBackend {
    pub fn new(options: WslBackendOptions) -> Result<Self, SandboxError> {
        ensure_wsl_available()?;

        if options.base_url.trim().is_empty() {
            return Err(SandboxError::Unavailable(
                "missing BOXLITE_REST_URL for WSL bridge".to_string(),
            ));
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|err| SandboxError::Internal(err.to_string()))?;

        Ok(Self { client, options })
    }

    pub async fn probe(&self) -> Result<(), SandboxError> {
        let url = self.url_root("/config");
        let response = self.client.get(url).send().await?;
        if response.status().is_success() {
            return Ok(());
        }
        Err(SandboxError::Unavailable(format!(
            "boxlite WSL bridge probe failed with status {}",
            response.status()
        )))
    }

    pub async fn get_or_create_box(&self, box_name: &str) -> Result<SandboxIdentity, SandboxError> {
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
            detach: Some(false),
            security: None,
        };

        let url = self.url("/boxes");
        let response = self.client.post(url).json(&payload).send().await?;
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

    pub async fn stop_box(&self, box_id_or_name: &str) -> Result<(), SandboxError> {
        if self.get_box(box_id_or_name).await?.is_none() {
            return Ok(());
        }
        let url = self.url(&format!("/boxes/{box_id_or_name}/stop"));
        let response = self.client.post(url).send().await?;
        if response.status().is_success() || response.status().as_u16() == 404 {
            return Ok(());
        }
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(SandboxError::Internal(format!(
            "stop box failed: status={status} body={body}"
        )))
    }

    pub async fn run_python(
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
            env: None,
            timeout_seconds: Some(timeout_seconds.max(1) as f64),
            working_dir: self.options.working_dir.clone(),
            tty: false,
        };

        let create_exec_url = self.url(&format!("/boxes/{}/exec", identity.sandbox_id));
        let create_response = self
            .client
            .post(create_exec_url)
            .json(&request)
            .send()
            .await?;
        if !create_response.status().is_success() {
            let status = create_response.status();
            let body = create_response.text().await.unwrap_or_default();
            if status.as_u16() == 409 {
                return Err(SandboxError::Busy(format!(
                    "create execution failed: status={status} body={body}"
                )));
            }
            return Err(SandboxError::Internal(format!(
                "create execution failed: status={status} body={body}"
            )));
        }

        let exec: ExecResponse = create_response.json().await?;
        let output_url = self.url(&format!(
            "/boxes/{}/executions/{}/output",
            identity.sandbox_id, exec.execution_id
        ));
        let output_response = self
            .client
            .get(output_url)
            .header("Accept", "text/event-stream")
            .send()
            .await?;
        if !output_response.status().is_success() {
            let status = output_response.status();
            let body = output_response.text().await.unwrap_or_default();
            return Err(SandboxError::Internal(format!(
                "execution output stream failed: status={status} body={body}"
            )));
        }

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = -1;
        let mut error_message = None;

        let mut stream = output_response.bytes_stream();
        let mut buffer = String::new();
        let mut current_event = String::new();
        let mut current_data = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|err| SandboxError::Internal(err.to_string()))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() {
                    let done = dispatch_sse_event(
                        &current_event,
                        &current_data,
                        &mut stdout,
                        &mut stderr,
                        &mut exit_code,
                        &mut error_message,
                    );
                    current_event.clear();
                    current_data.clear();
                    if done {
                        break;
                    }
                } else if let Some(value) = line.strip_prefix("event: ") {
                    current_event = value.to_string();
                } else if let Some(value) = line.strip_prefix("data: ") {
                    if !current_data.is_empty() {
                        current_data.push('\n');
                    }
                    current_data.push_str(value);
                }
            }

            if exit_code != -1 {
                break;
            }
        }

        Ok(SandboxExecutionOutput {
            stdout,
            stderr,
            exit_code,
            error_message,
        })
    }

    pub async fn shutdown(&self) -> Result<(), SandboxError> {
        Ok(())
    }

    async fn get_box(&self, box_id_or_name: &str) -> Result<Option<SandboxIdentity>, SandboxError> {
        let url = self.url(&format!("/boxes/{box_id_or_name}"));
        let response = self.client.get(url).send().await?;
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
        Ok(Some(SandboxIdentity {
            sandbox_id: box_resp.box_id,
            sandbox_name: box_resp.name.unwrap_or_else(|| box_id_or_name.to_string()),
        }))
    }

    fn url(&self, path: &str) -> String {
        format!(
            "{}/{}/default{}",
            self.options.base_url.trim_end_matches('/'),
            self.options.api_prefix.trim_matches('/'),
            path
        )
    }

    fn url_root(&self, path: &str) -> String {
        format!(
            "{}/{}{}",
            self.options.base_url.trim_end_matches('/'),
            self.options.api_prefix.trim_matches('/'),
            path
        )
    }
}

fn ensure_wsl_available() -> Result<(), SandboxError> {
    let status = Command::new("wsl.exe")
        .arg("--status")
        .status()
        .map_err(|err| SandboxError::Unavailable(format!("wsl unavailable: {err}")))?;
    if status.success() {
        return Ok(());
    }
    Err(SandboxError::Unavailable(
        "wsl is installed but not ready; run `wsl --install` and initialize distro".to_string(),
    ))
}

fn dispatch_sse_event(
    event: &str,
    data: &str,
    stdout: &mut Vec<String>,
    stderr: &mut Vec<String>,
    exit_code: &mut i32,
    error_message: &mut Option<String>,
) -> bool {
    if data.is_empty() {
        return false;
    }

    match event {
        "stdout" => {
            if let Some(decoded) = decode_event_data(data) {
                stdout.push(decoded);
            }
            false
        }
        "stderr" => {
            if let Some(decoded) = decode_event_data(data) {
                stderr.push(decoded);
            }
            false
        }
        "exit" => {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                *exit_code = parsed
                    .get("exit_code")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(-1) as i32;
                *error_message = parsed
                    .get("error")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
            true
        }
        "error" => {
            *exit_code = -1;
            *error_message = Some(data.to_string());
            true
        }
        _ => false,
    }
}

fn decode_event_data(data: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
    let b64 = parsed.get("data")?.as_str()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .ok()?;
    String::from_utf8(bytes).ok()
}

#[derive(Debug, Serialize)]
struct CreateBoxRequest {
    name: Option<String>,
    image: Option<String>,
    rootfs_path: Option<String>,
    cpus: Option<u8>,
    memory_mib: Option<u32>,
    disk_size_gb: Option<u64>,
    working_dir: Option<String>,
    env: Option<HashMap<String, String>>,
    entrypoint: Option<Vec<String>>,
    cmd: Option<Vec<String>>,
    user: Option<String>,
    auto_remove: Option<bool>,
    detach: Option<bool>,
    security: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct BoxResponse {
    box_id: String,
    name: Option<String>,
}

#[derive(Debug, Serialize)]
struct ExecRequest {
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    timeout_seconds: Option<f64>,
    working_dir: Option<String>,
    tty: bool,
}

#[derive(Debug, Deserialize)]
struct ExecResponse {
    execution_id: String,
}
