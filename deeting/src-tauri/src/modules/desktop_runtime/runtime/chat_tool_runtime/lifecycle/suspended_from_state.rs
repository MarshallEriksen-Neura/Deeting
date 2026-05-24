use super::super::runtime_state::LocalChatToolRuntimeState;
use super::super::tool_execution::LocalCapabilityTransition;
use super::SuspendedChatToolExecution;
use crate::modules::desktop_runtime::runtime::{
    build_local_tool_trace_blocks, project_execution_graph_snapshot, GraphProjectionInput,
};

impl SuspendedChatToolExecution {
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn from_state(
        state: &LocalChatToolRuntimeState,
        pending_tool_call_meta: &[serde_json::Value],
        _pending_results: &[String],
        _pending_capability_update: Option<LocalCapabilityTransition>,
        _pending_call_id: String,
        _pending_tool_name: String,
    ) -> Self {
        let mut tool_trace_blocks = build_local_tool_trace_blocks(pending_tool_call_meta);
        tool_trace_blocks.extend(state.runtime_transition_blocks.clone());
        let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
            session_id: state.session_id.clone(),
            route: state.execution_policy.route.as_str().to_string(),
            phase_step_type: state.execution_policy.initial_phase_step_name().to_string(),
            trace_id: Some(state.trace_id.clone()),
            request_id: state.request_id.clone(),
            root_execution_id: None,
            response_content: state
                .last_response
                .as_ref()
                .and_then(|response| response.get("content").cloned()),
            tool_trace_blocks,
            delegated_execution_tree: None,
        })
        .to_value();
        Self {
            max_rounds: state.max_rounds,
            round: state.round,
            trace_id: state.trace_id.clone(),
            request_id: state.request_id.clone(),
            execution_policy: state.execution_policy.clone(),
            model_connection: state.model_connection.clone(),
            orchestrated_messages: state.orchestrated_messages.clone(),
            task_query: state.task_query.clone(),
            session_id: state.session_id.clone(),
            temperature: state.temperature,
            max_tokens: state.max_tokens,
            reasoning_enabled: state.reasoning_enabled,
            reasoning_effort: state.reasoning_effort.clone(),
            active_capability: state.active_capability.clone(),
            active_skill_context: state.active_skill_context.clone(),
            runtime_metrics: state.runtime_metrics.clone(),
            last_capability_snapshot: state.last_capability_snapshot.clone(),
            terminal_context: state.terminal_context.clone(),
            workflow_context: state.workflow_context.clone(),
            last_response: state.last_response.clone(),
            pending_approvals: Vec::new(),
            execution_graph,
            selected_knowledge_file_ids: state.selected_knowledge_file_ids.clone(),
        }
    }
}
