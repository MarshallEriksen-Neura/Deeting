use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::utils::configure_background_tokio_command;

use super::bridge_protocol::{
    BridgeEnvelope, BridgeRequest, BridgeResponseEnvelope, BridgeResponsePayload,
};
use super::types::{WechatGetUpdatesResponse, WechatQrCodeResponse, WechatQrStatusResponse};

#[derive(Clone)]
pub struct WechatBridgeClient {
    process: Arc<Mutex<Option<BridgeProcess>>>,
}

struct BridgeProcess {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

struct BridgeLaunchSpec {
    program: PathBuf,
    envs: Vec<(String, String)>,
}

impl WechatBridgeClient {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn fetch_login_qr(&self, base_url: &str) -> Result<WechatQrCodeResponse, String> {
        let response = self
            .send(BridgeRequest::FetchLoginQr {
                base_url: base_url.trim().to_string(),
            })
            .await?;
        match response.payload {
            BridgeResponsePayload::FetchLoginQr { data } => Ok(data),
            BridgeResponsePayload::Error { message } => Err(message),
            _ => Err("wechat bridge returned unexpected response".to_string()),
        }
    }

    pub async fn fetch_qr_status(
        &self,
        base_url: &str,
        qrcode_id: &str,
    ) -> Result<WechatQrStatusResponse, String> {
        let response = self
            .send(BridgeRequest::FetchQrStatus {
                base_url: base_url.trim().to_string(),
                qrcode_id: qrcode_id.trim().to_string(),
            })
            .await?;
        match response.payload {
            BridgeResponsePayload::FetchQrStatus { data } => Ok(data),
            BridgeResponsePayload::Error { message } => Err(message),
            _ => Err("wechat bridge returned unexpected response".to_string()),
        }
    }

    pub async fn get_updates(
        &self,
        base_url: &str,
        token: &str,
        cursor: &str,
    ) -> Result<WechatGetUpdatesResponse, String> {
        let response = self
            .send(BridgeRequest::GetUpdates {
                base_url: base_url.trim().to_string(),
                token: token.trim().to_string(),
                cursor: cursor.trim().to_string(),
            })
            .await?;
        match response.payload {
            BridgeResponsePayload::GetUpdates { data } => Ok(data),
            BridgeResponsePayload::Error { message } => Err(message),
            _ => Err("wechat bridge returned unexpected response".to_string()),
        }
    }

    pub async fn send_text(
        &self,
        base_url: &str,
        token: &str,
        contact_id: &str,
        text: &str,
        context_token: &str,
    ) -> Result<(), String> {
        let response = self
            .send(BridgeRequest::SendText {
                base_url: base_url.trim().to_string(),
                token: token.trim().to_string(),
                contact_id: contact_id.trim().to_string(),
                text: text.to_string(),
                context_token: context_token.trim().to_string(),
            })
            .await?;
        match response.payload {
            BridgeResponsePayload::SendText { ok } if ok => Ok(()),
            BridgeResponsePayload::Error { message } => Err(message),
            _ => Err("wechat bridge returned unexpected response".to_string()),
        }
    }

    async fn send(&self, request: BridgeRequest) -> Result<BridgeResponseEnvelope, String> {
        match self.send_once(request.clone()).await {
            Ok(response) => Ok(response),
            Err(first_error) => {
                *self.process.lock().await = None;
                self.send_once(request)
                    .await
                    .map_err(|second_error| format!("{first_error}; retry_failed: {second_error}"))
            }
        }
    }

    async fn send_once(&self, request: BridgeRequest) -> Result<BridgeResponseEnvelope, String> {
        let mut process = self.process.lock().await;
        if process.is_none() {
            *process = Some(spawn_bridge_process().await?);
        }
        let process = process
            .as_mut()
            .ok_or_else(|| "wechat bridge process is unavailable".to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let payload = serde_json::to_string(&BridgeEnvelope {
            id: id.clone(),
            request,
        })
        .map_err(|err| err.to_string())?;
        process
            .stdin
            .write_all(payload.as_bytes())
            .await
            .map_err(|err| err.to_string())?;
        process
            .stdin
            .write_all(b"\n")
            .await
            .map_err(|err| err.to_string())?;
        process.stdin.flush().await.map_err(|err| err.to_string())?;

        let mut line = String::new();
        process
            .stdout
            .read_line(&mut line)
            .await
            .map_err(|err| err.to_string())?;
        if line.trim().is_empty() {
            return Err("wechat bridge returned empty response".to_string());
        }
        let envelope: BridgeResponseEnvelope =
            serde_json::from_str(line.trim()).map_err(|err| err.to_string())?;
        if envelope.id != id {
            return Err("wechat bridge response id mismatch".to_string());
        }
        Ok(envelope)
    }
}

async fn spawn_bridge_process() -> Result<BridgeProcess, String> {
    let launch = bridge_launch_spec()?;
    let mut command = Command::new(&launch.program);
    configure_background_tokio_command(&mut command);
    command.envs(launch.envs);
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|err| err.to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "wechat bridge stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "wechat bridge stdout unavailable".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    log::warn!("wechat bridge stderr line='{}'", trimmed);
                }
            }
        });
    }
    Ok(BridgeProcess {
        _child: child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

fn bridge_launch_spec() -> Result<BridgeLaunchSpec, String> {
    if let Ok(raw) = std::env::var("DEETING_WECHAT_BRIDGE_BIN") {
        let path = PathBuf::from(raw.trim());
        if path.exists() {
            return Ok(BridgeLaunchSpec {
                program: path,
                envs: Vec::new(),
            });
        }
    }

    let current = std::env::current_exe().map_err(|err| err.to_string())?;
    let Some(parent) = current.parent() else {
        return Err("failed to resolve current executable parent".to_string());
    };

    let binary_name = if cfg!(windows) {
        "deeting-wechat-bridge.exe"
    } else {
        "deeting-wechat-bridge"
    };

    let direct = parent.join(binary_name);
    if direct.exists() {
        return Ok(BridgeLaunchSpec {
            program: direct,
            envs: Vec::new(),
        });
    }

    let sibling = parent.parent().unwrap_or(parent).join(binary_name);
    if sibling.exists() {
        return Ok(BridgeLaunchSpec {
            program: sibling,
            envs: Vec::new(),
        });
    }

    Ok(BridgeLaunchSpec {
        program: current,
        envs: vec![("DEETING_WECHAT_BRIDGE_MODE".to_string(), "1".to_string())],
    })
}
