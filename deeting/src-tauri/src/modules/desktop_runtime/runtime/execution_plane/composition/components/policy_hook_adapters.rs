use super::super::hooks::SelfEvolutionHook;
use crate::modules::mcp::store::McpStore;
use desktop_runtime_core::{
    FrameFreshnessHook, Hook, HookDecision, HookEnforcementMode, HookEvent, HookEventInterest,
    HookRegistry, MemoryWriteRequest, PlanDraftHook, RequiredArtifact, RuntimeStateView,
};
use std::sync::Arc;

pub(crate) fn build_deeting_policy_hook_registry(store: Arc<McpStore>) -> HookRegistry {
    let mut registry = HookRegistry::new();
    registry.register(PlanDraftHook);
    registry.register(FrameFreshnessHook);
    registry.register(SelfEvolutionHook::new(store));
    registry.register(ApprovalPolicyHook);
    registry.register(CompressionPolicyHook);
    registry.register(MemoryPolicyHook);
    registry.register(CapabilityChangePolicyHook);
    registry.register(UserInterruptionPolicyHook);
    registry.register(AsyncObservationPolicyHook);
    registry
}

#[derive(Debug, Clone, Copy)]
struct ApprovalPolicyHook;

const APPROVAL_INTERESTS: [HookEventInterest; 1] = [HookEventInterest::OperationProposed];

impl Hook for ApprovalPolicyHook {
    fn name(&self) -> &'static str {
        "deeting_approval_policy"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &APPROVAL_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
        let HookEvent::OperationProposed { risk_class, .. } = event else {
            return allow("approval hook ignored unrelated event");
        };

        if risk_class.eq_ignore_ascii_case("requires_approval")
            || risk_class.eq_ignore_ascii_case("high")
        {
            return HookDecision::RequireUserApproval {
                operation: "mcp_tool_call".to_string(),
                reason: "operation risk class requires user approval".to_string(),
            };
        }

        allow("operation risk does not require approval")
    }
}

#[derive(Debug, Clone, Copy)]
struct CompressionPolicyHook;

const COMPRESSION_INTERESTS: [HookEventInterest; 1] = [HookEventInterest::ContextPressure];

impl Hook for CompressionPolicyHook {
    fn name(&self) -> &'static str {
        "deeting_compression_policy"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &COMPRESSION_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
        let HookEvent::ContextPressure { tokens_used, limit } = event else {
            return allow("compression hook ignored unrelated event");
        };

        if *limit > 0 && tokens_used.saturating_mul(100) / *limit >= 85 {
            return HookDecision::RequestContextCompression {
                reason: "context token usage crossed compression threshold".to_string(),
            };
        }

        allow("context pressure below compression threshold")
    }
}

#[derive(Debug, Clone, Copy)]
struct MemoryPolicyHook;

const MEMORY_INTERESTS: [HookEventInterest; 1] = [HookEventInterest::PhaseCompleted];

impl Hook for MemoryPolicyHook {
    fn name(&self) -> &'static str {
        "deeting_memory_policy"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &MEMORY_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
        let HookEvent::PhaseCompleted {
            candidate_memory_facts,
            ..
        } = event
        else {
            return allow("memory hook ignored unrelated event");
        };

        if candidate_memory_facts.is_empty() {
            return allow("phase produced no candidate memory facts");
        }

        HookDecision::RequestMemoryWrite {
            entries: candidate_memory_facts
                .iter()
                .enumerate()
                .map(|(index, fact)| MemoryWriteRequest {
                    key: format!("candidate_memory_fact_{}", index + 1),
                    value: fact
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| fact.to_string()),
                })
                .collect(),
            reason: "phase produced candidate memory facts for runtime-side review".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct CapabilityChangePolicyHook;

const CAPABILITY_INTERESTS: [HookEventInterest; 1] = [HookEventInterest::CapabilityChanged];

impl Hook for CapabilityChangePolicyHook {
    fn name(&self) -> &'static str {
        "deeting_capability_change_policy"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &CAPABILITY_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
        let HookEvent::CapabilityChanged { added, removed } = event else {
            return allow("capability hook ignored unrelated event");
        };

        if !added.is_empty() || !removed.is_empty() {
            return HookDecision::RequestFrameValidation {
                reason: "capability set changed and frame should be revalidated".to_string(),
            };
        }

        allow("capability set unchanged")
    }
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
