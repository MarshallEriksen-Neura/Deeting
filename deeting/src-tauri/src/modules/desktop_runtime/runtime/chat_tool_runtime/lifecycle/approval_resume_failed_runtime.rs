use super::approval_failed_payload::build_local_chat_resume_failed_payload;
use super::approval_resume_failed_persistence::persist_resume_failed_runtime_context;
use super::PersistedChatToolRuntimeContext;
use crate::modules::desktop_runtime::runtime::persist_execution_graph_snapshot;
use crate::state::AppState;

pub(super) async fn handle_resume_failed_output(
    app_state: &AppState,
    session_id: &str,
    consumed_approval_token: Option<&str>,
    resolved_gate_node_id: &str,
    resolved_call_id: &str,
    approved_tool_result: &serde_json::Value,
    post_approval_graph: &serde_json::Value,
    root_execution_id: Option<&str>,
    failed_chat_runtime: &PersistedChatToolRuntimeContext,
    error_message: &str,
) -> Result<serde_json::Value, String> {
    if let Err(persist_err) = persist_execution_graph_snapshot(
        app_state.mcp.store.as_ref(),
        post_approval_graph,
        session_id,
        "desktop_local_chat_resume_failed",
        None,
        Some("failed"),
    )
    .await
    {
        log::warn!(
            "persist_execution_graph_snapshot failed session={} err={}",
            session_id,
            persist_err
        );
    }
    persist_resume_failed_runtime_context(
        app_state,
        session_id,
        root_execution_id,
        resolved_gate_node_id,
        resolved_call_id,
        failed_chat_runtime,
        error_message,
    )
    .await;

    Ok(build_local_chat_resume_failed_payload(
        consumed_approval_token.unwrap_or_default(),
        Some(resolved_gate_node_id),
        Some(resolved_call_id),
        approved_tool_result,
        post_approval_graph,
        root_execution_id,
        "LOCAL_CHAT_RESUME_FAILED",
        error_message,
        true,
    ))
}
