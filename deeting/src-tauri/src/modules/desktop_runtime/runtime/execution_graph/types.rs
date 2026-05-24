use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const EXECUTION_GRAPH_SCHEMA_VERSION: i64 = 1;

pub(crate) fn llm_round_node_id(round: usize) -> String {
    format!("llm_round:{round}")
}

pub(crate) fn tool_call_node_id(call_id: &str) -> String {
    format!("tool_call:{call_id}")
}

pub(crate) fn approval_gate_node_id(call_id: &str) -> String {
    format!("approval_gate:{call_id}")
}

pub(crate) fn finalize_node_id(round: usize) -> String {
    format!("finalize:{round}")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LocalExecutionGraphNodeType {
    LlmRound,
    ToolCall,
    ApprovalGate,
    Finalize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LocalExecutionGraphNodeStatus {
    Pending,
    Queued,
    Running,
    WaitingApproval,
    Approving,
    Approved,
    Rejected,
    ApprovalFailed,
    Success,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LocalExecutionGraphBackend {
    Direct,
    Worker,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LocalExecutionGraphExecutionClass {
    ParallelSafe,
    SerialOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LocalExecutionGraphStateScope {
    ReadOnly,
    MutatesSession,
    MutatesWorkspace,
    ExternalSideEffect,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct LocalExecutionGraphNode {
    pub(crate) node_id: String,
    pub(crate) node_type: LocalExecutionGraphNodeType,
    pub(crate) status: LocalExecutionGraphNodeStatus,
    pub(crate) dependency_ids: Vec<String>,
    pub(crate) metadata: Value,
    pub(crate) input_payload: Option<Value>,
    pub(crate) output_payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct LocalExecutionGraphEvent {
    pub(crate) event_id: String,
    pub(crate) node_id: Option<String>,
    pub(crate) event_type: String,
    pub(crate) payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct LocalExecutionGraphSnapshot {
    pub(crate) schema_version: i64,
    pub(crate) execution_id: String,
    pub(crate) session_id: String,
    pub(crate) route: String,
    #[serde(alias = "plane")]
    pub(crate) phase_step_type: String,
    pub(crate) request_id: Option<String>,
    pub(crate) root_execution_id: Option<String>,
    pub(crate) nodes: Vec<LocalExecutionGraphNode>,
    pub(crate) events: Vec<LocalExecutionGraphEvent>,
    pub(crate) metadata: Value,
}

impl LocalExecutionGraphSnapshot {
    pub(crate) fn to_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| Value::Null)
    }
}
