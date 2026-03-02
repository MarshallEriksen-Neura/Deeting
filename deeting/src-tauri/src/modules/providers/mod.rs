pub mod types;
pub mod store;
pub mod error;
pub mod commands;

use std::sync::Arc;
use crate::modules::providers::store::ProviderStore;

pub struct ProviderState {
    pub store: Arc<ProviderStore>,
}

impl ProviderState {
    pub async fn new(database_url: &str) -> Result<Self, crate::modules::providers::error::ProviderError> {
        let store = Arc::new(ProviderStore::new(database_url).await?);
        store.init().await?;
        Ok(Self { store })
    }
}
