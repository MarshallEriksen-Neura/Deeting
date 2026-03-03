use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

use crate::modules::sandbox::error::SandboxError;
use crate::modules::sandbox::types::{
    SandboxExecutionOutput, SandboxIdentity, SandboxLeaseInfo, SandboxRunResult,
};

#[cfg(target_os = "windows")]
use crate::modules::sandbox::backend_wsl::{WslBackendOptions, WslBoxliteBackend};

const DEFAULT_TIMEOUT_SECS: u64 = 30 * 60;
const DEFAULT_MAX_SANDBOXES: usize = 50;
const MIN_EXEC_TIMEOUT_SECS: u64 = 5;
const SESSION_BUSY_RETRY_ATTEMPTS: usize = 2;
const REAPER_INTERVAL_SECS: u64 = 60;

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
    pub bridge_prefix: String,
}

impl SandboxManagerOptions {
    pub fn from_home_dir(home_dir: PathBuf) -> Self {
        let bridge_url = std::env::var("BOXLITE_REST_URL")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let bridge_prefix = std::env::var("BOXLITE_REST_PREFIX")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "v1".to_string());

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
            bridge_prefix,
        }
    }
}

#[derive(Clone)]
pub struct SandboxRuntimeManager {
    backend: BackendRuntime,
    options: SandboxManagerOptions,
    session_leases: Arc<RwLock<HashMap<String, SessionLease>>>,
    active_ids: Arc<RwLock<HashSet<String>>>,
    run_locks: Arc<RwLock<HashMap<String, Arc<Mutex<()>>>>>,
    cleanup_task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

#[derive(Debug, Clone)]
struct SessionLease {
    sandbox_id: String,
    sandbox_name: String,
    expires_at_unix_ms: i64,
}

#[derive(Clone)]
enum BackendRuntime {
    #[cfg(target_os = "windows")]
    Wsl(WslBoxliteBackend),
    Disabled(String),
}

impl SandboxRuntimeManager {
    pub fn new(options: SandboxManagerOptions) -> Self {
        let backend = match Self::build_backend(&options) {
            Ok(backend) => backend,
            Err(err) => {
                log::warn!(
                    "sandbox runtime disabled: code={} detail={}",
                    err.code(),
                    err
                );
                BackendRuntime::Disabled(err.to_string())
            }
        };

        Self {
            backend,
            options,
            session_leases: Arc::new(RwLock::new(HashMap::new())),
            active_ids: Arc::new(RwLock::new(HashSet::new())),
            run_locks: Arc::new(RwLock::new(HashMap::new())),
            cleanup_task: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_available(&self) -> bool {
        !matches!(self.backend, BackendRuntime::Disabled(_))
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
                    log::warn!(
                        "sandbox reaper failed: code={} detail={}",
                        err.code(),
                        err
                    );
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
            let _ = self.backend_stop_box(&sandbox_id).await;
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
        let identity = self.backend_get_or_create(&sandbox_name).await?;
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
        self.backend_stop_box(sandbox_id).await
    }

    pub async fn run_code(
        &self,
        session_id: &str,
        code: &str,
        language: Option<&str>,
        execution_timeout_secs: Option<u64>,
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
        let timeout_secs = execution_timeout_secs.unwrap_or(30).max(MIN_EXEC_TIMEOUT_SECS);
        let lock_wait_secs = timeout_secs.saturating_add(5).max(1);
        let _guard = tokio::time::timeout(Duration::from_secs(lock_wait_secs), lock.lock())
            .await
            .map_err(|_| {
                SandboxError::Busy(format!(
                    "session {} is busy (lock wait {}s exceeded)",
                    normalized_session, lock_wait_secs
                ))
            })?;

        for attempt in 0..SESSION_BUSY_RETRY_ATTEMPTS {
            let lease = self.get_or_create_sandbox(&normalized_session).await?;
            match self
                .backend_run_python(&lease.sandbox_id, code, timeout_secs)
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
                    if is_session_busy_error(&err)
                        && attempt + 1 < SESSION_BUSY_RETRY_ATTEMPTS =>
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
            let _ = self.backend_stop_box(&sandbox_id).await;
            self.remove_lease_by_sandbox_id(&sandbox_id).await;
        }
        self.backend_shutdown().await
    }

    async fn get_valid_lease(
        &self,
        session_id: &str,
        now_ms: i64,
    ) -> Option<SandboxLeaseInfo> {
        let mut stale_sandbox: Option<String> = None;
        let mut output = None;

        {
            let mut leases = self.session_leases.write().await;
            if let Some(lease) = leases.get_mut(session_id) {
                if lease.expires_at_unix_ms > now_ms {
                    lease.expires_at_unix_ms = now_ms + self.options.default_timeout.as_millis() as i64;
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
            let _ = self.backend_stop_box(&stale_id).await;
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

    fn build_backend(options: &SandboxManagerOptions) -> Result<BackendRuntime, SandboxError> {
        #[cfg(not(target_os = "windows"))]
        {
            let _ = options;
            return Err(SandboxError::Unavailable(
                "native boxlite backend is not linked in this desktop package; use WSL bridge".to_string(),
            ));
        }

        #[cfg(target_os = "windows")]
        {
            let bridge_url = options
                .bridge_url
                .clone()
                .ok_or_else(|| {
                    SandboxError::Unavailable(
                        "BOXLITE_REST_URL is required when running desktop on Windows with WSL bridge".to_string(),
                    )
                })?;
            let backend = WslBoxliteBackend::new(WslBackendOptions {
                base_url: bridge_url,
                api_prefix: options.bridge_prefix.clone(),
                image: options.image.clone(),
                cpus: options.cpus,
                memory_mib: options.memory_mib,
                working_dir: options.working_dir.clone(),
                python_bin: options.python_bin.clone(),
            })?;

            // Do not block startup: first real call will return actionable errors if probe fails.
            let probe_backend = backend.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = probe_backend.probe().await {
                    log::warn!(
                        "boxlite wsl bridge probe failed: code={} detail={}",
                        err.code(),
                        err
                    );
                }
            });

            return Ok(BackendRuntime::Wsl(backend));
        }
    }

    async fn backend_get_or_create(&self, box_name: &str) -> Result<SandboxIdentity, SandboxError> {
        match &self.backend {
            #[cfg(target_os = "windows")]
            BackendRuntime::Wsl(backend) => backend.get_or_create_box(box_name).await,
            BackendRuntime::Disabled(reason) => Err(SandboxError::Unavailable(reason.clone())),
        }
    }

    async fn backend_stop_box(&self, box_id: &str) -> Result<(), SandboxError> {
        match &self.backend {
            #[cfg(target_os = "windows")]
            BackendRuntime::Wsl(backend) => backend.stop_box(box_id).await,
            BackendRuntime::Disabled(reason) => Err(SandboxError::Unavailable(reason.clone())),
        }
    }

    async fn backend_run_python(
        &self,
        box_id: &str,
        code: &str,
        timeout_secs: u64,
    ) -> Result<SandboxExecutionOutput, SandboxError> {
        match &self.backend {
            #[cfg(target_os = "windows")]
            BackendRuntime::Wsl(backend) => backend.run_python(box_id, code, timeout_secs).await,
            BackendRuntime::Disabled(reason) => Err(SandboxError::Unavailable(reason.clone())),
        }
    }

    async fn backend_shutdown(&self) -> Result<(), SandboxError> {
        match &self.backend {
            #[cfg(target_os = "windows")]
            BackendRuntime::Wsl(backend) => backend.shutdown().await,
            BackendRuntime::Disabled(_) => Ok(()),
        }
    }
}

fn normalize_session_id(raw: &str) -> Result<String, SandboxError> {
    let session = raw.trim();
    if session.is_empty() {
        return Err(SandboxError::Validation("session_id is required".to_string()));
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
        assert!(box_name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'));
    }

    #[test]
    fn normalize_session_rejects_empty() {
        let err = normalize_session_id("   ").unwrap_err();
        assert_eq!(err.code(), "SANDBOX_VALIDATION_ERROR");
    }
}
