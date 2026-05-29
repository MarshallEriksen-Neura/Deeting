use super::super::super::chat_tool_runtime::WorldModelUpdate;
use super::super::super::runtime_event_projection::projection::merge_runtime_transition_events_into_trace_blocks;
use super::super::{DelegatedExecutionSession, DelegatedExecutionStatus, LocalExecutionOutcome};
use super::snapshot::{
    project_local_execution_graph, ExecutionGraphContext, ExecutionGraphProjection,
};
use serde_json::{json, Value};

pub(in crate::modules::desktop_runtime::runtime::execution_plane) fn running_delegated_execution_outcome(
    graph_context: &ExecutionGraphContext,
    delegated_execution: DelegatedExecutionSession,
) -> LocalExecutionOutcome {
    let execution_graph = project_local_execution_graph(ExecutionGraphProjection {
        context: graph_context,
        root_execution_id: None,
        response_content: None,
        tool_trace_blocks: delegated_execution.trace_blocks.clone(),
        delegated_execution_tree: Some(
            delegated_execution
                .record
                .status_meta_with_status(DelegatedExecutionStatus::Running),
        ),
    });
    let response_json = json!({
        "content": "",
        "tool_trace_blocks": delegated_execution.trace_blocks.clone(),
        "tool_trace_streamed": true,
        "execution_graph": execution_graph.clone(),
    });

    LocalExecutionOutcome {
        delegated_execution: Some(delegated_execution),
        execution_graph,
        response_json,
        captured_world_model_update: None,
        world_model_frame: None,
    }
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) fn completed_chat_execution_outcome(
    graph_context: &ExecutionGraphContext,
    response_json: Value,
    delegated_execution: Option<DelegatedExecutionSession>,
) -> LocalExecutionOutcome {
    let captured_world_model_update = response_json
        .get("world_model_update")
        .cloned()
        .and_then(|value| serde_json::from_value::<WorldModelUpdate>(value).ok());
    let delegated_execution_tree = delegated_execution.as_ref().map(|execution| {
        execution
            .record
            .status_meta_with_status(DelegatedExecutionStatus::Integrated)
    });
    let tool_trace_blocks = response_json
        .get("tool_trace_blocks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let tool_trace_blocks =
        merge_runtime_transition_events_into_trace_blocks(tool_trace_blocks, &response_json);
    let execution_graph = project_local_execution_graph(ExecutionGraphProjection {
        context: graph_context,
        root_execution_id: None,
        response_content: response_json.get("content").cloned(),
        tool_trace_blocks,
        delegated_execution_tree,
    });
    let mut response_json = response_json;
    if let Some(object) = response_json.as_object_mut() {
        object.insert("execution_graph".to_string(), execution_graph.clone());
    }

    LocalExecutionOutcome {
        delegated_execution,
        execution_graph,
        response_json,
        captured_world_model_update,
        world_model_frame: None,
    }
}
