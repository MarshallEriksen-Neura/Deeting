use crate::modules::mcp::McpRuntimeState;
use crate::modules::providers::ProviderState;

#[derive(Clone)]
pub struct AppState {
    pub mcp: McpRuntimeState,
    pub providers: std::sync::Arc<ProviderState>,
}

impl AppState {
    pub fn new(mcp: McpRuntimeState, providers: ProviderState) -> Self {
        Self {
            mcp,
            providers: std::sync::Arc::new(providers),
        }
    }
}
