pub mod commands;
pub mod embedding;
pub mod error;
pub mod model_guard;
pub mod request_runtime;
pub mod response_transformer;
pub mod store;
pub mod types;

use crate::modules::providers::embedding::EmbeddingService;
use crate::modules::providers::response_transformer::ResponseTransformer;
use crate::modules::providers::store::ProviderStore;
use std::sync::Arc;

pub struct ProviderState {
    pub store: Arc<ProviderStore>,
    pub embedding: EmbeddingService,
    pub transformer: ResponseTransformer,
}

impl ProviderState {
    pub async fn new(
        database_url: &str,
    ) -> Result<Self, crate::modules::providers::error::ProviderError> {
        let store = Arc::new(ProviderStore::new(database_url).await?);
        store.init().await?;
        let embedding = EmbeddingService::new(store.clone());
        let transformer = ResponseTransformer::new();
        Ok(Self {
            store,
            embedding,
            transformer,
        })
    }
}
