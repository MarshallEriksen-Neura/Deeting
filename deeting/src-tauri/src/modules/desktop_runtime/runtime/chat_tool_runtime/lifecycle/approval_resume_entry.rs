use super::super::tool_meta::apply_approved_tool_result_to_execution_graph;
use super::approval_recovery::advance_local_chat_execution_from_graph_state;
use super::{load_suspended_chat_tool_execution_for_resume, SuspendedChatToolExecution};
use crate::state::AppState;
use tauri::AppHandle;

fn apply_approved_tool_result_to_suspended_round(
    suspended: &mut SuspendedChatToolExecution,
    approval_token: &str,
    call_id: Option<&str>,
    tool_result: &serde_json::Value,
) {
    apply_approved_tool_result_to_execution_graph(
        suspended,
        Some(approval_token),
        call_id,
        tool_result,
    );
}

pub(crate) async fn resume_suspended_chat_tool_execution_after_approval(
    app: &AppHandle,
    app_state: &AppState,
    approval_token: &str,
    tool_result: &serde_json::Value,
    call_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
) -> Result<Option<serde_json::Value>, String> {
    let mut suspended = if let Some(suspended) = load_suspended_chat_tool_execution_for_resume(
        app_state,
        approval_token,
        execution_graph_execution_id,
    )
    .await?
    {
        suspended
    } else {
        return Ok(None);
    };

    apply_approved_tool_result_to_suspended_round(
        &mut suspended,
        approval_token,
        call_id,
        tool_result,
    );
    if let Some(pending) = suspended
        .pending_approvals
        .iter_mut()
        .find(|pending| pending.approval_token.trim() == approval_token.trim())
    {
        pending.approval_status = Some("approved".to_string());
    }
    Ok(Some(
        advance_local_chat_execution_from_graph_state(
            app,
            app_state,
            suspended,
            Some(approval_token),
            call_id,
            tool_result,
        )
        .await?,
    ))
}
