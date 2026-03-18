use super::{
    runtime::{approve_mcp_tool_inner_with_context, reject_mcp_tool_inner},
    support::*,
};
use crate::modules::desktop_runtime::runtime::resume_suspended_local_chat_after_approval;

pub(crate) async fn list_pending_mcp_approvals_inner(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    session_id: Option<&str>,
) -> Vec<Value> {
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let session_id = session_id
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let pending = pending_tool_calls.read().await;
    let mut approvals = pending
        .iter()
        .filter_map(|(approval_token, pending)| {
            if pending.expires_at_unix_ms <= now as i128 {
                return None;
            }

            if let Some(expected_session_id) = session_id {
                if pending.session_id.as_deref() != Some(expected_session_id) {
                    return None;
                }
            }

            Some(serde_json::json!({
                "status": "REQUIRES_APPROVAL",
                "approval_token": approval_token,
                "tool_id": pending.tool_id.clone(),
                "tool_name": pending.tool_name.clone(),
                "arguments": pending.arguments.clone(),
                "description": pending.description.clone(),
                "risk_level": pending.risk_level.clone().unwrap_or_else(|| "HIGH".to_string()),
                "risk_reasons": pending.risk_reasons.clone(),
                "call_id": pending.call_id.clone(),
                "execution_token": pending.execution_token.clone(),
                "session_id": pending.session_id.clone(),
                "created_at_unix_ms": pending.created_at_unix_ms,
                "expires_at_unix_ms": pending.expires_at_unix_ms,
                "expires_in_ms": pending.expires_at_unix_ms.saturating_sub(now as i128),
            }))
        })
        .collect::<Vec<_>>();

    approvals.sort_by(|left, right| {
        let left_created = left
            .get("created_at_unix_ms")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or_default();
        let right_created = right
            .get("created_at_unix_ms")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or_default();
        right_created.cmp(&left_created)
    });

    approvals
}

#[tauri::command]
pub async fn list_pending_mcp_approvals(
    state: State<'_, AppState>,
    session_id: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
) -> Result<Vec<Value>, String> {
    Ok(
        list_pending_mcp_approvals_inner(
            state.mcp.approvals.pending_tool_calls.as_ref(),
            session_id.or(sessionId).as_deref(),
        )
        .await,
    )
}

#[tauri::command]
pub async fn approve_mcp_tool(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    call_id: Option<String>,
    #[allow(non_snake_case)] callId: Option<String>,
    execution_token: Option<String>,
    #[allow(non_snake_case)] executionToken: Option<String>,
) -> Result<Value, String> {
    let token = approval_token
        .or(approvalToken)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "approval token is required".to_string())?;
    let approval_context = state.mcp.build_approval_context(
        call_id.or(callId).as_deref(),
        execution_token.or(executionToken).as_deref(),
        None,
    );

    let approved = approve_mcp_tool_inner_with_context(
        &approval_context,
        Some(&state.mcp),
        state.mcp.store.as_ref(),
        state.mcp.approvals.pending_tool_calls.as_ref(),
        &token,
    )
    .await?;

    if let Some(resumed) =
        resume_suspended_local_chat_after_approval(&app, &state, &token, &approved).await?
    {
        return Ok(resumed);
    }

    Ok(approved)
}

#[tauri::command]
pub async fn reject_mcp_tool(
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
) -> Result<(), String> {
    let token = approval_token
        .or(approvalToken)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "approval token is required".to_string())?;
    reject_mcp_tool_inner(state.mcp.approvals.pending_tool_calls.as_ref(), &token).await;
    state
        .mcp
        .approvals
        .suspended_local_chat_executions
        .write()
        .await
        .remove(&token);
    Ok(())
}
