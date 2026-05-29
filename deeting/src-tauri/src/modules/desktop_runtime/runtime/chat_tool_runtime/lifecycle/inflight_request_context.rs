use super::PersistedChatToolRuntimeContext;
use crate::modules::desktop_runtime::runtime::LocalExecutionRequest;

pub(crate) fn build_persisted_chat_runtime_context_from_execution_request(
    request: &LocalExecutionRequest,
    task_query: Option<String>,
    trace_id: String,
    max_rounds: usize,
) -> PersistedChatToolRuntimeContext {
    PersistedChatToolRuntimeContext {
        max_rounds,
        round: 0,
        trace_id,
        request_id: request.request_id.clone(),
        execution_policy: request.execution_policy.clone(),
        model_connection: request.model_connection.clone(),
        orchestrated_messages: request.messages.clone(),
        world_model_frame: request.world_model_frame.clone(),
        task_query,
        session_id: request.session_id.clone(),
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        reasoning_enabled: request.reasoning_enabled,
        reasoning_effort: request.reasoning_effort.clone(),
        active_capability: None,
        active_skill_context: None,
        captured_world_model_update: None,
        runtime_metrics: Default::default(),
        last_capability_snapshot: request.execution_policy.capability_snapshot.clone(),
        terminal_context: request.terminal_context.clone(),
        workflow_context: request.workflow_context.clone(),
        last_response: None,
        selected_knowledge_file_ids: request.selected_knowledge_file_ids.clone(),
    }
}
