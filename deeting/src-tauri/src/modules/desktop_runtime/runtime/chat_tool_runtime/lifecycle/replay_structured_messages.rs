use super::super::tool_meta::{
    build_effective_tool_call_meta, tool_call_meta_matches_call_id,
};
use super::replay_content::serialize_tool_replay_content_with_options;
use crate::modules::desktop_runtime::runtime::extract_chat_tool_calls;
use crate::modules::mcp::commands::support::LocalChatInputMessage;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn build_structured_tool_replay_messages(
    protocol_family: &str,
    response: &serde_json::Value,
    tool_call_meta: &[serde_json::Value],
) -> Option<Vec<LocalChatInputMessage>> {
    if protocol_family != "openai_chat"
        && protocol_family != "openai_responses"
        && protocol_family != "anthropic_messages"
        && protocol_family != "google_gemini"
    {
        return None;
    }

    let tool_calls = extract_chat_tool_calls(response);
    if tool_calls.is_empty() {
        return None;
    }
    let effective_tool_call_meta = build_effective_tool_call_meta(response, tool_call_meta);
    if effective_tool_call_meta.is_empty() {
        return None;
    }

    let mut ordered_tool_meta = Vec::with_capacity(tool_calls.len());
    for tool_call in &tool_calls {
        let Some(call_id) = tool_call
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            log::warn!("structured tool replay skipped because a tool call is missing call_id");
            return None;
        };

        let Some(meta) = effective_tool_call_meta
            .iter()
            .find(|item| tool_call_meta_matches_call_id(item, call_id))
        else {
            log::warn!(
                "structured tool replay skipped because tool output is missing for call_id={}",
                call_id
            );
            return None;
        };

        ordered_tool_meta.push((call_id.to_string(), meta));
    }

    let assistant_content = response
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let assistant_reasoning_content = response
        .get("reasoning_content")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let mut messages = Vec::with_capacity(1 + ordered_tool_meta.len());
    messages.push(LocalChatInputMessage {
        role: "assistant".to_string(),
        content: assistant_content,
        reasoning_content: assistant_reasoning_content,
        tool_calls,
        tool_call_id: None,
        name: None,
    });

    let preserve_structured_envelope = tool_call_meta.is_empty()
        && response
            .get("execution_graph")
            .is_some_and(|value| !value.is_null());

    for (call_id, item) in ordered_tool_meta {
        messages.push(LocalChatInputMessage {
            role: "tool".to_string(),
            content: serialize_tool_replay_content_with_options(item, preserve_structured_envelope),
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: Some(call_id),
            name: item
                .get("name")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string()),
        });
    }

    Some(messages)
}
