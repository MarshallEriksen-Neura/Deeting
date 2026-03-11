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

use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::provider::SandboxProvider;
use crate::modules::sandbox::types::{
    SandboxBoxLiteStatus, SandboxInstallGuide, SandboxLeaseInfo, SandboxPythonStatus,
    SandboxReadinessReport, SandboxReadinessStatus, SandboxRunResult, SandboxRuntimeMode,
    SandboxWslStatus,
};

#[cfg(target_os = "windows")]
use crate::modules::sandbox::backend_host::{HostBackendOptions, HostPythonBackend};
#[cfg(target_os = "windows")]
use crate::modules::sandbox::backend_wsl::{
    diagnose_wsl_availability, inspect_wsl_python, WslBackendOptions, WslBoxrunBackend,
};
#[cfg(target_os = "windows")]
use crate::modules::sandbox::installer::{install_boxlite_wsl, BoxLiteInstallerConfig};

const DEFAULT_TIMEOUT_SECS: u64 = 30 * 60;
const DEFAULT_MAX_SANDBOXES: usize = 50;
const MIN_EXEC_TIMEOUT_SECS: u64 = 5;
const SESSION_BUSY_RETRY_ATTEMPTS: usize = 2;
const REAPER_INTERVAL_SECS: u64 = 60;
const DEFAULT_BOXRUN_PORT: u16 = 9090;

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
            let python = if wsl.ready {
                Some(inspect_wsl_python(&self.options.python_bin))
            } else {
                None
            };
            let boxlite_binary_found = boxlite.binary_found;
            let (status, blocking_reason, next_actions) =
                derive_windows_readiness(runtime_mode, &wsl, python.as_ref(), &boxlite);
            return SandboxReadinessReport {
                platform: current_platform().to_string(),
                platform_supported: true,
                status,
                provider_name,
                runtime_mode,
                wsl: Some(wsl),
                python,
                boxlite,
                blocking_reason,
                can_auto_prepare: status != SandboxReadinessStatus::NeedsWsl
                    && status != SandboxReadinessStatus::NeedsPython
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
                python: None,
                boxlite,
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
        #[cfg(target_os = "windows")]
        {
            if let Some(provisioner) = self.provisioner.as_ref() {
                if provisioner.resolve_binary().is_some() {
                    if let Err(err) = provisioner.ensure_running().await {
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
        if let Some(provisioner) = self.provisioner.as_ref() {
            provisioner.stop().await;
        }
        self.prepare().await
    }

    pub async fn rebuild_runtime(&self) -> Result<SandboxReadinessReport, SandboxError> {
        let active_ids: Vec<String> = {
            let active = self.active_ids.read().await;
            active.iter().cloned().collect()
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

        self.prepare().await
    }

    pub async fn install_boxlite(&self) -> Result<SandboxReadinessReport, SandboxError> {
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
                python_bin: self.options.python_bin.clone(),
            };
            install_boxlite_wsl(&config).await?;
            return self.prepare().await;
        }

        #[cfg(not(target_os = "windows"))]
        {
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
        let now_ms = now_unix_ms();

        if let Some(existing) = self.get_valid_lease(&normalized_session, now_ms).await {
            return Ok(existing);
        }

        self.ensure_capacity().await?;

        let sandbox_name = session_to_box_name(&normalized_session);
        let backend = self.current_backend().await;
        let identity = backend.get_or_create_box(&sandbox_name).await?;
        let expires_at = now_ms + self.options.default_timeout.as_millis() as i64;

        {
            let mut leases = self.session_leases.write().await;
            leases.insert(
                normalized_session.clone(),
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
            session_id: normalized_session,
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
                    self.remove_lease(&normalized_session, &lease.sandbox_id)
                        .await;
                    let _ = backend.stop_box(&lease.sandbox_id).await;
                    let _ = self.prepare().await;
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
            let binary_path = record
                .as_ref()
                .map(|record| PathBuf::from(&record.bridge_script_host_path));
            let endpoint = provisioner.endpoint();
            let reachable = provisioner.is_endpoint_reachable().await;
            let managed_path = provisioner.managed_binary_path();
            let managed_by_deeting = binary_path
                .as_ref()
                .map(|path| path == &managed_path)
                .unwrap_or(false);
            return SandboxBoxLiteStatus {
                binary_found: record.is_some(),
                binary_path: record.map(|record| record.wsl_site_dir),
                endpoint: Some(endpoint),
                reachable,
                managed_by_deeting,
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
                    if is_bridge_candidate_reachable(&auto_endpoint) {
                        if let Ok(provider) = Self::try_wsl_backend(&auto_endpoint, options) {
                            return Ok(provider);
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
            image: options.image.clone(),
            cpus: options.cpus,
            memory_mib: options.memory_mib,
            working_dir: options.working_dir.clone(),
            python_bin: options.python_bin.clone(),
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

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn derive_windows_readiness(
    runtime_mode: SandboxRuntimeMode,
    wsl: &SandboxWslStatus,
    python: Option<&SandboxPythonStatus>,
    boxlite: &SandboxBoxLiteStatus,
) -> (SandboxReadinessStatus, Option<String>, Vec<String>) {
    if runtime_mode == SandboxRuntimeMode::Sandbox && boxlite.reachable {
        return (
            SandboxReadinessStatus::Ready,
            None,
            vec!["Sandbox is ready for Code Mode execution.".to_string()],
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

    if let Some(python) = python {
        if !python.installed || !python.supported {
            return (
                SandboxReadinessStatus::NeedsPython,
                python.detail.clone().or_else(|| {
                    Some(
                        "WSL Python 3.10–3.13 is required before BoxLite can be installed."
                            .to_string(),
                    )
                }),
                vec![
                    "Install Python 3.10–3.13 inside your WSL distro, then rerun sandbox detection."
                        .to_string(),
                ],
            );
        }
    }

    if !boxlite.binary_found {
        return (
            SandboxReadinessStatus::NeedsBoxLite,
            Some("BoxLite is not installed in WSL for the Deeting sandbox yet.".to_string()),
            vec![
                "Install BoxLite from Desktop Sandbox settings, then Deeting will prepare the WSL bridge automatically."
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

fn build_install_guide(report: &SandboxReadinessReport) -> SandboxInstallGuide {
    match report.status {
        SandboxReadinessStatus::Ready => SandboxInstallGuide {
            status: report.status,
            title: "Sandbox ready".to_string(),
            description: "The desktop sandbox is ready for Code Mode execution.".to_string(),
            steps: vec!["You can start Code Mode safely in sandboxed mode.".to_string()],
            primary_command: None,
        },
        SandboxReadinessStatus::NeedsWsl => SandboxInstallGuide {
            status: report.status,
            title: "Install Windows Subsystem for Linux".to_string(),
            description: "Code Mode sandboxing on Windows depends on WSL before BoxLite can start."
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
        SandboxReadinessStatus::NeedsPython => SandboxInstallGuide {
            status: report.status,
            title: "Install Python inside WSL".to_string(),
            description:
                "The pinned BoxLite release needs a supported Python runtime inside WSL before installation can continue."
                    .to_string(),
            steps: vec![
                "Open your WSL distro terminal and install Python 3.10–3.13 using that distro's package manager."
                    .to_string(),
                "Verify the runtime with `python3 --version` inside WSL, then refresh Desktop Sandbox settings."
                    .to_string(),
            ],
            primary_command: None,
        },
        SandboxReadinessStatus::NeedsBoxLite => SandboxInstallGuide {
            status: report.status,
            title: "Install BoxLite into WSL".to_string(),
            description:
                "BoxLite is required for isolated Code Mode execution and will be installed into your WSL environment."
                    .to_string(),
            steps: vec![
                "Click Install BoxLite in Desktop Sandbox settings.".to_string(),
                "Deeting will download the pinned official BoxLite Python wheel, verify its SHA256 checksum, and install it into WSL."
                    .to_string(),
            ],
            primary_command: None,
        },
        SandboxReadinessStatus::RepairNeeded => SandboxInstallGuide {
            status: report.status,
            title: "Repair sandbox service".to_string(),
            description:
                "BoxLite is installed in WSL, but the local sandbox bridge is not reachable."
                    .to_string(),
            steps: vec![
                "Click Prepare to try starting BoxLite automatically.".to_string(),
                "If Prepare does not work, click Repair to restart the sandbox process."
                    .to_string(),
            ],
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
            None,
            &SandboxBoxLiteStatus::default(),
        );

        assert_eq!(status, SandboxReadinessStatus::NeedsWsl);
        assert!(reason.unwrap().contains("wsl"));
        assert!(!actions.is_empty());
    }

    #[test]
    fn derive_windows_readiness_requires_supported_wsl_python() {
        let (status, reason, actions) = derive_windows_readiness(
            SandboxRuntimeMode::HostFallback,
            &SandboxWslStatus {
                installed: true,
                ready: true,
                detail: None,
                recommended_command: None,
            },
            Some(&SandboxPythonStatus {
                installed: false,
                abi: None,
                supported: false,
                detail: Some("python3 not found".to_string()),
            }),
            &SandboxBoxLiteStatus::default(),
        );

        assert_eq!(status, SandboxReadinessStatus::NeedsPython);
        assert!(reason.unwrap().contains("python3"));
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
            python: Some(SandboxPythonStatus {
                installed: true,
                abi: Some("cp311".to_string()),
                supported: true,
                detail: None,
            }),
            boxlite: SandboxBoxLiteStatus {
                binary_found: true,
                binary_path: Some("C:/sandbox/boxlite.exe".to_string()),
                endpoint: Some("http://127.0.0.1:4318".to_string()),
                reachable: false,
                managed_by_deeting: true,
            },
            blocking_reason: Some("BoxLite is installed but not reachable yet.".to_string()),
            next_actions: vec![],
            can_auto_prepare: true,
        });

        assert_eq!(guide.status, SandboxReadinessStatus::RepairNeeded);
        assert!(guide.title.contains("Repair"));
        assert!(guide.steps.iter().any(|step| step.contains("Prepare")));
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

fn now_unix_ms() -> i64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    now.as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
