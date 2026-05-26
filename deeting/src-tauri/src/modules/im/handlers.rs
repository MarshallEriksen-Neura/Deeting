use serde_json::Value;
use tauri::AppHandle;

use crate::modules::conversation::service as conversation;
use crate::modules::conversation::types::ToolApprovalPayload;
use crate::modules::im::{
    extract_reply_capabilities, CardActionResponse, ImReplyCapability, MessageContent,
    ToastResponse, ToastType,
};
use crate::state::AppState;
use desktop_runtime_core::{ApprovalInheritance, TaskInputSource};

pub(crate) use crate::modules::conversation::service::build_text_approval_prompt;

#[derive(Debug, Clone)]
pub(crate) struct ImCardActionOutcome {
    pub callback_response: CardActionResponse,
    pub follow_up_messages: Vec<MessageContent>,
}

#[derive(Debug, Clone)]
pub(crate) struct LocalChatReplyOutcome {
    pub content: MessageContent,
    pub fallback_text: Option<String>,
    pub approval_request: Option<ToolApprovalPayload>,
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

// ─── IM Wrappers over shared conversation service ───────────────────────────

pub(crate) fn extract_local_chat_reply_outcome(response: &Value) -> Option<LocalChatReplyOutcome> {
    if let Some(payload) = conversation::extract_approval_payload(response) {
        let card = build_tool_approval_card(&payload);
        return Some(LocalChatReplyOutcome {
            content: MessageContent::Card { card: card.clone() },
            fallback_text: None,
            approval_request: Some(payload),
        });
    }

    let extracted = extract_reply_capabilities(response)?;
    let fallback_text = extracted
        .fallbacks
        .iter()
        .find_map(|capability| match capability {
            ImReplyCapability::PlainText { text } => Some(text.clone()),
            _ => None,
        });
    let content = match &extracted.primary {
        ImReplyCapability::PlainText { text } => MessageContent::Text { text: text.clone() },
        ImReplyCapability::InteractiveCard { card } => MessageContent::Card { card: card.clone() },
        ImReplyCapability::ImageRef { url } => MessageContent::Image { url: url.clone() },
        ImReplyCapability::FileRef { name, url } => MessageContent::File {
            name: name.clone(),
            url: url.clone(),
        },
        ImReplyCapability::MixedParts { parts } => MessageContent::Mixed {
            parts: parts.clone(),
        },
        ImReplyCapability::UnsupportedRichContent { reason } => MessageContent::Text {
            text: reason.clone(),
        },
    };

    Some(LocalChatReplyOutcome {
        content,
        fallback_text,
        approval_request: None,
    })
}

fn follow_up_texts_to_messages(texts: Vec<String>) -> Vec<MessageContent> {
    texts
        .into_iter()
        .map(|text| MessageContent::Text { text })
        .collect()
}

pub(crate) async fn generate_local_chat_reply_outcome(
    app_state: &AppState,
    app_handle: &AppHandle,
    text: &str,
    session_id: &str,
) -> Result<Option<LocalChatReplyOutcome>, String> {
    let Some(response) = conversation::execute_text_chat_raw_with_input_source(
        app_state,
        app_handle,
        text,
        session_id,
        Some(im_task_input_source(session_id)),
    )
    .await?
    else {
        return Ok(None);
    };

    let response = conversation::compact_im_reply_response(&response);

    Ok(extract_local_chat_reply_outcome(&response))
}

fn im_task_input_source(session_id: &str) -> TaskInputSource {
    TaskInputSource::AgentDelegation {
        parent_task_id: session_id.trim().to_string(),
        delegated_by: "im_runtime".to_string(),
        approval_inheritance: ApprovalInheritance::UserRequired,
    }
}

pub(crate) async fn build_direct_card_action_outcome(
    app_handle: &AppHandle,
    app_state: &AppState,
    action_event: &str,
    action_value: &Value,
) -> Result<ImCardActionOutcome, String> {
    let normalized = conversation::normalized_action(action_event, action_value);

    match normalized.as_str() {
        "approve_tool" => {
            let approval_token = conversation::action_string(action_value, "approval_token")
                .ok_or_else(|| "缺少审批 token".to_string())?;
            let call_id = conversation::action_string(action_value, "call_id");
            let tool_name = conversation::action_string(action_value, "tool_name")
                .unwrap_or_else(|| "工具调用".to_string());

            let result = conversation::approve_tool(
                app_handle,
                app_state,
                &approval_token,
                call_id.as_deref(),
                &tool_name,
            )
            .await?;

            let follow_up_messages = follow_up_texts_to_messages(result.follow_up_texts);

            Ok(ImCardActionOutcome {
                callback_response: CardActionResponse {
                    toast: Some(ToastResponse {
                        toast_type: ToastType::Success,
                        content: "审批已通过，正在继续执行。".to_string(),
                    }),
                    update_card: Some(build_tool_approval_result_card(
                        &tool_name,
                        "approved",
                        "该操作已批准，桌面端正在继续执行后续流程。",
                    )),
                },
                follow_up_messages,
            })
        }
        "reject_tool" => {
            let approval_token = conversation::action_string(action_value, "approval_token")
                .ok_or_else(|| "缺少审批 token".to_string())?;
            let tool_name = conversation::action_string(action_value, "tool_name")
                .unwrap_or_else(|| "工具调用".to_string());

            let result = conversation::reject_tool(app_state, &approval_token, &tool_name).await?;

            let follow_up_messages = follow_up_texts_to_messages(result.follow_up_texts);

            Ok(ImCardActionOutcome {
                callback_response: CardActionResponse {
                    toast: Some(ToastResponse {
                        toast_type: ToastType::Success,
                        content: "已拒绝本次工具执行。".to_string(),
                    }),
                    update_card: Some(build_tool_approval_result_card(
                        &tool_name,
                        "rejected",
                        "本次审批已拒绝，当前工具调用不会继续执行。",
                    )),
                },
                follow_up_messages,
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

    let normalized = conversation::normalized_action(action_event, action_value);

    let response = match normalized.as_str() {
        "useful" | "useless" => {
            let score = if normalized == "useful" { 1.0 } else { 0.0 };
            if let Some(trace_id) = conversation::action_string(action_value, "trace_id") {
                app_state
                    .mcp
                    .store
                    .create_local_trace_feedback(LocalTraceFeedbackRequest {
                        trace_id,
                        score,
                        comment: None,
                        tags: Some(vec!["feishu".to_string(), normalized.clone()]),
                    })
                    .await
                    .map_err(|err| err.to_string())?;
                toast_response("感谢反馈，已记录本地 trace 反馈。", ToastType::Success)
            } else if let (Some(task_id), Some(log_id)) = (
                conversation::action_string(action_value, "monitor_task_id"),
                conversation::action_string(action_value, "log_id"),
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
            if let Some(task_id) = conversation::action_string(action_value, "monitor_task_id") {
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
            if let Some(dialogue_url) = conversation::action_string(action_value, "dialogue_url") {
                toast_response(
                    format!("请在桌面端打开对话入口：{}", dialogue_url).as_str(),
                    ToastType::Success,
                )
            } else if let Some(assistant_id) =
                conversation::action_string(action_value, "assistant_id")
            {
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
    fn extract_local_chat_reply_outcome_reads_rich_image_result_block() {
        let response = serde_json::json!({
            "choices": [{
                "message": {
                    "content": "desktop image ready",
                    "meta_info": {
                        "blocks": [{
                            "type": "ui",
                            "viewType": "image.result",
                            "payload": {
                                "url": "https://example.com/generated.png"
                            }
                        }]
                    }
                }
            }]
        });

        let outcome = extract_local_chat_reply_outcome(&response).expect("reply outcome");
        match outcome.content {
            MessageContent::Image { url } => {
                assert_eq!(url, "https://example.com/generated.png");
            }
            other => panic!("expected image reply, got {other:?}"),
        }
        assert_eq!(
            outcome.fallback_text.as_deref(),
            Some("desktop image ready")
        );
        assert!(outcome.approval_request.is_none());
    }

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
        let outcome = extract_local_chat_reply_outcome(&serde_json::json!({
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

        match outcome.content {
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
        let prompt = conversation::build_text_approval_prompt(&ToolApprovalPayload {
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
    fn extract_follow_up_texts_from_local_chat_resumed_payload() {
        let texts = conversation::extract_follow_up_texts(&serde_json::json!({
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

        assert_eq!(texts, vec!["命令已经执行完毕。".to_string()]);
    }

    #[test]
    fn extract_follow_up_texts_from_local_chat_waiting_approval_payload() {
        let texts = conversation::extract_follow_up_texts(&serde_json::json!({
            "status": "LOCAL_CHAT_WAITING_APPROVAL",
            "continuation_blocks": [
                {
                    "type": "text",
                    "content": "需要下一次审批。"
                }
            ]
        }));

        assert_eq!(texts, vec!["需要下一次审批。".to_string()]);
    }
}
