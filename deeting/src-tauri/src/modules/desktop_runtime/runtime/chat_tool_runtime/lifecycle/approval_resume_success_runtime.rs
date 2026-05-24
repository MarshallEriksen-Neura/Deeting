use super::super::tool_meta::build_effective_tool_call_meta;
use super::approval_payloads::build_local_chat_resumed_payload;
use super::approval_resume_waiting_recovery::build_waiting_payload_after_resume;
use super::{clear_execution_graph_runtime_context, persist_resumed_local_chat_assistant_message};
use crate::modules::mcp::commands::common_impl::LocalModelConnection;
use crate::state::AppState;

pub(super) async fn handle_resume_success_output(
    app_state: &AppState,
    session_id: &str,
    model_connection: &LocalModelConnection,
    response: &serde_json::Value,
    consumed_approval_token: Option<&str>,
    resolved_gate_node_id: &str,
    resolved_call_id: &str,
    approved_tool_result: &serde_json::Value,
    root_execution_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    if let Some(waiting_payload) = build_waiting_payload_after_resume(
        app_state,
        response,
        session_id,
        consumed_approval_token,
        resolved_gate_node_id,
        resolved_call_id,
        approved_tool_result,
    )
    .await?
    {
        return Ok(waiting_payload);
    }

    if let Err(err) = persist_resumed_local_chat_assistant_message(
        app_state,
        session_id,
        model_connection,
        response,
    )
    .await
    {
        log::warn!("{err}");
    }
    clear_execution_graph_runtime_context(app_state.mcp.store.as_ref(), root_execution_id).await;
    let continuation_meta = build_effective_tool_call_meta(response, &[]);
    Ok(build_local_chat_resumed_payload(
        consumed_approval_token.unwrap_or_default(),
        resolved_gate_node_id,
        resolved_call_id,
        approved_tool_result,
        response,
        &continuation_meta,
    ))
}
