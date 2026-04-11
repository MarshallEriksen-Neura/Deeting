pub mod bridge;
pub mod commands;
pub mod contract;
pub(crate) mod core_tool_contracts;
pub mod error;
pub mod prompt;
pub mod protocol;
pub mod store;
pub mod types;

use std::sync::Arc;

use crate::modules::code_mode::bridge::CodemodeToolBridgeState;
use crate::modules::code_mode::error::CodemodeToolError;
use crate::modules::code_mode::store::CodemodeToolExecutionStore;

#[derive(Clone)]
pub struct CodemodeToolState {
    pub bridge: Arc<CodemodeToolBridgeState>,
    pub execution_store: Arc<CodemodeToolExecutionStore>,
}

impl CodemodeToolState {
    pub async fn new(database_url: &str) -> Result<Self, CodemodeToolError> {
        let execution_store = CodemodeToolExecutionStore::new(database_url).await?;
        Ok(Self {
            bridge: Arc::new(CodemodeToolBridgeState::new()),
            execution_store: Arc::new(execution_store),
        })
    }

    pub async fn with_pool(pool: sqlx::sqlite::SqlitePool) -> Result<Self, CodemodeToolError> {
        let execution_store = CodemodeToolExecutionStore::with_pool(pool).await?;
        Ok(Self {
            bridge: Arc::new(CodemodeToolBridgeState::new()),
            execution_store: Arc::new(execution_store),
        })
    }

    pub async fn with_pools(
        pool: sqlx::sqlite::SqlitePool,
        write_pool: sqlx::sqlite::SqlitePool,
    ) -> Result<Self, CodemodeToolError> {
        let execution_store = CodemodeToolExecutionStore::with_pools(pool, write_pool).await?;
        Ok(Self {
            bridge: Arc::new(CodemodeToolBridgeState::new()),
            execution_store: Arc::new(execution_store),
        })
    }
}
