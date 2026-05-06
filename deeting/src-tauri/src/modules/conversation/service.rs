use serde_json::{Map, Value};
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

fn clone_fields(source: &Value, keys: &[&str]) -> Value {
    let mut output = Map::new();
    for key in keys {
        if let Some(value) = source.get(*key) {
            output.insert((*key).to_string(), value.clone());
        }
    }
    Value::Object(output)
}

fn compact_im_block(block: &Value) -> Option<Value> {
    let block_type = block.get("type").and_then(Value::as_str)?;
    let mut compact = Map::new();
    compact.insert("type".to_string(), Value::String(block_type.to_string()));

    match block_type {
        "tool_result" => {
            for key in ["callId", "toolName"] {
                if let Some(value) = block.get(key) {
                    compact.insert(key.to_string(), value.clone());
                }
            }
            if let Some(result) = block.get("result") {
                compact.insert(
                    "result".to_string(),
                    clone_fields(
                        result,
                        &[
                            "status",
                            "approval_token",
                            "tool_name",
                            "description",
                            "risk_level",
                            "risk_reasons",
                            "arguments",
                        ],
                    ),
                );
            }
        }
        "ui" => {
            if let Some(value) = block.get("viewType") {
                compact.insert("viewType".to_string(), value.clone());
            }
            if let Some(payload) = block.get("payload") {
                compact.insert(
                    "payload".to_string(),
                    clone_fields(
                        payload,
                        &[
                            "text",
                            "content",
                            "summary",
                            "url",
                            "image_url",
                            "asset_url",
                            "download_url",
                            "name",
                        ],
                    ),
                );
            }
            if let Some(metadata) = block.get("metadata") {
                compact.insert(
                    "metadata".to_string(),
                    clone_fields(metadata, &["text", "content", "summary"]),
                );
            }
        }
        "file_preview" => {
            if let Some(data) = block.get("data") {
                compact.insert(
                    "data".to_string(),
                    clone_fields(data, &["url", "download_url", "name"]),
                );
            }
        }
        _ => return None,
    }

    Some(Value::Object(compact))
}

pub fn compact_im_reply_response(response: &Value) -> Value {
    let Some(message) = extract_chat_response(response) else {
        return Value::Null;
    };

    let mut compact_message = Map::new();
    if let Some(content) = message.get("content") {
        compact_message.insert("content".to_string(), content.clone());
    }

    if let Some(blocks) = message
        .get("meta_info")
        .and_then(|value| value.get("blocks"))
        .and_then(Value::as_array)
    {
        let compact_blocks = blocks
            .iter()
            .filter_map(compact_im_block)
            .collect::<Vec<_>>();
        if !compact_blocks.is_empty() {
            let mut meta_info = Map::new();
            meta_info.insert("blocks".to_string(), Value::Array(compact_blocks));
            compact_message.insert("meta_info".to_string(), Value::Object(meta_info));
        }
    }

    serde_json::json!({
        "choices": [
            {
                "message": compact_message,
            }
        ]
    })
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
        generated_artifact_context: None,
        session_id: session_id.trim().to_string(),
        capability_id: None,
        regenerate: false,
        compare_only: false,
        user_content: Some(trimmed.to_string()),
        provided_messages: None,
        persist_runtime_artifacts: true,
        temperature: Some(0.2),
        max_tokens: None,
        reasoning_enabled: None,
        reasoning_effort: None,
        request_id: None,
        stream: false,
        status_stream: false,
        selected_knowledge_file_ids: Vec::new(),
        locale: None,
    };

    let response = Box::pin(execute_local_orchestrated_chat(
        app_handle,
        app_state,
        input,
        uuid::Uuid::new_v4().to_string(),
        None,
    ))
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
    if status != "LOCAL_CHAT_RESUMED"
        && status != "LOCAL_CHAT_WAITING_APPROVAL"
        && status != "LOCAL_CHAT_RESUME_FAILED"
    {
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
    use crate::modules::mcp::commands::tool_approval_impl::approve_mcp_tool_payload;

    let approved = approve_mcp_tool_payload(
        app_handle,
        app_state,
        approval_token,
        None,
        None,
        call_id,
        None,
    )
    .await?;

    let mut follow_up_texts = extract_follow_up_texts(&approved);
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
    use crate::modules::mcp::commands::tool_approval_impl::reject_mcp_tool_payload;

    reject_mcp_tool_payload(app_state, approval_token, None, None).await?;

    Ok(ApprovalActionResult {
        tool_name: tool_name.to_string(),
        approved: false,
        follow_up_texts: vec![format!("已取消 `{}` 的执行。", tool_name)],
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn compact_im_reply_response_keeps_only_im_reply_fields() {
        let response = json!({
            "choices": [
                {
                    "message": {
                        "content": "hello",
                        "meta_info": {
                            "execution_graph": { "large": ["ignored"] },
                            "blocks": [
                                {
                                    "type": "debug_trace",
                                    "payload": { "large": "ignored" }
                                },
                                {
                                    "type": "ui",
                                    "viewType": "image.result",
                                    "payload": {
                                        "url": "https://example.test/image.png",
                                        "huge_html": "<html>ignored</html>"
                                    },
                                    "metadata": {
                                        "summary": "image summary",
                                        "large": "ignored"
                                    }
                                },
                                {
                                    "type": "tool_result",
                                    "callId": "call-1",
                                    "toolName": "dangerous_tool",
                                    "result": {
                                        "status": "REQUIRES_APPROVAL",
                                        "approval_token": "approval-1",
                                        "tool_name": "dangerous_tool",
                                        "description": "needs approval",
                                        "risk_level": "HIGH",
                                        "risk_reasons": ["writes files"],
                                        "arguments": { "path": "file.txt" },
                                        "large_trace": "ignored"
                                    }
                                }
                            ]
                        }
                    }
                }
            ]
        });

        let compact = compact_im_reply_response(&response);

        assert_eq!(extract_reply_text(&compact).as_deref(), Some("hello"));

        let approval = extract_approval_payload(&compact).expect("approval payload");
        assert_eq!(approval.approval_token, "approval-1");
        assert_eq!(approval.call_id.as_deref(), Some("call-1"));
        assert_eq!(approval.tool_name, "dangerous_tool");
        assert_eq!(approval.risk_reasons, vec!["writes files"]);

        let blocks = extract_chat_response(&compact)
            .and_then(|message| message.get("meta_info"))
            .and_then(|meta| meta.get("blocks"))
            .and_then(Value::as_array)
            .expect("compact blocks");
        assert_eq!(blocks.len(), 2);
        assert!(compact
            .pointer("/choices/0/message/meta_info/execution_graph")
            .is_none());
        assert!(compact
            .pointer("/choices/0/message/meta_info/blocks/0/payload/huge_html")
            .is_none());
        assert!(compact
            .pointer("/choices/0/message/meta_info/blocks/1/result/large_trace")
            .is_none());
    }
}
