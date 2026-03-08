use std::sync::Arc;

use crate::modules::memory::error::MemoryError;
use crate::modules::memory::snapshot_store::SnapshotStore;
use crate::modules::memory::store::MemoryStore;
use crate::modules::memory::types::{
    CreateLocalMemoryRequest, LocalMemoryClearRequest, LocalMemoryItem, LocalMemoryListQuery,
    LocalMemoryListResponse, LocalMemorySearchQuery, LocalMemorySearchResult, MemorySnapshot,
    WriteAction, WriteGuardResult,
};
use crate::modules::providers::embedding::EmbeddingService;

/// Write Guard thresholds (cosine similarity).
const WRITE_GUARD_NOOP_THRESHOLD: f32 = 0.95;
const WRITE_GUARD_UPDATE_THRESHOLD: f32 = 0.85;

/// Vitality decay parameters.
/// final_score = vector_score * (0.7 + 0.3 * vitality * exp(-0.05 * days_since_access))
const VITALITY_BASE_WEIGHT: f32 = 0.7;
const VITALITY_DECAY_WEIGHT: f32 = 0.3;
const VITALITY_DECAY_RATE: f32 = 0.05;

/// Over-fetch factor for vitality reranking.
const RERANK_OVERFETCH_FACTOR: usize = 3;

pub struct MemoryService {
    store: Arc<MemoryStore>,
    embedding: Option<EmbeddingService>,
    snapshots: Option<Arc<SnapshotStore>>,
}

impl MemoryService {
    pub fn new(store: Arc<MemoryStore>) -> Self {
        Self {
            store,
            embedding: None,
            snapshots: None,
        }
    }

    pub fn with_embedding(store: Arc<MemoryStore>, embedding: EmbeddingService) -> Self {
        Self {
            store,
            embedding: Some(embedding),
            snapshots: None,
        }
    }

    pub fn set_snapshot_store(&mut self, snapshots: Arc<SnapshotStore>) {
        self.snapshots = Some(snapshots);
    }

    /// Access the underlying store (needed for backfill and migration).
    pub fn store(&self) -> &Arc<MemoryStore> {
        &self.store
    }

    // --- local_memories operations ---

    /// Append a memory with Write Guard deduplication.
    ///
    /// Write Guard flow:
    /// 1. Embed the content
    /// 2. Search for the most similar existing memory
    /// 3. Score < 0.85 → ADD (new memory)
    /// 4. Score 0.85..0.95 → UPDATE (merge into existing)
    /// 5. Score >= 0.95 → NOOP (discard duplicate)
    ///
    /// If embedding is unavailable, falls through to plain append (always ADD).
    pub async fn append(
        &self,
        payload: CreateLocalMemoryRequest,
    ) -> Result<LocalMemoryItem, MemoryError> {
        if let Some(ref embedding_svc) = self.embedding {
            match embedding_svc.embed_text(&payload.content).await {
                Ok(vector) => {
                    return self.append_with_write_guard(payload, vector).await;
                }
                Err(e) => {
                    log::warn!("memory auto-embedding failed, storing without embedding: {}", e);
                }
            }
        }
        self.store.append(payload).await
    }

    /// Append with Write Guard: embed → find similar → decide action.
    async fn append_with_write_guard(
        &self,
        payload: CreateLocalMemoryRequest,
        embedding: Vec<f32>,
    ) -> Result<LocalMemoryItem, MemoryError> {
        // Find the most similar existing memory
        let top1 = self
            .store
            .find_top1_similar(
                embedding.clone(),
                payload.session_id.as_deref(),
                payload.assistant_id.as_deref(),
            )
            .await?;

        match top1 {
            Some((existing_id, existing_content, score)) if score >= WRITE_GUARD_NOOP_THRESHOLD => {
                // NOOP: too similar, discard
                log::debug!(
                    "write guard: NOOP (score={:.3}) — discarding duplicate of {}",
                    score,
                    existing_id
                );
                // Return a synthetic item based on the payload but not persisted
                let now = now_rfc3339();
                Ok(LocalMemoryItem {
                    id: existing_id,
                    content: existing_content,
                    session_id: payload.session_id,
                    assistant_id: payload.assistant_id,
                    meta_info: payload.meta_info,
                    embedding_model: None,
                    category: payload.category,
                    source: payload.source,
                    tags: payload.tags,
                    vitality: Some(1.0),
                    last_accessed_at: None,
                    created_at: now.clone(),
                    updated_at: now,
                })
            }
            Some((existing_id, existing_content, score))
                if score >= WRITE_GUARD_UPDATE_THRESHOLD =>
            {
                // UPDATE: merge content into existing memory
                log::debug!(
                    "write guard: UPDATE (score={:.3}) — merging into {}",
                    score,
                    existing_id
                );
                let merged_content =
                    format!("{}\n\n---\n\n{}", existing_content, payload.content.trim());

                // Re-embed the merged content
                let new_embedding = if let Some(ref embedding_svc) = self.embedding {
                    match embedding_svc.embed_text(&merged_content).await {
                        Ok(v) => Some(v),
                        Err(e) => {
                            log::warn!("write guard: re-embed merged content failed: {}", e);
                            None
                        }
                    }
                } else {
                    None
                };

                // Record snapshot before update
                if let Some(ref snap) = self.snapshots {
                    let _ = snap
                        .record(
                            &existing_id,
                            "update",
                            Some(&existing_content),
                            Some(&merged_content),
                            None,
                            None,
                        )
                        .await
                        .map_err(|e| log::warn!("snapshot record failed: {}", e));
                }

                let updated = self
                    .store
                    .update_memory_content(
                        &existing_id,
                        &merged_content,
                        new_embedding,
                        Some("auto".to_string()),
                    )
                    .await?;

                match updated {
                    Some(item) => Ok(item),
                    None => {
                        // Existing memory vanished, fall through to ADD
                        self.store
                            .append_with_embedding(payload, embedding, Some("auto".to_string()))
                            .await
                    }
                }
            }
            _ => {
                // ADD: new distinct memory
                self.store
                    .append_with_embedding(payload, embedding, Some("auto".to_string()))
                    .await
            }
        }
    }

    /// Write Guard append that returns detailed guard result.
    pub async fn append_guarded(
        &self,
        payload: CreateLocalMemoryRequest,
    ) -> Result<WriteGuardResult, MemoryError> {
        if let Some(ref embedding_svc) = self.embedding {
            match embedding_svc.embed_text(&payload.content).await {
                Ok(vector) => {
                    return self.append_guarded_inner(payload, vector).await;
                }
                Err(e) => {
                    log::warn!("memory auto-embedding failed: {}", e);
                }
            }
        }
        // No embedding: always ADD
        let item = self.store.append(payload).await?;
        Ok(WriteGuardResult {
            action: WriteAction::Add,
            item: Some(item),
            similarity_score: None,
            updated_memory_id: None,
        })
    }

    async fn append_guarded_inner(
        &self,
        payload: CreateLocalMemoryRequest,
        embedding: Vec<f32>,
    ) -> Result<WriteGuardResult, MemoryError> {
        let top1 = self
            .store
            .find_top1_similar(
                embedding.clone(),
                payload.session_id.as_deref(),
                payload.assistant_id.as_deref(),
            )
            .await?;

        match top1 {
            Some((existing_id, _existing_content, score))
                if score >= WRITE_GUARD_NOOP_THRESHOLD =>
            {
                Ok(WriteGuardResult {
                    action: WriteAction::Noop,
                    item: None,
                    similarity_score: Some(score),
                    updated_memory_id: Some(existing_id),
                })
            }
            Some((existing_id, existing_content, score))
                if score >= WRITE_GUARD_UPDATE_THRESHOLD =>
            {
                let merged =
                    format!("{}\n\n---\n\n{}", existing_content, payload.content.trim());

                let new_embedding = if let Some(ref embedding_svc) = self.embedding {
                    embedding_svc.embed_text(&merged).await.ok()
                } else {
                    None
                };

                if let Some(ref snap) = self.snapshots {
                    let _ = snap
                        .record(&existing_id, "update", Some(&existing_content), Some(&merged), None, None)
                        .await;
                }

                let updated = self
                    .store
                    .update_memory_content(&existing_id, &merged, new_embedding, Some("auto".to_string()))
                    .await?;

                Ok(WriteGuardResult {
                    action: WriteAction::Update,
                    item: updated,
                    similarity_score: Some(score),
                    updated_memory_id: Some(existing_id),
                })
            }
            _ => {
                let score = top1.as_ref().map(|(_, _, s)| *s);
                let item = self
                    .store
                    .append_with_embedding(payload, embedding, Some("auto".to_string()))
                    .await?;
                Ok(WriteGuardResult {
                    action: WriteAction::Add,
                    item: Some(item),
                    similarity_score: score,
                    updated_memory_id: None,
                })
            }
        }
    }

    pub async fn list(
        &self,
        query: LocalMemoryListQuery,
    ) -> Result<LocalMemoryListResponse, MemoryError> {
        self.store.list(query).await
    }

    pub async fn delete(&self, id: &str) -> Result<bool, MemoryError> {
        self.store.delete(id).await
    }

    pub async fn clear(&self, payload: LocalMemoryClearRequest) -> Result<i64, MemoryError> {
        self.store.clear(payload).await
    }

    /// Semantic search with vitality-weighted reranking.
    ///
    /// 1. Over-fetch Top-N * RERANK_OVERFETCH_FACTOR results
    /// 2. Apply vitality decay: final_score = vector_score * (0.7 + 0.3 * vitality * exp(-decay * days))
    /// 3. Re-sort and return Top-K
    /// 4. Touch vitality (update last_accessed_at) for returned results
    pub async fn search(
        &self,
        query: LocalMemorySearchQuery,
    ) -> Result<LocalMemorySearchResult, MemoryError> {
        let embedding_svc = self.embedding.as_ref().ok_or_else(|| {
            MemoryError::Validation("embedding service not available for search".to_string())
        })?;
        let query_vector = embedding_svc
            .embed_text(&query.query)
            .await
            .map_err(|e| MemoryError::Storage(format!("failed to embed search query: {}", e)))?;
        let limit = query.limit.unwrap_or(10).clamp(1, 100);
        let overfetch = limit * RERANK_OVERFETCH_FACTOR;

        let mut items = self
            .store
            .search_memories(
                query_vector,
                overfetch,
                query.session_id.as_deref(),
                query.assistant_id.as_deref(),
            )
            .await?;

        // Apply vitality-weighted reranking
        let now = time::OffsetDateTime::now_utc();
        for item in &mut items {
            let vitality = item.vitality.unwrap_or(1.0);
            let days_since_access = parse_days_since(&item.updated_at, now);
            let decay = (-VITALITY_DECAY_RATE * days_since_access).exp();
            item.score = item.score
                * (VITALITY_BASE_WEIGHT + VITALITY_DECAY_WEIGHT * vitality * decay);
        }

        // Re-sort by adjusted score
        items.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        items.truncate(limit);

        // Fire-and-forget: update last_accessed_at for returned items
        if !items.is_empty() {
            let updates: Vec<(String, f32)> = items
                .iter()
                .map(|item| {
                    (item.id.clone(), item.vitality.unwrap_or(1.0))
                })
                .collect();
            let store = self.store.clone();
            tokio::spawn(async move {
                if let Err(e) = store.update_vitality_batch(&updates).await {
                    log::warn!("vitality touch failed: {}", e);
                }
            });
        }

        Ok(LocalMemorySearchResult { items })
    }

    // --- snapshot & rollback ---

    /// List snapshots for a memory (audit trail).
    pub async fn list_snapshots(
        &self,
        memory_id: &str,
        limit: i64,
    ) -> Result<Vec<MemorySnapshot>, MemoryError> {
        let snap = self.snapshots.as_ref().ok_or_else(|| {
            MemoryError::Validation("snapshot store not available".to_string())
        })?;
        snap.list_by_memory(memory_id, limit).await
    }

    /// Rollback a memory to a previous snapshot state.
    /// Restores old_content from the snapshot and re-embeds.
    pub async fn rollback_memory(
        &self,
        snapshot_id: &str,
    ) -> Result<Option<LocalMemoryItem>, MemoryError> {
        let snap = self.snapshots.as_ref().ok_or_else(|| {
            MemoryError::Validation("snapshot store not available".to_string())
        })?;

        let snapshot = snap.get_snapshot(snapshot_id).await?.ok_or_else(|| {
            MemoryError::NotFound(format!("snapshot {} not found", snapshot_id))
        })?;

        let old_content = snapshot.old_content.as_deref().ok_or_else(|| {
            MemoryError::Validation("snapshot has no old_content to restore".to_string())
        })?;

        // Re-embed the restored content
        let new_embedding = if let Some(ref embedding_svc) = self.embedding {
            embedding_svc.embed_text(old_content).await.ok()
        } else {
            None
        };

        // Record the rollback as a new snapshot
        let _ = snap
            .record(
                &snapshot.memory_id,
                "rollback",
                None, // current content will be overwritten
                Some(old_content),
                None,
                None,
            )
            .await;

        self.store
            .update_memory_content(
                &snapshot.memory_id,
                old_content,
                new_embedding,
                Some("rollback".to_string()),
            )
            .await
    }

    // --- local_assets operations ---

    pub async fn upsert_asset(
        &self,
        id: String,
        name: String,
        description: String,
        asset_type: String,
        source_type: String,
        pkg_name: Option<String>,
        vector: Vec<f32>,
        metadata: Option<serde_json::Value>,
    ) -> Result<(), MemoryError> {
        self.store
            .upsert_asset(id, name, description, asset_type, source_type, pkg_name, vector, metadata)
            .await
    }

    pub async fn search_assets(
        &self,
        vector: Vec<f32>,
        limit: usize,
        asset_type: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, MemoryError> {
        self.store.search_assets(vector, limit, asset_type).await
    }

    pub async fn delete_assets_by_package(&self, pkg_name: &str) -> Result<(), MemoryError> {
        self.store.delete_assets_by_package(pkg_name).await
    }

    pub async fn recreate_local_asset_table(&self, vector_dim: i32) -> Result<(), MemoryError> {
        self.store.recreate_local_asset_table(vector_dim).await
    }

    pub async fn get_asset_by_id(
        &self,
        id: &str,
    ) -> Result<Option<serde_json::Value>, MemoryError> {
        self.store.get_asset_by_id(id).await
    }

    pub async fn list_assets_catalog(&self) -> Result<Vec<serde_json::Value>, MemoryError> {
        self.store.list_assets_catalog().await
    }

    pub async fn local_asset_vector_dimension(&self) -> Result<Option<i32>, MemoryError> {
        self.store.local_asset_vector_dimension().await
    }

    // --- backfill helpers ---

    /// Embed a single memory's content and update its embedding in the store.
    /// Returns Ok(true) if updated, Ok(false) if the item was not found.
    pub async fn embed_and_update(
        &self,
        id: &str,
        content: &str,
    ) -> Result<bool, MemoryError> {
        let embedding_svc = self.embedding.as_ref().ok_or_else(|| {
            MemoryError::Validation("embedding service not available for backfill".to_string())
        })?;
        let vector = embedding_svc
            .embed_text(content)
            .await
            .map_err(|e| MemoryError::Storage(format!("backfill embed failed: {}", e)))?;
        self.store
            .update_memory_embedding(id, vector, Some("backfill".to_string()))
            .await
    }
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// Parse an RFC3339 timestamp and return days elapsed since that time.
fn parse_days_since(timestamp: &str, now: time::OffsetDateTime) -> f32 {
    time::OffsetDateTime::parse(timestamp, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(|t| {
            let duration = now - t;
            (duration.whole_seconds() as f32 / 86400.0).max(0.0)
        })
        .unwrap_or(0.0)
}
