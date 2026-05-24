use super::model::{DelegatedExecutionRecord, DELEGATED_RESULT_SCHEMA_VERSION};
use mcp_core::types::LocalChatInputMessage;

pub(crate) fn build_delegated_result_feedback_messages(
    record: &DelegatedExecutionRecord,
) -> Vec<LocalChatInputMessage> {
    let delegated_result = record.delegated_result();
    let delegated_result_json =
        serde_json::to_string(&delegated_result).unwrap_or_else(|_| "{}".to_string());
    let instruction = if record.is_authoritative() {
        format!(
            "The next user message is a canonical delegated_result JSON object (schema_version={}). Treat it as authoritative delegated subtask output. Prefer its structured fields over inference and do not re-run the delegated task unless the user asks or the result is blocked.",
            DELEGATED_RESULT_SCHEMA_VERSION
        )
    } else {
        format!(
            "The next user message is a canonical delegated_result JSON object (schema_version={}). It records a delegated attempt that did not succeed authoritatively. Use its structured fields for fallback reasoning and do not invent a successful delegated result.",
            DELEGATED_RESULT_SCHEMA_VERSION
        )
    };

    vec![
        LocalChatInputMessage {
            role: "system".to_string(),
            content: instruction,
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
        LocalChatInputMessage {
            role: "user".to_string(),
            content: delegated_result_json,
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
    ]
}
