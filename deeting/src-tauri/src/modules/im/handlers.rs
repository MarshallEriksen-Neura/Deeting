use serde_json::Value;
use tauri::AppHandle;

use crate::modules::im::{CardActionResponse, MessageContent, ToastResponse, ToastType};
use crate::state::AppState;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ToolApprovalPayload {
    pub approval_token: String,
    pub call_id: Option<String>,
    pub tool_name: String,
    pub description: Option<String>,
    pub risk_level: Option<String>,
    pub risk_reasons: Vec<String>,
    pub arguments: Option<Value>,
}

#[derive(Debug, Clone)]
pub(crate) struct ImCardActionOutcome {
    pub callback_response: CardActionResponse,
    pub follow_up_messages: Vec<MessageContent>,
}

#[derive(Debug, Clone)]
pub(crate) struct LocalChatReplyOutcome {
    pub content: MessageContent,
    pub approval_request: Option<ToolApprovalPayload>,
}

fn action_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn toast_response(message: &str, toast_type: ToastType) -> CardActionResponse {
    CardActionResponse {
        toast: Some(ToastResponse {
            toast_type,
            content: message.to_string(),
        }),
        update_card: None,
    }
}

fn normalized_action(action_event: &str, action_value: &Value) -> String {
    let trimmed = action_event.trim();
    if trimmed.is_empty() {
        action_string(action_value, "event").unwrap_or_default()
    } else {
        trimmed.to_string()
    }
}

fn extract_local_chat_response(response: &Value) -> Option<&serde_json::Map<String, Value>> {
    response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(Value::as_object)
}

fn extract_local_chat_reply_text(response: &Value) -> Option<String> {
    extract_local_chat_response(response)
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

fn latest_tool_approval_payload(response: &Value) -> Option<ToolApprovalPayload> {
    let blocks = extract_local_chat_response(response)?
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

fn compact_json_preview(value: &Value, max_chars: usize) -> Option<String> {
    let serialized = serde_json::to_string_pretty(value).ok()?;
    let trimmed = serialized.trim();
    if trimmed.is_empty() {
        return None;
    }
    let truncated = if trimmed.chars().count() > max_chars {
        let preview = trimmed
            .chars()
            .take(max_chars.saturating_sub(1))
            .collect::<String>();
        format!("{preview}…")
    } else {
        trimmed.to_string()
    };
    Some(format!("```json\n{truncated}\n```"))
}

fn approval_template(risk_level: Option<&str>) -> &'static str {
    match risk_level
        .unwrap_or_default()
        .trim()
        .to_ascii_uppercase()
        .as_str()
    {
        "HIGH" | "CRITICAL" => "red",
        "MEDIUM" => "orange",
        _ => "blue",
    }
}

fn build_tool_approval_card(payload: &ToolApprovalPayload) -> Value {
    let mut elements = vec![serde_json::json!({
        "tag": "markdown",
        "content": format!(
            "**工具**: `{}`\n{}",
            payload.tool_name,
            payload
                .description
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("该操作需要你的确认后才能继续。")
        ),
    })];

    let mut risk_lines = Vec::new();
    if let Some(risk_level) = payload
        .risk_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        risk_lines.push(format!("- 风险等级: `{risk_level}`"));
    }
    if !payload.risk_reasons.is_empty() {
        risk_lines.push("- 风险原因:".to_string());
        for reason in payload.risk_reasons.iter().take(4) {
            risk_lines.push(format!("  - {reason}"));
        }
    }
    if !risk_lines.is_empty() {
        elements.push(serde_json::json!({
            "tag": "markdown",
            "content": risk_lines.join("\n"),
        }));
    }

    if let Some(arguments) = payload.arguments.as_ref() {
        if let Some(preview) = compact_json_preview(arguments, 500) {
            elements.push(serde_json::json!({
                "tag": "markdown",
                "content": format!("**参数预览**\n{preview}"),
            }));
        }
    }

    elements.push(serde_json::json!({
        "tag": "action",
        "actions": [
            {
                "tag": "button",
                "text": { "tag": "plain_text", "content": "批准并继续" },
                "type": "primary",
                "confirm": {
                    "title": { "tag": "plain_text", "content": "确认批准" },
                    "text": { "tag": "plain_text", "content": "批准后会继续执行当前 AI 流程。" }
                },
                "value": {
                    "event": "approve_tool",
                    "approval_token": payload.approval_token,
                    "call_id": payload.call_id,
                    "tool_name": payload.tool_name
                }
            },
            {
                "tag": "button",
                "text": { "tag": "plain_text", "content": "拒绝" },
                "type": "danger",
                "confirm": {
                    "title": { "tag": "plain_text", "content": "确认拒绝" },
                    "text": { "tag": "plain_text", "content": "拒绝后本次工具调用会被取消。" }
                },
                "value": {
                    "event": "reject_tool",
                    "approval_token": payload.approval_token,
                    "call_id": payload.call_id,
                    "tool_name": payload.tool_name
                }
            }
        ]
    }));

    serde_json::json!({
        "header": {
            "title": {
                "tag": "plain_text",
                "content": "审批确认"
            },
            "template": approval_template(payload.risk_level.as_deref())
        },
        "elements": elements,
    })
}

pub(crate) fn build_text_approval_prompt(payload: &ToolApprovalPayload) -> String {
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

fn build_tool_approval_result_card(tool_name: &str, status: &str, detail: &str) -> Value {
    let (title, template) = match status {
        "approved" => ("已批准并继续执行", "green"),
        "rejected" => ("已拒绝执行", "blue"),
        _ => ("审批状态更新", "blue"),
    };

    serde_json::json!({
        "header": {
            "title": {
                "tag": "plain_text",
                "content": title
            },
            "template": template
        },
        "elements": [
            {
                "tag": "markdown",
                "content": format!("**工具**: `{}`\n{}", tool_name, detail),
            }
        ]
    })
}

pub(crate) fn extract_local_chat_reply_outcome(response: &Value) -> Option<LocalChatReplyOutcome> {
    if let Some(payload) = latest_tool_approval_payload(response) {
        return Some(LocalChatReplyOutcome {
            content: MessageContent::Card {
                card: build_tool_approval_card(&payload),
            },
            approval_request: Some(payload),
        });
    }

    extract_local_chat_reply_text(response).map(|text| LocalChatReplyOutcome {
        content: MessageContent::Text { text },
        approval_request: None,
    })
}

pub(crate) fn extract_local_chat_reply_content(response: &Value) -> Option<MessageContent> {
    extract_local_chat_reply_outcome(response).map(|outcome| outcome.content)
}

pub(crate) fn extract_follow_up_messages_from_approval_result(
    result: &Value,
) -> Vec<MessageContent> {
    let status = result
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if status != "LOCAL_CHAT_RESUMED" && status != "LOCAL_CHAT_RESUME_FAILED" {
        return Vec::new();
    }

    let mut messages = result
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
                        .map(|text| MessageContent::Text {
                            text: text.to_string(),
                        })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if messages.is_empty() {
        if let Some(error) = result
            .get("error")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            messages.push(MessageContent::Text {
                text: format!("审批已处理，但后续执行失败：{error}"),
            });
        }
    }

    messages
}

async fn execute_local_chat_response(
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
        provider_model_id,
        session_id: session_id.trim().to_string(),
        capability_id: None,
        regenerate: false,
        compare_only: false,
        user_content: Some(trimmed.to_string()),
        temperature: Some(0.2),
        max_tokens: Some(512),
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

pub(crate) async fn generate_local_chat_reply(
    app_state: &AppState,
    app_handle: &tauri::AppHandle,
    text: &str,
    session_id: &str,
) -> Result<Option<String>, String> {
    let Some(response) =
        execute_local_chat_response(app_state, app_handle, text, session_id).await?
    else {
        return Ok(None);
    };

    Ok(extract_local_chat_reply_text(&response))
}

pub(crate) async fn generate_local_chat_reply_content(
    app_state: &AppState,
    app_handle: &AppHandle,
    text: &str,
    session_id: &str,
) -> Result<Option<MessageContent>, String> {
    let Some(response) =
        execute_local_chat_response(app_state, app_handle, text, session_id).await?
    else {
        return Ok(None);
    };

    Ok(extract_local_chat_reply_content(&response))
}

pub(crate) async fn generate_local_chat_reply_outcome(
    app_state: &AppState,
    app_handle: &AppHandle,
    text: &str,
    session_id: &str,
) -> Result<Option<LocalChatReplyOutcome>, String> {
    let Some(response) =
        execute_local_chat_response(app_state, app_handle, text, session_id).await?
    else {
        return Ok(None);
    };

    Ok(extract_local_chat_reply_outcome(&response))
}

pub(crate) async fn build_direct_card_action_outcome(
    app_handle: &AppHandle,
    app_state: &AppState,
    action_event: &str,
    action_value: &Value,
) -> Result<ImCardActionOutcome, String> {
    use crate::modules::desktop_runtime::runtime::resume_suspended_local_chat_after_approval;
    use crate::modules::mcp::commands::runtime::{
        approve_mcp_tool_inner_with_context, reject_mcp_tool_inner,
    };

    let normalized_action = normalized_action(action_event, action_value);

    match normalized_action.as_str() {
        "approve_tool" => {
            let approval_token = action_string(action_value, "approval_token")
                .ok_or_else(|| "缺少审批 token".to_string())?;
            let call_id = action_string(action_value, "call_id");
            let tool_name =
                action_string(action_value, "tool_name").unwrap_or_else(|| "工具调用".to_string());
            let approval_context =
                app_state
                    .mcp
                    .build_approval_context(call_id.as_deref(), None, None);

            let approved = approve_mcp_tool_inner_with_context(
                &approval_context,
                Some(&app_state.mcp),
                app_state.mcp.store.as_ref(),
                app_state.mcp.approvals.pending_tool_calls.as_ref(),
                &approval_token,
            )
            .await?;

            let resumed = resume_suspended_local_chat_after_approval(
                app_handle,
                app_state,
                &approval_token,
                &approved,
            )
            .await?;
            let mut follow_up_messages = resumed
                .as_ref()
                .map(extract_follow_up_messages_from_approval_result)
                .unwrap_or_default();
            if follow_up_messages.is_empty() {
                follow_up_messages.push(MessageContent::Text {
                    text: format!("已批准 `{}`，当前流程继续执行。", tool_name),
                });
            }

            Ok(ImCardActionOutcome {
                callback_response: CardActionResponse {
                    toast: Some(ToastResponse {
                        toast_type: ToastType::Success,
                        content: "审批已通过，正在继续执行。".to_string(),
                    }),
                    update_card: Some(build_tool_approval_result_card(
                        tool_name.as_str(),
                        "approved",
                        "该操作已批准，桌面端正在继续执行后续流程。",
                    )),
                },
                follow_up_messages,
            })
        }
        "reject_tool" => {
            let approval_token = action_string(action_value, "approval_token")
                .ok_or_else(|| "缺少审批 token".to_string())?;
            let tool_name =
                action_string(action_value, "tool_name").unwrap_or_else(|| "工具调用".to_string());
            reject_mcp_tool_inner(
                app_state.mcp.approvals.pending_tool_calls.as_ref(),
                &approval_token,
            )
            .await;
            app_state
                .mcp
                .approvals
                .suspended_local_chat_executions
                .write()
                .await
                .remove(&approval_token);

            Ok(ImCardActionOutcome {
                callback_response: CardActionResponse {
                    toast: Some(ToastResponse {
                        toast_type: ToastType::Success,
                        content: "已拒绝本次工具执行。".to_string(),
                    }),
                    update_card: Some(build_tool_approval_result_card(
                        tool_name.as_str(),
                        "rejected",
                        "本次审批已拒绝，当前工具调用不会继续执行。",
                    )),
                },
                follow_up_messages: vec![MessageContent::Text {
                    text: format!("已取消 `{}` 的执行。", tool_name),
                }],
            })
        }
        _ => Ok(ImCardActionOutcome {
            callback_response: build_card_action_response(app_state, action_event, action_value)
                .await?,
            follow_up_messages: Vec::new(),
        }),
    }
}

pub(crate) async fn build_card_action_response(
    app_state: &AppState,
    action_event: &str,
    action_value: &Value,
) -> Result<CardActionResponse, String> {
    use crate::modules::monitor::types::LocalMonitorTaskIdRequest;
    use mcp_session::admin::LocalTraceFeedbackRequest;

    let normalized_action = normalized_action(action_event, action_value);

    let response = match normalized_action.as_str() {
        "useful" | "useless" => {
            let score = if normalized_action == "useful" {
                1.0
            } else {
                0.0
            };
            if let Some(trace_id) = action_string(action_value, "trace_id") {
                app_state
                    .mcp
                    .store
                    .create_local_trace_feedback(LocalTraceFeedbackRequest {
                        trace_id,
                        score,
                        comment: None,
                        tags: Some(vec!["feishu".to_string(), normalized_action.clone()]),
                    })
                    .await
                    .map_err(|err| err.to_string())?;
                toast_response("感谢反馈，已记录本地 trace 反馈。", ToastType::Success)
            } else if let (Some(task_id), Some(log_id)) = (
                action_string(action_value, "monitor_task_id"),
                action_string(action_value, "log_id"),
            ) {
                app_state
                    .monitor
                    .submit_feedback(task_id, log_id, score)
                    .await?;
                toast_response("感谢反馈，监控结果已更新。", ToastType::Success)
            } else {
                toast_response("缺少反馈标识，无法记录本地反馈。", ToastType::Error)
            }
        }
        "pause" => {
            if let Some(task_id) = action_string(action_value, "monitor_task_id") {
                let result = app_state
                    .monitor
                    .pause_task(LocalMonitorTaskIdRequest { task_id })
                    .await?;
                toast_response(result.message.as_str(), ToastType::Success)
            } else {
                toast_response("缺少监控任务 ID，无法暂停任务。", ToastType::Error)
            }
        }
        "dialogue" => {
            if let Some(dialogue_url) = action_string(action_value, "dialogue_url") {
                toast_response(
                    format!("请在桌面端打开对话入口：{}", dialogue_url).as_str(),
                    ToastType::Success,
                )
            } else if let Some(assistant_id) = action_string(action_value, "assistant_id") {
                toast_response(
                    format!("请在桌面端打开助手对话（assistant_id={}）。", assistant_id).as_str(),
                    ToastType::Success,
                )
            } else {
                toast_response("未找到可用的桌面对话入口。", ToastType::Error)
            }
        }
        "" => toast_response("缺少卡片动作标识。", ToastType::Error),
        other => toast_response(
            format!("暂不支持的卡片动作：{}", other).as_str(),
            ToastType::Error,
        ),
    };

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_tool_approval_card_contains_expected_actions() {
        let card = build_tool_approval_card(&ToolApprovalPayload {
            approval_token: "approval-1".to_string(),
            call_id: Some("call-1".to_string()),
            tool_name: "shell.exec".to_string(),
            description: Some("Run a shell command".to_string()),
            risk_level: Some("HIGH".to_string()),
            risk_reasons: vec!["writes files".to_string(), "executes commands".to_string()],
            arguments: Some(serde_json::json!({
                "command": "rm -rf /tmp/demo"
            })),
        });

        let actions = card
            .get("elements")
            .and_then(Value::as_array)
            .and_then(|elements| {
                elements
                    .iter()
                    .find(|item| item.get("tag").and_then(Value::as_str) == Some("action"))
            })
            .and_then(|item| item.get("actions"))
            .and_then(Value::as_array)
            .cloned()
            .expect("approval card should contain action buttons");

        assert!(actions.iter().any(|action| {
            action
                .get("value")
                .and_then(|value| value.get("event"))
                .and_then(Value::as_str)
                == Some("approve_tool")
                && action
                    .get("value")
                    .and_then(|value| value.get("approval_token"))
                    .and_then(Value::as_str)
                    == Some("approval-1")
                && action
                    .get("value")
                    .and_then(|value| value.get("call_id"))
                    .and_then(Value::as_str)
                    == Some("call-1")
        }));

        assert!(actions.iter().any(|action| {
            action
                .get("value")
                .and_then(|value| value.get("event"))
                .and_then(Value::as_str)
                == Some("reject_tool")
        }));
    }

    #[test]
    fn extract_local_chat_reply_content_prefers_approval_card() {
        let content = extract_local_chat_reply_content(&serde_json::json!({
            "choices": [{
                "message": {
                    "content": "普通文本不该优先展示",
                    "meta_info": {
                        "blocks": [{
                            "type": "tool_result",
                            "callId": "call-22",
                            "toolName": "shell.exec",
                            "status": "requires_approval",
                            "result": {
                                "status": "REQUIRES_APPROVAL",
                                "approval_token": "approval-22",
                                "tool_name": "shell.exec",
                                "description": "Run a shell command",
                                "risk_level": "HIGH",
                                "risk_reasons": ["executes commands"]
                            }
                        }]
                    }
                }
            }]
        }))
        .expect("reply content should be extracted");

        match content {
            crate::modules::im::MessageContent::Card { card } => {
                let title = card
                    .get("header")
                    .and_then(|value| value.get("title"))
                    .and_then(|value| value.get("content"))
                    .and_then(Value::as_str);
                assert_eq!(title, Some("审批确认"));
            }
            other => panic!("expected approval card, got {other:?}"),
        }
    }

    #[test]
    fn build_text_approval_prompt_includes_numeric_choices() {
        let prompt = build_text_approval_prompt(&ToolApprovalPayload {
            approval_token: "approval-1".to_string(),
            call_id: Some("call-1".to_string()),
            tool_name: "shell.exec".to_string(),
            description: Some("执行一个危险命令".to_string()),
            risk_level: Some("HIGH".to_string()),
            risk_reasons: vec!["会修改本地文件".to_string()],
            arguments: None,
        });

        assert!(prompt.contains("回复 `1` 确认执行"));
        assert!(prompt.contains("回复 `0` 拒绝执行"));
        assert!(prompt.contains("shell.exec"));
    }

    #[test]
    fn extract_follow_up_messages_from_local_chat_resumed_payload_returns_text_blocks() {
        let messages = extract_follow_up_messages_from_approval_result(&serde_json::json!({
            "status": "LOCAL_CHAT_RESUMED",
            "approved_tool_result": {
                "ok": true
            },
            "continuation_blocks": [
                {
                    "type": "tool_result",
                    "callId": "call-9",
                    "toolName": "shell.exec",
                    "status": "success",
                    "result": {"ok": true}
                },
                {
                    "type": "text",
                    "content": "命令已经执行完毕。"
                }
            ]
        }));

        assert_eq!(
            messages,
            vec![crate::modules::im::MessageContent::Text {
                text: "命令已经执行完毕。".to_string()
            }]
        );
    }
}
