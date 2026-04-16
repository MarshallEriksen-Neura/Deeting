use std::path::Path;
use std::process::Command;

use async_trait::async_trait;
use boxlite_sidecar_protocol::{
    BoxliteSidecarConnection, BoxliteSidecarCreateBoxOptions, BoxliteSidecarExecutionRequest,
    BoxliteSidecarFilePayload,
};

use crate::modules::sandbox::boxlite_sidecar_client::BoxLiteSidecarClient;
use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::provider::SandboxProvider;
use crate::modules::sandbox::types::{
    SandboxBoxSpec, SandboxExecutionOutput, SandboxExecutionRequest, SandboxIdentity,
    SandboxWslStatus,
};
use crate::utils::configure_background_std_command;

#[derive(Debug, Clone)]
pub struct WslBackendOptions {
    pub base_url: String,
    pub api_key: Option<String>,
    pub python_bin: String,
    pub working_dir: Option<String>,
}

#[derive(Clone)]
pub struct WslBoxrunBackend {
    client: BoxLiteSidecarClient,
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

        if options.api_key.as_deref().is_some() {
            log::warn!("BOXRUN_API_KEY is set, but the BoxLite sidecar currently uses the official REST client path without x-api-key injection");
        }

        BoxLiteSidecarClient::ensure_launchable().map_err(SandboxError::Unavailable)?;

        Ok(Self {
            client: BoxLiteSidecarClient::new(),
            options,
        })
    }

    fn connection(&self) -> BoxliteSidecarConnection {
        BoxliteSidecarConnection {
            base_url: self.options.base_url.trim().to_string(),
            client_id: None,
            client_secret: None,
            prefix: None,
        }
    }
}

#[async_trait]
impl SandboxProvider for WslBoxrunBackend {
    fn provider_name(&self) -> &str {
        "boxlite"
    }

    async fn probe(&self) -> Result<(), SandboxError> {
        self.client.probe(&self.connection()).await
    }

    async fn get_or_create_box(
        &self,
        box_name: &str,
        spec: &SandboxBoxSpec,
    ) -> Result<SandboxIdentity, SandboxError> {
        self.client
            .get_or_create_box(
                &self.connection(),
                box_name,
                BoxliteSidecarCreateBoxOptions {
                    image: spec.image.clone(),
                    cpus: spec.cpus,
                    memory_mib: spec.memory_mib,
                    working_dir: spec.working_dir.clone(),
                },
            )
            .await
    }

    async fn stop_box(&self, box_id_or_name: &str) -> Result<(), SandboxError> {
        self.client
            .stop_box(&self.connection(), box_id_or_name)
            .await
    }

    async fn run_python(
        &self,
        box_id_or_name: &str,
        code: &str,
        timeout_seconds: u64,
    ) -> Result<SandboxExecutionOutput, SandboxError> {
        self.execute(
            box_id_or_name,
            SandboxExecutionRequest {
                command: self.options.python_bin.clone(),
                args: vec!["-c".to_string(), code.to_string()],
                files: Vec::new(),
                stdin: None,
                timeout_seconds,
                working_dir: self.options.working_dir.clone(),
            },
        )
        .await
    }

    async fn execute(
        &self,
        box_id_or_name: &str,
        request: SandboxExecutionRequest,
    ) -> Result<SandboxExecutionOutput, SandboxError> {
        self.client
            .execute(
                &self.connection(),
                box_id_or_name,
                to_sidecar_execution_request(request),
            )
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

fn to_sidecar_execution_request(
    request: SandboxExecutionRequest,
) -> BoxliteSidecarExecutionRequest {
    BoxliteSidecarExecutionRequest {
        command: request.command,
        args: request.args,
        files: request
            .files
            .into_iter()
            .map(|file| BoxliteSidecarFilePayload {
                path: file.path,
                content: file.content,
            })
            .collect::<Vec<BoxliteSidecarFilePayload>>(),
        stdin: request.stdin,
        timeout_seconds: request.timeout_seconds,
        working_dir: request.working_dir,
    }
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
