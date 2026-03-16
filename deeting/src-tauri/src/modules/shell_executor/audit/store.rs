//! 审计日志存储

use std::path::PathBuf;
use std::fs::{OpenOptions, File};
use std::io::Write;
use std::sync::Arc;
use tokio::sync::Mutex;
use chrono::{DateTime, Utc};

/// 审计日志存储
pub struct AuditStore {
    log_file: Arc<Mutex<File>>,
    log_path: PathBuf,
}

impl AuditStore {
    pub fn new(log_path: PathBuf) -> Result<Self, String> {
        // 确保日志目录存在
        if let Some(parent) = log_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create log directory: {}", e))?;
        }
        
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("Failed to open log file: {}", e))?;
        
        Ok(Self {
            log_file: Arc::new(Mutex::new(file)),
            log_path,
        })
    }
    
    /// 写入日志条目
    pub async fn write_entry(&self, entry: &AuditEntry) -> Result<(), String> {
        let json = serde_json::to_string(entry)
            .map_err(|e| format!("Failed to serialize entry: {}", e))?;
        
        let mut file = self.log_file.lock().await;
        writeln!(file, "{}", json)
            .map_err(|e| format!("Failed to write log entry: {}", e))?;
        
        Ok(())
    }
    
    /// 清理过期日志
    pub fn cleanup_old_logs(&self, retention_days: u64) -> Result<(), String> {
        // TODO: 实现日志轮转和清理
        // 读取日志文件,删除超过保留期的条目
        Ok(())
    }
}

/// 审计条目
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuditEntry {
    /// 时间戳
    pub timestamp: DateTime<Utc>,
    
    /// 事件类型
    pub event_type: AuditEventType,
    
    /// 命令
    pub command: String,
    
    /// 工作目录
    pub working_dir: Option<String>,
    
    /// 退出码
    pub exit_code: Option<i32>,
    
    /// 执行时长 (ms)
    pub duration_ms: Option<u64>,
    
    /// 确认级别
    pub approval_level: Option<String>,
    
    /// 拒绝原因
    pub denial_reason: Option<String>,
}

/// 审计事件类型
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum AuditEventType {
    /// 命令执行
    CommandExecuted,
    
    /// 命令被策略拒绝
    CommandDenied,
    
    /// 用户拒绝
    UserDenied,
    
    /// 执行超时
    Timeout,
    
    /// 执行失败
    Failed,
}
