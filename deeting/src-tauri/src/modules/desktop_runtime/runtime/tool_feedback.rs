use crate::modules::conversations::text_utils::truncate_text_chars;
use crate::modules::mcp::commands::support::*;

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE: &str =
    "LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED";
const LOCAL_TOOL_LOOP_RESULTS_MAX_CHARS: usize = usize::MAX;

#[cfg_attr(not(test), allow(dead_code))]
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
                    extra_content: tc.get("extra_content").cloned(),
                });
            }
        }
    }

    // Fallback: Parse tool calls from reasoning_content if official tool_calls is empty
    if calls.is_empty() {
        if let Some(reasoning) = response.get("reasoning_content").and_then(|v| v.as_str()) {
            let mut current_pos = 0;
            while let Some(begin_idx) = reasoning[current_pos..].find("<|tool_call_begin|>") {
                let absolute_begin = current_pos + begin_idx;
                let name_start = absolute_begin + "<|tool_call_begin|>".len();

                let Some(arg_begin_idx) =
                    reasoning[name_start..].find("<|tool_call_argument_begin|>")
                else {
                    break;
                };
                let absolute_arg_begin = name_start + arg_begin_idx;
                let raw_name = reasoning[name_start..absolute_arg_begin].trim();

                let arg_json_start = absolute_arg_begin + "<|tool_call_argument_begin|>".len();
                let Some(end_idx) = reasoning[arg_json_start..].find("<|tool_call_end|>") else {
                    break;
                };
                let absolute_end = arg_json_start + end_idx;
                let arg_json = reasoning[arg_json_start..absolute_end].trim();

                current_pos = absolute_end + "<|tool_call_end|>".len();

                if !raw_name.is_empty() {
                    let (name, id) = if let Some(colon_idx) = raw_name.find(':') {
                        (
                            raw_name[..colon_idx].to_string(),
                            Some(raw_name[colon_idx + 1..].to_string()),
                        )
                    } else {
                        (raw_name.to_string(), None)
                    };

                    let arguments =
                        serde_json::from_str(arg_json).unwrap_or_else(|_| serde_json::json!({}));
                    calls.push(LocalChatToolCall {
                        id,
                        name,
                        arguments,
                        extra_content: None,
                    });
                }
            }
        }
    }

    calls
}

pub(crate) fn build_tool_loop_feedback(
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
        "Tool execution round {} completed. Use these tool results as private context to answer the user's original request directly. Do not narrate internal tool rounds, approval state, verification steps, or runtime capability discovery unless the user explicitly asked for those details. If the task is done, return only the final user-facing answer.\n{}",
        round, serialized
    );
    truncate_text_chars(&content, LOCAL_TOOL_LOOP_RESULTS_MAX_CHARS)
}
