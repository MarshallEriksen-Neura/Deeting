//! Official BoxLite CLI provisioning layer for Windows + WSL.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
use crate::modules::sandbox::backend_wsl::shell_quote;
use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::installer::{load_installation_record, BoxLiteInstallationRecord};
use crate::utils::configure_background_tokio_command;

const BOXLITE_DEFAULT_PORT: u16 = 9090;
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(2);
const HEALTH_CHECK_RETRIES: usize = 10;
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_millis(500);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct BoxLiteConfig {
    pub port: u16,
    pub data_dir: PathBuf,
}

impl BoxLiteConfig {
    pub fn from_home_dir(home_dir: &std::path::Path) -> Self {
        let data_dir = home_dir.join("sandbox");
        Self {
            port: BOXLITE_DEFAULT_PORT,
            data_dir,
        }
    }

    pub fn endpoint(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}

/// Manages BoxLite process lifecycle (start / stop / health-check).
pub struct BoxLiteProvisioner {
    config: BoxLiteConfig,
    child: Arc<Mutex<Option<tokio::process::Child>>>,
}

impl BoxLiteProvisioner {
    pub fn new(config: BoxLiteConfig) -> Self {
        Self {
            config,
            child: Arc::new(Mutex::new(None)),
        }
    }

    pub fn resolve_binary(&self) -> Option<PathBuf> {
        self.installation_record()
            .map(|record| PathBuf::from(record.wsl_binary_path))
    }

    pub fn endpoint(&self) -> String {
        self.config.endpoint()
    }

    pub fn installation_record(&self) -> Option<BoxLiteInstallationRecord> {
        load_installation_record(&self.config.data_dir)
    }

    /// Check if a BoxLite-compatible endpoint is already reachable.
    pub async fn is_endpoint_reachable(&self) -> bool {
        probe_endpoint(&self.config.endpoint()).await.is_ok()
    }

    pub async fn ensure_running(&self) -> Result<String, SandboxError> {
        let endpoint = self.config.endpoint();

        if self.is_endpoint_reachable().await {
            log::info!("BoxLite already reachable at {}", endpoint);
            return Ok(endpoint);
        }

        let record = self.installation_record().ok_or_else(|| {
            SandboxError::Unavailable(
                "BoxLite is not installed yet. Install it from Settings before preparing the sandbox."
                    .to_string(),
            )
        })?;

        log::info!(
            "starting official BoxLite server from {} on port {}",
            record.wsl_binary_path,
            self.config.port
        );

        if !self.config.data_dir.exists() {
            std::fs::create_dir_all(&self.config.data_dir).map_err(|e| {
                SandboxError::Internal(format!(
                    "failed to create sandbox data dir {}: {}",
                    self.config.data_dir.display(),
                    e
                ))
            })?;
        }

        let launch_script = build_server_launch_command(&record, self.config.port);
        let mut command = tokio::process::Command::new("wsl.exe");
        configure_background_tokio_command(&mut command);
        let child = command
            .args(["--", "bash", "-lc", launch_script.as_str()])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                SandboxError::Unavailable(format!(
                    "failed to start the BoxLite server from {}: {}",
                    record.wsl_binary_path, e
                ))
            })?;

        {
            let mut guard = self.child.lock().await;
            *guard = Some(child);
        }

        self.wait_for_health(&endpoint).await?;
        log::info!("BoxLite is ready at {}", endpoint);
        Ok(endpoint)
    }

    async fn wait_for_health(&self, endpoint: &str) -> Result<(), SandboxError> {
        let deadline = tokio::time::Instant::now() + STARTUP_TIMEOUT;

        for attempt in 0..HEALTH_CHECK_RETRIES {
            if tokio::time::Instant::now() >= deadline {
                break;
            }

            if probe_endpoint(endpoint).await.is_ok() {
                return Ok(());
            }

            log::debug!(
                "BoxLite health check attempt {}/{} failed, retrying...",
                attempt + 1,
                HEALTH_CHECK_RETRIES
            );
            tokio::time::sleep(HEALTH_CHECK_INTERVAL).await;
        }

        Err(SandboxError::Timeout(format!(
            "BoxLite failed to become healthy at {} within {}s",
            endpoint,
            STARTUP_TIMEOUT.as_secs()
        )))
    }

    pub async fn stop(&self) {
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            log::info!("stopping managed BoxLite process");
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }
}

impl Drop for BoxLiteProvisioner {
    fn drop(&mut self) {
        let child = self.child.clone();
        tokio::spawn(async move {
            let mut guard = child.lock().await;
            if let Some(mut c) = guard.take() {
                let _ = c.kill().await;
            }
        });
    }
}

async fn probe_endpoint(base_url: &str) -> Result<(), SandboxError> {
    let client = reqwest::Client::builder()
        .timeout(HEALTH_CHECK_TIMEOUT)
        .build()
        .map_err(|e| SandboxError::Internal(e.to_string()))?;

    let url = format!("{}/v1/default/boxes", base_url.trim_end_matches('/'));
    let response = client.get(&url).send().await?;
    let status = response.status();
    if status.is_success() || status.as_u16() == 401 || status.as_u16() == 403 {
        return Ok(());
    }
    Err(SandboxError::Unavailable(format!(
        "BoxLite probe returned status {}",
        status
    )))
}

#[cfg(target_os = "windows")]
fn build_server_launch_command(record: &BoxLiteInstallationRecord, port: u16) -> String {
    format!(
        "set -eu; exec {binary} --home {home} serve --host 127.0.0.1 --port {port}",
        binary = shell_quote(&record.wsl_binary_path),
        home = shell_quote(&record.wsl_boxlite_home),
        port = port,
    )
}

#[cfg(not(target_os = "windows"))]
fn build_server_launch_command(_record: &BoxLiteInstallationRecord, _port: u16) -> String {
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn config_endpoint_uses_port() {
        let config = BoxLiteConfig {
            port: 3030,
            data_dir: PathBuf::from("/tmp"),
        };
        assert_eq!(config.endpoint(), "http://127.0.0.1:3030");
    }
}
