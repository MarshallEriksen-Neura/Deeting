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
    HookEvent, Phase, PhaseExecutor, PhaseObservation, PhaseStepType, RuntimeCoreError,
    RuntimeCoreResult, WorldModelFrame,
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
        let mut request = self.request.take().ok_or_else(|| {
            RuntimeCoreError::InvalidState("deeting phase executor request already consumed".into())
        })?;
        if phase_requires_diting_think_preflight(phase) {
            request.execution_policy.require_diting_think_preflight = true;
        }
        let step_type = phase.step_type;
        let parent_frame_id = Some(frame.frame_version_id.clone());
        request.world_model_frame = Some(frame.clone());
        let outcome = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
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
        })
        .map_err(RuntimeCoreError::PhaseExecutionFailed)?;

        let observation = phase_observation_from_outcome(phase, &outcome);
        *self.outcome.borrow_mut() = Some(outcome);
        Ok(observation)
    }
}

fn phase_requires_diting_think_preflight(phase: &Phase) -> bool {
    phase
        .payload
        .get("runtime_required_artifacts")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items
                .iter()
                .any(|item| item.as_str() == Some("diting_think_preflight"))
        })
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
    let (summary, has_meaningful_output) = phase_observation_summary(phase, outcome);
    let finish_reason = extract_finish_reason(&outcome.response_json);
    let has_tool_calls = response_has_tool_calls(&outcome.response_json);
    let frame_still_valid = !response_has_hard_failure_signal(&outcome.response_json);
    let goal_satisfied = frame_still_valid
        && has_meaningful_output
        && !has_tool_calls
        && matches!(
            finish_reason.as_deref(),
            None | Some("stop") | Some("completed") | Some("end_turn")
        );

    PhaseObservation {
        observation_ref: format!("local_execution_outcome:{}", phase.phase_id),
        summary,
        goal_satisfied,
        frame_still_valid,
        hook_events: runtime_hook_events_from_outcome(outcome),
        updated_frame: outcome.world_model_frame.clone(),
    }
}

fn runtime_hook_events_from_outcome(outcome: &LocalExecutionOutcome) -> Vec<HookEvent> {
    let mut events = Vec::new();
    append_operation_proposed_events(&mut events, &outcome.response_json);
    append_context_pressure_event(&mut events, &outcome.response_json);
    append_capability_changed_events(&mut events, &outcome.response_json);
    events
}

fn append_operation_proposed_events(events: &mut Vec<HookEvent>, response_json: &Value) {
    let Some(blocks) = response_json
        .get("tool_trace_blocks")
        .and_then(Value::as_array)
    else {
        return;
    };

    for block in blocks {
        if block.get("type").and_then(Value::as_str) != Some("tool_result") {
            continue;
        }
        let status = block
            .get("status")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if !status.eq_ignore_ascii_case("requires_approval") {
            continue;
        }
        let tool_name = block
            .get("toolName")
            .or_else(|| block.get("tool_name"))
            .and_then(Value::as_str)
            .unwrap_or("operation")
            .to_string();
        let call_id = block
            .get("callId")
            .or_else(|| block.get("call_id"))
            .and_then(Value::as_str)
            .map(str::to_string);
        events.push(HookEvent::OperationProposed {
            operation: json!({
                "tool_name": tool_name,
                "call_id": call_id,
                "status": status,
                "result": block.get("result").cloned().unwrap_or(Value::Null),
            }),
            risk_class: "requires_approval".to_string(),
        });
    }
}

fn append_context_pressure_event(events: &mut Vec<HookEvent>, response_json: &Value) {
    let Some(metrics) = response_json
        .get("runtime_metrics")
        .and_then(Value::as_object)
    else {
        return;
    };
    let Some(tokens_used) = first_usize_metric(
        metrics,
        &[
            "tokens_used",
            "total_tokens",
            "context_tokens_used",
            "prompt_tokens",
        ],
    ) else {
        return;
    };
    let Some(limit) = first_usize_metric(
        metrics,
        &[
            "token_limit",
            "context_token_limit",
            "max_context_tokens",
            "limit",
        ],
    ) else {
        return;
    };
    if limit == 0 {
        return;
    }
    events.push(HookEvent::ContextPressure { tokens_used, limit });
}

fn first_usize_metric(metrics: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<usize> {
    keys.iter()
        .filter_map(|key| metrics.get(*key))
        .find_map(|value| value.as_u64().and_then(|value| usize::try_from(value).ok()))
}

fn append_capability_changed_events(events: &mut Vec<HookEvent>, response_json: &Value) {
    let mut added = Vec::new();
    let mut removed = Vec::new();

    collect_capability_changes_from_runtime_events(response_json, &mut added, &mut removed);
    collect_capability_changes_from_trace_blocks(response_json, &mut added, &mut removed);

    dedupe_strings(&mut added);
    dedupe_strings(&mut removed);
    if added.is_empty() && removed.is_empty() {
        return;
    }
    events.push(HookEvent::CapabilityChanged { added, removed });
}

fn collect_capability_changes_from_runtime_events(
    response_json: &Value,
    added: &mut Vec<String>,
    removed: &mut Vec<String>,
) {
    let Some(events) = response_json
        .get("runtime_transition_events")
        .and_then(Value::as_array)
    else {
        return;
    };
    for event in events {
        collect_capability_changes_from_transition_payload(event, added, removed);
    }
}

fn collect_capability_changes_from_trace_blocks(
    response_json: &Value,
    added: &mut Vec<String>,
    removed: &mut Vec<String>,
) {
    let Some(blocks) = response_json
        .get("tool_trace_blocks")
        .and_then(Value::as_array)
    else {
        return;
    };
    for block in blocks {
        if let Some(payload) = block.get("payload") {
            collect_capability_changes_from_transition_payload(payload, added, removed);
        }
        if block.get("type").and_then(Value::as_str) == Some("capability_transition") {
            collect_capability_change_from_capability_block(block, added, removed);
        }
    }
}

fn collect_capability_changes_from_transition_payload(
    payload: &Value,
    added: &mut Vec<String>,
    removed: &mut Vec<String>,
) {
    let metadata = payload
        .get("transition")
        .and_then(|transition| transition.get("metadata_json"))
        .unwrap_or(payload);
    if metadata.get("hook_event").and_then(Value::as_str) != Some("capability_changed") {
        return;
    }
    extend_string_array(added, metadata.get("added_capabilities"));
    extend_string_array(removed, metadata.get("removed_capabilities"));
}

fn collect_capability_change_from_capability_block(
    block: &Value,
    added: &mut Vec<String>,
    removed: &mut Vec<String>,
) {
    let Some(capability_ref) = block
        .get("capabilityName")
        .or_else(|| block.get("capability_name"))
        .or_else(|| block.get("capabilityId"))
        .or_else(|| block.get("capability_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    else {
        return;
    };
    let action = block
        .get("action")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if matches!(
        action,
        "detach" | "detached" | "remove" | "removed" | "revoke" | "revoked"
    ) {
        removed.push(capability_ref);
    } else if matches!(
        action,
        "attach"
            | "attached"
            | "add"
            | "added"
            | "admit"
            | "admitted"
            | "activate"
            | "activated"
            | "updated"
    ) {
        added.push(capability_ref);
    }
}

fn extend_string_array(target: &mut Vec<String>, value: Option<&Value>) {
    let Some(items) = value.and_then(Value::as_array) else {
        return;
    };
    target.extend(
        items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    );
}

fn dedupe_strings(items: &mut Vec<String>) {
    let mut seen = std::collections::BTreeSet::new();
    items.retain(|item| seen.insert(item.clone()));
}

fn phase_observation_summary(phase: &Phase, outcome: &LocalExecutionOutcome) -> (String, bool) {
    if let Some(summary) = response_error_summary(&outcome.response_json) {
        return (summary, false);
    }

    if let Some(content) = extract_response_text(outcome.response_json.get("content")) {
        return (content, true);
    }

    if let Some(summary) = outcome
        .delegated_execution
        .as_ref()
        .and_then(|execution| execution.record.summary.clone())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return (summary, true);
    }

    (format!("{} completed", phase.phase_id), false)
}

fn extract_response_text(value: Option<&Value>) -> Option<String> {
    let value = value?;
    let text = match value {
        Value::String(text) => text.trim().to_string(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                let object = item.as_object()?;
                if matches!(
                    object.get("type").and_then(Value::as_str),
                    Some("tool_use" | "server_tool_use")
                ) {
                    return None;
                }
                object
                    .get("text")
                    .and_then(Value::as_str)
                    .or_else(|| object.get("content").and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
            })
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string(),
        Value::Object(object) => object
            .get("text")
            .and_then(Value::as_str)
            .or_else(|| object.get("content").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or_default(),
        _ => String::new(),
    };

    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn response_error_summary(response_json: &Value) -> Option<String> {
    response_json
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| response_json.get("error").and_then(Value::as_str))
        .or_else(|| response_json.get("message").and_then(Value::as_str))
        .or_else(|| response_json.get("detail").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn response_has_hard_failure_signal(response_json: &Value) -> bool {
    if response_error_summary(response_json).is_some() {
        return true;
    }

    if matches!(
        response_json
            .get("status")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        Some("error")
    ) {
        return true;
    }

    if matches!(
        extract_finish_reason(response_json).as_deref(),
        Some("error")
    ) {
        return true;
    }

    response_json
        .get("tool_trace_blocks")
        .and_then(Value::as_array)
        .is_some_and(|blocks| blocks.iter().any(tool_trace_block_is_error))
}

fn response_has_tool_calls(response_json: &Value) -> bool {
    if response_json
        .get("tool_calls")
        .and_then(Value::as_array)
        .is_some_and(|tool_calls| !tool_calls.is_empty())
    {
        return true;
    }

    response_json
        .get("choices")
        .and_then(Value::as_array)
        .is_some_and(|choices| {
            choices.iter().any(|choice| {
                choice
                    .get("message")
                    .and_then(Value::as_object)
                    .and_then(|message| message.get("tool_calls"))
                    .and_then(Value::as_array)
                    .is_some_and(|tool_calls| !tool_calls.is_empty())
            })
        })
}

fn extract_finish_reason(response_json: &Value) -> Option<String> {
    response_json
        .get("finish_reason")
        .and_then(Value::as_str)
        .or_else(|| {
            response_json
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("finish_reason"))
                .and_then(Value::as_str)
        })
        .or_else(|| response_json.get("stop_reason").and_then(Value::as_str))
        .or_else(|| {
            response_json
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("stop_reason"))
                .and_then(Value::as_str)
        })
        .or_else(|| response_json.get("status").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn tool_trace_block_is_error(block: &Value) -> bool {
    block.get("type").and_then(Value::as_str) == Some("tool_result")
        && block
            .get("status")
            .and_then(Value::as_str)
            .map(str::trim)
            .is_some_and(|status| status.eq_ignore_ascii_case("error"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use desktop_runtime_core::PhaseStatus;
    use serde_json::json;

    fn test_phase(phase_id: &str, step_type: PhaseStepType) -> Phase {
        Phase {
            phase_id: phase_id.to_string(),
            step_type,
            payload: json!({}),
            status: PhaseStatus::Running,
            committed_at_frame_version: "frame-1".to_string(),
            observation_ref: None,
        }
    }

    fn test_outcome(response_json: serde_json::Value) -> LocalExecutionOutcome {
        LocalExecutionOutcome {
            delegated_execution: None,
            execution_graph: json!({}),
            response_json,
            captured_frame_extract: None,
            world_model_frame: None,
        }
    }

    #[test]
    fn phase_observation_marks_completed_text_response_satisfied() {
        let phase = test_phase("phase-verify-final", PhaseStepType::VerifyFinal);
        let outcome = test_outcome(json!({
            "content": "all checks passed",
            "finish_reason": "stop"
        }));

        let observation = phase_observation_from_outcome(&phase, &outcome);

        assert_eq!(observation.summary, "all checks passed");
        assert!(observation.goal_satisfied);
        assert!(observation.frame_still_valid);
    }

    #[test]
    fn phase_observation_leaves_length_truncated_response_valid_but_unsatisfied() {
        let phase = test_phase("phase-truncated", PhaseStepType::VerifyFinal);
        let outcome = test_outcome(json!({
            "content": "result truncated",
            "finish_reason": "length"
        }));

        let observation = phase_observation_from_outcome(&phase, &outcome);

        assert_eq!(observation.summary, "result truncated");
        assert!(!observation.goal_satisfied);
        assert!(observation.frame_still_valid);
    }

    #[test]
    fn phase_observation_marks_tool_error_invalid() {
        let phase = test_phase("phase-error", PhaseStepType::VerifyFinal);
        let outcome = test_outcome(json!({
            "tool_trace_blocks": [
                { "type": "tool_result", "status": "error" }
            ]
        }));

        let observation = phase_observation_from_outcome(&phase, &outcome);

        assert_eq!(observation.summary, "phase-error completed");
        assert!(!observation.goal_satisfied);
        assert!(!observation.frame_still_valid);
    }
}
