pub mod bridge;
pub mod commands;
pub mod contract;
pub mod error;
pub mod prompt;
pub mod protocol;
pub mod store;
pub mod types;

use std::collections::HashMap;
use std::sync::Arc;

use crate::modules::code_mode::bridge::CodeModeBridgeState;
use crate::modules::code_mode::error::CodeModeError;
use crate::modules::code_mode::store::CodeModeExecutionStore;
use crate::modules::code_mode::types::ExecuteLocalCodeModeRequest;
use crate::modules::mcp::commands::common_impl::LocalModelConnection;
use crate::modules::mcp::commands::runtime::LocalAssistantActivationState;
use crate::modules::mcp::store::LocalConversationChatContext;
use crate::modules::mcp::types::LocalChatInputMessage;
use tokio::sync::RwLock;

#[derive(Clone)]
pub(crate) struct PendingLocalCodeModeExecution {
    pub(crate) model_connection: LocalModelConnection,
    pub(crate) orchestrated_messages: Vec<LocalChatInputMessage>,
    pub(crate) chat_ctx: LocalConversationChatContext,
    pub(crate) temperature: Option<f32>,
    pub(crate) max_tokens: Option<u32>,
    pub(crate) trace_id: String,
    pub(crate) request_id: Option<String>,
    pub(crate) max_rounds: usize,
    pub(crate) round: usize,
    pub(crate) all_tool_call_meta: Vec<serde_json::Value>,
    pub(crate) last_capability_snapshot: Option<serde_json::Value>,
    pub(crate) active_assistant: Option<LocalAssistantActivationState>,
    pub(crate) response_assistant_content: String,
    pub(crate) partial_tool_call_meta: Vec<serde_json::Value>,
    pub(crate) partial_results: Vec<String>,
    pub(crate) pending_call_id: String,
    pub(crate) execute_request: ExecuteLocalCodeModeRequest,
    pub(crate) execution_section_emitted: bool,
    pub(crate) created_at_unix_ms: i128,
    pub(crate) expires_at_unix_ms: i128,
}

#[derive(Clone)]
pub struct CodeModeState {
    pub bridge: Arc<CodeModeBridgeState>,
    pub execution_store: Arc<CodeModeExecutionStore>,
    pub(crate) pending_local_approvals: Arc<RwLock<HashMap<String, PendingLocalCodeModeExecution>>>,
}

impl CodeModeState {
    pub async fn new(database_url: &str) -> Result<Self, CodeModeError> {
        let execution_store = CodeModeExecutionStore::new(database_url).await?;
        Ok(Self {
            bridge: Arc::new(CodeModeBridgeState::new()),
            execution_store: Arc::new(execution_store),
            pending_local_approvals: Arc::new(RwLock::new(HashMap::new())),
        })
    }
}
