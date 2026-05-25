use mcp_core::types::LocalChatInputMessage;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::serialization::{
    serialize_execution_actions, serialize_execution_children, serialize_execution_selection,
    serialize_execution_target, serialize_packet_receipt,
};

pub(crate) const EXECUTION_TREE_SCHEMA_VERSION: i64 = 1;
pub(crate) const DELEGATED_RESULT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DelegatedExecutionKind {
    CustomTaskAgent,
    Workflow,
}

impl DelegatedExecutionKind {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::CustomTaskAgent => "custom_task_agent",
            Self::Workflow => "workflow",
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DelegatedExecutionStatus {
    Selected,
    Launching,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Integrated,
}

impl DelegatedExecutionStatus {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Selected => "selected",
            Self::Launching => "launching",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Integrated => "integrated",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct DelegatedExecutionTarget {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) invocation_kind: Option<String>,
    pub(crate) worker_ref: Option<String>,
    pub(crate) workflow_run_id: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct DelegatedExecutionSelection {
    pub(crate) explicit: bool,
    pub(crate) score: Option<i32>,
    pub(crate) reason_codes: Vec<String>,
    pub(crate) reason_text: Option<String>,
    pub(crate) candidate_count: usize,
    pub(crate) selected_from_top_k: usize,
    pub(crate) callable_coverage_score: Option<f32>,
    pub(crate) modality_fit_score: Option<f32>,
    pub(crate) profile_prior_score: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct DelegatedExecutionPacketReceipt {
    pub(crate) packet_hash: String,
    pub(crate) task_kind: String,
    pub(crate) deliverable_kind: String,
    pub(crate) selected_profile_id: String,
}

#[derive(Debug, Clone)]
pub(crate) struct DelegatedExecutionAction {
    pub(crate) kind: String,
}

#[derive(Debug, Clone)]
pub(crate) struct DelegatedExecutionChildRecord {
    pub(crate) id: String,
    pub(crate) phase_id: Option<String>,
    pub(crate) step_type: Option<String>,
    pub(crate) title: String,
    pub(crate) status: String,
    pub(crate) worker_ref: Option<String>,
    pub(crate) summary: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) available_actions: Vec<DelegatedExecutionAction>,
}

#[derive(Debug, Clone)]
pub(crate) struct DelegatedExecutionRecord {
    pub(crate) execution_id: String,
    pub(crate) kind: DelegatedExecutionKind,
    pub(crate) status: DelegatedExecutionStatus,
    pub(crate) target: DelegatedExecutionTarget,
    pub(crate) selection: DelegatedExecutionSelection,
    pub(crate) packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    pub(crate) available_actions: Vec<DelegatedExecutionAction>,
    pub(crate) children: Vec<DelegatedExecutionChildRecord>,
    pub(crate) summary: Option<String>,
    #[allow(dead_code)]
    pub(crate) primary_output: Option<Value>,
    pub(crate) error: Option<String>,
    pub(crate) started_at_ms: i64,
    pub(crate) completed_at_ms: Option<i64>,
}

impl DelegatedExecutionRecord {
    pub(crate) fn is_authoritative(&self) -> bool {
        matches!(
            self.status,
            DelegatedExecutionStatus::Succeeded | DelegatedExecutionStatus::Integrated
        )
    }

    pub(crate) fn delegated_result(&self) -> Value {
        json!({
            "type": "delegated_result",
            "schema_version": DELEGATED_RESULT_SCHEMA_VERSION,
            "kind": self.kind.as_str(),
            "authoritative": self.is_authoritative(),
            "status": self.delegated_result_status(),
            "execution_id": self.execution_id.clone(),
            "target": serialize_execution_target(&self.target),
            "selection": serialize_execution_selection(&self.selection),
            "packet_receipt": serialize_packet_receipt(&self.packet_receipt),
            "available_actions": serialize_execution_actions(&self.available_actions),
            "summary": self.summary.clone(),
            "steps": serialize_execution_children(&self.children),
            "primary_output": self.primary_output.clone(),
            "error": self.error.clone(),
            "started_at_ms": self.started_at_ms,
            "completed_at_ms": self.completed_at_ms,
        })
    }

    fn delegated_result_status(&self) -> String {
        self.primary_output
            .as_ref()
            .and_then(|value| value.get("status"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| match self.status {
                DelegatedExecutionStatus::Succeeded | DelegatedExecutionStatus::Integrated => {
                    "completed".to_string()
                }
                other => other.as_str().to_string(),
            })
    }

    pub(crate) fn status_meta_with_status(&self, status: DelegatedExecutionStatus) -> Value {
        let task_input_source = self
            .primary_output
            .as_ref()
            .and_then(|value| value.get("task_input_source"))
            .cloned()
            .unwrap_or(Value::Null);

        json!({
            "schema_version": EXECUTION_TREE_SCHEMA_VERSION,
            "root_execution_id": self.execution_id.clone(),
            "execution_id": self.execution_id.clone(),
            "execution_kind": self.kind.as_str(),
            "execution_status": status.as_str(),
            "terminal_status": self.status.as_str(),
            "target_id": self.target.id.clone(),
            "target_name": self.target.name.clone(),
            "invocation_kind": self.target.invocation_kind.clone(),
            "worker_ref": self.target.worker_ref.clone(),
            "workflow_run_id": self.target.workflow_run_id.clone(),
            "selection": serialize_execution_selection(&self.selection),
            "packet_receipt": serialize_packet_receipt(&self.packet_receipt),
            "available_actions": serialize_execution_actions(&self.available_actions),
            "task_input_source": task_input_source,
            "children": serialize_execution_children(&self.children),
            "summary": self.summary.clone(),
            "error": self.error.clone(),
            "started_at_ms": self.started_at_ms,
            "completed_at_ms": self.completed_at_ms,
        })
    }
}

#[derive(Debug, Clone)]
pub(crate) struct DelegatedExecutionSession {
    pub(crate) record: DelegatedExecutionRecord,
    pub(crate) feedback_messages: Vec<LocalChatInputMessage>,
    pub(crate) trace_blocks: Vec<Value>,
}

impl DelegatedExecutionSession {
    pub(crate) fn build_ui_block(&self, status: DelegatedExecutionStatus) -> Value {
        json!({
            "type": "ui",
            "viewType": "execution.lifecycle",
            "title": format!("Delegated Execution · {}", self.record.target.name),
            "payload": {
                "schema_version": EXECUTION_TREE_SCHEMA_VERSION,
                "root_execution_id": self.record.execution_id.clone(),
                "execution_id": self.record.execution_id.clone(),
                "execution_kind": self.record.kind.as_str(),
                "execution_status": status.as_str(),
                "terminal_status": self.record.status.as_str(),
                "target": serialize_execution_target(&self.record.target),
                "selection": serialize_execution_selection(&self.record.selection),
                "packet_receipt": serialize_packet_receipt(&self.record.packet_receipt),
                "available_actions": serialize_execution_actions(&self.record.available_actions),
                "summary": self.record.summary.clone(),
                "error": self.record.error.clone(),
                "started_at_ms": self.record.started_at_ms,
                "completed_at_ms": self.record.completed_at_ms,
                "children": serialize_execution_children(&self.record.children),
                "delegated_result": self.record.delegated_result(),
            },
            "metadata": {
                "execution_id": self.record.execution_id.clone(),
                "execution_kind": self.record.kind.as_str(),
                "workflow_run_id": self.record.target.workflow_run_id.clone(),
                "worker_ref": self.record.target.worker_ref.clone(),
            }
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn status_meta_with_status_lifts_task_input_source_from_primary_output() {
        let task_input_source = json!({
            "delegated_agent": {
                "parent_task_id": "parent-task-1",
                "parent_frame_id": "frame-parent-1",
                "child_run_id": "child-run-1",
                "child_frame_id": "frame-parent-1:delegation:child-run-1",
                "agent_id": "agent.research",
                "return_channel": "parent_frame_observation"
            }
        });
        let record = DelegatedExecutionRecord {
            execution_id: "exec-1".to_string(),
            kind: DelegatedExecutionKind::CustomTaskAgent,
            status: DelegatedExecutionStatus::Succeeded,
            target: DelegatedExecutionTarget {
                id: "agent.research".to_string(),
                name: "Research Agent".to_string(),
                invocation_kind: Some("chat".to_string()),
                worker_ref: None,
                workflow_run_id: None,
            },
            selection: DelegatedExecutionSelection {
                explicit: true,
                score: Some(100),
                reason_codes: vec!["explicit".to_string()],
                reason_text: Some("explicit selection".to_string()),
                candidate_count: 1,
                selected_from_top_k: 1,
                callable_coverage_score: Some(1.0),
                modality_fit_score: Some(1.0),
                profile_prior_score: Some(1.0),
            },
            packet_receipt: None,
            available_actions: Vec::new(),
            children: Vec::new(),
            summary: Some("done".to_string()),
            primary_output: Some(json!({
                "status": "completed",
                "task_input_source": task_input_source.clone()
            })),
            error: None,
            started_at_ms: 1,
            completed_at_ms: Some(2),
        };

        let tree = record.status_meta_with_status(DelegatedExecutionStatus::Integrated);

        assert_eq!(tree.get("task_input_source"), Some(&task_input_source));
    }
}
