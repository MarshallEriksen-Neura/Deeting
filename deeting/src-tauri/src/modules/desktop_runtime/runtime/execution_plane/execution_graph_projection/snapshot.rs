use super::super::super::{project_execution_graph_snapshot, GraphProjectionInput};
use serde_json::Value;

#[derive(Debug, Clone)]
pub(in crate::modules::desktop_runtime::runtime::execution_plane) struct ExecutionGraphContext {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) session_id: String,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) route: String,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) phase_step_type: String,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) trace_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) request_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) root_execution_id: Option<String>,
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) struct ExecutionGraphProjection<'a> {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) context: &'a ExecutionGraphContext,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) response_content: Option<Value>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) tool_trace_blocks: Vec<Value>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) delegated_execution_tree: Option<Value>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) root_execution_id: Option<String>,
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) fn project_local_execution_graph(input: ExecutionGraphProjection<'_>) -> Value {
    let context = input.context;
    project_execution_graph_snapshot(GraphProjectionInput {
        session_id: context.session_id.clone(),
        route: context.route.clone(),
        phase_step_type: context.phase_step_type.clone(),
        trace_id: context.trace_id.clone(),
        request_id: context.request_id.clone(),
        root_execution_id: input
            .root_execution_id
            .or_else(|| context.root_execution_id.clone()),
        response_content: input.response_content,
        tool_trace_blocks: input.tool_trace_blocks,
        delegated_execution_tree: input.delegated_execution_tree,
    })
    .to_value()
}
