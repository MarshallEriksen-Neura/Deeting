use super::resume_response_text::extract_resume_response_text;
use crate::modules::desktop_runtime::runtime::project_execution_graph_blocks_from_value;
use crate::modules::mcp::commands::common_impl::LocalModelConnection;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn build_persisted_resume_assistant_blocks(
    resumed_response: &serde_json::Value,
) -> Vec<serde_json::Value> {
    let mut blocks = resumed_response
        .get("tool_trace_blocks")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            resumed_response
                .get("execution_graph")
                .map(project_execution_graph_blocks_from_value)
                .unwrap_or_default()
        });

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

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn build_persisted_resume_assistant_meta(
    resumed_response: &serde_json::Value,
    model_connection: &LocalModelConnection,
) -> serde_json::Value {
    let mut meta = serde_json::Map::new();
    let blocks = build_persisted_resume_assistant_blocks(resumed_response);
    if !blocks.is_empty() {
        meta.insert("blocks".to_string(), serde_json::Value::Array(blocks));
    }
    meta.insert(
        "model_id".to_string(),
        serde_json::Value::String(model_connection.model_id.clone()),
    );
    meta.insert(
        "provider_model_id".to_string(),
        serde_json::Value::String(model_connection.provider_model_id.clone()),
    );
    if let Some(runtime_metrics) = resumed_response.get("runtime_metrics").cloned() {
        meta.insert("runtime_metrics".to_string(), runtime_metrics);
    }
    if let Some(execution_graph) = resumed_response.get("execution_graph").cloned() {
        meta.insert("execution_graph".to_string(), execution_graph);
    }
    serde_json::Value::Object(meta)
}
