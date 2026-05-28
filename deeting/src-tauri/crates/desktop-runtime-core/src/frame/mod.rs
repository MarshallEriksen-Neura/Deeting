use serde::{Deserialize, Serialize};
use serde_json::Value;

pub mod snapshot_render;

pub type FrameVersionId = String;
pub type ModelTurnCount = u64;
pub type SequenceNumber = u64;
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Observation {
    pub id: String,
    pub text: String,
    pub structured: Option<Value>,
    pub source: ObservationSource,
    pub appended_at: SequenceNumber,
    pub supersedes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ObservationSource {
    pub tool_call_id: String,
    pub tool_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommittedAction {
    pub id: String,
    pub action_text: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub committed_at: SequenceNumber,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserDirective {
    pub id: String,
    pub text: String,
    pub appended_at: SequenceNumber,
    pub supersedes: Option<String>,
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
    #[serde(default)]
    pub world_observed: Vec<Observation>,
    #[serde(default)]
    pub agent_committed: Vec<CommittedAction>,
    #[serde(default)]
    pub user_directed: Vec<UserDirective>,
    #[serde(default)]
    pub next_sequence: SequenceNumber,
    #[serde(default)]
    pub last_seen_by_model: SequenceNumber,
    #[serde(default)]
    pub model_turn_count: ModelTurnCount,
    #[serde(default)]
    pub last_diting_think_turn: Option<ModelTurnCount>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposed_next_phase: Option<serde_json::Value>,
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
            world_observed: Vec::new(),
            agent_committed: Vec::new(),
            user_directed: Vec::new(),
            next_sequence: 0,
            last_seen_by_model: 0,
            model_turn_count: 0,
            last_diting_think_turn: None,
            proposed_next_phase: None,
        }
    }

    pub fn next_sequence(&mut self) -> SequenceNumber {
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.next_sequence
    }

    pub fn mark_seen(&mut self) {
        self.last_seen_by_model = self.max_sequence();
        self.model_turn_count = self.model_turn_count.saturating_add(1);
    }

    pub fn mark_diting_think_seen(&mut self) {
        self.last_diting_think_turn = Some(self.model_turn_count);
    }

    pub fn turns_since_last_diting_think(&self) -> ModelTurnCount {
        self.model_turn_count
            .saturating_sub(self.last_diting_think_turn.unwrap_or(0))
    }

    pub fn max_sequence(&self) -> SequenceNumber {
        self.world_observed
            .iter()
            .map(|item| item.appended_at)
            .chain(self.agent_committed.iter().map(|item| item.committed_at))
            .chain(self.user_directed.iter().map(|item| item.appended_at))
            .max()
            .unwrap_or(self.next_sequence)
    }

    pub fn append_observation(
        &mut self,
        text: impl Into<String>,
        structured: Option<Value>,
        source: ObservationSource,
        supersedes: Option<String>,
    ) -> Result<String, String> {
        if let Some(id) = supersedes.as_deref() {
            self.ensure_observation_exists(id)?;
        }
        let id = format!("observation-{}", self.world_observed.len() + 1);
        let appended_at = self.next_sequence();
        self.world_observed.push(Observation {
            id: id.clone(),
            text: text.into(),
            structured,
            source,
            appended_at,
            supersedes,
        });
        Ok(id)
    }

    pub fn append_committed_action(
        &mut self,
        action_text: impl Into<String>,
        tool_call_id: impl Into<String>,
        tool_name: impl Into<String>,
    ) -> String {
        let id = format!("committed-action-{}", self.agent_committed.len() + 1);
        let committed_at = self.next_sequence();
        self.agent_committed.push(CommittedAction {
            id: id.clone(),
            action_text: action_text.into(),
            tool_call_id: tool_call_id.into(),
            tool_name: tool_name.into(),
            committed_at,
        });
        id
    }

    pub fn append_user_directive(
        &mut self,
        text: impl Into<String>,
        supersedes: Option<String>,
    ) -> Result<Option<String>, String> {
        let text = text.into();
        if text.trim().is_empty() {
            return Ok(None);
        }
        if let Some(id) = supersedes.as_deref() {
            self.ensure_user_directive_exists(id)?;
        }
        let id = format!("user-directive-{}", self.user_directed.len() + 1);
        let appended_at = self.next_sequence();
        self.user_directed.push(UserDirective {
            id: id.clone(),
            text,
            appended_at,
            supersedes,
        });
        Ok(Some(id))
    }

    fn ensure_observation_exists(&self, id: &str) -> Result<(), String> {
        if self.world_observed.iter().any(|item| item.id == id) {
            Ok(())
        } else {
            Err(format!("superseded observation id not found: {id}"))
        }
    }

    fn ensure_user_directive_exists(&self, id: &str) -> Result<(), String> {
        if self.user_directed.iter().any(|item| item.id == id) {
            Ok(())
        } else {
            Err(format!("superseded user directive id not found: {id}"))
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

    #[test]
    fn four_sided_records_roundtrip_and_sequence_in_append_order() {
        let mut frame = WorldModelFrame::new(
            "frame-1",
            "session-1",
            "task-1",
            "answer directly",
            ExecutionStrategy::DirectIteration,
            FrameProvenance::bootstrap("test"),
        );

        let directive = frame
            .append_user_directive("do the new thing", None)
            .unwrap()
            .unwrap();
        let observation = frame
            .append_observation(
                "read src/lib.rs",
                Some(serde_json::json!({"path": "src/lib.rs"})),
                ObservationSource {
                    tool_call_id: "call-1".to_string(),
                    tool_name: "read_file".to_string(),
                },
                None,
            )
            .unwrap();
        let commit =
            frame.append_committed_action("fs.write(config.toml) -> success", "call-2", "fs.write");

        assert_eq!(directive, "user-directive-1");
        assert_eq!(observation, "observation-1");
        assert_eq!(commit, "committed-action-1");
        assert_eq!(frame.user_directed[0].appended_at, 1);
        assert_eq!(frame.world_observed[0].appended_at, 2);
        assert_eq!(frame.agent_committed[0].committed_at, 3);

        let encoded = serde_json::to_string(&frame).unwrap();
        let decoded: WorldModelFrame = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, frame);
    }

    #[test]
    fn supersedes_must_exist_on_same_side() {
        let mut frame = WorldModelFrame::new(
            "frame-1",
            "session-1",
            "task-1",
            "answer directly",
            ExecutionStrategy::DirectIteration,
            FrameProvenance::bootstrap("test"),
        );

        assert!(frame
            .append_user_directive("replacement", Some("missing".to_string()))
            .is_err());
        assert!(frame
            .append_observation(
                "replacement read",
                None,
                ObservationSource {
                    tool_call_id: "call-1".to_string(),
                    tool_name: "read_file".to_string(),
                },
                Some("missing".to_string()),
            )
            .is_err());
    }

    #[test]
    fn mark_seen_advances_model_highwater() {
        let mut frame = WorldModelFrame::new(
            "frame-1",
            "session-1",
            "task-1",
            "answer directly",
            ExecutionStrategy::DirectIteration,
            FrameProvenance::bootstrap("test"),
        );
        frame.append_user_directive("do it", None).unwrap();

        assert_eq!(frame.last_seen_by_model, 0);
        frame.mark_seen();
        assert_eq!(frame.last_seen_by_model, 1);
        assert_eq!(frame.model_turn_count, 1);
        assert_eq!(frame.turns_since_last_diting_think(), 1);

        frame.mark_diting_think_seen();
        assert_eq!(frame.last_diting_think_turn, Some(1));
        assert_eq!(frame.turns_since_last_diting_think(), 0);
    }
}
