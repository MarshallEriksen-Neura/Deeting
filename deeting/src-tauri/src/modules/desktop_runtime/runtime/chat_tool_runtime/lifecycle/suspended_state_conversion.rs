use super::super::runtime_state::LocalChatToolRuntimeState;
use super::super::streaming::LocalRealtimeToolTraceEmitter;
use super::SuspendedChatToolExecution;

impl SuspendedChatToolExecution {
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn into_runtime_state(
        self,
    ) -> LocalChatToolRuntimeState {
        LocalChatToolRuntimeState {
            max_rounds: self.max_rounds,
            round: self.round,
            trace_id: self.trace_id.clone(),
            request_id: self.request_id.clone(),
            execution_policy: self.execution_policy,
            model_connection: self.model_connection,
            orchestrated_messages: self.orchestrated_messages,
            world_model_frame: self.world_model_frame,
            task_query: self.task_query,
            session_id: self.session_id,
            temperature: self.temperature,
            max_tokens: self.max_tokens,
            reasoning_enabled: self.reasoning_enabled,
            reasoning_effort: self.reasoning_effort,
            active_capability: self.active_capability,
            active_skill_context: self.active_skill_context,
            runtime_metrics: self.runtime_metrics,
            last_capability_snapshot: self.last_capability_snapshot,
            terminal_context: self.terminal_context,
            workflow_context: self.workflow_context,
            last_response: self.last_response,
            runtime_transition_blocks: Vec::new(),
            captured_world_model_update: self.captured_world_model_update,
            realtime_emitter: LocalRealtimeToolTraceEmitter::new(
                None,
                Some(self.trace_id.as_str()),
                self.request_id.as_deref(),
            ),
            selected_knowledge_file_ids: self.selected_knowledge_file_ids,
        }
    }
}
