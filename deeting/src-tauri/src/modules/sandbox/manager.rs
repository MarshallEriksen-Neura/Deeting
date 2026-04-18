use std::collections::{HashMap, HashSet};
#[cfg(target_os = "windows")]
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

use crate::modules::desktop_config::network::{
    build_proxy_environment_for_settings, DesktopNetworkProxyEnvironment,
    DesktopNetworkProxySettings,
};
use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::provider::SandboxProvider;
use crate::modules::sandbox::types::{
    SandboxBoxLiteStatus, SandboxBoxSpec, SandboxExecutionProbe, SandboxExecutionProbeStatus,
    SandboxExecutionRequest, SandboxInstallGuide, SandboxLeaseInfo, SandboxReadinessReport,
    SandboxReadinessStatus, SandboxRunResult, SandboxRuntimeMode, SandboxSnippetLanguage,
    SandboxSnippetRunResponse, SandboxWslStatus,
};

#[cfg(target_os = "windows")]
use crate::modules::sandbox::backend_host::{HostBackendOptions, HostPythonBackend};
#[cfg(target_os = "windows")]
use crate::modules::sandbox::backend_wsl::{
    diagnose_wsl_availability, WslBackendOptions, WslBoxrunBackend,
};
use crate::modules::sandbox::installer::ProgressReporter as BoxLiteInstallProgressReporter;
#[cfg(target_os = "windows")]
use crate::modules::sandbox::installer::{install_boxlite_wsl, BoxLiteInstallerConfig};
use crate::modules::sandbox::provisioner::PrepareProgressReporter;

const DEFAULT_TIMEOUT_SECS: u64 = 30 * 60;
const DEFAULT_MAX_SANDBOXES: usize = 50;
const MIN_EXEC_TIMEOUT_SECS: u64 = 5;
const SESSION_BUSY_RETRY_ATTEMPTS: usize = 2;
const EXECUTION_PROBE_RECOVERY_ATTEMPTS: usize = 2;
const REAPER_INTERVAL_SECS: u64 = 60;
const DEFAULT_BOXRUN_PORT: u16 = 9090;
#[allow(dead_code)]
const EXECUTION_PROBE_SESSION_ID: &str = "__deeting_status_probe__";
#[allow(dead_code)]
const EXECUTION_PROBE_TIMEOUT_SECS: u64 = 5;
#[allow(dead_code)]
const EXECUTION_PROBE_SENTINEL: &str = "__deeting_probe_ok__";

#[cfg(target_os = "windows")]
const DEFAULT_BRIDGE_DISCOVERY_TIMEOUT_MS: u64 = 300;
#[cfg(target_os = "windows")]
const DEFAULT_BRIDGE_DISCOVERY_URLS: [&str; 2] = ["http://127.0.0.1:9090", "http://localhost:9090"];

#[derive(Debug, Clone)]
pub struct SandboxManagerOptions {
    pub home_dir: PathBuf,
    pub default_timeout: Duration,
    pub max_sandboxes: usize,
    pub image: String,
    pub cpus: Option<u8>,
    pub memory_mib: Option<u32>,
    pub working_dir: Option<String>,
    pub python_bin: String,
    pub bridge_url: Option<String>,
    pub bridge_api_key: Option<String>,
}

impl SandboxManagerOptions {
    pub fn from_home_dir(home_dir: PathBuf) -> Self {
        let bridge_url = bridge_url_from_env();
        #[cfg(target_os = "windows")]
        let bridge_url = bridge_url.or_else(discover_bridge_url);
        let bridge_api_key = non_empty_env("BOXRUN_API_KEY");

        Self {
            home_dir,
            default_timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
            max_sandboxes: DEFAULT_MAX_SANDBOXES,
            image: "python:3.11-slim".to_string(),
            cpus: Some(1),
            memory_mib: Some(512),
            working_dir: Some("/workspace".to_string()),
            python_bin: "python3".to_string(),
            bridge_url,
            bridge_api_key,
        }
    }
}

#[derive(Clone)]
pub struct SandboxRuntimeManager {
    backend: Arc<RwLock<Arc<dyn SandboxProvider>>>,
    provisioner: Option<Arc<crate::modules::sandbox::provisioner::BoxLiteProvisioner>>,
    options: SandboxManagerOptions,
    session_leases: Arc<RwLock<HashMap<String, SessionLease>>>,
    active_ids: Arc<RwLock<HashSet<String>>>,
    run_locks: Arc<RwLock<HashMap<String, Arc<Mutex<()>>>>>,
    cleanup_task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxLaunchPolicy {
    StrictSandbox,
    AllowHostFallback,
}

#[derive(Debug, Clone)]
struct SessionLease {
    sandbox_id: String,
    sandbox_name: String,
    expires_at_unix_ms: i64,
}

/// Fallback provider that always returns `Unavailable`.
struct DisabledProvider {
    reason: String,
}

#[async_trait]
impl SandboxProvider for DisabledProvider {
    fn provider_name(&self) -> &str {
        "disabled"
    }

    async fn get_or_create_box(
        &self,
        _box_name: &str,
        _spec: &SandboxBoxSpec,
    ) -> Result<crate::modules::sandbox::types::SandboxIdentity, SandboxError> {
        Err(SandboxError::Unavailable(self.reason.clone()))
    }

    async fn stop_box(&self, _box_id_or_name: &str) -> Result<(), SandboxError> {
        Err(SandboxError::Unavailable(self.reason.clone()))
    }

    async fn run_python(
        &self,
        _box_id_or_name: &str,
        _code: &str,
        _timeout_seconds: u64,
    ) -> Result<crate::modules::sandbox::types::SandboxExecutionOutput, SandboxError> {
        Err(SandboxError::Unavailable(self.reason.clone()))
    }
}

impl SandboxRuntimeManager {
    pub fn new(options: SandboxManagerOptions) -> Self {
        let provisioner = Self::build_provisioner(&options);
        let backend = Self::build_provider(&options, provisioner.as_ref()).unwrap_or_else(|err| {
            log::warn!(
                "sandbox runtime disabled: code={} detail={}",
                err.code(),
                err
            );
            Arc::new(DisabledProvider {
                reason: err.to_string(),
            }) as Arc<dyn SandboxProvider>
        });

        Self {
            backend: Arc::new(RwLock::new(backend)),
            provisioner,
            options,
            session_leases: Arc::new(RwLock::new(HashMap::new())),
            active_ids: Arc::new(RwLock::new(HashSet::new())),
            run_locks: Arc::new(RwLock::new(HashMap::new())),
            cleanup_task: Arc::new(Mutex::new(None)),
        }
    }

    fn default_box_spec(&self) -> SandboxBoxSpec {
        SandboxBoxSpec {
            image: self.options.image.clone(),
            cpus: self.options.cpus,
            memory_mib: self.options.memory_mib,
            working_dir: self.options.working_dir.clone(),
        }
    }

    pub async fn is_available(&self) -> bool {
        self.provider_name().await != "disabled"
    }

    pub async fn provider_name(&self) -> String {
        self.backend.read().await.provider_name().to_string()
    }

    pub async fn runtime_mode(&self) -> SandboxRuntimeMode {
        runtime_mode_from_provider_name(&self.provider_name().await)
    }

    pub async fn status_report(&self) -> SandboxReadinessReport {
        let provider_name = self.provider_name().await;
        let runtime_mode = runtime_mode_from_provider_name(&provider_name);
        let boxlite = self.boxlite_status().await;
        #[cfg(target_os = "windows")]
        {
            let wsl = diagnose_wsl_availability();
            let boxlite_binary_found = boxlite.binary_found;
            let (mut status, mut blocking_reason, mut next_actions) =
                derive_windows_readiness(runtime_mode, &wsl, &boxlite);
            let execution_probe = if status == SandboxReadinessStatus::Ready {
                let execution_probe = self.programmatic_execution_probe().await;
                (status, blocking_reason, next_actions) = refine_ready_status_with_execution_probe(
                    status,
                    blocking_reason,
                    next_actions,
                    execution_probe.clone(),
                );
                execution_probe
            } else {
                SandboxExecutionProbe::default()
            };
            return SandboxReadinessReport {
                platform: current_platform().to_string(),
                platform_supported: true,
                status,
                provider_name,
                runtime_mode,
                wsl: Some(wsl),
                boxlite,
                execution_probe,
                blocking_reason,
                can_auto_prepare: status != SandboxReadinessStatus::NeedsWsl
                    && boxlite_binary_found,
                next_actions,
            };
        }

        #[cfg(not(target_os = "windows"))]
        {
            SandboxReadinessReport {
                platform: current_platform().to_string(),
                platform_supported: false,
                status: SandboxReadinessStatus::Unsupported,
                provider_name,
                runtime_mode,
                wsl: None,
                boxlite,
                execution_probe: SandboxExecutionProbe::default(),
                blocking_reason: Some(
                    "Desktop sandbox install flow is currently only supported on Windows + WSL."
                        .to_string(),
                ),
                next_actions: vec![
                    "Use the Windows desktop build for managed sandbox installation.".to_string(),
                ],
                can_auto_prepare: false,
            }
        }
    }

    pub async fn prepare(&self) -> Result<SandboxReadinessReport, SandboxError> {
        self.prepare_with_proxy_environment(None, None).await
    }

    pub(crate) async fn prepare_with_proxy_settings(
        &self,
        proxy_settings: Option<&DesktopNetworkProxySettings>,
    ) -> Result<SandboxReadinessReport, SandboxError> {
        self.prepare_with_proxy_settings_and_progress(proxy_settings, None)
            .await
    }

    pub(crate) async fn prepare_with_proxy_settings_and_progress(
        &self,
        proxy_settings: Option<&DesktopNetworkProxySettings>,
        reporter: Option<&PrepareProgressReporter>,
    ) -> Result<SandboxReadinessReport, SandboxError> {
        let proxy_environment = proxy_settings
            .map(build_proxy_environment_for_settings)
            .transpose()
            .map_err(SandboxError::Validation)?;
        self.prepare_with_proxy_environment(proxy_environment.as_ref(), reporter)
            .await
    }

    async fn prepare_with_proxy_environment(
        &self,
        proxy_environment: Option<&DesktopNetworkProxyEnvironment>,
        reporter: Option<&PrepareProgressReporter>,
    ) -> Result<SandboxReadinessReport, SandboxError> {
        #[cfg(target_os = "windows")]
        {
            if let Some(provisioner) = self.provisioner.as_ref() {
                if provisioner.resolve_binary().is_some() {
                    if let Err(err) = provisioner
                        .ensure_running_with_progress(proxy_environment, reporter)
                        .await
                    {
                        log::warn!("prepare sandbox failed: code={} detail={}", err.code(), err);
                    }
                }
            }
            self.refresh_backend().await?;
            return Ok(self.status_report().await);
        }

        #[cfg(not(target_os = "windows"))]
        {
            Ok(self.status_report().await)
        }
    }

    pub async fn repair(&self) -> Result<SandboxReadinessReport, SandboxError> {
        self.repair_with_proxy_settings(None).await
    }

    pub(crate) async fn repair_with_proxy_settings(
        &self,
        proxy_settings: Option<&DesktopNetworkProxySettings>,
    ) -> Result<SandboxReadinessReport, SandboxError> {
        self.repair_with_proxy_settings_and_progress(proxy_settings, None)
            .await
    }

    pub(crate) async fn repair_with_proxy_settings_and_progress(
        &self,
        proxy_settings: Option<&DesktopNetworkProxySettings>,
        reporter: Option<&PrepareProgressReporter>,
    ) -> Result<SandboxReadinessReport, SandboxError> {
        self.reset_runtime_state(false).await;
        self.prepare_with_proxy_settings_and_progress(proxy_settings, reporter)
            .await
    }

    pub async fn rebuild_runtime(&self) -> Result<SandboxReadinessReport, SandboxError> {
        self.rebuild_runtime_with_proxy_settings(None).await
    }

    pub(crate) async fn rebuild_runtime_with_proxy_settings(
        &self,
        proxy_settings: Option<&DesktopNetworkProxySettings>,
    ) -> Result<SandboxReadinessReport, SandboxError> {
        self.rebuild_runtime_with_proxy_settings_and_progress(proxy_settings, None)
            .await
    }

    pub(crate) async fn rebuild_runtime_with_proxy_settings_and_progress(
        &self,
        proxy_settings: Option<&DesktopNetworkProxySettings>,
        reporter: Option<&PrepareProgressReporter>,
    ) -> Result<SandboxReadinessReport, SandboxError> {
        self.reset_runtime_state(true).await;
        self.prepare_with_proxy_settings_and_progress(proxy_settings, reporter)
            .await
    }

    async fn reset_runtime_state(&self, stop_active_boxes: bool) {
        let active_ids: Vec<String> = if stop_active_boxes {
            let active = self.active_ids.read().await;
            active.iter().cloned().collect()
        } else {
            Vec::new()
        };

        for sandbox_id in active_ids {
            let backend = self.current_backend().await;
            let _ = backend.stop_box(&sandbox_id).await;
            self.remove_lease_by_sandbox_id(&sandbox_id).await;
        }

        self.clear_runtime_state().await;

        if let Some(provisioner) = self.provisioner.as_ref() {
            provisioner.stop().await;
        }
    }

    pub async fn install_boxlite(
        &self,
        reporter: Option<BoxLiteInstallProgressReporter>,
    ) -> Result<SandboxReadinessReport, SandboxError> {
        self.install_boxlite_with_proxy_settings(reporter, None)
            .await
    }

    pub(crate) async fn install_boxlite_with_proxy_settings(
        &self,
        reporter: Option<BoxLiteInstallProgressReporter>,
        proxy_settings: Option<&DesktopNetworkProxySettings>,
    ) -> Result<SandboxReadinessReport, SandboxError> {
        #[cfg(target_os = "windows")]
        {
            let wsl = diagnose_wsl_availability();
            if !wsl.ready {
                return Err(SandboxError::Unavailable(wsl.detail.unwrap_or_else(|| {
                    "WSL is required before BoxLite can be installed.".to_string()
                })));
            }

            let config = BoxLiteInstallerConfig {
                data_dir: self.options.home_dir.join("sandbox"),
            };
            install_boxlite_wsl(&config, reporter, proxy_settings).await?;
            return self.prepare_with_proxy_settings(proxy_settings).await;
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = reporter;
            let _ = proxy_settings;
            Ok(self.status_report().await)
        }
    }

    pub async fn install_guide(&self) -> SandboxInstallGuide {
        build_install_guide(&self.status_report().await)
    }

    pub async fn ensure_launch_policy(
        &self,
        policy: SandboxLaunchPolicy,
    ) -> Result<SandboxReadinessReport, SandboxError> {
        let mut report = self.status_report().await;
        if matches!(policy, SandboxLaunchPolicy::StrictSandbox)
            && report.runtime_mode != SandboxRuntimeMode::Sandbox
        {
            report = self.prepare().await?;
        }
        Ok(report)
    }

    pub async fn start_background_worker(&self) {
        let mut task_guard = self.cleanup_task.lock().await;
        if task_guard.is_some() {
            return;
        }
        let manager = self.clone();
        let handle = tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(REAPER_INTERVAL_SECS)).await;
                if let Err(err) = manager.reap_zombies().await {
                    log::warn!("sandbox reaper failed: code={} detail={}", err.code(), err);
                }
            }
        });
        *task_guard = Some(handle);
    }

    pub async fn stop_background_worker(&self) {
        let mut task_guard = self.cleanup_task.lock().await;
        if let Some(handle) = task_guard.take() {
            handle.abort();
            let _ = handle.await;
        }
    }

    pub async fn reap_zombies(&self) -> Result<(), SandboxError> {
        let now_ms = now_unix_ms();
        let mut expired = Vec::new();
        {
            let leases = self.session_leases.read().await;
            for (session_id, lease) in leases.iter() {
                if lease.expires_at_unix_ms <= now_ms {
                    expired.push((session_id.clone(), lease.sandbox_id.clone()));
                }
            }
        }

        for (session_id, sandbox_id) in expired {
            self.remove_lease(&session_id, &sandbox_id).await;
            let backend = self.current_backend().await;
            let _ = backend.stop_box(&sandbox_id).await;
        }
        Ok(())
    }

    pub async fn get_or_create_sandbox(
        &self,
        session_id: &str,
    ) -> Result<SandboxLeaseInfo, SandboxError> {
        let normalized_session = normalize_session_id(session_id)?;
        let box_spec = self.default_box_spec();
        self.get_or_create_sandbox_with_spec(&normalized_session, &box_spec)
            .await
    }

    async fn get_or_create_sandbox_with_spec(
        &self,
        lease_key: &str,
        box_spec: &SandboxBoxSpec,
    ) -> Result<SandboxLeaseInfo, SandboxError> {
        let now_ms = now_unix_ms();

        if let Some(existing) = self.get_valid_lease(lease_key, now_ms).await {
            return Ok(existing);
        }

        self.ensure_capacity().await?;

        let sandbox_name = session_to_box_name(lease_key);
        let backend = self.current_backend().await;
        let identity = backend.get_or_create_box(&sandbox_name, box_spec).await?;
        let expires_at = now_ms + self.options.default_timeout.as_millis() as i64;

        {
            let mut leases = self.session_leases.write().await;
            leases.insert(
                lease_key.to_string(),
                SessionLease {
                    sandbox_id: identity.sandbox_id.clone(),
                    sandbox_name: identity.sandbox_name.clone(),
                    expires_at_unix_ms: expires_at,
                },
            );
        }
        {
            let mut active = self.active_ids.write().await;
            active.insert(identity.sandbox_id.clone());
        }

        Ok(SandboxLeaseInfo {
            session_id: lease_key.to_string(),
            sandbox_id: identity.sandbox_id,
            sandbox_name: identity.sandbox_name,
            expires_at_unix_ms: expires_at,
        })
    }

    pub async fn stop_sandbox(
        &self,
        sandbox_id: &str,
        session_id: Option<&str>,
    ) -> Result<(), SandboxError> {
        let mut normalized_session = None;
        if let Some(session) = session_id {
            normalized_session = Some(normalize_session_id(session)?);
        }

        if let Some(session) = normalized_session {
            self.remove_lease(&session, sandbox_id).await;
        } else {
            self.remove_lease_by_sandbox_id(sandbox_id).await;
        }
        let backend = self.current_backend().await;
        backend.stop_box(sandbox_id).await
    }

    pub async fn run_code(
        &self,
        session_id: &str,
        code: &str,
        language: Option<&str>,
        execution_timeout_secs: Option<u64>,
        policy: SandboxLaunchPolicy,
    ) -> Result<SandboxRunResult, SandboxError> {
        let normalized_session = normalize_session_id(session_id)?;
        if code.trim().is_empty() {
            return Err(SandboxError::Validation("code is required".to_string()));
        }
        if let Some(lang) = language {
            if !lang.trim().eq_ignore_ascii_case("python") {
                return Err(SandboxError::Validation(format!(
                    "unsupported language: {}",
                    lang.trim()
                )));
            }
        }

        let lock = self.session_run_lock(&normalized_session).await;
        let timeout_secs = execution_timeout_secs
            .unwrap_or(30)
            .max(MIN_EXEC_TIMEOUT_SECS);
        let lock_wait_secs = timeout_secs.saturating_add(5).max(1);
        let _guard = tokio::time::timeout(Duration::from_secs(lock_wait_secs), lock.lock())
            .await
            .map_err(|_| {
                SandboxError::Busy(format!(
                    "session {} is busy (lock wait {}s exceeded)",
                    normalized_session, lock_wait_secs
                ))
            })?;

        let report = self.ensure_launch_policy(policy).await?;
        if matches!(policy, SandboxLaunchPolicy::StrictSandbox)
            && report.runtime_mode != SandboxRuntimeMode::Sandbox
        {
            return Err(SandboxError::Unavailable(
                report.blocking_reason.unwrap_or_else(|| {
                    "sandbox is not ready; install or repair the desktop sandbox before running Code Mode"
                        .to_string()
                }),
            ));
        }

        self.execute_session_code(&normalized_session, code, timeout_secs)
            .await
    }

    pub async fn run_local_code_snippet(
        &self,
        session_id: &str,
        language: SandboxSnippetLanguage,
        code: &str,
        execution_timeout_secs: Option<u64>,
    ) -> SandboxSnippetRunResponse {
        let current_runtime_mode = self.runtime_mode().await;
        let trimmed_code = code.trim();
        if trimmed_code.is_empty() {
            return snippet_validation_response(
                &language,
                current_runtime_mode,
                "code is required",
            );
        }

        let normalized_session = match normalize_session_id(session_id) {
            Ok(value) => value,
            Err(err) => {
                return snippet_error_response(
                    &language,
                    current_runtime_mode,
                    err.user_message(),
                    Some(err.code().to_string()),
                    None,
                );
            }
        };

        let report = match self
            .ensure_launch_policy(SandboxLaunchPolicy::StrictSandbox)
            .await
        {
            Ok(report) => report,
            Err(_) => self.status_report().await,
        };
        if report.runtime_mode != SandboxRuntimeMode::Sandbox {
            return snippet_blocked_response(&language, &report);
        }

        let timeout_secs = execution_timeout_secs
            .unwrap_or(30)
            .max(MIN_EXEC_TIMEOUT_SECS);
        let lease_key = format!("{normalized_session}::snippet::{}", language.as_str());
        let box_spec = language.box_spec();
        let request = language.build_execution_request(trimmed_code, timeout_secs);
        let lock = self.session_run_lock(&lease_key).await;
        let lock_wait_secs = timeout_secs.saturating_add(5).max(1);
        let _guard =
            match tokio::time::timeout(Duration::from_secs(lock_wait_secs), lock.lock()).await {
                Ok(guard) => guard,
                Err(_) => {
                    return snippet_error_response(
                        &language,
                        report.runtime_mode,
                        format!(
                            "session {} is busy (lock wait {}s exceeded)",
                            normalized_session, lock_wait_secs
                        ),
                        Some("SANDBOX_SESSION_BUSY".to_string()),
                        Some(self.status_report().await),
                    );
                }
            };

        match self
            .execute_session_request(&lease_key, &box_spec, request)
            .await
        {
            Ok(run) => snippet_success_response(&language, report.runtime_mode, run),
            Err(err) => snippet_error_response(
                &language,
                report.runtime_mode,
                err.user_message(),
                Some(err.code().to_string()),
                Some(self.status_report().await),
            ),
        }
    }

    async fn execute_session_code(
        &self,
        normalized_session: &str,
        code: &str,
        timeout_secs: u64,
    ) -> Result<SandboxRunResult, SandboxError> {
        for attempt in 0..SESSION_BUSY_RETRY_ATTEMPTS {
            let lease = self.get_or_create_sandbox(&normalized_session).await?;
            let backend = self.current_backend().await;
            match backend
                .run_python(&lease.sandbox_id, code, timeout_secs)
                .await
            {
                Ok(output) => {
                    self.touch_lease(&normalized_session).await;
                    let result = if output.exit_code == 0 {
                        output.stdout.clone()
                    } else {
                        Vec::new()
                    };
                    return Ok(SandboxRunResult {
                        sandbox_id: lease.sandbox_id,
                        stdout: output.stdout,
                        stderr: output.stderr,
                        result,
                        exit_code: output.exit_code,
                    });
                }
                Err(err)
                    if is_session_busy_error(&err) && attempt + 1 < SESSION_BUSY_RETRY_ATTEMPTS =>
                {
                    log::warn!(
                        "sandbox session busy for session {} (attempt {}/{}), recreating sandbox",
                        normalized_session,
                        attempt + 1,
                        SESSION_BUSY_RETRY_ATTEMPTS
                    );
                    let _ = self
                        .stop_sandbox(&lease.sandbox_id, Some(&normalized_session))
                        .await;
                    continue;
                }
                Err(err)
                    if is_missing_sandbox_error(&err)
                        && attempt + 1 < SESSION_BUSY_RETRY_ATTEMPTS =>
                {
                    log::warn!(
                        "sandbox missing for session {} (attempt {}/{}), rebuilding runtime",
                        normalized_session,
                        attempt + 1,
                        SESSION_BUSY_RETRY_ATTEMPTS
                    );
                    self.cleanup_missing_sandbox_state(normalized_session, &lease, &backend)
                        .await;
                    let _ = self.prepare().await;
                    continue;
                }
                Err(err)
                    if is_stopped_handle_error(&err)
                        && attempt + 1 < SESSION_BUSY_RETRY_ATTEMPTS =>
                {
                    log::warn!(
                        "sandbox handle invalidated for session {} (attempt {}/{}), recreating sandbox",
                        normalized_session,
                        attempt + 1,
                        SESSION_BUSY_RETRY_ATTEMPTS
                    );
                    self.cleanup_missing_sandbox_state(normalized_session, &lease, &backend)
                        .await;
                    continue;
                }
                Err(err) => return Err(err),
            }
        }

        Err(SandboxError::Busy(format!(
            "session {} is busy",
            normalized_session
        )))
    }

    #[allow(dead_code)]
    async fn execute_session_code_without_prepare(
        &self,
        normalized_session: &str,
        code: &str,
        timeout_secs: u64,
    ) -> Result<SandboxRunResult, SandboxError> {
        for attempt in 0..SESSION_BUSY_RETRY_ATTEMPTS {
            let lease = self.get_or_create_sandbox(&normalized_session).await?;
            let backend = self.current_backend().await;
            match backend
                .run_python(&lease.sandbox_id, code, timeout_secs)
                .await
            {
                Ok(output) => {
                    self.touch_lease(&normalized_session).await;
                    let result = if output.exit_code == 0 {
                        output.stdout.clone()
                    } else {
                        Vec::new()
                    };
                    return Ok(SandboxRunResult {
                        sandbox_id: lease.sandbox_id,
                        stdout: output.stdout,
                        stderr: output.stderr,
                        result,
                        exit_code: output.exit_code,
                    });
                }
                Err(err)
                    if is_session_busy_error(&err) && attempt + 1 < SESSION_BUSY_RETRY_ATTEMPTS =>
                {
                    log::warn!(
                        "sandbox session busy for session {} (attempt {}/{}), recreating sandbox",
                        normalized_session,
                        attempt + 1,
                        SESSION_BUSY_RETRY_ATTEMPTS
                    );
                    let _ = self
                        .stop_sandbox(&lease.sandbox_id, Some(&normalized_session))
                        .await;
                    continue;
                }
                Err(err)
                    if is_missing_sandbox_error(&err)
                        && attempt + 1 < SESSION_BUSY_RETRY_ATTEMPTS =>
                {
                    log::warn!(
                        "sandbox missing for session {} (attempt {}/{}), retrying without auto-prepare",
                        normalized_session,
                        attempt + 1,
                        SESSION_BUSY_RETRY_ATTEMPTS
                    );
                    self.cleanup_missing_sandbox_state(normalized_session, &lease, &backend)
                        .await;
                    continue;
                }
                Err(err)
                    if is_stopped_handle_error(&err)
                        && attempt + 1 < SESSION_BUSY_RETRY_ATTEMPTS =>
                {
                    log::warn!(
                        "sandbox handle invalidated for session {} (attempt {}/{}), retrying without auto-prepare",
                        normalized_session,
                        attempt + 1,
                        SESSION_BUSY_RETRY_ATTEMPTS
                    );
                    self.cleanup_missing_sandbox_state(normalized_session, &lease, &backend)
                        .await;
                    continue;
                }
                Err(err) => return Err(err),
            }
        }

        Err(SandboxError::Busy(format!(
            "session {} is busy",
            normalized_session
        )))
    }

    async fn execute_session_request(
        &self,
        lease_key: &str,
        box_spec: &SandboxBoxSpec,
        request: SandboxExecutionRequest,
    ) -> Result<SandboxRunResult, SandboxError> {
        for attempt in 0..SESSION_BUSY_RETRY_ATTEMPTS {
            let lease = self
                .get_or_create_sandbox_with_spec(lease_key, box_spec)
                .await?;
            let backend = self.current_backend().await;
            match backend.execute(&lease.sandbox_id, request.clone()).await {
                Ok(output) => {
                    self.touch_lease(lease_key).await;
                    let result = if output.exit_code == 0 {
                        output.stdout.clone()
                    } else {
                        Vec::new()
                    };
                    return Ok(SandboxRunResult {
                        sandbox_id: lease.sandbox_id,
                        stdout: output.stdout,
                        stderr: output.stderr,
                        result,
                        exit_code: output.exit_code,
                    });
                }
                Err(err)
                    if is_session_busy_error(&err) && attempt + 1 < SESSION_BUSY_RETRY_ATTEMPTS =>
                {
                    log::warn!(
                        "sandbox session busy for key {} (attempt {}/{}), recreating sandbox",
                        lease_key,
                        attempt + 1,
                        SESSION_BUSY_RETRY_ATTEMPTS
                    );
                    let _ = self.stop_sandbox(&lease.sandbox_id, Some(lease_key)).await;
                    continue;
                }
                Err(err)
                    if is_missing_sandbox_error(&err)
                        && attempt + 1 < SESSION_BUSY_RETRY_ATTEMPTS =>
                {
                    log::warn!(
                        "sandbox missing for key {} (attempt {}/{}), rebuilding runtime",
                        lease_key,
                        attempt + 1,
                        SESSION_BUSY_RETRY_ATTEMPTS
                    );
                    self.cleanup_missing_sandbox_state(lease_key, &lease, &backend)
                        .await;
                    let _ = self.prepare().await;
                    continue;
                }
                Err(err)
                    if is_stopped_handle_error(&err)
                        && attempt + 1 < SESSION_BUSY_RETRY_ATTEMPTS =>
                {
                    log::warn!(
                        "sandbox handle invalidated for key {} (attempt {}/{}), recreating sandbox",
                        lease_key,
                        attempt + 1,
                        SESSION_BUSY_RETRY_ATTEMPTS
                    );
                    self.cleanup_missing_sandbox_state(lease_key, &lease, &backend)
                        .await;
                    continue;
                }
                Err(err) => return Err(err),
            }
        }

        Err(SandboxError::Busy(format!("session {} is busy", lease_key)))
    }

    async fn cleanup_missing_sandbox_state(
        &self,
        normalized_session: &str,
        lease: &SandboxLeaseInfo,
        backend: &Arc<dyn SandboxProvider>,
    ) {
        self.remove_lease(normalized_session, &lease.sandbox_id)
            .await;

        let removed_by_id = backend.remove_box(&lease.sandbox_id, true).await.is_ok();
        if lease.sandbox_name != lease.sandbox_id {
            if removed_by_id {
                let _ = backend.remove_box(&lease.sandbox_name, true).await;
            } else {
                let _ = backend.stop_box(&lease.sandbox_name).await;
            }
        }

        if !removed_by_id {
            let _ = backend.stop_box(&lease.sandbox_id).await;
        }
    }

    async fn reset_session_runtime(&self, normalized_session: &str) {
        let lease = {
            let leases = self.session_leases.read().await;
            leases.get(normalized_session).cloned()
        };
        if let Some(lease) = lease {
            let lease_info = SandboxLeaseInfo {
                session_id: normalized_session.to_string(),
                sandbox_id: lease.sandbox_id,
                sandbox_name: lease.sandbox_name,
                expires_at_unix_ms: lease.expires_at_unix_ms,
            };
            let backend = self.current_backend().await;
            self.cleanup_missing_sandbox_state(normalized_session, &lease_info, &backend)
                .await;
        }
        self.run_locks.write().await.remove(normalized_session);
    }

    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    async fn restart_managed_runtime_for_probe(&self) -> Result<(), SandboxError> {
        self.reset_runtime_state(false).await;

        #[cfg(target_os = "windows")]
        {
            if let Some(provisioner) = self.provisioner.as_ref() {
                if provisioner.resolve_binary().is_some() {
                    let _ = provisioner.ensure_running().await?;
                }
            }
        }

        Ok(())
    }

    #[allow(dead_code)]
    async fn programmatic_execution_probe(&self) -> SandboxExecutionProbe {
        let checked_at_unix_ms = Some(now_unix_ms());
        let mut attempt = 0usize;
        let mut restarted_runtime = false;
        loop {
            match self
                .execute_session_code_without_prepare(
                    EXECUTION_PROBE_SESSION_ID,
                    &format!("print({EXECUTION_PROBE_SENTINEL:?})"),
                    EXECUTION_PROBE_TIMEOUT_SECS,
                )
                .await
            {
                Ok(run)
                    if run.exit_code == 0
                        && run
                            .stdout
                            .iter()
                            .any(|line| line.contains(EXECUTION_PROBE_SENTINEL)) =>
                {
                    return SandboxExecutionProbe {
                        status: SandboxExecutionProbeStatus::Passed,
                        detail: Some(
                            "Sandbox execution probe passed. Programmatic execution is responding."
                                .to_string(),
                        ),
                        checked_at_unix_ms,
                    };
                }
                Ok(run) => {
                    return SandboxExecutionProbe {
                        status: SandboxExecutionProbeStatus::Failed,
                        detail: Some(format!(
                            "Sandbox execution probe returned exit code {} without the expected success marker.",
                            run.exit_code
                        )),
                        checked_at_unix_ms,
                    };
                }
                Err(SandboxError::Busy(detail)) => {
                    return SandboxExecutionProbe {
                        status: SandboxExecutionProbeStatus::Skipped,
                        detail: Some(format!(
                            "Sandbox execution probe skipped because the runtime is busy: {detail}"
                        )),
                        checked_at_unix_ms,
                    };
                }
                Err(err)
                    if should_retry_execution_probe_after_error(&err)
                        && attempt + 1 < EXECUTION_PROBE_RECOVERY_ATTEMPTS =>
                {
                    attempt += 1;
                    log::warn!(
                        "execution probe failed for session {} (attempt {}/{}), recreating probe runtime: code={} detail={}",
                        EXECUTION_PROBE_SESSION_ID,
                        attempt,
                        EXECUTION_PROBE_RECOVERY_ATTEMPTS,
                        err.code(),
                        err
                    );
                    self.reset_session_runtime(EXECUTION_PROBE_SESSION_ID).await;
                    continue;
                }
                Err(err)
                    if should_restart_execution_probe_runtime_after_error(&err)
                        && !restarted_runtime
                        && self.provisioner.is_some() =>
                {
                    restarted_runtime = true;
                    attempt = 0;
                    log::warn!(
                        "execution probe failed for session {} after targeted recovery, restarting managed BoxLite runtime: code={} detail={}",
                        EXECUTION_PROBE_SESSION_ID,
                        err.code(),
                        err
                    );
                    if let Err(restart_err) = self.restart_managed_runtime_for_probe().await {
                        return SandboxExecutionProbe {
                            status: SandboxExecutionProbeStatus::Failed,
                            detail: Some(format!(
                                "The BoxLite server is reachable, but a lightweight execution probe failed: {} (runtime restart failed: {})",
                                err.user_message(),
                                restart_err.user_message()
                            )),
                            checked_at_unix_ms,
                        };
                    }
                    continue;
                }
                Err(err) => {
                    return SandboxExecutionProbe {
                        status: SandboxExecutionProbeStatus::Failed,
                        detail: Some(format!(
                            "The BoxLite server is reachable, but a lightweight execution probe failed: {}",
                            err.user_message()
                        )),
                        checked_at_unix_ms,
                    };
                }
            }
        }
    }

    pub async fn list_active_sandboxes(&self) -> Vec<SandboxLeaseInfo> {
        let leases = self.session_leases.read().await;
        leases
            .iter()
            .map(|(session_id, lease)| SandboxLeaseInfo {
                session_id: session_id.clone(),
                sandbox_id: lease.sandbox_id.clone(),
                sandbox_name: lease.sandbox_name.clone(),
                expires_at_unix_ms: lease.expires_at_unix_ms,
            })
            .collect()
    }

    pub async fn shutdown(&self) -> Result<(), SandboxError> {
        self.stop_background_worker().await;

        let active_ids: Vec<String> = {
            let active = self.active_ids.read().await;
            active.iter().cloned().collect()
        };
        for sandbox_id in active_ids {
            let backend = self.current_backend().await;
            let _ = backend.stop_box(&sandbox_id).await;
            self.remove_lease_by_sandbox_id(&sandbox_id).await;
        }
        let backend = self.current_backend().await;
        let result = backend.shutdown().await;

        if let Some(ref provisioner) = self.provisioner {
            provisioner.stop().await;
        }

        result
    }

    async fn get_valid_lease(&self, session_id: &str, now_ms: i64) -> Option<SandboxLeaseInfo> {
        let mut stale_sandbox: Option<String> = None;
        let mut output = None;

        {
            let mut leases = self.session_leases.write().await;
            if let Some(lease) = leases.get_mut(session_id) {
                if lease.expires_at_unix_ms > now_ms {
                    lease.expires_at_unix_ms =
                        now_ms + self.options.default_timeout.as_millis() as i64;
                    output = Some(SandboxLeaseInfo {
                        session_id: session_id.to_string(),
                        sandbox_id: lease.sandbox_id.clone(),
                        sandbox_name: lease.sandbox_name.clone(),
                        expires_at_unix_ms: lease.expires_at_unix_ms,
                    });
                } else {
                    stale_sandbox = Some(lease.sandbox_id.clone());
                }
            }
            if stale_sandbox.is_some() {
                leases.remove(session_id);
            }
        }

        if let Some(stale_id) = stale_sandbox {
            self.remove_lease(session_id, &stale_id).await;
            let backend = self.current_backend().await;
            let _ = backend.stop_box(&stale_id).await;
        }
        output
    }

    async fn touch_lease(&self, session_id: &str) {
        let now_ms = now_unix_ms();
        let mut leases = self.session_leases.write().await;
        if let Some(lease) = leases.get_mut(session_id) {
            lease.expires_at_unix_ms = now_ms + self.options.default_timeout.as_millis() as i64;
        }
    }

    async fn ensure_capacity(&self) -> Result<(), SandboxError> {
        let current = {
            let active = self.active_ids.read().await;
            active.len()
        };
        if current < self.options.max_sandboxes {
            return Ok(());
        }

        self.reap_zombies().await?;

        let after_reap = {
            let active = self.active_ids.read().await;
            active.len()
        };
        if after_reap >= self.options.max_sandboxes {
            return Err(SandboxError::ResourceLimit(format!(
                "sandbox limit reached: {}",
                self.options.max_sandboxes
            )));
        }
        Ok(())
    }

    async fn session_run_lock(&self, session_id: &str) -> Arc<Mutex<()>> {
        {
            let locks = self.run_locks.read().await;
            if let Some(lock) = locks.get(session_id) {
                return Arc::clone(lock);
            }
        }
        let mut locks = self.run_locks.write().await;
        Arc::clone(
            locks
                .entry(session_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
    }

    async fn remove_lease(&self, session_id: &str, sandbox_id: &str) {
        {
            let mut leases = self.session_leases.write().await;
            leases.remove(session_id);
        }
        {
            let mut active = self.active_ids.write().await;
            active.remove(sandbox_id);
        }
    }

    async fn remove_lease_by_sandbox_id(&self, sandbox_id: &str) {
        let mut target_session = None;
        {
            let leases = self.session_leases.read().await;
            for (session, lease) in leases.iter() {
                if lease.sandbox_id == sandbox_id {
                    target_session = Some(session.clone());
                    break;
                }
            }
        }
        if let Some(session) = target_session {
            self.remove_lease(&session, sandbox_id).await;
        } else {
            let mut active = self.active_ids.write().await;
            active.remove(sandbox_id);
        }
    }

    async fn current_backend(&self) -> Arc<dyn SandboxProvider> {
        self.backend.read().await.clone()
    }

    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    async fn replace_backend(&self, next_backend: Arc<dyn SandboxProvider>) {
        let next_name = next_backend.provider_name().to_string();
        let current_name = self.provider_name().await;
        {
            let mut guard = self.backend.write().await;
            *guard = next_backend;
        }
        if current_name != next_name {
            self.clear_runtime_state().await;
        }
    }

    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    async fn clear_runtime_state(&self) {
        self.session_leases.write().await.clear();
        self.active_ids.write().await.clear();
        self.run_locks.write().await.clear();
    }

    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    async fn refresh_backend(&self) -> Result<(), SandboxError> {
        let next_backend = Self::build_provider(&self.options, self.provisioner.as_ref())
            .unwrap_or_else(|err| {
                Arc::new(DisabledProvider {
                    reason: err.to_string(),
                }) as Arc<dyn SandboxProvider>
            });
        self.replace_backend(next_backend).await;
        Ok(())
    }

    async fn boxlite_status(&self) -> SandboxBoxLiteStatus {
        if let Some(provisioner) = self.provisioner.as_ref() {
            let record = provisioner.installation_record();
            let endpoint = provisioner.endpoint();
            let reachable = provisioner.is_endpoint_reachable().await;
            return SandboxBoxLiteStatus {
                binary_found: record.is_some(),
                binary_path: record.as_ref().map(|record| record.wsl_binary_path.clone()),
                endpoint: Some(endpoint),
                reachable,
                managed_by_deeting: record.is_some(),
            };
        }

        SandboxBoxLiteStatus::default()
    }

    fn build_provisioner(
        options: &SandboxManagerOptions,
    ) -> Option<Arc<crate::modules::sandbox::provisioner::BoxLiteProvisioner>> {
        #[cfg(not(target_os = "windows"))]
        {
            let _ = options;
            None
        }

        #[cfg(target_os = "windows")]
        {
            use crate::modules::sandbox::provisioner::{BoxLiteConfig, BoxLiteProvisioner};
            Some(Arc::new(BoxLiteProvisioner::new(
                BoxLiteConfig::from_home_dir(&options.home_dir),
            )))
        }
    }

    fn build_provider(
        options: &SandboxManagerOptions,
        provisioner: Option<&Arc<crate::modules::sandbox::provisioner::BoxLiteProvisioner>>,
    ) -> Result<Arc<dyn SandboxProvider>, SandboxError> {
        #[cfg(not(target_os = "windows"))]
        {
            let _ = options;
            let _ = provisioner;
            return Err(SandboxError::Unavailable(
                "native boxrun backend is not linked in this desktop package; use WSL backend"
                    .to_string(),
            ));
        }

        #[cfg(target_os = "windows")]
        {
            if let Some(bridge_url) = options.bridge_url.clone() {
                match Self::try_wsl_backend(&bridge_url, options) {
                    Ok(provider) => return Ok(provider),
                    Err(err) => {
                        log::warn!(
                            "boxrun WSL backend at {} unavailable: code={} detail={}",
                            bridge_url,
                            err.code(),
                            err
                        );
                    }
                }
            }

            if let Some(provisioner) = provisioner {
                if provisioner.installation_record().is_some() {
                    let auto_endpoint = provisioner.endpoint();
                    match Self::try_wsl_backend(&auto_endpoint, options) {
                        Ok(provider) => return Ok(provider),
                        Err(err) => {
                            log::warn!(
                                "boxrun WSL backend at managed endpoint {} unavailable: code={} detail={}",
                                auto_endpoint,
                                err.code(),
                                err
                            );
                        }
                    }
                }
            }

            log::warn!("no BoxLite endpoint available, falling back to host python runtime");
            let host_backend = HostPythonBackend::new(HostBackendOptions {
                python_bin: options.python_bin.clone(),
                working_dir: options.working_dir.clone(),
            })?;
            Ok(Arc::new(host_backend))
        }
    }

    #[cfg(target_os = "windows")]
    fn try_wsl_backend(
        bridge_url: &str,
        options: &SandboxManagerOptions,
    ) -> Result<Arc<dyn SandboxProvider>, SandboxError> {
        let backend = WslBoxrunBackend::new(WslBackendOptions {
            base_url: bridge_url.to_string(),
            api_key: options.bridge_api_key.clone(),
            python_bin: options.python_bin.clone(),
            working_dir: options.working_dir.clone(),
        })?;

        let provider: Arc<dyn SandboxProvider> = Arc::new(backend);
        let probe_ref = Arc::clone(&provider);
        tauri::async_runtime::spawn(async move {
            if let Err(err) = probe_ref.probe().await {
                log::warn!(
                    "boxrun REST probe failed: code={} detail={}",
                    err.code(),
                    err
                );
            }
        });

        Ok(provider)
    }
}

fn runtime_mode_from_provider_name(provider_name: &str) -> SandboxRuntimeMode {
    match provider_name {
        "host-python" => SandboxRuntimeMode::HostFallback,
        "disabled" => SandboxRuntimeMode::Disabled,
        _ => SandboxRuntimeMode::Sandbox,
    }
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn snippet_validation_response(
    language: &SandboxSnippetLanguage,
    runtime_mode: SandboxRuntimeMode,
    message: impl Into<String>,
) -> SandboxSnippetRunResponse {
    snippet_error_response(
        language,
        runtime_mode,
        message,
        Some("SANDBOX_VALIDATION_ERROR".to_string()),
        None,
    )
}

fn snippet_blocked_response(
    language: &SandboxSnippetLanguage,
    report: &SandboxReadinessReport,
) -> SandboxSnippetRunResponse {
    SandboxSnippetRunResponse {
        success: false,
        status: "blocked".to_string(),
        language: language.as_str().to_string(),
        image: language.image().to_string(),
        sandbox_id: None,
        runtime_mode: report.runtime_mode,
        stdout: Vec::new(),
        stderr: Vec::new(),
        result: Vec::new(),
        exit_code: None,
        error: Some(
            report
                .blocking_reason
                .clone()
                .unwrap_or_else(|| "sandbox is not ready for local code execution".to_string()),
        ),
        error_code: Some(sandbox_status_error_code(report.status).to_string()),
        readiness: Some(report.clone()),
    }
}

fn snippet_success_response(
    language: &SandboxSnippetLanguage,
    runtime_mode: SandboxRuntimeMode,
    run: SandboxRunResult,
) -> SandboxSnippetRunResponse {
    SandboxSnippetRunResponse {
        success: run.exit_code == 0,
        status: if run.exit_code == 0 {
            "success".to_string()
        } else {
            "failed".to_string()
        },
        language: language.as_str().to_string(),
        image: language.image().to_string(),
        sandbox_id: Some(run.sandbox_id),
        runtime_mode,
        stdout: run.stdout,
        stderr: run.stderr,
        result: run.result,
        exit_code: Some(run.exit_code),
        error: if run.exit_code == 0 {
            None
        } else {
            Some("local code execution failed".to_string())
        },
        error_code: if run.exit_code == 0 {
            None
        } else {
            Some("SANDBOX_EXECUTION_FAILED".to_string())
        },
        readiness: None,
    }
}

fn snippet_error_response(
    language: &SandboxSnippetLanguage,
    runtime_mode: SandboxRuntimeMode,
    message: impl Into<String>,
    error_code: Option<String>,
    readiness: Option<SandboxReadinessReport>,
) -> SandboxSnippetRunResponse {
    SandboxSnippetRunResponse {
        success: false,
        status: "failed".to_string(),
        language: language.as_str().to_string(),
        image: language.image().to_string(),
        sandbox_id: None,
        runtime_mode,
        stdout: Vec::new(),
        stderr: Vec::new(),
        result: Vec::new(),
        exit_code: None,
        error: Some(message.into()),
        error_code,
        readiness,
    }
}

fn sandbox_status_error_code(status: SandboxReadinessStatus) -> &'static str {
    match status {
        SandboxReadinessStatus::NeedsWsl => "SANDBOX_NEEDS_WSL",
        SandboxReadinessStatus::NeedsBoxLite => "SANDBOX_NEEDS_BOXLITE",
        SandboxReadinessStatus::RepairNeeded => "SANDBOX_REPAIR_REQUIRED",
        SandboxReadinessStatus::Unsupported => "SANDBOX_UNSUPPORTED_PLATFORM",
        SandboxReadinessStatus::Ready => "SANDBOX_REQUIRED",
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn derive_windows_readiness(
    runtime_mode: SandboxRuntimeMode,
    wsl: &SandboxWslStatus,
    boxlite: &SandboxBoxLiteStatus,
) -> (SandboxReadinessStatus, Option<String>, Vec<String>) {
    if runtime_mode == SandboxRuntimeMode::Sandbox && boxlite.reachable {
        return (
            SandboxReadinessStatus::Ready,
            None,
            vec!["Sandbox is ready for programmatic execution.".to_string()],
        );
    }

    if !wsl.ready {
        return (
            SandboxReadinessStatus::NeedsWsl,
            wsl.detail.clone().or_else(|| {
                Some("WSL is required before the Deeting sandbox can run.".to_string())
            }),
            vec!["Install or initialize WSL first, then rerun sandbox detection.".to_string()],
        );
    }

    if !boxlite.binary_found {
        return (
            SandboxReadinessStatus::NeedsBoxLite,
            Some("BoxLite is not installed in WSL for the Deeting sandbox yet.".to_string()),
            vec![
                "Install BoxLite from Desktop Sandbox settings, then Deeting will prepare the managed BoxLite server automatically."
                    .to_string(),
            ],
        );
    }

    (
        SandboxReadinessStatus::RepairNeeded,
        Some(
            "BoxLite is installed but not reachable yet. Try preparing or repairing the sandbox."
                .to_string(),
        ),
        vec![
            "Try Prepare to start BoxLite automatically.".to_string(),
            "If it still fails, use Repair to restart the sandbox service.".to_string(),
        ],
    )
}

#[allow(dead_code)]
fn refine_ready_status_with_execution_probe(
    status: SandboxReadinessStatus,
    blocking_reason: Option<String>,
    next_actions: Vec<String>,
    execution_probe: SandboxExecutionProbe,
) -> (SandboxReadinessStatus, Option<String>, Vec<String>) {
    if status != SandboxReadinessStatus::Ready {
        return (status, blocking_reason, next_actions);
    }

    match execution_probe.status {
        SandboxExecutionProbeStatus::Passed | SandboxExecutionProbeStatus::Skipped => {
            (status, blocking_reason, next_actions)
        }
        SandboxExecutionProbeStatus::Failed => (
            SandboxReadinessStatus::RepairNeeded,
            execution_probe.detail.or(blocking_reason).or_else(|| {
                Some(
                    "The BoxLite server is reachable, but a lightweight execution probe failed."
                        .to_string(),
                )
            }),
            vec![
                "Try Prepare to recreate a healthy runnable sandbox session.".to_string(),
                "If it still fails, use Repair to restart the sandbox service.".to_string(),
                "If the issue keeps repeating, use Rebuild Sandbox to clear stale runtime state."
                    .to_string(),
            ],
        ),
    }
}

fn build_install_guide(report: &SandboxReadinessReport) -> SandboxInstallGuide {
    match report.status {
        SandboxReadinessStatus::Ready => SandboxInstallGuide {
            status: report.status,
            title: "Sandbox ready".to_string(),
            description: "The desktop sandbox is ready for programmatic execution.".to_string(),
            steps: vec!["You can start sandboxed execution safely.".to_string()],
            primary_command: None,
        },
        SandboxReadinessStatus::NeedsWsl => SandboxInstallGuide {
            status: report.status,
            title: "Install Windows Subsystem for Linux".to_string(),
            description: "Sandboxed programmatic execution on Windows depends on WSL before BoxLite can start."
                .to_string(),
            steps: vec![
                "Run the recommended WSL installation command in an elevated terminal.".to_string(),
                "Restart the machine if Windows prompts you to do so.".to_string(),
                "Open WSL once to finish distro initialization, then rerun sandbox detection."
                    .to_string(),
            ],
            primary_command: report
                .wsl
                .as_ref()
                .and_then(|wsl| wsl.recommended_command.clone())
                .or_else(|| Some("wsl --install".to_string())),
        },
        SandboxReadinessStatus::NeedsBoxLite => SandboxInstallGuide {
            status: report.status,
            title: "Install BoxLite into WSL".to_string(),
            description:
                "BoxLite is required for isolated programmatic execution and will be installed into your WSL environment."
                    .to_string(),
            steps: vec![
                "Click Install BoxLite in Desktop Sandbox settings.".to_string(),
                "Deeting will download the pinned official BoxLite CLI release, verify its SHA256 checksum, and install the managed BoxLite server into WSL."
                    .to_string(),
            ],
            primary_command: None,
        },
        SandboxReadinessStatus::RepairNeeded => SandboxInstallGuide {
            status: report.status,
            title: "Repair sandbox service".to_string(),
            description: if report.boxlite.reachable {
                "BoxLite is reachable, but the desktop sandbox session is stale or no longer runnable."
                    .to_string()
            } else {
                "BoxLite is installed in WSL, but the local BoxLite server is not reachable."
                    .to_string()
            },
            steps: if report.boxlite.reachable {
                vec![
                    "Click Prepare to recreate a healthy runnable sandbox session.".to_string(),
                    "If it still fails, click Repair to restart the sandbox service.".to_string(),
                    "If the same stale-session error returns, click Rebuild Sandbox to clear the runtime state."
                        .to_string(),
                ]
            } else {
                vec![
                    "Click Prepare to try starting BoxLite automatically.".to_string(),
                    "If Prepare does not work, click Repair to restart the sandbox process."
                        .to_string(),
                ]
            },
            primary_command: None,
        },
        SandboxReadinessStatus::Unsupported => SandboxInstallGuide {
            status: report.status,
            title: "Platform not supported".to_string(),
            description:
                "Managed desktop sandbox installation is currently supported on Windows only."
                    .to_string(),
            steps: vec!["Use the Windows desktop build for the managed sandbox flow.".to_string()],
            primary_command: None,
        },
    }
}

fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn bridge_url_from_env() -> Option<String> {
    non_empty_env("BOXRUN_BASE_URL").or_else(|| boxrun_url_from_host_port_env())
}

fn boxrun_url_from_host_port_env() -> Option<String> {
    let host = non_empty_env("BOXRUN_HOST");
    let port = non_empty_env("BOXRUN_PORT");
    if host.is_none() && port.is_none() {
        return None;
    }

    let raw_host = host.unwrap_or_else(|| "http://127.0.0.1".to_string());
    let normalized = if raw_host.starts_with("http://") || raw_host.starts_with("https://") {
        raw_host
    } else {
        format!("http://{raw_host}")
    };
    let mut parsed = reqwest::Url::parse(&normalized).ok()?;

    let resolved_port = port
        .and_then(|raw| raw.parse::<u16>().ok())
        .or_else(|| parsed.port())
        .unwrap_or(DEFAULT_BOXRUN_PORT);
    let _ = parsed.set_port(Some(resolved_port));
    Some(parsed.to_string().trim_end_matches('/').to_string())
}

#[cfg(target_os = "windows")]
fn discover_bridge_url() -> Option<String> {
    let candidates = bridge_url_candidates();
    if candidates.is_empty() {
        return None;
    }

    for candidate in candidates {
        if is_bridge_candidate_reachable(&candidate) {
            log::info!("auto discovered BOXRUN endpoint: {}", candidate);
            return Some(candidate);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn bridge_url_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(url) = boxrun_url_from_host_port_env() {
        candidates.push(url);
    }

    if let Some(raw) = non_empty_env("BOXRUN_BASE_URL_CANDIDATES") {
        let parsed = parse_bridge_url_candidates(&raw);
        if !parsed.is_empty() {
            candidates.extend(parsed);
        }
    }

    for default_url in DEFAULT_BRIDGE_DISCOVERY_URLS {
        candidates.push(default_url.to_string());
    }

    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for candidate in candidates {
        if seen.insert(candidate.clone()) {
            deduped.push(candidate);
        }
    }
    deduped
}

#[cfg(target_os = "windows")]
fn parse_bridge_url_candidates(raw: &str) -> Vec<String> {
    raw.split([',', ';', '\n', '\t', ' '])
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .collect()
}

#[cfg(target_os = "windows")]
fn is_bridge_candidate_reachable(base_url: &str) -> bool {
    let parsed = match reqwest::Url::parse(base_url) {
        Ok(url) => url,
        Err(_) => return false,
    };

    let host = match parsed.host_str() {
        Some(host) => host,
        None => return false,
    };
    let port = match parsed.port_or_known_default() {
        Some(port) => port,
        None => return false,
    };
    let timeout = Duration::from_millis(DEFAULT_BRIDGE_DISCOVERY_TIMEOUT_MS);
    let addrs = match (host, port).to_socket_addrs() {
        Ok(addrs) => addrs,
        Err(_) => return false,
    };

    for addr in addrs {
        if TcpStream::connect_timeout(&addr, timeout).is_ok() {
            return true;
        }
    }
    false
}

fn normalize_session_id(raw: &str) -> Result<String, SandboxError> {
    let session = raw.trim();
    if session.is_empty() {
        return Err(SandboxError::Validation(
            "session_id is required".to_string(),
        ));
    }
    Ok(session.to_string())
}

fn session_to_box_name(session_id: &str) -> String {
    let mut normalized = String::with_capacity(session_id.len());
    for c in session_id.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
            normalized.push(c);
        } else {
            normalized.push('-');
        }
    }
    if normalized.is_empty() {
        normalized.push_str("session");
    }
    if normalized.len() > 48 {
        normalized.truncate(48);
    }

    let mut hasher = Sha256::new();
    hasher.update(session_id.as_bytes());
    let digest = hasher.finalize();
    let suffix = hex::encode(&digest[..4]);
    format!("deeting-{normalized}-{suffix}")
}

#[cfg(test)]
mod session_name_tests {
    use super::*;

    #[test]
    fn runtime_mode_maps_provider_name() {
        assert_eq!(
            runtime_mode_from_provider_name("boxlite"),
            SandboxRuntimeMode::Sandbox
        );
        assert_eq!(
            runtime_mode_from_provider_name("host-python"),
            SandboxRuntimeMode::HostFallback
        );
        assert_eq!(
            runtime_mode_from_provider_name("disabled"),
            SandboxRuntimeMode::Disabled
        );
    }

    #[test]
    fn derive_windows_readiness_requires_wsl_before_boxlite() {
        let (status, reason, actions) = derive_windows_readiness(
            SandboxRuntimeMode::HostFallback,
            &SandboxWslStatus {
                installed: false,
                ready: false,
                detail: Some("wsl unavailable".to_string()),
                recommended_command: Some("wsl --install".to_string()),
            },
            &SandboxBoxLiteStatus::default(),
        );

        assert_eq!(status, SandboxReadinessStatus::NeedsWsl);
        assert!(reason.unwrap().contains("wsl"));
        assert!(!actions.is_empty());
    }

    #[test]
    fn derive_windows_readiness_requires_boxlite_install_when_wsl_is_ready() {
        let (status, reason, actions) = derive_windows_readiness(
            SandboxRuntimeMode::HostFallback,
            &SandboxWslStatus {
                installed: true,
                ready: true,
                detail: None,
                recommended_command: None,
            },
            &SandboxBoxLiteStatus::default(),
        );

        assert_eq!(status, SandboxReadinessStatus::NeedsBoxLite);
        assert!(reason.unwrap().contains("BoxLite"));
        assert!(!actions.is_empty());
    }

    #[test]
    fn build_install_guide_for_repair_mentions_prepare_and_repair() {
        let guide = build_install_guide(&SandboxReadinessReport {
            platform: "windows".to_string(),
            platform_supported: true,
            status: SandboxReadinessStatus::RepairNeeded,
            provider_name: "host-python".to_string(),
            runtime_mode: SandboxRuntimeMode::HostFallback,
            wsl: Some(SandboxWslStatus {
                installed: true,
                ready: true,
                detail: None,
                recommended_command: None,
            }),
            boxlite: SandboxBoxLiteStatus {
                binary_found: true,
                binary_path: Some("C:/sandbox/boxlite.exe".to_string()),
                endpoint: Some("http://127.0.0.1:4318".to_string()),
                reachable: false,
                managed_by_deeting: true,
            },
            execution_probe: SandboxExecutionProbe::default(),
            blocking_reason: Some("BoxLite is installed but not reachable yet.".to_string()),
            next_actions: vec![],
            can_auto_prepare: true,
        });

        assert_eq!(guide.status, SandboxReadinessStatus::RepairNeeded);
        assert!(guide.title.contains("Repair"));
        assert!(guide.steps.iter().any(|step| step.contains("Prepare")));
    }

    #[test]
    fn build_install_guide_for_reachable_probe_failure_mentions_rebuild() {
        let guide = build_install_guide(&SandboxReadinessReport {
            platform: "windows".to_string(),
            platform_supported: true,
            status: SandboxReadinessStatus::RepairNeeded,
            provider_name: "boxlite".to_string(),
            runtime_mode: SandboxRuntimeMode::Sandbox,
            wsl: Some(SandboxWslStatus {
                installed: true,
                ready: true,
                detail: None,
                recommended_command: None,
            }),
            boxlite: SandboxBoxLiteStatus {
                binary_found: true,
                binary_path: Some(
                    "/home/timeline/.deeting/sandbox/boxlite/cli/boxlite".to_string(),
                ),
                endpoint: Some("http://127.0.0.1:9090".to_string()),
                reachable: true,
                managed_by_deeting: true,
            },
            execution_probe: SandboxExecutionProbe {
                status: SandboxExecutionProbeStatus::Failed,
                detail: Some(
                    "The BoxLite server is reachable, but a lightweight execution probe failed."
                        .to_string(),
                ),
                checked_at_unix_ms: Some(123),
            },
            blocking_reason: Some(
                "The BoxLite server is reachable, but a lightweight execution probe failed."
                    .to_string(),
            ),
            next_actions: vec![],
            can_auto_prepare: true,
        });

        assert_eq!(guide.status, SandboxReadinessStatus::RepairNeeded);
        assert!(guide.description.contains("reachable"));
        assert!(!guide.description.contains("not reachable"));
        assert!(guide
            .steps
            .iter()
            .any(|step| step.contains("Rebuild Sandbox")));
    }
}

fn is_session_busy_error(err: &SandboxError) -> bool {
    match err {
        SandboxError::Busy(_) => true,
        SandboxError::Internal(message) => {
            let lowered = message.to_lowercase();
            lowered.contains("session is busy") || lowered.contains("codes session is busy")
        }
        _ => false,
    }
}

fn is_missing_sandbox_error(err: &SandboxError) -> bool {
    match err {
        SandboxError::NotFound(_) => true,
        SandboxError::Internal(message) => {
            let lowered = message.to_lowercase();
            ((lowered.contains("not found") || lowered.contains("does not exist"))
                && (lowered.contains("sandbox")
                    || lowered.contains("box")
                    || lowered.contains("id")))
                || lowered.contains("no such box")
        }
        _ => false,
    }
}

fn is_stopped_handle_error(err: &SandboxError) -> bool {
    match err {
        SandboxError::Internal(message) => {
            let lowered = message.to_ascii_lowercase();
            lowered.contains("handle invalidated after stop")
                || lowered.contains("use runtime.get() to get a new handle")
        }
        _ => false,
    }
}

fn should_retry_execution_probe_after_error(err: &SandboxError) -> bool {
    is_missing_sandbox_error(err)
        || is_stopped_handle_error(err)
        || matches!(err, SandboxError::Network(_))
}

fn should_restart_execution_probe_runtime_after_error(err: &SandboxError) -> bool {
    is_stopped_handle_error(err)
}

fn now_unix_ms() -> i64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    now.as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
    use std::path::PathBuf;
    use std::sync::Arc;

    use async_trait::async_trait;

    use crate::modules::sandbox::provider::SandboxProvider;
    use crate::modules::sandbox::types::{SandboxExecutionOutput, SandboxIdentity};

    #[derive(Default)]
    struct MockProviderState {
        broken_name_removed: bool,
        stop_calls: Vec<String>,
        remove_calls: Vec<String>,
        run_calls: Vec<String>,
    }

    #[derive(Clone)]
    struct MockZombieByNameProvider {
        broken_box_name: String,
        state: Arc<Mutex<MockProviderState>>,
    }

    impl MockZombieByNameProvider {
        fn new(broken_box_name: String) -> Self {
            Self {
                broken_box_name,
                state: Arc::new(Mutex::new(MockProviderState::default())),
            }
        }
    }

    #[derive(Clone)]
    enum MockProbeOutcome {
        Passed,
        FailedNotFound,
    }

    #[derive(Clone, Copy)]
    enum MockRecoverableProbeFailure {
        Network,
        InvalidatedHandle,
    }

    #[derive(Clone)]
    struct MockProbeProvider {
        outcome: MockProbeOutcome,
    }

    #[derive(Clone)]
    struct MockRecoverableProbeProvider {
        state: Arc<Mutex<MockProviderState>>,
        failure: MockRecoverableProbeFailure,
    }

    #[async_trait]
    impl SandboxProvider for MockProbeProvider {
        fn provider_name(&self) -> &str {
            "mock-sandbox"
        }

        async fn get_or_create_box(
            &self,
            box_name: &str,
            _spec: &SandboxBoxSpec,
        ) -> Result<SandboxIdentity, SandboxError> {
            Ok(SandboxIdentity {
                sandbox_id: format!("{box_name}-id"),
                sandbox_name: box_name.to_string(),
            })
        }

        async fn stop_box(&self, _box_id_or_name: &str) -> Result<(), SandboxError> {
            Ok(())
        }

        async fn remove_box(
            &self,
            _box_id_or_name: &str,
            _force: bool,
        ) -> Result<(), SandboxError> {
            Ok(())
        }

        async fn run_python(
            &self,
            _box_id_or_name: &str,
            _code: &str,
            _timeout_seconds: u64,
        ) -> Result<SandboxExecutionOutput, SandboxError> {
            match self.outcome {
                MockProbeOutcome::Passed => Ok(SandboxExecutionOutput {
                    stdout: vec![EXECUTION_PROBE_SENTINEL.to_string()],
                    stderr: vec![],
                    exit_code: 0,
                    error_message: None,
                }),
                MockProbeOutcome::FailedNotFound => Err(SandboxError::NotFound(
                    "sandbox probe not found".to_string(),
                )),
            }
        }
    }

    #[async_trait]
    impl SandboxProvider for MockRecoverableProbeProvider {
        fn provider_name(&self) -> &str {
            "mock-sandbox"
        }

        async fn get_or_create_box(
            &self,
            box_name: &str,
            _spec: &SandboxBoxSpec,
        ) -> Result<SandboxIdentity, SandboxError> {
            Ok(SandboxIdentity {
                sandbox_id: format!("{box_name}-id"),
                sandbox_name: box_name.to_string(),
            })
        }

        async fn stop_box(&self, box_id_or_name: &str) -> Result<(), SandboxError> {
            let mut state = self.state.lock().await;
            state.stop_calls.push(box_id_or_name.to_string());
            Ok(())
        }

        async fn remove_box(&self, box_id_or_name: &str, _force: bool) -> Result<(), SandboxError> {
            let mut state = self.state.lock().await;
            state.remove_calls.push(box_id_or_name.to_string());
            state.broken_name_removed = true;
            Ok(())
        }

        async fn run_python(
            &self,
            box_id_or_name: &str,
            _code: &str,
            _timeout_seconds: u64,
        ) -> Result<SandboxExecutionOutput, SandboxError> {
            let mut state = self.state.lock().await;
            state.run_calls.push(box_id_or_name.to_string());
            if state.broken_name_removed {
                return Ok(SandboxExecutionOutput {
                    stdout: vec![EXECUTION_PROBE_SENTINEL.to_string()],
                    stderr: vec![],
                    exit_code: 0,
                    error_message: None,
                });
            }
            Err(match self.failure {
                MockRecoverableProbeFailure::Network => {
                    SandboxError::Network("bridge dropped the probe request".to_string())
                }
                MockRecoverableProbeFailure::InvalidatedHandle => SandboxError::Internal(
                    "stopped: Handle invalidated after stop(). Use runtime.get() to get a new handle."
                        .to_string(),
                ),
            })
        }
    }

    #[async_trait]
    impl SandboxProvider for MockZombieByNameProvider {
        fn provider_name(&self) -> &str {
            "mock-sandbox"
        }

        async fn get_or_create_box(
            &self,
            box_name: &str,
            _spec: &SandboxBoxSpec,
        ) -> Result<SandboxIdentity, SandboxError> {
            let state = self.state.lock().await;
            let sandbox_id = if state.broken_name_removed {
                "fresh-box"
            } else {
                "stale-box"
            };
            Ok(SandboxIdentity {
                sandbox_id: sandbox_id.to_string(),
                sandbox_name: box_name.to_string(),
            })
        }

        async fn stop_box(&self, box_id_or_name: &str) -> Result<(), SandboxError> {
            let mut state = self.state.lock().await;
            state.stop_calls.push(box_id_or_name.to_string());
            Ok(())
        }

        async fn remove_box(&self, box_id_or_name: &str, _force: bool) -> Result<(), SandboxError> {
            let mut state = self.state.lock().await;
            state.remove_calls.push(box_id_or_name.to_string());
            if box_id_or_name == self.broken_box_name {
                state.broken_name_removed = true;
            }
            Ok(())
        }

        async fn run_python(
            &self,
            box_id_or_name: &str,
            _code: &str,
            _timeout_seconds: u64,
        ) -> Result<SandboxExecutionOutput, SandboxError> {
            let mut state = self.state.lock().await;
            state.run_calls.push(box_id_or_name.to_string());
            match box_id_or_name {
                "stale-box" => Err(SandboxError::NotFound(
                    "sandbox stale-box not found".to_string(),
                )),
                "fresh-box" => Ok(SandboxExecutionOutput {
                    stdout: vec!["ok".to_string()],
                    stderr: vec![],
                    exit_code: 0,
                    error_message: None,
                }),
                other => Err(SandboxError::Internal(format!(
                    "unexpected sandbox id {other}"
                ))),
            }
        }
    }

    fn test_manager(provider: Arc<dyn SandboxProvider>) -> SandboxRuntimeManager {
        SandboxRuntimeManager {
            backend: Arc::new(RwLock::new(provider)),
            provisioner: None,
            options: SandboxManagerOptions {
                home_dir: PathBuf::from("/tmp/deeting-sandbox-tests"),
                default_timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
                max_sandboxes: DEFAULT_MAX_SANDBOXES,
                image: "python:3.11-slim".to_string(),
                cpus: Some(1),
                memory_mib: Some(512),
                working_dir: Some("/workspace".to_string()),
                python_bin: "python3".to_string(),
                bridge_url: None,
                bridge_api_key: None,
            },
            session_leases: Arc::new(RwLock::new(HashMap::new())),
            active_ids: Arc::new(RwLock::new(HashSet::new())),
            run_locks: Arc::new(RwLock::new(HashMap::new())),
            cleanup_task: Arc::new(Mutex::new(None)),
        }
    }

    #[test]
    fn session_name_is_stable_and_safe() {
        let session = "user:abc/123";
        let box_name = session_to_box_name(session);
        assert!(box_name.starts_with("deeting-"));
        assert!(box_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'));
    }

    #[test]
    fn normalize_session_rejects_empty() {
        let err = normalize_session_id("   ").unwrap_err();
        assert_eq!(err.code(), "SANDBOX_VALIDATION_ERROR");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parse_bridge_candidates_splits_common_delimiters() {
        let parsed = parse_bridge_url_candidates(
            " http://127.0.0.1:3030,https://localhost:3031;http://a\nhttp://b\t http://c ",
        );
        assert_eq!(
            parsed,
            vec![
                "http://127.0.0.1:3030",
                "https://localhost:3031",
                "http://a",
                "http://b",
                "http://c"
            ]
        );
    }

    #[test]
    fn missing_sandbox_errors_are_detected() {
        assert!(is_missing_sandbox_error(&SandboxError::NotFound(
            "sandbox abc not found".to_string()
        )));
        assert!(is_missing_sandbox_error(&SandboxError::Internal(
            "sandbox abc not found".to_string()
        )));
        assert!(is_missing_sandbox_error(&SandboxError::Internal(
            "box id does not exist".to_string()
        )));
        assert!(!is_missing_sandbox_error(&SandboxError::Busy(
            "session is busy".to_string()
        )));
    }

    #[test]
    fn stopped_handle_errors_are_detected() {
        assert!(is_stopped_handle_error(&SandboxError::Internal(
            "stopped: Handle invalidated after stop(). Use runtime.get() to get a new handle."
                .to_string(),
        )));
        assert!(!is_stopped_handle_error(&SandboxError::NotFound(
            "sandbox missing".to_string()
        )));
    }

    #[test]
    fn stopped_handle_errors_trigger_probe_runtime_restart_policy() {
        assert!(should_restart_execution_probe_runtime_after_error(
            &SandboxError::Internal(
                "stopped: Handle invalidated after stop(). Use runtime.get() to get a new handle."
                    .to_string(),
            )
        ));
        assert!(!should_restart_execution_probe_runtime_after_error(
            &SandboxError::Network("bridge dropped".to_string())
        ));
    }

    #[tokio::test]
    async fn missing_sandbox_retry_recreates_box_when_name_alias_is_stale() {
        let session_id = "chat-session";
        let stale_box_name = session_to_box_name(session_id);
        let provider = MockZombieByNameProvider::new(stale_box_name.clone());
        let state = provider.state.clone();
        let manager = test_manager(Arc::new(provider));

        let result = manager
            .run_code(
                session_id,
                "print('hello')",
                Some("python"),
                Some(5),
                SandboxLaunchPolicy::StrictSandbox,
            )
            .await;

        let run = result.expect("missing sandbox recovery should recreate a fresh box");
        assert_eq!(run.stdout, vec!["ok".to_string()]);

        let state = state.lock().await;
        assert_eq!(
            state.run_calls,
            vec!["stale-box".to_string(), "fresh-box".to_string()]
        );
        assert_eq!(
            state.remove_calls,
            vec!["stale-box".to_string(), stale_box_name]
        );
        assert!(state.stop_calls.is_empty());
    }

    #[tokio::test]
    async fn repair_clears_runtime_state_without_stopping_active_boxes() {
        let provider = MockZombieByNameProvider::new("unused-box".to_string());
        let state = provider.state.clone();
        let manager = test_manager(Arc::new(provider));

        manager.session_leases.write().await.insert(
            "session-a".to_string(),
            SessionLease {
                sandbox_id: "box-a".to_string(),
                sandbox_name: "box-name-a".to_string(),
                expires_at_unix_ms: now_unix_ms() + 10_000,
            },
        );
        manager.active_ids.write().await.insert("box-a".to_string());
        manager
            .run_locks
            .write()
            .await
            .insert("session-a".to_string(), Arc::new(Mutex::new(())));

        let _ = manager.repair().await.expect("repair should complete");

        assert!(manager.session_leases.read().await.is_empty());
        assert!(manager.active_ids.read().await.is_empty());
        assert!(manager.run_locks.read().await.is_empty());
        assert!(state.lock().await.stop_calls.is_empty());
    }

    #[tokio::test]
    async fn rebuild_runtime_stops_active_boxes_and_clears_runtime_state() {
        let provider = MockZombieByNameProvider::new("unused-box".to_string());
        let state = provider.state.clone();
        let manager = test_manager(Arc::new(provider));

        manager.session_leases.write().await.insert(
            "session-a".to_string(),
            SessionLease {
                sandbox_id: "box-a".to_string(),
                sandbox_name: "box-name-a".to_string(),
                expires_at_unix_ms: now_unix_ms() + 10_000,
            },
        );
        manager.active_ids.write().await.insert("box-a".to_string());
        manager
            .run_locks
            .write()
            .await
            .insert("session-a".to_string(), Arc::new(Mutex::new(())));

        let _ = manager
            .rebuild_runtime()
            .await
            .expect("rebuild should complete");

        assert!(manager.session_leases.read().await.is_empty());
        assert!(manager.active_ids.read().await.is_empty());
        assert!(manager.run_locks.read().await.is_empty());
        assert_eq!(state.lock().await.stop_calls, vec!["box-a".to_string()]);
    }

    #[tokio::test]
    async fn execution_probe_reports_passed_when_tiny_command_runs() {
        let manager = test_manager(Arc::new(MockProbeProvider {
            outcome: MockProbeOutcome::Passed,
        }));

        let probe = manager.programmatic_execution_probe().await;
        assert_eq!(probe.status, SandboxExecutionProbeStatus::Passed);
    }

    #[tokio::test]
    async fn execution_probe_retries_after_network_failure_and_recovers() {
        let provider = MockRecoverableProbeProvider {
            state: Arc::new(Mutex::new(MockProviderState::default())),
            failure: MockRecoverableProbeFailure::Network,
        };
        let state = provider.state.clone();
        let manager = test_manager(Arc::new(provider));

        let probe = manager.programmatic_execution_probe().await;
        assert_eq!(probe.status, SandboxExecutionProbeStatus::Passed);

        let state = state.lock().await;
        let probe_box_name = session_to_box_name(EXECUTION_PROBE_SESSION_ID);
        assert_eq!(
            state.run_calls,
            vec![
                format!("{probe_box_name}-id"),
                format!("{probe_box_name}-id")
            ]
        );
        assert_eq!(
            state.remove_calls,
            vec![format!("{probe_box_name}-id"), probe_box_name]
        );
        assert!(state.stop_calls.is_empty());
    }

    #[tokio::test]
    async fn execution_probe_retries_after_invalidated_handle_and_recovers() {
        let provider = MockRecoverableProbeProvider {
            state: Arc::new(Mutex::new(MockProviderState::default())),
            failure: MockRecoverableProbeFailure::InvalidatedHandle,
        };
        let state = provider.state.clone();
        let manager = test_manager(Arc::new(provider));

        let probe = manager.programmatic_execution_probe().await;
        assert_eq!(probe.status, SandboxExecutionProbeStatus::Passed);

        let state = state.lock().await;
        let probe_box_name = session_to_box_name(EXECUTION_PROBE_SESSION_ID);
        assert_eq!(
            state.run_calls,
            vec![
                format!("{probe_box_name}-id"),
                format!("{probe_box_name}-id")
            ]
        );
        assert_eq!(
            state.remove_calls,
            vec![format!("{probe_box_name}-id"), probe_box_name]
        );
        assert!(state.stop_calls.is_empty());
    }

    #[tokio::test]
    async fn execution_probe_reports_failed_when_runtime_cannot_run() {
        let manager = test_manager(Arc::new(MockProbeProvider {
            outcome: MockProbeOutcome::FailedNotFound,
        }));

        let probe = manager.programmatic_execution_probe().await;
        assert_eq!(probe.status, SandboxExecutionProbeStatus::Failed);
        assert!(probe
            .detail
            .unwrap_or_default()
            .contains("lightweight execution probe failed"));
    }

    #[test]
    fn failed_execution_probe_downgrades_ready_status() {
        let (status, reason, actions) = refine_ready_status_with_execution_probe(
            SandboxReadinessStatus::Ready,
            None,
            vec!["Sandbox is ready for programmatic execution.".to_string()],
            SandboxExecutionProbe {
                status: SandboxExecutionProbeStatus::Failed,
                detail: Some("Execution probe failed.".to_string()),
                checked_at_unix_ms: Some(123),
            },
        );

        assert_eq!(status, SandboxReadinessStatus::RepairNeeded);
        assert_eq!(reason.as_deref(), Some("Execution probe failed."));
        assert!(actions.iter().any(|step| step.contains("Rebuild")));
    }
}
