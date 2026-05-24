use super::super::LocalExecutionPolicy;
use super::chat_completion::PolicyScopedChatCompletionInput;
use super::execution_graph_projection::ExecutionGraphContext;
use super::DelegatedExecutionSession;
use crate::modules::ai_upstream::types::LocalModelConnection;
use crate::state::AppState;
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
    pub(crate) root_execution_id: Option<String>,
    pub(crate) messages: Vec<LocalChatInputMessage>,
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
}

impl LocalExecutionRequest {
    pub(super) fn graph_context(&self) -> ExecutionGraphContext {
        ExecutionGraphContext {
            session_id: self.session_id.clone(),
            route: self.execution_policy.route.as_str().to_string(),
            phase_step_type: self.execution_policy.initial_phase_step_name().to_string(),
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
            messages: request.messages,
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
