use super::super::hooks::SelfEvolutionHook;
use crate::modules::mcp::store::McpStore;
use desktop_runtime_core::{
    DitingThinkPreflightHook, FrameFreshnessHook, Hook, HookDecision, HookEnforcementMode,
    HookEvent, HookEventInterest, HookRegistry, PlanDraftHook, RequiredArtifact,
    RuntimeApprovalHook, RuntimeCapabilityChangeHook, RuntimeCompressionHook, RuntimeMemoryHook,
    RuntimeStateView,
};
use std::sync::Arc;

pub(crate) fn build_deeting_policy_hook_registry(store: Arc<McpStore>) -> HookRegistry {
    let mut registry = HookRegistry::new();
    registry.register(PlanDraftHook);
    registry.register(FrameFreshnessHook);
    registry.register(DitingThinkPreflightHook);
    registry.register(SelfEvolutionHook::new(store));
    registry.register(RuntimeApprovalHook);
    registry.register(RuntimeCompressionHook);
    registry.register(RuntimeMemoryHook);
    registry.register(RuntimeCapabilityChangeHook);
    registry.register(UserInterruptionPolicyHook);
    registry.register(AsyncObservationPolicyHook);
    registry
}

#[derive(Debug, Clone, Copy)]
struct UserInterruptionPolicyHook;

const USER_INTERRUPTION_INTERESTS: [HookEventInterest; 1] = [HookEventInterest::UserInterrupted];

impl Hook for UserInterruptionPolicyHook {
    fn name(&self) -> &'static str {
        "deeting_user_interruption_policy"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &USER_INTERRUPTION_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
        let HookEvent::UserInterrupted { message } = event else {
            return allow("user interruption hook ignored unrelated event");
        };

        if message.trim().is_empty() {
            return HookDecision::Block {
                reason: "user interruption arrived without content".to_string(),
            };
        }

        HookDecision::RequireArtifact {
            artifact: RequiredArtifact::MonitorCheckpoint,
            reason: "user interruption should be captured as runtime monitoring evidence"
                .to_string(),
            enforcement: HookEnforcementMode::Enforced,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct AsyncObservationPolicyHook;

const ASYNC_OBSERVATION_INTERESTS: [HookEventInterest; 1] =
    [HookEventInterest::AsyncObservationArrived];

impl Hook for AsyncObservationPolicyHook {
    fn name(&self) -> &'static str {
        "deeting_async_observation_policy"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &ASYNC_OBSERVATION_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
        let HookEvent::AsyncObservationArrived { observation, .. } = event else {
            return allow("async observation hook ignored unrelated event");
        };

        if observation.is_null() {
            return allow("async observation event carried no payload");
        }

        HookDecision::RequireArtifact {
            artifact: RequiredArtifact::VerificationPlan,
            reason: "async observation should be correlated against a verification plan"
                .to_string(),
            enforcement: HookEnforcementMode::Enforced,
        }
    }
}

fn allow(reason: &str) -> HookDecision {
    HookDecision::Allow {
        reason: reason.to_string(),
    }
}
