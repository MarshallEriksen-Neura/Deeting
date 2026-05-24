use crate::modules::desktop_runtime::runtime::runtime_transition::projection::runtime_transition_response_field;
use crate::modules::desktop_runtime::runtime::{
    project_execution_graph_snapshot, GraphProjectionInput, LocalExecutionPolicy,
};

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn attach_execution_graph_to_response(
    response: &mut serde_json::Value,
    session_id: &str,
    execution_policy: &LocalExecutionPolicy,
    root_execution_id: Option<&str>,
    force_rebuild: bool,
) {
    if !force_rebuild && response.get("execution_graph").is_some() {
        return;
    }
    if force_rebuild {
        if let Some(object) = response.as_object_mut() {
            object.remove("execution_graph");
        }
    }
    let tool_trace_blocks = response
        .get("tool_trace_blocks")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let trace_id = runtime_transition_response_field(response, &tool_trace_blocks, "trace_id");
    let request_id = runtime_transition_response_field(response, &tool_trace_blocks, "request_id");
    let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: session_id.to_string(),
        route: execution_policy.route.as_str().to_string(),
        phase_step_type: execution_policy.initial_phase_step_name().to_string(),
        trace_id,
        request_id,
        root_execution_id: root_execution_id.map(str::to_string),
        response_content: response.get("content").cloned(),
        tool_trace_blocks,
        delegated_execution_tree: None,
    })
    .to_value();
    if let Some(object) = response.as_object_mut() {
        object.insert("execution_graph".to_string(), execution_graph);
    }
}
