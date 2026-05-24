use super::super::super::user_input::latest_user_message;
use super::super::super::LocalExecutionRequest;
use super::super::phase_step::phase_step_type_name;
use super::frame_bootstrap;
use crate::modules::mcp::store::McpStore;
use desktop_runtime_core::{
    EventStore, FrameArtifactGenerator, FrameBootstrapOutput, FrameRefreshRequest, FrameValidation,
    InterruptionChannel, PhaseProposal, PhaseProposalGenerator, PhaseStepType, PlanArtifact,
    RuntimeCoreResult, RuntimeEvent, TaskInputSource, Tier2Validator, UserInput, UserInterruption,
    WorldModelFrame,
};
use serde_json::json;
use std::sync::Arc;

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn task_id_from_request(
    request: &LocalExecutionRequest,
) -> String {
    request
        .root_execution_id
        .as_deref()
        .or(request.request_id.as_deref())
        .or(request.trace_id.as_deref())
        .unwrap_or("local-runtime-task")
        .to_string()
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn user_input_from_request(
    request: &LocalExecutionRequest,
    task_id: String,
) -> UserInput {
    UserInput {
        session_id: request.session_id.clone(),
        task_id,
        content: latest_user_message(&request.messages).unwrap_or_default(),
        source: TaskInputSource::UserChat,
    }
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingBootstrapPrompt
{
    request: LocalExecutionRequest,
    step_type: PhaseStepType,
    task_id: String,
    store: Arc<McpStore>,
}

impl DeetingBootstrapPrompt {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn new(
        request: LocalExecutionRequest,
        step_type: PhaseStepType,
        task_id: String,
        store: Arc<McpStore>,
    ) -> Self {
        Self {
            request,
            step_type,
            task_id,
            store,
        }
    }
}

impl desktop_runtime_core::BootstrapPrompt for DeetingBootstrapPrompt {
    fn bootstrap_frame(&mut self, _input: &UserInput) -> RuntimeCoreResult<FrameBootstrapOutput> {
        let frame = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(
                frame_bootstrap::build_bootstrap_frame_with_priors(
                    &self.request,
                    self.step_type,
                    self.task_id.as_str(),
                    self.store.as_ref(),
                ),
            )
        });
        Ok(FrameBootstrapOutput {
            frame,
            immediate_action: None,
        })
    }
}

#[derive(Default)]
pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingTier2Validator;

impl Tier2Validator for DeetingTier2Validator {
    fn validate_frame(
        &mut self,
        _frame: &WorldModelFrame,
        _plan: Option<&PlanArtifact>,
    ) -> RuntimeCoreResult<FrameValidation> {
        Ok(FrameValidation {
            is_valid: true,
            reason: "local runtime frame accepted".to_string(),
        })
    }
}

#[derive(Default)]
pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingFrameArtifactGenerator;

impl FrameArtifactGenerator for DeetingFrameArtifactGenerator {
    fn refresh_frame(
        &mut self,
        current_frame: &WorldModelFrame,
        request: &FrameRefreshRequest,
    ) -> RuntimeCoreResult<WorldModelFrame> {
        let mut refreshed = current_frame.clone();
        refreshed.parent_frame_id = Some(current_frame.frame_version_id.clone());
        refreshed.frame_version_id = format!("{}:refresh", current_frame.frame_version_id);
        refreshed.provenance.reason = request.reason.clone();
        Ok(refreshed)
    }
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingPhaseProposalGenerator
{
    step_type: PhaseStepType,
}

impl DeetingPhaseProposalGenerator {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn new(
        step_type: PhaseStepType,
    ) -> Self {
        Self { step_type }
    }
}

impl PhaseProposalGenerator for DeetingPhaseProposalGenerator {
    fn propose_next_phase(
        &mut self,
        frame: &WorldModelFrame,
        _plan: &PlanArtifact,
        _input: &UserInput,
    ) -> RuntimeCoreResult<Option<PhaseProposal>> {
        Ok(Some(PhaseProposal {
            proposal_id: format!("proposal:{}", phase_step_type_name(self.step_type)),
            step_type: self.step_type,
            payload: json!({
                "source": "deeting_runtime_composition",
                "phase_step_type": phase_step_type_name(self.step_type),
                "goal": frame.goal.clone(),
            }),
            rationale: "initial phase derived from local runtime entry".to_string(),
            proposed_at_frame_version: frame.frame_version_id.clone(),
        }))
    }
}

#[derive(Default)]
pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingInterruptionChannel;

impl InterruptionChannel for DeetingInterruptionChannel {
    fn next_interruption(&mut self) -> RuntimeCoreResult<Option<UserInterruption>> {
        Ok(None)
    }
}

#[derive(Default)]
pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingRuntimeEventStore
{
    events: Vec<RuntimeEvent>,
}

impl EventStore for DeetingRuntimeEventStore {
    fn append_event(&mut self, event: RuntimeEvent) -> RuntimeCoreResult<()> {
        self.events.push(event);
        Ok(())
    }
}
