use super::{
    serialize_inflight_runtime_context, InFlightExecutionStage, PersistedChatToolRuntimeContext,
};
use crate::modules::desktop_runtime::runtime::persist_execution_graph_runtime_context;
use crate::state::AppState;

pub(super) async fn persist_resume_failed_runtime_context(
    app_state: &AppState,
    session_id: &str,
    execution_id: Option<&str>,
    resume_gate_node_id: &str,
    resume_call_id: &str,
    failed_chat_runtime: &PersistedChatToolRuntimeContext,
    error_message: &str,
) {
    let Some(execution_id) = execution_id else {
        return;
    };

    let failed_context = serialize_inflight_runtime_context(
        InFlightExecutionStage::ResumeFailed,
        Some(resume_gate_node_id.to_string()),
        Some(resume_call_id.to_string()),
        true,
        Vec::new(),
        Some(failed_chat_runtime.clone()),
        session_id,
        failed_chat_runtime.trace_id.as_str(),
        failed_chat_runtime.request_id.as_deref(),
        Some(execution_id),
        Some(error_message),
    );

    if let Err(persist_err) = persist_execution_graph_runtime_context(
        app_state.mcp.store.as_ref(),
        execution_id,
        &failed_context,
    )
    .await
    {
        log::warn!(
            "persist_execution_graph_runtime_context failed execution_id={} err={}",
            execution_id,
            persist_err
        );
    }
}
