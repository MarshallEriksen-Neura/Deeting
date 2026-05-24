use crate::error::{RuntimeCoreError, RuntimeCoreResult};
use crate::frame::{FrameVersionId, WorldModelFrame};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type PlanId = String;
pub type PhaseId = String;
pub type ProposalId = String;
pub type ObservationRef = String;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PhaseStepType {
    DirectChat,
    ToolCall,
    DelegatedWorker,
    DelegatedWorkflow,
    CapabilityAdmit,
    VerifyFinal,
}

impl PhaseStepType {
    pub const fn interruptibility(self) -> PhaseInterruptibility {
        match self {
            Self::DirectChat | Self::DelegatedWorker | Self::DelegatedWorkflow => {
                PhaseInterruptibility::Cooperative
            }
            Self::ToolCall | Self::CapabilityAdmit | Self::VerifyFinal => {
                PhaseInterruptibility::NonInterruptible
            }
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PhaseInterruptibility {
    Cooperative,
    NonInterruptible,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PhaseStatus {
    Running,
    WaitingForExternal { awaiting_id: String, reason: String },
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Phase {
    pub phase_id: PhaseId,
    pub step_type: PhaseStepType,
    pub payload: Value,
    pub status: PhaseStatus,
    pub committed_at_frame_version: FrameVersionId,
    pub observation_ref: Option<ObservationRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PhaseProposal {
    pub proposal_id: ProposalId,
    pub step_type: PhaseStepType,
    pub payload: Value,
    pub rationale: String,
    pub proposed_at_frame_version: FrameVersionId,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Growing,
    Completed,
    Terminated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlanArtifact {
    pub plan_id: PlanId,
    pub frame_version_id: FrameVersionId,
    pub committed_phases: Vec<Phase>,
    pub proposed_phases: Vec<PhaseProposal>,
    pub plan_status: PlanStatus,
}

impl PlanArtifact {
    pub fn new(plan_id: impl Into<String>, frame_version_id: impl Into<String>) -> Self {
        Self {
            plan_id: plan_id.into(),
            frame_version_id: frame_version_id.into(),
            committed_phases: Vec::new(),
            proposed_phases: Vec::new(),
            plan_status: PlanStatus::Growing,
        }
    }

    pub fn from_frame(plan_id: impl Into<String>, frame: &WorldModelFrame) -> Self {
        Self::new(plan_id, frame.frame_version_id.clone())
    }

    pub fn replace_proposals(&mut self, proposals: Vec<PhaseProposal>) {
        self.proposed_phases = proposals;
    }

    pub fn push_proposal(&mut self, proposal: PhaseProposal) {
        self.proposed_phases.push(proposal);
    }

    pub fn commit_proposal(
        &mut self,
        proposal_id: &str,
        phase_id: impl Into<String>,
    ) -> RuntimeCoreResult<Phase> {
        let proposal_index = self
            .proposed_phases
            .iter()
            .position(|proposal| proposal.proposal_id == proposal_id)
            .ok_or_else(|| RuntimeCoreError::ProposalNotFound(proposal_id.to_string()))?;
        let proposal = self.proposed_phases.remove(proposal_index);
        let phase = Phase {
            phase_id: phase_id.into(),
            step_type: proposal.step_type,
            payload: proposal.payload,
            status: PhaseStatus::Running,
            committed_at_frame_version: proposal.proposed_at_frame_version,
            observation_ref: None,
        };
        self.committed_phases.push(phase.clone());
        Ok(phase)
    }

    pub fn mark_phase_observed(
        &mut self,
        phase_id: &str,
        status: PhaseStatus,
        observation_ref: impl Into<String>,
    ) -> RuntimeCoreResult<()> {
        let phase = self
            .committed_phases
            .iter_mut()
            .find(|phase| phase.phase_id == phase_id)
            .ok_or_else(|| RuntimeCoreError::PhaseNotFound(phase_id.to_string()))?;
        phase.status = status;
        phase.observation_ref = Some(observation_ref.into());
        Ok(())
    }

    pub fn mark_phase_waiting_for_external(
        &mut self,
        phase_id: &str,
        awaiting_id: impl Into<String>,
        reason: impl Into<String>,
    ) -> RuntimeCoreResult<()> {
        let phase = self
            .committed_phases
            .iter_mut()
            .find(|phase| phase.phase_id == phase_id)
            .ok_or_else(|| RuntimeCoreError::PhaseNotFound(phase_id.to_string()))?;
        phase.status = PhaseStatus::WaitingForExternal {
            awaiting_id: awaiting_id.into(),
            reason: reason.into(),
        };
        Ok(())
    }

    pub fn complete(&mut self) {
        self.plan_status = PlanStatus::Completed;
    }

    pub fn terminate(&mut self) {
        self.plan_status = PlanStatus::Terminated;
    }

    pub fn committed_phase(&self, phase_id: &str) -> Option<&Phase> {
        self.committed_phases
            .iter()
            .find(|phase| phase.phase_id == phase_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn committing_proposal_moves_it_to_append_only_history() {
        let mut plan = PlanArtifact::new("plan-1", "frame-1");
        plan.push_proposal(PhaseProposal {
            proposal_id: "proposal-1".to_string(),
            step_type: PhaseStepType::ToolCall,
            payload: json!({"tool":"cargo_test"}),
            rationale: "verify implementation".to_string(),
            proposed_at_frame_version: "frame-1".to_string(),
        });

        let phase = plan.commit_proposal("proposal-1", "phase-1").unwrap();

        assert_eq!(phase.step_type, PhaseStepType::ToolCall);
        assert!(plan.proposed_phases.is_empty());
        assert_eq!(plan.committed_phases.len(), 1);
        assert_eq!(plan.committed_phases[0].status, PhaseStatus::Running);
    }

    #[test]
    fn observed_phase_keeps_committed_identity() {
        let mut plan = PlanArtifact::new("plan-1", "frame-1");
        plan.push_proposal(PhaseProposal {
            proposal_id: "proposal-1".to_string(),
            step_type: PhaseStepType::DirectChat,
            payload: json!({"answer":"ok"}),
            rationale: "direct response".to_string(),
            proposed_at_frame_version: "frame-1".to_string(),
        });
        plan.commit_proposal("proposal-1", "phase-1").unwrap();
        plan.mark_phase_observed("phase-1", PhaseStatus::Done, "obs-1")
            .unwrap();

        let phase = plan.committed_phase("phase-1").unwrap();
        assert_eq!(phase.status, PhaseStatus::Done);
        assert_eq!(phase.observation_ref.as_deref(), Some("obs-1"));
        assert_eq!(phase.committed_at_frame_version, "frame-1");
    }

    #[test]
    fn waiting_for_external_phase_keeps_append_only_identity() {
        let mut plan = PlanArtifact::new("plan-1", "frame-1");
        plan.push_proposal(PhaseProposal {
            proposal_id: "proposal-1".to_string(),
            step_type: PhaseStepType::DelegatedWorker,
            payload: json!({"worker":"executor"}),
            rationale: "delegate long work".to_string(),
            proposed_at_frame_version: "frame-1".to_string(),
        });
        plan.commit_proposal("proposal-1", "phase-1").unwrap();
        plan.mark_phase_waiting_for_external("phase-1", "await-worker-1", "worker running")
            .unwrap();

        assert!(matches!(
            plan.committed_phase("phase-1").unwrap().status,
            PhaseStatus::WaitingForExternal { .. }
        ));
        assert!(plan
            .committed_phase("phase-1")
            .unwrap()
            .observation_ref
            .is_none());
    }
}
