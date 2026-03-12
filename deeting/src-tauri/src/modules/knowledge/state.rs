use std::sync::Arc;

use sqlx::sqlite::SqlitePool;

use crate::modules::knowledge::error::KnowledgeError;
use crate::modules::knowledge::store::KnowledgeStore;

#[derive(Clone)]
pub struct KnowledgeState {
    pub store: Arc<KnowledgeStore>,
}

impl KnowledgeState {
    pub async fn with_pool(pool: SqlitePool) -> Result<Self, KnowledgeError> {
        let store = Arc::new(KnowledgeStore::with_pool(pool));
        store.init().await?;
        Ok(Self { store })
    }
}
