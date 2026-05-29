use super::super::execution_graph_projection::{
    project_local_execution_graph, ExecutionGraphContext, ExecutionGraphProjection,
};
use super::super::LocalExecutionOutcome;
use super::{DelegatedExecutionSession, DelegatedExecutionStatus};
use serde_json::json;

pub(in crate::modules::desktop_runtime::runtime::execution_plane) fn should_return_delegated_result_directly(
    explicit_task_agent_id: Option<&str>,
    execution: &DelegatedExecutionSession,
) -> bool {
    let Some(explicit_task_agent_id) = explicit_task_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    if explicit_task_agent_id != execution.record.target.id.as_str() {
        return false;
    }
    if execution.record.status == DelegatedExecutionStatus::Running {
        return false;
    }

    matches!(
        execution.record.target.invocation_kind.as_deref(),
        Some("image_generation" | "text_to_speech")
    )
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) fn build_direct_delegated_execution_outcome(
    graph_context: &ExecutionGraphContext,
    execution: DelegatedExecutionSession,
) -> LocalExecutionOutcome {
    let tool_trace_blocks = execution.trace_blocks.clone();
    let execution_graph = project_local_execution_graph(ExecutionGraphProjection {
        context: graph_context,
        root_execution_id: None,
        response_content: None,
        tool_trace_blocks: tool_trace_blocks.clone(),
        delegated_execution_tree: Some(
            execution
                .record
                .status_meta_with_status(DelegatedExecutionStatus::Integrated),
        ),
    });
    let response_json = json!({
        "content": "",
        "tool_trace_blocks": tool_trace_blocks,
        "tool_trace_streamed": true,
        "execution_graph": execution_graph.clone(),
        "delegated_direct_return": true,
    });

    LocalExecutionOutcome {
        delegated_execution: Some(execution),
        execution_graph,
        response_json,
        captured_world_model_update: None,
        world_model_frame: None,
    }
}
