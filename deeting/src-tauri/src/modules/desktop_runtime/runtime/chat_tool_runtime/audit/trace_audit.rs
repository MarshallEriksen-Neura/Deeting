use crate::modules::desktop_runtime::runtime::{
    persist_execution_graph_snapshot, project_execution_graph_snapshot, GraphProjectionInput,
};
use crate::modules::mcp::store::McpStore;

use super::super::lifecycle::SuspendedChatToolExecution;
use super::super::lifecycle::{
    build_pending_approval_records_from_tool_call_meta, persist_suspended_execution_graph_runtime,
    InFlightExecutionStage,
};
use super::super::tool_meta::attach_graph_metadata_to_pending_tool_meta;

#[allow(clippy::too_many_arguments)]
pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn persist_delegate_task_execution_graph_snapshot(
    store: &McpStore,
    session_id: &str,
    route: &str,
    phase_step_type: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_id: &str,
    runtime_transition_blocks: &[serde_json::Value],
    delegated_execution_tree: serde_json::Value,
) {
    let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: session_id.to_string(),
        route: route.to_string(),
        phase_step_type: phase_step_type.to_string(),
        trace_id: Some(trace_id.to_string()),
        request_id: request_id.map(str::to_string),
        root_execution_id: Some(execution_id.to_string()),
        response_content: None,
        tool_trace_blocks: runtime_transition_blocks.to_vec(),
        delegated_execution_tree: Some(delegated_execution_tree),
    })
    .to_value();

    let _ = persist_execution_graph_snapshot(
        store,
        &execution_graph,
        session_id,
        "desktop_local_chat_delegate_task",
        request_id,
        Some("complete"),
    )
    .await;
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn persist_waiting_approval_execution_graph(
    store: &McpStore,
    suspended: &SuspendedChatToolExecution,
    tool_call_meta: &mut [serde_json::Value],
    session_id: &str,
) {
    attach_graph_metadata_to_pending_tool_meta(tool_call_meta, suspended);
    let persisted_pending_approvals =
        build_pending_approval_records_from_tool_call_meta(tool_call_meta, session_id);

    if let Err(err) = persist_suspended_execution_graph_runtime(
        store,
        suspended,
        &persisted_pending_approvals,
        "desktop_local_chat_waiting_approval",
        "waiting_approval",
        InFlightExecutionStage::WaitingApproval,
        None,
    )
    .await
    {
        log::warn!(
            "persist_suspended_execution_graph_runtime failed session={} err={}",
            session_id,
            err
        );
    }
}
