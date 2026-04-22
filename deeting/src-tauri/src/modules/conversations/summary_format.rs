use super::text_utils::truncate_text_chars;
use mcp_session::conversation::LocalConversationHistoryMessage;

pub(crate) const LOCAL_CONVERSATION_SUMMARY_MAX_CHARS: usize = usize::MAX;
pub(crate) const LOCAL_CONVERSATION_SUMMARY_PROMPT_INPUT_MAX_CHARS: usize = 12000;
pub(crate) const LOCAL_CONVERSATION_SUMMARY_FALLBACK_RECENT_MESSAGES: usize = 8;

fn extract_text_from_history_message(message: &LocalConversationHistoryMessage) -> Option<String> {
    message
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
}

fn build_local_summary_source_lines(
    messages: &[LocalConversationHistoryMessage],
    max_items: Option<usize>,
) -> Vec<String> {
    let mut lines = Vec::new();
    for message in messages {
        let role = message.role.trim();
        let Some(text) = extract_text_from_history_message(message) else {
            continue;
        };
        lines.push(format!("{}: {}", role, text));
        if max_items.map(|value| lines.len() >= value).unwrap_or(false) {
            break;
        }
    }
    lines
}

pub(crate) fn build_local_summary_from_window(
    messages: &[LocalConversationHistoryMessage],
) -> String {
    let lines = build_local_summary_source_lines(
        messages,
        Some(LOCAL_CONVERSATION_SUMMARY_FALLBACK_RECENT_MESSAGES),
    );
    if lines.is_empty() {
        return String::new();
    }
    let joined = lines.join("\n");
    truncate_text_chars(&joined, LOCAL_CONVERSATION_SUMMARY_MAX_CHARS)
}

pub(crate) fn build_local_summary_prompt_input(
    messages: &[LocalConversationHistoryMessage],
) -> String {
    let lines = build_local_summary_source_lines(messages, None);
    if lines.is_empty() {
        return String::new();
    }
    truncate_text_chars(
        &lines.join("\n"),
        LOCAL_CONVERSATION_SUMMARY_PROMPT_INPUT_MAX_CHARS,
    )
}
