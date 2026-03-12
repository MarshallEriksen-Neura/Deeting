pub mod commands;
pub mod embedding;
pub mod error;
pub mod model_guard;
pub mod protocols;
pub mod request_runtime;
pub mod response_transformer;
pub mod store;
pub mod types;

use crate::modules::mcp::store::McpStore;
use crate::modules::providers::embedding::EmbeddingService;
use crate::modules::providers::response_transformer::ResponseTransformer;
use crate::modules::providers::store::ProviderStore;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct ProviderState {
    pub store: Arc<ProviderStore>,
    pub embedding: EmbeddingService,
    pub transformer: ResponseTransformer,
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
            _ => EmbeddingService::new(store.clone()),
        };
        let transformer = ResponseTransformer::new();
        Ok(Self {
            store,
            embedding,
            transformer,
        })
    }

    pub async fn with_pool_and_proxy(
        pool: sqlx::sqlite::SqlitePool,
        database_url: &str,
        mcp_store: Option<Arc<McpStore>>,
        cloud_base_url: Option<Arc<RwLock<String>>>,
    ) -> Result<Self, crate::modules::providers::error::ProviderError> {
        let store = Arc::new(ProviderStore::with_pool(pool, database_url)?);
        store.init().await?;
        let embedding = match (mcp_store, cloud_base_url) {
            (Some(mcp_store), Some(cloud_base_url)) => {
                EmbeddingService::with_platform_proxy(store.clone(), mcp_store, cloud_base_url)
            }
            _ => EmbeddingService::new(store.clone()),
        };
        let transformer = ResponseTransformer::new();
        Ok(Self {
            store,
            embedding,
            transformer,
        })
    }
}
