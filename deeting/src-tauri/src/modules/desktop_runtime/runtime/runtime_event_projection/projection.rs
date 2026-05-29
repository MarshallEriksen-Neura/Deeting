use super::artifact::RuntimeTransitionCorrelationOutcome;
use super::trace_contract::project_runtime_transition_trace_verdicts;
use super::types::{
    EffectScope, EvidenceRef, HookDecision, HookEnforcementMode, ProposedAction, RequiredArtifact,
    RuntimeStateKind, RuntimeTransition, TransitionSource,
};
use mcp_core::types::LocalChatToolCall;
use serde_json::{json, Value};

pub(crate) const RUNTIME_TRANSITION_DECISION_EVENT_TYPE: &str = "runtime_transition.decision";
pub(crate) const RUNTIME_TRANSITION_DECISION_BLOCK_TYPE: &str = "runtime_transition_decision";
pub(crate) const RUNTIME_TRANSITION_CORRELATION_EVENT_TYPE: &str = "runtime_transition.correlation";
pub(crate) const RUNTIME_TRANSITION_CORRELATION_BLOCK_TYPE: &str = "runtime_transition_correlation";

#[derive(Debug, Clone)]
pub(crate) struct ToolCallProposalProjectionInput<'a> {
    pub(crate) trace_id: &'a str,
    pub(crate) request_id: Option<&'a str>,
    pub(crate) session_id: &'a str,
    pub(crate) round: usize,
    pub(crate) tool_calls: &'a [LocalChatToolCall],
}

#[derive(Debug, Clone)]
pub(crate) struct CapabilityExposureProjectionInput<'a> {
    pub(crate) trace_id: &'a str,
    pub(crate) request_id: Option<&'a str>,
    pub(crate) session_id: &'a str,
    pub(crate) call_id: &'a str,
    pub(crate) query: &'a str,
    pub(crate) full_payload: &'a Value,
}

#[derive(Debug, Clone)]
pub(crate) struct CapabilityAdmitProjectionInput<'a> {
    pub(crate) trace_id: &'a str,
    pub(crate) request_id: Option<&'a str>,
    pub(crate) session_id: &'a str,
    pub(crate) call_id: &'a str,
    pub(crate) query: &'a str,
    pub(crate) added_capabilities: &'a [String],
    pub(crate) removed_capabilities: &'a [String],
    pub(crate) full_payload: &'a Value,
}

#[derive(Debug, Clone)]
pub(crate) struct CapabilityContractProjectionInput<'a> {
    pub(crate) trace_id: &'a str,
    pub(crate) request_id: Option<&'a str>,
    pub(crate) session_id: &'a str,
    pub(crate) call_id: &'a str,
    pub(crate) allowed_tools: &'a [String],
    pub(crate) capability_snapshot: &'a Value,
}

#[derive(Debug, Clone)]
pub(crate) struct FinalAnswerProjectionInput<'a> {
    pub(crate) trace_id: &'a str,
    pub(crate) request_id: Option<&'a str>,
    pub(crate) session_id: &'a str,
    pub(crate) response_has_verification_evidence: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct ExecutionObservationProjectionInput<'a> {
    pub(crate) trace_id: &'a str,
    pub(crate) request_id: Option<&'a str>,
    pub(crate) session_id: &'a str,
    pub(crate) tool_call_meta: &'a [Value],
    pub(crate) result_count: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct MonitorCheckpointProjectionInput<'a> {
    pub(crate) monitor_task_id: &'a str,
    pub(crate) monitor_execution_id: &'a str,
    pub(crate) strategy_tag: Option<&'a str>,
    pub(crate) observations: &'a [String],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorldModelFrameKind {
    Refresh,
    Revision,
}

impl WorldModelFrameKind {
    fn slug(self) -> &'static str {
        match self {
            WorldModelFrameKind::Refresh => "refresh",
            WorldModelFrameKind::Revision => "revision",
        }
    }

    fn required_artifact(self) -> RequiredArtifact {
        match self {
            WorldModelFrameKind::Refresh => RequiredArtifact::WorldModelFrameRefresh,
            WorldModelFrameKind::Revision => RequiredArtifact::WorldModelFrameRevision,
        }
    }

    fn reason(self) -> &'static str {
        match self {
            WorldModelFrameKind::Refresh => {
                "world_model_update refreshed the world model frame"
            }
            WorldModelFrameKind::Revision => {
                "world_model_update revised the world model frame after contradiction"
            }
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct WorldModelFrameProjectionInput<'a> {
    pub(crate) trace_id: &'a str,
    pub(crate) request_id: Option<&'a str>,
    pub(crate) session_id: &'a str,
    pub(crate) frame_kind: WorldModelFrameKind,
    pub(crate) intent: Option<&'a str>,
    pub(crate) fact_count: usize,
    pub(crate) assumption_count: usize,
    pub(crate) verification_target_count: usize,
    pub(crate) rule_count: usize,
}

pub(crate) fn attach_runtime_transition_blocks_to_response(
    mut response: Value,
    runtime_transition_blocks: &[Value],
) -> Value {
    let events = runtime_transition_blocks
        .iter()
        .filter_map(|block| block.get("payload").cloned())
        .collect::<Vec<_>>();
    if events.is_empty() {
        return response;
    }
    if let Some(object) = response.as_object_mut() {
        object.insert(
            "runtime_transition_events".to_string(),
            Value::Array(events),
        );
        let trace_blocks = object
            .entry("tool_trace_blocks".to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(trace_blocks) = trace_blocks.as_array_mut() {
            for block in runtime_transition_blocks {
                append_runtime_transition_block_once(trace_blocks, block.clone());
            }
        }
    }
    let verdicts = project_runtime_transition_trace_verdicts(Some(&response), None);
    if !verdicts.is_empty() {
        if let Some(object) = response.as_object_mut() {
            object.insert(
                "runtime_transition_trace_verdicts".to_string(),
                Value::Array(verdicts),
            );
        }
    }
    response
}

pub(crate) fn merge_runtime_transition_events_into_trace_blocks(
    mut tool_trace_blocks: Vec<Value>,
    response: &Value,
) -> Vec<Value> {
    if let Some(response_blocks) = response.get("tool_trace_blocks").and_then(Value::as_array) {
        for block in response_blocks {
            if is_runtime_transition_block(block) {
                append_runtime_transition_block_once(&mut tool_trace_blocks, block.clone());
            }
        }
    }

    if let Some(events) = response
        .get("runtime_transition_events")
        .and_then(Value::as_array)
    {
        for event in events {
            if let Some(block) = runtime_transition_event_to_block(event) {
                append_runtime_transition_block_once(&mut tool_trace_blocks, block);
            }
        }
    }

    tool_trace_blocks
}

fn runtime_transition_event_to_block(event: &Value) -> Option<Value> {
    let event_type = event.get("event_type").and_then(Value::as_str)?;
    let block_type = match event_type {
        RUNTIME_TRANSITION_DECISION_EVENT_TYPE => RUNTIME_TRANSITION_DECISION_BLOCK_TYPE,
        RUNTIME_TRANSITION_CORRELATION_EVENT_TYPE => RUNTIME_TRANSITION_CORRELATION_BLOCK_TYPE,
        _ => return None,
    };
    Some(json!({
        "type": block_type,
        "payload": event,
    }))
}

fn append_runtime_transition_block_once(blocks: &mut Vec<Value>, block: Value) {
    let Some(key) = runtime_transition_block_key(&block) else {
        blocks.push(block);
        return;
    };
    let already_present = blocks
        .iter()
        .filter_map(runtime_transition_block_key)
        .any(|existing| existing == key);
    if !already_present {
        blocks.push(block);
    }
}

fn is_runtime_transition_block(block: &Value) -> bool {
    matches!(
        block.get("type").and_then(Value::as_str),
        Some(RUNTIME_TRANSITION_DECISION_BLOCK_TYPE)
            | Some(RUNTIME_TRANSITION_CORRELATION_BLOCK_TYPE)
    )
}

fn runtime_transition_block_key(block: &Value) -> Option<String> {
    let block_type = block.get("type").and_then(Value::as_str)?;
    if !matches!(
        block_type,
        RUNTIME_TRANSITION_DECISION_BLOCK_TYPE | RUNTIME_TRANSITION_CORRELATION_BLOCK_TYPE
    ) {
        return None;
    }
    let payload = block.get("payload").unwrap_or(block);
    let event_type = payload
        .get("event_type")
        .and_then(Value::as_str)
        .unwrap_or(block_type);
    let transition_id = payload
        .get("transition_id")
        .and_then(Value::as_str)
        .unwrap_or("unknown-transition");
    let discriminator = payload
        .get("decision_id")
        .or_else(|| payload.get("outcome"))
        .cloned()
        .unwrap_or(Value::Null);
    Some(format!(
        "{block_type}:{event_type}:{transition_id}:{}",
        serde_json::to_string(&discriminator).unwrap_or_default()
    ))
}

pub(crate) fn runtime_transition_response_field(
    response: &Value,
    tool_trace_blocks: &[Value],
    field: &str,
) -> Option<String> {
    response
        .get("runtime_transition_events")
        .and_then(Value::as_array)
        .and_then(|events| first_runtime_transition_field(events.iter(), field))
        .or_else(|| first_runtime_transition_field(tool_trace_blocks.iter(), field))
}

fn first_runtime_transition_field<'a>(
    values: impl Iterator<Item = &'a Value>,
    field: &str,
) -> Option<String> {
    values
        .filter_map(|value| {
            value
                .get(field)
                .or_else(|| value.get("payload").and_then(|payload| payload.get(field)))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .next()
}
pub(crate) fn project_tool_call_proposal_decision_blocks(
    input: ToolCallProposalProjectionInput<'_>,
) -> Vec<Value> {
    input
        .tool_calls
        .iter()
        .enumerate()
        .map(|(index, call)| {
            let call_id =
                resolve_transition_tool_call_id(call.id.as_deref(), &call.name, input.round, index);
            let transition = RuntimeTransition {
                transition_id: format!("runtime-transition:{}", call_id),
                trace_id: input.trace_id.to_string(),
                request_id: input.request_id.map(str::to_string),
                session_id: input.session_id.to_string(),
                source: TransitionSource::ProviderResponse,
                from_state: RuntimeStateKind::ModelProposal,
                to_state: RuntimeStateKind::ToolExecutionPending,
                proposed_action: ProposedAction::ExecuteTool,
                capability_id: None,
                tool_name: Some(call.name.clone()),
                effect_scope: EffectScope::Unknown,
                observed_evidence: Vec::new(),
                uncertainty_flags: Vec::new(),
                metadata_json: json!({
                    "round": input.round,
                    "call_index": index,
                    "call_id": call_id,
                    "raw_call_id": call.id,
                    "extra_content": call.extra_content,
                }),
            };
            project_transition_audit_block(&transition)
        })
        .collect()
}

pub(crate) fn project_capability_exposure_decision_blocks(
    input: CapabilityExposureProjectionInput<'_>,
) -> Vec<Value> {
    let capabilities = input
        .full_payload
        .get("capabilities")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if capabilities.is_empty() {
        return Vec::new();
    }

    let count = capabilities.len();
    let direct_callable_count = input
        .full_payload
        .get("routing_hint")
        .and_then(|value| value.get("direct_callable_capability_count"))
        .and_then(Value::as_u64)
        .unwrap_or(0);

    let transition = RuntimeTransition {
        transition_id: format!("runtime-transition:capability-exposure:{}", input.call_id),
        trace_id: input.trace_id.to_string(),
        request_id: input.request_id.map(str::to_string),
        session_id: input.session_id.to_string(),
        source: TransitionSource::CapabilityDiscovery,
        from_state: RuntimeStateKind::CapabilityDiscovered,
        to_state: RuntimeStateKind::CapabilityExposed,
        proposed_action: ProposedAction::ExposeCapability,
        capability_id: None,
        tool_name: Some("search_sdk".to_string()),
        effect_scope: EffectScope::Session,
        observed_evidence: Vec::new(),
        uncertainty_flags: Vec::new(),
        metadata_json: json!({
            "call_id": input.call_id,
            "query": input.query,
            "capability_count": count,
            "direct_callable_capability_count": direct_callable_count,
            "detail_level": input.full_payload.get("detail_level").cloned().unwrap_or(Value::Null),
            "capability_names": capabilities.iter().filter_map(capability_name).collect::<Vec<_>>(),
        }),
    };

    let mut blocks = vec![project_transition_audit_block(&transition)];
    if direct_callable_count > 0 {
        let plan_transition = RuntimeTransition {
            transition_id: format!(
                "runtime-transition:plan-draft:capability-exposure:{}",
                input.call_id
            ),
            trace_id: input.trace_id.to_string(),
            request_id: input.request_id.map(str::to_string),
            session_id: input.session_id.to_string(),
            source: TransitionSource::CapabilityDiscovery,
            from_state: RuntimeStateKind::CapabilityExposed,
            to_state: RuntimeStateKind::PlanDrafted,
            proposed_action: ProposedAction::DraftPlan,
            capability_id: None,
            tool_name: Some("search_sdk".to_string()),
            effect_scope: EffectScope::Session,
            observed_evidence: Vec::new(),
            uncertainty_flags: vec!["dynamic_capability_set_changed".to_string()],
            metadata_json: json!({
                "call_id": input.call_id,
                "query": input.query,
                "capability_count": count,
                "direct_callable_capability_count": direct_callable_count,
                "artifact_shape": "intent_constraints_unknowns_adaptation_rules_verification_targets",
            }),
        };
        blocks.push(project_transition_audit_block(&plan_transition));
    }

    blocks
}

pub(crate) fn project_capability_admit_decision_block(
    input: CapabilityAdmitProjectionInput<'_>,
) -> Option<Value> {
    if input.added_capabilities.is_empty() && input.removed_capabilities.is_empty() {
        return None;
    }

    let capability_id = (input.added_capabilities.len() == 1
        && input.removed_capabilities.is_empty())
    .then(|| input.added_capabilities[0].clone());
    let transition = RuntimeTransition {
        transition_id: format!("runtime-transition:capability-admit:{}", input.call_id),
        trace_id: input.trace_id.to_string(),
        request_id: input.request_id.map(str::to_string),
        session_id: input.session_id.to_string(),
        source: TransitionSource::CapabilityDiscovery,
        from_state: RuntimeStateKind::CapabilityExposed,
        to_state: RuntimeStateKind::CapabilityExecutable,
        proposed_action: ProposedAction::AdmitExecutableCapability,
        capability_id,
        tool_name: Some("search_sdk".to_string()),
        effect_scope: EffectScope::Session,
        observed_evidence: vec![EvidenceRef {
            kind: "capability_search_result".to_string(),
            source: "search_sdk".to_string(),
            id: Some(input.call_id.to_string()),
            metadata_json: json!({
                "query": input.query,
                "added_capabilities": input.added_capabilities,
                "removed_capabilities": input.removed_capabilities,
                "detail_level": input.full_payload.get("detail_level").cloned().unwrap_or(Value::Null),
            }),
        }],
        uncertainty_flags: vec![
            "dynamic_capability_set_changed".to_string(),
            "capability_admit_requires_frame_validation".to_string(),
        ],
        metadata_json: json!({
            "call_id": input.call_id,
            "query": input.query,
            "commit_boundary": "propose_capability_admit",
            "hook_event": "capability_changed",
            "added_capabilities": input.added_capabilities,
            "removed_capabilities": input.removed_capabilities,
            "capability_count": input
                .full_payload
                .get("capabilities")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0),
        }),
    };

    Some(project_transition_audit_block(&transition))
}

pub(crate) fn project_capability_contract_decision_block(
    input: CapabilityContractProjectionInput<'_>,
) -> Value {
    let transition = RuntimeTransition {
        transition_id: format!("runtime-transition:capability-contract:{}", input.call_id),
        trace_id: input.trace_id.to_string(),
        request_id: input.request_id.map(str::to_string),
        session_id: input.session_id.to_string(),
        source: TransitionSource::CapabilityContract,
        from_state: RuntimeStateKind::CapabilityExposed,
        to_state: RuntimeStateKind::CapabilityExecutable,
        proposed_action: ProposedAction::AdmitExecutableCapability,
        capability_id: None,
        tool_name: Some("execute_code_plan".to_string()),
        effect_scope: EffectScope::Workspace,
        observed_evidence: Vec::new(),
        uncertainty_flags: Vec::new(),
        metadata_json: json!({
            "call_id": input.call_id,
            "allowed_tools": input.allowed_tools,
            "capability_snapshot_query": input.capability_snapshot.get("query").cloned().unwrap_or(Value::Null),
        }),
    };

    project_transition_audit_block(&transition)
}

pub(crate) fn project_final_answer_decision_blocks(
    input: FinalAnswerProjectionInput<'_>,
) -> Vec<Value> {
    let observed_evidence = if input.response_has_verification_evidence {
        vec![EvidenceRef {
            kind: "verification".to_string(),
            source: "tool_trace".to_string(),
            id: input.request_id.map(str::to_string),
            metadata_json: json!({"response_has_verification_evidence": true}),
        }]
    } else {
        Vec::new()
    };
    let transition = RuntimeTransition {
        transition_id: format!(
            "runtime-transition:final-answer:{}",
            input.request_id.unwrap_or(input.trace_id)
        ),
        trace_id: input.trace_id.to_string(),
        request_id: input.request_id.map(str::to_string),
        session_id: input.session_id.to_string(),
        source: TransitionSource::ProviderResponse,
        from_state: RuntimeStateKind::FinalAnswerProposed,
        to_state: RuntimeStateKind::FinalAnswerProposed,
        proposed_action: ProposedAction::VerifyFinalAnswer,
        capability_id: None,
        tool_name: None,
        effect_scope: EffectScope::ReadOnly,
        observed_evidence,
        uncertainty_flags: Vec::new(),
        metadata_json: json!({
            "response_has_verification_evidence": input.response_has_verification_evidence,
        }),
    };

    runtime_transition_audit_decision(&transition)
        .map(|decision| runtime_transition_decision_block(&transition, &decision))
        .into_iter()
        .collect()
}

pub(crate) fn project_tool_execution_correlation_blocks(
    decision_blocks: &[Value],
    tool_call_meta: &[Value],
) -> Vec<Value> {
    decision_blocks
        .iter()
        .filter_map(|block| {
            let payload = block.get("payload")?;
            if payload.get("event_type").and_then(Value::as_str)
                != Some(RUNTIME_TRANSITION_DECISION_EVENT_TYPE)
            {
                return None;
            }
            if payload.get("proposed_action").and_then(Value::as_str) != Some("execute_tool") {
                return None;
            }
            let transition_id = payload.get("transition_id")?.as_str()?;
            let call_id = payload
                .get("transition")
                .and_then(|transition| transition.get("metadata_json"))
                .and_then(|metadata| metadata.get("call_id"))
                .and_then(Value::as_str)
                .or_else(|| transition_id.strip_prefix("runtime-transition:"))?;
            let result = tool_call_meta
                .iter()
                .find(|item| tool_result_matches_transition_call_id(item, call_id))?;
            let status = result
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .trim()
                .to_ascii_lowercase();
            let outcome = match status.as_str() {
                "success" | "completed" => RuntimeTransitionCorrelationOutcome::Matched,
                "error" | "cancelled" | "rejected" | "approval_failed" => {
                    RuntimeTransitionCorrelationOutcome::Contradicted
                }
                _ => RuntimeTransitionCorrelationOutcome::Unverified,
            };
            Some(runtime_transition_correlation_block(
                transition_id,
                outcome,
                vec![format!("tool_result:{call_id}")],
                Some(format!(
                    "tool execution result status '{status}' correlated with runtime transition proposal"
                )),
            ))
        })
        .collect()
}
pub(crate) fn project_execution_observation_decision_blocks(
    input: ExecutionObservationProjectionInput<'_>,
) -> Vec<Value> {
    let failed_calls = input
        .tool_call_meta
        .iter()
        .filter(|item| {
            item.get("status")
                .and_then(Value::as_str)
                .map(|status| {
                    matches!(
                        status.trim().to_ascii_lowercase().as_str(),
                        "error" | "cancelled" | "rejected" | "approval_failed"
                    )
                })
                .unwrap_or(false)
        })
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_str)?;
            let name = item.get("name").and_then(Value::as_str).unwrap_or("unknown");
            Some(json!({"id": id, "name": name, "status": item.get("status").cloned().unwrap_or(Value::Null)}))
        })
        .collect::<Vec<_>>();

    if failed_calls.is_empty() {
        return Vec::new();
    }

    let transition = RuntimeTransition {
        transition_id: format!(
            "runtime-transition:plan-revision:{}",
            input.request_id.unwrap_or(input.trace_id)
        ),
        trace_id: input.trace_id.to_string(),
        request_id: input.request_id.map(str::to_string),
        session_id: input.session_id.to_string(),
        source: TransitionSource::ExecutionObservation,
        from_state: RuntimeStateKind::ExecutionObserved,
        to_state: RuntimeStateKind::PlanRevisionNeeded,
        proposed_action: ProposedAction::RevisePlan,
        capability_id: None,
        tool_name: None,
        effect_scope: EffectScope::Workspace,
        observed_evidence: failed_calls
            .iter()
            .filter_map(|call| {
                Some(EvidenceRef {
                    kind: "tool_result".to_string(),
                    source: "tool_trace".to_string(),
                    id: call.get("id").and_then(Value::as_str).map(str::to_string),
                    metadata_json: call.clone(),
                })
            })
            .collect(),
        uncertainty_flags: vec!["execution_observation_failed".to_string()],
        metadata_json: json!({
            "failed_calls": failed_calls,
            "result_count": input.result_count,
            "artifact_shape": "changed_assumptions_revised_intent_adaptation_rules_verification_targets",
        }),
    };

    vec![project_transition_audit_block(&transition)]
}

pub(crate) fn project_monitor_checkpoint_decision_block(
    input: MonitorCheckpointProjectionInput<'_>,
) -> Value {
    let transition = RuntimeTransition {
        transition_id: format!(
            "runtime-transition:monitor-checkpoint:{}",
            input.monitor_execution_id
        ),
        trace_id: input.monitor_execution_id.to_string(),
        request_id: None,
        session_id: input.monitor_task_id.to_string(),
        source: TransitionSource::MonitorResult,
        from_state: RuntimeStateKind::ExecutionObserved,
        to_state: RuntimeStateKind::ExecutionObserved,
        proposed_action: ProposedAction::RecordMonitorCheckpoint,
        capability_id: None,
        tool_name: None,
        effect_scope: EffectScope::Session,
        observed_evidence: input
            .observations
            .iter()
            .enumerate()
            .map(|(index, observation)| EvidenceRef {
                kind: "monitor_observation".to_string(),
                source: "monitor_policy_result".to_string(),
                id: Some(format!("{}:{index}", input.monitor_execution_id)),
                metadata_json: json!({"observation": observation}),
            })
            .collect(),
        uncertainty_flags: Vec::new(),
        metadata_json: json!({
            "monitor_task_id": input.monitor_task_id,
            "monitor_execution_id": input.monitor_execution_id,
            "strategy_tag": input.strategy_tag,
            "observations": input.observations,
        }),
    };

    project_transition_audit_block(&transition)
}

pub(crate) fn project_world_model_frame_decision_block(
    input: WorldModelFrameProjectionInput<'_>,
) -> Value {
    let slug = input.frame_kind.slug();
    let trace_handle = input
        .request_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(input.trace_id);
    let intent_value = input
        .intent
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let transition = RuntimeTransition {
        transition_id: format!("runtime-transition:world-model-frame:{slug}:{trace_handle}"),
        trace_id: input.trace_id.to_string(),
        request_id: input.request_id.map(str::to_string),
        session_id: input.session_id.to_string(),
        source: TransitionSource::RuntimePolicy,
        from_state: RuntimeStateKind::ModelProposal,
        to_state: RuntimeStateKind::PlanDrafted,
        proposed_action: ProposedAction::DraftPlan,
        capability_id: None,
        tool_name: Some("world_model_update".to_string()),
        effect_scope: EffectScope::Session,
        observed_evidence: vec![EvidenceRef {
            kind: "world_model_update".to_string(),
            source: "chat_tool_runtime".to_string(),
            id: input.request_id.map(str::to_string),
            metadata_json: json!({
                "frame_kind": slug,
                "intent": intent_value,
                "fact_count": input.fact_count,
                "assumption_count": input.assumption_count,
                "verification_target_count": input.verification_target_count,
                "rule_count": input.rule_count,
            }),
        }],
        uncertainty_flags: Vec::new(),
        metadata_json: json!({
            "frame_kind": slug,
            "intent": intent_value,
            "fact_count": input.fact_count,
            "assumption_count": input.assumption_count,
            "verification_target_count": input.verification_target_count,
            "rule_count": input.rule_count,
        }),
    };

    let decision = HookDecision::RequireArtifact {
        artifact: input.frame_kind.required_artifact(),
        reason: input.frame_kind.reason().to_string(),
        enforcement: HookEnforcementMode::Enforced,
    };

    runtime_transition_decision_block(&transition, &decision)
}

pub(crate) fn monitor_checkpoint_correlation_signal_payload(
    input: MonitorCheckpointProjectionInput<'_>,
) -> Value {
    monitor_checkpoint_correlation_payload_for_transition(input, None)
}

pub(crate) fn monitor_checkpoint_correlation_payload_for_transition(
    input: MonitorCheckpointProjectionInput<'_>,
    prior_transition_id: Option<&str>,
) -> Value {
    let decision_block = project_monitor_checkpoint_decision_block(input.clone());
    let checkpoint_transition_id = decision_block
        .get("payload")
        .and_then(|payload| payload.get("transition_id"))
        .and_then(Value::as_str)
        .unwrap_or("runtime-transition:monitor-checkpoint:unknown");
    let correlation_transition_id = prior_transition_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(checkpoint_transition_id);
    let evidence_refs = input
        .observations
        .iter()
        .enumerate()
        .map(|(index, _)| {
            format!(
                "monitor_policy_result:{}:{index}",
                input.monitor_execution_id
            )
        })
        .collect::<Vec<_>>();
    let correlation = runtime_transition_correlation_block(
        correlation_transition_id,
        RuntimeTransitionCorrelationOutcome::Unverified,
        evidence_refs,
        Some("monitor result captured as correlation evidence; explicit feedback remains promotion gate".to_string()),
    );

    json!({
        "checkpoint_decision": decision_block.get("payload").cloned().unwrap_or(Value::Null),
        "correlation": correlation.get("payload").cloned().unwrap_or(Value::Null),
        "checkpoint_transition_id": checkpoint_transition_id,
        "correlated_transition_id": correlation_transition_id,
    })
}

pub(crate) fn hook_provenance_for_required_artifact(
    blocks: &[Value],
    artifact: RequiredArtifact,
) -> Option<Value> {
    let artifact_value = serde_json::to_value(artifact).ok()?;
    blocks.iter().find_map(|block| {
        let payload = block.get("payload")?;
        if payload.get("required_artifact") != Some(&artifact_value) {
            return None;
        }
        let transition_id = payload.get("transition_id")?.as_str()?;
        Some(json!({
            "transition_id": transition_id,
            "required_artifact": artifact_value,
            "hook_decision_id": payload.get("decision_id").cloned().unwrap_or_else(|| json!(format!("hook-decision:{transition_id}"))),
            "enforcement": payload.get("enforcement").cloned().unwrap_or(Value::Null),
        }))
    })
}

pub(crate) fn runtime_transition_correlation_block(
    transition_id: &str,
    outcome: RuntimeTransitionCorrelationOutcome,
    evidence_refs: Vec<String>,
    note: Option<String>,
) -> Value {
    json!({
        "type": RUNTIME_TRANSITION_CORRELATION_BLOCK_TYPE,
        "payload": runtime_transition_correlation_event_payload(
            transition_id,
            outcome,
            evidence_refs,
            note,
        ),
    })
}

pub(crate) fn runtime_transition_correlation_event_payload(
    transition_id: &str,
    outcome: RuntimeTransitionCorrelationOutcome,
    evidence_refs: Vec<String>,
    note: Option<String>,
) -> Value {
    json!({
        "event_type": RUNTIME_TRANSITION_CORRELATION_EVENT_TYPE,
        "transition_id": transition_id,
        "outcome": outcome,
        "evidence_refs": evidence_refs,
        "note": note,
    })
}

pub(crate) fn runtime_transition_decision_block(
    transition: &RuntimeTransition,
    decision: &HookDecision,
) -> Value {
    json!({
        "type": RUNTIME_TRANSITION_DECISION_BLOCK_TYPE,
        "payload": runtime_transition_decision_event_payload(transition, decision),
    })
}

pub(crate) fn runtime_transition_decision_event_payload(
    transition: &RuntimeTransition,
    decision: &HookDecision,
) -> Value {
    let required_artifact = match decision {
        HookDecision::RequireArtifact { artifact, .. } => serde_json::to_value(artifact).ok(),
        _ => None,
    };
    let enforcement = match decision {
        HookDecision::RequireArtifact { enforcement, .. } => serde_json::to_value(enforcement).ok(),
        _ => None,
    };
    let decision_id = format!("hook-decision:{}", transition.transition_id);

    json!({
        "event_type": RUNTIME_TRANSITION_DECISION_EVENT_TYPE,
        "decision_id": decision_id,
        "transition_id": transition.transition_id,
        "trace_id": transition.trace_id,
        "request_id": transition.request_id,
        "session_id": transition.session_id,
        "source": transition.source,
        "from_state": transition.from_state,
        "to_state": transition.to_state,
        "proposed_action": transition.proposed_action,
        "capability_id": transition.capability_id,
        "tool_name": transition.tool_name,
        "effect_scope": transition.effect_scope,
        "required_artifact": required_artifact,
        "enforcement": enforcement,
        "transition": transition,
        "decision": decision,
    })
}

fn project_transition_audit_block(transition: &RuntimeTransition) -> Value {
    let decision = runtime_transition_audit_decision(transition).unwrap_or(HookDecision::Allow {
        reason: "transition is audit-only and does not require a runtime artifact".to_string(),
    });
    runtime_transition_decision_block(transition, &decision)
}

fn runtime_transition_audit_decision(transition: &RuntimeTransition) -> Option<HookDecision> {
    match transition.proposed_action {
        ProposedAction::DirectAnswer | ProposedAction::Noop => None,
        ProposedAction::DraftPlan => Some(require_artifact(
            RequiredArtifact::PlanDraft,
            "transition uncertainty should be captured as adaptive planning context",
        )),
        ProposedAction::ExecuteTool => Some(require_artifact(
            RequiredArtifact::WorldModelFrameRefresh,
            "tool execution proposal crosses from model output into runtime action",
        )),
        ProposedAction::ExposeCapability | ProposedAction::AdmitExecutableCapability => {
            Some(require_artifact(
                RequiredArtifact::CapabilityLease,
                "dynamic capability exposure should be correlated as capability lease evidence",
            ))
        }
        ProposedAction::RevisePlan => Some(require_artifact(
            RequiredArtifact::PlanRevision,
            "runtime observation indicates plan assumptions may need revision",
        )),
        ProposedAction::VerifyFinalAnswer => {
            if transition.to_state == RuntimeStateKind::Finalized {
                return None;
            }
            if transition.observed_evidence.is_empty()
                || matches!(
                    transition.effect_scope,
                    EffectScope::Workspace | EffectScope::External
                )
            {
                return Some(require_artifact(
                    RequiredArtifact::VerificationPlan,
                    "final answer proposal needs explicit verification evidence before completion",
                ));
            }
            None
        }
        ProposedAction::RecordMonitorCheckpoint => Some(require_artifact(
            RequiredArtifact::MonitorCheckpoint,
            "monitor output is captured as correlation evidence",
        )),
    }
}

fn require_artifact(artifact: RequiredArtifact, reason: &str) -> HookDecision {
    HookDecision::RequireArtifact {
        artifact,
        reason: reason.to_string(),
        enforcement: HookEnforcementMode::Enforced,
    }
}

fn tool_result_matches_transition_call_id(item: &Value, call_id: &str) -> bool {
    let expected = call_id.trim();
    if expected.is_empty() {
        return false;
    }

    ["id", "call_id", "callId", "tool_call_id"]
        .into_iter()
        .filter_map(|field| item.get(field).and_then(Value::as_str))
        .map(str::trim)
        .any(|value| value == expected)
        || item
            .get("result")
            .and_then(|result| {
                result
                    .get("execution_graph_tool_node_id")
                    .or_else(|| result.get("execution_graph_gate_node_id"))
            })
            .and_then(Value::as_str)
            .map(str::trim)
            .and_then(|node_id| {
                node_id
                    .strip_prefix("tool_call:")
                    .or_else(|| node_id.strip_prefix("approval_gate:"))
                    .or(Some(node_id))
            })
            .is_some_and(|value| value == expected)
}

fn capability_name(value: &Value) -> Option<String> {
    value
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| value.get("tool_name").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn resolve_transition_tool_call_id(
    raw_call_id: Option<&str>,
    tool_name: &str,
    round: usize,
    call_index: usize,
) -> String {
    raw_call_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "local-missing-call:r{round}:i{call_index}:{}",
                sanitize_tool_call_id_segment(tool_name)
            )
        })
}

fn sanitize_tool_call_id_segment(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else if ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let sanitized = sanitized.trim_matches('_');
    if sanitized.is_empty() {
        "tool".to_string()
    } else {
        sanitized.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_response_events_into_graph_trace_blocks_once() {
        let event = json!({
            "event_type": "runtime_transition.decision",
            "decision_id": "hook-decision:runtime-transition:call-1",
            "transition_id": "runtime-transition:call-1",
            "trace_id": "trace-1",
            "required_artifact": "world_model_frame_refresh",
            "enforcement": "enforced"
        });
        let response = json!({
            "runtime_transition_events": [event.clone()],
            "tool_trace_blocks": [{"type":"tool_call","callId":"call-1","toolName":"search_sdk","status":"success"}]
        });

        let blocks = merge_runtime_transition_events_into_trace_blocks(Vec::new(), &response);
        let merged_again = merge_runtime_transition_events_into_trace_blocks(blocks, &response);
        let runtime_blocks = merged_again
            .iter()
            .filter(|block| {
                block.get("type").and_then(Value::as_str)
                    == Some(RUNTIME_TRANSITION_DECISION_BLOCK_TYPE)
            })
            .collect::<Vec<_>>();

        assert_eq!(runtime_blocks.len(), 1);
        assert_eq!(runtime_blocks[0]["payload"], event);
    }
    #[test]
    fn extracts_runtime_transition_response_provenance_from_events_or_blocks() {
        let block = json!({
            "type": "runtime_transition_decision",
            "payload": {
                "event_type": "runtime_transition.decision",
                "transition_id": "runtime-transition:call-1",
                "trace_id": "trace-1",
                "request_id": "request-1"
            }
        });
        let response = attach_runtime_transition_blocks_to_response(
            json!({"content": "done"}),
            &[block.clone()],
        );

        assert_eq!(
            runtime_transition_response_field(&response, &[], "trace_id"),
            Some("trace-1".to_string())
        );
        assert_eq!(
            runtime_transition_response_field(&json!({}), &[block], "request_id"),
            Some("request-1".to_string())
        );
    }
    #[test]
    fn projects_tool_call_proposals_as_policy_guidance_audit_events() {
        let calls = vec![LocalChatToolCall {
            id: Some("call-1".to_string()),
            name: "shell_execute".to_string(),
            arguments: json!({"command":"pwd"}),
            extra_content: None,
        }];

        let events = project_tool_call_proposal_decision_blocks(ToolCallProposalProjectionInput {
            trace_id: "trace-1",
            request_id: Some("request-1"),
            session_id: "session-1",
            round: 1,
            tool_calls: &calls,
        });

        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0]["type"],
            json!(RUNTIME_TRANSITION_DECISION_BLOCK_TYPE)
        );
        assert_eq!(
            events[0]["payload"]["event_type"],
            json!(RUNTIME_TRANSITION_DECISION_EVENT_TYPE)
        );
        assert_eq!(
            events[0]["payload"]["transition_id"],
            json!("runtime-transition:call-1")
        );
        assert_eq!(events[0]["payload"]["tool_name"], json!("shell_execute"));
        assert_eq!(
            events[0]["payload"]["required_artifact"],
            json!("world_model_frame_refresh")
        );
        assert_eq!(events[0]["payload"]["enforcement"], json!("enforced"));
    }

    #[test]
    fn projects_capability_exposure_as_policy_guidance_lease() {
        let events =
            project_capability_exposure_decision_blocks(CapabilityExposureProjectionInput {
                trace_id: "trace-1",
                request_id: Some("request-1"),
                session_id: "session-1",
                call_id: "search-call-1",
                query: "browser automation",
                full_payload: &json!({
                    "detail_level": "full",
                    "routing_hint": {"direct_callable_capability_count": 1},
                    "capabilities": [{"name": "browser_open_tab"}]
                }),
            });

        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0]["payload"]["transition_id"],
            json!("runtime-transition:capability-exposure:search-call-1")
        );
        assert_eq!(
            events[0]["payload"]["required_artifact"],
            json!("capability_lease")
        );
        assert_eq!(
            events[0]["payload"]["transition"]["metadata_json"]["capability_names"],
            json!(["browser_open_tab"])
        );
        assert_eq!(
            events[1]["payload"]["required_artifact"],
            json!("plan_draft")
        );
        assert_eq!(events[1]["payload"]["proposed_action"], json!("draft_plan"));
        assert_eq!(
            events[1]["payload"]["transition"]["metadata_json"]["artifact_shape"],
            json!("intent_constraints_unknowns_adaptation_rules_verification_targets")
        );
    }

    #[test]
    fn projects_capability_admit_as_commit_boundary() {
        let added_capabilities = vec!["tool.search_web".to_string()];
        let removed_capabilities = Vec::new();
        let event = project_capability_admit_decision_block(CapabilityAdmitProjectionInput {
            trace_id: "trace-1",
            request_id: Some("request-1"),
            session_id: "session-1",
            call_id: "search-call-1",
            query: "search web",
            added_capabilities: &added_capabilities,
            removed_capabilities: &removed_capabilities,
            full_payload: &json!({
                "detail_level": "full",
                "capabilities": [{"name": "search_web"}]
            }),
        })
        .expect("admit boundary");

        assert_eq!(
            event["payload"]["transition_id"],
            json!("runtime-transition:capability-admit:search-call-1")
        );
        assert_eq!(
            event["payload"]["proposed_action"],
            json!("admit_executable_capability")
        );
        assert_eq!(
            event["payload"]["required_artifact"],
            json!("capability_lease")
        );
        assert_eq!(
            event["payload"]["transition"]["metadata_json"]["hook_event"],
            json!("capability_changed")
        );
    }

    #[test]
    fn final_answer_without_evidence_requests_verification_plan() {
        let events = project_final_answer_decision_blocks(FinalAnswerProjectionInput {
            trace_id: "trace-1",
            request_id: Some("request-1"),
            session_id: "session-1",
            response_has_verification_evidence: false,
        });

        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0]["payload"]["required_artifact"],
            json!("verification_plan")
        );
        assert_eq!(
            events[0]["payload"]["proposed_action"],
            json!("verify_final_answer")
        );
    }

    #[test]
    fn final_answer_with_evidence_does_not_emit_audit_obligation() {
        let events = project_final_answer_decision_blocks(FinalAnswerProjectionInput {
            trace_id: "trace-1",
            request_id: Some("request-1"),
            session_id: "session-1",
            response_has_verification_evidence: true,
        });

        assert!(events.is_empty());
    }

    #[test]
    fn tool_execution_correlation_links_proposal_to_result() {
        let decisions =
            project_tool_call_proposal_decision_blocks(ToolCallProposalProjectionInput {
                trace_id: "trace-1",
                request_id: Some("request-1"),
                session_id: "session-1",
                round: 1,
                tool_calls: &[LocalChatToolCall {
                    id: Some("call-1".to_string()),
                    name: "shell_execute".to_string(),
                    arguments: json!({"command":"pwd"}),
                    extra_content: None,
                }],
            });

        let correlations = project_tool_execution_correlation_blocks(
            &decisions,
            &[json!({"id": "call-1", "name": "shell_execute", "status": "success"})],
        );

        assert_eq!(correlations.len(), 1);
        assert_eq!(
            correlations[0]["payload"]["event_type"],
            json!(RUNTIME_TRANSITION_CORRELATION_EVENT_TYPE)
        );
        assert_eq!(correlations[0]["payload"]["outcome"], json!("matched"));
        assert_eq!(
            correlations[0]["payload"]["transition_id"],
            json!("runtime-transition:call-1")
        );
        assert_eq!(
            correlations[0]["payload"]["evidence_refs"],
            json!(["tool_result:call-1"])
        );
    }
    #[test]
    fn tool_execution_correlation_accepts_camel_case_call_id() {
        let decisions =
            project_tool_call_proposal_decision_blocks(ToolCallProposalProjectionInput {
                trace_id: "trace-1",
                request_id: Some("request-1"),
                session_id: "session-1",
                round: 1,
                tool_calls: &[LocalChatToolCall {
                    id: Some("call-1".to_string()),
                    name: "search_sdk".to_string(),
                    arguments: json!({"query":"browser"}),
                    extra_content: None,
                }],
            });

        let correlations = project_tool_execution_correlation_blocks(
            &decisions,
            &[json!({"callId": "call-1", "toolName": "search_sdk", "status": "success"})],
        );

        assert_eq!(correlations.len(), 1);
        assert_eq!(correlations[0]["payload"]["outcome"], json!("matched"));
        assert_eq!(
            correlations[0]["payload"]["transition_id"],
            json!("runtime-transition:call-1")
        );
    }

    #[test]
    fn failed_execution_observation_requests_plan_revision() {
        let events =
            project_execution_observation_decision_blocks(ExecutionObservationProjectionInput {
                trace_id: "trace-1",
                request_id: Some("request-1"),
                session_id: "session-1",
                tool_call_meta: &[json!({
                    "id": "call-1",
                    "name": "shell_execute",
                    "status": "error"
                })],
                result_count: 1,
            });

        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0]["payload"]["required_artifact"],
            json!("plan_revision")
        );
        assert_eq!(
            events[0]["payload"]["source"],
            json!("execution_observation")
        );
        assert_eq!(
            events[0]["payload"]["transition"]["metadata_json"]["artifact_shape"],
            json!("changed_assumptions_revised_intent_adaptation_rules_verification_targets")
        );
    }

    #[test]
    fn monitor_checkpoint_payload_carries_correlation_evidence() {
        let payload =
            monitor_checkpoint_correlation_signal_payload(MonitorCheckpointProjectionInput {
                monitor_task_id: "monitor-task-1",
                monitor_execution_id: "monitor-exec-1",
                strategy_tag: Some("watch"),
                observations: &["changed output".to_string()],
            });

        assert_eq!(
            payload["checkpoint_decision"]["required_artifact"],
            json!("monitor_checkpoint")
        );
        assert_eq!(payload["correlation"]["outcome"], json!("unverified"));
        assert_eq!(
            payload["correlation"]["evidence_refs"],
            json!(["monitor_policy_result:monitor-exec-1:0"])
        );
        assert_eq!(
            payload["correlated_transition_id"],
            json!("runtime-transition:monitor-checkpoint:monitor-exec-1")
        );
    }

    #[test]
    fn monitor_checkpoint_can_correlate_to_prior_runtime_transition() {
        let payload = monitor_checkpoint_correlation_payload_for_transition(
            MonitorCheckpointProjectionInput {
                monitor_task_id: "monitor-task-1",
                monitor_execution_id: "monitor-exec-1",
                strategy_tag: Some("watch"),
                observations: &["changed output".to_string()],
            },
            Some("runtime-transition:call-1"),
        );

        assert_eq!(
            payload["checkpoint_transition_id"],
            json!("runtime-transition:monitor-checkpoint:monitor-exec-1")
        );
        assert_eq!(
            payload["correlation"]["transition_id"],
            json!("runtime-transition:call-1")
        );
        assert_eq!(
            payload["correlation"]["evidence_refs"],
            json!(["monitor_policy_result:monitor-exec-1:0"])
        );
    }

    #[test]
    fn projects_capability_contract_separately_from_discovery() {
        let event = project_capability_contract_decision_block(CapabilityContractProjectionInput {
            trace_id: "trace-1",
            request_id: Some("request-1"),
            session_id: "session-1",
            call_id: "execute-call-1",
            allowed_tools: &["browser_open_tab".to_string()],
            capability_snapshot: &json!({"query": "browser automation"}),
        });

        assert_eq!(event["payload"]["source"], json!("capability_contract"));
        assert_eq!(event["payload"]["to_state"], json!("capability_executable"));
        assert_eq!(
            event["payload"]["required_artifact"],
            json!("capability_lease")
        );
    }

    #[test]
    fn extracts_hook_provenance_for_required_artifact() {
        let blocks = vec![runtime_transition_decision_block(
            &RuntimeTransition {
                transition_id: "transition-1".to_string(),
                trace_id: "trace-1".to_string(),
                request_id: None,
                session_id: "session-1".to_string(),
                source: TransitionSource::ProviderResponse,
                from_state: RuntimeStateKind::ModelProposal,
                to_state: RuntimeStateKind::ToolExecutionPending,
                proposed_action: ProposedAction::ExecuteTool,
                capability_id: None,
                tool_name: Some("shell_execute".to_string()),
                effect_scope: EffectScope::Unknown,
                observed_evidence: Vec::new(),
                uncertainty_flags: Vec::new(),
                metadata_json: Value::Null,
            },
            &HookDecision::RequireArtifact {
                artifact: RequiredArtifact::WorldModelFrameRefresh,
                reason: "test".to_string(),
                enforcement: super::super::types::HookEnforcementMode::Enforced,
            },
        )];

        let provenance =
            hook_provenance_for_required_artifact(&blocks, RequiredArtifact::WorldModelFrameRefresh)
                .expect("provenance");

        assert_eq!(provenance["transition_id"], json!("transition-1"));
        assert_eq!(provenance["enforcement"], json!("enforced"));
    }
}
