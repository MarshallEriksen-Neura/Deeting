pub mod bridge;
pub mod commands;
pub mod contract;
pub mod error;
pub mod prompt;
pub mod protocol;
pub mod store;
pub mod types;

use std::sync::Arc;

use crate::modules::code_mode::bridge::CodeModeBridgeState;
use crate::modules::code_mode::error::CodeModeError;
use crate::modules::code_mode::store::CodeModeExecutionStore;

#[derive(Clone)]
pub struct CodeModeState {
    pub bridge: Arc<CodeModeBridgeState>,
    pub execution_store: Arc<CodeModeExecutionStore>,
}

impl CodeModeState {
    pub async fn new(database_url: &str) -> Result<Self, CodeModeError> {
        let execution_store = CodeModeExecutionStore::new(database_url).await?;
        Ok(Self {
            bridge: Arc::new(CodeModeBridgeState::new()),
            execution_store: Arc::new(execution_store),
        })
    }

    pub async fn with_pool(pool: sqlx::sqlite::SqlitePool) -> Result<Self, CodeModeError> {
        let execution_store = CodeModeExecutionStore::with_pool(pool).await?;
        Ok(Self {
            bridge: Arc::new(CodeModeBridgeState::new()),
            execution_store: Arc::new(execution_store),
        })
    }
}
