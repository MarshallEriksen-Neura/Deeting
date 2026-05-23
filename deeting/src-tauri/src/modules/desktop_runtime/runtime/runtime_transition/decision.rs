use super::types::{
    EffectScope, HookDecision, HookEnforcementMode, ProposedAction, RequiredArtifact,
    RuntimeStateKind, RuntimeTransition,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RuntimeTransitionDecisionContext {
    pub(crate) default_enforcement: HookEnforcementMode,
}

impl Default for RuntimeTransitionDecisionContext {
    fn default() -> Self {
        Self {
            default_enforcement: HookEnforcementMode::Shadow,
        }
    }
}

pub(crate) fn decide_transition(
    transition: &RuntimeTransition,
    context: &RuntimeTransitionDecisionContext,
) -> HookDecision {
    match transition.proposed_action {
        ProposedAction::DirectAnswer | ProposedAction::Noop => HookDecision::Allow {
            reason: "transition does not propose runtime execution".to_string(),
        },
        ProposedAction::DraftPlan => HookDecision::RequireArtifact {
            artifact: RequiredArtifact::PlanDraft,
            reason: "transition uncertainty should be framed as adaptive planning context"
                .to_string(),
            enforcement: context.default_enforcement,
        },
        ProposedAction::ExecuteTool => HookDecision::RequireArtifact {
            artifact: RequiredArtifact::DitingThinkPreflight,
            reason: "tool execution proposal crosses from model output into runtime action"
                .to_string(),
            enforcement: context.default_enforcement,
        },
        ProposedAction::ExposeCapability | ProposedAction::AdmitExecutableCapability => {
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::CapabilityLease,
                reason:
                    "dynamic capability exposure should be correlated before future enforcement"
                        .to_string(),
                enforcement: context.default_enforcement,
            }
        }
        ProposedAction::RevisePlan => HookDecision::RequireArtifact {
            artifact: RequiredArtifact::PlanRevision,
            reason: "runtime observation indicates plan assumptions may need revision".to_string(),
            enforcement: context.default_enforcement,
        },
        ProposedAction::VerifyFinalAnswer => final_answer_decision(transition, context),
        ProposedAction::RecordMonitorCheckpoint => HookDecision::RequireArtifact {
            artifact: RequiredArtifact::MonitorCheckpoint,
            reason: "monitor output is evidence for later correlation, not direct policy truth"
                .to_string(),
            enforcement: context.default_enforcement,
        },
    }
}

fn final_answer_decision(
    transition: &RuntimeTransition,
    context: &RuntimeTransitionDecisionContext,
) -> HookDecision {
    if transition.to_state == RuntimeStateKind::Finalized {
        return HookDecision::Allow {
            reason: "transition already represents finalized runtime state".to_string(),
        };
    }

    if transition.observed_evidence.is_empty()
        || matches!(
            transition.effect_scope,
            EffectScope::Workspace | EffectScope::External
        )
    {
        return HookDecision::RequireArtifact {
            artifact: RequiredArtifact::VerificationPlan,
            reason: "final answer proposal needs explicit verification evidence before completion"
                .to_string(),
            enforcement: context.default_enforcement,
        };
    }

    HookDecision::Allow {
        reason: "final answer proposal already carries verification evidence".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::desktop_runtime::runtime::runtime_transition::types::{
        EvidenceRef, TransitionSource,
    };
    use serde_json::{json, Value};

    fn transition(proposed_action: ProposedAction) -> RuntimeTransition {
        RuntimeTransition {
            transition_id: "transition-1".to_string(),
            trace_id: "trace-1".to_string(),
            request_id: Some("request-1".to_string()),
            session_id: "session-1".to_string(),
            source: TransitionSource::ProviderResponse,
            from_state: RuntimeStateKind::ModelProposal,
            to_state: RuntimeStateKind::ToolExecutionPending,
            proposed_action,
            capability_id: None,
            tool_name: None,
            effect_scope: EffectScope::ReadOnly,
            observed_evidence: Vec::new(),
            uncertainty_flags: Vec::new(),
            metadata_json: Value::Null,
        }
    }

    #[test]
    fn direct_answer_is_allowed() {
        let mut transition = transition(ProposedAction::DirectAnswer);
        transition.to_state = RuntimeStateKind::FinalAnswerProposed;

        assert_eq!(
            decide_transition(&transition, &RuntimeTransitionDecisionContext::default()),
            HookDecision::Allow {
                reason: "transition does not propose runtime execution".to_string()
            }
        );
    }

    #[test]
    fn uncertain_transition_requests_shadow_plan_draft() {
        let mut transition = transition(ProposedAction::DraftPlan);
        transition.uncertainty_flags = vec!["capability_set_changed".to_string()];

        assert_eq!(
            decide_transition(&transition, &RuntimeTransitionDecisionContext::default()),
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::PlanDraft,
                reason: "transition uncertainty should be framed as adaptive planning context"
                    .to_string(),
                enforcement: HookEnforcementMode::Shadow,
            }
        );
    }
    #[test]
    fn tool_execution_requests_shadow_preflight() {
        let mut transition = transition(ProposedAction::ExecuteTool);
        transition.tool_name = Some("shell_execute".to_string());

        assert_eq!(
            decide_transition(&transition, &RuntimeTransitionDecisionContext::default()),
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::DitingThinkPreflight,
                reason: "tool execution proposal crosses from model output into runtime action"
                    .to_string(),
                enforcement: HookEnforcementMode::Shadow,
            }
        );
    }

    #[test]
    fn dynamic_capability_exposure_requests_shadow_capability_lease() {
        let mut transition = transition(ProposedAction::ExposeCapability);
        transition.source = TransitionSource::CapabilityDiscovery;
        transition.from_state = RuntimeStateKind::CapabilityDiscovered;
        transition.to_state = RuntimeStateKind::CapabilityExposed;
        transition.capability_id = Some("local.search_sdk.shell".to_string());

        assert_eq!(
            decide_transition(&transition, &RuntimeTransitionDecisionContext::default()),
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::CapabilityLease,
                reason:
                    "dynamic capability exposure should be correlated before future enforcement"
                        .to_string(),
                enforcement: HookEnforcementMode::Shadow,
            }
        );
    }

    #[test]
    fn finalization_without_evidence_requests_shadow_verification_plan() {
        let mut transition = transition(ProposedAction::VerifyFinalAnswer);
        transition.from_state = RuntimeStateKind::ExecutionObserved;
        transition.to_state = RuntimeStateKind::FinalAnswerProposed;
        transition.effect_scope = EffectScope::Workspace;

        assert_eq!(
            decide_transition(&transition, &RuntimeTransitionDecisionContext::default()),
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::VerificationPlan,
                reason:
                    "final answer proposal needs explicit verification evidence before completion"
                        .to_string(),
                enforcement: HookEnforcementMode::Shadow,
            }
        );
    }

    #[test]
    fn finalization_with_evidence_is_allowed() {
        let mut transition = transition(ProposedAction::VerifyFinalAnswer);
        transition.from_state = RuntimeStateKind::ExecutionObserved;
        transition.to_state = RuntimeStateKind::FinalAnswerProposed;
        transition.observed_evidence.push(EvidenceRef {
            kind: "test".to_string(),
            source: "cargo".to_string(),
            id: Some("runtime_transition_tests".to_string()),
            metadata_json: json!({"passed": true}),
        });

        assert_eq!(
            decide_transition(&transition, &RuntimeTransitionDecisionContext::default()),
            HookDecision::Allow {
                reason: "final answer proposal already carries verification evidence".to_string()
            }
        );
    }
}
