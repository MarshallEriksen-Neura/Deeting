use super::super::execution_graph_projection::{
    project_local_execution_graph, ExecutionGraphProjection,
};
use super::super::LocalExecutionRequest;
use super::events::emit_delegation_lifecycle;
use super::{
    build_delegated_workflow_request, build_running_workflow_session,
    build_workflow_delegated_execution_session, DelegatedExecutionKind,
    DelegatedExecutionPacketReceipt, DelegatedExecutionSelection, DelegatedExecutionSession,
    DelegatedExecutionStatus,
};
use crate::modules::desktop_config::{parse_max_agentic_rounds, MAX_AGENTIC_ROUNDS_CONFIG_KEY};
use crate::modules::desktop_runtime::runtime::chat_tool_runtime::{
    build_persisted_chat_runtime_context_from_execution_request,
    serialize_delegated_workflow_runtime_context_with_task_input_source,
};
use crate::modules::desktop_runtime::runtime::worker_dispatch::{
    delegated_agent_task_input_source, render_worker_task_packet_notes, WorkerTargetSelection,
    WorkerTaskPacket,
};
use crate::modules::desktop_runtime::runtime::{
    persist_execution_graph_runtime_context, persist_execution_graph_snapshot,
};
use crate::modules::workflow::service as workflow_service;
use desktop_runtime_core::{ApprovalInheritance, DelegationReturnChannel};
use serde_json::{json, Value};
use uuid::Uuid;

pub(in crate::modules::desktop_runtime::runtime::execution_plane) async fn launch_delegated_workflow<
    F,
>(
    request: &LocalExecutionRequest,
    emit_status: &mut F,
    execution_id: &str,
    query: &str,
    selection: &WorkerTargetSelection,
    execution_selection: &DelegatedExecutionSelection,
    packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    task_packet: &WorkerTaskPacket,
    parent_frame_id: Option<String>,
) -> DelegatedExecutionSession
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    let worker_ref = format!("user_worker_profile:{}", selection.profile.id);
    let task_input_source_payload = serde_json::to_value(delegated_agent_task_input_source(
        selection,
        task_packet,
        parent_frame_id.clone(),
        None,
        DelegationReturnChannel::WorkflowEvent,
        ApprovalInheritance::ParentDecides,
    ))
    .unwrap_or(Value::Null);
    emit_delegated_workflow_launching(
        emit_status,
        execution_id,
        selection,
        execution_selection,
        worker_ref.as_str(),
    );

    match workflow_service::prepare_quick_workflow_run(
        &request.app_handle,
        &request.app_state,
        build_delegated_workflow_request(
            query.to_string(),
            worker_ref.clone(),
            render_worker_task_packet_notes(task_packet),
            request.model_connection.model_id.clone(),
            request.model_connection.provider_model_id.clone(),
            task_packet.clone(),
            task_input_source_payload.clone(),
        ),
    )
    .await
    {
        Ok(prepared_run) => {
            let prepared_task_input_source_payload = workflow_run_task_input_source(&prepared_run)
                .unwrap_or_else(|| task_input_source_payload.clone());
            persist_delegated_workflow_running_state(
                request,
                execution_id,
                query,
                selection,
                execution_selection,
                packet_receipt.clone(),
                &prepared_task_input_source_payload,
                worker_ref.as_str(),
                prepared_run.id.as_str(),
            )
            .await;
            spawn_delegated_workflow_start(request, execution_id, prepared_run.id.as_str());
            build_running_workflow_session(
                execution_id,
                selection,
                execution_selection,
                packet_receipt,
                Some(prepared_task_input_source_payload),
                worker_ref,
                prepared_run.id,
            )
        }
        Err(err) => {
            emit_delegation_lifecycle(
                emit_status,
                "worker_delegation",
                DelegatedExecutionStatus::Failed,
                execution_id,
                DelegatedExecutionKind::Workflow,
                &selection.profile.id,
                &selection.profile.name,
                Some(selection.profile.invocation_kind.as_str()),
                Some(worker_ref.as_str()),
                execution_selection.score,
                execution_selection.reason_text.as_deref(),
                None,
                Some(err.as_str()),
            );
            emit_status(
                "evolve",
                Some("worker_delegation"),
                "error",
                "worker.task.failed",
                Some(json!({
                    "agent_id": selection.profile.id.clone(),
                    "agent_name": selection.profile.name.clone(),
                    "execution_path": "workflow_runtime",
                    "error": err,
                })),
            );
            build_workflow_delegated_execution_session(
                execution_id.to_string(),
                selection.profile.clone(),
                execution_selection.clone(),
                packet_receipt,
                Some(task_input_source_payload),
                worker_ref,
                Err(err),
            )
        }
    }
}

fn workflow_run_task_input_source(
    run: &crate::modules::workflow::types::WorkflowRun,
) -> Option<Value> {
    run.snapshot_json
        .as_ref()?
        .get("phases")?
        .as_array()?
        .first()?
        .get("task_input_source")
        .cloned()
}

fn emit_delegated_workflow_launching<F>(
    emit_status: &mut F,
    execution_id: &str,
    selection: &WorkerTargetSelection,
    execution_selection: &DelegatedExecutionSelection,
    worker_ref: &str,
) where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    for status in [
        DelegatedExecutionStatus::Launching,
        DelegatedExecutionStatus::Running,
    ] {
        emit_delegation_lifecycle(
            emit_status,
            "worker_delegation",
            status,
            execution_id,
            DelegatedExecutionKind::Workflow,
            &selection.profile.id,
            &selection.profile.name,
            Some(selection.profile.invocation_kind.as_str()),
            Some(worker_ref),
            execution_selection.score,
            execution_selection.reason_text.as_deref(),
            None,
            None,
        );
    }
}

async fn persist_delegated_workflow_running_state(
    request: &LocalExecutionRequest,
    execution_id: &str,
    query: &str,
    selection: &WorkerTargetSelection,
    execution_selection: &DelegatedExecutionSelection,
    packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    task_input_source_payload: &Value,
    worker_ref: &str,
    workflow_run_id: &str,
) {
    let delegated_execution_tree = json!({
        "execution_id": execution_id,
        "execution_kind": "workflow",
        "execution_status": "running",
        "terminal_status": "running",
        "target_id": selection.profile.id.clone(),
        "target_name": selection.profile.name.clone(),
        "invocation_kind": selection.profile.invocation_kind.as_str(),
        "worker_ref": worker_ref,
        "workflow_run_id": workflow_run_id,
        "selection": {
            "explicit": request.explicit_task_agent_id.as_deref() == Some(selection.profile.id.as_str()),
            "score": execution_selection.score,
            "reason_codes": execution_selection.reason_codes.clone(),
            "reason_text": execution_selection.reason_text.clone(),
            "candidate_count": execution_selection.candidate_count,
            "selected_from_top_k": execution_selection.selected_from_top_k,
            "callable_coverage_score": execution_selection.callable_coverage_score,
            "modality_fit_score": execution_selection.modality_fit_score,
            "profile_prior_score": execution_selection.profile_prior_score,
        },
        "packet_receipt": packet_receipt,
        "task_input_source": task_input_source_payload,
        "children": [],
    });
    let graph_context = request.graph_context();
    let execution_graph = project_local_execution_graph(ExecutionGraphProjection {
        context: &graph_context,
        root_execution_id: Some(execution_id.to_string()),
        response_content: None,
        tool_trace_blocks: Vec::new(),
        delegated_execution_tree: Some(delegated_execution_tree),
    });
    let _ = persist_execution_graph_snapshot(
        request.app_state.mcp.store.as_ref(),
        &execution_graph,
        request.session_id.as_str(),
        "desktop_local_chat_delegated_workflow_running",
        request.request_id.as_deref(),
        Some("active"),
    )
    .await;
    let runtime_context = serialize_delegated_workflow_runtime_context_with_task_input_source(
        Some(format!("workflow:{workflow_run_id}")),
        None,
        workflow_run_id.to_string(),
        Some(selection.profile.id.as_str()),
        Some(selection.profile.name.as_str()),
        Some("running"),
        true,
        Some(build_persisted_chat_runtime_context_from_execution_request(
            request,
            Some(query.to_string()),
            request
                .trace_id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            parse_max_agentic_rounds(
                request
                    .app_state
                    .mcp
                    .store
                    .get_desktop_config(MAX_AGENTIC_ROUNDS_CONFIG_KEY)
                    .await
                    .ok()
                    .flatten()
                    .as_deref(),
            ),
        )),
        request.session_id.as_str(),
        request.trace_id.as_deref().unwrap_or_default(),
        request.request_id.as_deref(),
        Some(execution_id),
        None,
        Some(task_input_source_payload.clone()),
    );
    let _ = persist_execution_graph_runtime_context(
        request.app_state.mcp.store.as_ref(),
        execution_id,
        &runtime_context,
    )
    .await;
}

fn spawn_delegated_workflow_start(
    request: &LocalExecutionRequest,
    execution_id: &str,
    workflow_run_id: &str,
) {
    let app_handle = request.app_handle.clone();
    let app_state = request.app_state.clone();
    let workflow_run_id = workflow_run_id.to_string();
    let execution_id = execution_id.to_string();
    tauri::async_runtime::spawn(async move {
        if let Err(err) =
            workflow_service::start_workflow_run(&app_handle, &app_state, &workflow_run_id).await
        {
            log::warn!(
                "delegated workflow start failed execution_id={} workflow_run_id={} err={}",
                execution_id,
                workflow_run_id,
                err
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::workflow_run_task_input_source;
    use crate::modules::workflow::types::{WorkflowRun, WorkflowRunStatus};
    use serde_json::json;

    fn workflow_run_with_snapshot(snapshot_json: serde_json::Value) -> WorkflowRun {
        WorkflowRun {
            id: "workflow-run-1".to_string(),
            title: "Delegated workflow".to_string(),
            goal: "Analyze delegated work".to_string(),
            status: WorkflowRunStatus::Ready,
            proposal_text: None,
            snapshot_json: Some(snapshot_json),
            proposal_version: 1,
            snapshot_version: 1,
            run_dir: None,
            error: None,
            created_at: "2026-05-25T00:00:00Z".to_string(),
            updated_at: "2026-05-25T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn workflow_run_task_input_source_reads_prepared_snapshot_source() {
        let source = json!({
            "delegated_agent": {
                "parent_frame_id": "frame-parent-1",
                "child_run_id": "workflow:workflow-run-1:phase:phase-1",
                "child_frame_id": "frame-parent-1:delegation:workflow:workflow-run-1:phase:phase-1",
                "agent_id": "research.worker",
                "return_channel": "workflow_event"
            }
        });
        let run = workflow_run_with_snapshot(json!({
            "phases": [
                {
                    "phase_id": "phase-1",
                    "task_input_source": source.clone()
                }
            ]
        }));

        assert_eq!(workflow_run_task_input_source(&run), Some(source));
    }

    #[test]
    fn workflow_run_task_input_source_ignores_missing_snapshot_source() {
        let run = workflow_run_with_snapshot(json!({
            "phases": [
                {
                    "phase_id": "phase-1"
                }
            ]
        }));

        assert!(workflow_run_task_input_source(&run).is_none());
    }
}
