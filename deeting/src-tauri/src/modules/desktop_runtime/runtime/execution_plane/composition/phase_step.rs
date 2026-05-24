use crate::modules::desktop_runtime::runtime::control_plane::LocalExecutionPolicy;
use desktop_runtime_core::PhaseStepType;

pub(crate) fn initial_phase_step_for_policy(policy: &LocalExecutionPolicy) -> PhaseStepType {
    match policy.initial_phase_step {
        PhaseStepType::DelegatedWorker if policy.prefer_workflow_runtime => {
            PhaseStepType::DelegatedWorkflow
        }
        step_type => step_type,
    }
}

pub(crate) const fn phase_step_type_name(step_type: PhaseStepType) -> &'static str {
    match step_type {
        PhaseStepType::DirectChat => "direct_chat",
        PhaseStepType::ToolCall => "tool_call",
        PhaseStepType::DelegatedWorker => "delegated_worker",
        PhaseStepType::DelegatedWorkflow => "delegated_workflow",
        PhaseStepType::CapabilityAdmit => "capability_admit",
        PhaseStepType::VerifyFinal => "verify_final",
    }
}
