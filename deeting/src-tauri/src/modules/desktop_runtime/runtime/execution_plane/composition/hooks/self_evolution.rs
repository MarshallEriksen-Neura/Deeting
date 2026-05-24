use crate::modules::desktop_runtime::runtime::evolution::{
    submit_evolution_signal, EvolutionSignalClassification, EvolutionSignalDraft,
    EvolutionSignalSource,
};
use crate::modules::mcp::store::McpStore;
use desktop_runtime_core::{
    CommitBoundary, Hook, HookDecision, HookEnforcementMode, HookEvent, HookEventInterest, PhaseId,
    PhaseStatus, RequiredArtifact, RuntimeStateView, WorldModelFrameStatus,
};
use serde_json::json;
use std::sync::Arc;

const SELF_EVOLUTION_INTERESTS: [HookEventInterest; 2] = [
    HookEventInterest::ProposePhaseExecution,
    HookEventInterest::PhaseCompleted,
];
const STRONGER_CHECKS_PRIOR_ID: &str = "stronger_checks";

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct SelfEvolutionHook
{
    store: Arc<McpStore>,
}

impl SelfEvolutionHook {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn new(
        store: Arc<McpStore>,
    ) -> Self {
        Self { store }
    }
}

impl Hook for SelfEvolutionHook {
    fn name(&self) -> &'static str {
        "deeting_self_evolution"
    }

    fn interests(&self) -> &[HookEventInterest] {
        &SELF_EVOLUTION_INTERESTS
    }

    fn evaluate(&self, event: &HookEvent, state: &RuntimeStateView) -> HookDecision {
        match event {
            HookEvent::CommitBoundary(CommitBoundary::ProposePhaseExecution { .. }) => {
                evaluate_phase_execution_prior(state)
            }
            HookEvent::PhaseCompleted { phase_id, .. } => {
                queue_phase_completed_signal(self.store.clone(), state.clone(), phase_id.clone());
                allow("self-evolution phase completion signal queued")
            }
            _ => allow("self-evolution hook ignored unrelated event"),
        }
    }
}

fn evaluate_phase_execution_prior(state: &RuntimeStateView) -> HookDecision {
    let Some(prior) = state
        .current_frame
        .memory_priors
        .iter()
        .find(|prior| prior.id == STRONGER_CHECKS_PRIOR_ID)
    else {
        return allow("self-evolution prior unavailable");
    };

    if matches!(
        prior.confidence,
        desktop_runtime_core::ConfidenceLevel::High
    ) {
        return HookDecision::RequireArtifact {
            artifact: RequiredArtifact::VerificationPlan,
            reason: format!(
                "self-evolution verification prior '{}' cached in frame",
                prior.id
            ),
            enforcement: HookEnforcementMode::Enforced,
        };
    }

    allow("self-evolution verification prior below threshold")
}

fn queue_phase_completed_signal(store: Arc<McpStore>, state: RuntimeStateView, phase_id: PhaseId) {
    tokio::spawn(async move {
        if let Err(err) = collect_and_submit_phase_completed_signal(store, state, phase_id).await {
            log::warn!("self-evolution signal submission skipped: {}", err);
        }
    });
}

async fn collect_and_submit_phase_completed_signal(
    store: Arc<McpStore>,
    state: RuntimeStateView,
    phase_id: PhaseId,
) -> Result<(), String> {
    let frame = state.current_frame;
    let Some(fingerprint_key) = frame.fingerprint_key.clone() else {
        return Err("frame has no fingerprint key".to_string());
    };
    let Some(plan) = state.current_plan else {
        return Err("runtime state has no plan".to_string());
    };
    let phase = plan
        .committed_phases
        .iter()
        .find(|phase| phase.phase_id == phase_id)
        .ok_or_else(|| format!("phase '{}' not found in committed plan", phase_id))?;
    let classification = classify_phase_outcome(frame.status, &phase.status);
    let confidence = confidence_for_classification(classification);

    submit_evolution_signal(
        store.as_ref(),
        EvolutionSignalDraft {
            source: EvolutionSignalSource::DeetingThink,
            classification,
            session_id: Some(frame.session_id.clone()),
            trace_id: None,
            run_id: Some(frame.task_id.clone()),
            monitor_task_id: None,
            monitor_log_id: None,
            fingerprint_key: Some(fingerprint_key),
            confidence,
            payload_json: json!({
                "source": "runtime_composition_phase_completed",
                "frame_version_id": frame.frame_version_id,
                "plan_id": plan.plan_id,
                "phase_id": phase.phase_id,
                "frame_status": format!("{:?}", frame.status),
                "phase_status": format!("{:?}", phase.status),
                "phase_step_type": format!("{:?}", phase.step_type),
            }),
            note: Some("FPR phase completion signal collected from RuntimeEvent hook".to_string()),
        },
    )
    .await?;
    Ok(())
}

fn classify_phase_outcome(
    frame_status: WorldModelFrameStatus,
    phase_status: &PhaseStatus,
) -> EvolutionSignalClassification {
    match (frame_status, phase_status) {
        (WorldModelFrameStatus::VerifiedEnough, PhaseStatus::Done) => {
            EvolutionSignalClassification::Accepted
        }
        (WorldModelFrameStatus::Contradicted, _) | (_, PhaseStatus::Failed) => {
            EvolutionSignalClassification::Rejected
        }
        (WorldModelFrameStatus::InsufficientForCommit, _) => EvolutionSignalClassification::Neutral,
        (_, PhaseStatus::Cancelled) => EvolutionSignalClassification::Neutral,
        _ => EvolutionSignalClassification::Neutral,
    }
}

fn confidence_for_classification(classification: EvolutionSignalClassification) -> f64 {
    match classification {
        EvolutionSignalClassification::Accepted => 0.8,
        EvolutionSignalClassification::Rejected => 0.75,
        EvolutionSignalClassification::Corrected => 0.85,
        EvolutionSignalClassification::Neutral => 0.45,
        EvolutionSignalClassification::Unknown => 0.25,
    }
}

fn allow(reason: &str) -> HookDecision {
    HookDecision::Allow {
        reason: reason.to_string(),
    }
}
