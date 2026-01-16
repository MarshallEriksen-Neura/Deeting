pub mod commands;
pub mod error;
pub mod process;
pub mod store;
pub mod types;

use std::sync::Arc;

use reqwest::Client;
use tokio::sync::RwLock;

use crate::mcp::process::ProcessManager;
use crate::mcp::store::McpStore;

pub struct McpRuntimeState {
    pub store: Arc<McpStore>,
    pub process_manager: ProcessManager,
    pub cloud_base_url: Arc<RwLock<String>>,
    pub client: Client,
}

impl McpRuntimeState {
    pub fn new(store: Arc<McpStore>, process_manager: ProcessManager, cloud_base_url: String) -> Self {
        Self {
            store,
            process_manager,
            cloud_base_url: Arc::new(RwLock::new(cloud_base_url)),
            client: Client::new(),
        }
    }
}
