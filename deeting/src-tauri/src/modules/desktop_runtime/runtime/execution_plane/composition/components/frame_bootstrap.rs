use super::super::super::user_input::latest_user_message;
use super::super::super::LocalExecutionRequest;
use super::super::phase_step::phase_step_type_name;
use desktop_runtime_core::{ExecutionStrategy, FrameProvenance, PhaseStepType, WorldModelFrame};

pub(crate) fn build_bootstrap_frame(
    request: &LocalExecutionRequest,
    step_type: PhaseStepType,
    task_id: &str,
) -> WorldModelFrame {
    let frame_version_id = format!("frame:{}:{}", request.session_id, task_id);
    let goal = latest_user_message(&request.messages)
        .map(|message| message.trim().to_string())
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| "local runtime request".to_string());

    WorldModelFrame::new(
        frame_version_id,
        request.session_id.clone(),
        task_id.to_string(),
        goal,
        execution_strategy_for_step(step_type),
        FrameProvenance {
            produced_by: "deeting_runtime_composition".to_string(),
            reason: "bootstrap frame from local execution request".to_string(),
            evidence_refs: vec![
                format!("route:{}", request.execution_policy.route.as_str()),
                format!("phase_step_type:{}", phase_step_type_name(step_type)),
            ],
        },
    )
}

fn execution_strategy_for_step(step_type: PhaseStepType) -> ExecutionStrategy {
    match step_type {
        PhaseStepType::DirectChat => ExecutionStrategy::DirectIteration,
        PhaseStepType::DelegatedWorkflow => ExecutionStrategy::DelegatedWorkflow,
        PhaseStepType::DelegatedWorker => ExecutionStrategy::DelegatedAgent,
        PhaseStepType::ToolCall | PhaseStepType::CapabilityAdmit | PhaseStepType::VerifyFinal => {
            ExecutionStrategy::Hybrid
        }
    }
}
