use super::super::support::*;
use super::text_utils::truncate_text_chars;

pub(crate) const LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE: &str =
    "LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED";
const LOCAL_CODE_MODE_TOOL_RESULTS_MAX_CHARS: usize = 8000;

pub(crate) fn build_local_tool_call_install_gate_error_meta(
    call_id: Option<&str>,
    tool_name: &str,
    error: &str,
) -> serde_json::Value {
    serde_json::json!({
        "id": call_id.unwrap_or_default(),
        "name": tool_name,
        "status": "error",
        "error": error,
        "error_code": LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
    })
}

pub(crate) fn extract_chat_tool_calls(response: &serde_json::Value) -> Vec<LocalChatToolCall> {
    let mut calls = Vec::new();
    if let Some(tc_array) = response
        .get("tool_calls")
        .and_then(|value| value.as_array())
    {
        for tc in tc_array {
            let id = tc
                .get("id")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string());
            let name = tc
                .get("name")
                .and_then(|value| value.as_str())
                .or_else(|| {
                    tc.get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|value| value.as_str())
                })
                .map(|value| value.to_string());
            let args = tc
                .get("arguments")
                .cloned()
                .or_else(|| {
                    tc.get("function")
                        .and_then(|f| f.get("arguments"))
                        .map(|value| {
                            if let Some(serialized) = value.as_str() {
                                serde_json::from_str(serialized).unwrap_or(serde_json::json!({}))
                            } else {
                                value.clone()
                            }
                        })
                })
                .unwrap_or(serde_json::json!({}));

            if let Some(name) = name {
                calls.push(LocalChatToolCall {
                    id,
                    name,
                    arguments: args,
                });
            }
        }
    }
    calls
}

pub(crate) fn build_auto_code_mode_tool_feedback(
    round: usize,
    tool_call_meta: &[serde_json::Value],
    results: &[String],
) -> String {
    let payload = serde_json::json!({
        "round": round,
        "tool_calls": tool_call_meta,
        "results": results,
    });
    let serialized = serde_json::to_string_pretty(&payload)
        .unwrap_or_else(|_| serde_json::json!({ "round": round, "results": results }).to_string());
    let content = format!(
        "Auto tool execution round {} completed. Continue based on these tool results. If all tasks are complete, return the final answer.\n{}",
        round, serialized
    );
    truncate_text_chars(&content, LOCAL_CODE_MODE_TOOL_RESULTS_MAX_CHARS)
}
