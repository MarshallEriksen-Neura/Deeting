pub mod bridge;
pub mod commands;
pub mod service;
pub mod types;

use std::sync::Arc;

use service::BrowserAgentService;

#[derive(Clone)]
pub struct BrowserAgentState {
    pub service: Arc<BrowserAgentService>,
}

impl BrowserAgentState {
    pub fn new() -> Self {
        Self {
            service: Arc::new(BrowserAgentService::new()),
        }
    }
}
