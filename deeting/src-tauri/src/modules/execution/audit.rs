use super::config::ExecutionConfig;
use chrono::{DateTime, Utc};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum AuditEventType {
    CommandExecuted,
    CommandDenied,
    Timeout,
    Failed,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuditEntry {
    pub timestamp: DateTime<Utc>,
    pub event_type: AuditEventType,
    pub command: String,
    pub working_dir: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
    pub approval_level: Option<String>,
    pub denial_reason: Option<String>,
}

pub struct ExecutionAuditLogger {
    enabled: bool,
    store: Option<Arc<AuditStore>>,
}

struct AuditStore {
    file: Arc<Mutex<File>>,
}

impl ExecutionAuditLogger {
    pub fn new(config: &ExecutionConfig, home_dir: &Path) -> Self {
        if !config.audit_enabled {
            return Self {
                enabled: false,
                store: None,
            };
        }

        let log_path = expand_log_path(&config.audit_log_file, home_dir);
        let store = match AuditStore::new(log_path) {
            Ok(store) => Some(Arc::new(store)),
            Err(err) => {
                log::warn!("execution_audit_store_create_failed {}", err);
                None
            }
        };

        Self {
            enabled: true,
            store,
        }
    }

    pub fn log_execution(
        &self,
        command: &str,
        working_dir: Option<&PathBuf>,
        exit_code: i32,
        duration_ms: u64,
        approval_level: &str,
    ) {
        self.write(AuditEntry {
            timestamp: Utc::now(),
            event_type: AuditEventType::CommandExecuted,
            command: command.to_string(),
            working_dir: working_dir.map(|path| path.to_string_lossy().to_string()),
            exit_code: Some(exit_code),
            duration_ms: Some(duration_ms),
            approval_level: Some(approval_level.to_string()),
            denial_reason: None,
        });
    }

    pub fn log_denied(&self, command: &str, reason: &str) {
        self.write(AuditEntry {
            timestamp: Utc::now(),
            event_type: AuditEventType::CommandDenied,
            command: command.to_string(),
            working_dir: None,
            exit_code: None,
            duration_ms: None,
            approval_level: None,
            denial_reason: Some(reason.to_string()),
        });
    }

    pub fn log_failed(&self, command: &str, reason: &str) {
        self.write(AuditEntry {
            timestamp: Utc::now(),
            event_type: AuditEventType::Failed,
            command: command.to_string(),
            working_dir: None,
            exit_code: None,
            duration_ms: None,
            approval_level: None,
            denial_reason: Some(reason.to_string()),
        });
    }

    pub fn log_timeout(&self, command: &str) {
        self.write(AuditEntry {
            timestamp: Utc::now(),
            event_type: AuditEventType::Timeout,
            command: command.to_string(),
            working_dir: None,
            exit_code: None,
            duration_ms: None,
            approval_level: None,
            denial_reason: Some("execution timed out".to_string()),
        });
    }

    fn write(&self, entry: AuditEntry) {
        if !self.enabled {
            return;
        }
        let Some(store) = self.store.as_ref().map(Arc::clone) else {
            return;
        };

        tokio::spawn(async move {
            if let Err(err) = store.write_entry(&entry).await {
                log::warn!("execution_audit_write_failed {}", err);
            }
        });
    }
}

impl AuditStore {
    fn new(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create log directory: {err}"))?;
        }

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|err| format!("Failed to open log file: {err}"))?;

        Ok(Self {
            file: Arc::new(Mutex::new(file)),
        })
    }

    async fn write_entry(&self, entry: &AuditEntry) -> Result<(), String> {
        let line = serde_json::to_string(entry)
            .map_err(|err| format!("Failed to serialize audit entry: {err}"))?;
        let mut file = self.file.lock().await;
        writeln!(file, "{line}").map_err(|err| format!("Failed to write audit entry: {err}"))
    }
}

fn expand_log_path(path: &str, home_dir: &Path) -> PathBuf {
    let home = home_dir.to_string_lossy().to_string();
    let mut expanded = path
        .replace("$HOME", &home)
        .replace("~", &home)
        .replace("%USERPROFILE%", &home);

    if let Some(app_data) = dirs::data_local_dir() {
        expanded = expanded.replace("$APP_DATA", &app_data.to_string_lossy());
    }

    PathBuf::from(expanded)
}
