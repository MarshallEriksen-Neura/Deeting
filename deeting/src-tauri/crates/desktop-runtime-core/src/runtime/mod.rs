use crate::error::{RuntimeCoreError, RuntimeCoreResult};
use crate::event::RuntimeEvent;
use crate::frame::WorldModelFrame;
use crate::hook::{
    CommitBoundary, FrameFreshnessHook, HookDecision, HookEvent, HookRegistry, PlanDraftHook,
    RequiredArtifact, RuntimeStateView,
};
use crate::plan::{PhaseProposal, PhaseStatus, PlanArtifact};
use crate::task::{FrameRefreshArtifact, FrameRefreshRequest, FrameValidation, UserInput};
use crate::traits::{
    BootstrapPrompt, EventStore, FrameArtifactGenerator, InterruptionChannel, PhaseExecutor,
    PhaseProposalGenerator, Tier2Validator,
};
use serde_json::json;

const MAX_PHASE_ITERATIONS: usize = 8;

pub struct RuntimeComponents<B, V, G, P, E, I, S> {
    pub bootstrap: B,
    pub validator: V,
    pub frame_generator: G,
    pub phase_proposal_generator: P,
    pub phase_executor: E,
    pub interruptions: I,
    pub event_store: S,
    pub hook_registry: HookRegistry,
}

pub struct RuntimeComposition<B, V, G, P, E, I, S> {
    components: RuntimeComponents<B, V, G, P, E, I, S>,
}

impl<B, V, G, P, E, I, S> RuntimeComposition<B, V, G, P, E, I, S>
where
    B: BootstrapPrompt,
    V: Tier2Validator,
    G: FrameArtifactGenerator,
    P: PhaseProposalGenerator,
    E: PhaseExecutor,
    I: InterruptionChannel,
    S: EventStore,
{
    pub fn new(components: RuntimeComponents<B, V, G, P, E, I, S>) -> Self {
        Self { components }
    }

    pub fn tick(&mut self, input: UserInput) -> RuntimeCoreResult<RuntimeTickResult> {
        self.components
            .event_store
            .append_event(RuntimeEvent::UserInputReceived {
                session_id: input.session_id.clone(),
                task_id: input.task_id.clone(),
            })?;
        self.components
            .event_store
            .append_event(RuntimeEvent::HookEventObserved {
                event: HookEvent::TaskInitiated {
                    source: input.source.clone(),
                },
            })?;

        let bootstrap = self.components.bootstrap.bootstrap_frame(&input)?;
        self.components
            .event_store
            .append_event(RuntimeEvent::FrameBootstrapped {
                frame_version_id: bootstrap.frame.frame_version_id.clone(),
            })?;

        let mut frame = bootstrap.frame;
        if frame.user_directed.is_empty() {
            frame
                .append_user_directive(input.content.clone(), None)
                .map_err(RuntimeCoreError::InvalidState)?;
        }
        let mut plan = PlanArtifact::from_frame(format!("plan:{}", frame.frame_version_id), &frame);
        let mut validation = self
            .components
            .validator
            .validate_frame(&frame, Some(&plan))?;
        if !validation.is_valid {
            frame.mark_stale();
            frame = self.components.frame_generator.refresh_frame(
                &frame,
                Some(&plan),
                &FrameRefreshRequest {
                    reason: validation.reason.clone(),
                    interruption: None,
                    artifact: Some(FrameRefreshArtifact::WorldModelFrameRefresh),
                },
            )?;
            self.components
                .event_store
                .append_event(RuntimeEvent::FrameRefreshed {
                    frame_version_id: frame.frame_version_id.clone(),
                })?;
            plan = PlanArtifact::from_frame(format!("plan:{}", frame.frame_version_id), &frame);
            validation = self
                .components
                .validator
                .validate_frame(&frame, Some(&plan))?;
        }

        if let Some(interruption) = self.components.interruptions.next_interruption()? {
            self.components
                .event_store
                .append_event(RuntimeEvent::InterruptionQueued {
                    interruption_id: interruption.interruption_id.clone(),
                })?;
            self.components
                .event_store
                .append_event(RuntimeEvent::HookEventObserved {
                    event: HookEvent::UserInterrupted {
                        message: interruption.content.clone(),
                    },
                })?;
            frame = self.components.frame_generator.refresh_frame(
                &frame,
                Some(&plan),
                &FrameRefreshRequest {
                    reason: "user interruption arrived before commit boundary".to_string(),
                    interruption: Some(interruption),
                    artifact: Some(FrameRefreshArtifact::WorldModelFrameRefresh),
                },
            )?;
            self.components
                .event_store
                .append_event(RuntimeEvent::FrameRefreshed {
                    frame_version_id: frame.frame_version_id.clone(),
                })?;
            plan = PlanArtifact::from_frame(format!("plan:{}", frame.frame_version_id), &frame);
            validation = self
                .components
                .validator
                .validate_frame(&frame, Some(&plan))?;
        }

        let mut decision = HookDecision::Allow {
            reason: "runtime loop not started".to_string(),
        };
        let mut final_answer = None;

        for _ in 0..MAX_PHASE_ITERATIONS {
            decision =
                self.evaluate_and_record(CommitBoundary::ProposeNextPhase, &frame, Some(&plan))?;
            if decision.contains_block() {
                return Err(RuntimeCoreError::HookBlocked(format!("{:?}", decision)));
            }
            if decision.contains_required_artifact(RequiredArtifact::WorldModelFrameRefresh)
                || decision.contains_required_artifact(RequiredArtifact::WorldModelFrameRevision)
            {
                let artifact = frame_refresh_artifact_for_decision(&decision)
                    .unwrap_or(FrameRefreshArtifact::WorldModelFrameRefresh);
                frame = self.components.frame_generator.refresh_frame(
                    &frame,
                    Some(&plan),
                    &FrameRefreshRequest {
                        reason: "hook requested frame artifact before next phase".to_string(),
                        interruption: None,
                        artifact: Some(artifact),
                    },
                )?;
                mark_frame_artifact_seen_by_model(&mut frame, artifact);
                self.components
                    .event_store
                    .append_event(RuntimeEvent::FrameRefreshed {
                        frame_version_id: frame.frame_version_id.clone(),
                    })?;
                plan.frame_version_id = frame.frame_version_id.clone();
                validation = self
                    .components
                    .validator
                    .validate_frame(&frame, Some(&plan))?;
                if !validation.is_valid {
                    frame.mark_insufficient_for_commit();
                }
                continue;
            }

            if matches!(
                frame.execution_strategy,
                crate::frame::ExecutionStrategy::DirectIteration
            ) && !decision.contains_required_artifact(RequiredArtifact::PlanDraft)
            {
                if let Some(immediate_action) = bootstrap.immediate_action.clone() {
                    final_answer = Some(immediate_action.to_string());
                    break;
                }
            }

            let proposal = self.next_or_generate_proposal(&frame, &mut plan, &input)?;
            let proposal_id = proposal.proposal_id.clone();
            if plan
                .proposed_phases
                .iter()
                .all(|existing| existing.proposal_id != proposal_id)
            {
                plan.push_proposal(proposal);
                self.components
                    .event_store
                    .append_event(RuntimeEvent::PhaseProposed {
                        proposal_id: proposal_id.clone(),
                    })?;
            }

            let phase_id = format!("phase:{}", proposal_id);
            let execution_decision = self.evaluate_and_record(
                CommitBoundary::ProposePhaseExecution {
                    phase_id: phase_id.clone(),
                },
                &frame,
                Some(&plan),
            )?;
            if execution_decision.contains_block() {
                return Err(RuntimeCoreError::HookBlocked(format!(
                    "{:?}",
                    execution_decision
                )));
            }
            if execution_decision
                .contains_required_artifact(RequiredArtifact::WorldModelFrameRefresh)
                || execution_decision
                    .contains_required_artifact(RequiredArtifact::WorldModelFrameRevision)
            {
                let artifact = frame_refresh_artifact_for_decision(&execution_decision)
                    .unwrap_or(FrameRefreshArtifact::WorldModelFrameRefresh);
                frame = self.components.frame_generator.refresh_frame(
                    &frame,
                    Some(&plan),
                    &FrameRefreshRequest {
                        reason: "hook requested frame artifact before phase execution".to_string(),
                        interruption: None,
                        artifact: Some(artifact),
                    },
                )?;
                mark_frame_artifact_seen_by_model(&mut frame, artifact);
                self.components
                    .event_store
                    .append_event(RuntimeEvent::FrameRefreshed {
                        frame_version_id: frame.frame_version_id.clone(),
                    })?;
                plan.frame_version_id = frame.frame_version_id.clone();
                continue;
            }

            let phase = plan.commit_proposal(&proposal_id, phase_id)?;
            self.components
                .event_store
                .append_event(RuntimeEvent::PhaseCommitted {
                    phase_id: phase.phase_id.clone(),
                })?;
            let observation = self
                .components
                .phase_executor
                .execute_phase(&frame, &phase)?;
            if let Some(updated_frame) = observation.updated_frame.clone() {
                frame = updated_frame;
                plan.frame_version_id = frame.frame_version_id.clone();
            }
            let candidate_memory_facts =
                candidate_memory_facts_from_observation(&phase.phase_id, &observation);
            plan.mark_phase_observed(
                &phase.phase_id,
                PhaseStatus::Done,
                &observation.observation_ref,
            )?;
            self.components
                .event_store
                .append_event(RuntimeEvent::HookEventObserved {
                    event: HookEvent::PhaseObserved {
                        phase_id: phase.phase_id.clone(),
                        observation: json!({
                            "summary": observation.summary.clone(),
                            "goal_satisfied": observation.goal_satisfied,
                            "frame_still_valid": observation.frame_still_valid,
                        }),
                    },
                })?;
            self.components
                .event_store
                .append_event(RuntimeEvent::HookEventObserved {
                    event: HookEvent::AsyncObservationArrived {
                        phase_id: phase.phase_id.clone(),
                        awaiting_id: observation.observation_ref.clone(),
                        observation: json!({
                            "summary": observation.summary.clone(),
                            "goal_satisfied": observation.goal_satisfied,
                            "frame_still_valid": observation.frame_still_valid,
                        }),
                    },
                })?;
            self.components
                .event_store
                .append_event(RuntimeEvent::PhaseObserved {
                    phase_id: phase.phase_id.clone(),
                    observation_ref: observation.observation_ref.clone(),
                })?;
            for hook_event in observation.hook_events.clone() {
                self.evaluate_hook_event_and_record(hook_event, &frame, Some(&plan))?;
            }
            if !observation.frame_still_valid {
                frame.mark_contradicted();
                self.evaluate_hook_event_and_record(
                    HookEvent::PhaseCompleted {
                        phase_id: phase.phase_id.clone(),
                        candidate_memory_facts: candidate_memory_facts.clone(),
                    },
                    &frame,
                    Some(&plan),
                )?;
                continue;
            }
            if observation.goal_satisfied {
                frame.mark_verified_enough();
                plan.complete();
                self.evaluate_hook_event_and_record(
                    HookEvent::PhaseCompleted {
                        phase_id: phase.phase_id.clone(),
                        candidate_memory_facts: candidate_memory_facts.clone(),
                    },
                    &frame,
                    Some(&plan),
                )?;
                final_answer = Some(observation.summary);
                break;
            }
            self.evaluate_hook_event_and_record(
                HookEvent::PhaseCompleted {
                    phase_id: phase.phase_id.clone(),
                    candidate_memory_facts,
                },
                &frame,
                Some(&plan),
            )?;
        }

        if final_answer.is_none() && plan.plan_status != crate::plan::PlanStatus::Completed {
            return Err(RuntimeCoreError::InvalidState(
                "runtime loop ended before verification target was satisfied".to_string(),
            ));
        }

        if let Some(answer) = &final_answer {
            self.evaluate_and_record(CommitBoundary::ProposeFinalAnswer, &frame, Some(&plan))?;
            self.components
                .event_store
                .append_event(RuntimeEvent::FinalAnswerReady {
                    reason: answer.clone(),
                })?;
        }

        Ok(RuntimeTickResult {
            frame,
            plan,
            validation,
            decision,
            final_answer,
        })
    }

    fn evaluate(
        &self,
        boundary: CommitBoundary,
        current_frame: &WorldModelFrame,
        current_plan: Option<&PlanArtifact>,
    ) -> HookDecision {
        self.components.hook_registry.evaluate(
            &HookEvent::CommitBoundary(boundary),
            &RuntimeStateView {
                current_frame: current_frame.clone(),
                current_plan: current_plan.cloned(),
                metadata: serde_json::Value::Null,
            },
        )
    }

    fn evaluate_and_record(
        &mut self,
        boundary: CommitBoundary,
        current_frame: &WorldModelFrame,
        current_plan: Option<&PlanArtifact>,
    ) -> RuntimeCoreResult<HookDecision> {
        let decision = self.evaluate(boundary.clone(), current_frame, current_plan);
        self.components
            .event_store
            .append_event(RuntimeEvent::HookDecisionRecorded {
                boundary: format!("{:?}", boundary),
                decision: decision.clone(),
            })?;
        Ok(decision)
    }

    fn evaluate_hook_event_and_record(
        &mut self,
        event: HookEvent,
        current_frame: &WorldModelFrame,
        current_plan: Option<&PlanArtifact>,
    ) -> RuntimeCoreResult<HookDecision> {
        self.components
            .event_store
            .append_event(RuntimeEvent::HookEventObserved {
                event: event.clone(),
            })?;
        let decision = self.components.hook_registry.evaluate(
            &event,
            &RuntimeStateView {
                current_frame: current_frame.clone(),
                current_plan: current_plan.cloned(),
                metadata: serde_json::Value::Null,
            },
        );
        self.components
            .event_store
            .append_event(RuntimeEvent::HookDecisionRecorded {
                boundary: format!("{:?}", event),
                decision: decision.clone(),
            })?;
        Ok(decision)
    }

    fn next_or_generate_proposal(
        &mut self,
        frame: &WorldModelFrame,
        plan: &mut PlanArtifact,
        input: &UserInput,
    ) -> RuntimeCoreResult<PhaseProposal> {
        if let Some(proposal) = plan.proposed_phases.first().cloned() {
            return Ok(proposal);
        }

        self.components
            .phase_proposal_generator
            .propose_next_phase(frame, plan, input)?
            .ok_or(RuntimeCoreError::MissingPlan)
    }
}

fn mark_frame_artifact_seen_by_model(frame: &mut WorldModelFrame, artifact: FrameRefreshArtifact) {
    if matches!(artifact, FrameRefreshArtifact::WorldModelFrameRefresh) {
        frame.mark_seen();
        frame.mark_world_model_update_seen();
    }
}

fn frame_refresh_artifact_for_decision(decision: &HookDecision) -> Option<FrameRefreshArtifact> {
    if decision.contains_required_artifact(RequiredArtifact::WorldModelFrameRevision) {
        return Some(FrameRefreshArtifact::WorldModelFrameRevision);
    }
    if decision.contains_required_artifact(RequiredArtifact::WorldModelFrameRefresh) {
        return Some(FrameRefreshArtifact::WorldModelFrameRefresh);
    }
    None
}

fn candidate_memory_facts_from_observation(
    phase_id: &str,
    observation: &crate::task::PhaseObservation,
) -> Vec<serde_json::Value> {
    let summary = observation.summary.trim();
    if summary.is_empty() {
        return Vec::new();
    }

    vec![json!({
        "kind": "phase_observation_summary",
        "phase_id": phase_id,
        "observation_ref": observation.observation_ref.clone(),
        "summary": summary,
        "goal_satisfied": observation.goal_satisfied,
        "frame_still_valid": observation.frame_still_valid,
    })]
}

#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeTickResult {
    pub frame: WorldModelFrame,
    pub plan: PlanArtifact,
    pub validation: FrameValidation,
    pub decision: HookDecision,
    pub final_answer: Option<String>,
}

pub fn build_default_hook_registry() -> HookRegistry {
    let mut registry = HookRegistry::new();
    registry.register(PlanDraftHook);
    registry.register(FrameFreshnessHook);
    registry.register(crate::hook::WorldModelUpdateHook);
    registry.register(crate::hook::RuntimeApprovalHook);
    registry.register(crate::hook::RuntimeCompressionHook);
    registry.register(crate::hook::RuntimeMemoryHook);
    registry.register(crate::hook::RuntimeCapabilityChangeHook);
    registry
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::RuntimeEvent;
    use crate::frame::{
        ExecutionStrategy, Fact, FrameBootstrapOutput, FrameProvenance, WorldModelFrame,
        WorldModelFrameStatus,
    };
    use crate::hook::{HookDecision, HookEnforcementMode, RequiredArtifact};
    use crate::plan::{Phase, PhaseProposal, PhaseStatus, PhaseStepType, PlanStatus};
    use crate::task::{
        FrameRefreshArtifact, FrameRefreshRequest, FrameValidation, PhaseObservation,
        TaskInputSource, UserInterruption,
    };
    use crate::traits::{
        BootstrapPrompt, EventStore, FrameArtifactGenerator, InterruptionChannel, PhaseExecutor,
        PhaseProposalGenerator, Tier2Validator,
    };
    use serde_json::json;

    #[derive(Default)]
    struct DemoBootstrap;
    impl BootstrapPrompt for DemoBootstrap {
        fn bootstrap_frame(
            &mut self,
            input: &UserInput,
        ) -> RuntimeCoreResult<FrameBootstrapOutput> {
            Ok(FrameBootstrapOutput {
                frame: WorldModelFrame::new(
                    "frame-1",
                    input.session_id.clone(),
                    input.task_id.clone(),
                    input.content.clone(),
                    ExecutionStrategy::DelegatedWorkflow,
                    FrameProvenance::bootstrap("bootstrap-demo"),
                ),
                immediate_action: None,
            })
        }
    }

    #[derive(Default)]
    struct DemoValidator;
    impl Tier2Validator for DemoValidator {
        fn validate_frame(
            &mut self,
            _frame: &WorldModelFrame,
            _plan: Option<&PlanArtifact>,
        ) -> RuntimeCoreResult<FrameValidation> {
            Ok(FrameValidation {
                is_valid: true,
                reason: "ok".to_string(),
            })
        }
    }

    #[derive(Default)]
    struct DemoFrameGenerator;
    impl FrameArtifactGenerator for DemoFrameGenerator {
        fn refresh_frame(
            &mut self,
            current_frame: &WorldModelFrame,
            _current_plan: Option<&PlanArtifact>,
            request: &FrameRefreshRequest,
        ) -> RuntimeCoreResult<WorldModelFrame> {
            let mut refreshed = current_frame.clone();
            refreshed.parent_frame_id = Some(current_frame.frame_version_id.clone());
            refreshed.frame_version_id = format!("{}:refreshed", current_frame.frame_version_id);
            refreshed.provenance = FrameProvenance::bootstrap(request.reason.clone());
            if matches!(
                request.artifact,
                Some(FrameRefreshArtifact::WorldModelFrameRefresh)
            ) {
                refreshed.known_facts.push(Fact {
                    id: "wm-fact-1".to_string(),
                    statement: "world model refresh completed".to_string(),
                    source: "world_model_update".to_string(),
                });
            }
            Ok(refreshed)
        }
    }

    #[derive(Default)]
    struct DemoPhaseProposalGenerator;
    impl PhaseProposalGenerator for DemoPhaseProposalGenerator {
        fn propose_next_phase(
            &mut self,
            frame: &WorldModelFrame,
            _plan: &PlanArtifact,
            _input: &UserInput,
        ) -> RuntimeCoreResult<Option<PhaseProposal>> {
            Ok(Some(PhaseProposal {
                proposal_id: "proposal-1".to_string(),
                step_type: PhaseStepType::ToolCall,
                payload: json!({"task": frame.goal}),
                rationale: "need one tool call".to_string(),
                proposed_at_frame_version: frame.frame_version_id.clone(),
            }))
        }
    }

    #[derive(Default)]
    struct DemoPhaseExecutor;
    impl PhaseExecutor for DemoPhaseExecutor {
        fn execute_phase(
            &mut self,
            _frame: &WorldModelFrame,
            _phase: &Phase,
        ) -> RuntimeCoreResult<PhaseObservation> {
            Ok(PhaseObservation {
                observation_ref: "observation-1".to_string(),
                summary: "phase finished".to_string(),
                goal_satisfied: true,
                frame_still_valid: true,
                hook_events: Vec::new(),
                updated_frame: None,
            })
        }
    }

    #[derive(Default)]
    struct DemoInterruptionChannel;
    impl InterruptionChannel for DemoInterruptionChannel {
        fn next_interruption(&mut self) -> RuntimeCoreResult<Option<UserInterruption>> {
            Ok(None)
        }
    }

    struct QueuedInterruptionChannel {
        interruption: Option<UserInterruption>,
    }

    impl InterruptionChannel for QueuedInterruptionChannel {
        fn next_interruption(&mut self) -> RuntimeCoreResult<Option<UserInterruption>> {
            Ok(self.interruption.take())
        }
    }

    #[derive(Default)]
    struct DemoEventStore {
        events: Vec<RuntimeEvent>,
    }
    impl EventStore for DemoEventStore {
        fn append_event(&mut self, event: RuntimeEvent) -> RuntimeCoreResult<()> {
            self.events.push(event);
            Ok(())
        }
    }

    #[test]
    fn demo_runtime_composes_frame_plan_and_hook_flow() {
        let components = RuntimeComponents {
            bootstrap: DemoBootstrap::default(),
            validator: DemoValidator::default(),
            frame_generator: DemoFrameGenerator::default(),
            phase_proposal_generator: DemoPhaseProposalGenerator::default(),
            phase_executor: DemoPhaseExecutor::default(),
            interruptions: DemoInterruptionChannel::default(),
            event_store: DemoEventStore::default(),
            hook_registry: build_default_hook_registry(),
        };
        let mut runtime = RuntimeComposition::new(components);
        let result = runtime
            .tick(UserInput {
                session_id: "session-1".to_string(),
                task_id: "task-1".to_string(),
                content: "build phase A".to_string(),
                source: TaskInputSource::UserChat,
            })
            .expect("runtime tick");

        assert_eq!(result.frame.status, WorldModelFrameStatus::VerifiedEnough);
        assert_eq!(result.plan.plan_status, PlanStatus::Completed);
        assert_eq!(result.plan.committed_phases.len(), 1);
        assert_eq!(result.plan.committed_phases[0].status, PhaseStatus::Done);
        assert_eq!(
            result.plan.committed_phases[0].committed_at_frame_version,
            "frame-1"
        );
        // The committed phase carries the proposal payload verbatim; DemoPhaseProposalGenerator
        // emits {"task": <goal>}. (The earlier assertion here expected a
        // "runtime_required_artifacts" field that the demo proposal generator never produced.)
        assert_eq!(
            result.plan.committed_phases[0].payload.pointer("/task"),
            Some(&json!("build phase A"))
        );
        assert!(matches!(
            result.decision,
            HookDecision::RequireArtifact {
                artifact: RequiredArtifact::PlanDraft,
                enforcement: HookEnforcementMode::Enforced,
                ..
            }
        ));
        assert!(result.final_answer.is_some());
    }

    #[test]
    fn phase_observation_summary_becomes_candidate_memory_fact() {
        let facts = candidate_memory_facts_from_observation(
            "phase-1",
            &PhaseObservation {
                observation_ref: "observation-1".to_string(),
                summary: "phase finished".to_string(),
                goal_satisfied: true,
                frame_still_valid: true,
                hook_events: Vec::new(),
                updated_frame: None,
            },
        );

        assert_eq!(facts.len(), 1);
        assert_eq!(facts[0]["kind"], json!("phase_observation_summary"));
        assert_eq!(facts[0]["phase_id"], json!("phase-1"));
        assert_eq!(facts[0]["summary"], json!("phase finished"));
    }

    #[test]
    fn runtime_refreshes_frame_when_user_interruption_arrives_before_commit() {
        let components = RuntimeComponents {
            bootstrap: DemoBootstrap::default(),
            validator: DemoValidator::default(),
            frame_generator: DemoFrameGenerator::default(),
            phase_proposal_generator: DemoPhaseProposalGenerator::default(),
            phase_executor: DemoPhaseExecutor::default(),
            interruptions: QueuedInterruptionChannel {
                interruption: Some(UserInterruption {
                    interruption_id: "interrupt-1".to_string(),
                    content: "change direction".to_string(),
                }),
            },
            event_store: DemoEventStore::default(),
            hook_registry: build_default_hook_registry(),
        };
        let mut runtime = RuntimeComposition::new(components);
        let result = runtime
            .tick(UserInput {
                session_id: "session-1".to_string(),
                task_id: "task-1".to_string(),
                content: "build phase A".to_string(),
                source: TaskInputSource::UserChat,
            })
            .expect("runtime tick");

        // The interruption triggers exactly one frame refresh (frame-1 -> frame-1:refreshed),
        // and the phase commits on that refreshed frame. The demo phase executor returns no
        // updated_frame, so the final frame IS that single refresh, whose parent is the
        // original bootstrap frame. Before R1 was removed from WorldModelUpdateHook, the loop
        // forced a redundant *second* refresh here (parent would have been "frame-1:refreshed"
        // and the commit "frame-1:refreshed:refreshed") — a new user directive must not drive a
        // world-model refresh, so a single interruption refresh is the correct behavior.
        assert_eq!(result.frame.parent_frame_id.as_deref(), Some("frame-1"));
        assert_eq!(
            result.plan.committed_phases[0].committed_at_frame_version,
            "frame-1:refreshed"
        );
    }
}
