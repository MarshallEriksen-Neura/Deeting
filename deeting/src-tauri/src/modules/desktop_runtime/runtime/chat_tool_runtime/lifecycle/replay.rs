use super::super::tool_meta::build_effective_tool_call_meta;
use super::derive_capability_update_from_tool_call_meta;
use super::replay_capability::apply_capability_update;
use super::replay_structured_messages::build_structured_tool_replay_messages;
use crate::modules::desktop_runtime::runtime::{
    build_tool_loop_feedback, LocalCapabilityActivationState,
};
use crate::modules::mcp::commands::support::LocalChatInputMessage;
pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn finalize_tool_round(
    orchestrated_messages: &mut Vec<LocalChatInputMessage>,
    active_capability: &mut Option<LocalCapabilityActivationState>,
    protocol_family: &str,
    round: usize,
    response: &serde_json::Value,
    tool_call_meta: &[serde_json::Value],
    results: &[String],
) {
    apply_capability_update(
        orchestrated_messages,
        active_capability,
        derive_capability_update_from_tool_call_meta(tool_call_meta),
    );

    if let Some(replay_messages) =
        build_structured_tool_replay_messages(protocol_family, response, tool_call_meta)
    {
        orchestrated_messages.extend(replay_messages);
        return;
    }

    let effective_tool_call_meta = build_effective_tool_call_meta(response, tool_call_meta);
    let tool_feedback = build_tool_loop_feedback(round, &effective_tool_call_meta, results);
    let assistant_content = response
        .get("content")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
    let assistant_reasoning_content = response
        .get("reasoning_content")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if !assistant_content.is_empty() {
        orchestrated_messages.push(LocalChatInputMessage {
            role: "assistant".to_string(),
            content: assistant_content,
            reasoning_content: assistant_reasoning_content,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        });
    }
    orchestrated_messages.push(LocalChatInputMessage {
        role: "user".to_string(),
        content: tool_feedback,
        reasoning_content: None,
        tool_calls: vec![],
        tool_call_id: None,
        name: None,
    });
}
