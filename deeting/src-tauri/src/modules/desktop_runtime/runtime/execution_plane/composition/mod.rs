mod components;
mod hooks;
pub(super) mod phase_step;

use self::components::phase_executor_impl::{shared_phase_outcome, DeetingRealPhaseExecutor};
use self::components::policy_hook_adapters::build_deeting_policy_hook_registry;
use self::components::runtime_components::{
    task_id_from_request, user_input_from_request, DeetingBootstrapPrompt,
    DeetingFrameArtifactGenerator, DeetingInterruptionChannel, DeetingPhaseProposalGenerator,
    DeetingRuntimeEventStore, DeetingTier2Validator,
};
use self::phase_step::{
    initial_phase_step_for_policy, phase_step_for_observable_frame_strategy, phase_step_type_name,
};
use super::super::control_plane::LocalExecutionPolicy;
use super::super::e3_readiness;
use super::{LocalExecutionOutcome, LocalExecutionRequest};
use crate::modules::desktop_runtime::runtime::chat_tool_runtime::apply_world_model_update_to_frame;
use desktop_runtime_core::{
    HookDecision, HookEvent, PhaseStepType, RuntimeComponents, RuntimeComposition, RuntimeEvent,
    RuntimeStopReason, RuntimeTickResult, TaskInputSource, WorldModelFrame,
};
use serde_json::{json, Value};

pub(crate) async fn run_local_runtime_composition<F>(
    request: LocalExecutionRequest,
    mut emit_status: F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    emit_status(
        "evolve",
        Some("phase_executor"),
        "success",
        "runtime.phase_executor.selected",
        Some(json!({
            "phase_step_source": "world_model_frame",
            "composition": "deeting_runtime_phase_composition",
        })),
    );

    let task_id = task_id_from_request(&request);
    let input = user_input_from_request(&request, task_id.clone());
    let task_input_source = request.task_input_source.clone();
    let user_interruption = request.user_interruption.clone();
    let phase_outcome = shared_phase_outcome();
    let hook_store = request.app_state.mcp.store.clone();
    let runtime_event_store = DeetingRuntimeEventStore::default();
    let frame_resolution_policy = request.execution_policy.clone();
    let goal = super::user_input::latest_contiguous_user_messages(&request.messages)
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| "local runtime request".to_string());
    emit_status(
        "evolve",
        Some("world_model_frame"),
        "running",
        "world_model.frame.bootstrap",
        Some(json!({
            "task_input_source_kind": task_input_source_kind(&task_input_source),
            "composition": "deeting_runtime_phase_composition",
            "goal": goal,
        })),
    );
    let result = {
        let components = RuntimeComponents {
            bootstrap: DeetingBootstrapPrompt::new(request.clone(), task_id, hook_store.clone()),
            validator: DeetingTier2Validator::with_runtime_request(request.clone()),
            frame_generator: DeetingFrameArtifactGenerator::new(request.clone()),
            phase_proposal_generator: DeetingPhaseProposalGenerator::new(),
            phase_executor: DeetingRealPhaseExecutor::new(
                request,
                &mut emit_status,
                phase_outcome.clone(),
            ),
            interruptions: DeetingInterruptionChannel::new(user_interruption),
            event_store: runtime_event_store.clone(),
            hook_registry: build_deeting_policy_hook_registry(hook_store),
        };
        let mut runtime = RuntimeComposition::new(components);
        runtime.tick(input).map_err(|err| err.to_string())?
    };
    let runtime_events = runtime_event_store.events();

    let frame_resolved_payload = frame_resolved_status_payload(&frame_resolution_policy, &result);
    emit_status(
        "evolve",
        Some("phase_executor"),
        "success",
        "runtime.phase_executor.frame_resolved",
        Some(frame_resolved_payload.clone()),
    );

    let mut outcome = phase_outcome.borrow_mut().take().ok_or_else(|| {
        "runtime composition completed without local execution outcome".to_string()
    })?;
    attach_runtime_result_to_outcome(
        &mut outcome,
        &result,
        &task_input_source,
        &runtime_events,
        &frame_resolved_payload,
    );
    Ok(outcome)
}

fn frame_resolved_status_payload(
    execution_policy: &LocalExecutionPolicy,
    result: &RuntimeTickResult,
) -> Value {
    let legacy_policy_step = execution_policy.initial_phase_step;
    let effective_policy_step = initial_phase_step_for_policy(execution_policy);
    let frame_step = phase_step_for_observable_frame_strategy(result.frame.execution_strategy);
    let committed_step = result
        .plan
        .committed_phases
        .first()
        .map(|phase| phase.step_type);
    let frame_step_name = frame_step.map(phase_step_type_name);
    let committed_step_name = committed_step.map(phase_step_type_name);
    let legacy_policy_step_name = phase_step_type_name(legacy_policy_step);
    let effective_policy_step_name = phase_step_type_name(effective_policy_step);
    let alignment_payload =
        frame_phase_policy_alignment_payload(legacy_policy_step, effective_policy_step, frame_step);
    let sample_eligible = frame_step.is_some();
    let sample_exclusion_reason = frame_step_sample_exclusion_reason(frame_step);

    json!({
        "frame_strategy": result.frame.execution_strategy,
        "derived_phase_step_type": frame_step_name,
        "phase_committed_count": result.plan.committed_phases.len(),
        "committed_phase_step_type": committed_step_name,
        "final_answer_present": result.final_answer.is_some(),
        "phase_policy": {
            "runtime_owner": "world_model_runtime_owner",
            "policy_observation_role": "legacy_phase_shadow",
            "policy_live_control_signal": false,
            "evidence_label": "historical_runtime_evidence",
            "initial_phase_step": legacy_policy_step_name,
            "effective_phase_step": effective_policy_step_name,
            "prefer_workflow_runtime": execution_policy.prefer_workflow_runtime,
            "allow_worker_delegation": execution_policy.allow_worker_delegation,
        },
        "world_model_frame": {
            "execution_strategy": result.frame.execution_strategy,
            "derived_phase_step_type": frame_step_name,
        },
        "execution_phase": {
            "first_committed_phase_step_type": committed_step_name,
        },
        "stop_reason": result.stop_reason.map(RuntimeStopReason::as_str),
        "phase_policy_alignment": alignment_payload,
        "e3_readiness": {
            "metric": e3_readiness::FRAME_PHASE_ALIGNMENT_METRIC,
            "contract_schema_version": e3_readiness::CONTRACT_SCHEMA_VERSION,
            "sample_eligible": sample_eligible,
            "sample_exclusion_reason": sample_exclusion_reason,
            "minimum_overlap_ratio": e3_readiness::MINIMUM_OVERLAP_RATIO,
            "minimum_non_direct_strategy_ratio": e3_readiness::MINIMUM_NON_DIRECT_STRATEGY_RATIO,
            "minimum_observation_window_ms": e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS,
            "observation_window": e3_readiness::OBSERVATION_WINDOW_LABEL,
            "requires_observation_window": true,
            "requires_strategy_distribution": true,
        },
    })
}

fn frame_step_sample_exclusion_reason(frame_step: Option<PhaseStepType>) -> Option<&'static str> {
    if frame_step.is_some() {
        None
    } else {
        Some(e3_readiness::FRAME_STRATEGY_STEP_MISSING)
    }
}

fn frame_phase_policy_alignment_payload(
    legacy_policy_step: PhaseStepType,
    effective_policy_step: PhaseStepType,
    frame_step: Option<PhaseStepType>,
) -> Value {
    let legacy_policy_step_name = phase_step_type_name(legacy_policy_step);
    let effective_policy_step_name = phase_step_type_name(effective_policy_step);
    let frame_step_name = frame_step.map(phase_step_type_name);
    let phase_step_aligned = frame_step
        .map(|step| step == effective_policy_step)
        .unwrap_or(false);
    let alignment_status = match frame_step {
        Some(step) if step == effective_policy_step => e3_readiness::PHASE_ALIGNMENT_MATCHED,
        Some(_) => e3_readiness::PHASE_ALIGNMENT_MISMATCHED,
        None => e3_readiness::FRAME_STRATEGY_STEP_MISSING,
    };
    let sample_eligible = frame_step.is_some();
    let sample_exclusion_reason = frame_step_sample_exclusion_reason(frame_step);

    json!({
        "phase_step_aligned": phase_step_aligned,
        "status": alignment_status,
        "sample_eligible": sample_eligible,
        "sample_exclusion_reason": sample_exclusion_reason,
        "comparison_basis": e3_readiness::LEGACY_EFFECTIVE_PHASE_STEP_BASIS,
        "comparison_role": "legacy_phase_shadow",
        "policy_live_control_signal": false,
        "legacy_initial_phase_step": legacy_policy_step_name,
        "legacy_effective_phase_step": effective_policy_step_name,
        "frame_derived_phase_step": frame_step_name,
    })
}

fn attach_runtime_result_to_outcome(
    outcome: &mut LocalExecutionOutcome,
    result: &RuntimeTickResult,
    task_input_source: &TaskInputSource,
    runtime_events: &[RuntimeEvent],
    frame_resolved_payload: &Value,
) {
    let committed_phases = result.plan.committed_phases.clone();
    let frame = apply_world_model_update_to_frame(
        result.frame.clone(),
        outcome.captured_world_model_update.as_ref(),
    );
    let summary = json!({
        "frame_version_id": frame.frame_version_id.clone(),
        "plan_id": result.plan.plan_id.clone(),
        "fingerprint_key": frame.fingerprint_key.clone(),
        "committed_phases": committed_phases,
        "execution_strategy": frame.execution_strategy,
        "task_input_source": task_input_source,
        "validation": result.validation.clone(),
        "decision": result.decision.clone(),
        "final_answer": result.final_answer.clone(),
        "stop_reason": result.stop_reason.map(RuntimeStopReason::as_str),
    });
    let artifact = json!({
        "summary": summary,
        "frame": frame.clone(),
        "plan": result.plan.clone(),
    });

    if let Some(object) = outcome.execution_graph.as_object_mut() {
        let metadata = object
            .entry("metadata".to_string())
            .or_insert_with(|| json!({}));
        if let Some(metadata_object) = metadata.as_object_mut() {
            metadata_object.insert(
                "frame_version_id".to_string(),
                Value::String(frame.frame_version_id.clone()),
            );
            metadata_object.insert(
                "plan_id".to_string(),
                Value::String(result.plan.plan_id.clone()),
            );
            metadata_object.insert(
                "fingerprint_key".to_string(),
                frame
                    .fingerprint_key
                    .clone()
                    .map(Value::String)
                    .unwrap_or(Value::Null),
            );
            metadata_object.insert(
                "committed_phases".to_string(),
                serde_json::to_value(&result.plan.committed_phases).unwrap_or(Value::Null),
            );
            metadata_object.insert(
                "task_input_source".to_string(),
                serde_json::to_value(task_input_source).unwrap_or(Value::Null),
            );
            metadata_object.insert("runtime_composition".to_string(), artifact.clone());
            metadata_object.insert(
                "runtime_phase_resolution".to_string(),
                frame_resolved_payload.clone(),
            );
            metadata_object.insert(
                "runtime_stop_reason".to_string(),
                result
                    .stop_reason
                    .map(RuntimeStopReason::as_str)
                    .map(|reason| Value::String(reason.to_string()))
                    .unwrap_or(Value::Null),
            );
        }
        append_runtime_core_events(object, runtime_events);
        append_runtime_frame_committed_event(object, &frame, result, task_input_source);
    }

    if let Some(object) = outcome.response_json.as_object_mut() {
        object.insert(
            "runtime_composition".to_string(),
            artifact.get("summary").cloned().unwrap_or(Value::Null),
        );
        object.insert(
            "execution_graph".to_string(),
            outcome.execution_graph.clone(),
        );
    }
}

fn append_runtime_core_events(
    execution_graph: &mut serde_json::Map<String, Value>,
    runtime_events: &[RuntimeEvent],
) {
    if runtime_events.is_empty() {
        return;
    }

    let events = execution_graph
        .entry("events".to_string())
        .or_insert_with(|| json!([]));
    let Some(events) = events.as_array_mut() else {
        return;
    };

    for (index, event) in runtime_events.iter().enumerate() {
        let event_type = runtime_event_type(event);
        let graph_event = json!({
            "event_id": format!("event:runtime_core:{index}:{event_type}"),
            "node_id": Value::Null,
            "event_type": event_type,
            "payload": runtime_core_event_payload(event, event_type),
        });
        events.push(graph_event);
    }
}

fn runtime_core_event_payload(event: &RuntimeEvent, event_type: &str) -> Value {
    let mut payload = json!({
        "event_type": event_type,
        "source_kind": "runtime_composition",
    });

    let Some(payload_object) = payload.as_object_mut() else {
        return payload;
    };

    match event {
        RuntimeEvent::UserInputReceived {
            session_id,
            task_id,
        } => {
            payload_object.insert("session_id".to_string(), Value::String(session_id.clone()));
            payload_object.insert("task_id".to_string(), Value::String(task_id.clone()));
        }
        RuntimeEvent::HookEventObserved { event } => {
            payload_object.insert(
                "hook_event_kind".to_string(),
                Value::String(hook_event_kind(event).to_string()),
            );
            append_hook_event_projection(payload_object, event);
        }
        RuntimeEvent::FrameBootstrapped { frame_version_id } => {
            payload_object.insert(
                "frame_version_id".to_string(),
                Value::String(frame_version_id.clone()),
            );
        }
        RuntimeEvent::HookDecisionRecorded { boundary, decision } => {
            payload_object.insert("boundary".to_string(), Value::String(boundary.clone()));
            payload_object.insert(
                "decision_kind".to_string(),
                Value::String(hook_decision_kind(decision).to_string()),
            );
            payload_object.insert(
                "required_artifact".to_string(),
                hook_decision_required_artifact(decision)
                    .map(Value::String)
                    .unwrap_or(Value::Null),
            );
            payload_object.insert(
                "decision".to_string(),
                serde_json::to_value(decision).unwrap_or(Value::Null),
            );
        }
        RuntimeEvent::PlanCreated { plan_id } => {
            payload_object.insert("plan_id".to_string(), Value::String(plan_id.clone()));
        }
        RuntimeEvent::PhaseProposed { proposal_id } => {
            payload_object.insert(
                "proposal_id".to_string(),
                Value::String(proposal_id.clone()),
            );
        }
        RuntimeEvent::PhaseCommitted { phase_id } => {
            payload_object.insert("phase_id".to_string(), Value::String(phase_id.clone()));
        }
        RuntimeEvent::PhaseObserved {
            phase_id,
            observation_ref,
        } => {
            payload_object.insert("phase_id".to_string(), Value::String(phase_id.clone()));
            payload_object.insert(
                "observation_ref".to_string(),
                Value::String(observation_ref.clone()),
            );
        }
        RuntimeEvent::FrameRefreshed { frame_version_id } => {
            payload_object.insert(
                "frame_version_id".to_string(),
                Value::String(frame_version_id.clone()),
            );
        }
        RuntimeEvent::InterruptionQueued { interruption_id } => {
            payload_object.insert(
                "interruption_id".to_string(),
                Value::String(interruption_id.clone()),
            );
        }
        RuntimeEvent::FinalAnswerReady { reason } => {
            payload_object.insert("reason".to_string(), Value::String(reason.clone()));
        }
        RuntimeEvent::RuntimeStopped { reason } => {
            payload_object.insert("reason".to_string(), Value::String(reason.clone()));
        }
    }

    payload
}

fn hook_event_kind(event: &HookEvent) -> &'static str {
    match event {
        HookEvent::CommitBoundary(_) => "commit_boundary",
        HookEvent::PhaseObserved { .. } => "phase_observed",
        HookEvent::OperationProposed { .. } => "operation_proposed",
        HookEvent::ContextPressure { .. } => "context_pressure",
        HookEvent::PhaseCompleted { .. } => "phase_completed",
        HookEvent::CapabilityChanged { .. } => "capability_changed",
        HookEvent::UserInterrupted { .. } => "user_interrupted",
        HookEvent::TaskInitiated { .. } => "task_initiated",
        HookEvent::AsyncObservationArrived { .. } => "async_observation_arrived",
    }
}

fn append_hook_event_projection(payload: &mut serde_json::Map<String, Value>, event: &HookEvent) {
    match event {
        HookEvent::CommitBoundary(boundary) => {
            payload.insert(
                "boundary".to_string(),
                Value::String(format!("{boundary:?}")),
            );
        }
        HookEvent::PhaseObserved { phase_id, .. } => {
            payload.insert("phase_id".to_string(), Value::String(phase_id.clone()));
            payload.insert("has_observation".to_string(), Value::Bool(true));
        }
        HookEvent::OperationProposed { risk_class, .. } => {
            payload.insert("risk_class".to_string(), Value::String(risk_class.clone()));
            payload.insert("has_operation".to_string(), Value::Bool(true));
        }
        HookEvent::ContextPressure { tokens_used, limit } => {
            payload.insert("tokens_used".to_string(), json!(tokens_used));
            payload.insert("limit".to_string(), json!(limit));
        }
        HookEvent::PhaseCompleted {
            phase_id,
            candidate_memory_facts,
        } => {
            payload.insert("phase_id".to_string(), Value::String(phase_id.clone()));
            payload.insert(
                "candidate_memory_fact_count".to_string(),
                json!(candidate_memory_facts.len()),
            );
        }
        HookEvent::CapabilityChanged { added, removed } => {
            payload.insert("added_count".to_string(), json!(added.len()));
            payload.insert("removed_count".to_string(), json!(removed.len()));
        }
        HookEvent::UserInterrupted { .. } => {
            payload.insert("has_message".to_string(), Value::Bool(true));
        }
        HookEvent::TaskInitiated { source } => {
            payload.insert(
                "task_input_source_kind".to_string(),
                Value::String(task_input_source_kind(source).to_string()),
            );
        }
        HookEvent::AsyncObservationArrived {
            phase_id,
            awaiting_id,
            ..
        } => {
            payload.insert("phase_id".to_string(), Value::String(phase_id.clone()));
            payload.insert(
                "awaiting_id".to_string(),
                Value::String(awaiting_id.clone()),
            );
            payload.insert("has_observation".to_string(), Value::Bool(true));
        }
    }
}

fn hook_decision_kind(decision: &HookDecision) -> &'static str {
    match decision {
        HookDecision::Allow { .. } => "allow",
        HookDecision::RequireArtifact { .. } => "require_artifact",
        HookDecision::RequestFrameValidation { .. } => "request_frame_validation",
        HookDecision::RequestContextCompression { .. } => "request_context_compression",
        HookDecision::RequestMemoryWrite { .. } => "request_memory_write",
        HookDecision::RequireUserApproval { .. } => "require_user_approval",
        HookDecision::DeferUntilStable { .. } => "defer_until_stable",
        HookDecision::Block { .. } => "block",
        HookDecision::Composite { .. } => "composite",
    }
}

fn hook_decision_required_artifact(decision: &HookDecision) -> Option<String> {
    match decision {
        HookDecision::RequireArtifact { artifact, .. } => serde_json::to_value(artifact)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string)),
        HookDecision::Composite { decisions } => {
            decisions.iter().find_map(hook_decision_required_artifact)
        }
        _ => None,
    }
}

fn runtime_event_type(event: &RuntimeEvent) -> &'static str {
    match event {
        RuntimeEvent::UserInputReceived { .. } => "runtime_core.user_input_received",
        RuntimeEvent::HookEventObserved { .. } => "runtime_core.hook_event_observed",
        RuntimeEvent::FrameBootstrapped { .. } => "runtime_core.frame_bootstrapped",
        RuntimeEvent::HookDecisionRecorded { .. } => "runtime_core.hook_decision_recorded",
        RuntimeEvent::PlanCreated { .. } => "runtime_core.plan_created",
        RuntimeEvent::PhaseProposed { .. } => "runtime_core.phase_proposed",
        RuntimeEvent::PhaseCommitted { .. } => "runtime_core.phase_committed",
        RuntimeEvent::PhaseObserved { .. } => "runtime_core.phase_observed",
        RuntimeEvent::FrameRefreshed { .. } => "runtime_core.frame_refreshed",
        RuntimeEvent::InterruptionQueued { .. } => "runtime_core.interruption_queued",
        RuntimeEvent::FinalAnswerReady { .. } => "runtime_core.final_answer_ready",
        RuntimeEvent::RuntimeStopped { .. } => "runtime_core.runtime_stopped",
    }
}

fn append_runtime_frame_committed_event(
    execution_graph: &mut serde_json::Map<String, Value>,
    frame: &WorldModelFrame,
    result: &RuntimeTickResult,
    task_input_source: &TaskInputSource,
) {
    let frame_id = frame.frame_version_id.trim();
    if frame_id.is_empty() {
        return;
    }

    let event_id = format!("event:world_model_frame:{frame_id}:committed");
    let committed_phase_ids = result
        .plan
        .committed_phases
        .iter()
        .map(|phase| phase.phase_id.clone())
        .collect::<Vec<_>>();
    let event = json!({
        "event_id": event_id,
        "node_id": Value::Null,
        "event_type": "world_model_frame.committed",
        "payload": {
            "event_type": "world_model_frame.committed",
            "frame_id": frame.frame_version_id.clone(),
            "parent_frame_id": frame.parent_frame_id.clone(),
            "source_kind": "runtime_composition",
            "session_id": frame.session_id.clone(),
            "task_id": frame.task_id.clone(),
            "fingerprint_key": frame.fingerprint_key.clone(),
            "status": serde_json::to_value(frame.status).unwrap_or(Value::Null),
            "execution_strategy": serde_json::to_value(frame.execution_strategy).unwrap_or(Value::Null),
            "plan_id": result.plan.plan_id.clone(),
            "plan_status": serde_json::to_value(result.plan.plan_status).unwrap_or(Value::Null),
            "committed_phase_ids": committed_phase_ids,
            "provenance": frame.provenance.clone(),
            "task_input_source_kind": task_input_source_kind(task_input_source),
            "task_input_source_ref": "execution_graph.metadata.task_input_source",
        }
    });

    let events = execution_graph
        .entry("events".to_string())
        .or_insert_with(|| json!([]));
    let Some(events) = events.as_array_mut() else {
        return;
    };
    if let Some(existing) = events
        .iter_mut()
        .find(|event| event.get("event_id").and_then(Value::as_str) == Some(event_id.as_str()))
    {
        *existing = event;
    } else {
        events.push(event);
    }
}

fn task_input_source_kind(task_input_source: &TaskInputSource) -> &'static str {
    match task_input_source {
        TaskInputSource::UserChat => "user_chat",
        TaskInputSource::CronMonitor { .. } => "cron_monitor",
        TaskInputSource::DelegatedAgent { .. } => "delegated_agent",
        TaskInputSource::AgentDelegation { .. } => "agent_delegation",
        TaskInputSource::ScheduledWakeup { .. } => "scheduled_wakeup",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use desktop_runtime_core::{
        ExecutionStrategy, FrameProvenance, FrameValidation, HookDecision, HookEnforcementMode,
        Phase, PhaseStatus, PhaseStepType, PlanArtifact, RequiredArtifact,
    };
    use serde_json::json;

    fn test_execution_policy(
        initial_phase_step: PhaseStepType,
        worker_delegation: bool,
    ) -> LocalExecutionPolicy {
        LocalExecutionPolicy {
            initial_phase_step,
            allowed_tool_names: Vec::new(),
            inject_execution_protocol: worker_delegation,
            allow_worker_delegation: worker_delegation,
            prefer_workflow_runtime: false,
            require_world_model_update: false,
            capability_snapshot: None,
        }
    }

    fn test_frame(
        goal: &str,
        strategy: ExecutionStrategy,
        runtime_evidence: &str,
    ) -> WorldModelFrame {
        WorldModelFrame::new(
            "frame-session-task",
            "session-1",
            "task-1",
            goal,
            strategy,
            FrameProvenance {
                produced_by: "deeting_runtime_composition".to_string(),
                reason: "bootstrap frame from local execution request".to_string(),
                evidence_refs: vec![runtime_evidence.to_string()],
            },
        )
    }

    fn test_tick_result(frame: WorldModelFrame, plan: PlanArtifact) -> RuntimeTickResult {
        RuntimeTickResult {
            frame,
            plan,
            validation: FrameValidation {
                is_valid: true,
                reason: "accepted".to_string(),
            },
            decision: HookDecision::Allow {
                reason: "allowed".to_string(),
            },
            final_answer: Some("done".to_string()),
            stop_reason: None,
        }
    }

    fn test_committed_phase(frame: &WorldModelFrame, step_type: PhaseStepType) -> Phase {
        Phase {
            phase_id: "phase-1".to_string(),
            step_type,
            payload: json!({"source":"test"}),
            status: PhaseStatus::Done,
            committed_at_frame_version: frame.frame_version_id.clone(),
            observation_ref: Some("observation-1".to_string()),
        }
    }

    #[test]
    fn frame_phase_policy_alignment_payload_marks_overlap_status() {
        assert_eq!(
            frame_phase_policy_alignment_payload(
                PhaseStepType::DirectChat,
                PhaseStepType::DirectChat,
                Some(PhaseStepType::DirectChat),
            ),
            json!({
                "phase_step_aligned": true,
                "status": "matched",
                "sample_eligible": true,
                "sample_exclusion_reason": null,
                "comparison_basis": "legacy_effective_phase_step",
                "comparison_role": "legacy_phase_shadow",
                "policy_live_control_signal": false,
                "legacy_initial_phase_step": "direct_chat",
                "legacy_effective_phase_step": "direct_chat",
                "frame_derived_phase_step": "direct_chat",
            })
        );
        assert_eq!(
            frame_phase_policy_alignment_payload(
                PhaseStepType::DirectChat,
                PhaseStepType::DirectChat,
                Some(PhaseStepType::DelegatedWorker),
            ),
            json!({
                "phase_step_aligned": false,
                "status": "mismatched",
                "sample_eligible": true,
                "sample_exclusion_reason": null,
                "comparison_basis": "legacy_effective_phase_step",
                "comparison_role": "legacy_phase_shadow",
                "policy_live_control_signal": false,
                "legacy_initial_phase_step": "direct_chat",
                "legacy_effective_phase_step": "direct_chat",
                "frame_derived_phase_step": "delegated_worker",
            })
        );
        assert_eq!(
            frame_phase_policy_alignment_payload(
                PhaseStepType::DelegatedWorker,
                PhaseStepType::DelegatedWorker,
                None,
            ),
            json!({
                "phase_step_aligned": false,
                "status": "missing_frame_strategy_step",
                "sample_eligible": false,
                "sample_exclusion_reason": "missing_frame_strategy_step",
                "comparison_basis": "legacy_effective_phase_step",
                "comparison_role": "legacy_phase_shadow",
                "policy_live_control_signal": false,
                "legacy_initial_phase_step": "delegated_worker",
                "legacy_effective_phase_step": "delegated_worker",
                "frame_derived_phase_step": null,
            })
        );
        assert_eq!(
            frame_phase_policy_alignment_payload(
                PhaseStepType::DelegatedWorker,
                PhaseStepType::DelegatedWorkflow,
                Some(PhaseStepType::DelegatedWorkflow),
            ),
            json!({
                "phase_step_aligned": true,
                "status": "matched",
                "sample_eligible": true,
                "sample_exclusion_reason": null,
                "comparison_basis": "legacy_effective_phase_step",
                "comparison_role": "legacy_phase_shadow",
                "policy_live_control_signal": false,
                "legacy_initial_phase_step": "delegated_worker",
                "legacy_effective_phase_step": "delegated_workflow",
                "frame_derived_phase_step": "delegated_workflow",
            })
        );
    }

    #[test]
    fn frame_resolved_status_payload_matches_direct_frame_without_committed_phase() {
        let frame = test_frame(
            "answer directly",
            ExecutionStrategy::DirectIteration,
            "phase:direct_chat",
        );
        let plan = PlanArtifact::new("plan-1", frame.frame_version_id.clone());
        let result = test_tick_result(frame, plan);
        let execution_policy = test_execution_policy(PhaseStepType::DirectChat, false);

        let payload = frame_resolved_status_payload(&execution_policy, &result);

        assert_eq!(
            payload.pointer("/world_model_frame/derived_phase_step_type"),
            Some(&json!("direct_chat"))
        );
        assert_eq!(
            payload.pointer("/execution_phase/first_committed_phase_step_type"),
            Some(&Value::Null)
        );
        assert_eq!(
            payload.pointer("/phase_policy_alignment/status"),
            Some(&json!("matched"))
        );
        assert_eq!(
            payload.pointer("/phase_policy_alignment/frame_derived_phase_step"),
            Some(&json!("direct_chat"))
        );
        assert_eq!(
            payload.pointer("/e3_readiness/sample_eligible"),
            Some(&json!(true))
        );
        assert_eq!(
            payload.pointer("/e3_readiness/contract_schema_version"),
            Some(&json!(1))
        );
        assert_eq!(
            payload.pointer("/e3_readiness/minimum_overlap_ratio"),
            Some(&json!(0.95))
        );
        assert_eq!(
            payload.pointer("/e3_readiness/minimum_observation_window_ms"),
            Some(&json!(604800000))
        );
    }

    #[test]
    fn frame_resolved_status_payload_records_effective_policy_phase_step() {
        let frame = test_frame(
            "run the workflow",
            ExecutionStrategy::DelegatedWorkflow,
            "phase:delegated_worker",
        );
        let mut plan = PlanArtifact::new("plan-1", frame.frame_version_id.clone());
        plan.committed_phases.push(test_committed_phase(
            &frame,
            PhaseStepType::DelegatedWorkflow,
        ));
        let result = test_tick_result(frame, plan);
        let mut execution_policy = test_execution_policy(PhaseStepType::DelegatedWorker, true);
        execution_policy.prefer_workflow_runtime = true;

        let payload = frame_resolved_status_payload(&execution_policy, &result);

        assert_eq!(
            payload.pointer("/phase_policy/initial_phase_step"),
            Some(&json!("delegated_worker"))
        );
        assert_eq!(
            payload.pointer("/phase_policy/effective_phase_step"),
            Some(&json!("delegated_workflow"))
        );
        assert_eq!(
            payload.pointer("/phase_policy_alignment/status"),
            Some(&json!("matched"))
        );
        assert_eq!(
            payload.pointer("/phase_policy_alignment/legacy_effective_phase_step"),
            Some(&json!("delegated_workflow"))
        );
        assert_eq!(
            payload.pointer("/e3_readiness/sample_eligible"),
            Some(&json!(true))
        );
    }

    #[test]
    fn frame_resolved_status_payload_projects_runtime_stop_reason() {
        let frame = test_frame(
            "verify the answer",
            ExecutionStrategy::DirectIteration,
            "phase:verify_final",
        );
        let plan = PlanArtifact::new("plan-1", frame.frame_version_id.clone());
        let mut result = test_tick_result(frame, plan);
        result.final_answer = None;
        result.stop_reason = Some(RuntimeStopReason::VerificationTargetUnsatisfied);
        let execution_policy = test_execution_policy(PhaseStepType::DirectChat, false);

        let payload = frame_resolved_status_payload(&execution_policy, &result);

        assert_eq!(
            payload.pointer("/stop_reason"),
            Some(&json!("verification_target_unsatisfied"))
        );
        assert_eq!(
            payload.pointer("/final_answer_present"),
            Some(&json!(false))
        );
    }

    #[test]
    fn frame_resolved_status_payload_excludes_hybrid_from_overlap_samples() {
        let frame = test_frame(
            "mix direct and workflow handling",
            ExecutionStrategy::Hybrid,
            "phase:delegated_worker",
        );
        let plan = PlanArtifact::new("plan-1", frame.frame_version_id.clone());
        let result = test_tick_result(frame, plan);
        let execution_policy = test_execution_policy(PhaseStepType::DelegatedWorker, true);

        let payload = frame_resolved_status_payload(&execution_policy, &result);

        assert_eq!(
            payload.pointer("/world_model_frame/derived_phase_step_type"),
            Some(&Value::Null)
        );
        assert_eq!(
            payload.pointer("/phase_policy_alignment/status"),
            Some(&json!("missing_frame_strategy_step"))
        );
        assert_eq!(
            payload.pointer("/phase_policy_alignment/sample_eligible"),
            Some(&json!(false))
        );
        assert_eq!(
            payload.pointer("/phase_policy_alignment/sample_exclusion_reason"),
            Some(&json!("missing_frame_strategy_step"))
        );
        assert_eq!(
            payload.pointer("/e3_readiness/sample_eligible"),
            Some(&json!(false))
        );
        assert_eq!(
            payload.pointer("/e3_readiness/sample_exclusion_reason"),
            Some(&json!("missing_frame_strategy_step"))
        );
    }

    #[test]
    fn attach_runtime_result_to_outcome_records_committed_frame_event() {
        let mut frame = test_frame(
            "answer the user",
            ExecutionStrategy::DirectIteration,
            "phase:direct_chat",
        );
        frame.fingerprint_key = Some("fingerprint-1".to_string());

        let mut plan = PlanArtifact::new("plan-1", frame.frame_version_id.clone());
        plan.committed_phases
            .push(test_committed_phase(&frame, PhaseStepType::DirectChat));
        plan.complete();

        let result = test_tick_result(frame.clone(), plan);
        let mut outcome = LocalExecutionOutcome {
            delegated_execution: None,
            execution_graph: json!({
                "execution_id": "exec-1",
                "events": [],
                "metadata": {}
            }),
            response_json: json!({"content":"done"}),
            captured_world_model_update: None,
            world_model_frame: None,
        };

        let runtime_events = vec![
            RuntimeEvent::FrameBootstrapped {
                frame_version_id: "frame-session-task".to_string(),
            },
            RuntimeEvent::HookDecisionRecorded {
                boundary: "ProposeNextPhase".to_string(),
                decision: HookDecision::RequireArtifact {
                    artifact: RequiredArtifact::PlanRevision,
                    reason: "plan changed after frame evidence".to_string(),
                    enforcement: HookEnforcementMode::Enforced,
                },
            },
            RuntimeEvent::PhaseCommitted {
                phase_id: "phase-1".to_string(),
            },
            RuntimeEvent::RuntimeStopped {
                reason: "verification_target_unsatisfied".to_string(),
            },
        ];
        let execution_policy = test_execution_policy(PhaseStepType::DirectChat, false);
        let frame_resolved_payload = frame_resolved_status_payload(&execution_policy, &result);
        attach_runtime_result_to_outcome(
            &mut outcome,
            &result,
            &TaskInputSource::UserChat,
            &runtime_events,
            &frame_resolved_payload,
        );

        let graph = outcome
            .response_json
            .get("execution_graph")
            .expect("response graph");
        assert_eq!(
            graph.pointer("/metadata/frame_version_id"),
            Some(&json!("frame-session-task"))
        );
        assert_eq!(
            graph.pointer("/metadata/runtime_composition/frame/frame_version_id"),
            Some(&json!("frame-session-task"))
        );
        assert_eq!(
            graph.pointer("/metadata/runtime_phase_resolution/phase_policy_alignment/status"),
            Some(&json!("matched"))
        );
        assert_eq!(
            graph.pointer("/metadata/runtime_phase_resolution/e3_readiness/metric"),
            Some(&json!("frame_phase_step_alignment"))
        );
        assert_eq!(
            graph.pointer("/metadata/runtime_phase_resolution/e3_readiness/sample_eligible"),
            Some(&json!(true))
        );
        assert_eq!(
            graph
                .pointer("/metadata/runtime_phase_resolution/e3_readiness/contract_schema_version"),
            Some(&json!(1))
        );
        assert_eq!(
            graph.pointer(
                "/metadata/runtime_phase_resolution/e3_readiness/minimum_observation_window_ms"
            ),
            Some(&json!(604800000))
        );

        let event = graph
            .get("events")
            .and_then(Value::as_array)
            .and_then(|events| {
                events.iter().find(|event| {
                    event.get("event_type") == Some(&json!("world_model_frame.committed"))
                })
            })
            .expect("committed frame event");
        assert_eq!(
            event.get("event_id"),
            Some(&json!(
                "event:world_model_frame:frame-session-task:committed"
            ))
        );
        assert_eq!(
            event.pointer("/payload/frame_id"),
            Some(&json!("frame-session-task"))
        );
        assert_eq!(
            event.pointer("/payload/source_kind"),
            Some(&json!("runtime_composition"))
        );
        assert_eq!(event.pointer("/payload/plan_id"), Some(&json!("plan-1")));
        assert_eq!(
            event.pointer("/payload/committed_phase_ids/0"),
            Some(&json!("phase-1"))
        );
        assert_eq!(
            event.pointer("/payload/task_input_source_kind"),
            Some(&json!("user_chat"))
        );
        assert_eq!(
            event.pointer("/payload/task_input_source_ref"),
            Some(&json!("execution_graph.metadata.task_input_source"))
        );
        assert!(event.pointer("/payload/task_input_source").is_none());
        assert!(event.pointer("/payload/frame").is_none());

        let core_event = graph
            .get("events")
            .and_then(Value::as_array)
            .and_then(|events| {
                events.iter().find(|event| {
                    event.get("event_type") == Some(&json!("runtime_core.frame_bootstrapped"))
                })
            })
            .expect("runtime core frame event");
        assert_eq!(
            core_event.get("event_id"),
            Some(&json!(
                "event:runtime_core:0:runtime_core.frame_bootstrapped"
            ))
        );
        assert_eq!(
            core_event.pointer("/payload/frame_version_id"),
            Some(&json!("frame-session-task"))
        );
        assert!(core_event.pointer("/payload/runtime_event").is_none());

        let hook_decision_event = graph
            .get("events")
            .and_then(Value::as_array)
            .and_then(|events| {
                events.iter().find(|event| {
                    event.get("event_type") == Some(&json!("runtime_core.hook_decision_recorded"))
                })
            })
            .expect("runtime core hook decision event");
        assert_eq!(
            hook_decision_event.pointer("/payload/boundary"),
            Some(&json!("ProposeNextPhase"))
        );
        assert_eq!(
            hook_decision_event.pointer("/payload/decision_kind"),
            Some(&json!("require_artifact"))
        );
        assert_eq!(
            hook_decision_event.pointer("/payload/required_artifact"),
            Some(&json!("plan_revision"))
        );
        assert_eq!(
            hook_decision_event.pointer("/payload/decision/require_artifact/artifact"),
            Some(&json!("plan_revision"))
        );
        assert!(hook_decision_event
            .pointer("/payload/runtime_event")
            .is_none());

        let runtime_stopped_event = graph
            .get("events")
            .and_then(Value::as_array)
            .and_then(|events| {
                events.iter().find(|event| {
                    event.get("event_type") == Some(&json!("runtime_core.runtime_stopped"))
                })
            })
            .expect("runtime stopped event");
        assert_eq!(
            runtime_stopped_event.pointer("/payload/reason"),
            Some(&json!("verification_target_unsatisfied"))
        );
    }
}
