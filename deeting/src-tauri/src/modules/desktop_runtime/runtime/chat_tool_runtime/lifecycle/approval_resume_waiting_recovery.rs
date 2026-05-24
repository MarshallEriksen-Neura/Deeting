use super::super::tool_meta::build_effective_tool_call_meta;
use super::approval_graph::pending_approval_gate_ids_from_graph;
use super::approval_payloads::build_local_chat_waiting_approval_payload;
use super::approval_waiting_payload_guard::build_failed_payload_if_waiting_invariant_breaks;
use super::build_local_chat_resume_continuation_blocks;
use crate::modules::desktop_runtime::runtime::persist_execution_graph_snapshot;
use crate::state::AppState;

pub(super) async fn build_waiting_payload_after_resume(
    app_state: &AppState,
    output_response: &serde_json::Value,
    session_id: &str,
    consumed_approval_token: Option<&str>,
    resolved_gate_node_id: &str,
    resolved_call_id: &str,
    approved_tool_result: &serde_json::Value,
) -> Result<Option<serde_json::Value>, String> {
    let pending_gate_ids_after_resume = output_response
        .get("execution_graph")
        .map(pending_approval_gate_ids_from_graph)
        .unwrap_or_default();
    if pending_gate_ids_after_resume.is_empty() {
        return Ok(None);
    }

    if let Some(execution_graph) = output_response.get("execution_graph") {
        if let Err(err) = persist_execution_graph_snapshot(
            app_state.mcp.store.as_ref(),
            execution_graph,
            session_id,
            "desktop_local_chat_resume_waiting_approval",
            None,
            Some("waiting_approval"),
        )
        .await
        {
            log::warn!(
                "persist post-resume waiting execution graph failed session={} err={}",
                session_id,
                err
            );
        }
    }

    let continuation_meta = build_effective_tool_call_meta(output_response, &[]);
    let waiting_graph = output_response
        .get("execution_graph")
        .unwrap_or(&serde_json::Value::Null);
    if let Some(failed_payload) = build_failed_payload_if_waiting_invariant_breaks(
        consumed_approval_token,
        resolved_gate_node_id,
        Some(resolved_call_id),
        approved_tool_result,
        waiting_graph,
        output_response
            .get("execution_graph")
            .and_then(|value| value.get("execution_id"))
            .and_then(serde_json::Value::as_str),
    ) {
        return Ok(Some(failed_payload));
    }

    Ok(Some(build_local_chat_waiting_approval_payload(
        consumed_approval_token.unwrap_or_default(),
        resolved_gate_node_id,
        resolved_call_id,
        output_response
            .get("execution_graph")
            .unwrap_or(&serde_json::Value::Null),
        approved_tool_result,
        build_local_chat_resume_continuation_blocks(output_response, &continuation_meta),
        output_response
            .get("execution_graph")
            .and_then(|value| value.get("execution_id"))
            .and_then(serde_json::Value::as_str),
    )))
}
