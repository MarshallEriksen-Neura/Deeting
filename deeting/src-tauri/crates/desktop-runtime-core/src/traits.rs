use crate::error::RuntimeCoreResult;
use crate::event::RuntimeEvent;
use crate::frame::{FrameBootstrapOutput, WorldModelFrame};
use crate::plan::{Phase, PhaseProposal, PlanArtifact};
use crate::task::{
    FrameRefreshRequest, FrameValidation, PhaseObservation, UserInput, UserInterruption,
};

pub trait BootstrapPrompt {
    fn bootstrap_frame(&mut self, input: &UserInput) -> RuntimeCoreResult<FrameBootstrapOutput>;
}

pub trait Tier2Validator {
    fn validate_frame(
        &mut self,
        frame: &WorldModelFrame,
        plan: Option<&PlanArtifact>,
    ) -> RuntimeCoreResult<FrameValidation>;
}

pub trait FrameArtifactGenerator {
    fn refresh_frame(
        &mut self,
        current_frame: &WorldModelFrame,
        request: &FrameRefreshRequest,
    ) -> RuntimeCoreResult<WorldModelFrame>;
}

pub trait PhaseProposalGenerator {
    fn propose_next_phase(
        &mut self,
        frame: &WorldModelFrame,
        plan: &PlanArtifact,
        input: &UserInput,
    ) -> RuntimeCoreResult<Option<PhaseProposal>>;
}

pub trait PhaseExecutor {
    fn execute_phase(
        &mut self,
        frame: &WorldModelFrame,
        phase: &Phase,
    ) -> RuntimeCoreResult<PhaseObservation>;
}

pub trait InterruptionChannel {
    fn next_interruption(&mut self) -> RuntimeCoreResult<Option<UserInterruption>>;
}

pub trait EventStore {
    fn append_event(&mut self, event: RuntimeEvent) -> RuntimeCoreResult<()>;
}
