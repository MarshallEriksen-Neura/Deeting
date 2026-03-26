use crate::modules::browser_agent::BrowserAgentState;
use crate::modules::code_mode::CodeModeState;
use crate::modules::im::wechat::WechatState;
use crate::modules::knowledge::KnowledgeState;
use crate::modules::mcp::McpRuntimeState;
use crate::modules::memory::MemoryState;
use crate::modules::monitor::MonitorState;
use crate::modules::providers::ProviderState;
use crate::modules::sandbox::SandboxState;
use std::sync::OnceLock;
use tauri::AppHandle;

#[derive(Clone)]
pub struct AppState {
    pub mcp: McpRuntimeState,
    pub browser_agent: std::sync::Arc<BrowserAgentState>,
    pub knowledge: std::sync::Arc<KnowledgeState>,
    pub providers: std::sync::Arc<ProviderState>,
    pub memory: std::sync::Arc<MemoryState>,
    pub sandbox: std::sync::Arc<SandboxState>,
    pub code_mode: std::sync::Arc<CodeModeState>,
    pub monitor: std::sync::Arc<MonitorState>,
    pub wechat: std::sync::Arc<WechatState>,
}

impl AppState {
    pub fn new(
        mcp: McpRuntimeState,
        browser_agent: BrowserAgentState,
        knowledge: KnowledgeState,
        providers: ProviderState,
        memory: MemoryState,
        sandbox: SandboxState,
        code_mode: CodeModeState,
        monitor: MonitorState,
        wechat: WechatState,
    ) -> Self {
        Self {
            mcp,
            browser_agent: std::sync::Arc::new(browser_agent),
            knowledge: std::sync::Arc::new(knowledge),
            providers: std::sync::Arc::new(providers),
            memory: std::sync::Arc::new(memory),
            sandbox: std::sync::Arc::new(sandbox),
            code_mode: std::sync::Arc::new(code_mode),
            monitor: std::sync::Arc::new(monitor),
            wechat: std::sync::Arc::new(wechat),
        }
    }
}

static GLOBAL_APP_STATE: OnceLock<AppState> = OnceLock::new();
static GLOBAL_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn set_global_app_state(app_state: AppState) {
    let _ = GLOBAL_APP_STATE.set(app_state);
}

pub fn set_global_app_handle(app_handle: AppHandle) {
    let _ = GLOBAL_APP_HANDLE.set(app_handle);
}

pub fn global_app_state() -> Option<AppState> {
    GLOBAL_APP_STATE.get().cloned()
}

pub fn global_app_handle() -> Option<AppHandle> {
    GLOBAL_APP_HANDLE.get().cloned()
}
