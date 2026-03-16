//! 资源限制保护

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// 资源保护器
#[allow(dead_code)]
pub struct ResourceGuard {
    max_concurrent: usize,
    current_count: Arc<AtomicUsize>,
}

#[allow(dead_code)]
impl ResourceGuard {
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            max_concurrent,
            current_count: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// 尝试获取执行槽
    pub fn try_acquire(&self) -> Result<ResourceSlot, String> {
        loop {
            let current = self.current_count.load(Ordering::Relaxed);

            if current >= self.max_concurrent {
                return Err(format!(
                    "Maximum concurrent executions ({}) reached",
                    self.max_concurrent
                ));
            }

            match self.current_count.compare_exchange_weak(
                current,
                current + 1,
                Ordering::Acquire,
                Ordering::Relaxed,
            ) {
                Ok(_) => {
                    return Ok(ResourceSlot {
                        counter: Arc::clone(&self.current_count),
                    });
                }
                Err(_) => continue, // 重试
            }
        }
    }
}

/// 资源槽
/// 当 drop 时自动释放
#[allow(dead_code)]
pub struct ResourceSlot {
    counter: Arc<AtomicUsize>,
}

impl Drop for ResourceSlot {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::Release);
    }
}
