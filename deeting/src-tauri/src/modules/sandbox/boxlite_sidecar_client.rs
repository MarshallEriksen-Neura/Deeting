use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use boxlite_sidecar_protocol::{
    BoxliteSidecarConnection, BoxliteSidecarCreateBoxOptions, BoxliteSidecarEnvelope,
    BoxliteSidecarErrorKind, BoxliteSidecarExecutionOutput, BoxliteSidecarIdentity,
    BoxliteSidecarRequest, BoxliteSidecarResponseEnvelope, BoxliteSidecarResponsePayload,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::types::{SandboxExecutionOutput, SandboxIdentity};
use crate::utils::configure_background_tokio_command;

const BOXLITE_SIDECAR_ENV: &str = "DEETING_BOXLITE_SIDECAR_BIN";

#[derive(Clone)]
pub struct BoxLiteSidecarClient {
    process: Arc<Mutex<Option<SidecarProcess>>>,
}

struct SidecarProcess {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

struct SidecarLaunchSpec {
    program: PathBuf,
}

impl BoxLiteSidecarClient {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
        }
    }

    pub fn ensure_launchable() -> Result<(), String> {
        let _ = sidecar_launch_spec()?;
        Ok(())
    }

    pub async fn probe(&self, connection: &BoxliteSidecarConnection) -> Result<(), SandboxError> {
        let response = self
            .send(BoxliteSidecarRequest::Probe {
                connection: connection.clone(),
            })
            .await?;
        match response.payload {
            BoxliteSidecarResponsePayload::Probe { ok } if ok => Ok(()),
            BoxliteSidecarResponsePayload::Error {
                error_kind,
                message,
            } => Err(map_sidecar_error(error_kind, message)),
            _ => Err(SandboxError::Internal(
                "boxlite sidecar returned unexpected probe response".to_string(),
            )),
        }
    }

    pub async fn get_or_create_box(
        &self,
        connection: &BoxliteSidecarConnection,
        box_name: &str,
        options: BoxliteSidecarCreateBoxOptions,
    ) -> Result<SandboxIdentity, SandboxError> {
        let response = self
            .send(BoxliteSidecarRequest::GetOrCreateBox {
                connection: connection.clone(),
                box_name: box_name.trim().to_string(),
                options,
            })
            .await?;
        match response.payload {
            BoxliteSidecarResponsePayload::GetOrCreateBox { data } => {
                Ok(identity_from_sidecar(data))
            }
            BoxliteSidecarResponsePayload::Error {
                error_kind,
                message,
            } => Err(map_sidecar_error(error_kind, message)),
            _ => Err(SandboxError::Internal(
                "boxlite sidecar returned unexpected get_or_create_box response".to_string(),
            )),
        }
    }

    pub async fn stop_box(
        &self,
        connection: &BoxliteSidecarConnection,
        box_id_or_name: &str,
    ) -> Result<(), SandboxError> {
        let response = self
            .send(BoxliteSidecarRequest::StopBox {
                connection: connection.clone(),
                box_id_or_name: box_id_or_name.trim().to_string(),
            })
            .await?;
        match response.payload {
            BoxliteSidecarResponsePayload::StopBox { ok } if ok => Ok(()),
            BoxliteSidecarResponsePayload::Error {
                error_kind,
                message,
            } => Err(map_sidecar_error(error_kind, message)),
            _ => Err(SandboxError::Internal(
                "boxlite sidecar returned unexpected stop_box response".to_string(),
            )),
        }
    }

    pub async fn run_python(
        &self,
        connection: &BoxliteSidecarConnection,
        box_id_or_name: &str,
        python_bin: &str,
        code: &str,
        timeout_seconds: u64,
        working_dir: Option<&str>,
    ) -> Result<SandboxExecutionOutput, SandboxError> {
        let response = self
            .send(BoxliteSidecarRequest::RunPython {
                connection: connection.clone(),
                box_id_or_name: box_id_or_name.trim().to_string(),
                python_bin: python_bin.trim().to_string(),
                code: code.to_string(),
                timeout_seconds,
                working_dir: working_dir
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned),
            })
            .await?;
        match response.payload {
            BoxliteSidecarResponsePayload::RunPython { data } => Ok(output_from_sidecar(data)),
            BoxliteSidecarResponsePayload::Error {
                error_kind,
                message,
            } => Err(map_sidecar_error(error_kind, message)),
            _ => Err(SandboxError::Internal(
                "boxlite sidecar returned unexpected run_python response".to_string(),
            )),
        }
    }

    async fn send(
        &self,
        request: BoxliteSidecarRequest,
    ) -> Result<BoxliteSidecarResponseEnvelope, SandboxError> {
        match self.send_once(request.clone()).await {
            Ok(response) => Ok(response),
            Err(first_error) => {
                *self.process.lock().await = None;
                self.send_once(request).await.map_err(|second_error| {
                    SandboxError::Internal(format!("{first_error}; retry_failed: {second_error}"))
                })
            }
        }
    }

    async fn send_once(
        &self,
        request: BoxliteSidecarRequest,
    ) -> Result<BoxliteSidecarResponseEnvelope, String> {
        let mut process = self.process.lock().await;
        if process.is_none() {
            *process = Some(spawn_sidecar_process().await?);
        }
        let process = process
            .as_mut()
            .ok_or_else(|| "boxlite sidecar process is unavailable".to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let payload = serde_json::to_string(&BoxliteSidecarEnvelope {
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
            return Err("boxlite sidecar returned empty response".to_string());
        }

        let envelope: BoxliteSidecarResponseEnvelope =
            serde_json::from_str(line.trim()).map_err(|err| err.to_string())?;
        if envelope.id != id {
            return Err("boxlite sidecar response id mismatch".to_string());
        }
        Ok(envelope)
    }
}

async fn spawn_sidecar_process() -> Result<SidecarProcess, String> {
    let launch = sidecar_launch_spec()?;
    let mut command = Command::new(&launch.program);
    configure_background_tokio_command(&mut command);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|err| err.to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "boxlite sidecar stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "boxlite sidecar stdout unavailable".to_string())?;

    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    log::warn!("boxlite sidecar stderr line='{}'", trimmed);
                }
            }
        });
    }

    Ok(SidecarProcess {
        _child: child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

fn sidecar_launch_spec() -> Result<SidecarLaunchSpec, String> {
    if let Ok(raw) = std::env::var(BOXLITE_SIDECAR_ENV) {
        let path = PathBuf::from(raw.trim());
        if path.exists() {
            return Ok(SidecarLaunchSpec { program: path });
        }
    }

    let current = std::env::current_exe().map_err(|err| err.to_string())?;
    let Some(parent) = current.parent() else {
        return Err("failed to resolve current executable parent".to_string());
    };

    let binary_name = if cfg!(windows) {
        "deeting-boxlite-sidecar.exe"
    } else {
        "deeting-boxlite-sidecar"
    };

    let direct = parent.join(binary_name);
    if direct.exists() {
        return Ok(SidecarLaunchSpec { program: direct });
    }

    let sibling = parent.parent().unwrap_or(parent).join(binary_name);
    if sibling.exists() {
        return Ok(SidecarLaunchSpec { program: sibling });
    }

    Err(format!(
        "boxlite sidecar binary not found; set {} or place {} next to the desktop executable",
        BOXLITE_SIDECAR_ENV, binary_name
    ))
}

fn identity_from_sidecar(data: BoxliteSidecarIdentity) -> SandboxIdentity {
    SandboxIdentity {
        sandbox_id: data.sandbox_id,
        sandbox_name: data.sandbox_name,
    }
}

fn output_from_sidecar(data: BoxliteSidecarExecutionOutput) -> SandboxExecutionOutput {
    SandboxExecutionOutput {
        stdout: data.stdout,
        stderr: data.stderr,
        exit_code: data.exit_code,
        error_message: data.error_message,
    }
}

fn map_sidecar_error(kind: BoxliteSidecarErrorKind, message: String) -> SandboxError {
    match kind {
        BoxliteSidecarErrorKind::Validation => SandboxError::Validation(message),
        BoxliteSidecarErrorKind::NotFound => SandboxError::NotFound(message),
        BoxliteSidecarErrorKind::Unavailable => SandboxError::Unavailable(message),
        BoxliteSidecarErrorKind::Busy => SandboxError::Busy(message),
        BoxliteSidecarErrorKind::Timeout => SandboxError::Timeout(message),
        BoxliteSidecarErrorKind::Network => SandboxError::Network(message),
        BoxliteSidecarErrorKind::Internal => SandboxError::Internal(message),
    }
}
