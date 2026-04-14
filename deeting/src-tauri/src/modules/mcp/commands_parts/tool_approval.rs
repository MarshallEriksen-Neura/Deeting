use super::{
    runtime::{
        approve_mcp_tool_inner_with_context_and_mode, reject_mcp_tool_inner_with_mode,
        ApprovePersistMode, RejectPersistMode,
    },
    support::*,
};
use crate::modules::desktop_runtime::runtime::{
    apply_rejected_tool_result_to_execution_graph_value, delete_execution_graph_runtime_context,
    list_canonical_pending_local_approval_snapshots, load_execution_graph_snapshot,
    load_suspended_chat_tool_execution_for_resume, mark_approval_gate_approving,
    materialize_pending_local_approval_from_runtime_context, persist_execution_graph_snapshot,
    persist_suspended_execution_graph_runtime, project_local_chat_approval_state_payload,
    recover_local_chat_execution_from_action, resume_suspended_chat_tool_execution_after_approval,
    InFlightExecutionStage,
};
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::mcp::policy::PersistedApprovalAction;
use crate::modules::mcp::risk::approval_classes_from_key;
use std::collections::HashSet;

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

fn require_approval_token(value: Option<String>) -> Result<String, String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .ok_or_else(|| "approval token is required".to_string())
}

fn resolve_requested_execution_graph_id(
    requested_execution_graph_id: Option<&str>,
    pending_execution_graph_id: Option<&str>,
) -> Option<String> {
    requested_execution_graph_id
        .and_then(|value| {
            let normalized = value.trim();
            (!normalized.is_empty()).then(|| normalized.to_string())
        })
        .or_else(|| {
            pending_execution_graph_id.and_then(|value| {
                let normalized = value.trim();
                (!normalized.is_empty()).then(|| normalized.to_string())
            })
        })
}

fn is_idempotent_post_approval_error(error: &str) -> bool {
    matches!(
        error.trim(),
        "pending tool call not found" | "pending tool call already consumed"
    )
}

pub(crate) async fn approve_mcp_tool_payload(
    app: &tauri::AppHandle,
    state: &crate::state::AppState,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
    approval_mode: Option<&str>,
    call_id: Option<&str>,
    execution_token: Option<&str>,
) -> Result<Value, String> {
    let token = approval_token.trim();
    if token.is_empty() {
        return Err("approval token is required".to_string());
    }
    let materialized_pending = materialize_pending_local_approval_from_runtime_context(
        state,
        token,
        execution_graph_execution_id,
    )
    .await?;
    let pending_before_approval = state
        .mcp
        .approvals
        .pending_tool_calls
        .read()
        .await
        .get(token)
        .cloned()
        .or(materialized_pending);
    let approval_context = state
        .mcp
        .build_approval_context(call_id, execution_token, None);
    let persist_mode = parse_approve_persist_mode(approval_mode.map(str::to_string));
    let requested_execution_id = resolve_requested_execution_graph_id(
        execution_graph_execution_id,
        pending_before_approval
            .as_ref()
            .and_then(|pending| pending.execution_graph_execution_id.as_deref()),
    );

    if let Some(execution_id) = requested_execution_id.as_deref() {
        if let Some(mut suspended) =
            load_suspended_chat_tool_execution_for_resume(state, token, Some(execution_id)).await?
        {
            if let Some(pending) = pending_before_approval.as_ref() {
                let resolved_call_id = pending.call_id.as_deref().or(call_id);
                let _ = mark_approval_gate_approving(&mut suspended, resolved_call_id);
                let _ = suspended.set_pending_approval_status(token, "approving");
                if let Err(err) = persist_suspended_execution_graph_runtime(
                    state.mcp.store.as_ref(),
                    &suspended,
                    suspended.pending_approvals(),
                    "desktop_local_chat_approval_approving",
                    "active",
                    InFlightExecutionStage::WaitingApproval,
                    None,
                )
                .await
                {
                    log::warn!(
                        "persist approving execution graph failed approval_token={} err={}",
                        token,
                        err
                    );
                }
            }
        }
    }

    let approved = match approve_mcp_tool_inner_with_context_and_mode(
        &approval_context,
        Some(&state.mcp),
        state.mcp.store.as_ref(),
        state.mcp.approvals.pending_tool_calls.as_ref(),
        token,
        persist_mode,
    )
    .await
    {
        Ok(approved) => approved,
        Err(err) => {
            if is_idempotent_post_approval_error(err.as_str()) {
                if let Some(execution_id) = requested_execution_id.as_deref() {
                    if let Some(payload) = project_local_chat_approval_state_payload(
                        state,
                        execution_id,
                        Some(err.as_str()),
                    )
                    .await?
                    {
                        return Ok(payload);
                    }
                }
            }
            return Err(err);
        }
    };

    if let Some(resumed) = resume_suspended_chat_tool_execution_after_approval(
        app,
        state,
        token,
        &approved,
        pending_before_approval
            .as_ref()
            .and_then(|pending| pending.call_id.as_deref()),
        requested_execution_id.as_deref(),
    )
    .await?
    {
        return Ok(resumed);
    }

    if let Some(execution_id) = requested_execution_id {
        if let Some(mut payload) = project_local_chat_approval_state_payload(
            state,
            execution_id.as_str(),
            Some("canonical waiting approval existed, but post-approval continuation could not be resumed"),
        )
        .await?
        {
            if let Some(object) = payload.as_object_mut() {
                object.insert(
                    "approved_tool_result".to_string(),
                    approved.clone(),
                );
            }
            return Ok(payload);
        }

        return Ok(serde_json::json!({
            "status": "LOCAL_CHAT_RESUME_FAILED",
            "approved_tool_result": approved,
            "continuation_blocks": [],
            "execution_graph_execution_id": execution_id,
            "error": "canonical waiting approval existed, but post-approval continuation could not be resumed",
        }));
    }

    Ok(approved)
}

pub(crate) async fn reject_mcp_tool_payload(
    state: &crate::state::AppState,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
    reject_mode: Option<&str>,
) -> Result<Value, String> {
    let token = approval_token.trim();
    if token.is_empty() {
        return Err("approval token is required".to_string());
    }
    let materialized_pending = materialize_pending_local_approval_from_runtime_context(
        state,
        token,
        execution_graph_execution_id,
    )
    .await?;
    let pending_before_reject = state
        .mcp
        .approvals
        .pending_tool_calls
        .read()
        .await
        .get(token)
        .cloned()
        .or(materialized_pending);
    reject_mcp_tool_inner_with_mode(
        Some(state.mcp.store.as_ref()),
        state.mcp.approvals.pending_tool_calls.as_ref(),
        token,
        parse_reject_persist_mode(reject_mode.map(str::to_string)),
    )
    .await?;
    let requested_execution_id = resolve_requested_execution_graph_id(
        execution_graph_execution_id,
        pending_before_reject
            .as_ref()
            .and_then(|pending| pending.execution_graph_execution_id.as_deref()),
    );
    let persisted_graph = if let Some(execution_id) = requested_execution_id.as_deref() {
        load_execution_graph_snapshot(state.mcp.store.as_ref(), execution_id)
            .await
            .map_err(to_string)?
    } else {
        None
    };
    if let Some(mut execution_graph) = persisted_graph {
        let execution_id = execution_graph
            .get("execution_id")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        apply_rejected_tool_result_to_execution_graph_value(
            &mut execution_graph,
            execution_id.as_deref(),
            pending_before_reject
                .as_ref()
                .and_then(|pending| pending.call_id.as_deref()),
            "User rejected tool execution",
        );
        if let Err(err) = persist_execution_graph_snapshot(
            state.mcp.store.as_ref(),
            &execution_graph,
            pending_before_reject
                .as_ref()
                .and_then(|pending| pending.session_id.as_deref())
                .unwrap_or("unknown"),
            "desktop_local_chat_rejected",
            None,
            Some("cancelled"),
        )
        .await
        {
            log::warn!(
                "persist rejected execution graph failed approval_token={} err={}",
                token,
                err
            );
        }
        if let Some(execution_id) = execution_id.as_deref() {
            if let Err(err) =
                delete_execution_graph_runtime_context(state.mcp.store.as_ref(), execution_id).await
            {
                log::warn!(
                    "delete_execution_graph_runtime_context failed execution_id={} err={}",
                    execution_id,
                    err
                );
            }
        }
        return Ok(serde_json::json!({
            "status": "LOCAL_CHAT_REJECTED",
            "execution_graph": execution_graph,
            "execution_graph_execution_id": execution_id,
            "execution_graph_gate_node_id": pending_before_reject
                .as_ref()
                .and_then(|pending| pending.execution_graph_gate_node_id.clone()),
            "execution_graph_tool_node_id": pending_before_reject
                .as_ref()
                .and_then(|pending| pending.execution_graph_tool_node_id.clone()),
        }));
    }

    Ok(serde_json::json!({
        "status": "REJECTED",
    }))
}

#[cfg(test)]
pub(crate) async fn list_pending_mcp_approvals_inner(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    session_id: Option<&str>,
) -> Vec<Value> {
    list_pending_mcp_approvals_with_graph_inner(None, pending_tool_calls, None, session_id).await
}

pub(crate) async fn list_pending_mcp_approvals_with_graph_inner(
    store: Option<&crate::modules::mcp::store::McpStore>,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    _suspended_local_chat_executions: Option<
        &tokio::sync::RwLock<
            HashMap<String, crate::modules::desktop_runtime::runtime::SuspendedChatToolExecution>,
        >,
    >,
    session_id: Option<&str>,
) -> Vec<Value> {
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let session_id = session_id.map(str::trim).filter(|value| !value.is_empty());

    let mut approvals = if let Some(store) = store {
        list_canonical_pending_local_approval_snapshots(store, session_id)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let canonical_tokens = approvals
        .iter()
        .filter_map(|value| {
            value
                .get("approval_token")
                .and_then(serde_json::Value::as_str)
        })
        .map(str::to_string)
        .collect::<HashSet<_>>();

    let pending = pending_tool_calls.read().await;
    for (approval_token, pending) in pending.iter() {
        if canonical_tokens.contains(approval_token) {
            continue;
        }
        if pending.expires_at_unix_ms <= now as i128 {
            continue;
        }

        if let Some(expected_session_id) = session_id {
            if pending.session_id.as_deref() != Some(expected_session_id) {
                continue;
            }
        }

        approvals.push(serde_json::json!({
            "status": "REQUIRES_APPROVAL",
            "approval_status": pending.approval_status.clone().unwrap_or_else(|| "waiting_approval".to_string()),
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
            "execution_graph_execution_id": pending.execution_graph_execution_id.clone(),
            "execution_graph_gate_node_id": pending.execution_graph_gate_node_id.clone(),
            "execution_graph_tool_node_id": pending.execution_graph_tool_node_id.clone(),
        }));
    }

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
pub async fn list_tool_approval_rules(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let rows = state
        .mcp
        .store
        .list_tool_approval_rules()
        .await
        .map_err(to_string)?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let (operation_class, target_class, boundary_class) =
                approval_classes_from_key(&row.key);
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
pub async fn reset_tool_approval_learning(state: State<'_, AppState>) -> Result<u64, String> {
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
    Ok(list_pending_mcp_approvals_with_graph_inner(
        Some(state.mcp.store.as_ref()),
        state.mcp.approvals.pending_tool_calls.as_ref(),
        Some(state.mcp.approvals.suspended_local_chat_executions.as_ref()),
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
    execution_graph_execution_id: Option<String>,
    #[allow(non_snake_case)] executionGraphExecutionId: Option<String>,
    approval_mode: Option<String>,
    #[allow(non_snake_case)] approvalMode: Option<String>,
    call_id: Option<String>,
    #[allow(non_snake_case)] callId: Option<String>,
    execution_token: Option<String>,
    #[allow(non_snake_case)] executionToken: Option<String>,
) -> Result<Value, String> {
    let token = require_approval_token(approval_token.or(approvalToken))?;
    approve_mcp_tool_payload(
        &app,
        &state,
        &token,
        execution_graph_execution_id
            .or(executionGraphExecutionId)
            .as_deref(),
        approval_mode.or(approvalMode).as_deref(),
        call_id.or(callId).as_deref(),
        execution_token.or(executionToken).as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn reject_mcp_tool(
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    execution_graph_execution_id: Option<String>,
    #[allow(non_snake_case)] executionGraphExecutionId: Option<String>,
    reject_mode: Option<String>,
    #[allow(non_snake_case)] rejectMode: Option<String>,
) -> Result<Value, String> {
    let token = require_approval_token(approval_token.or(approvalToken))?;
    reject_mcp_tool_payload(
        &state,
        &token,
        execution_graph_execution_id
            .or(executionGraphExecutionId)
            .as_deref(),
        reject_mode.or(rejectMode).as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn recover_local_chat_execution(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    execution_graph_execution_id: Option<String>,
    #[allow(non_snake_case)] executionGraphExecutionId: Option<String>,
    action: Option<String>,
) -> Result<Value, String> {
    let execution_id = execution_graph_execution_id
        .or(executionGraphExecutionId)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "execution_graph_execution_id is required".to_string())?;
    let action = action
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "action is required".to_string())?;
    recover_local_chat_execution_from_action(&app, &state, execution_id.as_str(), action.as_str())
        .await
}

#[cfg(test)]
mod tests {
    use super::resolve_requested_execution_graph_id;

    #[test]
    fn resolve_requested_execution_graph_id_prefers_explicit_request() {
        assert_eq!(
            resolve_requested_execution_graph_id(
                Some(" graph-explicit-1 "),
                Some("graph-pending-1")
            ),
            Some("graph-explicit-1".to_string())
        );
    }

    #[test]
    fn resolve_requested_execution_graph_id_falls_back_to_pending_value() {
        assert_eq!(
            resolve_requested_execution_graph_id(Some("  "), Some(" graph-pending-1 ")),
            Some("graph-pending-1".to_string())
        );
    }

    #[test]
    fn resolve_requested_execution_graph_id_returns_none_when_both_missing() {
        assert_eq!(resolve_requested_execution_graph_id(None, Some(" ")), None);
    }
}
