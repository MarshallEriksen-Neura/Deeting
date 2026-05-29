use super::{PersistedChatToolRuntimeContext, SuspendedChatToolExecution};

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn persisted_chat_runtime_context_from_suspended(
    suspended: &SuspendedChatToolExecution,
) -> PersistedChatToolRuntimeContext {
    PersistedChatToolRuntimeContext {
        max_rounds: suspended.max_rounds,
        round: suspended.round,
        trace_id: suspended.trace_id.clone(),
        request_id: suspended.request_id.clone(),
        execution_policy: suspended.execution_policy.clone(),
        model_connection: suspended.model_connection.clone(),
        orchestrated_messages: suspended.orchestrated_messages.clone(),
        world_model_frame: suspended.world_model_frame.clone(),
        task_query: suspended.task_query.clone(),
        session_id: suspended.session_id.clone(),
        temperature: suspended.temperature,
        max_tokens: suspended.max_tokens,
        reasoning_enabled: suspended.reasoning_enabled,
        reasoning_effort: suspended.reasoning_effort.clone(),
        active_capability: suspended.active_capability.clone(),
        active_skill_context: suspended.active_skill_context.clone(),
        captured_world_model_update: suspended.captured_world_model_update.clone(),
        runtime_metrics: suspended.runtime_metrics.clone(),
        last_capability_snapshot: suspended.last_capability_snapshot.clone(),
        terminal_context: suspended.terminal_context.clone(),
        workflow_context: suspended.workflow_context.clone(),
        last_response: suspended.last_response.clone(),
        selected_knowledge_file_ids: suspended.selected_knowledge_file_ids.clone(),
    }
}
