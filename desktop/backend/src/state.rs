use std::sync::Arc;

use crate::mcp::{McpStore, ProcessManager};

#[derive(Clone)]
pub struct AppState {
    pub version: &'static str,
    pub store: Arc<McpStore>,
    pub process_manager: ProcessManager,
}
