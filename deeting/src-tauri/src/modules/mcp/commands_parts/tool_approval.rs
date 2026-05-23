use super::{
    runtime::{ApprovePersistMode, RejectPersistMode},
    support::*,
};
use crate::modules::desktop_runtime::runtime::runtime_transition::trace_contract::runtime_transition_trace_verdict_response;
use crate::modules::desktop_runtime::runtime::{
    dispatch_local_chat_execution_run_command, list_canonical_pending_local_approval_snapshots,
    list_execution_graph_snapshots_for_session, load_execution_graph_snapshot, ExecutionRunCommand,
};
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::mcp::policy::PersistedApprovalAction;
use crate::modules::mcp::risk::approval_classes_from_key;

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

fn require_session_id(
    session_id: Option<String>,
    session_id_camel: Option<String>,
) -> Result<String, String> {
    session_id
        .or(session_id_camel)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "session_id is required".to_string())
}
fn require_execution_graph_execution_id(
    execution_graph_execution_id: Option<String>,
    execution_graph_execution_id_camel: Option<String>,
) -> Result<String, String> {
    execution_graph_execution_id
        .or(execution_graph_execution_id_camel)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "execution_graph_execution_id is required".to_string())
}

fn resolve_requested_execution_graph_id(
    explicit_request: Option<&str>,
    pending_value: Option<&str>,
) -> Option<String> {
    explicit_request
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            pending_value
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .map(str::to_string)
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
    let requested_execution_graph_id =
        resolve_requested_execution_graph_id(execution_graph_execution_id, None);
    dispatch_local_chat_execution_run_command(
        Some(app),
        state,
        ExecutionRunCommand::ApproveGate {
            approval_token: approval_token.trim().to_string(),
            execution_graph_execution_id: requested_execution_graph_id,
            approval_context: state
                .mcp
                .build_approval_context(call_id, execution_token, None),
            persist_mode: parse_approve_persist_mode(approval_mode.map(str::to_string)),
        },
    )
    .await
}

pub(crate) async fn reject_mcp_tool_payload(
    state: &crate::state::AppState,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
    reject_mode: Option<&str>,
) -> Result<Value, String> {
    let requested_execution_graph_id =
        resolve_requested_execution_graph_id(execution_graph_execution_id, None);
    dispatch_local_chat_execution_run_command(
        None,
        state,
        ExecutionRunCommand::RejectGate {
            approval_token: approval_token.trim().to_string(),
            execution_graph_execution_id: requested_execution_graph_id,
            reject_mode: parse_reject_persist_mode(reject_mode.map(str::to_string)),
        },
    )
    .await
}

#[cfg(test)]
pub(crate) async fn list_pending_mcp_approvals_inner(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    session_id: Option<&str>,
) -> Vec<Value> {
    list_pending_mcp_approvals_with_graph_inner(None, pending_tool_calls, session_id).await
}

pub(crate) async fn list_pending_mcp_approvals_with_graph_inner(
    store: Option<&crate::modules::mcp::store::McpStore>,
    _pending_tool_calls: &tokio::sync::RwLock<
        HashMap<String, crate::modules::mcp::PendingToolCall>,
    >,
    session_id: Option<&str>,
) -> Vec<Value> {
    let Some(store) = store else {
        return Vec::new();
    };
    let session_id = session_id.map(str::trim).filter(|value| !value.is_empty());
    list_canonical_pending_local_approval_snapshots(store, session_id)
        .await
        .unwrap_or_default()
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
    let requested_execution_graph_id = resolve_requested_execution_graph_id(
        execution_graph_execution_id.as_deref(),
        executionGraphExecutionId.as_deref(),
    );
    approve_mcp_tool_payload(
        &app,
        &state,
        &token,
        requested_execution_graph_id.as_deref(),
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
    let requested_execution_graph_id = resolve_requested_execution_graph_id(
        execution_graph_execution_id.as_deref(),
        executionGraphExecutionId.as_deref(),
    );
    reject_mcp_tool_payload(
        &state,
        &token,
        requested_execution_graph_id.as_deref(),
        reject_mode.or(rejectMode).as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn list_local_runtime_transition_trace_verdicts(
    state: State<'_, AppState>,
    session_id: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Value>, String> {
    let session_id = require_session_id(session_id, sessionId)?;
    let execution_graphs =
        list_execution_graph_snapshots_for_session(state.mcp.store.as_ref(), &session_id, limit)
            .await
            .map_err(to_string)?;

    Ok(execution_graphs
        .iter()
        .map(|execution_graph| {
            let execution_id = execution_graph
                .get("execution_id")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            runtime_transition_trace_verdict_response(execution_id, execution_graph)
        })
        .collect())
}
#[tauri::command]
pub async fn get_local_runtime_transition_trace_verdicts(
    state: State<'_, AppState>,
    execution_graph_execution_id: Option<String>,
    #[allow(non_snake_case)] executionGraphExecutionId: Option<String>,
) -> Result<Value, String> {
    let execution_id = require_execution_graph_execution_id(
        execution_graph_execution_id,
        executionGraphExecutionId,
    )?;
    let execution_graph = load_execution_graph_snapshot(state.mcp.store.as_ref(), &execution_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("execution graph not found: {execution_id}"))?;

    Ok(runtime_transition_trace_verdict_response(
        &execution_id,
        &execution_graph,
    ))
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
    dispatch_local_chat_execution_run_command(
        Some(&app),
        &state,
        ExecutionRunCommand::RecoverRun {
            execution_graph_execution_id: execution_id,
            action,
        },
    )
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
