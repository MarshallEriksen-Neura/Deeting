use crate::modules::mcp::McpRuntimeState;

#[derive(Clone)]
pub struct AppState {
    pub mcp: McpRuntimeState,
    // 这里可以预留未来的模块，例如：
    // pub knowledge: KnowledgeState,
}

impl AppState {
    pub fn new(mcp: McpRuntimeState) -> Self {
        Self { mcp }
    }
}
