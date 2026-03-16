//! 审计日志记录器

use super::{AuditStore, AuditEntry, AuditEventType};
use crate::modules::shell_executor::config::AuditConfig;
use std::path::PathBuf;
use std::sync::Arc;
use chrono::Utc;

/// 审计日志记录器
pub struct AuditLogger {
    enabled: bool,
    store: Option<Arc<AuditStore>>,
}

impl AuditLogger {
    pub fn new(config: AuditConfig) -> Self {
        if !config.enabled {
            return Self {
                enabled: false,
                store: None,
            };
        }
        
        let log_path = Self::expand_log_path(&config.log_file);
        
        let store = match AuditStore::new(log_path) {
            Ok(s) => Some(Arc::new(s)),
            Err(e) => {
                eprintln!("Failed to create audit store: {}", e);
                None
            }
        };
        
        Self {
            enabled: config.enabled,
            store,
        }
    }
    
    /// 记录命令执行
    pub fn log_execution(
        &self,
        command: &str,
        working_dir: Option<&PathBuf>,
        exit_code: i32,
        duration_ms: u64,
        approval_level: &str,
    ) {
        if !self.enabled {
            return;
        }
        
        let entry = AuditEntry {
            timestamp: Utc::now(),
            event_type: AuditEventType::CommandExecuted,
            command: command.to_string(),
            working_dir: working_dir.map(|p| p.to_string_lossy().to_string()),
            exit_code: Some(exit_code),
            duration_ms: Some(duration_ms),
            approval_level: Some(approval_level.to_string()),
            denial_reason: None,
        };
        
        self.write_entry(&entry);
    }
    
    /// 记录命令被拒绝
    pub fn log_denied(&self, command: &str, reason: &str) {
        if !self.enabled {
            return;
        }
        
        let entry = AuditEntry {
            timestamp: Utc::now(),
            event_type: AuditEventType::CommandDenied,
            command: command.to_string(),
            working_dir: None,
            exit_code: None,
            duration_ms: None,
            approval_level: None,
            denial_reason: Some(reason.to_string()),
        };
        
        self.write_entry(&entry);
    }
    
    /// 记录用户拒绝
    pub fn log_user_denied(&self, command: &str) {
        if !self.enabled {
            return;
        }
        
        let entry = AuditEntry {
            timestamp: Utc::now(),
            event_type: AuditEventType::UserDenied,
            command: command.to_string(),
            working_dir: None,
            exit_code: None,
            duration_ms: None,
            approval_level: None,
            denial_reason: Some("User denied execution".to_string()),
        };
        
        self.write_entry(&entry);
    }
    
    /// 展开日志路径中的环境变量
    fn expand_log_path(path: &str) -> PathBuf {
        let expanded = path
            .replace("$HOME", &dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default())
            .replace("~", &dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default());
        
        // 应用数据目录
        let expanded = if let Some(app_data) = dirs::data_local_dir() {
            expanded.replace("$APP_DATA", &app_data.to_string_lossy().to_string())
        } else {
            expanded
        };
        
        PathBuf::from(expanded)
    }
    
    /// 写入日志条目
    fn write_entry(&self, entry: &AuditEntry) {
        if let Some(store) = &self.store {
            let store = Arc::clone(store);
            let entry = entry.clone();
            
            // 异步写入
            tokio::spawn(async move {
                if let Err(e) = store.write_entry(&entry).await {
                    eprintln!("Failed to write audit entry: {}", e);
                }
            });
        }
    }
}
