use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, RwLock,
};
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

use super::capability_catalog::CapabilityRegistryBaseSnapshot;
use crate::modules::mcp::store::McpStore;
use mcp_registry::types::LocalCapabilityRegistryCacheStatus;

const CAPABILITY_REGISTRY_BASE_CACHE_TTL: Duration = Duration::from_secs(15);

#[derive(Debug)]
struct CapabilityRegistryBaseCacheEntry {
    epoch: u64,
    built_at: Instant,
    snapshot: Arc<CapabilityRegistryBaseSnapshot>,
}

#[derive(Debug, Default)]
struct CapabilityRegistryBaseCacheTelemetry {
    last_build_epoch: Option<u64>,
    last_invalidation_epoch: Option<u64>,
    last_invalidation_reason: Option<String>,
    cache_hit_count: u64,
    cache_miss_count: u64,
    build_count: u64,
}

#[derive(Debug)]
pub(crate) struct CapabilityRegistryBaseCache {
    entry: RwLock<Option<CapabilityRegistryBaseCacheEntry>>,
    telemetry: RwLock<CapabilityRegistryBaseCacheTelemetry>,
    refresh_lock: Mutex<()>,
    epoch: AtomicU64,
}

impl CapabilityRegistryBaseCache {
    pub(crate) fn new() -> Self {
        Self {
            entry: RwLock::new(None),
            telemetry: RwLock::new(CapabilityRegistryBaseCacheTelemetry::default()),
            refresh_lock: Mutex::new(()),
            epoch: AtomicU64::new(0),
        }
    }

    pub(crate) fn invalidate(&self, _reason: &str) {
        let next_epoch = self.epoch.fetch_add(1, Ordering::AcqRel).saturating_add(1);
        let mut guard = self
            .entry
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = None;
        let mut telemetry = self
            .telemetry
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        telemetry.last_invalidation_epoch = Some(next_epoch);
        telemetry.last_invalidation_reason = Some(_reason.to_string());
    }

    pub(crate) async fn get_or_build<F, Fut>(
        &self,
        build_snapshot: F,
    ) -> Arc<CapabilityRegistryBaseSnapshot>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = CapabilityRegistryBaseSnapshot>,
    {
        let epoch = self.epoch.load(Ordering::Acquire);
        if let Some(snapshot) = self.cached_snapshot(epoch) {
            return snapshot;
        }
        self.record_cache_miss();

        let _guard = self.refresh_lock.lock().await;
        let epoch = self.epoch.load(Ordering::Acquire);
        if let Some(snapshot) = self.cached_snapshot(epoch) {
            return snapshot;
        }

        let snapshot = Arc::new(build_snapshot().await);
        let mut guard = self
            .entry
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = Some(CapabilityRegistryBaseCacheEntry {
            epoch,
            built_at: Instant::now(),
            snapshot: snapshot.clone(),
        });
        let mut telemetry = self
            .telemetry
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        telemetry.last_build_epoch = Some(epoch);
        telemetry.build_count = telemetry.build_count.saturating_add(1);
        snapshot
    }

    fn cached_snapshot(&self, epoch: u64) -> Option<Arc<CapabilityRegistryBaseSnapshot>> {
        let guard = self
            .entry
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = guard.as_ref()?;
        if entry.epoch != epoch {
            return None;
        }
        if entry.built_at.elapsed() > CAPABILITY_REGISTRY_BASE_CACHE_TTL {
            return None;
        }
        self.record_cache_hit();
        Some(entry.snapshot.clone())
    }

    fn record_cache_hit(&self) {
        let mut telemetry = self
            .telemetry
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        telemetry.cache_hit_count = telemetry.cache_hit_count.saturating_add(1);
    }

    fn record_cache_miss(&self) {
        let mut telemetry = self
            .telemetry
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        telemetry.cache_miss_count = telemetry.cache_miss_count.saturating_add(1);
    }

    pub(crate) fn diagnostics(&self) -> LocalCapabilityRegistryCacheStatus {
        let current_epoch = self.epoch.load(Ordering::Acquire);
        let guard = self
            .entry
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let telemetry = self
            .telemetry
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        LocalCapabilityRegistryCacheStatus {
            current_epoch,
            cache_present: guard.is_some(),
            cache_ttl_ms: CAPABILITY_REGISTRY_BASE_CACHE_TTL.as_millis() as u64,
            cache_age_ms: guard
                .as_ref()
                .map(|entry| entry.built_at.elapsed().as_millis() as u64),
            last_build_epoch: telemetry.last_build_epoch,
            last_invalidation_epoch: telemetry.last_invalidation_epoch,
            last_invalidation_reason: telemetry.last_invalidation_reason.clone(),
            cache_hit_count: telemetry.cache_hit_count,
            cache_miss_count: telemetry.cache_miss_count,
            build_count: telemetry.build_count,
        }
    }
}

pub(crate) async fn get_capability_registry_base_snapshot(
    mcp_store: &McpStore,
) -> Arc<CapabilityRegistryBaseSnapshot> {
    mcp_store
        .capability_registry_base_cache
        .get_or_build(|| async {
            super::capability_catalog::build_capability_registry_base_snapshot(mcp_store).await
        })
        .await
}

pub(crate) fn invalidate_capability_registry_cache(mcp_store: &McpStore, reason: &str) {
    mcp_store.capability_registry_base_cache.invalidate(reason);
}

pub(crate) fn capability_registry_cache_diagnostics(
    mcp_store: &McpStore,
) -> LocalCapabilityRegistryCacheStatus {
    mcp_store.capability_registry_base_cache.diagnostics()
}
