use super::*;
use crate::modules::mcp::commands::runtime::approve_pending_tool_with_context_and_mode;
use crate::modules::mcp::commands::support::Value;
use crate::modules::mcp::policy::PersistedApprovalAction;

pub(crate) enum ExecutionRunCommand {
    ApproveGate {
        approval_token: String,
        execution_graph_execution_id: Option<String>,
        approval_context: crate::modules::mcp::ToolApprovalContext,
        persist_mode: crate::modules::mcp::commands::runtime::ApprovePersistMode,
    },
    RejectGate {
        approval_token: String,
        execution_graph_execution_id: Option<String>,
        reject_mode: crate::modules::mcp::commands::runtime::RejectPersistMode,
    },
    RecoverRun {
        execution_graph_execution_id: String,
        action: String,
    },
}

fn build_failed_approval_tool_result_payload(
    pending: Option<&crate::modules::mcp::PendingToolCall>,
    execution_graph_execution_id: Option<&str>,
    error: &str,
) -> Value {
    serde_json::json!({
        "error": error,
        "execution_graph_execution_id": execution_graph_execution_id,
        "execution_graph_gate_node_id": pending
            .and_then(|item| item.execution_graph_gate_node_id.clone()),
        "execution_graph_tool_node_id": pending
            .and_then(|item| item.execution_graph_tool_node_id.clone()),
    })
}

fn approved_tool_result_matches_pending_tool(
    pending: &crate::modules::mcp::PendingToolCall,
    approved_tool_result: &serde_json::Value,
) -> bool {
    let tool_name = pending.tool_name.trim();
    if tool_name.is_empty() {
        return false;
    }

    if let Some(content) = approved_tool_result
        .get("content")
        .and_then(serde_json::Value::as_array)
    {
        let has_browser_create_payload = content.iter().any(|item| {
            let text = item
                .get("text")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            text.contains("\"cdpUrl\"")
                || text.contains("\"liveViewUrl\"")
                || text.contains("\"interactiveLiveViewUrl\"")
        });
        if has_browser_create_payload {
            return tool_name.eq_ignore_ascii_case("firecrawl_browser_create");
        }
    }

    if approved_tool_result.get("tabId").is_some() && approved_tool_result.get("url").is_some() {
        return tool_name.eq_ignore_ascii_case("browser_open_tab")
            || tool_name.eq_ignore_ascii_case("firecrawl_browser_open_tab");
    }

    if approved_tool_result.get("documentReadyState").is_some()
        || approved_tool_result.get("mainText").is_some()
        || approved_tool_result.get("visibleText").is_some()
    {
        return tool_name.eq_ignore_ascii_case("browser_get_page_snapshot");
    }

    true
}

fn is_idempotent_post_approval_error(error: &str) -> bool {
    matches!(
        error.trim(),
        "pending tool call not found" | "pending tool call already consumed"
    )
}

async fn approve_local_chat_execution_gate_command(
    app: &tauri::AppHandle,
    state: &crate::state::AppState,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    persist_mode: crate::modules::mcp::commands::runtime::ApprovePersistMode,
) -> Result<Value, String> {
    let token = approval_token.trim();
    if token.is_empty() {
        return Err("approval token is required".to_string());
    }

    let requested_execution_id = execution_graph_execution_id
        .and_then(|value| {
            let normalized = value.trim();
            (!normalized.is_empty()).then(|| normalized.to_string())
        })
        .ok_or_else(|| "execution_graph_execution_id is required for approve gate".to_string())?;

    let pending_before_approval = materialize_pending_local_approval_from_runtime_context(
        state,
        token,
        Some(requested_execution_id.as_str()),
    )
    .await?;
    if let Some(mut suspended) = load_suspended_chat_tool_execution_for_resume(
        state,
        token,
        Some(requested_execution_id.as_str()),
    )
    .await?
    {
        if let Some(pending) = pending_before_approval.as_ref() {
            let resolved_call_id = pending
                .call_id
                .as_deref()
                .or(approval_context.call_id.as_deref());
            let _ = mark_approval_gate_approving(&mut suspended, Some(token), resolved_call_id);
            let _ = suspended.set_pending_approval_status(token, "approving");
            let persisted_pending_approvals = derive_pending_approvals_from_graph(&suspended);
            if let Err(err) = persist_suspended_execution_graph_runtime(
                state.mcp.store.as_ref(),
                &suspended,
                &persisted_pending_approvals,
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

    let Some(pending_for_execution) = pending_before_approval.clone() else {
        return Ok(serde_json::json!({
            "status": "LOCAL_CHAT_RESUME_FAILED",
            "approval_token": token,
            "approved_tool_result": serde_json::Value::Null,
            "continuation_blocks": [],
            "execution_graph_execution_id": requested_execution_id,
            "pending_approval_gate_ids": [],
            "next_pending_approval_tokens": [],
            "error_code": "LOCAL_TOOL_APPROVAL_MISSING_CANONICAL_PENDING",
            "error": "canonical pending approval was not found",
            "retryable": false,
        }));
    };

    let approved = match approve_pending_tool_with_context_and_mode(
        approval_context,
        Some(&state.mcp),
        state.mcp.store.as_ref(),
        state.mcp.approvals.pending_tool_calls.as_ref(),
        token,
        pending_for_execution,
        persist_mode,
    )
    .await
    {
        Ok(approved) => approved,
        Err(err) => {
            if is_idempotent_post_approval_error(err.as_str()) {
                if let Some(payload) = project_local_chat_approval_state_payload(
                    state,
                    requested_execution_id.as_str(),
                    Some(err.as_str()),
                )
                .await?
                {
                    return Ok(payload);
                }
            }

            let failed_tool_result = build_failed_approval_tool_result_payload(
                pending_before_approval.as_ref(),
                Some(requested_execution_id.as_str()),
                err.as_str(),
            );
            let error_tool_result = serde_json::json!({
                "error": err,
                "error_code": "LOCAL_TOOL_APPROVAL_FAILED",
                "status": "error",
                "retryable": true,
                "execution_graph_execution_id": requested_execution_id,
                "execution_graph_gate_node_id": pending_before_approval
                    .as_ref()
                    .and_then(|pending| pending.execution_graph_gate_node_id.clone()),
                "execution_graph_tool_node_id": pending_before_approval
                    .as_ref()
                    .and_then(|pending| pending.execution_graph_tool_node_id.clone()),
                "call_id": pending_before_approval
                    .as_ref()
                    .and_then(|pending| pending.call_id.clone()),
            });

            if let Some(resumed) = resume_suspended_chat_tool_execution_after_approval(
                app,
                state,
                token,
                &error_tool_result,
                pending_before_approval
                    .as_ref()
                    .and_then(|pending| pending.call_id.as_deref()),
                Some(requested_execution_id.as_str()),
            )
            .await?
            {
                return Ok(resumed);
            }

            if let Some(mut payload) = project_local_chat_approval_state_payload(
                state,
                requested_execution_id.as_str(),
                Some(err.as_str()),
            )
            .await?
            {
                if let Some(object) = payload.as_object_mut() {
                    object.insert(
                        "approved_tool_result".to_string(),
                        failed_tool_result.clone(),
                    );
                    object.insert(
                        "error_code".to_string(),
                        serde_json::json!("LOCAL_TOOL_APPROVAL_FAILED"),
                    );
                    object.insert("error".to_string(), serde_json::json!(err.as_str()));
                    object.insert("retryable".to_string(), serde_json::json!(true));
                }
                return Ok(payload);
            }

            return Ok(serde_json::json!({
                "status": "LOCAL_CHAT_RESUME_FAILED",
                "approval_token": token,
                "resolved_gate_node_id": pending_before_approval
                    .as_ref()
                    .and_then(|pending| pending.execution_graph_gate_node_id.clone()),
                "resolved_call_id": pending_before_approval
                    .as_ref()
                    .and_then(|pending| pending.call_id.clone()),
                "approved_tool_result": failed_tool_result,
                "continuation_blocks": [],
                "execution_graph_execution_id": requested_execution_id,
                "pending_approval_gate_ids": [],
                "next_pending_approval_tokens": [],
                "error_code": "LOCAL_TOOL_APPROVAL_FAILED",
                "error": err,
                "retryable": true,
            }));
        }
    };

    if let Some(pending) = pending_before_approval.as_ref() {
        if !approved_tool_result_matches_pending_tool(pending, &approved) {
            log::error!(
                "approval_command_mismatched_result approval_token={} pending_tool={} pending_call_id={:?} pending_gate={:?} approved_result={}",
                token,
                pending.tool_name,
                pending.call_id,
                pending.execution_graph_gate_node_id,
                serde_json::to_string(&approved)
                    .unwrap_or_else(|_| "<serialize failed>".to_string())
            );
            return Ok(serde_json::json!({
                "status": "LOCAL_CHAT_RESUME_FAILED",
                "approval_token": token,
                "approved_tool_result": approved,
                "continuation_blocks": [],
                "execution_graph_execution_id": requested_execution_id,
                "pending_approval_gate_ids": [],
                "next_pending_approval_tokens": [],
                "error_code": "LOCAL_TOOL_APPROVAL_RESULT_MISMATCH",
                "error": format!(
                    "approved tool result did not match canonical pending tool '{}'",
                    pending.tool_name
                ),
                "retryable": false,
            }));
        }
    }

    if let Some(resumed) = resume_suspended_chat_tool_execution_after_approval(
        app,
        state,
        token,
        &approved,
        pending_before_approval
            .as_ref()
            .and_then(|pending| pending.call_id.as_deref()),
        Some(requested_execution_id.as_str()),
    )
    .await?
    {
        return Ok(resumed);
    }

    if let Some(mut payload) = project_local_chat_approval_state_payload(
        state,
        requested_execution_id.as_str(),
        Some("canonical waiting approval existed, but post-approval continuation could not be resumed"),
    )
    .await?
    {
        if let Some(object) = payload.as_object_mut() {
            object.insert("approved_tool_result".to_string(), approved.clone());
        }
        return Ok(payload);
    }

    Ok(serde_json::json!({
        "status": "LOCAL_CHAT_RESUME_FAILED",
        "approved_tool_result": approved,
        "continuation_blocks": [],
        "execution_graph_execution_id": requested_execution_id,
        "error": "canonical waiting approval existed, but post-approval continuation could not be resumed",
    }))
}

async fn reject_local_chat_execution_gate_command(
    state: &crate::state::AppState,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
    reject_mode: crate::modules::mcp::commands::runtime::RejectPersistMode,
) -> Result<Value, String> {
    let token = approval_token.trim();
    if token.is_empty() {
        return Err("approval token is required".to_string());
    }

    let requested_execution_id = execution_graph_execution_id
        .and_then(|value| {
            let normalized = value.trim();
            (!normalized.is_empty()).then(|| normalized.to_string())
        })
        .ok_or_else(|| "execution_graph_execution_id is required for reject gate".to_string())?;

    let pending_before_reject = materialize_pending_local_approval_from_runtime_context(
        state,
        token,
        Some(requested_execution_id.as_str()),
    )
    .await?;

    if matches!(
        reject_mode,
        crate::modules::mcp::commands::runtime::RejectPersistMode::DenyAlways
    ) {
        if let Some(pending) = pending_before_reject.as_ref() {
            if let Some(key) = pending.policy_rule_key.as_deref() {
                state
                    .mcp
                    .store
                    .upsert_tool_approval_rule(
                        key,
                        PersistedApprovalAction::DenyAlways,
                        &pending.tool_name,
                        &pending.tool_fingerprint,
                        pending.risk_level.as_deref(),
                    )
                    .await
                    .map_err(to_string)?;
            }
        }
    }
    let _ = state
        .mcp
        .approvals
        .pending_tool_calls
        .write()
        .await
        .remove(token);

    let persisted_graph =
        load_execution_graph_snapshot(state.mcp.store.as_ref(), requested_execution_id.as_str())
            .await
            .map_err(to_string)?;
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

pub(crate) async fn dispatch_local_chat_execution_run_command(
    app: Option<&tauri::AppHandle>,
    state: &crate::state::AppState,
    command: ExecutionRunCommand,
) -> Result<Value, String> {
    match command {
        ExecutionRunCommand::ApproveGate {
            approval_token,
            execution_graph_execution_id,
            approval_context,
            persist_mode,
        } => {
            let app = app.ok_or_else(|| "app handle is required for ApproveGate".to_string())?;
            approve_local_chat_execution_gate_command(
                app,
                state,
                approval_token.as_str(),
                execution_graph_execution_id.as_deref(),
                &approval_context,
                persist_mode,
            )
            .await
        }
        ExecutionRunCommand::RejectGate {
            approval_token,
            execution_graph_execution_id,
            reject_mode,
        } => {
            reject_local_chat_execution_gate_command(
                state,
                approval_token.as_str(),
                execution_graph_execution_id.as_deref(),
                reject_mode,
            )
            .await
        }
        ExecutionRunCommand::RecoverRun {
            execution_graph_execution_id,
            action,
        } => {
            let app = app.ok_or_else(|| "app handle is required for RecoverRun".to_string())?;
            recover_local_chat_execution_from_action(
                app,
                state,
                execution_graph_execution_id.as_str(),
                action.as_str(),
            )
            .await
        }
    }
}
