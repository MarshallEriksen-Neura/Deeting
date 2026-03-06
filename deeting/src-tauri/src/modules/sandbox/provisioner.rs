//! BoxLite auto-provisioning layer.
//!
//! Lifecycle: detect → download → start → health-check.
//! Designed to be replaceable: if BoxLite is swapped out for another sandbox
//! provider, only this file and `build_provider` in `manager.rs` change.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;

use crate::modules::sandbox::error::SandboxError;

const BOXLITE_BINARY_NAME: &str = if cfg!(windows) {
    "boxlite.exe"
} else {
    "boxlite"
};
const BOXLITE_DEFAULT_PORT: u16 = 9090;
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(2);
const HEALTH_CHECK_RETRIES: usize = 10;
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_millis(500);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct BoxLiteConfig {
    pub binary_path: Option<PathBuf>,
    pub port: u16,
    pub data_dir: PathBuf,
}

impl BoxLiteConfig {
    pub fn from_home_dir(home_dir: &Path) -> Self {
        let data_dir = home_dir.join("sandbox");
        Self {
            binary_path: None,
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

    /// Locate the boxlite binary via:
    /// 1. Explicit path in config
    /// 2. Data dir (`$HOME/.deeting/sandbox/boxlite`)
    /// 3. System PATH
    pub fn resolve_binary(&self) -> Option<PathBuf> {
        if let Some(ref explicit) = self.config.binary_path {
            if explicit.is_file() {
                return Some(explicit.clone());
            }
        }

        let bundled = self.config.data_dir.join(BOXLITE_BINARY_NAME);
        if bundled.is_file() {
            return Some(bundled);
        }

        which_binary(BOXLITE_BINARY_NAME)
    }

    /// Check if a BoxLite-compatible endpoint is already reachable.
    pub async fn is_endpoint_reachable(&self) -> bool {
        probe_endpoint(&self.config.endpoint()).await.is_ok()
    }

    /// Start BoxLite server if not already running.
    /// Returns the REST endpoint URL on success.
    pub async fn ensure_running(&self) -> Result<String, SandboxError> {
        let endpoint = self.config.endpoint();

        if self.is_endpoint_reachable().await {
            log::info!("BoxLite already reachable at {}", endpoint);
            return Ok(endpoint);
        }

        let binary = self
            .resolve_binary()
            .ok_or_else(|| SandboxError::Unavailable(format!(
                "BoxLite binary not found. Install BoxLite to {dir}/{bin} or add it to PATH.",
                dir = self.config.data_dir.display(),
                bin = BOXLITE_BINARY_NAME,
            )))?;

        log::info!(
            "starting BoxLite: binary={} port={}",
            binary.display(),
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

        let child = tokio::process::Command::new(&binary)
            .arg("server")
            .arg("--port")
            .arg(self.config.port.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                SandboxError::Unavailable(format!(
                    "failed to start BoxLite at {}: {}",
                    binary.display(),
                    e
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

    /// Wait for BoxLite to respond to health probes.
    async fn wait_for_health(&self, endpoint: &str) -> Result<(), SandboxError> {
        let deadline = tokio::time::Instant::now() + STARTUP_TIMEOUT;

        for attempt in 0..HEALTH_CHECK_RETRIES {
            if tokio::time::Instant::now() >= deadline {
                break;
            }

            {
                let guard = self.child.lock().await;
                if let Some(ref child) = *guard {
                    if let Some(ref id) = child.id() {
                        let _ = id; // process still alive
                    }
                }
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

    /// Gracefully stop the managed BoxLite process.
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

    let url = format!("{}/v1/boxes", base_url.trim_end_matches('/'));
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

fn which_binary(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let separator = if cfg!(windows) { ';' } else { ':' };
    for dir in path_var.split(separator) {
        let candidate = Path::new(dir).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn config_endpoint_uses_port() {
        let config = BoxLiteConfig {
            binary_path: None,
            port: 3030,
            data_dir: PathBuf::from("/tmp"),
        };
        assert_eq!(config.endpoint(), "http://127.0.0.1:3030");
    }
}
