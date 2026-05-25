use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type FrameVersionId = String;
pub type SessionId = String;
pub type TaskId = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Fact {
    pub id: String,
    pub statement: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Prior {
    pub id: String,
    pub statement: String,
    pub confidence: ConfidenceLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Assumption {
    pub id: String,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Unknown {
    pub id: String,
    pub question: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Rule {
    pub id: String,
    pub instruction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationTarget {
    pub id: String,
    pub description: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfidenceLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStrategy {
    DirectIteration,
    DelegatedWorkflow,
    DelegatedAgent,
    Hybrid,
}

impl ExecutionStrategy {
    pub const fn needs_explicit_plan(self) -> bool {
        !matches!(self, Self::DirectIteration)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorldModelFrameStatus {
    Missing,
    Fresh,
    Stale,
    Contradicted,
    InsufficientForCommit,
    VerifiedEnough,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrameProvenance {
    pub produced_by: String,
    pub reason: String,
    pub evidence_refs: Vec<String>,
}

impl FrameProvenance {
    pub fn bootstrap(reason: impl Into<String>) -> Self {
        Self {
            produced_by: "bootstrap".to_string(),
            reason: reason.into(),
            evidence_refs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FrameBootstrapOutput {
    pub frame: WorldModelFrame,
    pub immediate_action: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorldModelFrame {
    pub frame_version_id: FrameVersionId,
    pub session_id: SessionId,
    pub task_id: TaskId,
    pub parent_frame_id: Option<FrameVersionId>,
    pub fingerprint_key: Option<String>,
    pub goal: String,
    pub known_facts: Vec<Fact>,
    pub memory_priors: Vec<Prior>,
    pub assumptions: Vec<Assumption>,
    pub unknowns: Vec<Unknown>,
    pub execution_strategy: ExecutionStrategy,
    pub adaptation_rules: Vec<Rule>,
    pub verification_targets: Vec<VerificationTarget>,
    pub status: WorldModelFrameStatus,
    pub provenance: FrameProvenance,
}

impl WorldModelFrame {
    pub fn new(
        frame_version_id: impl Into<String>,
        session_id: impl Into<String>,
        task_id: impl Into<String>,
        goal: impl Into<String>,
        execution_strategy: ExecutionStrategy,
        provenance: FrameProvenance,
    ) -> Self {
        Self {
            frame_version_id: frame_version_id.into(),
            session_id: session_id.into(),
            task_id: task_id.into(),
            parent_frame_id: None,
            fingerprint_key: None,
            goal: goal.into(),
            known_facts: Vec::new(),
            memory_priors: Vec::new(),
            assumptions: Vec::new(),
            unknowns: Vec::new(),
            execution_strategy,
            adaptation_rules: Vec::new(),
            verification_targets: Vec::new(),
            status: WorldModelFrameStatus::Fresh,
            provenance,
        }
    }

    pub fn mark_stale(&mut self) {
        self.status = WorldModelFrameStatus::Stale;
    }

    pub fn mark_insufficient_for_commit(&mut self) {
        self.status = WorldModelFrameStatus::InsufficientForCommit;
    }

    pub fn mark_contradicted(&mut self) {
        self.status = WorldModelFrameStatus::Contradicted;
    }

    pub fn mark_verified_enough(&mut self) {
        self.status = WorldModelFrameStatus::VerifiedEnough;
    }

    pub const fn needs_revision(&self) -> bool {
        matches!(self.status, WorldModelFrameStatus::Contradicted)
    }

    pub const fn needs_refresh(&self) -> bool {
        matches!(
            self.status,
            WorldModelFrameStatus::Missing
                | WorldModelFrameStatus::Stale
                | WorldModelFrameStatus::InsufficientForCommit
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_direct_strategy_requires_explicit_plan() {
        assert!(!ExecutionStrategy::DirectIteration.needs_explicit_plan());
        assert!(ExecutionStrategy::DelegatedWorkflow.needs_explicit_plan());
        assert!(ExecutionStrategy::DelegatedAgent.needs_explicit_plan());
        assert!(ExecutionStrategy::Hybrid.needs_explicit_plan());
    }

    #[test]
    fn frame_refresh_status_is_explicit() {
        let mut frame = WorldModelFrame::new(
            "frame-1",
            "session-1",
            "task-1",
            "answer directly",
            ExecutionStrategy::DirectIteration,
            FrameProvenance::bootstrap("test"),
        );
        assert!(!frame.needs_refresh());
        frame.mark_stale();
        assert!(frame.needs_refresh());
        frame.mark_insufficient_for_commit();
        assert!(frame.needs_refresh());
    }

    #[test]
    fn contradicted_frame_requires_revision_not_refresh() {
        let mut frame = WorldModelFrame::new(
            "frame-1",
            "session-1",
            "task-1",
            "answer directly",
            ExecutionStrategy::DirectIteration,
            FrameProvenance::bootstrap("test"),
        );
        frame.mark_contradicted();
        assert!(frame.needs_revision());
        assert!(!frame.needs_refresh());
    }
}
