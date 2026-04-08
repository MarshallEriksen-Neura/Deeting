use super::{
    runtime::{
        approve_mcp_tool_inner_with_context_and_mode, reject_mcp_tool_inner_with_mode,
        ApprovePersistMode, RejectPersistMode,
    },
    support::*,
};
use crate::modules::desktop_runtime::runtime::{
    apply_rejected_tool_result_to_execution_graph,
    apply_rejected_tool_result_to_execution_graph_value, delete_execution_graph_runtime_context,
    load_execution_graph_snapshot, load_execution_graph_snapshot_by_approval_token,
    persist_execution_graph_snapshot, resume_suspended_local_chat_after_approval,
};
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::mcp::policy::PersistedApprovalAction;

const LEGACY_SUSPENDED_REJECT_FALLBACK_WINDOW_MS: i128 = 5 * 60 * 1000;

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
    let pending_before_approval = state
        .mcp
        .approvals
        .pending_tool_calls
        .read()
        .await
        .get(token)
        .cloned();
    let approval_context = state
        .mcp
        .build_approval_context(call_id, execution_token, None);
    let persist_mode = parse_approve_persist_mode(approval_mode.map(str::to_string));

    let approved = approve_mcp_tool_inner_with_context_and_mode(
        &approval_context,
        Some(&state.mcp),
        state.mcp.store.as_ref(),
        state.mcp.approvals.pending_tool_calls.as_ref(),
        token,
        persist_mode,
    )
    .await?;

    if let Some(resumed) = resume_suspended_local_chat_after_approval(
        app,
        state,
        token,
        &approved,
        pending_before_approval
            .as_ref()
            .and_then(|pending| pending.call_id.as_deref()),
        execution_graph_execution_id,
        pending_before_approval
            .as_ref()
            .map(|pending| pending.created_at_unix_ms),
    )
    .await?
    {
        return Ok(resumed);
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
    let pending_before_reject = state
        .mcp
        .approvals
        .pending_tool_calls
        .read()
        .await
        .get(token)
        .cloned();
    reject_mcp_tool_inner_with_mode(
        Some(state.mcp.store.as_ref()),
        state.mcp.approvals.pending_tool_calls.as_ref(),
        token,
        parse_reject_persist_mode(reject_mode.map(str::to_string)),
    )
    .await?;
    let legacy_fallback_allowed = pending_before_reject
        .as_ref()
        .map(|pending| {
            let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
            now.saturating_sub(pending.created_at_unix_ms)
                <= LEGACY_SUSPENDED_REJECT_FALLBACK_WINDOW_MS
        })
        .unwrap_or(false);

    let requested_execution_id = execution_graph_execution_id
        .map(str::to_string)
        .or_else(|| {
            pending_before_reject
                .as_ref()
                .and_then(|pending| pending.execution_graph_execution_id.clone())
        });
    let mut persisted_graph = if let Some(execution_id) = requested_execution_id.as_deref() {
        load_execution_graph_snapshot(state.mcp.store.as_ref(), execution_id)
            .await
            .map_err(to_string)?
    } else {
        None
    };
    if persisted_graph.is_none() {
        persisted_graph =
            load_execution_graph_snapshot_by_approval_token(state.mcp.store.as_ref(), token)
                .await
                .map_err(to_string)?;
    }

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

    let mut suspended = if legacy_fallback_allowed {
        state
            .mcp
            .approvals
            .suspended_local_chat_executions
            .write()
            .await
            .remove(token)
    } else {
        None
    };
    if let Some(ref mut suspended) = suspended {
        apply_rejected_tool_result_to_execution_graph(
            suspended,
            pending_before_reject
                .as_ref()
                .and_then(|pending| pending.call_id.as_deref()),
            "User rejected tool execution",
        );
        if let Err(err) = persist_execution_graph_snapshot(
            state.mcp.store.as_ref(),
            suspended.execution_graph(),
            pending_before_reject
                .as_ref()
                .and_then(|pending| pending.session_id.as_deref())
                .unwrap_or("unknown"),
            "desktop_local_chat_rejected_legacy_fallback",
            None,
            Some("cancelled"),
        )
        .await
        {
            log::warn!(
                "persist rejected legacy fallback execution graph failed approval_token={} err={}",
                token,
                err
            );
        }
        if let Some(execution_id) = suspended.graph_execution_id() {
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
            "execution_graph": suspended.execution_graph().clone(),
            "execution_graph_execution_id": suspended.graph_execution_id(),
            "execution_graph_gate_node_id": suspended.pending_gate_node_id(),
            "execution_graph_tool_node_id": suspended.pending_tool_node_id(),
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
    suspended_local_chat_executions: Option<
        &tokio::sync::RwLock<
            HashMap<String, crate::modules::desktop_runtime::runtime::SuspendedLocalChatExecution>,
        >,
    >,
    session_id: Option<&str>,
) -> Vec<Value> {
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let session_id = session_id.map(str::trim).filter(|value| !value.is_empty());

    let pending = pending_tool_calls.read().await;
    let suspended = if let Some(store) = suspended_local_chat_executions {
        Some(store.read().await)
    } else {
        None
    };
    let mut approvals = Vec::new();
    for (approval_token, pending) in pending.iter() {
        if pending.expires_at_unix_ms <= now as i128 {
            continue;
        }

        if let Some(expected_session_id) = session_id {
            if pending.session_id.as_deref() != Some(expected_session_id) {
                continue;
            }
        }

        let graph_execution_id = suspended
            .as_ref()
            .and_then(|items| items.get(approval_token))
            .and_then(|suspended| suspended.graph_execution_id())
            .map(str::to_string)
            .or_else(|| pending.execution_graph_execution_id.clone());
        let persisted_graph =
            if let (Some(store), Some(execution_id)) = (store, graph_execution_id.as_deref()) {
                load_execution_graph_snapshot(store, execution_id)
                    .await
                    .ok()
                    .flatten()
            } else {
                None
            };
        let graph_gate_node_id = suspended
            .as_ref()
            .and_then(|items| items.get(approval_token))
            .map(|suspended| suspended.pending_gate_node_id().to_string())
            .or_else(|| {
                persisted_graph.as_ref().and_then(|graph| {
                    graph
                        .get("nodes")
                        .and_then(serde_json::Value::as_array)
                        .and_then(|nodes| {
                            nodes.iter().find(|node| {
                                node.get("node_type").and_then(serde_json::Value::as_str)
                                    == Some("approval_gate")
                            })
                        })
                        .and_then(|node| node.get("node_id"))
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string)
                })
            })
            .or_else(|| pending.execution_graph_gate_node_id.clone());
        let graph_tool_node_id = suspended
            .as_ref()
            .and_then(|items| items.get(approval_token))
            .map(|suspended| suspended.pending_tool_node_id().to_string())
            .or_else(|| {
                persisted_graph.as_ref().and_then(|graph| {
                    graph
                        .get("nodes")
                        .and_then(serde_json::Value::as_array)
                        .and_then(|nodes| {
                            nodes.iter().find(|node| {
                                node.get("node_type").and_then(serde_json::Value::as_str)
                                    == Some("tool_call")
                            })
                        })
                        .and_then(|node| node.get("node_id"))
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string)
                })
            })
            .or_else(|| pending.execution_graph_tool_node_id.clone());

        approvals.push(serde_json::json!({
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
            "execution_graph_execution_id": graph_execution_id,
            "execution_graph_gate_node_id": graph_gate_node_id,
            "execution_graph_tool_node_id": graph_tool_node_id,
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
