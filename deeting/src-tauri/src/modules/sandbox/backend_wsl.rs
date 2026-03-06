use std::collections::HashMap;
use std::process::Command;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::provider::SandboxProvider;
use crate::modules::sandbox::types::{SandboxExecutionOutput, SandboxIdentity};

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

        let create_exec_url = self.url(&format!("/boxes/{}/exec", identity.sandbox_id));
        let create_response = self
            .authorized(self.client.post(create_exec_url))
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
        let execution_id = exec.id;
        let output_url = self.url(&format!(
            "/boxes/{}/exec/{}/events",
            identity.sandbox_id, execution_id
        ));
        let output_response = self
            .authorized(self.client.get(output_url))
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
        let mut finished = false;

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
                        finished = true;
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

            if finished {
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
        "error" => {
            *exit_code = -1;
            *error_message = Some(decode_event_data(data).unwrap_or_else(|| data.to_string()));
            true
        }
        _ => {
            let parsed = serde_json::from_str::<serde_json::Value>(data).ok();
            let lower_event = event.to_ascii_lowercase();

            if let Some(parsed) = parsed.as_ref() {
                if let Some(code) = extract_exit_code(parsed) {
                    *exit_code = code;
                    if error_message.is_none() {
                        *error_message = parsed
                            .get("error")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                    }
                    if lower_event.contains("exit")
                        || lower_event.contains("done")
                        || lower_event.contains("complete")
                    {
                        return true;
                    }
                }

                if let Some(stream_name) = parsed.get("stream").and_then(|v| v.as_str()) {
                    if let Some(text) = extract_text_data(parsed) {
                        if stream_name.eq_ignore_ascii_case("stderr") {
                            stderr.push(text);
                        } else {
                            stdout.push(text);
                        }
                    }
                    return false;
                }
            }

            if lower_event.contains("stderr") {
                if let Some(text) = decode_event_data(data) {
                    stderr.push(text);
                }
                return false;
            }
            if lower_event.contains("stdout")
                || lower_event == "chunk"
                || lower_event == "message"
                || lower_event.is_empty()
            {
                if let Some(text) = decode_event_data(data) {
                    stdout.push(text);
                }
            }

            false
        }
    }
}

fn decode_event_data(data: &str) -> Option<String> {
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
        if let Some(text) = extract_text_data(&parsed) {
            return Some(text);
        }
    }
    let trimmed = data.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn extract_text_data(parsed: &serde_json::Value) -> Option<String> {
    if let Some(raw_data) = parsed.get("data").and_then(|v| v.as_str()) {
        if let Some(decoded) = decode_base64(raw_data) {
            return Some(decoded);
        }
        let trimmed = raw_data.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    for key in ["chunk", "text", "line", "message"] {
        if let Some(value) = parsed.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    if let Some(output_text) = parsed.get("output").and_then(|v| v.as_str()) {
        let trimmed = output_text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    None
}

fn decode_base64(value: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .ok()?;
    String::from_utf8(bytes).ok()
}

fn extract_exit_code(parsed: &serde_json::Value) -> Option<i32> {
    for key in ["exit_code", "exitCode", "code"] {
        if let Some(value) = parsed.get(key).and_then(|v| v.as_i64()) {
            return Some(value as i32);
        }
    }
    None
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
struct ExecResponse {
    id: String,
}
