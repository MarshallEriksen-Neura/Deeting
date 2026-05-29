use super::super::runtime_state::{
    rewind_round_for_post_approval_continuation, LocalChatToolRuntimeState,
};
use super::super::tool_meta::enrich_response_with_tool_trace;
use super::{finalize_tool_round, SuspendedChatToolExecution};
use crate::modules::desktop_runtime::runtime::LocalExecutionPolicy;
use crate::modules::mcp::commands::common_impl::LocalModelConnection;

pub(super) struct PreparedApprovalResumeState {
    pub(super) state: LocalChatToolRuntimeState,
    pub(super) session_id: String,
    pub(super) model_connection: LocalModelConnection,
    pub(super) execution_policy: LocalExecutionPolicy,
}

pub(super) fn prepare_runtime_state_for_approval_resume(
    suspended: SuspendedChatToolExecution,
    pending_response: serde_json::Value,
    graph_pending_tool_call_meta: &[serde_json::Value],
    pending_results: &[String],
) -> PreparedApprovalResumeState {
    let mut state = suspended.into_runtime_state();
    let session_id = state.session_id.clone();
    let model_connection = state.model_connection.clone();
    let execution_policy = state.execution_policy.clone();
    let protocol_family = state.model_connection.protocol_family.clone();
    finalize_tool_round(
        &mut state.orchestrated_messages,
        protocol_family.as_str(),
        state.round,
        &pending_response,
        graph_pending_tool_call_meta,
        pending_results,
    );
    state.last_response = Some(enrich_response_with_tool_trace(
        pending_response,
        graph_pending_tool_call_meta,
        false,
        &state.runtime_metrics,
    ));
    rewind_round_for_post_approval_continuation(&mut state);

    PreparedApprovalResumeState {
        state,
        session_id,
        model_connection,
        execution_policy,
    }
}
