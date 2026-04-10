use std::collections::BTreeSet;

use serde_json::Value;

use crate::modules::desktop_runtime::runtime::LocalControlPlaneResult;
use mcp_core::types::LocalChatInputMessage;
use mcp_session::conversation::LocalConversationHistoryMessage;

pub(super) fn extract_summary_text(summary: Option<&Value>) -> Option<String> {
    summary
        .and_then(|value| value.get("summary_text"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn extract_saved_asset_ids_from_blocks(blocks: &[Value]) -> Vec<String> {
    let mut asset_ids = BTreeSet::new();
    for block in blocks {
        let Some(asset_id) = block
            .get("metadata")
            .and_then(|value| value.get("asset_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        asset_ids.insert(asset_id.to_string());
    }
    asset_ids.into_iter().collect()
}

pub(super) fn extract_response_runtime_metrics(
    response: &Value,
) -> (Option<i64>, Option<i64>, Option<i64>) {
    let metrics = response
        .get("runtime_metrics")
        .and_then(|value| value.as_object());
    let upstream_latency_ms = metrics
        .and_then(|value| value.get("upstream_latency_ms"))
        .and_then(|value| value.as_i64())
        .filter(|value| *value > 0);
    let ttft_ms = metrics
        .and_then(|value| value.get("ttft_ms"))
        .and_then(|value| value.as_i64())
        .filter(|value| *value > 0);
    let upstream_calls = metrics
        .and_then(|value| value.get("upstream_calls"))
        .and_then(|value| value.as_i64())
        .filter(|value| *value > 0);
    (upstream_latency_ms, ttft_ms, upstream_calls)
}

#[derive(Debug, Clone, Copy)]
pub(super) enum AssistantMetaMode {
    Canonical,
    CompareCandidate,
}

pub(super) fn build_assistant_meta(
    assistant_blocks: Vec<Value>,
    model_id: &str,
    provider_model_id: &str,
    runtime_metrics: Option<Value>,
    execution_graph: Option<Value>,
    execution_tree: Option<Value>,
    mode: AssistantMetaMode,
) -> Option<Value> {
    let mut meta = serde_json::Map::new();
    if !assistant_blocks.is_empty() {
        meta.insert("blocks".to_string(), Value::Array(assistant_blocks));
    }
    meta.insert("model_id".to_string(), Value::String(model_id.to_string()));
    meta.insert(
        "provider_model_id".to_string(),
        Value::String(provider_model_id.to_string()),
    );
    if let Some(runtime_metrics) = runtime_metrics {
        meta.insert("runtime_metrics".to_string(), runtime_metrics);
    }
    if let Some(execution_graph) = execution_graph {
        meta.insert("execution_graph".to_string(), execution_graph);
    }
    if let Some(execution_tree) = execution_tree {
        meta.insert("execution_tree".to_string(), execution_tree);
    }
    if matches!(mode, AssistantMetaMode::CompareCandidate) {
        meta.insert("compare_candidate".to_string(), Value::Bool(true));
    }
    Some(Value::Object(meta))
}

pub(super) fn build_compare_only_messages(
    messages: Vec<LocalConversationHistoryMessage>,
) -> Result<Vec<LocalChatInputMessage>, String> {
    let mut last_user_index = None;
    let mut last_assistant_index = None;

    for (index, message) in messages.iter().enumerate() {
        if message.role.eq_ignore_ascii_case("user") {
            last_user_index = Some(index);
            last_assistant_index = None;
            continue;
        }

        if message.role.eq_ignore_ascii_case("assistant")
            && last_user_index.is_some()
            && last_assistant_index.is_none()
        {
            last_assistant_index = Some(index);
        }
    }

    let last_user_index =
        last_user_index.ok_or_else(|| "compare_only requires an existing user turn".to_string())?;
    let last_assistant_index = last_assistant_index.ok_or_else(|| {
        "compare_only requires a latest assistant answer to compare against".to_string()
    })?;

    if last_assistant_index <= last_user_index {
        return Err(
            "compare_only requires a latest assistant answer to compare against".to_string(),
        );
    }

    Ok(messages
        .into_iter()
        .enumerate()
        .filter_map(|(index, message)| {
            if index == last_assistant_index {
                return None;
            }
            Some(convert_history_message_to_chat_input(message))
        })
        .collect())
}

pub(super) fn convert_history_message_to_chat_input(
    message: LocalConversationHistoryMessage,
) -> LocalChatInputMessage {
    let content = message
        .content
        .as_ref()
        .and_then(|value| {
            if let Some(text) = value.as_str() {
                Some(text.to_string())
            } else {
                serde_json::to_string(value).ok()
            }
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    LocalChatInputMessage {
        role: message.role,
        content,
        tool_calls: vec![],
        tool_call_id: None,
        name: None,
    }
}

pub fn extract_user_text_from_messages(messages: &[Value]) -> Option<String> {
    for message in messages.iter().rev() {
        let Some(object) = message.as_object() else {
            continue;
        };
        let role = object
            .get("role")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if !role.eq_ignore_ascii_case("user") {
            continue;
        }

        let content = object.get("content").cloned().unwrap_or(Value::Null);
        let parsed = extract_content_text(content);
        if !parsed.trim().is_empty() {
            return Some(parsed);
        }
    }
    None
}

fn has_non_text_blocks(items: &[Value]) -> bool {
    items.iter().any(|item| {
        item.as_object()
            .and_then(|obj| obj.get("type").and_then(|v| v.as_str()))
            .map(|t| t != "text")
            .unwrap_or(false)
    })
}

fn strip_data_urls_from_blocks(items: Vec<Value>) -> Vec<Value> {
    items
        .into_iter()
        .filter_map(|item| {
            let Some(obj) = item.as_object() else {
                return Some(item);
            };
            let block_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or_default();
            if block_type != "image_url" {
                return Some(item);
            }
            let image_url = obj.get("image_url");
            let url_str = image_url
                .and_then(|v| {
                    v.as_str()
                        .map(|s| s.to_string())
                        .or_else(|| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
                })
                .unwrap_or_default();
            if url_str.starts_with("data:") {
                return None;
            }
            Some(item)
        })
        .collect()
}

pub(super) fn extract_content_text(content: Value) -> String {
    match content {
        Value::String(text) => text,
        Value::Array(items) => {
            if has_non_text_blocks(&items) {
                let cleaned = strip_data_urls_from_blocks(items);
                if cleaned.is_empty() {
                    return String::new();
                }
                return serde_json::to_string(&cleaned).unwrap_or_default();
            }
            let mut out = Vec::new();
            for item in items {
                if let Some(obj) = item.as_object() {
                    let text = obj
                        .get("text")
                        .and_then(|value| value.as_str())
                        .or_else(|| obj.get("content").and_then(|value| value.as_str()));
                    if let Some(value) = text
                        .map(|value| value.trim())
                        .filter(|value| !value.is_empty())
                    {
                        out.push(value.to_string());
                    }
                }
            }
            if out.is_empty() {
                String::new()
            } else {
                out.join("\n")
            }
        }
        Value::Object(obj) => obj
            .get("text")
            .and_then(|value| value.as_str())
            .or_else(|| obj.get("content").and_then(|value| value.as_str()))
            .map(|value| value.to_string())
            .unwrap_or_else(|| serde_json::to_string(&Value::Object(obj)).unwrap_or_default()),
        Value::Null => String::new(),
        other => serde_json::to_string(&other).unwrap_or_default(),
    }
}

pub(super) fn fallback_prefers_chinese(
    control_plane_result: Option<&LocalControlPlaneResult>,
) -> bool {
    control_plane_result
        .map(|result| result.prompt_plan.response_language)
        .map(|value| value.to_ascii_lowercase().contains("zh"))
        .unwrap_or_else(crate::tray::desktop_prefers_zh)
}

fn decorate_tool_error_message(error_message: &str, prefers_chinese: bool) -> String {
    let trimmed = error_message.trim();
    let lower = trimmed.to_ascii_lowercase();
    let is_output_encoding_failure = lower.contains("unicodeencodeerror")
        || lower.contains("codec can't encode character")
        || lower.contains("skill_output_encoding_error");

    if !is_output_encoding_failure {
        return trimmed.to_string();
    }

    if prefers_chinese {
        format!("鏈湴鎶€鑳借緭鍑虹紪鐮佸け璐ワ細{}", trimmed)
    } else {
        format!("Local skill output encoding failed: {}", trimmed)
    }
}

pub(super) fn latest_tool_error_summary(
    tool_trace_blocks: &[Value],
    prefers_chinese: bool,
) -> Option<String> {
    let error_block = tool_trace_blocks.iter().rev().find(|block| {
        block.get("type").and_then(Value::as_str) == Some("tool_result")
            && block.get("status").and_then(Value::as_str) == Some("error")
    })?;

    let tool_name = error_block
        .get("toolName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown_tool");
    let error_code = error_block
        .pointer("/result/error_code")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let error_message = error_block
        .pointer("/result/error")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("tool call failed");
    let error_message = decorate_tool_error_message(error_message, prefers_chinese);

    Some(if prefers_chinese {
        match error_code {
            Some(code) => format!(
                "工具调用失败：{}。原因：{}（错误码：{}）",
                tool_name, error_message, code
            ),
            None => format!("工具调用失败：{}。原因：{}", tool_name, error_message),
        }
    } else {
        match error_code {
            Some(code) => format!(
                "Tool call failed: {}. Reason: {} (error code: {})",
                tool_name, error_message, code
            ),
            None => format!("Tool call failed: {}. Reason: {}", tool_name, error_message),
        }
    })
}

pub(super) fn derive_local_finish_reason(
    response_json: &Value,
    response_text_was_synthesized_from_error: bool,
) -> String {
    if response_text_was_synthesized_from_error {
        return "error".to_string();
    }

    match response_json
        .get("finish_reason")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some("completed") | Some("end_turn") | Some("stop") => "stop".to_string(),
        Some("max_tokens") | Some("max_output_tokens") | Some("length") => "length".to_string(),
        Some(reason) => reason.to_string(),
        None => "stop".to_string(),
    }
}
