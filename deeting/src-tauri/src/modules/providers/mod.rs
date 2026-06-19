pub mod bandit_selector;
#[cfg(test)]
mod bandit_selector_tests;
pub mod commands;
pub mod connection_cache;
pub mod embedding;
pub mod error;
pub mod model_guard;
pub mod protocols;
pub mod provider_market_file;
pub mod request_runtime;
pub mod response_processor;
pub mod response_transformer;
pub mod store;
pub mod streaming;
pub mod types;

use crate::modules::mcp::store::McpStore;
use crate::modules::providers::connection_cache::ConnectionCache;
use crate::modules::providers::embedding::EmbeddingService;
use crate::modules::providers::response_transformer::ResponseTransformer;
use crate::modules::providers::store::ProviderStore;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct ProviderState {
    pub store: Arc<ProviderStore>,
    pub embedding: EmbeddingService,
    pub transformer: ResponseTransformer,
    pub connection_cache: ConnectionCache,
}

impl ProviderState {
    pub async fn new(
        database_url: &str,
    ) -> Result<Self, crate::modules::providers::error::ProviderError> {
        Self::new_with_platform_proxy(database_url, None, None).await
    }

    pub async fn new_with_platform_proxy(
        database_url: &str,
        mcp_store: Option<Arc<McpStore>>,
        cloud_base_url: Option<Arc<RwLock<String>>>,
    ) -> Result<Self, crate::modules::providers::error::ProviderError> {
        let store = Arc::new(ProviderStore::new(database_url).await?);
        store.init().await?;
        let embedding = match (mcp_store, cloud_base_url) {
            (Some(mcp_store), Some(cloud_base_url)) => {
                EmbeddingService::with_platform_proxy(store.clone(), mcp_store, cloud_base_url)
            }
            (Some(mcp_store), None) => EmbeddingService::new(store.clone(), Some(mcp_store)),
            _ => EmbeddingService::new(store.clone(), None),
        };
        let transformer = ResponseTransformer::new();
        let connection_cache = ConnectionCache::new();
        Ok(Self {
            store,
            embedding,
            transformer,
            connection_cache,
        })
    }

    pub async fn with_pool_and_proxy(
        pool: sqlx::sqlite::SqlitePool,
        database_url: &str,
        mcp_store: Option<Arc<McpStore>>,
        cloud_base_url: Option<Arc<RwLock<String>>>,
    ) -> Result<Self, crate::modules::providers::error::ProviderError> {
        Self::with_pools_and_proxy(pool.clone(), pool, database_url, mcp_store, cloud_base_url)
            .await
    }

    pub async fn with_pools_and_proxy(
        pool: sqlx::sqlite::SqlitePool,
        write_pool: sqlx::sqlite::SqlitePool,
        database_url: &str,
        mcp_store: Option<Arc<McpStore>>,
        cloud_base_url: Option<Arc<RwLock<String>>>,
    ) -> Result<Self, crate::modules::providers::error::ProviderError> {
        let store = Arc::new(ProviderStore::with_pool_and_write_pool(
            pool,
            write_pool,
            database_url,
        )?);
        store.init().await?;
        let embedding = match (mcp_store, cloud_base_url) {
            (Some(mcp_store), Some(cloud_base_url)) => {
                EmbeddingService::with_platform_proxy(store.clone(), mcp_store, cloud_base_url)
            }
            (Some(mcp_store), None) => EmbeddingService::new(store.clone(), Some(mcp_store)),
            _ => EmbeddingService::new(store.clone(), None),
        };
        let transformer = ResponseTransformer::new();
        let connection_cache = ConnectionCache::new();
        Ok(Self {
            store,
            embedding,
            transformer,
            connection_cache,
        })
    }
}
