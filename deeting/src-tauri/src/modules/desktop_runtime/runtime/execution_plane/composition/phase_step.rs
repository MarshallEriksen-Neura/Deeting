use crate::modules::desktop_runtime::runtime::control_plane::LocalExecutionPolicy;
use desktop_runtime_core::{ExecutionStrategy, PhaseStepType};

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn initial_phase_step_for_policy(policy: &LocalExecutionPolicy) -> PhaseStepType {
    match policy.initial_phase_step {
        PhaseStepType::DelegatedWorker if policy.prefer_workflow_runtime => {
            PhaseStepType::DelegatedWorkflow
        }
        step_type => step_type,
    }
}

pub(crate) const fn phase_step_for_strategy(
    strategy: ExecutionStrategy,
    fallback: PhaseStepType,
) -> PhaseStepType {
    match strategy {
        ExecutionStrategy::DirectIteration => PhaseStepType::DirectChat,
        ExecutionStrategy::DelegatedWorkflow => PhaseStepType::DelegatedWorkflow,
        ExecutionStrategy::DelegatedAgent => PhaseStepType::DelegatedWorker,
        ExecutionStrategy::Hybrid => fallback,
    }
}

pub(crate) const fn phase_step_for_observable_frame_strategy(
    strategy: ExecutionStrategy,
) -> Option<PhaseStepType> {
    match strategy {
        ExecutionStrategy::DirectIteration => Some(PhaseStepType::DirectChat),
        ExecutionStrategy::DelegatedWorkflow => Some(PhaseStepType::DelegatedWorkflow),
        ExecutionStrategy::DelegatedAgent => Some(PhaseStepType::DelegatedWorker),
        ExecutionStrategy::Hybrid => None,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_iteration_maps_to_direct_chat() {
        assert_eq!(
            phase_step_for_strategy(ExecutionStrategy::DirectIteration, PhaseStepType::ToolCall),
            PhaseStepType::DirectChat
        );
    }

    #[test]
    fn delegated_workflow_maps_to_delegated_workflow_step() {
        assert_eq!(
            phase_step_for_strategy(
                ExecutionStrategy::DelegatedWorkflow,
                PhaseStepType::DirectChat,
            ),
            PhaseStepType::DelegatedWorkflow
        );
    }

    #[test]
    fn delegated_agent_maps_to_delegated_worker_step() {
        assert_eq!(
            phase_step_for_strategy(ExecutionStrategy::DelegatedAgent, PhaseStepType::DirectChat,),
            PhaseStepType::DelegatedWorker
        );
    }

    #[test]
    fn hybrid_falls_back_to_policy_hint() {
        assert_eq!(
            phase_step_for_strategy(ExecutionStrategy::Hybrid, PhaseStepType::ToolCall),
            PhaseStepType::ToolCall
        );
        assert_eq!(
            phase_step_for_strategy(ExecutionStrategy::Hybrid, PhaseStepType::DelegatedWorker,),
            PhaseStepType::DelegatedWorker
        );
    }

    #[test]
    fn observable_frame_strategy_keeps_hybrid_out_of_overlap_samples() {
        assert_eq!(
            phase_step_for_observable_frame_strategy(ExecutionStrategy::DirectIteration),
            Some(PhaseStepType::DirectChat)
        );
        assert_eq!(
            phase_step_for_observable_frame_strategy(ExecutionStrategy::DelegatedWorkflow),
            Some(PhaseStepType::DelegatedWorkflow)
        );
        assert_eq!(
            phase_step_for_observable_frame_strategy(ExecutionStrategy::DelegatedAgent),
            Some(PhaseStepType::DelegatedWorker)
        );
        assert_eq!(
            phase_step_for_observable_frame_strategy(ExecutionStrategy::Hybrid),
            None
        );
    }
}
