pub mod backfill;
pub mod commands;
pub mod error;
pub mod fact_extractor;
pub mod migration;
pub mod service;
pub mod store;
pub mod types;

use std::sync::Arc;

use crate::modules::memory::error::MemoryError;
use crate::modules::memory::service::MemoryService;
use crate::modules::memory::store::MemoryStore;
use crate::modules::providers::embedding::EmbeddingService;

#[derive(Clone)]
pub struct MemoryState {
    pub service: Arc<MemoryService>,
    pub store: Arc<MemoryStore>,
}

impl MemoryState {
    pub async fn new(lancedb_uri: &str) -> Result<Self, MemoryError> {
        Self::with_options(lancedb_uri, None, None).await
    }

    pub async fn with_options(
        lancedb_uri: &str,
        embedding_dim: Option<i32>,
        embedding_service: Option<EmbeddingService>,
    ) -> Result<Self, MemoryError> {
        let store = Arc::new(MemoryStore::new(lancedb_uri).await?);
        let dim = embedding_dim.unwrap_or(store::DEFAULT_MEMORY_EMBEDDING_DIM);
        store.init_with_dim(dim).await?;
        let service = Arc::new(match embedding_service {
            Some(svc) => MemoryService::with_embedding(store.clone(), svc),
            None => MemoryService::new(store.clone()),
        });
        Ok(Self { service, store })
    }
}
