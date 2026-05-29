use super::super::runtime_state::LocalChatToolRuntimeState;
use super::PersistedChatToolRuntimeContext;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn persisted_chat_runtime_context_from_state(
    state: &LocalChatToolRuntimeState,
) -> PersistedChatToolRuntimeContext {
    PersistedChatToolRuntimeContext {
        max_rounds: state.max_rounds,
        round: state.round,
        trace_id: state.trace_id.clone(),
        request_id: state.request_id.clone(),
        execution_policy: state.execution_policy.clone(),
        model_connection: state.model_connection.clone(),
        orchestrated_messages: state.orchestrated_messages.clone(),
        world_model_frame: state.world_model_frame.clone(),
        task_query: state.task_query.clone(),
        session_id: state.session_id.clone(),
        temperature: state.temperature,
        max_tokens: state.max_tokens,
        reasoning_enabled: state.reasoning_enabled,
        reasoning_effort: state.reasoning_effort.clone(),
        active_capability: state.active_capability.clone(),
        active_skill_context: state.active_skill_context.clone(),
        captured_world_model_update: state.captured_world_model_update.clone(),
        runtime_metrics: state.runtime_metrics.clone(),
        last_capability_snapshot: state.last_capability_snapshot.clone(),
        terminal_context: state.terminal_context.clone(),
        workflow_context: state.workflow_context.clone(),
        last_response: state.last_response.clone(),
        selected_knowledge_file_ids: state.selected_knowledge_file_ids.clone(),
    }
}
