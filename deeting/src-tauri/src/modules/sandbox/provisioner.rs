//! Official BoxLite CLI provisioning layer for Windows + WSL.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;

use serde::Serialize;

use crate::modules::desktop_config::network::DesktopNetworkProxyEnvironment;
#[cfg(target_os = "windows")]
use crate::modules::sandbox::backend_wsl::{get_default_wsl_distro, shell_quote, warm_up_wsl};
use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::installer::{load_installation_record, BoxLiteInstallationRecord};
use crate::utils::configure_background_tokio_command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareProgress {
    pub stage: &'static str,
    pub percent: u32,
}

pub type PrepareProgressReporter = Arc<dyn Fn(PrepareProgress) + Send + Sync>;

fn report_prepare(reporter: Option<&PrepareProgressReporter>, stage: &'static str, percent: u32) {
    if let Some(r) = reporter {
        r(PrepareProgress { stage, percent });
    }
}

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
        self.ensure_running_with_proxy_environment(None).await
    }

    pub(crate) async fn ensure_running_with_proxy_environment(
        &self,
        proxy_environment: Option<&DesktopNetworkProxyEnvironment>,
    ) -> Result<String, SandboxError> {
        self.ensure_running_inner(proxy_environment, &[], None)
            .await
    }

    pub(crate) async fn ensure_running_with_progress(
        &self,
        proxy_environment: Option<&DesktopNetworkProxyEnvironment>,
        image_registries: &[String],
        reporter: Option<&PrepareProgressReporter>,
    ) -> Result<String, SandboxError> {
        self.ensure_running_inner(proxy_environment, image_registries, reporter)
            .await
    }

    async fn ensure_running_inner(
        &self,
        proxy_environment: Option<&DesktopNetworkProxyEnvironment>,
        image_registries: &[String],
        reporter: Option<&PrepareProgressReporter>,
    ) -> Result<String, SandboxError> {
        let endpoint = self.config.endpoint();

        report_prepare(reporter, "check_endpoint", 5);
        if self.is_endpoint_reachable().await {
            log::info!("BoxLite already reachable at {}", endpoint);
            report_prepare(reporter, "done", 100);
            return Ok(endpoint);
        }

        report_prepare(reporter, "load_record", 15);
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

        report_prepare(reporter, "wsl_warmup", 20);
        let distro = get_default_wsl_distro();
        warm_up_wsl(distro.as_deref()).await?;

        report_prepare(reporter, "start_server", 25);
        let launch_script = build_server_launch_command(
            &record,
            self.config.port,
            proxy_environment,
            image_registries,
        );
        let mut command = tokio::process::Command::new("wsl.exe");
        configure_background_tokio_command(&mut command);
        let mut args = Vec::new();
        if let Some(distro) = distro.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
            args.push("-d".to_string());
            args.push(distro.to_string());
        }
        args.extend([
            "--".to_string(),
            "bash".to_string(),
            "-lc".to_string(),
            launch_script,
        ]);
        let child = command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                SandboxError::Unavailable(format!(
                    "BoxLite server launch failure: failed to start from {}: {}",
                    record.wsl_binary_path, e
                ))
            })?;

        {
            let mut guard = self.child.lock().await;
            *guard = Some(child);
        }

        report_prepare(reporter, "health_check", 40);
        self.wait_for_health(&endpoint, reporter).await?;
        report_prepare(reporter, "done", 100);
        log::info!("BoxLite is ready at {}", endpoint);
        Ok(endpoint)
    }

    async fn wait_for_health(
        &self,
        endpoint: &str,
        reporter: Option<&PrepareProgressReporter>,
    ) -> Result<(), SandboxError> {
        let deadline = tokio::time::Instant::now() + STARTUP_TIMEOUT;

        for attempt in 0..HEALTH_CHECK_RETRIES {
            if tokio::time::Instant::now() >= deadline {
                break;
            }

            let progress = 40 + ((attempt as u32) * 50 / HEALTH_CHECK_RETRIES as u32);
            report_prepare(reporter, "health_check", progress.min(90));

            if probe_endpoint(endpoint).await.is_ok() {
                return Ok(());
            }

            self.ensure_child_still_running()?;

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

    fn ensure_child_still_running(&self) -> Result<(), SandboxError> {
        let mut guard = self.child.blocking_lock();
        let status = match guard.as_mut() {
            Some(child) => child.try_wait().map_err(|err| {
                SandboxError::Unavailable(format!(
                    "BoxLite server launch failure: could not inspect the managed process: {err}"
                ))
            })?,
            None => None,
        };

        if let Some(status) = status {
            *guard = None;
            let detail = status
                .code()
                .map(|code| format!("exit code {code}"))
                .unwrap_or_else(|| "terminated by signal".to_string());
            return Err(SandboxError::Unavailable(format!(
                "BoxLite server launch failure: the managed server exited before becoming healthy ({detail})."
            )));
        }

        Ok(())
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
fn build_server_launch_command(
    record: &BoxLiteInstallationRecord,
    port: u16,
    proxy_environment: Option<&DesktopNetworkProxyEnvironment>,
    image_registries: &[String],
) -> String {
    let mut parts = vec!["set -eu".to_string()];
    if let Some(proxy_environment) = proxy_environment {
        if !proxy_environment.unset.is_empty() {
            parts.push(format!("unset {}", proxy_environment.unset.join(" ")));
        }
        for (key, value) in &proxy_environment.set {
            parts.push(format!("export {key}={}", shell_quote(value)));
        }
    }
    let mut serve_cmd = format!(
        "exec {binary} --home {home} serve --host 127.0.0.1 --port {port}",
        binary = shell_quote(&record.wsl_binary_path),
        home = shell_quote(&record.wsl_boxlite_home),
        port = port,
    );
    for registry in image_registries {
        let trimmed = registry.trim();
        if trimmed.is_empty() {
            continue;
        }
        serve_cmd.push_str(" --registry ");
        serve_cmd.push_str(shell_quote(trimmed).as_str());
    }
    parts.push(serve_cmd);
    parts.join("; ")
}

#[cfg(not(target_os = "windows"))]
fn build_server_launch_command(
    _record: &BoxLiteInstallationRecord,
    _port: u16,
    _proxy_environment: Option<&DesktopNetworkProxyEnvironment>,
    _image_registries: &[String],
) -> String {
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

    #[cfg(target_os = "windows")]
    #[test]
    fn launch_command_includes_proxy_exports_when_present() {
        let record = BoxLiteInstallationRecord {
            version: "0.8.2".to_string(),
            asset_name: "boxlite.tar.gz".to_string(),
            asset_url: "https://example.invalid/boxlite.tar.gz".to_string(),
            asset_sha256: "abc".to_string(),
            wsl_home: "/home/test".to_string(),
            wsl_install_dir: "/home/test/.deeting/sandbox/boxlite/cli".to_string(),
            wsl_binary_path: "/home/test/.deeting/sandbox/boxlite/cli/boxlite".to_string(),
            wsl_boxlite_home: "/home/test/.deeting/sandbox/boxlite/home".to_string(),
        };
        let proxy_environment = DesktopNetworkProxyEnvironment {
            set: vec![(
                "HTTP_PROXY".to_string(),
                "http://127.0.0.1:7890".to_string(),
            )],
            unset: vec!["NO_PROXY".to_string()],
        };
        let command = build_server_launch_command(&record, 9090, Some(&proxy_environment), &[]);
        assert!(command.contains("unset NO_PROXY"));
        assert!(command.contains("export HTTP_PROXY='http://127.0.0.1:7890'"));
        assert!(command.contains("serve --host 127.0.0.1 --port 9090"));
        assert!(!command.contains("--registry"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn launch_command_appends_registry_flags_for_each_mirror() {
        let record = BoxLiteInstallationRecord {
            version: "0.8.2".to_string(),
            asset_name: "boxlite.tar.gz".to_string(),
            asset_url: "https://example.invalid/boxlite.tar.gz".to_string(),
            asset_sha256: "abc".to_string(),
            wsl_home: "/home/test".to_string(),
            wsl_install_dir: "/home/test/.deeting/sandbox/boxlite/cli".to_string(),
            wsl_binary_path: "/home/test/.deeting/sandbox/boxlite/cli/boxlite".to_string(),
            wsl_boxlite_home: "/home/test/.deeting/sandbox/boxlite/home".to_string(),
        };
        let registries = vec![
            "docker.m.daocloud.io".to_string(),
            "docker.mirrors.ustc.edu.cn".to_string(),
        ];
        let command = build_server_launch_command(&record, 9090, None, &registries);
        assert!(command.contains("--registry 'docker.m.daocloud.io'"));
        assert!(command.contains("--registry 'docker.mirrors.ustc.edu.cn'"));
        // registries must follow the serve args (single exec line)
        let serve_idx = command
            .find("serve --host 127.0.0.1 --port 9090")
            .expect("serve args present");
        let first_registry_idx = command.find("--registry").expect("registry arg present");
        assert!(first_registry_idx > serve_idx);
    }
}
