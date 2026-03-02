pub mod commands;
pub mod error;
pub mod store;
pub mod types;

use std::sync::Arc;

use crate::modules::memory::error::MemoryError;
use crate::modules::memory::store::MemoryStore;

#[derive(Clone)]
pub struct MemoryState {
    pub store: Arc<MemoryStore>,
}

impl MemoryState {
    pub async fn new(lancedb_uri: &str) -> Result<Self, MemoryError> {
        let store = Arc::new(MemoryStore::new(lancedb_uri).await?);
        store.init().await?;
        Ok(Self { store })
    }
}
