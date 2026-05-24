use super::super::runtime_state::LocalChatToolRuntimeState;
use super::super::tool_meta::build_state_effective_tool_call_meta;
use super::{
    persisted_chat_runtime_context_from_state, serialize_inflight_runtime_context,
    InFlightExecutionStage,
};
use crate::modules::desktop_runtime::runtime::{
    build_local_tool_trace_blocks, persist_execution_graph_runtime_context,
    persist_execution_graph_snapshot, project_execution_graph_snapshot, GraphProjectionInput,
};

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn persist_running_tool_execution_runtime(
    store: &crate::modules::mcp::store::McpStore,
    state: &LocalChatToolRuntimeState,
    call_id: &str,
    tool_name: &str,
    tool_args: &serde_json::Value,
) -> Result<Option<String>, String> {
    let normalized_call_id = call_id.trim();
    if normalized_call_id.is_empty() {
        return Ok(None);
    }

    let mut tool_trace_blocks =
        build_local_tool_trace_blocks(&build_state_effective_tool_call_meta(state));
    tool_trace_blocks.extend(state.runtime_transition_blocks.clone());
    tool_trace_blocks.push(serde_json::json!({
        "type": "tool_call",
        "callId": normalized_call_id,
        "toolName": tool_name,
        "toolArgs": tool_args,
        "status": "running",
    }));

    let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: state.session_id.clone(),
        route: state.execution_policy.route.as_str().to_string(),
        phase_step_type: state.execution_policy.initial_phase_step_name().to_string(),
        trace_id: Some(state.trace_id.clone()),
        request_id: state.request_id.clone(),
        root_execution_id: None,
        response_content: state
            .last_response
            .as_ref()
            .and_then(|response| response.get("content").cloned()),
        tool_trace_blocks,
        delegated_execution_tree: None,
    })
    .to_value();
    let execution_id = execution_graph
        .get("execution_id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    persist_execution_graph_snapshot(
        store,
        &execution_graph,
        state.session_id.as_str(),
        "desktop_local_chat_tool_running",
        state.request_id.as_deref(),
        Some("active"),
    )
    .await
    .map_err(|err| err.to_string())?;

    if let Some(execution_id) = execution_id.as_deref() {
        let context = serialize_inflight_runtime_context(
            InFlightExecutionStage::ToolRunning,
            Some(format!("tool_call:{normalized_call_id}")),
            Some(normalized_call_id.to_string()),
            true,
            Vec::new(),
            Some(persisted_chat_runtime_context_from_state(state)),
            state.session_id.as_str(),
            state.trace_id.as_str(),
            state.request_id.as_deref(),
            Some(execution_id),
            None,
        );
        persist_execution_graph_runtime_context(store, execution_id, &context)
            .await
            .map_err(|err| err.to_string())?;
    }

    Ok(execution_id)
}
