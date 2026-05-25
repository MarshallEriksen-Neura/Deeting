use super::super::super::user_input::latest_user_message;
use super::super::super::LocalExecutionRequest;
use super::super::phase_step::phase_step_type_name;
use super::frame_bootstrap;
use crate::modules::desktop_runtime::runtime::task_learning::ACTION_VERIFICATION_STRONGER_CHECKS;
use crate::modules::mcp::store::McpStore;
use desktop_runtime_core::{
    ConfidenceLevel, EventStore, FrameArtifactGenerator, FrameBootstrapOutput, FrameRefreshRequest,
    FrameValidation, InterruptionChannel, PhaseProposal, PhaseProposalGenerator, PhaseStepType,
    PlanArtifact, RuntimeCoreResult, RuntimeEvent, Tier2Validator, UserInput, UserInterruption,
    WorldModelFrame,
};
use serde_json::json;
use std::sync::{Arc, Mutex};

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
        source: request.task_input_source.clone(),
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
        frame: &WorldModelFrame,
        plan: Option<&PlanArtifact>,
    ) -> RuntimeCoreResult<FrameValidation> {
        let has_stronger_checks_prior = frame.memory_priors.iter().any(|prior| {
            prior.id == ACTION_VERIFICATION_STRONGER_CHECKS
                && matches!(prior.confidence, ConfidenceLevel::High)
        });
        let plan_has_verification = plan.is_some_and(|plan| {
            plan.committed_phases
                .iter()
                .any(|phase| matches!(phase.step_type, PhaseStepType::VerifyFinal))
        });
        if has_stronger_checks_prior && !plan_has_verification {
            return Ok(FrameValidation {
                is_valid: false,
                reason: "stronger_checks prior cached but no VerifyFinal phase planned".to_string(),
            });
        }

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

#[derive(Clone, Default)]
pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingRuntimeEventStore
{
    events: Arc<Mutex<Vec<RuntimeEvent>>>,
}

impl DeetingRuntimeEventStore {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn events(
        &self,
    ) -> Vec<RuntimeEvent> {
        self.events
            .lock()
            .map(|events| events.clone())
            .unwrap_or_default()
    }
}

impl EventStore for DeetingRuntimeEventStore {
    fn append_event(&mut self, event: RuntimeEvent) -> RuntimeCoreResult<()> {
        if let Ok(mut events) = self.events.lock() {
            events.push(event);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use desktop_runtime_core::{ExecutionStrategy, FrameProvenance, Prior};

    #[test]
    fn runtime_event_store_clones_share_buffer() {
        let mut writer = DeetingRuntimeEventStore::default();
        let reader = writer.clone();

        writer
            .append_event(RuntimeEvent::FrameBootstrapped {
                frame_version_id: "frame-1".to_string(),
            })
            .expect("append runtime event");

        assert_eq!(
            reader.events(),
            vec![RuntimeEvent::FrameBootstrapped {
                frame_version_id: "frame-1".to_string(),
            }]
        );
    }
    #[test]
    fn stronger_checks_prior_requires_verify_final_phase() {
        let mut frame = WorldModelFrame::new(
            "frame-stronger-checks",
            "session-1",
            "task-1",
            "verify the implementation",
            ExecutionStrategy::Hybrid,
            FrameProvenance::bootstrap("test"),
        );
        frame.memory_priors.push(Prior {
            id: ACTION_VERIFICATION_STRONGER_CHECKS.to_string(),
            statement: "cached verification prior".to_string(),
            confidence: ConfidenceLevel::High,
        });
        let plan = PlanArtifact::from_frame("plan-stronger-checks", &frame);

        let validation = DeetingTier2Validator::default()
            .validate_frame(&frame, Some(&plan))
            .expect("validate frame");

        assert!(!validation.is_valid);
        assert!(validation.reason.contains("stronger_checks"));
    }
}
