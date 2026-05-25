use super::super::super::chat_completion::run_policy_scoped_chat_completion;
use super::super::super::delegation::{
    delegate_selected_custom_task_agent, launch_delegated_workflow,
    resolve_worker_delegation_execution, select_worker_delegation_for_request,
    WorkerDelegationExecution,
};
use super::super::super::user_input::{latest_user_image_input, LatestUserImageInput};
use super::super::super::{
    DelegatedExecutionPacketReceipt, DelegatedExecutionSelection, DelegatedExecutionSession,
    LocalExecutionOutcome, LocalExecutionRequest,
};
use super::super::phase_step::phase_step_type_name;
use crate::modules::desktop_runtime::runtime::worker_dispatch::{
    WorkerTargetSelection, WorkerTaskPacket,
};
use desktop_runtime_core::{
    Phase, PhaseExecutor, PhaseObservation, PhaseStepType, RuntimeCoreError, RuntimeCoreResult,
    WorldModelFrame,
};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) type SharedPhaseOutcome =
    Rc<RefCell<Option<LocalExecutionOutcome>>>;

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn shared_phase_outcome(
) -> SharedPhaseOutcome {
    Rc::new(RefCell::new(None))
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingRealPhaseExecutor<
    'a,
    F,
> where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    request: Option<LocalExecutionRequest>,
    emit_status: &'a mut F,
    outcome: SharedPhaseOutcome,
}

impl<'a, F> DeetingRealPhaseExecutor<'a, F>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn new(
        request: LocalExecutionRequest,
        emit_status: &'a mut F,
        outcome: SharedPhaseOutcome,
    ) -> Self {
        Self {
            request: Some(request),
            emit_status,
            outcome,
        }
    }
}

impl<F> PhaseExecutor for DeetingRealPhaseExecutor<'_, F>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    fn execute_phase(
        &mut self,
        frame: &WorldModelFrame,
        phase: &Phase,
    ) -> RuntimeCoreResult<PhaseObservation> {
        let request = self.request.take().ok_or_else(|| {
            RuntimeCoreError::InvalidState("deeting phase executor request already consumed".into())
        })?;
        let step_type = phase.step_type;
        let parent_frame_id = Some(frame.frame_version_id.clone());
        let outcome = tauri::async_runtime::block_on(async {
            match step_type {
                PhaseStepType::DirectChat => {
                    execute_direct_chat_phase(request, self.emit_status).await
                }
                PhaseStepType::DelegatedWorker | PhaseStepType::DelegatedWorkflow => {
                    execute_delegated_worker_phase(
                        request,
                        step_type,
                        parent_frame_id,
                        self.emit_status,
                    )
                    .await
                }
                PhaseStepType::ToolCall
                | PhaseStepType::CapabilityAdmit
                | PhaseStepType::VerifyFinal => {
                    execute_fallback_chat_phase(request, step_type, self.emit_status).await
                }
            }
        })
        .map_err(RuntimeCoreError::PhaseExecutionFailed)?;

        let observation = phase_observation_from_outcome(phase, &outcome);
        *self.outcome.borrow_mut() = Some(outcome);
        Ok(observation)
    }
}

async fn execute_direct_chat_phase<F>(
    request: LocalExecutionRequest,
    emit_status: &mut F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    run_policy_scoped_chat_completion(request.into(), None, emit_status).await
}

async fn execute_fallback_chat_phase<F>(
    request: LocalExecutionRequest,
    step_type: PhaseStepType,
    emit_status: &mut F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    emit_status(
        "evolve",
        Some("phase_executor"),
        "success",
        "runtime.phase_executor.fallback_chat_phase",
        Some(json!({
            "phase_step_type": phase_step_type_name(step_type),
            "reason": "phase_step_uses_chat_completion_adapter",
        })),
    );

    run_policy_scoped_chat_completion(request.into(), None, emit_status).await
}

async fn execute_delegated_worker_phase<F>(
    request: LocalExecutionRequest,
    step_type: PhaseStepType,
    parent_frame_id: Option<String>,
    emit_status: &mut F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    let delegated_execution =
        maybe_delegate_worker_phase(&request, step_type, parent_frame_id, emit_status).await?;
    run_policy_scoped_chat_completion(request.into(), delegated_execution, emit_status).await
}

async fn maybe_delegate_worker_phase<F>(
    request: &LocalExecutionRequest,
    step_type: PhaseStepType,
    parent_frame_id: Option<String>,
    emit_status: &mut F,
) -> Result<Option<DelegatedExecutionSession>, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    if !request.execution_policy.allow_worker_delegation {
        return Ok(None);
    }

    let latest_input = latest_user_image_input(&request.messages);
    let Some(delegation) =
        select_worker_delegation_for_request(request, emit_status, &latest_input).await?
    else {
        return Ok(None);
    };

    execute_selected_worker_delegation(
        request,
        step_type,
        parent_frame_id,
        emit_status,
        latest_input,
        delegation.execution_id,
        delegation.query,
        delegation.selection,
        delegation.execution_selection,
        delegation.packet_receipt,
        delegation.task_packet,
    )
    .await
}

async fn execute_selected_worker_delegation<F>(
    request: &LocalExecutionRequest,
    step_type: PhaseStepType,
    parent_frame_id: Option<String>,
    emit_status: &mut F,
    latest_input: LatestUserImageInput,
    execution_id: String,
    query: String,
    selection: WorkerTargetSelection,
    execution_selection: DelegatedExecutionSelection,
    packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    task_packet: WorkerTaskPacket,
) -> Result<Option<DelegatedExecutionSession>, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    match resolve_worker_delegation_execution(step_type, &selection.profile.invocation_kind) {
        WorkerDelegationExecution::Workflow => {
            let execution = launch_delegated_workflow(
                request,
                emit_status,
                execution_id.as_str(),
                query.as_str(),
                &selection,
                &execution_selection,
                packet_receipt.clone(),
                &task_packet,
                parent_frame_id.clone(),
            )
            .await;
            return Ok(Some(execution));
        }
        WorkerDelegationExecution::SkipWorkflowForNonChatInvocation => {
            emit_status(
                "evolve",
                Some("worker_delegation"),
                "success",
                "worker.workflow_route.skipped",
                Some(json!({
                    "agent_id": selection.profile.id.clone(),
                    "agent_name": selection.profile.name.clone(),
                    "reason": "non_chat_invocation_kind",
                    "invocation_kind": selection.profile.invocation_kind.as_str(),
                })),
            );
        }
        WorkerDelegationExecution::CustomTaskAgent => {}
    }

    delegate_selected_custom_task_agent(
        request,
        emit_status,
        execution_id,
        query,
        latest_input,
        selection,
        execution_selection,
        packet_receipt,
        task_packet,
        parent_frame_id,
    )
    .await
}

fn phase_observation_from_outcome(
    phase: &Phase,
    outcome: &LocalExecutionOutcome,
) -> PhaseObservation {
    let summary = outcome
        .response_json
        .get("content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .map(str::to_string)
        .or_else(|| {
            outcome
                .delegated_execution
                .as_ref()
                .and_then(|execution| execution.record.summary.clone())
        })
        .unwrap_or_else(|| format!("{} completed", phase.phase_id));

    PhaseObservation {
        observation_ref: format!("local_execution_outcome:{}", phase.phase_id),
        summary,
        goal_satisfied: true,
        frame_still_valid: true,
    }
}
