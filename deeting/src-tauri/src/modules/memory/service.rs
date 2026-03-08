use std::sync::Arc;

use crate::modules::memory::error::MemoryError;
use crate::modules::memory::store::MemoryStore;
use crate::modules::memory::types::{
    CreateLocalMemoryRequest, LocalMemoryClearRequest, LocalMemoryItem, LocalMemoryListQuery,
    LocalMemoryListResponse, LocalMemorySearchQuery, LocalMemorySearchResult,
};
use crate::modules::providers::embedding::EmbeddingService;

pub struct MemoryService {
    store: Arc<MemoryStore>,
    embedding: Option<EmbeddingService>,
}

impl MemoryService {
    pub fn new(store: Arc<MemoryStore>) -> Self {
        Self {
            store,
            embedding: None,
        }
    }

    pub fn with_embedding(store: Arc<MemoryStore>, embedding: EmbeddingService) -> Self {
        Self {
            store,
            embedding: Some(embedding),
        }
    }

    /// Access the underlying store (needed for backfill and migration).
    pub fn store(&self) -> &Arc<MemoryStore> {
        &self.store
    }

    // --- local_memories operations ---

    /// Append a memory. If an EmbeddingService is available, auto-generates
    /// an embedding vector. Embedding failures are logged but never block
    /// the core append operation.
    pub async fn append(
        &self,
        payload: CreateLocalMemoryRequest,
    ) -> Result<LocalMemoryItem, MemoryError> {
        if let Some(ref embedding_svc) = self.embedding {
            match embedding_svc.embed_text(&payload.content).await {
                Ok(vector) => {
                    return self
                        .store
                        .append_with_embedding(payload, vector, Some("auto".to_string()))
                        .await;
                }
                Err(e) => {
                    log::warn!("memory auto-embedding failed, storing without embedding: {}", e);
                }
            }
        }
        self.store.append(payload).await
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

    /// Semantic search over local memories. Embeds the query text and performs
    /// vector search. Returns an error if no embedding service is configured.
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
        let items = self
            .store
            .search_memories(
                query_vector,
                limit,
                query.session_id.as_deref(),
                query.assistant_id.as_deref(),
            )
            .await?;
        Ok(LocalMemorySearchResult { items })
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
