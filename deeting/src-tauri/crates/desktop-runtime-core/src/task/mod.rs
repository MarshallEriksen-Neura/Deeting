use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserInput {
    pub session_id: String,
    pub task_id: String,
    pub content: String,
    pub source: TaskInputSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskInputSource {
    UserChat,
    AgentDelegation {
        parent_task_id: String,
        delegated_by: String,
        approval_inheritance: ApprovalInheritance,
    },
    ScheduledWakeup {
        schedule_id: String,
    },
}

impl Default for TaskInputSource {
    fn default() -> Self {
        Self::UserChat
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalInheritance {
    ParentDecides,
    UserRequired,
    FullyAutomatic,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrameRefreshRequest {
    pub reason: String,
    pub interruption: Option<UserInterruption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrameValidation {
    pub is_valid: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserInterruption {
    pub interruption_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PhaseObservation {
    pub observation_ref: String,
    pub summary: String,
    pub goal_satisfied: bool,
    pub frame_still_valid: bool,
}
