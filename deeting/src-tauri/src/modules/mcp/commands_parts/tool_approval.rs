use super::{
    runtime::{
        approve_mcp_tool_inner_with_context_and_mode, reject_mcp_tool_inner_with_mode,
        ApprovePersistMode, RejectPersistMode,
    },
    support::*,
};
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::desktop_runtime::runtime::resume_suspended_local_chat_after_approval;
use crate::modules::mcp::policy::PersistedApprovalAction;

fn parse_approve_persist_mode(value: Option<String>) -> ApprovePersistMode {
    match value
        .as_deref()
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(|candidate| candidate.to_ascii_lowercase())
        .as_deref()
    {
        Some("allow_always") => ApprovePersistMode::AllowAlways,
        _ => ApprovePersistMode::AllowOnce,
    }
}

fn parse_reject_persist_mode(value: Option<String>) -> RejectPersistMode {
    match value
        .as_deref()
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(|candidate| candidate.to_ascii_lowercase())
        .as_deref()
    {
        Some("deny_always") => RejectPersistMode::DenyAlways,
        _ => RejectPersistMode::RejectOnce,
    }
}

pub(crate) async fn list_pending_mcp_approvals_inner(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    session_id: Option<&str>,
) -> Vec<Value> {
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let session_id = session_id.map(str::trim).filter(|value| !value.is_empty());

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

fn build_tool_approval_rule_label(
    action: PersistedApprovalAction,
    operation_class: &str,
    target_class: &str,
    boundary_class: &str,
) -> String {
    (match action {
        PersistedApprovalAction::AllowOnce => {
            format!("Observed {} on {}", operation_class, target_class)
        }
        PersistedApprovalAction::AllowAlways => {
            format!("Always allow {} on {}", operation_class, target_class)
        }
        PersistedApprovalAction::DenyAlways => {
            format!("Always block {} on {}", operation_class, target_class)
        }
    }) + &format!(" ({boundary_class})")
}

#[tauri::command]
pub async fn list_tool_approval_rules(
    state: State<'_, AppState>,
) -> Result<Vec<Value>, String> {
    let rows = state
        .mcp
        .store
        .list_tool_approval_rules()
        .await
        .map_err(to_string)?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let mut parts = row.key.split('|');
            let _tool_fingerprint = parts.next();
            let operation_class = parts.next().unwrap_or("unknown").to_string();
            let target_class = parts.next().unwrap_or("unknown").to_string();
            let boundary_class = parts.next().unwrap_or("unknown").to_string();
            serde_json::json!({
                "key": row.key,
                "action": row.action.as_str(),
                "tool_name": row.tool_name,
                "tool_fingerprint": row.tool_fingerprint,
                "risk_level": row.risk_level,
                "auto_promoted": row.auto_promoted,
                "created_at_unix_ms": row.created_at_unix_ms,
                "updated_at_unix_ms": row.updated_at_unix_ms,
                "expires_at_unix_ms": row.expires_at_unix_ms,
                "approve_count": row.approve_count,
                "reject_count": row.reject_count,
                "last_approved_at_unix_ms": row.last_approved_at_unix_ms,
                "last_rejected_at_unix_ms": row.last_rejected_at_unix_ms,
                "half_life_days": row.half_life_days,
                "operation_class": operation_class,
                "target_class": target_class,
                "boundary_class": boundary_class,
                "display_label": build_tool_approval_rule_label(
                    row.action,
                    &operation_class,
                    &target_class,
                    &boundary_class,
                ),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn delete_tool_approval_rule(
    state: State<'_, AppState>,
    key: String,
) -> Result<bool, String> {
    state
        .mcp
        .store
        .delete_tool_approval_rule(&key)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn clear_tool_approval_rules(
    state: State<'_, AppState>,
    mode: Option<String>,
) -> Result<u64, String> {
    state
        .mcp
        .store
        .clear_tool_approval_rules(mode.as_deref())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn reset_tool_approval_learning(
    state: State<'_, AppState>,
) -> Result<u64, String> {
    state
        .mcp
        .store
        .reset_tool_approval_learning()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_tool_approval_learning_summary(
    state: State<'_, AppState>,
) -> Result<Vec<Value>, String> {
    let rows = state
        .mcp
        .store
        .get_tool_approval_learning_summary()
        .await
        .map_err(to_string)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "operation_class": row.operation_class,
                "target_class": row.target_class,
                "boundary_class": row.boundary_class,
                "observed_approvals": row.observed_approvals,
                "observed_rejections": row.observed_rejections,
                "auto_promoted_rules": row.auto_promoted_rules,
                "explicit_allow_rules": row.explicit_allow_rules,
                "explicit_deny_rules": row.explicit_deny_rules,
                "last_approved_at_unix_ms": row.last_approved_at_unix_ms,
                "last_rejected_at_unix_ms": row.last_rejected_at_unix_ms,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn list_pending_mcp_approvals(
    state: State<'_, AppState>,
    session_id: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
) -> Result<Vec<Value>, String> {
    Ok(list_pending_mcp_approvals_inner(
        state.mcp.approvals.pending_tool_calls.as_ref(),
        session_id.or(sessionId).as_deref(),
    )
    .await)
}

#[tauri::command]
pub async fn approve_mcp_tool(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    approval_mode: Option<String>,
    #[allow(non_snake_case)] approvalMode: Option<String>,
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
    let persist_mode = parse_approve_persist_mode(approval_mode.or(approvalMode));

    let approved = approve_mcp_tool_inner_with_context_and_mode(
        &approval_context,
        Some(&state.mcp),
        state.mcp.store.as_ref(),
        state.mcp.approvals.pending_tool_calls.as_ref(),
        &token,
        persist_mode,
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
    reject_mode: Option<String>,
    #[allow(non_snake_case)] rejectMode: Option<String>,
) -> Result<(), String> {
    let token = approval_token
        .or(approvalToken)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "approval token is required".to_string())?;
    reject_mcp_tool_inner_with_mode(
        Some(state.mcp.store.as_ref()),
        state.mcp.approvals.pending_tool_calls.as_ref(),
        &token,
        parse_reject_persist_mode(reject_mode.or(rejectMode)),
    )
    .await?;
    state
        .mcp
        .approvals
        .suspended_local_chat_executions
        .write()
        .await
        .remove(&token);
    Ok(())
}
