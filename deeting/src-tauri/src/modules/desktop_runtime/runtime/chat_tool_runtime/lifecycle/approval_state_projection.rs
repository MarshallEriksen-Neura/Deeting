use super::approval_graph::pending_approval_call_ids_from_graph;
use super::approval_state_fallback_payload::{
    build_resume_failed_fallback_payload, build_stale_waiting_graph_fallback_payload,
    build_terminal_fallback_no_identity_payload,
};
use super::{
    build_local_chat_resume_continuation_blocks, persistable_inflight_context_from_value,
    InFlightExecutionStage,
};
use super::super::tool_meta::build_tool_call_meta_from_execution_graph;
use crate::modules::desktop_runtime::runtime::{
    load_execution_graph_runtime_context, load_execution_graph_snapshot,
};
use crate::state::AppState;

pub(crate) async fn project_local_chat_approval_state_payload(
    app_state: &AppState,
    execution_graph_execution_id: &str,
    fallback_error: Option<&str>,
) -> Result<Option<serde_json::Value>, String> {
    let normalized_execution_id = execution_graph_execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Ok(None);
    }

    let Some(execution_graph) =
        load_execution_graph_snapshot(app_state.mcp.store.as_ref(), normalized_execution_id)
            .await
            .map_err(|err| err.to_string())?
    else {
        return Ok(None);
    };

    let persisted =
        load_execution_graph_runtime_context(app_state.mcp.store.as_ref(), normalized_execution_id)
            .await
            .map_err(|err| err.to_string())?
            .and_then(|value| persistable_inflight_context_from_value(&value));
    let continuation_blocks = build_local_chat_resume_continuation_blocks(
        &serde_json::json!({
            "execution_graph": execution_graph.clone(),
            "content": "",
        }),
        &build_tool_call_meta_from_execution_graph(&execution_graph),
    );
    let pending_call_ids = pending_approval_call_ids_from_graph(&execution_graph);

    if !pending_call_ids.is_empty() {
        return Ok(Some(build_stale_waiting_graph_fallback_payload(
            normalized_execution_id,
            &execution_graph,
            fallback_error,
        )));
    }

    if persisted
        .as_ref()
        .is_some_and(|context| context.stage == InFlightExecutionStage::ResumeFailed)
    {
        let error = persisted
            .as_ref()
            .and_then(|context| context.last_error.clone())
            .or_else(|| fallback_error.map(str::to_string));
        let payload = build_resume_failed_fallback_payload(
            normalized_execution_id,
            &execution_graph,
            continuation_blocks,
            error.as_deref(),
        );
        return Ok(Some(payload));
    }

    Ok(Some(build_terminal_fallback_no_identity_payload(
        normalized_execution_id,
        &execution_graph,
        fallback_error,
    )))
}
