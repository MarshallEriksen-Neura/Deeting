pub mod commands;
pub mod error;
pub mod store;
pub mod types;

use crate::modules::providers::store::ProviderStore;
use std::sync::Arc;

pub struct ProviderState {
    pub store: Arc<ProviderStore>,
}

impl ProviderState {
    pub async fn new(
        database_url: &str,
    ) -> Result<Self, crate::modules::providers::error::ProviderError> {
        let store = Arc::new(ProviderStore::new(database_url).await?);
        store.init().await?;
        Ok(Self { store })
    }
}
