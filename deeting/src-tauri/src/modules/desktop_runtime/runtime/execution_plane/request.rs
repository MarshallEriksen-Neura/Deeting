use super::super::LocalExecutionPolicy;
use super::chat_completion::PolicyScopedChatCompletionInput;
use super::execution_graph_projection::ExecutionGraphContext;
use super::DelegatedExecutionSession;
use crate::modules::ai_upstream::types::LocalModelConnection;
use crate::modules::custom_task_agents::types::CustomTaskAgentProfile;
use crate::modules::desktop_runtime::runtime::chat_tool_runtime::WorldModelUpdate;
use crate::state::AppState;
use desktop_runtime_core::{TaskInputSource, UserInterruption, WorldModelFrame};
use mcp_core::types::LocalChatInputMessage;
use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::mpsc::UnboundedSender;

#[derive(Clone)]
pub(crate) struct LocalExecutionRequest {
    pub(crate) app_handle: AppHandle,
    pub(crate) app_state: AppState,
    pub(crate) model_connection: LocalModelConnection,
    pub(crate) session_id: String,
    pub(crate) capability_id: Option<String>,
    pub(crate) explicit_task_agent_id: Option<String>,
    pub(crate) explicit_task_agent_profile_override: Option<CustomTaskAgentProfile>,
    pub(crate) root_execution_id: Option<String>,
    pub(crate) task_input_source: TaskInputSource,
    pub(crate) user_interruption: Option<UserInterruption>,
    pub(crate) messages: Vec<LocalChatInputMessage>,
    pub(crate) world_model_frame: Option<WorldModelFrame>,
    pub(crate) execution_policy: LocalExecutionPolicy,
    pub(crate) temperature: Option<f32>,
    pub(crate) max_tokens: Option<u32>,
    pub(crate) reasoning_enabled: Option<bool>,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) terminal_context: Option<Value>,
    pub(crate) workflow_context: Option<Value>,
    pub(crate) event_tx: Option<UnboundedSender<String>>,
    pub(crate) trace_id: Option<String>,
    pub(crate) request_id: Option<String>,
    // Selected knowledge file IDs from the chat workflow context, used as the
    // fallback list when the model calls `context_search` with selected scope
    // but omits `filters.selected_file_ids`.
    pub(crate) selected_knowledge_file_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct LocalExecutionOutcome {
    pub(crate) delegated_execution: Option<DelegatedExecutionSession>,
    pub(crate) execution_graph: Value,
    pub(crate) response_json: Value,
    pub(crate) captured_world_model_update: Option<WorldModelUpdate>,
    pub(crate) world_model_frame: Option<WorldModelFrame>,
}

impl LocalExecutionRequest {
    pub(super) fn graph_context(&self) -> ExecutionGraphContext {
        ExecutionGraphContext {
            session_id: self.session_id.clone(),
            trace_id: self.trace_id.clone(),
            request_id: self.request_id.clone(),
            root_execution_id: self.root_execution_id.clone(),
        }
    }
}

impl From<LocalExecutionRequest> for PolicyScopedChatCompletionInput {
    fn from(request: LocalExecutionRequest) -> Self {
        let graph_context = request.graph_context();
        Self {
            app_handle: request.app_handle,
            app_state: request.app_state,
            model_connection: request.model_connection,
            session_id: request.session_id,
            capability_id: request.capability_id,
            explicit_task_agent_id: request.explicit_task_agent_id,
            task_input_source: request.task_input_source,
            messages: request.messages,
            world_model_frame: request.world_model_frame,
            execution_policy: request.execution_policy,
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            reasoning_enabled: request.reasoning_enabled,
            reasoning_effort: request.reasoning_effort,
            terminal_context: request.terminal_context,
            workflow_context: request.workflow_context,
            event_tx: request.event_tx,
            trace_id: request.trace_id,
            request_id: request.request_id,
            selected_knowledge_file_ids: request.selected_knowledge_file_ids,
            graph_context,
        }
    }
}
