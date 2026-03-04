pub mod bridge;
pub mod commands;
pub mod error;
pub mod process;
pub mod store;
pub mod types;

use std::collections::HashMap;
use std::sync::Arc;

use reqwest::Client;
use serde_json::Value;
use tokio::sync::RwLock;

use crate::modules::mcp::bridge::McpBridgeState;
use crate::modules::mcp::process::ProcessManager;
use crate::modules::mcp::store::McpStore;

#[derive(Clone)]
pub struct PendingToolCall {
    pub tool_name: String,
    pub arguments: Value,
}

#[derive(Clone)]
pub struct McpRuntimeState {
    pub store: Arc<McpStore>,
    pub process_manager: ProcessManager,
    pub cloud_base_url: Arc<RwLock<String>>,
    pub client: Client,
    pub bridge: Arc<McpBridgeState>,
    pub pending_tool_calls: Arc<RwLock<HashMap<String, PendingToolCall>>>,
}

impl McpRuntimeState {
    pub fn new(
        store: Arc<McpStore>,
        process_manager: ProcessManager,
        cloud_base_url: String,
    ) -> Self {
        Self {
            store,
            process_manager,
            cloud_base_url: Arc::new(RwLock::new(cloud_base_url.clone())),
            client: Client::new(),
            bridge: Arc::new(McpBridgeState::new(cloud_base_url)),
            pending_tool_calls: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Determines if a tool operation is considered high-risk
    pub fn is_high_risk_tool(&self, tool_name: &str) -> bool {
        let name = tool_name.to_lowercase();
        name.contains("delete") 
            || name.contains("remove") 
            || name.contains("write") 
            || name.contains("shell") 
            || name.contains("execute")
            || name.contains("update")
            || name.contains("terminal")
    }
}
