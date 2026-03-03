use crate::modules::code_mode::CodeModeState;
use crate::modules::mcp::McpRuntimeState;
use crate::modules::memory::MemoryState;
use crate::modules::providers::ProviderState;
use crate::modules::sandbox::SandboxState;

#[derive(Clone)]
pub struct AppState {
    pub mcp: McpRuntimeState,
    pub providers: std::sync::Arc<ProviderState>,
    pub memory: std::sync::Arc<MemoryState>,
    pub sandbox: std::sync::Arc<SandboxState>,
    pub code_mode: std::sync::Arc<CodeModeState>,
}

impl AppState {
    pub fn new(
        mcp: McpRuntimeState,
        providers: ProviderState,
        memory: MemoryState,
        sandbox: SandboxState,
        code_mode: CodeModeState,
    ) -> Self {
        Self {
            mcp,
            providers: std::sync::Arc::new(providers),
            memory: std::sync::Arc::new(memory),
            sandbox: std::sync::Arc::new(sandbox),
            code_mode: std::sync::Arc::new(code_mode),
        }
    }
}
