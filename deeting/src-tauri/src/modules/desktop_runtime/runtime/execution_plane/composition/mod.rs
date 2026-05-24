mod components;
pub(super) mod phase_step;

use self::components::phase_executor_impl::{shared_phase_outcome, DeetingRealPhaseExecutor};
use self::components::policy_hook_adapters::build_deeting_policy_hook_registry;
use self::components::runtime_components::{
    task_id_from_request, user_input_from_request, DeetingBootstrapPrompt,
    DeetingFrameArtifactGenerator, DeetingInterruptionChannel, DeetingPhaseProposalGenerator,
    DeetingRuntimeEventStore, DeetingTier2Validator,
};
use super::{LocalExecutionOutcome, LocalExecutionRequest};
use crate::modules::desktop_runtime::runtime::chat_tool_runtime::DitingThinkExtract;
use desktop_runtime_core::{
    Assumption, Fact, Rule, RuntimeComponents, RuntimeComposition, RuntimeTickResult,
    VerificationTarget, WorldModelFrame,
};
use serde_json::{json, Value};

pub(crate) async fn run_local_runtime_composition<F>(
    request: LocalExecutionRequest,
    mut emit_status: F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    let step_type = phase_step::initial_phase_step_for_policy(&request.execution_policy);
    emit_status(
        "evolve",
        Some("phase_executor"),
        "success",
        "runtime.phase_executor.selected",
        Some(json!({
            "phase_step_type": phase_step::phase_step_type_name(step_type),
            "route": request.execution_policy.route.as_str(),
            "composition": "deeting_runtime_phase_composition",
        })),
    );

    let task_id = task_id_from_request(&request);
    let input = user_input_from_request(&request, task_id.clone());
    let phase_outcome = shared_phase_outcome();
    let hook_store = request.app_state.mcp.store.clone();
    let components = RuntimeComponents {
        bootstrap: DeetingBootstrapPrompt::new(
            request.clone(),
            step_type,
            task_id,
            hook_store.clone(),
        ),
        validator: DeetingTier2Validator::default(),
        frame_generator: DeetingFrameArtifactGenerator::default(),
        phase_proposal_generator: DeetingPhaseProposalGenerator::new(step_type),
        phase_executor: DeetingRealPhaseExecutor::new(
            request,
            &mut emit_status,
            phase_outcome.clone(),
        ),
        interruptions: DeetingInterruptionChannel::default(),
        event_store: DeetingRuntimeEventStore::default(),
        hook_registry: build_deeting_policy_hook_registry(),
    };
    let mut runtime = RuntimeComposition::new(components);
    let result = runtime.tick(input).map_err(|err| err.to_string())?;
    let mut outcome = phase_outcome.borrow_mut().take().ok_or_else(|| {
        "runtime composition completed without local execution outcome".to_string()
    })?;
    attach_runtime_result_to_outcome(&mut outcome, &result);
    Ok(outcome)
}

fn attach_runtime_result_to_outcome(
    outcome: &mut LocalExecutionOutcome,
    result: &RuntimeTickResult,
) {
    let committed_phases = result.plan.committed_phases.clone();
    let frame = refreshed_frame_with_diting_extract(
        result.frame.clone(),
        outcome.captured_frame_extract.as_ref(),
    );
    let summary = json!({
        "frame_version_id": frame.frame_version_id.clone(),
        "plan_id": result.plan.plan_id.clone(),
        "fingerprint_key": frame.fingerprint_key.clone(),
        "committed_phases": committed_phases,
        "execution_strategy": frame.execution_strategy,
        "validation": result.validation.clone(),
        "decision": result.decision.clone(),
        "final_answer": result.final_answer.clone(),
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
            metadata_object.insert("runtime_composition".to_string(), artifact.clone());
        }
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

fn refreshed_frame_with_diting_extract(
    mut frame: WorldModelFrame,
    extract: Option<&DitingThinkExtract>,
) -> WorldModelFrame {
    let Some(extract) = extract else {
        return frame;
    };

    frame
        .known_facts
        .extend(extract.facts.iter().enumerate().map(|(index, statement)| Fact {
            id: format!("diting-fact-{index}"),
            statement: statement.clone(),
            source: "diting_think".to_string(),
        }));
    frame
        .assumptions
        .extend(extract.assumptions.iter().enumerate().map(|(index, statement)| {
            Assumption {
                id: format!("diting-assumption-{index}"),
                statement: statement.clone(),
            }
        }));
    frame.verification_targets.extend(
        extract
            .verification_targets
            .iter()
            .enumerate()
            .map(|(index, description)| VerificationTarget {
                id: format!("diting-vt-{index}"),
                description: description.clone(),
            }),
    );
    frame
        .adaptation_rules
        .extend(extract.rules.iter().enumerate().map(|(index, instruction)| Rule {
            id: format!("diting-rule-{index}"),
            instruction: instruction.clone(),
        }));
    frame
}
