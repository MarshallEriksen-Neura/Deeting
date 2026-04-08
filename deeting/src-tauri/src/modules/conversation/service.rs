use serde_json::Value;
use tauri::AppHandle;

use crate::state::AppState;

use super::types::{ApprovalActionResult, TextChatReply, ToolApprovalPayload};

// ─── Helpers ────────────────────────────────────────────────────────────────

pub fn action_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub fn normalized_action(action_event: &str, action_value: &Value) -> String {
    let trimmed = action_event.trim();
    if trimmed.is_empty() {
        action_string(action_value, "event").unwrap_or_default()
    } else {
        trimmed.to_string()
    }
}

// ─── Response Parsing ───────────────────────────────────────────────────────

pub fn extract_chat_response(response: &Value) -> Option<&serde_json::Map<String, Value>> {
    response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(Value::as_object)
}

pub fn extract_reply_text(response: &Value) -> Option<String> {
    extract_chat_response(response)
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_tool_approval_payload_from_block(block: &Value) -> Option<ToolApprovalPayload> {
    if block.get("type").and_then(Value::as_str) != Some("tool_result") {
        return None;
    }

    let result = block.get("result")?;
    if result.get("status").and_then(Value::as_str) != Some("REQUIRES_APPROVAL") {
        return None;
    }

    let approval_token = result
        .get("approval_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)?;
    let tool_name = result
        .get("tool_name")
        .and_then(Value::as_str)
        .or_else(|| block.get("toolName").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)?;

    let risk_reasons = result
        .get("risk_reasons")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Some(ToolApprovalPayload {
        approval_token,
        call_id: block
            .get("callId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        tool_name,
        description: result
            .get("description")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        risk_level: result
            .get("risk_level")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        risk_reasons,
        arguments: result.get("arguments").cloned(),
    })
}

pub fn extract_approval_payload(response: &Value) -> Option<ToolApprovalPayload> {
    let blocks = extract_chat_response(response)?
        .get("meta_info")
        .and_then(|value| value.get("blocks"))
        .and_then(Value::as_array)?;

    for block in blocks.iter().rev() {
        if let Some(payload) = extract_tool_approval_payload_from_block(block) {
            return Some(payload);
        }
    }

    None
}

/// 从编排响应中提取平台无关的回复（文本 + 可选审批）
pub fn extract_reply(response: &Value) -> Option<TextChatReply> {
    let approval_request = extract_approval_payload(response);
    let text = extract_reply_text(response);

    if approval_request.is_none() && text.is_none() {
        return None;
    }

    Some(TextChatReply {
        text,
        approval_request,
    })
}

// ─── Text Chat Execution ────────────────────────────────────────────────────

/// 发送文本到编排层，返回原始 JSON（供需要完整响应的场景）
pub async fn execute_text_chat_raw(
    app_state: &AppState,
    app_handle: &AppHandle,
    text: &str,
    session_id: &str,
) -> Result<Option<Value>, String> {
    use crate::modules::desktop_runtime::local_orchestrator::{
        execute_local_orchestrated_chat, LocalOrchestratorInput,
    };

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let secretary = app_state
        .providers
        .store
        .get_or_create_user_secretary()
        .await
        .map_err(|err| err.to_string())?;

    let model_reference = secretary
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("gpt-4o-mini")
        .to_string();
    let provider_model_id = secretary
        .provider_model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let input = LocalOrchestratorInput {
        model: model_reference,
        model_selection_mode: Some("pool".to_string()),
        provider_model_id,
        explicit_task_agent_id: None,
        root_execution_id: None,
        session_id: session_id.trim().to_string(),
        capability_id: None,
        regenerate: false,
        compare_only: false,
        user_content: Some(trimmed.to_string()),
        temperature: Some(0.2),
        max_tokens: None,
        request_id: None,
        stream: false,
        status_stream: false,
        selected_knowledge_file_ids: Vec::new(),
    };

    let response = execute_local_orchestrated_chat(
        app_handle,
        app_state,
        input,
        uuid::Uuid::new_v4().to_string(),
        None,
    )
    .await?;

    Ok(Some(response))
}

/// 发送文本到编排层，返回平台无关的回复
pub async fn execute_text_chat(
    app_state: &AppState,
    app_handle: &AppHandle,
    text: &str,
    session_id: &str,
) -> Result<Option<TextChatReply>, String> {
    let Some(response) = execute_text_chat_raw(app_state, app_handle, text, session_id).await?
    else {
        return Ok(None);
    };

    Ok(extract_reply(&response))
}

// ─── Approval Prompt ────────────────────────────────────────────────────────

pub fn build_text_approval_prompt(payload: &ToolApprovalPayload) -> String {
    let mut lines = vec![
        format!("审批请求：工具 `{}` 需要确认。", payload.tool_name),
        payload
            .description
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("该操作需要人工确认后才能继续执行。")
            .to_string(),
    ];

    if let Some(risk_level) = payload
        .risk_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("风险等级：{risk_level}"));
    }

    if !payload.risk_reasons.is_empty() {
        lines.push(format!("风险原因：{}", payload.risk_reasons.join("；")));
    }

    lines.push("回复 `1` 确认执行，回复 `0` 拒绝执行。".to_string());
    lines.join("\n")
}

// ─── Approval Actions ───────────────────────────────────────────────────────

/// 从审批续行结果中提取文本消息
pub fn extract_follow_up_texts(result: &Value) -> Vec<String> {
    let status = result
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if status != "LOCAL_CHAT_RESUMED" && status != "LOCAL_CHAT_RESUME_FAILED" {
        return Vec::new();
    }

    let mut texts = result
        .get("continuation_blocks")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|block| {
                    if block.get("type").and_then(Value::as_str) != Some("text") {
                        return None;
                    }
                    block
                        .get("content")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if texts.is_empty() {
        if let Some(error) = result
            .get("error")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            texts.push(format!("审批已处理，但后续执行失败：{error}"));
        }
    }

    texts
}

/// 执行审批通过操作
pub async fn approve_tool(
    app_handle: &AppHandle,
    app_state: &AppState,
    approval_token: &str,
    call_id: Option<&str>,
    tool_name: &str,
) -> Result<ApprovalActionResult, String> {
    use crate::modules::desktop_runtime::runtime::resume_suspended_chat_tool_execution_after_approval;
    use crate::modules::mcp::commands::runtime::approve_mcp_tool_inner_with_context;

    let approval_context = app_state.mcp.build_approval_context(call_id, None, None);
    let pending_before_approval = app_state
        .mcp
        .approvals
        .pending_tool_calls
        .read()
        .await
        .get(approval_token)
        .cloned();

    let approved = approve_mcp_tool_inner_with_context(
        &approval_context,
        Some(&app_state.mcp),
        app_state.mcp.store.as_ref(),
        app_state.mcp.approvals.pending_tool_calls.as_ref(),
        approval_token,
    )
    .await?;

    let resumed = resume_suspended_chat_tool_execution_after_approval(
        app_handle,
        app_state,
        approval_token,
        &approved,
        pending_before_approval
            .as_ref()
            .and_then(|pending| pending.call_id.as_deref()),
        pending_before_approval
            .as_ref()
            .and_then(|pending| pending.execution_graph_execution_id.as_deref()),
        pending_before_approval
            .as_ref()
            .map(|pending| pending.created_at_unix_ms),
    )
    .await?;

    let mut follow_up_texts = resumed
        .as_ref()
        .map(|r| extract_follow_up_texts(r))
        .unwrap_or_default();
    if follow_up_texts.is_empty() {
        follow_up_texts.push(format!("已批准 `{}`，当前流程继续执行。", tool_name));
    }

    Ok(ApprovalActionResult {
        tool_name: tool_name.to_string(),
        approved: true,
        follow_up_texts,
    })
}

/// 执行审批拒绝操作
pub async fn reject_tool(
    app_state: &AppState,
    approval_token: &str,
    tool_name: &str,
) -> Result<ApprovalActionResult, String> {
    use crate::modules::desktop_runtime::runtime::{
        apply_rejected_tool_result_to_execution_graph,
        apply_rejected_tool_result_to_execution_graph_value,
        delete_execution_graph_runtime_context, load_execution_graph_snapshot,
        load_execution_graph_snapshot_by_approval_token, persist_execution_graph_snapshot,
    };
    use crate::modules::mcp::commands::runtime::reject_mcp_tool_inner;

    let pending_before_reject = app_state
        .mcp
        .approvals
        .pending_tool_calls
        .read()
        .await
        .get(approval_token)
        .cloned();

    reject_mcp_tool_inner(
        app_state.mcp.approvals.pending_tool_calls.as_ref(),
        approval_token,
    )
    .await;

    let mut persisted_graph = if let Some(execution_id) = pending_before_reject
        .as_ref()
        .and_then(|pending| pending.execution_graph_execution_id.as_deref())
    {
        load_execution_graph_snapshot(app_state.mcp.store.as_ref(), execution_id)
            .await
            .map_err(|err| err.to_string())?
    } else {
        None
    };
    if persisted_graph.is_none() {
        persisted_graph = load_execution_graph_snapshot_by_approval_token(
            app_state.mcp.store.as_ref(),
            approval_token,
        )
        .await
        .map_err(|err| err.to_string())?;
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
            app_state.mcp.store.as_ref(),
            &execution_graph,
            pending_before_reject
                .as_ref()
                .and_then(|pending| pending.session_id.as_deref())
                .unwrap_or("unknown"),
            "desktop_local_chat_rejected_internal",
            None,
            Some("cancelled"),
        )
        .await
        {
            log::warn!(
                "persist rejected internal execution graph failed approval_token={} err={}",
                approval_token,
                err
            );
        }
        if let Some(execution_id) = execution_id.as_deref() {
            if let Err(err) =
                delete_execution_graph_runtime_context(app_state.mcp.store.as_ref(), execution_id)
                    .await
            {
                log::warn!(
                    "delete_execution_graph_runtime_context failed execution_id={} err={}",
                    execution_id,
                    err
                );
            }
        }
    } else if let Some(mut suspended) = app_state
        .mcp
        .approvals
        .suspended_local_chat_executions
        .write()
        .await
        .remove(approval_token)
    {
        apply_rejected_tool_result_to_execution_graph(
            &mut suspended,
            pending_before_reject
                .as_ref()
                .and_then(|pending| pending.call_id.as_deref()),
            "User rejected tool execution",
        );
        if let Err(err) = persist_execution_graph_snapshot(
            app_state.mcp.store.as_ref(),
            suspended.execution_graph(),
            pending_before_reject
                .as_ref()
                .and_then(|pending| pending.session_id.as_deref())
                .unwrap_or("unknown"),
            "desktop_local_chat_rejected_internal_legacy_fallback",
            None,
            Some("cancelled"),
        )
        .await
        {
            log::warn!(
                "persist rejected internal legacy fallback graph failed approval_token={} err={}",
                approval_token,
                err
            );
        }
    }

    Ok(ApprovalActionResult {
        tool_name: tool_name.to_string(),
        approved: false,
        follow_up_texts: vec![format!("已取消 `{}` 的执行。", tool_name)],
    })
}
