use std::sync::Arc;

use crate::modules::memory::error::MemoryError;
use crate::modules::memory::snapshot_store::SnapshotStore;
use crate::modules::memory::store::MemoryStore;
use crate::modules::memory::types::{
    CreateLocalMemoryRequest, LocalMemoryClearRequest, LocalMemoryItem, LocalMemoryListQuery,
    LocalMemoryListResponse, LocalMemorySearchQuery, LocalMemorySearchResult, MemorySnapshot,
    UpdateLocalMemoryRequest, WriteAction, WriteGuardResult,
};
use crate::modules::providers::embedding::EmbeddingService;
use crate::modules::retrieval_kernel::lifecycle::{
    memory_recency_multiplier, touched_vitality, DEFAULT_VITALITY_RERANK_OVERFETCH_FACTOR,
};
use crate::modules::retrieval_kernel::supersession::{
    candidate_is_superseded, find_supersession_target, mark_existing_memory_as_superseded,
    mark_new_memory_as_superseding, supersession_rank_multiplier,
};
use crate::modules::retrieval_kernel::write_guard::{
    decide_write_guard, policy_for_profile, WriteGuardCoreAction, WriteGuardDecisionDetail,
    WriteGuardProfile, WriteGuardScopeMode,
};
use serde_json::Value;

pub struct MemoryService {
    store: Arc<MemoryStore>,
    embedding: Option<EmbeddingService>,
    snapshots: Option<Arc<SnapshotStore>>,
}

fn optional_log_value(value: Option<&str>) -> &str {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("-")
}

fn profile_log_label(profile: WriteGuardProfile) -> &'static str {
    match profile {
        WriteGuardProfile::ManualMemory => "manual_memory",
        WriteGuardProfile::AutoExtractedFact => "auto_extracted_fact",
        WriteGuardProfile::WikiPromotion => "wiki_promotion",
    }
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
        self.append_with_profile(payload, WriteGuardProfile::ManualMemory)
            .await
    }

    async fn append_with_profile(
        &self,
        payload: CreateLocalMemoryRequest,
        profile: WriteGuardProfile,
    ) -> Result<LocalMemoryItem, MemoryError> {
        if let Some(ref embedding_svc) = self.embedding {
            match embedding_svc.embed_text(&payload.content).await {
                Ok(vector) => {
                    return self.append_with_write_guard(payload, vector, profile).await;
                }
                Err(e) => {
                    log::warn!(
                        "memory auto-embedding failed, storing without embedding: {}",
                        e
                    );
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
        profile: WriteGuardProfile,
    ) -> Result<LocalMemoryItem, MemoryError> {
        let candidates = self
            .find_candidates_for_write_guard(
                &payload,
                embedding.clone(),
                policy_for_profile(profile).scope_mode,
            )
            .await?;
        let detail = decide_write_guard(
            profile,
            &payload,
            &candidates,
            time::OffsetDateTime::now_utc(),
        );
        let supersession = find_supersession_target(profile, &payload, &candidates);
        match detail.action {
            WriteGuardCoreAction::Noop => Ok(candidates
                .first()
                .map(|candidate| candidate.to_memory_item())
                .unwrap_or_else(|| fallback_payload_item(&payload))),
            WriteGuardCoreAction::Update => {
                if supersession.is_some() {
                    let created = self
                        .store
                        .append_with_embedding(payload, embedding, Some("auto".to_string()))
                        .await?;
                    return self
                        .apply_supersession_if_needed(created, supersession)
                        .await;
                }
                let existing = candidates.first().ok_or_else(|| {
                    MemoryError::Validation("write guard update target missing".to_string())
                })?;
                self.update_from_write_guard(existing, payload, detail)
                    .await
            }
            WriteGuardCoreAction::Add | WriteGuardCoreAction::Ambiguous => {
                let created = self
                    .store
                    .append_with_embedding(payload, embedding, Some("auto".to_string()))
                    .await?;
                self.apply_supersession_if_needed(created, supersession)
                    .await
            } /*
              (WriteGuardDecision::Noop, Some((existing_id, existing_content, score))) => {
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
                      capability_id: payload.capability_id,
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
              (WriteGuardDecision::Update, Some((existing_id, existing_content, score))) => {
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
              */
        }
    }

    /// Write Guard append that returns detailed guard result.
    pub async fn append_guarded(
        &self,
        payload: CreateLocalMemoryRequest,
    ) -> Result<WriteGuardResult, MemoryError> {
        self.append_guarded_with_profile(payload, WriteGuardProfile::ManualMemory)
            .await
    }

    /// Append with namespace-aware Write Guard using the payload filters as the
    /// candidate search boundary.
    ///
    /// This is useful when a caller needs deduplication inside a narrower
    /// logical corpus such as a specific workspace or source namespace, rather
    /// than global memory-wide merging.
    pub async fn append_guarded_scoped(
        &self,
        payload: CreateLocalMemoryRequest,
    ) -> Result<WriteGuardResult, MemoryError> {
        self.append_guarded_with_profile(payload, WriteGuardProfile::ManualMemory)
            .await
    }

    pub(crate) async fn append_guarded_with_profile(
        &self,
        payload: CreateLocalMemoryRequest,
        profile: WriteGuardProfile,
    ) -> Result<WriteGuardResult, MemoryError> {
        if let Some(ref embedding_svc) = self.embedding {
            let profile_label = profile_log_label(profile);
            let session_id = optional_log_value(payload.session_id.as_deref());
            let capability_id = optional_log_value(payload.capability_id.as_deref());
            let category = optional_log_value(payload.category.as_deref());
            let source = optional_log_value(payload.source.as_deref());
            let content_chars = payload.content.chars().count();
            log::info!(
                "memory embedding start profile={} session={} capability={} category={} source={} content_chars={}",
                profile_label,
                session_id,
                capability_id,
                category,
                source,
                content_chars
            );
            match embedding_svc.embed_text(&payload.content).await {
                Ok(vector) => {
                    log::info!(
                        "memory embedding ok profile={} session={} capability={} category={} source={} vector_dim={}",
                        profile_label,
                        session_id,
                        capability_id,
                        category,
                        source,
                        vector.len()
                    );
                    return self.append_guarded_inner(payload, vector, profile).await;
                }
                Err(e) => {
                    log::warn!(
                        "memory embedding failed profile={} session={} capability={} category={} source={} content_chars={} err={}",
                        profile_label,
                        session_id,
                        capability_id,
                        category,
                        source,
                        content_chars,
                        e
                    );
                }
            }
        }
        let item = self.store.append(payload).await?;
        Ok(WriteGuardResult {
            action: WriteAction::Add,
            item: Some(item),
            similarity_score: None,
            updated_memory_id: None,
            decision_reason: Some("embedding_unavailable_fallback".to_string()),
            top1_score: None,
            top2_score: None,
            score_gap: None,
            score_ratio: None,
            effective_update_threshold: None,
            effective_noop_threshold: None,
            protected_existing: Some(false),
        })
    }

    async fn append_guarded_inner(
        &self,
        payload: CreateLocalMemoryRequest,
        embedding: Vec<f32>,
        profile: WriteGuardProfile,
    ) -> Result<WriteGuardResult, MemoryError> {
        let candidates = self
            .find_candidates_for_write_guard(
                &payload,
                embedding.clone(),
                policy_for_profile(profile).scope_mode,
            )
            .await?;
        let detail = decide_write_guard(
            profile,
            &payload,
            &candidates,
            time::OffsetDateTime::now_utc(),
        );
        let fallback_score = candidates.first().map(|candidate| candidate.exact_score);
        let supersession = find_supersession_target(profile, &payload, &candidates);

        match detail.action {
            WriteGuardCoreAction::Noop => Ok(build_guard_result(
                WriteAction::Noop,
                None,
                detail.selected_existing_id.clone(),
                fallback_score,
                &detail,
            )),
            WriteGuardCoreAction::Update => {
                if supersession.is_some() {
                    let item = self
                        .store
                        .append_with_embedding(payload, embedding, Some("auto".to_string()))
                        .await?;
                    let item = self
                        .apply_supersession_if_needed(item, supersession)
                        .await?;
                    return Ok(build_guard_result(
                        WriteAction::Add,
                        Some(item),
                        None,
                        fallback_score,
                        &detail,
                    ));
                }
                let existing = candidates.first().ok_or_else(|| {
                    MemoryError::Validation("write guard update target missing".to_string())
                })?;
                let updated = self
                    .update_from_write_guard(existing, payload, detail.clone())
                    .await?;
                Ok(build_guard_result(
                    WriteAction::Update,
                    Some(updated),
                    detail.selected_existing_id.clone(),
                    fallback_score,
                    &detail,
                ))
            }
            WriteGuardCoreAction::Add | WriteGuardCoreAction::Ambiguous => {
                let item = self
                    .store
                    .append_with_embedding(payload, embedding, Some("auto".to_string()))
                    .await?;
                let item = self
                    .apply_supersession_if_needed(item, supersession)
                    .await?;
                Ok(build_guard_result(
                    WriteAction::Add,
                    Some(item),
                    None,
                    fallback_score,
                    &detail,
                ))
            }
        }
    }

    async fn find_candidates_for_write_guard(
        &self,
        payload: &CreateLocalMemoryRequest,
        embedding: Vec<f32>,
        scope_mode: WriteGuardScopeMode,
    ) -> Result<Vec<crate::modules::retrieval_kernel::write_guard::WriteGuardCandidate>, MemoryError>
    {
        match scope_mode {
            WriteGuardScopeMode::Global => {
                let candidates = self
                    .store
                    .search_memories_for_write_guard(embedding, 4, None, None, None, None, None)
                    .await?;
                Ok(candidates
                    .into_iter()
                    .filter(|candidate| !candidate_is_superseded(candidate.meta_info.as_ref()))
                    .collect())
            }
            WriteGuardScopeMode::PayloadFilters => {
                let candidates = self
                    .store
                    .search_memories_for_write_guard(
                        embedding,
                        4,
                        payload.session_id.as_deref(),
                        payload.capability_id.as_deref(),
                        payload.category.as_deref(),
                        payload.source.as_deref(),
                        payload.tags.as_deref(),
                    )
                    .await?;
                Ok(candidates
                    .into_iter()
                    .filter(|candidate| !candidate_is_superseded(candidate.meta_info.as_ref()))
                    .collect())
            }
        }
    }

    async fn update_from_write_guard(
        &self,
        existing: &crate::modules::retrieval_kernel::write_guard::WriteGuardCandidate,
        payload: CreateLocalMemoryRequest,
        detail: WriteGuardDecisionDetail,
    ) -> Result<LocalMemoryItem, MemoryError> {
        let merged_content = format!("{}\n\n---\n\n{}", existing.content, payload.content.trim());

        let new_embedding = if let Some(ref embedding_svc) = self.embedding {
            match embedding_svc.embed_text(&merged_content).await {
                Ok(vector) => Some(vector),
                Err(error) => {
                    log::warn!("write guard: re-embed merged content failed: {}", error);
                    None
                }
            }
        } else {
            None
        };

        if let Some(ref snap) = self.snapshots {
            let _ = snap
                .record(
                    &existing.id,
                    "update",
                    Some(&existing.content),
                    Some(&merged_content),
                    None,
                    None,
                )
                .await
                .map_err(|error| log::warn!("snapshot record failed: {}", error));
        }

        let updated = self
            .store
            .update_memory_content(
                &existing.id,
                &merged_content,
                new_embedding,
                Some("auto".to_string()),
            )
            .await?;

        match updated {
            Some(item) => Ok(item),
            None => {
                if matches!(detail.action, WriteGuardCoreAction::Update) {
                    self.store
                        .append_with_embedding(
                            payload,
                            self.embedding
                                .as_ref()
                                .ok_or_else(|| {
                                    MemoryError::Validation(
                                        "embedding service unavailable for write guard fallback"
                                            .to_string(),
                                    )
                                })?
                                .embed_text(&merged_content)
                                .await
                                .map_err(|error| {
                                    MemoryError::Storage(format!(
                                        "failed to re-embed merged write guard content: {}",
                                        error
                                    ))
                                })?,
                            Some("auto".to_string()),
                        )
                        .await
                } else {
                    Ok(fallback_payload_item(&payload))
                }
            }
        }
    }

    async fn apply_supersession_if_needed(
        &self,
        created: LocalMemoryItem,
        supersession: Option<crate::modules::retrieval_kernel::supersession::SupersessionDecision>,
    ) -> Result<LocalMemoryItem, MemoryError> {
        let Some(supersession) = supersession else {
            return Ok(created);
        };

        let now = now_rfc3339();
        let updated_new_meta = mark_new_memory_as_superseding(
            created.meta_info.as_ref(),
            supersession.target_memory_id.as_str(),
            supersession.claim_key.as_str(),
            supersession.reason.as_str(),
            now.as_str(),
        );
        let created = self
            .store
            .update_memory_metadata(&created.id, Some(updated_new_meta))
            .await?
            .unwrap_or(created);

        if let Some(existing) = self.store.get(&supersession.target_memory_id).await? {
            let updated_old_meta = mark_existing_memory_as_superseded(
                existing.meta_info.as_ref(),
                created.id.as_str(),
                supersession.claim_key.as_str(),
                supersession.reason.as_str(),
                now.as_str(),
            );
            let _ = self
                .store
                .update_memory_metadata(existing.id.as_str(), Some(updated_old_meta))
                .await?;
        }

        Ok(created)
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

    pub async fn update(
        &self,
        id: &str,
        payload: UpdateLocalMemoryRequest,
    ) -> Result<LocalMemoryItem, MemoryError> {
        let mut payload = payload;
        let existing = self
            .store
            .get(id)
            .await?
            .ok_or_else(|| MemoryError::Validation(format!("memory not found: {}", id)))?;

        payload.meta_info =
            merge_memory_update_meta(existing.meta_info.as_ref(), payload.meta_info);

        let old_metadata = serialize_memory_metadata(&existing)?;
        let new_metadata = serialize_memory_update_metadata(&existing, &payload)?;

        if let Some(ref snap) = self.snapshots {
            if let Err(error) = snap
                .record(
                    &existing.id,
                    "update",
                    Some(&existing.content),
                    Some(&payload.content),
                    old_metadata.as_deref(),
                    new_metadata.as_deref(),
                )
                .await
            {
                log::warn!("memory update snapshot failed: {}", error);
            }
        }

        let (embedding, embedding_model) = if let Some(ref embedding_svc) = self.embedding {
            match embedding_svc.embed_text(&payload.content).await {
                Ok(vector) => (Some(vector), Some("auto".to_string())),
                Err(error) => {
                    log::warn!(
                        "memory update embedding failed, clearing embedding: {}",
                        error
                    );
                    (None, None)
                }
            }
        } else {
            (None, None)
        };

        self.store
            .update_memory(id, payload, embedding, embedding_model)
            .await?
            .ok_or_else(|| MemoryError::Validation(format!("memory not found: {}", id)))
    }

    pub async fn clear(&self, payload: LocalMemoryClearRequest) -> Result<i64, MemoryError> {
        self.store.clear(payload).await
    }

    /// Semantic search with vitality-weighted reranking.
    ///
    /// 1. Over-fetch Top-N * RERANK_OVERFETCH_FACTOR results
    /// 2. Apply category-aware recency decay so durable memories fade more slowly than ephemeral ones
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
        self.search_with_query_vector(query, query_vector).await
    }

    pub async fn search_with_query_vector(
        &self,
        query: LocalMemorySearchQuery,
        query_vector: Vec<f32>,
    ) -> Result<LocalMemorySearchResult, MemoryError> {
        let limit = query.limit.unwrap_or(10).clamp(1, 100);
        let overfetch = limit * DEFAULT_VITALITY_RERANK_OVERFETCH_FACTOR;

        let mut items = self
            .store
            .search_memories(
                query_vector,
                overfetch,
                query.session_id.as_deref(),
                query.capability_id.as_deref(),
                query.category.as_deref(),
                query.source.as_deref(),
                query.tags.as_deref(),
            )
            .await?;

        items.retain(|item| !candidate_is_superseded(item.meta_info.as_ref()));

        apply_vitality_rerank(&mut items, time::OffsetDateTime::now_utc());

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
                .map(|item| (item.id.clone(), touched_vitality(item.vitality)))
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
        let snap = self
            .snapshots
            .as_ref()
            .ok_or_else(|| MemoryError::Validation("snapshot store not available".to_string()))?;
        snap.list_by_memory(memory_id, limit).await
    }

    /// Rollback a memory to a previous snapshot state.
    /// Restores content and metadata from the snapshot and re-embeds.
    pub async fn rollback_memory(
        &self,
        snapshot_id: &str,
    ) -> Result<Option<LocalMemoryItem>, MemoryError> {
        let snap = self
            .snapshots
            .as_ref()
            .ok_or_else(|| MemoryError::Validation("snapshot store not available".to_string()))?;

        let snapshot = snap
            .get_snapshot(snapshot_id)
            .await?
            .ok_or_else(|| MemoryError::NotFound(format!("snapshot {} not found", snapshot_id)))?;

        let old_content = snapshot.old_content.as_deref().ok_or_else(|| {
            MemoryError::Validation("snapshot has no old_content to restore".to_string())
        })?;
        let existing = self.store.get(&snapshot.memory_id).await?.ok_or_else(|| {
            MemoryError::Validation(format!("memory not found: {}", snapshot.memory_id))
        })?;

        let mut restore_payload = snapshot_restore_payload(snapshot.old_metadata.as_deref())?;
        restore_payload.content = old_content.to_string();
        let old_metadata = serialize_memory_metadata(&existing)?;
        let new_metadata = serialize_memory_update_metadata(&existing, &restore_payload)?;

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
                Some(existing.content.as_str()),
                Some(old_content),
                old_metadata.as_deref(),
                new_metadata.as_deref(),
            )
            .await;

        self.store
            .update_memory(
                &snapshot.memory_id,
                restore_payload,
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
            .upsert_asset(
                id,
                name,
                description,
                asset_type,
                source_type,
                pkg_name,
                vector,
                metadata,
            )
            .await
    }

    pub async fn update_asset_metadata(
        &self,
        id: &str,
        metadata: Option<serde_json::Value>,
    ) -> Result<bool, MemoryError> {
        self.store.update_asset_metadata(id, metadata).await
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

    pub async fn upsert_knowledge_chunk_asset(
        &self,
        id: String,
        document_id: String,
        document_name: String,
        content: String,
        chunk_index: i64,
        token_count: i64,
        vector: Vec<f32>,
        metadata: Option<serde_json::Value>,
    ) -> Result<(), MemoryError> {
        self.store
            .upsert_knowledge_chunk_asset(
                id,
                document_id,
                document_name,
                content,
                chunk_index,
                token_count,
                vector,
                metadata,
            )
            .await
    }

    pub async fn delete_knowledge_chunk_assets_by_document_id(
        &self,
        document_id: &str,
    ) -> Result<(), MemoryError> {
        self.store
            .delete_knowledge_chunk_assets_by_document_id(document_id)
            .await
    }

    pub async fn delete_assets_by_ids(&self, asset_ids: &[String]) -> Result<(), MemoryError> {
        self.store.delete_assets_by_ids(asset_ids).await
    }

    pub async fn recreate_local_asset_table(&self, vector_dim: i32) -> Result<(), MemoryError> {
        self.store.recreate_local_asset_table(vector_dim).await
    }

    pub async fn recreate_knowledge_chunk_table(&self, vector_dim: i32) -> Result<(), MemoryError> {
        self.store.recreate_knowledge_chunk_table(vector_dim).await
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

    pub async fn list_assets_by_package(
        &self,
        pkg_name: &str,
        asset_type: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, MemoryError> {
        self.store
            .list_assets_by_package(pkg_name, asset_type)
            .await
    }

    pub async fn local_asset_vector_dimension(&self) -> Result<Option<i32>, MemoryError> {
        self.store.local_asset_vector_dimension().await
    }

    // --- knowledge search ---

    /// Semantic search for knowledge chunks via LanceDB `user_knowledge_chunks`.
    pub async fn search_knowledge(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<crate::modules::memory::types::KnowledgeSearchResult>, MemoryError> {
        let embedding_svc = match self.embedding.as_ref() {
            Some(svc) => svc,
            None => {
                log::warn!("search_knowledge: embedding service not available, returning empty");
                return Ok(Vec::new());
            }
        };

        let query_vector = match embedding_svc.embed_text(query).await {
            Ok(v) => v,
            Err(e) => {
                log::warn!("search_knowledge: failed to embed query: {}", e);
                return Ok(Vec::new());
            }
        };

        self.search_knowledge_with_query_vector(query_vector, limit)
            .await
    }

    pub async fn search_knowledge_with_query_vector(
        &self,
        query_vector: Vec<f32>,
        limit: usize,
    ) -> Result<Vec<crate::modules::memory::types::KnowledgeSearchResult>, MemoryError> {
        let clamped_limit = limit.clamp(1, 100);
        let results = self
            .store
            .search_knowledge_chunk_assets(query_vector, clamped_limit)
            .await?;

        Ok(map_knowledge_search_results(results))
    }

    pub async fn search_knowledge_with_query_vector_in_documents(
        &self,
        query_vector: Vec<f32>,
        document_ids: &[String],
        limit: usize,
    ) -> Result<Vec<crate::modules::memory::types::KnowledgeSearchResult>, MemoryError> {
        let clamped_limit = limit.clamp(1, 100);
        let results = self
            .store
            .search_knowledge_chunk_assets_in_documents(query_vector, clamped_limit, document_ids)
            .await?;

        Ok(map_knowledge_search_results(results))
    }

    // --- backfill helpers ---

    /// Embed a single memory's content and update its embedding in the store.
    /// Returns Ok(true) if updated, Ok(false) if the item was not found.
    pub async fn embed_and_update(&self, id: &str, content: &str) -> Result<bool, MemoryError> {
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

fn fallback_payload_item(payload: &CreateLocalMemoryRequest) -> LocalMemoryItem {
    let now = now_rfc3339();
    LocalMemoryItem {
        id: uuid::Uuid::new_v4().to_string(),
        content: payload.content.trim().to_string(),
        session_id: payload.session_id.clone(),
        capability_id: payload.capability_id.clone(),
        meta_info: payload.meta_info.clone(),
        embedding_model: None,
        category: payload.category.clone(),
        source: payload.source.clone(),
        tags: payload.tags.clone(),
        vitality: Some(1.0),
        last_accessed_at: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

fn build_guard_result(
    action: WriteAction,
    item: Option<LocalMemoryItem>,
    updated_memory_id: Option<String>,
    similarity_score: Option<f32>,
    detail: &WriteGuardDecisionDetail,
) -> WriteGuardResult {
    WriteGuardResult {
        action,
        item,
        similarity_score,
        updated_memory_id,
        decision_reason: Some(detail.reason.clone()),
        top1_score: detail.top1_score,
        top2_score: detail.top2_score,
        score_gap: detail.score_gap,
        score_ratio: detail.score_ratio,
        effective_update_threshold: Some(detail.effective_update_threshold),
        effective_noop_threshold: Some(detail.effective_noop_threshold),
        protected_existing: Some(detail.protected_existing),
    }
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

fn map_knowledge_search_results(
    items: Vec<serde_json::Value>,
) -> Vec<crate::modules::memory::types::KnowledgeSearchResult> {
    let mut hits = Vec::new();
    for item in items {
        let pkg_name = item.get("pkg_name").and_then(|v| v.as_str());
        let document_id = pkg_name.map(|value| value.to_string());
        let chunk_id = item
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let content = item
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let score = item
            .get("_distance")
            .and_then(|v| v.as_f64())
            .map(|d| d as f32)
            .unwrap_or(0.0);
        let metadata = item.get("metadata").cloned();
        let chunk_index = metadata
            .as_ref()
            .and_then(|m| m.get("chunk_index"))
            .and_then(|v| v.as_i64());
        let document_name = metadata
            .as_ref()
            .and_then(|m| m.get("document_name"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        hits.push(crate::modules::memory::types::KnowledgeSearchResult {
            chunk_id,
            content,
            score,
            document_id,
            document_name,
            chunk_index,
            metadata,
        });
    }
    hits
}

fn serialize_memory_metadata(item: &LocalMemoryItem) -> Result<Option<String>, MemoryError> {
    let metadata = serde_json::json!({
        "meta_info": item.meta_info,
        "category": item.category,
        "source": item.source,
        "tags": item.tags,
        "vitality": item.vitality,
        "last_accessed_at": item.last_accessed_at,
    });
    serde_json::to_string(&metadata).map(Some).map_err(|error| {
        MemoryError::Storage(format!("failed to serialize memory metadata: {}", error))
    })
}

fn serialize_memory_update_metadata(
    existing: &LocalMemoryItem,
    payload: &UpdateLocalMemoryRequest,
) -> Result<Option<String>, MemoryError> {
    let metadata = serde_json::json!({
        "meta_info": payload.meta_info.clone().or_else(|| existing.meta_info.clone()),
        "category": payload.category.clone().or_else(|| existing.category.clone()),
        "source": payload.source.clone().or_else(|| existing.source.clone()),
        "tags": payload.tags.clone().or_else(|| existing.tags.clone()),
        "vitality": existing.vitality,
        "last_accessed_at": existing.last_accessed_at,
    });
    serde_json::to_string(&metadata).map(Some).map_err(|error| {
        MemoryError::Storage(format!(
            "failed to serialize updated memory metadata: {}",
            error
        ))
    })
}

fn merge_memory_update_meta(existing: Option<&Value>, incoming: Option<Value>) -> Option<Value> {
    let Some(incoming_value) = incoming else {
        return existing.cloned();
    };

    let Some(incoming_map) = incoming_value.as_object() else {
        return Some(incoming_value);
    };

    let mut merged = existing
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    for (key, value) in incoming_map {
        if value.is_null() {
            merged.remove(key);
        } else {
            merged.insert(key.clone(), value.clone());
        }
    }
    if merged.is_empty() {
        None
    } else {
        Some(Value::Object(merged))
    }
}

fn snapshot_restore_payload(
    metadata: Option<&str>,
) -> Result<UpdateLocalMemoryRequest, MemoryError> {
    let mut request = UpdateLocalMemoryRequest {
        content: String::new(),
        meta_info: None,
        category: None,
        source: None,
        tags: None,
    };

    let Some(raw_metadata) = metadata else {
        return Ok(request);
    };
    let value: Value = serde_json::from_str(raw_metadata).map_err(|error| {
        MemoryError::Storage(format!(
            "failed to deserialize snapshot metadata: {}",
            error
        ))
    })?;
    let Some(object) = value.as_object() else {
        return Ok(request);
    };

    request.meta_info =
        object.get("meta_info").cloned().and_then(
            |value| {
                if value.is_null() {
                    None
                } else {
                    Some(value)
                }
            },
        );
    request.category = object
        .get("category")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    request.source = object
        .get("source")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    request.tags = object.get("tags").and_then(|value| {
        value.as_array().map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|text| text.to_string()))
                .collect::<Vec<String>>()
        })
    });
    Ok(request)
}

fn reference_timestamp(item: &crate::modules::memory::types::LocalMemorySearchItem) -> &str {
    item.last_accessed_at.as_deref().unwrap_or_else(|| {
        if item.updated_at.trim().is_empty() {
            item.created_at.as_str()
        } else {
            item.updated_at.as_str()
        }
    })
}

fn apply_vitality_rerank(
    items: &mut [crate::modules::memory::types::LocalMemorySearchItem],
    now: time::OffsetDateTime,
) {
    for item in items.iter_mut() {
        item.score *= memory_recency_multiplier(
            item.vitality,
            reference_timestamp(item),
            now,
            item.category.as_deref(),
            item.source.as_deref(),
            item.session_id.as_deref(),
            item.meta_info.as_ref(),
        );
        item.score *= supersession_rank_multiplier(item.meta_info.as_ref());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::memory::snapshot_store::SnapshotStore;
    use crate::modules::memory::store::{MemoryStore, DEFAULT_MEMORY_EMBEDDING_DIM};
    use crate::modules::memory::types::LocalMemorySearchItem;
    use std::sync::Arc;

    fn test_path(label: &str) -> String {
        let path =
            std::env::temp_dir().join(format!("deeting-memory-{}-{}", label, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path.to_string_lossy().into_owned()
    }

    async fn create_service_with_snapshots() -> MemoryService {
        let lancedb_uri = test_path("service-lancedb");
        let store = Arc::new(MemoryStore::new(&lancedb_uri).await.expect("create store"));
        store.init().await.expect("init store");
        let snapshots = Arc::new(
            SnapshotStore::new("sqlite::memory:")
                .await
                .expect("create snapshot store"),
        );
        let mut service = MemoryService::new(store);
        service.set_snapshot_store(snapshots);
        service
    }

    fn test_embedding() -> Vec<f32> {
        let mut embedding = vec![0.0; DEFAULT_MEMORY_EMBEDDING_DIM as usize];
        embedding[0] = 0.9;
        embedding[1] = 0.1;
        embedding
    }

    #[tokio::test]
    async fn update_keeps_identity_and_records_snapshot() {
        let service = create_service_with_snapshots().await;
        let created = service
            .append(CreateLocalMemoryRequest {
                content: "prefers coffee".into(),
                session_id: None,
                capability_id: None,
                meta_info: Some(serde_json::json!({"source": "chat"})),
                category: Some("preference".into()),
                source: Some("manual".into()),
                tags: Some(vec!["coffee".into()]),
            })
            .await
            .expect("append memory");

        let updated = service
            .update(
                &created.id,
                UpdateLocalMemoryRequest {
                    content: "prefers black coffee".into(),
                    meta_info: None,
                    category: Some("preference".into()),
                    source: None,
                    tags: Some(vec!["coffee".into(), "black".into()]),
                },
            )
            .await
            .expect("update memory");

        let snapshots = service
            .list_snapshots(&created.id, 10)
            .await
            .expect("list snapshots");

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.content, "prefers black coffee");
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].action, "update");
        assert_eq!(snapshots[0].old_content.as_deref(), Some("prefers coffee"));
        assert_eq!(
            snapshots[0].new_content.as_deref(),
            Some("prefers black coffee")
        );
    }

    #[tokio::test]
    async fn rollback_restores_metadata_from_snapshot() {
        let service = create_service_with_snapshots().await;
        let created = service
            .append(CreateLocalMemoryRequest {
                content: "prefers coffee".into(),
                session_id: None,
                capability_id: None,
                meta_info: Some(serde_json::json!({
                    "recall_when": "when discussing drinks",
                    "is_core": true
                })),
                category: Some("preference".into()),
                source: Some("manual".into()),
                tags: Some(vec!["coffee".into()]),
            })
            .await
            .expect("append memory");

        let _updated = service
            .update(
                &created.id,
                UpdateLocalMemoryRequest {
                    content: "prefers tea".into(),
                    meta_info: Some(serde_json::json!({
                        "recall_when": "when discussing tea",
                        "is_core": false,
                        "is_boot": true
                    })),
                    category: Some("event".into()),
                    source: Some("auto".into()),
                    tags: Some(vec!["tea".into()]),
                },
            )
            .await
            .expect("update memory");

        let snapshots = service
            .list_snapshots(&created.id, 10)
            .await
            .expect("list snapshots");
        let rolled_back = service
            .rollback_memory(&snapshots[0].id)
            .await
            .expect("rollback memory")
            .expect("rolled back item");

        assert_eq!(rolled_back.content, "prefers coffee");
        assert_eq!(rolled_back.category.as_deref(), Some("preference"));
        assert_eq!(rolled_back.source.as_deref(), Some("manual"));
        assert_eq!(rolled_back.tags, Some(vec!["coffee".to_string()]));
        assert_eq!(
            rolled_back
                .meta_info
                .as_ref()
                .and_then(|value| value.get("recall_when"))
                .and_then(|value| value.as_str()),
            Some("when discussing drinks")
        );
        assert_eq!(
            rolled_back
                .meta_info
                .as_ref()
                .and_then(|value| value.get("is_core"))
                .and_then(|value| value.as_bool()),
            Some(true)
        );
        assert_eq!(
            rolled_back
                .meta_info
                .as_ref()
                .and_then(|value| value.get("is_boot")),
            None
        );
    }

    #[tokio::test]
    async fn scoped_write_guard_candidate_search_respects_payload_namespace() {
        let service = create_service_with_snapshots().await;
        service
            .store
            .append_with_embedding(
                CreateLocalMemoryRequest {
                    content: "workspace one stable conclusion".into(),
                    session_id: None,
                    capability_id: Some("llm_wiki".into()),
                    meta_info: None,
                    category: Some("llm_wiki".into()),
                    source: Some("llm_wiki_automation::workspace-1".into()),
                    tags: Some(vec!["llm-wiki".into(), "workspace:workspace-1".into()]),
                },
                test_embedding(),
                Some("test".into()),
            )
            .await
            .expect("insert workspace one memory");
        service
            .store
            .append_with_embedding(
                CreateLocalMemoryRequest {
                    content: "workspace two stable conclusion".into(),
                    session_id: None,
                    capability_id: Some("llm_wiki".into()),
                    meta_info: None,
                    category: Some("llm_wiki".into()),
                    source: Some("llm_wiki_automation::workspace-2".into()),
                    tags: Some(vec!["llm-wiki".into(), "workspace:workspace-2".into()]),
                },
                test_embedding(),
                Some("test".into()),
            )
            .await
            .expect("insert workspace two memory");

        let candidates = service
            .find_candidates_for_write_guard(
                &CreateLocalMemoryRequest {
                    content: "workspace one stable conclusion".into(),
                    session_id: None,
                    capability_id: Some("llm_wiki".into()),
                    meta_info: None,
                    category: Some("llm_wiki".into()),
                    source: Some("llm_wiki_automation::workspace-1".into()),
                    tags: Some(vec!["llm-wiki".into(), "workspace:workspace-1".into()]),
                },
                test_embedding(),
                WriteGuardScopeMode::PayloadFilters,
            )
            .await
            .expect("scoped search");

        let candidate = candidates.first().expect("matching candidate");
        let id = candidate.id.clone();
        let content = candidate.content.clone();
        assert!(!id.is_empty());
        assert_eq!(content, "workspace one stable conclusion");
    }

    #[test]
    fn vitality_rerank_prefers_last_accessed_at_over_updated_at() {
        let now = time::OffsetDateTime::parse(
            "2026-03-08T00:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("parse time");
        let mut items = vec![
            LocalMemorySearchItem {
                id: "recent-access".into(),
                content: "recent access".into(),
                session_id: None,
                capability_id: None,
                meta_info: None,
                score: 1.0,
                category: None,
                source: None,
                tags: None,
                vitality: Some(1.0),
                last_accessed_at: Some("2026-03-07T23:00:00Z".into()),
                created_at: "2026-02-01T00:00:00Z".into(),
                updated_at: "2026-02-01T00:00:00Z".into(),
            },
            LocalMemorySearchItem {
                id: "stale-access".into(),
                content: "stale access".into(),
                session_id: None,
                capability_id: None,
                meta_info: None,
                score: 1.0,
                category: None,
                source: None,
                tags: None,
                vitality: Some(1.0),
                last_accessed_at: Some("2026-02-01T00:00:00Z".into()),
                created_at: "2026-03-07T23:00:00Z".into(),
                updated_at: "2026-03-07T23:00:00Z".into(),
            },
        ];

        apply_vitality_rerank(&mut items, now);

        assert!(items[0].score > items[1].score);
    }

    #[test]
    fn touched_vitality_increments_and_caps() {
        assert!((touched_vitality(Some(0.5)) - 0.58).abs() < f32::EPSILON);
        assert_eq!(touched_vitality(Some(0.97)), 1.0);
        assert_eq!(touched_vitality(None), 1.0);
    }
}
