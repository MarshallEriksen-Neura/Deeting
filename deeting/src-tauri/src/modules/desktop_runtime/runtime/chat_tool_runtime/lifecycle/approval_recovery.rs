use super::super::tool_meta::{
    strip_stale_resume_response_metadata, summarize_tool_call_meta_results,
};
use super::super::continue_local_chat_complete_with_tools;
use super::approval_resume_state::prepare_runtime_state_for_approval_resume;
use super::approval_waiting_recovery::build_waiting_payload_for_remaining_approvals;
use super::approval_resume_failed_runtime::handle_resume_failed_output;
use super::approval_resume_success_runtime::handle_resume_success_output;
use super::{
    attach_execution_graph_to_response, persist_suspended_execution_graph_runtime,
    persisted_chat_runtime_context_from_state, InFlightExecutionStage, SuspendedChatToolExecution,
};
use crate::state::AppState;
use tauri::AppHandle;

pub(super) async fn advance_local_chat_execution_from_graph_state(
    app: &AppHandle,
    app_state: &AppState,
    mut suspended: SuspendedChatToolExecution,
    consumed_approval_token: Option<&str>,
    resolved_call_id: Option<&str>,
    approved_tool_result: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let pending_response = suspended
        .last_response
        .clone()
        .unwrap_or_else(|| serde_json::json!({ "content": "" }));
    let pending_response = strip_stale_resume_response_metadata(pending_response);
    let graph_pending_tool_call_meta = suspended.pending_tool_call_meta();
    let pending_results = summarize_tool_call_meta_results(&graph_pending_tool_call_meta);
    let root_execution_id = suspended
        .execution_graph
        .get("execution_id")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let resolved_call_id = resolved_call_id
        .unwrap_or(suspended.pending_call_id())
        .trim()
        .to_string();
    let resolved_gate_node_id = suspended
        .approval_gate_node_id_for_call_id(resolved_call_id.as_str())
        .unwrap_or_else(|| suspended.pending_gate_node_id().to_string());
    let post_approval_graph = suspended.execution_graph.clone();
    let remaining_pending_call_ids = if let Some(approval_token) = consumed_approval_token {
        suspended.sync_remaining_pending_approvals(approval_token)
    } else {
        suspended.pending_requires_approval_call_ids()
    };

    if !remaining_pending_call_ids.is_empty() {
        return build_waiting_payload_for_remaining_approvals(
            app_state,
            &suspended,
            consumed_approval_token,
            resolved_gate_node_id.as_str(),
            resolved_call_id.as_str(),
            approved_tool_result,
            root_execution_id.as_deref(),
        )
        .await;
    }

    if let Err(err) = persist_suspended_execution_graph_runtime(
        app_state.mcp.store.as_ref(),
        &suspended,
        &[],
        "desktop_local_chat_approval_resuming",
        "active",
        InFlightExecutionStage::ResumingAfterApproval,
        None,
    )
    .await
    {
        log::warn!(
            "persist approved execution graph failed approval_token={} err={}",
            consumed_approval_token.unwrap_or("resume"),
            err
        );
    }

    let prepared = prepare_runtime_state_for_approval_resume(
        suspended,
        pending_response,
        &graph_pending_tool_call_meta,
        &pending_results,
    );
    let failed_chat_runtime = persisted_chat_runtime_context_from_state(&prepared.state);
    match continue_local_chat_complete_with_tools(app, app_state, prepared.state).await {
        Ok(mut output) => {
            attach_execution_graph_to_response(
                &mut output.response,
                &prepared.session_id,
                &prepared.execution_policy,
                root_execution_id.as_deref(),
                true,
            );
            handle_resume_success_output(
                app_state,
                &prepared.session_id,
                &prepared.model_connection,
                &output.response,
                consumed_approval_token,
                resolved_gate_node_id.as_str(),
                resolved_call_id.as_str(),
                approved_tool_result,
                root_execution_id.as_deref(),
            )
            .await
        }
        Err(err) => {
            handle_resume_failed_output(
                app_state,
                &prepared.session_id,
                consumed_approval_token,
                resolved_gate_node_id.as_str(),
                resolved_call_id.as_str(),
                approved_tool_result,
                &post_approval_graph,
                root_execution_id.as_deref(),
                &failed_chat_runtime,
                err.as_str(),
            )
            .await
        }
    }
}
