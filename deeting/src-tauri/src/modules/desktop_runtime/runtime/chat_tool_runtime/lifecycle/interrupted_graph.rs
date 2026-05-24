use super::super::tool_meta::apply_rejected_tool_result_to_execution_graph_value;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn mark_inflight_execution_interrupted(
    execution_graph: &mut serde_json::Value,
    current_call_id: Option<&str>,
    message: &str,
) {
    let execution_id = execution_graph
        .get("execution_id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    apply_rejected_tool_result_to_execution_graph_value(
        execution_graph,
        execution_id.as_deref(),
        current_call_id,
        message,
    );
    if let Some(metadata) = execution_graph
        .get_mut("metadata")
        .and_then(serde_json::Value::as_object_mut)
    {
        metadata.insert("status".to_string(), serde_json::json!("interrupted"));
        metadata.insert("interrupted_reason".to_string(), serde_json::json!(message));
    }
}
