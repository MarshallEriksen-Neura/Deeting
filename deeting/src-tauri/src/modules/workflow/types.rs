use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowRunStatus {
    #[default]
    Draft,
    Ready,
    Running,
    WaitingApproval,
    AwaitingPlanEdit,
    Completed,
    Failed,
    Cancelled,
}

impl WorkflowRunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Ready => "ready",
            Self::Running => "running",
            Self::WaitingApproval => "waiting_approval",
            Self::AwaitingPlanEdit => "awaiting_plan_edit",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

impl fmt::Display for WorkflowRunStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for WorkflowRunStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "draft" => Ok(Self::Draft),
            "ready" => Ok(Self::Ready),
            "running" => Ok(Self::Running),
            "waiting_approval" => Ok(Self::WaitingApproval),
            "awaiting_plan_edit" => Ok(Self::AwaitingPlanEdit),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(format!("unknown workflow run status: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStepStatus {
    #[default]
    Pending,
    Ready,
    Running,
    WaitingApproval,
    Succeeded,
    Failed,
    Skipped,
    Obsolete,
    Invalidated,
    Cancelled,
}

impl WorkflowStepStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Ready => "ready",
            Self::Running => "running",
            Self::WaitingApproval => "waiting_approval",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Skipped => "skipped",
            Self::Obsolete => "obsolete",
            Self::Invalidated => "invalidated",
            Self::Cancelled => "cancelled",
        }
    }
}

impl fmt::Display for WorkflowStepStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for WorkflowStepStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "pending" => Ok(Self::Pending),
            "ready" => Ok(Self::Ready),
            "running" => Ok(Self::Running),
            "waiting_approval" => Ok(Self::WaitingApproval),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            "skipped" => Ok(Self::Skipped),
            "obsolete" => Ok(Self::Obsolete),
            "invalidated" => Ok(Self::Invalidated),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(format!("unknown workflow step status: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStepType {
    #[default]
    WorkerCall,
    ApprovalGate,
    Finalize,
}

impl WorkflowStepType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::WorkerCall => "worker_call",
            Self::ApprovalGate => "approval_gate",
            Self::Finalize => "finalize",
        }
    }
}

impl fmt::Display for WorkflowStepType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for WorkflowStepType {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "worker_call" => Ok(Self::WorkerCall),
            "approval_gate" => Ok(Self::ApprovalGate),
            "finalize" => Ok(Self::Finalize),
            other => Err(format!("unknown workflow step type: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowArtifactKind {
    #[default]
    TextSummary,
    JsonStructured,
    Table,
    Image,
    FileRef,
    Link,
}

impl WorkflowArtifactKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TextSummary => "text_summary",
            Self::JsonStructured => "json_structured",
            Self::Table => "table",
            Self::Image => "image",
            Self::FileRef => "file_ref",
            Self::Link => "link",
        }
    }
}

impl fmt::Display for WorkflowArtifactKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for WorkflowArtifactKind {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "text_summary" => Ok(Self::TextSummary),
            "json_structured" => Ok(Self::JsonStructured),
            "table" => Ok(Self::Table),
            "image" => Ok(Self::Image),
            "file_ref" => Ok(Self::FileRef),
            "link" => Ok(Self::Link),
            other => Err(format!("unknown workflow artifact kind: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRun {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub status: WorkflowRunStatus,
    pub proposal_text: Option<String>,
    pub snapshot_json: Option<Value>,
    pub proposal_version: i64,
    pub snapshot_version: i64,
    pub run_dir: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStepRun {
    pub id: String,
    pub run_id: String,
    pub phase_id: String,
    pub phase_index: i64,
    pub step_type: WorkflowStepType,
    pub title: String,
    pub status: WorkflowStepStatus,
    pub worker_ref: Option<String>,
    pub goal: Option<String>,
    pub input_snapshot: Option<Value>,
    #[serde(default)]
    pub output_artifact_refs: Vec<String>,
    pub worker_trace_summary: Option<String>,
    pub retry_count: i64,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEvent {
    pub id: String,
    pub run_id: String,
    pub step_id: Option<String>,
    pub event_type: String,
    pub payload: Option<Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowCheckpoint {
    pub id: String,
    pub run_id: String,
    pub blocked_step_id: Option<String>,
    pub reason: String,
    pub approval_payload: Option<Value>,
    pub resume_payload: Option<Value>,
    pub resolved: bool,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowArtifact {
    pub id: String,
    pub run_id: String,
    pub step_id: Option<String>,
    pub phase_id: Option<String>,
    pub artifact_kind: WorkflowArtifactKind,
    pub artifact_ref: Option<String>,
    pub content: Option<String>,
    pub metadata: Option<Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRunDetail {
    pub run: WorkflowRun,
    pub steps: Vec<WorkflowStepRun>,
    pub events: Vec<WorkflowEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowRunRequest {
    pub title: String,
    pub goal: String,
    pub proposal_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowStepRunRequest {
    pub run_id: String,
    pub phase_id: String,
    pub phase_index: i64,
    pub step_type: WorkflowStepType,
    pub title: String,
    pub worker_ref: Option<String>,
    pub goal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowEventRequest {
    pub run_id: String,
    pub step_id: Option<String>,
    pub event_type: String,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowCheckpointRequest {
    pub run_id: String,
    pub blocked_step_id: Option<String>,
    pub reason: String,
    pub approval_payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowArtifactRequest {
    pub run_id: String,
    pub step_id: Option<String>,
    pub phase_id: Option<String>,
    pub artifact_kind: WorkflowArtifactKind,
    pub artifact_ref: Option<String>,
    pub content: Option<String>,
    pub metadata: Option<Value>,
}
