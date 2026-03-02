pub mod commands;
pub mod error;
pub mod process;
pub mod store;
pub mod types;
pub mod bridge;

use std::sync::Arc;

use reqwest::Client;
use tokio::sync::RwLock;

use crate::modules::mcp::process::ProcessManager;
use crate::modules::mcp::store::McpStore;
use crate::modules::mcp::bridge::McpBridgeState;

#[derive(Clone)]
pub struct McpRuntimeState {
    pub store: Arc<McpStore>,
    pub process_manager: ProcessManager,
    pub cloud_base_url: Arc<RwLock<String>>,
    pub client: Client,
    pub bridge: Arc<McpBridgeState>,
}

impl McpRuntimeState {
    pub fn new(store: Arc<McpStore>, process_manager: ProcessManager, cloud_base_url: String) -> Self {
        Self {
            store,
            process_manager,
            cloud_base_url: Arc::new(RwLock::new(cloud_base_url.clone())),
            client: Client::new(),
            bridge: Arc::new(McpBridgeState::new(cloud_base_url)),
        }
    }
}
