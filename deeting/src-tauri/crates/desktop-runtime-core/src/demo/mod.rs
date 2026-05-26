use crate::error::RuntimeCoreResult;
use crate::event::RuntimeEvent;
use crate::frame::{
    ExecutionStrategy, Fact, FrameBootstrapOutput, FrameProvenance, WorldModelFrame,
};
use crate::plan::{Phase, PhaseProposal, PhaseStepType, PlanArtifact};
use crate::runtime::{
    build_default_hook_registry, RuntimeComponents, RuntimeComposition, RuntimeTickResult,
};
use crate::task::{
    FrameRefreshArtifact, FrameRefreshRequest, FrameValidation, PhaseObservation, TaskInputSource,
    UserInput, UserInterruption,
};
use crate::traits::{
    BootstrapPrompt, EventStore, FrameArtifactGenerator, InterruptionChannel, PhaseExecutor,
    PhaseProposalGenerator, Tier2Validator,
};
use serde_json::json;

pub struct DemoBootstrapPrompt;

impl BootstrapPrompt for DemoBootstrapPrompt {
    fn bootstrap_frame(&mut self, input: &UserInput) -> RuntimeCoreResult<FrameBootstrapOutput> {
        Ok(FrameBootstrapOutput {
            frame: WorldModelFrame::new(
                "frame-demo-1",
                input.session_id.clone(),
                input.task_id.clone(),
                input.content.clone(),
                ExecutionStrategy::DelegatedWorkflow,
                FrameProvenance::bootstrap("demo-bootstrap"),
            ),
            immediate_action: None,
        })
    }
}

pub struct DemoTier2Validator;

impl Tier2Validator for DemoTier2Validator {
    fn validate_frame(
        &mut self,
        _frame: &WorldModelFrame,
        _plan: Option<&PlanArtifact>,
    ) -> RuntimeCoreResult<FrameValidation> {
        Ok(FrameValidation {
            is_valid: true,
            reason: "demo frame accepted".to_string(),
        })
    }
}

pub struct DemoFrameArtifactGenerator;

impl FrameArtifactGenerator for DemoFrameArtifactGenerator {
    fn refresh_frame(
        &mut self,
        current_frame: &WorldModelFrame,
        request: &FrameRefreshRequest,
    ) -> RuntimeCoreResult<WorldModelFrame> {
        let mut refreshed = current_frame.clone();
        refreshed.parent_frame_id = Some(current_frame.frame_version_id.clone());
        refreshed.frame_version_id = format!("{}:demo-refresh", current_frame.frame_version_id);
        refreshed.provenance = FrameProvenance::bootstrap(request.reason.clone());
        if matches!(
            request.artifact,
            Some(FrameRefreshArtifact::DitingThinkPreflight)
        ) {
            refreshed.known_facts.push(Fact {
                id: "demo-diting-fact".to_string(),
                statement: "demo diting preflight completed".to_string(),
                source: "diting_think".to_string(),
            });
        }
        Ok(refreshed)
    }
}

pub struct DemoPhaseProposalGenerator;

impl PhaseProposalGenerator for DemoPhaseProposalGenerator {
    fn propose_next_phase(
        &mut self,
        frame: &WorldModelFrame,
        _plan: &PlanArtifact,
        _input: &UserInput,
    ) -> RuntimeCoreResult<Option<PhaseProposal>> {
        Ok(Some(PhaseProposal {
            proposal_id: "proposal-demo-1".to_string(),
            step_type: PhaseStepType::ToolCall,
            payload: json!({"goal": frame.goal}),
            rationale: "demo needs one tool call".to_string(),
            proposed_at_frame_version: frame.frame_version_id.clone(),
        }))
    }
}

pub struct DemoPhaseExecutor;

impl PhaseExecutor for DemoPhaseExecutor {
    fn execute_phase(
        &mut self,
        _frame: &WorldModelFrame,
        _phase: &Phase,
    ) -> RuntimeCoreResult<PhaseObservation> {
        Ok(PhaseObservation {
            observation_ref: "obs-demo-1".to_string(),
            summary: "demo phase completed".to_string(),
            goal_satisfied: true,
            frame_still_valid: true,
            hook_events: Vec::new(),
            updated_frame: None,
        })
    }
}

pub struct DemoInterruptionChannel;

impl InterruptionChannel for DemoInterruptionChannel {
    fn next_interruption(&mut self) -> RuntimeCoreResult<Option<UserInterruption>> {
        Ok(None)
    }
}

#[derive(Default)]
pub struct DemoEventStore {
    pub events: Vec<RuntimeEvent>,
}

impl EventStore for DemoEventStore {
    fn append_event(&mut self, event: RuntimeEvent) -> RuntimeCoreResult<()> {
        self.events.push(event);
        Ok(())
    }
}

pub fn run_demo_composition() -> RuntimeCoreResult<RuntimeTickResult> {
    let components = RuntimeComponents {
        bootstrap: DemoBootstrapPrompt,
        validator: DemoTier2Validator,
        frame_generator: DemoFrameArtifactGenerator,
        phase_proposal_generator: DemoPhaseProposalGenerator,
        phase_executor: DemoPhaseExecutor,
        interruptions: DemoInterruptionChannel,
        event_store: DemoEventStore::default(),
        hook_registry: build_default_hook_registry(),
    };
    let mut runtime = RuntimeComposition::new(components);
    runtime.tick(UserInput {
        session_id: "session-demo-1".to_string(),
        task_id: "task-demo-1".to_string(),
        content: "demo phase A".to_string(),
        source: TaskInputSource::UserChat,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_composition_runs_end_to_end() {
        let result = run_demo_composition().expect("demo composition");
        assert!(result.final_answer.is_some());
        assert!(matches!(
            result.decision,
            crate::HookDecision::RequireArtifact { .. }
        ));
    }
}
