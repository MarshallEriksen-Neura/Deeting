use crate::frame::WorldModelFrame;
use crate::plan::{PhaseId, PlanArtifact};
use crate::task::TaskInputSource;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuntimeStateView {
    pub current_frame: WorldModelFrame,
    pub current_plan: Option<PlanArtifact>,
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommitBoundary {
    ProposeNextPhase,
    ProposePhaseExecution { phase_id: PhaseId },
    ProposeCapabilityAdmit,
    ProposeFinalAnswer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum HookEvent {
    CommitBoundary(CommitBoundary),
    PhaseObserved {
        phase_id: PhaseId,
        observation: Value,
    },
    OperationProposed {
        operation: Value,
        risk_class: String,
    },
    ContextPressure {
        tokens_used: usize,
        limit: usize,
    },
    PhaseCompleted {
        phase_id: PhaseId,
        candidate_memory_facts: Vec<Value>,
    },
    CapabilityChanged {
        added: Vec<String>,
        removed: Vec<String>,
    },
    UserInterrupted {
        message: String,
    },
    TaskInitiated {
        source: TaskInputSource,
    },
    AsyncObservationArrived {
        phase_id: PhaseId,
        awaiting_id: String,
        observation: Value,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum HookDecisionRank {
    Allow = 0,
    RequestMemoryWrite = 1,
    DeferUntilStable = 2,
    RequestContextCompression = 3,
    RequestFrameValidation = 4,
    RequirePlanArtifact = 5,
    RequireFrameArtifact = 6,
    RequireUserApproval = 7,
    Block = 8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HookDecision {
    Allow {
        reason: String,
    },
    RequireArtifact {
        artifact: RequiredArtifact,
        reason: String,
        enforcement: HookEnforcementMode,
    },
    RequestFrameValidation {
        reason: String,
    },
    RequestContextCompression {
        reason: String,
    },
    RequestMemoryWrite {
        entries: Vec<MemoryWriteRequest>,
        reason: String,
    },
    RequireUserApproval {
        operation: String,
        reason: String,
    },
    DeferUntilStable {
        reason: String,
    },
    Block {
        reason: String,
    },
    Composite {
        decisions: Vec<HookDecision>,
    },
}

impl HookDecision {
    pub fn rank(&self) -> HookDecisionRank {
        match self {
            Self::Allow { .. } => HookDecisionRank::Allow,
            Self::RequestMemoryWrite { .. } => HookDecisionRank::RequestMemoryWrite,
            Self::DeferUntilStable { .. } => HookDecisionRank::DeferUntilStable,
            Self::RequestContextCompression { .. } => HookDecisionRank::RequestContextCompression,
            Self::RequestFrameValidation { .. } => HookDecisionRank::RequestFrameValidation,
            Self::RequireArtifact { artifact, .. } => artifact.decision_rank(),
            Self::RequireUserApproval { .. } => HookDecisionRank::RequireUserApproval,
            Self::Block { .. } => HookDecisionRank::Block,
            Self::Composite { decisions } => decisions
                .iter()
                .map(HookDecision::rank)
                .max()
                .unwrap_or(HookDecisionRank::Allow),
        }
    }

    pub fn highest_priority(decisions: Vec<Self>) -> Self {
        let mut non_allow: Vec<Self> = decisions
            .into_iter()
            .filter(|decision| !matches!(decision, Self::Allow { .. }))
            .collect();
        if non_allow.is_empty() {
            return Self::Allow {
                reason: "all hooks allowed commit boundary".to_string(),
            };
        }

        let highest_rank = non_allow
            .iter()
            .map(HookDecision::rank)
            .max()
            .unwrap_or(HookDecisionRank::Allow);
        non_allow.retain(|decision| decision.rank() == highest_rank);
        if non_allow.len() == 1 {
            non_allow.remove(0)
        } else {
            Self::Composite {
                decisions: non_allow,
            }
        }
    }

    pub fn contains_required_artifact(&self, required: RequiredArtifact) -> bool {
        match self {
            Self::RequireArtifact { artifact, .. } => *artifact == required,
            Self::Composite { decisions } => decisions
                .iter()
                .any(|decision| decision.contains_required_artifact(required)),
            _ => false,
        }
    }

    pub fn contains_block(&self) -> bool {
        match self {
            Self::Block { .. } => true,
            Self::Composite { decisions } => decisions.iter().any(HookDecision::contains_block),
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RequiredArtifact {
    WorldModelFrameRefresh,
    WorldModelFrameRevision,
    DitingThinkPreflight,
    PlanDraft,
    PlanRevision,
    VerificationPlan,
    CapabilityLease,
    MonitorCheckpoint,
}

impl RequiredArtifact {
    pub const fn decision_rank(self) -> HookDecisionRank {
        match self {
            Self::WorldModelFrameRefresh
            | Self::WorldModelFrameRevision
            | Self::DitingThinkPreflight => HookDecisionRank::RequireFrameArtifact,
            Self::PlanDraft | Self::PlanRevision | Self::VerificationPlan => {
                HookDecisionRank::RequirePlanArtifact
            }
            Self::CapabilityLease | Self::MonitorCheckpoint => {
                HookDecisionRank::RequirePlanArtifact
            }
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HookEnforcementMode {
    Enforced,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemoryWriteRequest {
    pub key: String,
    pub value: String,
}

pub trait Hook: Send + Sync {
    fn name(&self) -> &'static str;
    fn interests(&self) -> &[HookEventInterest];
    fn evaluate(&self, event: &HookEvent, state: &RuntimeStateView) -> HookDecision;
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HookEventInterest {
    ProposeNextPhase,
    ProposePhaseExecution,
    ProposeCapabilityAdmit,
    ProposeFinalAnswer,
    PhaseObserved,
    OperationProposed,
    ContextPressure,
    PhaseCompleted,
    CapabilityChanged,
    UserInterrupted,
    TaskInitiated,
    AsyncObservationArrived,
    All,
}

impl HookEventInterest {
    pub const fn matches(self, event: &HookEvent) -> bool {
        match (self, event) {
            (Self::All, _) => true,
            (
                Self::ProposeNextPhase,
                HookEvent::CommitBoundary(CommitBoundary::ProposeNextPhase),
            ) => true,
            (
                Self::ProposePhaseExecution,
                HookEvent::CommitBoundary(CommitBoundary::ProposePhaseExecution { .. }),
            ) => true,
            (
                Self::ProposeCapabilityAdmit,
                HookEvent::CommitBoundary(CommitBoundary::ProposeCapabilityAdmit),
            ) => true,
            (
                Self::ProposeFinalAnswer,
                HookEvent::CommitBoundary(CommitBoundary::ProposeFinalAnswer),
            ) => true,
            (Self::PhaseObserved, HookEvent::PhaseObserved { .. }) => true,
            (Self::OperationProposed, HookEvent::OperationProposed { .. }) => true,
            (Self::ContextPressure, HookEvent::ContextPressure { .. }) => true,
            (Self::PhaseCompleted, HookEvent::PhaseCompleted { .. }) => true,
            (Self::CapabilityChanged, HookEvent::CapabilityChanged { .. }) => true,
            (Self::UserInterrupted, HookEvent::UserInterrupted { .. }) => true,
            (Self::TaskInitiated, HookEvent::TaskInitiated { .. }) => true,
            (Self::AsyncObservationArrived, HookEvent::AsyncObservationArrived { .. }) => true,
            _ => false,
        }
    }
}

#[derive(Default)]
pub struct HookRegistry {
    hooks: Vec<Box<dyn Hook>>,
}

impl HookRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register<H>(&mut self, hook: H)
    where
        H: Hook + 'static,
    {
        self.hooks.push(Box::new(hook));
    }

    pub fn evaluate(&self, event: &HookEvent, state: &RuntimeStateView) -> HookDecision {
        let decisions: Vec<_> = self
            .hooks
            .iter()
            .filter(|hook| {
                hook.interests()
                    .iter()
                    .any(|interest| interest.matches(event))
            })
            .map(|hook| hook.evaluate(event, state))
            .collect();

        if decisions.is_empty() {
            HookDecision::Allow {
                reason: "no hook subscribed to commit boundary".to_string(),
            }
        } else {
            HookDecision::highest_priority(decisions)
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PlanDraftHook;

const PLAN_DRAFT_HOOK_INTERESTS: [HookEventInterest; 1] = [HookEventInterest::ProposeNextPhase];

impl Hook for PlanDraftHook {
    fn name(&self) -> &'static str {
        "plan_draft"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &PLAN_DRAFT_HOOK_INTERESTS
    }

    fn evaluate(&self, _event: &HookEvent, state: &RuntimeStateView) -> HookDecision {
        let needs_plan = state.current_frame.execution_strategy.needs_explicit_plan();
        let has_plan = state.current_plan.as_ref().is_some_and(|plan| {
            !plan.committed_phases.is_empty() || !plan.proposed_phases.is_empty()
        });

        if needs_plan && !has_plan {
            return HookDecision::RequireArtifact {
                artifact: RequiredArtifact::PlanDraft,
                reason: "non-trivial frame strategy needs a plan draft before phase execution"
                    .to_string(),
                enforcement: HookEnforcementMode::Enforced,
            };
        }

        HookDecision::Allow {
            reason: "plan state is sufficient for next phase proposal".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct FrameFreshnessHook;

const FRAME_FRESHNESS_INTERESTS: [HookEventInterest; 5] = [
    HookEventInterest::ProposeNextPhase,
    HookEventInterest::ProposePhaseExecution,
    HookEventInterest::ProposeFinalAnswer,
    HookEventInterest::ProposeCapabilityAdmit,
    HookEventInterest::PhaseCompleted,
];

impl Hook for FrameFreshnessHook {
    fn name(&self) -> &'static str {
        "frame_freshness"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &FRAME_FRESHNESS_INTERESTS
    }

    fn evaluate(&self, _event: &HookEvent, state: &RuntimeStateView) -> HookDecision {
        if state.current_frame.needs_revision() {
            return HookDecision::RequireArtifact {
                artifact: RequiredArtifact::WorldModelFrameRevision,
                reason: "current frame was contradicted and needs revision before the next commit boundary".to_string(),
                enforcement: HookEnforcementMode::Enforced,
            };
        }

        if state.current_frame.needs_refresh() {
            return HookDecision::RequireArtifact {
                artifact: RequiredArtifact::WorldModelFrameRefresh,
                reason: "current frame is not fresh enough for this commit boundary".to_string(),
                enforcement: HookEnforcementMode::Enforced,
            };
        }

        HookDecision::Allow {
            reason: "frame is fresh for commit boundary".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DitingThinkPreflightHook;

const DITING_THINK_PREFLIGHT_INTERESTS: [HookEventInterest; 1] =
    [HookEventInterest::ProposePhaseExecution];

impl Hook for DitingThinkPreflightHook {
    fn name(&self) -> &'static str {
        "diting_think_preflight"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &DITING_THINK_PREFLIGHT_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, state: &RuntimeStateView) -> HookDecision {
        if !matches!(
            event,
            HookEvent::CommitBoundary(CommitBoundary::ProposePhaseExecution { .. })
        ) {
            return HookDecision::Allow {
                reason: "diting think hook ignored unrelated event".to_string(),
            };
        }
        if !state.current_frame.execution_strategy.needs_explicit_plan() {
            return HookDecision::Allow {
                reason: "direct iteration does not need diting think preflight".to_string(),
            };
        }
        if state
            .current_frame
            .known_facts
            .iter()
            .any(|fact| fact.source == "diting_think")
        {
            return HookDecision::Allow {
                reason: "diting think frame facts already captured".to_string(),
            };
        }

        HookDecision::RequireArtifact {
            artifact: RequiredArtifact::DitingThinkPreflight,
            reason: "non-direct world model phase needs a task-local preflight frame".to_string(),
            enforcement: HookEnforcementMode::Enforced,
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RuntimeApprovalHook;

const RUNTIME_APPROVAL_INTERESTS: [HookEventInterest; 1] = [HookEventInterest::OperationProposed];

impl Hook for RuntimeApprovalHook {
    fn name(&self) -> &'static str {
        "runtime_approval"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &RUNTIME_APPROVAL_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
        let HookEvent::OperationProposed {
            operation,
            risk_class,
        } = event
        else {
            return HookDecision::Allow {
                reason: "approval hook ignored unrelated event".to_string(),
            };
        };

        let normalized = risk_class.trim().to_ascii_lowercase();
        if matches!(
            normalized.as_str(),
            "requires_approval" | "approval_required" | "high" | "critical"
        ) {
            return HookDecision::RequireUserApproval {
                operation: operation
                    .get("tool_name")
                    .and_then(Value::as_str)
                    .or_else(|| operation.get("name").and_then(Value::as_str))
                    .unwrap_or("operation")
                    .to_string(),
                reason: format!("operation risk class requires user approval: {risk_class}"),
            };
        }

        HookDecision::Allow {
            reason: "operation risk does not require approval".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RuntimeCompressionHook;

const RUNTIME_COMPRESSION_INTERESTS: [HookEventInterest; 1] = [HookEventInterest::ContextPressure];

impl Hook for RuntimeCompressionHook {
    fn name(&self) -> &'static str {
        "runtime_compression"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &RUNTIME_COMPRESSION_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
        let HookEvent::ContextPressure { tokens_used, limit } = event else {
            return HookDecision::Allow {
                reason: "compression hook ignored unrelated event".to_string(),
            };
        };

        if *limit > 0 && tokens_used.saturating_mul(100) / *limit >= 85 {
            return HookDecision::RequestContextCompression {
                reason: "context token usage crossed compression threshold".to_string(),
            };
        }

        HookDecision::Allow {
            reason: "context pressure below compression threshold".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RuntimeMemoryHook;

const RUNTIME_MEMORY_INTERESTS: [HookEventInterest; 1] = [HookEventInterest::PhaseCompleted];

impl Hook for RuntimeMemoryHook {
    fn name(&self) -> &'static str {
        "runtime_memory"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &RUNTIME_MEMORY_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
        let HookEvent::PhaseCompleted {
            candidate_memory_facts,
            ..
        } = event
        else {
            return HookDecision::Allow {
                reason: "memory hook ignored unrelated event".to_string(),
            };
        };

        if candidate_memory_facts.is_empty() {
            return HookDecision::Allow {
                reason: "phase produced no candidate memory facts".to_string(),
            };
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

#[derive(Debug, Clone, Copy, Default)]
pub struct RuntimeCapabilityChangeHook;

const RUNTIME_CAPABILITY_CHANGE_INTERESTS: [HookEventInterest; 1] =
    [HookEventInterest::CapabilityChanged];

impl Hook for RuntimeCapabilityChangeHook {
    fn name(&self) -> &'static str {
        "runtime_capability_change"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &RUNTIME_CAPABILITY_CHANGE_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
        let HookEvent::CapabilityChanged { added, removed } = event else {
            return HookDecision::Allow {
                reason: "capability hook ignored unrelated event".to_string(),
            };
        };

        if !added.is_empty() || !removed.is_empty() {
            return HookDecision::RequestFrameValidation {
                reason: "capability set changed and frame should be revalidated".to_string(),
            };
        }

        HookDecision::Allow {
            reason: "capability set unchanged".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{ExecutionStrategy, Fact, FrameProvenance, WorldModelFrame};

    fn frame(strategy: ExecutionStrategy) -> WorldModelFrame {
        WorldModelFrame::new(
            "frame-1",
            "session-1",
            "task-1",
            "ship runtime core",
            strategy,
            FrameProvenance::bootstrap("test"),
        )
    }

    #[test]
    fn registry_selects_strongest_decision() {
        let mut registry = HookRegistry::new();
        registry.register(PlanDraftHook);
        registry.register(FrameFreshnessHook);

        let event = HookEvent::CommitBoundary(CommitBoundary::ProposeNextPhase);
        let state = RuntimeStateView {
            current_frame: frame(ExecutionStrategy::DelegatedWorkflow),
            current_plan: None,
            metadata: Value::Null,
        };

        assert!(matches!(
            registry.evaluate(&event, &state),
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::PlanDraft,
                enforcement: HookEnforcementMode::Enforced,
                ..
            }
        ));
    }

    #[test]
    fn stale_frame_blocks_before_plan_draft_precedence() {
        let mut registry = HookRegistry::new();
        registry.register(PlanDraftHook);
        registry.register(FrameFreshnessHook);
        let mut current_frame = frame(ExecutionStrategy::DelegatedWorkflow);
        current_frame.mark_stale();

        let event = HookEvent::CommitBoundary(CommitBoundary::ProposeNextPhase);
        let state = RuntimeStateView {
            current_frame,
            current_plan: None,
            metadata: Value::Null,
        };

        assert!(matches!(
            registry.evaluate(&event, &state),
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::WorldModelFrameRefresh,
                ..
            }
        ));
    }

    #[test]
    fn contradicted_frame_requests_revision_before_plan_draft_precedence() {
        let mut registry = HookRegistry::new();
        registry.register(PlanDraftHook);
        registry.register(FrameFreshnessHook);
        let mut current_frame = frame(ExecutionStrategy::DelegatedWorkflow);
        current_frame.mark_contradicted();

        let event = HookEvent::CommitBoundary(CommitBoundary::ProposeNextPhase);
        let state = RuntimeStateView {
            current_frame,
            current_plan: None,
            metadata: Value::Null,
        };

        assert!(matches!(
            registry.evaluate(&event, &state),
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::WorldModelFrameRevision,
                enforcement: HookEnforcementMode::Enforced,
                ..
            }
        ));
    }

    #[test]
    fn contradicted_frame_requests_revision_on_phase_completed() {
        let mut registry = HookRegistry::new();
        registry.register(FrameFreshnessHook);
        let mut current_frame = frame(ExecutionStrategy::DelegatedWorkflow);
        current_frame.mark_contradicted();

        let event = HookEvent::PhaseCompleted {
            phase_id: "phase-1".to_string(),
            candidate_memory_facts: Vec::new(),
        };
        let state = RuntimeStateView {
            current_frame,
            current_plan: None,
            metadata: Value::Null,
        };

        assert!(matches!(
            registry.evaluate(&event, &state),
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::WorldModelFrameRevision,
                enforcement: HookEnforcementMode::Enforced,
                ..
            }
        ));
    }

    #[derive(Debug, Clone, Copy)]
    struct ApprovalHook;

    impl Hook for ApprovalHook {
        fn name(&self) -> &'static str {
            "approval"
        }

        fn interests(&self) -> &[HookEventInterest] {
            &[HookEventInterest::ProposeFinalAnswer]
        }

        fn evaluate(&self, _event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
            HookDecision::RequireUserApproval {
                operation: "final_answer".to_string(),
                reason: "demo approval".to_string(),
            }
        }
    }

    #[derive(Debug, Clone, Copy)]
    struct SecondApprovalHook;

    impl Hook for SecondApprovalHook {
        fn name(&self) -> &'static str {
            "second_approval"
        }

        fn interests(&self) -> &[HookEventInterest] {
            &[HookEventInterest::ProposeFinalAnswer]
        }

        fn evaluate(&self, _event: &HookEvent, _state: &RuntimeStateView) -> HookDecision {
            HookDecision::RequireUserApproval {
                operation: "memory_write".to_string(),
                reason: "same priority should be preserved".to_string(),
            }
        }
    }

    #[test]
    fn registry_preserves_same_rank_conflicts_as_composite() {
        let mut registry = HookRegistry::new();
        registry.register(ApprovalHook);
        registry.register(SecondApprovalHook);

        let event = HookEvent::CommitBoundary(CommitBoundary::ProposeFinalAnswer);
        let state = RuntimeStateView {
            current_frame: frame(ExecutionStrategy::DirectIteration),
            current_plan: None,
            metadata: Value::Null,
        };

        assert!(matches!(
            registry.evaluate(&event, &state),
            HookDecision::Composite { decisions } if decisions.len() == 2
        ));
    }

    #[test]
    fn diting_think_preflight_hook_requires_frame_artifact_for_non_direct_phase() {
        let mut registry = HookRegistry::new();
        registry.register(DitingThinkPreflightHook);

        let event = HookEvent::CommitBoundary(CommitBoundary::ProposePhaseExecution {
            phase_id: "phase-1".to_string(),
        });
        let state = RuntimeStateView {
            current_frame: frame(ExecutionStrategy::Hybrid),
            current_plan: None,
            metadata: Value::Null,
        };

        assert!(matches!(
            registry.evaluate(&event, &state),
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::DitingThinkPreflight,
                enforcement: HookEnforcementMode::Enforced,
                ..
            }
        ));
    }

    #[test]
    fn diting_think_preflight_hook_skips_direct_or_already_captured_frames() {
        let mut registry = HookRegistry::new();
        registry.register(DitingThinkPreflightHook);
        let event = HookEvent::CommitBoundary(CommitBoundary::ProposePhaseExecution {
            phase_id: "phase-1".to_string(),
        });
        let direct_state = RuntimeStateView {
            current_frame: frame(ExecutionStrategy::DirectIteration),
            current_plan: None,
            metadata: Value::Null,
        };
        assert!(matches!(
            registry.evaluate(&event, &direct_state),
            HookDecision::Allow { .. }
        ));

        let mut captured_frame = frame(ExecutionStrategy::Hybrid);
        captured_frame.known_facts.push(Fact {
            id: "fact-1".to_string(),
            statement: "captured".to_string(),
            source: "diting_think".to_string(),
        });
        let captured_state = RuntimeStateView {
            current_frame: captured_frame,
            current_plan: None,
            metadata: Value::Null,
        };
        assert!(matches!(
            registry.evaluate(&event, &captured_state),
            HookDecision::Allow { .. }
        ));
    }

    #[test]
    fn runtime_approval_hook_requires_user_approval_for_high_risk_operation() {
        let hook = RuntimeApprovalHook;
        let decision = hook.evaluate(
            &HookEvent::OperationProposed {
                operation: serde_json::json!({
                    "tool_name": "shell.exec"
                }),
                risk_class: "high".to_string(),
            },
            &RuntimeStateView {
                current_frame: frame(ExecutionStrategy::DirectIteration),
                current_plan: None,
                metadata: Value::Null,
            },
        );

        assert!(matches!(
            decision,
            HookDecision::RequireUserApproval { operation, .. } if operation == "shell.exec"
        ));
    }

    #[test]
    fn runtime_approval_hook_allows_low_risk_operation() {
        let hook = RuntimeApprovalHook;
        let decision = hook.evaluate(
            &HookEvent::OperationProposed {
                operation: serde_json::json!({
                    "tool_name": "context_search"
                }),
                risk_class: "low".to_string(),
            },
            &RuntimeStateView {
                current_frame: frame(ExecutionStrategy::DirectIteration),
                current_plan: None,
                metadata: Value::Null,
            },
        );

        assert!(matches!(decision, HookDecision::Allow { .. }));
    }

    #[test]
    fn runtime_capability_change_hook_requests_frame_validation_for_changed_set() {
        let hook = RuntimeCapabilityChangeHook;
        let decision = hook.evaluate(
            &HookEvent::CapabilityChanged {
                added: vec!["tool.search_web".to_string()],
                removed: Vec::new(),
            },
            &RuntimeStateView {
                current_frame: frame(ExecutionStrategy::DirectIteration),
                current_plan: None,
                metadata: Value::Null,
            },
        );

        assert!(matches!(
            decision,
            HookDecision::RequestFrameValidation { .. }
        ));
    }

    #[test]
    fn runtime_capability_change_hook_allows_unchanged_set() {
        let hook = RuntimeCapabilityChangeHook;
        let decision = hook.evaluate(
            &HookEvent::CapabilityChanged {
                added: Vec::new(),
                removed: Vec::new(),
            },
            &RuntimeStateView {
                current_frame: frame(ExecutionStrategy::DirectIteration),
                current_plan: None,
                metadata: Value::Null,
            },
        );

        assert!(matches!(decision, HookDecision::Allow { .. }));
    }
}
