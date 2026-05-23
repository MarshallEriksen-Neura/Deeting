use super::decision::RuntimeTransitionDecisionContext;
use super::types::{
    EffectScope, HookDecision, HookEnforcementMode, ProposedAction, RuntimeStateKind,
    RuntimeTransition,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeTransitionRolloutStage {
    ShadowEvidence,
    Advisory,
    Enforced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RuntimeTransitionHookPolicy {
    rollout_stage: RuntimeTransitionRolloutStage,
}

impl RuntimeTransitionHookPolicy {
    pub(crate) const fn current() -> Self {
        Self::shadow_only()
    }

    pub(crate) const fn shadow_only() -> Self {
        Self {
            rollout_stage: RuntimeTransitionRolloutStage::ShadowEvidence,
        }
    }

    pub(crate) const fn advisory() -> Self {
        Self {
            rollout_stage: RuntimeTransitionRolloutStage::Advisory,
        }
    }

    pub(crate) const fn enforced() -> Self {
        Self {
            rollout_stage: RuntimeTransitionRolloutStage::Enforced,
        }
    }

    pub(crate) fn decision_context(
        self,
        transition: &RuntimeTransition,
    ) -> RuntimeTransitionDecisionContext {
        RuntimeTransitionDecisionContext {
            default_enforcement: self.enforcement_mode_for(transition),
        }
    }

    pub(crate) fn enforcement_mode_for(
        self,
        transition: &RuntimeTransition,
    ) -> HookEnforcementMode {
        match self.rollout_stage {
            RuntimeTransitionRolloutStage::ShadowEvidence => HookEnforcementMode::Shadow,
            RuntimeTransitionRolloutStage::Advisory => {
                if self.is_candidate_for_future_enforcement(transition) {
                    HookEnforcementMode::Advisory
                } else {
                    HookEnforcementMode::Shadow
                }
            }
            RuntimeTransitionRolloutStage::Enforced => {
                if self.is_candidate_for_future_enforcement(transition) {
                    HookEnforcementMode::Enforced
                } else {
                    HookEnforcementMode::Shadow
                }
            }
        }
    }

    pub(crate) fn should_apply_runtime_gate(
        self,
        transition: &RuntimeTransition,
        decision: &HookDecision,
    ) -> bool {
        matches!(
            (self.enforcement_mode_for(transition), decision),
            (
                HookEnforcementMode::Enforced,
                HookDecision::RequireArtifact { .. }
            )
        )
    }

    fn is_candidate_for_future_enforcement(self, transition: &RuntimeTransition) -> bool {
        if matches!(
            transition.proposed_action,
            ProposedAction::DirectAnswer | ProposedAction::Noop
        ) {
            return false;
        }
        if transition.to_state == RuntimeStateKind::Finalized {
            return false;
        }

        matches!(
            (&transition.proposed_action, &transition.effect_scope),
            (
                ProposedAction::ExecuteTool,
                EffectScope::Workspace | EffectScope::External | EffectScope::Unknown
            ) | (
                ProposedAction::AdmitExecutableCapability,
                EffectScope::Workspace | EffectScope::External | EffectScope::Unknown
            )
        ) && transition.observed_evidence.is_empty()
    }
}

impl Default for RuntimeTransitionHookPolicy {
    fn default() -> Self {
        Self::shadow_only()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::desktop_runtime::runtime::runtime_transition::decision::decide_transition;
    use crate::modules::desktop_runtime::runtime::runtime_transition::types::{
        EvidenceRef, RequiredArtifact, TransitionSource,
    };
    use serde_json::{json, Value};

    fn transition(proposed_action: ProposedAction, effect_scope: EffectScope) -> RuntimeTransition {
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
            tool_name: Some("shell_execute".to_string()),
            effect_scope,
            observed_evidence: Vec::new(),
            uncertainty_flags: Vec::new(),
            metadata_json: Value::Null,
        }
    }

    #[test]
    fn shadow_policy_keeps_all_candidates_in_shadow() {
        let transition = transition(ProposedAction::ExecuteTool, EffectScope::Workspace);
        let policy = RuntimeTransitionHookPolicy::shadow_only();
        let decision = decide_transition(&transition, &policy.decision_context(&transition));

        assert_eq!(
            decision,
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::DitingThinkPreflight,
                reason: "tool execution proposal crosses from model output into runtime action"
                    .to_string(),
                enforcement: HookEnforcementMode::Shadow,
            }
        );
        assert!(!policy.should_apply_runtime_gate(&transition, &decision));
    }

    #[test]
    fn advisory_policy_marks_only_risky_execution_boundaries() {
        let transition = transition(ProposedAction::ExecuteTool, EffectScope::Workspace);
        let policy = RuntimeTransitionHookPolicy::advisory();
        let decision = decide_transition(&transition, &policy.decision_context(&transition));

        assert_eq!(
            policy.enforcement_mode_for(&transition),
            HookEnforcementMode::Advisory
        );
        assert!(matches!(
            decision,
            HookDecision::RequireArtifact {
                enforcement: HookEnforcementMode::Advisory,
                ..
            }
        ));
        assert!(!policy.should_apply_runtime_gate(&transition, &decision));
    }

    #[test]
    fn enforced_policy_never_blocks_direct_answer_turns() {
        let mut transition = transition(ProposedAction::DirectAnswer, EffectScope::ReadOnly);
        transition.tool_name = None;
        transition.to_state = RuntimeStateKind::FinalAnswerProposed;
        let policy = RuntimeTransitionHookPolicy::enforced();
        let decision = decide_transition(&transition, &policy.decision_context(&transition));

        assert_eq!(
            policy.enforcement_mode_for(&transition),
            HookEnforcementMode::Shadow
        );
        assert_eq!(
            decision,
            HookDecision::Allow {
                reason: "transition does not propose runtime execution".to_string()
            }
        );
        assert!(!policy.should_apply_runtime_gate(&transition, &decision));
    }

    #[test]
    fn observed_execution_is_not_a_first_enforcement_candidate() {
        let mut transition = transition(ProposedAction::ExecuteTool, EffectScope::Workspace);
        transition.observed_evidence.push(EvidenceRef {
            kind: "tool_result".to_string(),
            source: "tool_trace".to_string(),
            id: Some("call-1".to_string()),
            metadata_json: json!({"status":"success"}),
        });
        let policy = RuntimeTransitionHookPolicy::enforced();

        assert_eq!(
            policy.enforcement_mode_for(&transition),
            HookEnforcementMode::Shadow
        );
    }
}
