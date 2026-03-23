use tauri::{AppHandle, Emitter};

use crate::state::AppState;
use crate::modules::workflow::context;
use crate::modules::workflow::result_packet;
use crate::modules::workflow::run_dir;
use crate::modules::workflow::store;
use crate::modules::workflow::types::{
    CompiledPhase, CreateWorkflowArtifactRequest, CreateWorkflowCheckpointRequest,
    CreateWorkflowEventRequest, CreateWorkflowStepRunRequest, ExecutionSnapshot, PhaseOutcome,
    RevalidationDecision, ResultPacket, WorkflowArtifactKind, WorkflowProgress, WorkflowRun,
    WorkflowRunStatus, WorkflowStepStatus, WorkflowStepType, WorkerExecutionInput,
};
use crate::modules::workflow::worker_adapter;

pub(crate) async fn run_workflow(
    app_handle: &AppHandle,
    app_state: &AppState,
    run_id: &str,
) -> Result<WorkflowRunStatus, String> {
    let store_ref = app_state.mcp.store.as_ref();
    let run = store::get_workflow_run(store_ref, run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("Workflow run not found: {run_id}"))?;

    if run.status != WorkflowRunStatus::Ready
        && run.status != WorkflowRunStatus::Running
    {
        return Err(format!("Cannot start run in status: {}", run.status));
    }

    let snapshot_value = run
        .snapshot_json
        .clone()
        .ok_or_else(|| "Run has no compiled snapshot".to_string())?;
    let snapshot: ExecutionSnapshot = serde_json::from_value(snapshot_value)
        .map_err(|err| format!("Invalid snapshot: {err}"))?;

    let run_dir_path = run
        .run_dir
        .as_ref()
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "Run has no run_dir".to_string())?;

    store::update_workflow_run_status(store_ref, run_id, WorkflowRunStatus::Running)
        .await
        .map_err(|err| err.to_string())?;
    emit_event(store_ref, run_id, None, "run.started", None).await;

    let existing_steps = store::list_workflow_step_runs_by_run(store_ref, run_id)
        .await
        .map_err(|err| err.to_string())?;

    let completed_phase_ids = existing_steps
        .iter()
        .filter(|step| step.status == WorkflowStepStatus::Succeeded)
        .map(|step| step.phase_id.clone())
        .collect::<std::collections::HashSet<_>>();

    let mut final_status = WorkflowRunStatus::Completed;

    for (index, phase) in snapshot.phases.iter().enumerate() {
        if completed_phase_ids.contains(&phase.phase_id) {
            continue;
        }

        if is_approval_gate(phase) {
            final_status = handle_approval_gate(store_ref, run_id, phase, index as i64).await?;
            break;
        }

        let outcome = execute_single_phase(
            app_handle,
            app_state,
            &run,
            &snapshot,
            phase,
            index as i64,
            &run_dir_path,
        )
        .await?;

        emit_progress(
            app_handle,
            run_id,
            phase,
            index as i64,
            snapshot.phases.len() as i64,
            &outcome,
        );

        if outcome.status == WorkflowStepStatus::Failed {
            final_status = WorkflowRunStatus::Failed;
            emit_event(
                store_ref,
                run_id,
                None,
                "run.failed",
                None,
            )
            .await;
            break;
        }

        if outcome.revalidation != RevalidationDecision::Continue {
            final_status = handle_revalidation(store_ref, run_id, &outcome.revalidation).await?;
            break;
        }
    }

    store::update_workflow_run_status(store_ref, run_id, final_status.clone())
        .await
        .map_err(|err| err.to_string())?;
    emit_event(
        store_ref,
        run_id,
        None,
        &format!("run.{}", final_status.as_str()),
        None,
    )
    .await;

    Ok(final_status)
}

async fn execute_single_phase(
    app_handle: &AppHandle,
    app_state: &AppState,
    run: &WorkflowRun,
    snapshot: &ExecutionSnapshot,
    phase: &CompiledPhase,
    phase_index: i64,
    run_dir_path: &std::path::Path,
) -> Result<PhaseOutcome, String> {
    let store_ref = app_state.mcp.store.as_ref();
    let run_id = &run.id;

    let step_run = store::create_workflow_step_run(
        store_ref,
        CreateWorkflowStepRunRequest {
            run_id: run_id.clone(),
            phase_id: phase.phase_id.clone(),
            phase_index,
            step_type: WorkflowStepType::WorkerCall,
            title: phase.title.clone(),
            worker_ref: Some(phase.worker_ref.clone()),
            goal: Some(phase.goal.clone()),
        },
    )
    .await
    .map_err(|err| err.to_string())?;

    store::update_workflow_step_status(store_ref, &step_run.id, WorkflowStepStatus::Running)
        .await
        .map_err(|err| err.to_string())?;
    emit_event(
        store_ref,
        run_id,
        Some(&step_run.id),
        "step.started",
        Some(serde_json::json!({ "phase_id": phase.phase_id })),
    )
    .await;

    let phase_dir = run_dir::ensure_phase_dir(run_dir_path, &phase.phase_id)?;
    let _artifacts_dir = run_dir::ensure_artifacts_dir(&phase_dir)?;

    let context_packet = context::build_context_packet(
        snapshot,
        phase,
        run_dir_path,
        &run.goal,
        run.proposal_text.as_deref().unwrap_or(""),
    )?;

    run_dir::write_context_md(&phase_dir, &context_packet.context_md)?;
    run_dir::write_context_json(&phase_dir, &context_packet.context_json)?;

    let resolved = worker_adapter::resolve_worker(store_ref, &phase.worker_ref).await?;
    emit_event(
        store_ref,
        run_id,
        Some(&step_run.id),
        "step.worker.bound",
        Some(serde_json::json!({
            "worker_ref": phase.worker_ref,
            "binding_reason": "explicit_worker_ref",
        })),
    )
    .await;

    let execution_input = WorkerExecutionInput {
        run_id: run_id.clone(),
        phase_id: phase.phase_id.clone(),
        worker_ref: phase.worker_ref.clone(),
        context_packet,
        temperature: None,
        max_tokens: None,
        max_rounds: None,
    };

    match worker_adapter::execute_phase(app_handle, app_state, &execution_input, &resolved).await {
        Ok(execution_result) => {
            let packet = result_packet::build_result_packet(
                run_id,
                &phase.phase_id,
                &phase.worker_ref,
                &execution_result,
            );
            result_packet::persist_result_packet(&phase_dir, &packet, &execution_result.content)?;

            let artifact_refs = vec![
                format!("{}/result.md", phase.phase_id),
                format!("{}/result.json", phase.phase_id),
            ];
            let completed_at = time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .map_err(|err| err.to_string())?;
            store::update_workflow_step_result(
                store_ref,
                &step_run.id,
                &artifact_refs,
                Some(&packet.summary),
                &completed_at,
            )
            .await
            .map_err(|err| err.to_string())?;

            store::create_workflow_artifact(
                store_ref,
                CreateWorkflowArtifactRequest {
                    run_id: run_id.clone(),
                    step_id: Some(step_run.id.clone()),
                    phase_id: Some(phase.phase_id.clone()),
                    artifact_kind: WorkflowArtifactKind::JsonStructured,
                    artifact_ref: Some(format!("{}/result.json", phase.phase_id)),
                    content: None,
                    metadata: Some(serde_json::json!({ "worker_ref": phase.worker_ref })),
                },
            )
            .await
            .map_err(|err| err.to_string())?;

            emit_event(
                store_ref,
                run_id,
                Some(&step_run.id),
                "step.succeeded",
                Some(serde_json::json!({ "phase_id": phase.phase_id })),
            )
            .await;
            emit_event(
                store_ref,
                run_id,
                Some(&step_run.id),
                "step.artifact.produced",
                Some(serde_json::json!({
                    "artifact_ref": format!("{}/result.json", phase.phase_id),
                    "artifact_kind": "json_structured",
                })),
            )
            .await;

            let revalidation = revalidate_remaining_phases(&packet, phase, &snapshot.phases);
            Ok(PhaseOutcome {
                phase_id: phase.phase_id.clone(),
                step_run_id: step_run.id,
                status: WorkflowStepStatus::Succeeded,
                result_packet: Some(packet),
                revalidation,
            })
        }
        Err(error) => {
            store::update_workflow_step_status(store_ref, &step_run.id, WorkflowStepStatus::Failed)
                .await
                .map_err(|err| err.to_string())?;
            emit_event(
                store_ref,
                run_id,
                Some(&step_run.id),
                "step.failed",
                Some(serde_json::json!({ "error": error })),
            )
            .await;
            Ok(PhaseOutcome {
                phase_id: phase.phase_id.clone(),
                step_run_id: step_run.id,
                status: WorkflowStepStatus::Failed,
                result_packet: None,
                revalidation: RevalidationDecision::PauseForEdit,
            })
        }
    }
}

async fn handle_approval_gate(
    store_ref: &crate::modules::mcp::store::McpStore,
    run_id: &str,
    phase: &CompiledPhase,
    phase_index: i64,
) -> Result<WorkflowRunStatus, String> {
    let step_run = store::create_workflow_step_run(
        store_ref,
        CreateWorkflowStepRunRequest {
            run_id: run_id.to_string(),
            phase_id: phase.phase_id.clone(),
            phase_index,
            step_type: WorkflowStepType::ApprovalGate,
            title: phase.title.clone(),
            worker_ref: None,
            goal: Some(phase.goal.clone()),
        },
    )
    .await
    .map_err(|err| err.to_string())?;

    store::update_workflow_step_status(
        store_ref,
        &step_run.id,
        WorkflowStepStatus::WaitingApproval,
    )
    .await
    .map_err(|err| err.to_string())?;

    store::create_workflow_checkpoint(
        store_ref,
        CreateWorkflowCheckpointRequest {
            run_id: run_id.to_string(),
            blocked_step_id: Some(step_run.id.clone()),
            reason: format!("Approval required: {}", phase.title),
            approval_payload: Some(serde_json::json!({
                "phase_id": phase.phase_id,
                "phase_title": phase.title,
                "goal": phase.goal,
            })),
        },
    )
    .await
    .map_err(|err| err.to_string())?;

    emit_event(
        store_ref,
        run_id,
        Some(&step_run.id),
        "step.waiting_approval",
        Some(serde_json::json!({ "phase_id": phase.phase_id })),
    )
    .await;

    Ok(WorkflowRunStatus::WaitingApproval)
}

pub(crate) fn revalidate_remaining_phases(
    result: &ResultPacket,
    _current_phase: &CompiledPhase,
    _all_phases: &[CompiledPhase],
) -> RevalidationDecision {
    let hints = &result.result_json.followup_hints;
    if hints.recommended_next_action == "pause_for_edit" {
        return RevalidationDecision::PauseForEdit;
    }
    if !hints.invalidates_future_phases.is_empty() {
        return RevalidationDecision::MarkInvalidated;
    }
    RevalidationDecision::Continue
}

async fn handle_revalidation(
    store_ref: &crate::modules::mcp::store::McpStore,
    run_id: &str,
    decision: &RevalidationDecision,
) -> Result<WorkflowRunStatus, String> {
    let (status, event) = match decision {
        RevalidationDecision::PauseForEdit => {
            (WorkflowRunStatus::AwaitingPlanEdit, "run.awaiting_plan_edit")
        }
        RevalidationDecision::MarkInvalidated
        | RevalidationDecision::MarkObsolete
        | RevalidationDecision::SuffixReplan => {
            (WorkflowRunStatus::AwaitingPlanEdit, "run.plan_revalidated")
        }
        RevalidationDecision::Continue => return Ok(WorkflowRunStatus::Running),
    };

    emit_event(
        store_ref,
        run_id,
        None,
        event,
        Some(serde_json::json!({ "outcome": format!("{decision:?}") })),
    )
    .await;
    Ok(status)
}

pub(crate) fn is_approval_gate(phase: &CompiledPhase) -> bool {
    phase.worker_ref.is_empty() || phase.worker_ref == "approval_gate"
}

async fn emit_event(
    store_ref: &crate::modules::mcp::store::McpStore,
    run_id: &str,
    step_id: Option<&str>,
    event_type: &str,
    payload: Option<serde_json::Value>,
) {
    let _ = store::create_workflow_event(
        store_ref,
        CreateWorkflowEventRequest {
            run_id: run_id.to_string(),
            step_id: step_id.map(|value| value.to_string()),
            event_type: event_type.to_string(),
            payload,
        },
    )
    .await;
}

fn emit_progress(
    app_handle: &AppHandle,
    run_id: &str,
    phase: &CompiledPhase,
    phase_index: i64,
    total_phases: i64,
    outcome: &PhaseOutcome,
) {
    let progress = WorkflowProgress {
        run_id: run_id.to_string(),
        phase_id: phase.phase_id.clone(),
        phase_title: phase.title.clone(),
        phase_index,
        total_phases,
        status: outcome.status.as_str().to_string(),
    };
    let _ = app_handle.emit("workflow-progress", &progress);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::workflow::types::{
        CompiledPhase, FollowupHints, ResultJson, ResultOutputs, ResultPacket,
    };

    fn sample_compiled_phase() -> CompiledPhase {
        CompiledPhase {
            phase_id: "phase-1".into(),
            title: "Research".into(),
            worker_ref: "direct_llm:default".into(),
            depends_on: vec![],
            goal: "Find stuff".into(),
            expected_output: None,
        }
    }

    fn sample_result_packet() -> ResultPacket {
        ResultPacket {
            run_id: "r1".into(),
            phase_id: "p1".into(),
            worker_ref: "direct_llm:default".into(),
            status: "succeeded".into(),
            summary: "done".into(),
            result_json: ResultJson {
                run_id: "r1".into(),
                phase_id: "p1".into(),
                worker_ref: "direct_llm:default".into(),
                status: "succeeded".into(),
                summary: "done".into(),
                outputs: ResultOutputs {
                    primary_artifact_ref: None,
                    named_outputs: std::collections::HashMap::new(),
                },
                followup_hints: FollowupHints {
                    recommended_next_action: "continue".into(),
                    invalidates_future_phases: vec![],
                },
            },
        }
    }

    #[test]
    fn is_approval_gate_detects_marker() {
        let phase = CompiledPhase {
            phase_id: "phase-2".to_string(),
            title: "User Review".to_string(),
            worker_ref: "approval_gate".to_string(),
            depends_on: vec!["phase-1".to_string()],
            goal: "Review results".to_string(),
            expected_output: None,
        };
        assert!(is_approval_gate(&phase));
    }

    #[test]
    fn is_not_approval_gate_for_normal_phase() {
        let phase = sample_compiled_phase();
        assert!(!is_approval_gate(&phase));
    }

    #[test]
    fn revalidation_continue_when_hints_continue() {
        let result = sample_result_packet();
        let phase = sample_compiled_phase();
        let decision = revalidate_remaining_phases(&result, &phase, &[phase.clone()]);
        assert_eq!(decision, RevalidationDecision::Continue);
    }

    #[test]
    fn revalidation_pauses_when_hints_pause() {
        let mut result = sample_result_packet();
        result.result_json.followup_hints.recommended_next_action = "pause_for_edit".into();
        let phase = sample_compiled_phase();
        let decision = revalidate_remaining_phases(&result, &phase, &[phase.clone()]);
        assert_eq!(decision, RevalidationDecision::PauseForEdit);
    }

    #[test]
    fn revalidation_invalidates_when_future_phases_flagged() {
        let mut result = sample_result_packet();
        result.result_json.followup_hints.invalidates_future_phases = vec!["phase-3".into()];
        let phase = sample_compiled_phase();
        let decision = revalidate_remaining_phases(&result, &phase, &[phase.clone()]);
        assert_eq!(decision, RevalidationDecision::MarkInvalidated);
    }
}
