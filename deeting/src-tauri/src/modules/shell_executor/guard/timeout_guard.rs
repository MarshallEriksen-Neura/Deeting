//! 超时控制保护

use std::time::{Duration, Instant};

/// 超时保护器
#[allow(dead_code)]
pub struct TimeoutGuard {
    start_time: Instant,
    timeout: Duration,
}

#[allow(dead_code)]
impl TimeoutGuard {
    pub fn new(timeout_seconds: u64) -> Self {
        Self {
            start_time: Instant::now(),
            timeout: Duration::from_secs(timeout_seconds),
        }
    }

    /// 检查是否超时
    pub fn check_timeout(&self) -> Result<(), String> {
        if self.start_time.elapsed() > self.timeout {
            Err("Execution timeout".to_string())
        } else {
            Ok(())
        }
    }

    /// 获取剩余时间
    pub fn remaining(&self) -> Duration {
        self.timeout.saturating_sub(self.start_time.elapsed())
    }
}
