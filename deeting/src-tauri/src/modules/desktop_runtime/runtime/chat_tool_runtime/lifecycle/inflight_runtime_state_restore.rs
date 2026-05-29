use super::super::runtime_state::LocalChatToolRuntimeState;
use super::super::streaming::LocalRealtimeToolTraceEmitter;
use super::PersistedChatToolRuntimeContext;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn runtime_state_from_persisted_context(
    context: PersistedChatToolRuntimeContext,
) -> LocalChatToolRuntimeState {
    LocalChatToolRuntimeState {
        max_rounds: context.max_rounds,
        round: context.round,
        trace_id: context.trace_id,
        request_id: context.request_id,
        execution_policy: context.execution_policy,
        model_connection: context.model_connection,
        orchestrated_messages: context.orchestrated_messages,
        world_model_frame: context.world_model_frame,
        task_query: context.task_query,
        session_id: context.session_id,
        temperature: context.temperature,
        max_tokens: context.max_tokens,
        reasoning_enabled: context.reasoning_enabled,
        reasoning_effort: context.reasoning_effort,
        active_capability: context.active_capability,
        active_skill_context: context.active_skill_context,
        runtime_metrics: context.runtime_metrics,
        last_capability_snapshot: context.last_capability_snapshot,
        terminal_context: context.terminal_context,
        workflow_context: context.workflow_context,
        last_response: context.last_response,
        runtime_transition_blocks: Vec::new(),
        captured_world_model_update: context.captured_world_model_update,
        realtime_emitter: LocalRealtimeToolTraceEmitter::new(None, None, None),
        selected_knowledge_file_ids: context.selected_knowledge_file_ids,
    }
}
