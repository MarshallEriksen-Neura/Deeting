use super::resume_response_text::extract_resume_response_text;
use crate::modules::desktop_runtime::runtime::{
    build_local_tool_trace_blocks, project_execution_graph_blocks_from_value,
};

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn build_local_chat_resume_continuation_blocks(
    resumed_response: &serde_json::Value,
    continuation_meta: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    let mut blocks = if continuation_meta.is_empty() {
        resumed_response
            .get("tool_trace_blocks")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .filter(|items| !items.is_empty())
            .unwrap_or_else(|| {
                resumed_response
                    .get("execution_graph")
                    .map(project_execution_graph_blocks_from_value)
                    .unwrap_or_default()
            })
    } else {
        build_local_tool_trace_blocks(continuation_meta)
    };
    let response_text = extract_resume_response_text(
        resumed_response
            .get("content")
            .unwrap_or(&serde_json::Value::Null),
    );
    if !response_text.trim().is_empty() {
        blocks.push(serde_json::json!({
            "type": "text",
            "content": response_text,
        }));
    }
    blocks
}
