mod direct_handler;
mod worker_handler;

use super::control_plane::LocalExecutionPlane;
use super::{
    build_local_tool_trace_blocks, project_execution_graph_snapshot,
    run_local_chat_complete_with_tools, GraphProjectionInput, LocalExecutionPolicy,
};
use crate::modules::ai_upstream::types::LocalModelConnection;
use crate::modules::custom_task_agents::runtime::CustomTaskAgentRuntimeError;
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentPreviewResponse, CustomTaskAgentProfile,
};
use crate::modules::workflow::types::QuickWorkflowResult;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use mcp_session::context::LocalConversationChatContext;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::mpsc::UnboundedSender;

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

fn serialize_execution_target(target: &DelegatedExecutionTarget) -> Value {
    json!({
        "id": target.id,
        "name": target.name,
        "invocation_kind": target.invocation_kind,
        "worker_ref": target.worker_ref,
        "workflow_run_id": target.workflow_run_id,
    })
}

fn serialize_execution_selection(selection: &DelegatedExecutionSelection) -> Value {
    json!({
        "explicit": selection.explicit,
        "score": selection.score,
        "reason_codes": selection.reason_codes,
        "reason_text": selection.reason_text,
        "candidate_count": selection.candidate_count,
        "selected_from_top_k": selection.selected_from_top_k,
        "callable_coverage_score": selection.callable_coverage_score,
        "modality_fit_score": selection.modality_fit_score,
        "profile_prior_score": selection.profile_prior_score,
    })
}

fn serialize_packet_receipt(receipt: &Option<DelegatedExecutionPacketReceipt>) -> Value {
    match receipt {
        Some(receipt) => json!({
            "packet_hash": receipt.packet_hash,
            "task_kind": receipt.task_kind,
            "deliverable_kind": receipt.deliverable_kind,
            "selected_profile_id": receipt.selected_profile_id,
        }),
        None => Value::Null,
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
            "status": self.status.as_str(),
            "execution_id": self.execution_id,
            "target": serialize_execution_target(&self.target),
            "selection": serialize_execution_selection(&self.selection),
            "packet_receipt": serialize_packet_receipt(&self.packet_receipt),
            "available_actions": serialize_execution_actions(&self.available_actions),
            "summary": self.summary,
            "steps": serialize_execution_children(&self.children),
            "primary_output": self.primary_output,
            "error": self.error,
            "started_at_ms": self.started_at_ms,
            "completed_at_ms": self.completed_at_ms,
        })
    }

    pub(crate) fn status_meta_with_status(&self, status: DelegatedExecutionStatus) -> Value {
        json!({
            "schema_version": EXECUTION_TREE_SCHEMA_VERSION,
            "root_execution_id": self.execution_id,
            "execution_id": self.execution_id,
            "execution_kind": self.kind.as_str(),
            "execution_status": status.as_str(),
            "terminal_status": self.status.as_str(),
            "target_id": self.target.id,
            "target_name": self.target.name,
            "invocation_kind": self.target.invocation_kind,
            "worker_ref": self.target.worker_ref,
            "workflow_run_id": self.target.workflow_run_id,
            "selection": serialize_execution_selection(&self.selection),
            "packet_receipt": serialize_packet_receipt(&self.packet_receipt),
            "available_actions": serialize_execution_actions(&self.available_actions),
            "children": serialize_execution_children(&self.children),
            "summary": self.summary,
            "error": self.error,
            "started_at_ms": self.started_at_ms,
            "completed_at_ms": self.completed_at_ms,
        })
    }
}

fn serialize_execution_actions(actions: &[DelegatedExecutionAction]) -> Vec<serde_json::Value> {
    actions
        .iter()
        .map(|action| json!({ "kind": action.kind }))
        .collect::<Vec<_>>()
}

fn serialize_execution_children(
    children: &[DelegatedExecutionChildRecord],
) -> Vec<serde_json::Value> {
    children
        .iter()
        .map(|child| {
            json!({
                "id": child.id,
                "phase_id": child.phase_id,
                "step_type": child.step_type,
                "title": child.title,
                "status": child.status,
                "worker_ref": child.worker_ref,
                "summary": child.summary,
                "error": child.error,
                "available_actions": serialize_execution_actions(&child.available_actions),
            })
        })
        .collect::<Vec<_>>()
}

fn summarize_content(content: &str) -> Option<String> {
    let summary = content
        .split_whitespace()
        .take(32)
        .collect::<Vec<_>>()
        .join(" ");
    if summary.is_empty() {
        None
    } else {
        Some(summary)
    }
}

fn workflow_child_actions(status: &str) -> Vec<DelegatedExecutionAction> {
    let mut actions = vec![DelegatedExecutionAction {
        kind: "open".to_string(),
    }];
    if status == "waiting_approval" {
        actions.push(DelegatedExecutionAction {
            kind: "approve".to_string(),
        });
    }
    if status == "succeeded" {
        actions.push(DelegatedExecutionAction {
            kind: "view_context".to_string(),
        });
    }
    if status == "failed" {
        actions.push(DelegatedExecutionAction {
            kind: "rerun".to_string(),
        });
    }
    actions
}

pub(crate) fn build_workflow_delegated_execution_session(
    execution_id: String,
    profile: CustomTaskAgentProfile,
    selection: DelegatedExecutionSelection,
    packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    worker_ref: String,
    result: Result<QuickWorkflowResult, String>,
) -> DelegatedExecutionSession {
    let started_at_ms = chrono::Utc::now().timestamp_millis();
    match result {
        Ok(result) => {
            let workflow_run_id = result.run.id.clone();
            let workflow_status = result.run.status.as_str().to_string();
            let primary_content = result.content.clone();
            let child_records = result
                .steps
                .iter()
                .map(|step| DelegatedExecutionChildRecord {
                    id: step.id.clone(),
                    phase_id: Some(step.phase_id.clone()),
                    step_type: Some(step.step_type.as_str().to_string()),
                    title: step.title.clone(),
                    status: step.status.as_str().to_string(),
                    worker_ref: step.worker_ref.clone(),
                    summary: step.worker_trace_summary.clone(),
                    error: step.error.clone(),
                    available_actions: workflow_child_actions(step.status.as_str()),
                })
                .collect::<Vec<_>>();
            let step_statuses = child_records
                .iter()
                .map(|child| {
                    json!({
                        "id": child.id,
                        "phase_id": child.phase_id,
                        "step_type": child.step_type,
                        "title": child.title,
                        "status": child.status,
                        "worker_ref": child.worker_ref,
                        "summary": child.summary,
                        "error": child.error,
                    })
                })
                .collect::<Vec<_>>();
            let status = if result.succeeded {
                "completed"
            } else {
                "failed"
            };
            let payload = json!({
                "status": status,
                "agent_id": profile.id,
                "agent_name": profile.name,
                "workflow_run_id": workflow_run_id.clone(),
                "workflow_status": workflow_status,
                "content": primary_content,
                "steps": step_statuses,
            });
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-workflow-{}", workflow_run_id),
                "name": format!("workflow/{}", profile.name),
                "status": if result.succeeded { "success" } else { "error" },
                "result": payload.clone(),
            })]);
            let record = DelegatedExecutionRecord {
                execution_id,
                kind: DelegatedExecutionKind::Workflow,
                status: if result.succeeded {
                    DelegatedExecutionStatus::Succeeded
                } else {
                    DelegatedExecutionStatus::Failed
                },
                target: DelegatedExecutionTarget {
                    id: profile.id.clone(),
                    name: profile.name.clone(),
                    invocation_kind: Some(profile.invocation_kind.as_str().to_string()),
                    worker_ref: Some(worker_ref),
                    workflow_run_id: Some(workflow_run_id.clone()),
                },
                selection,
                packet_receipt,
                available_actions: vec![DelegatedExecutionAction {
                    kind: "open".to_string(),
                }],
                children: child_records,
                summary: primary_content
                    .as_deref()
                    .and_then(summarize_content)
                    .or_else(|| Some(format!("workflow {}", workflow_status))),
                primary_output: Some(payload.clone()),
                error: (!result.succeeded).then(|| {
                    format!(
                        "workflow execution finished with status {}",
                        workflow_status
                    )
                }),
                started_at_ms,
                completed_at_ms: Some(chrono::Utc::now().timestamp_millis()),
            };
            let feedback_messages = build_delegated_result_feedback_messages(&record);
            DelegatedExecutionSession {
                record,
                feedback_messages,
                trace_blocks: tool_trace_blocks,
            }
        }
        Err(error) => {
            let payload = json!({
                "status": "failed",
                "agent_id": profile.id,
                "agent_name": profile.name,
                "execution_path": "workflow_runtime",
                "error": error,
            });
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-workflow-error-{}", execution_id),
                "name": format!("workflow/{}", profile.name),
                "status": "error",
                "result": payload.clone(),
            })]);
            let record = DelegatedExecutionRecord {
                execution_id,
                kind: DelegatedExecutionKind::Workflow,
                status: DelegatedExecutionStatus::Failed,
                target: DelegatedExecutionTarget {
                    id: profile.id.clone(),
                    name: profile.name.clone(),
                    invocation_kind: Some(CustomTaskAgentInvocationKind::Chat.as_str().to_string()),
                    worker_ref: Some(worker_ref),
                    workflow_run_id: None,
                },
                selection,
                packet_receipt,
                available_actions: vec![DelegatedExecutionAction {
                    kind: "open".to_string(),
                }],
                children: Vec::new(),
                summary: Some("workflow failed".to_string()),
                primary_output: Some(payload.clone()),
                error: Some(error),
                started_at_ms,
                completed_at_ms: Some(chrono::Utc::now().timestamp_millis()),
            };
            let feedback_messages = build_delegated_result_feedback_messages(&record);
            DelegatedExecutionSession {
                record,
                feedback_messages,
                trace_blocks: tool_trace_blocks,
            }
        }
    }
}

pub(crate) fn build_custom_task_agent_delegated_execution_session(
    execution_id: String,
    profile: CustomTaskAgentProfile,
    selection: DelegatedExecutionSelection,
    packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    result: Result<CustomTaskAgentPreviewResponse, CustomTaskAgentRuntimeError>,
    render_blocks: Vec<Value>,
) -> DelegatedExecutionSession {
    let started_at_ms = chrono::Utc::now().timestamp_millis();
    match result {
        Ok(result) => {
            let payload = json!({
                "status": result.status,
                "agent_id": profile.id,
                "agent_name": profile.name,
                "invocation_kind": result.invocation_kind.as_str(),
                "content": result.content,
                "reasoning_content": result.reasoning_content,
                "images": result.images,
                "audios": result.audios,
                "tool_trace": result.tool_trace,
                "callable_mcp_tool_ids": result.callable_mcp_tool_ids,
                "guidance_skill_ids": result.guidance_skill_ids,
                "callable_skill_action_refs": result.callable_skill_action_refs,
                "render_blocks": render_blocks,
            });
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-agent-{}", profile.id),
                "name": format!("custom_task_agent/{}", profile.name),
                "status": "success",
                "result": payload.clone(),
            })]);
            let primary_child = DelegatedExecutionChildRecord {
                id: format!("{}:primary", execution_id),
                phase_id: None,
                step_type: Some("worker_call".to_string()),
                title: profile.name.clone(),
                status: "succeeded".to_string(),
                worker_ref: Some(format!("user_worker_profile:{}", profile.id)),
                summary: summarize_content(result.content.as_str()),
                error: None,
                available_actions: if render_blocks.is_empty() {
                    Vec::new()
                } else {
                    vec![DelegatedExecutionAction {
                        kind: "view_result".to_string(),
                    }]
                },
            };
            let record = DelegatedExecutionRecord {
                execution_id,
                kind: DelegatedExecutionKind::CustomTaskAgent,
                status: DelegatedExecutionStatus::Succeeded,
                target: DelegatedExecutionTarget {
                    id: profile.id.clone(),
                    name: profile.name.clone(),
                    invocation_kind: Some(result.invocation_kind.as_str().to_string()),
                    worker_ref: None,
                    workflow_run_id: None,
                },
                selection,
                packet_receipt,
                available_actions: Vec::new(),
                children: vec![primary_child],
                summary: summarize_content(result.content.as_str()),
                primary_output: Some(payload.clone()),
                error: None,
                started_at_ms,
                completed_at_ms: Some(chrono::Utc::now().timestamp_millis()),
            };
            let feedback_messages = build_delegated_result_feedback_messages(&record);
            DelegatedExecutionSession {
                record,
                feedback_messages,
                trace_blocks: tool_trace_blocks,
            }
        }
        Err(error) => {
            let error_text = error.message.clone();
            let payload = json!({
                "status": "failed",
                "agent_id": profile.id,
                "agent_name": profile.name,
                "error_code": error.code.clone(),
                "error": error_text,
            });
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-agent-{}", profile.id),
                "name": format!("custom_task_agent/{}", profile.name),
                "status": "error",
                "error_code": error.code,
                "error": error.message,
            })]);
            let primary_child = DelegatedExecutionChildRecord {
                id: format!("{}:primary", execution_id),
                phase_id: None,
                step_type: Some("worker_call".to_string()),
                title: profile.name.clone(),
                status: "failed".to_string(),
                worker_ref: Some(format!("user_worker_profile:{}", profile.id)),
                summary: Some(error_text.clone()),
                error: Some(error_text.clone()),
                available_actions: Vec::new(),
            };
            let record = DelegatedExecutionRecord {
                execution_id,
                kind: DelegatedExecutionKind::CustomTaskAgent,
                status: DelegatedExecutionStatus::Failed,
                target: DelegatedExecutionTarget {
                    id: profile.id.clone(),
                    name: profile.name.clone(),
                    invocation_kind: Some(profile.invocation_kind.as_str().to_string()),
                    worker_ref: None,
                    workflow_run_id: None,
                },
                selection,
                packet_receipt,
                available_actions: Vec::new(),
                children: vec![primary_child],
                summary: Some(error_text.clone()),
                primary_output: Some(payload.clone()),
                error: Some(error_text),
                started_at_ms,
                completed_at_ms: Some(chrono::Utc::now().timestamp_millis()),
            };
            let feedback_messages = build_delegated_result_feedback_messages(&record);
            DelegatedExecutionSession {
                record,
                feedback_messages,
                trace_blocks: tool_trace_blocks,
            }
        }
    }
}

pub(crate) fn build_delegated_result_feedback_messages(
    record: &DelegatedExecutionRecord,
) -> Vec<LocalChatInputMessage> {
    let delegated_result = record.delegated_result();
    let delegated_result_json =
        serde_json::to_string(&delegated_result).unwrap_or_else(|_| "{}".to_string());
    let instruction = if record.is_authoritative() {
        format!(
            "The next user message is a canonical delegated_result JSON object (schema_version={}). Treat it as authoritative delegated subtask output. Prefer its structured fields over inference and do not re-run the delegated task unless the user asks or the result is blocked.",
            DELEGATED_RESULT_SCHEMA_VERSION
        )
    } else {
        format!(
            "The next user message is a canonical delegated_result JSON object (schema_version={}). It records a delegated attempt that did not succeed authoritatively. Use its structured fields for fallback reasoning and do not invent a successful delegated result.",
            DELEGATED_RESULT_SCHEMA_VERSION
        )
    };

    vec![
        LocalChatInputMessage {
            role: "system".to_string(),
            content: instruction,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
        LocalChatInputMessage {
            role: "user".to_string(),
            content: delegated_result_json,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
    ]
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
                    "root_execution_id": self.record.execution_id,
                    "execution_id": self.record.execution_id,
                "execution_kind": self.record.kind.as_str(),
                "execution_status": status.as_str(),
                "terminal_status": self.record.status.as_str(),
                "target": {
                    "id": self.record.target.id,
                    "name": self.record.target.name,
                    "invocation_kind": self.record.target.invocation_kind,
                    "worker_ref": self.record.target.worker_ref,
                    "workflow_run_id": self.record.target.workflow_run_id,
                },
                "selection": {
                    "explicit": self.record.selection.explicit,
                    "score": self.record.selection.score,
                    "reason_codes": self.record.selection.reason_codes,
                    "reason_text": self.record.selection.reason_text,
                    "candidate_count": self.record.selection.candidate_count,
                    "selected_from_top_k": self.record.selection.selected_from_top_k,
                    "callable_coverage_score": self.record.selection.callable_coverage_score,
                    "modality_fit_score": self.record.selection.modality_fit_score,
                    "profile_prior_score": self.record.selection.profile_prior_score,
                },
                "packet_receipt": serialize_packet_receipt(&self.record.packet_receipt),
                "available_actions": serialize_execution_actions(&self.record.available_actions),
                "summary": self.record.summary,
                "error": self.record.error,
                "started_at_ms": self.record.started_at_ms,
                "completed_at_ms": self.record.completed_at_ms,
                "children": serialize_execution_children(&self.record.children),
                "delegated_result": self.record.delegated_result(),
            },
            "metadata": {
                "execution_id": self.record.execution_id,
                "execution_kind": self.record.kind.as_str(),
                "workflow_run_id": self.record.target.workflow_run_id,
                "worker_ref": self.record.target.worker_ref,
            }
        })
    }
}

#[derive(Clone)]
pub(crate) struct LocalExecutionRequest {
    pub(crate) app_handle: AppHandle,
    pub(crate) app_state: AppState,
    pub(crate) model_connection: LocalModelConnection,
    pub(crate) session_id: String,
    pub(crate) capability_id: Option<String>,
    pub(crate) explicit_task_agent_id: Option<String>,
    pub(crate) root_execution_id: Option<String>,
    pub(crate) messages: Vec<LocalChatInputMessage>,
    pub(crate) execution_policy: LocalExecutionPolicy,
    pub(crate) temperature: Option<f32>,
    pub(crate) max_tokens: Option<u32>,
    pub(crate) reasoning_enabled: Option<bool>,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) event_tx: Option<UnboundedSender<String>>,
    pub(crate) trace_id: Option<String>,
    pub(crate) request_id: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct LocalExecutionOutcome {
    pub(crate) delegated_execution: Option<DelegatedExecutionSession>,
    pub(crate) execution_graph: Value,
    pub(crate) response_json: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LocalExecutionHandlerKind {
    Direct,
    Worker,
}

impl LocalExecutionHandlerKind {
    fn from_policy(policy: &LocalExecutionPolicy) -> Self {
        match policy.plane {
            LocalExecutionPlane::ResponseOnly => Self::Direct,
            LocalExecutionPlane::WorkerReasoning => Self::Worker,
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::Direct => "direct_handler",
            Self::Worker => "worker_handler",
        }
    }
}

pub(crate) async fn run_local_execution_plane<F>(
    request: LocalExecutionRequest,
    mut emit_status: F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    let handler = LocalExecutionHandlerKind::from_policy(&request.execution_policy);
    emit_status(
        "evolve",
        Some("execution_handler"),
        "success",
        "runtime.execution.handler.selected",
        Some(json!({
            "handler": handler.as_str(),
            "route": request.execution_policy.route.as_str(),
            "plane": request.execution_policy.plane.as_str(),
        })),
    );

    match handler {
        LocalExecutionHandlerKind::Direct => {
            direct_handler::run_direct_execution_handler(request, &mut emit_status).await
        }
        LocalExecutionHandlerKind::Worker => {
            worker_handler::run_worker_execution_handler(request, &mut emit_status).await
        }
    }
}

pub(super) async fn run_policy_scoped_chat_completion<F>(
    mut request: LocalExecutionRequest,
    delegated_execution: Option<DelegatedExecutionSession>,
    emit_status: &mut F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    if delegated_execution
        .as_ref()
        .is_some_and(|execution| execution.record.status == DelegatedExecutionStatus::Running)
    {
        let delegated_execution = delegated_execution.expect("running delegated execution");
        let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
            session_id: request.session_id.clone(),
            route: request.execution_policy.route.as_str().to_string(),
            plane: request.execution_policy.plane.as_str().to_string(),
            trace_id: request.trace_id.clone(),
            request_id: request.request_id.clone(),
            root_execution_id: request.root_execution_id.clone(),
            response_content: None,
            tool_trace_blocks: delegated_execution.trace_blocks.clone(),
            delegated_execution_tree: Some(
                delegated_execution
                    .record
                    .status_meta_with_status(DelegatedExecutionStatus::Running),
            ),
        })
        .to_value();
        let response_json = json!({
            "content": "",
            "tool_trace_blocks": delegated_execution.trace_blocks.clone(),
            "tool_trace_streamed": true,
            "execution_graph": execution_graph.clone(),
        });
        return Ok(LocalExecutionOutcome {
            delegated_execution: Some(delegated_execution),
            execution_graph,
            response_json,
        });
    }

    if let Some(execution) = delegated_execution.as_ref() {
        if should_return_delegated_result_directly(
            request.explicit_task_agent_id.as_deref(),
            execution,
        ) {
            return Ok(build_direct_delegated_execution_outcome(&request, execution.clone()));
        }
    }

    if let Some(execution) = delegated_execution.as_ref() {
        request.messages.extend(execution.feedback_messages.clone());
    }

    emit_status(
        "evolve",
        Some("upstream_call"),
        "running",
        "upstream.request.batch",
        None,
    );
    let chat_context = LocalConversationChatContext {
        session_id: request.session_id.clone(),
        assistant_id: request.capability_id.clone(),
        messages: request.messages.clone(),
    };
    let response_json = run_local_chat_complete_with_tools(
        &request.app_handle,
        &request.app_state,
        &request.model_connection,
        request.messages,
        &chat_context,
        &request.execution_policy,
        request.temperature,
        request.max_tokens,
        request.reasoning_enabled,
        request.reasoning_effort.clone(),
        request.event_tx,
        request.trace_id.as_deref(),
        request.request_id.as_deref(),
    )
    .await?;
    let delegated_execution_tree = delegated_execution.as_ref().map(|execution| {
        execution
            .record
            .status_meta_with_status(DelegatedExecutionStatus::Integrated)
    });
    let tool_trace_blocks = response_json
        .get("tool_trace_blocks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: request.session_id.clone(),
        route: request.execution_policy.route.as_str().to_string(),
        plane: request.execution_policy.plane.as_str().to_string(),
        trace_id: request.trace_id.clone(),
        request_id: request.request_id.clone(),
        root_execution_id: request.root_execution_id.clone(),
        response_content: response_json.get("content").cloned(),
        tool_trace_blocks,
        delegated_execution_tree,
    })
    .to_value();
    let mut response_json = response_json;
    if let Some(object) = response_json.as_object_mut() {
        object.insert("execution_graph".to_string(), execution_graph.clone());
    }

    Ok(LocalExecutionOutcome {
        delegated_execution,
        execution_graph,
        response_json,
    })
}

fn should_return_delegated_result_directly(
    explicit_task_agent_id: Option<&str>,
    execution: &DelegatedExecutionSession,
) -> bool {
    let Some(explicit_task_agent_id) = explicit_task_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    if explicit_task_agent_id != execution.record.target.id.as_str() {
        return false;
    }
    if execution.record.status == DelegatedExecutionStatus::Running {
        return false;
    }

    matches!(
        execution.record.target.invocation_kind.as_deref(),
        Some("image_generation" | "text_to_speech")
    )
}

fn build_direct_delegated_execution_outcome(
    request: &LocalExecutionRequest,
    execution: DelegatedExecutionSession,
) -> LocalExecutionOutcome {
    let tool_trace_blocks = execution.trace_blocks.clone();
    let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: request.session_id.clone(),
        route: request.execution_policy.route.as_str().to_string(),
        plane: request.execution_policy.plane.as_str().to_string(),
        trace_id: request.trace_id.clone(),
        request_id: request.request_id.clone(),
        root_execution_id: request.root_execution_id.clone(),
        response_content: None,
        tool_trace_blocks: tool_trace_blocks.clone(),
        delegated_execution_tree: Some(
            execution
                .record
                .status_meta_with_status(DelegatedExecutionStatus::Integrated),
        ),
    })
    .to_value();
    let response_json = json!({
        "content": "",
        "tool_trace_blocks": tool_trace_blocks,
        "tool_trace_streamed": true,
        "execution_graph": execution_graph.clone(),
        "delegated_direct_return": true,
    });

    LocalExecutionOutcome {
        delegated_execution: Some(execution),
        execution_graph,
        response_json,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::desktop_runtime::runtime::route_selector::select_local_route;
    use crate::modules::desktop_runtime::runtime::{
        build_default_local_execution_policy, build_local_execution_policy,
    };
    use serde_json::json;

    #[test]
    fn execution_handler_kind_maps_direct_policy_to_direct_handler() {
        let policy = build_default_local_execution_policy();
        assert_eq!(
            LocalExecutionHandlerKind::from_policy(&policy),
            LocalExecutionHandlerKind::Direct
        );
    }

    #[test]
    fn execution_handler_kind_maps_worker_policy_to_worker_handler() {
        let decision = select_local_route(
            "请先分析这个方案的风险和取舍，再给建议",
            &json!({
                "orchestration_primitives": [],
                "capabilities": [],
                "routing_hint": {}
            }),
        );
        let policy = build_local_execution_policy(&decision);

        assert_eq!(
            LocalExecutionHandlerKind::from_policy(&policy),
            LocalExecutionHandlerKind::Worker
        );
    }

    #[test]
    fn execution_handler_kind_maps_programmatic_worker_policy_to_worker_handler() {
        let decision = select_local_route(
            "遍历所有 markdown files，抽标题、分类、去重后输出 JSON",
            &json!({
                "orchestration_primitives": [{ "name": "execute_code_plan" }],
                "capabilities": [],
                "routing_hint": { "programmatic_path": "execute_code_plan" }
            }),
        );
        let policy = build_local_execution_policy(&decision);

        assert_eq!(
            LocalExecutionHandlerKind::from_policy(&policy),
            LocalExecutionHandlerKind::Worker
        );
    }

    #[test]
    fn latest_user_message_prefers_most_recent_user_turn() {
        let latest = worker_handler::latest_user_message(&[
            LocalChatInputMessage {
                role: "user".to_string(),
                content: "older".to_string(),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            },
            LocalChatInputMessage {
                role: "assistant".to_string(),
                content: "reply".to_string(),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            },
            LocalChatInputMessage {
                role: "user".to_string(),
                content: "newest".to_string(),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            },
        ]);

        assert_eq!(latest.as_deref(), Some("newest"));
    }

    #[test]
    fn delegated_result_uses_canonical_schema() {
        let record = DelegatedExecutionRecord {
            execution_id: "exec-123".to_string(),
            kind: DelegatedExecutionKind::Workflow,
            status: DelegatedExecutionStatus::Succeeded,
            target: DelegatedExecutionTarget {
                id: "worker-1".to_string(),
                name: "Research Worker".to_string(),
                invocation_kind: Some("chat".to_string()),
                worker_ref: Some("user_worker_profile:researcher".to_string()),
                workflow_run_id: Some("run-123".to_string()),
            },
            selection: DelegatedExecutionSelection {
                explicit: false,
                score: Some(92),
                reason_codes: vec!["tag_match".to_string()],
                reason_text: Some("tag_match".to_string()),
                candidate_count: 3,
                selected_from_top_k: 3,
                callable_coverage_score: Some(0.8),
                modality_fit_score: Some(1.0),
                profile_prior_score: Some(0.0),
            },
            packet_receipt: Some(DelegatedExecutionPacketReceipt {
                packet_hash: "packet-123".to_string(),
                task_kind: "analysis".to_string(),
                deliverable_kind: "structured_findings".to_string(),
                selected_profile_id: "worker-1".to_string(),
            }),
            available_actions: vec![DelegatedExecutionAction {
                kind: "open".to_string(),
            }],
            children: vec![DelegatedExecutionChildRecord {
                id: "step-1".to_string(),
                phase_id: Some("phase-1".to_string()),
                step_type: Some("worker_call".to_string()),
                title: "Execute".to_string(),
                status: "succeeded".to_string(),
                worker_ref: Some("user_worker_profile:researcher".to_string()),
                summary: Some("Compiled answer".to_string()),
                error: None,
                available_actions: vec![DelegatedExecutionAction {
                    kind: "open".to_string(),
                }],
            }],
            summary: Some("Compiled answer".to_string()),
            primary_output: Some(json!({
                "workflow_run_id": "run-123",
                "content": "Compiled answer",
            })),
            error: None,
            started_at_ms: 10,
            completed_at_ms: Some(20),
        };

        let delegated_result = record.delegated_result();
        assert_eq!(
            delegated_result.get("type").and_then(Value::as_str),
            Some("delegated_result")
        );
        assert_eq!(
            delegated_result
                .get("schema_version")
                .and_then(Value::as_i64),
            Some(DELEGATED_RESULT_SCHEMA_VERSION)
        );
        assert_eq!(
            delegated_result
                .get("authoritative")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            delegated_result.get("kind").and_then(Value::as_str),
            Some("workflow")
        );
        assert_eq!(
            delegated_result
                .get("primary_output")
                .and_then(|value| value.get("workflow_run_id"))
                .and_then(Value::as_str),
            Some("run-123")
        );
        assert_eq!(
            delegated_result
                .get("packet_receipt")
                .and_then(|value| value.get("packet_hash"))
                .and_then(Value::as_str),
            Some("packet-123")
        );
    }

    #[test]
    fn delegated_result_feedback_messages_inject_json_payload() {
        let record = DelegatedExecutionRecord {
            execution_id: "exec-123".to_string(),
            kind: DelegatedExecutionKind::CustomTaskAgent,
            status: DelegatedExecutionStatus::Succeeded,
            target: DelegatedExecutionTarget {
                id: "agent-1".to_string(),
                name: "Image Worker".to_string(),
                invocation_kind: Some("image_generation".to_string()),
                worker_ref: None,
                workflow_run_id: None,
            },
            selection: DelegatedExecutionSelection {
                explicit: true,
                score: Some(100),
                reason_codes: vec!["explicit".to_string()],
                reason_text: Some("explicit".to_string()),
                candidate_count: 1,
                selected_from_top_k: 1,
                callable_coverage_score: Some(1.0),
                modality_fit_score: Some(1.0),
                profile_prior_score: Some(0.0),
            },
            packet_receipt: Some(DelegatedExecutionPacketReceipt {
                packet_hash: "packet-image".to_string(),
                task_kind: "image_generation".to_string(),
                deliverable_kind: "image_result".to_string(),
                selected_profile_id: "agent-1".to_string(),
            }),
            available_actions: Vec::new(),
            children: Vec::new(),
            summary: Some("Generated image".to_string()),
            primary_output: Some(json!({
                "render_blocks": [{ "view_type": "image.result" }],
            })),
            error: None,
            started_at_ms: 1,
            completed_at_ms: Some(2),
        };

        let messages = build_delegated_result_feedback_messages(&record);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "system");
        assert!(messages[0]
            .content
            .contains("canonical delegated_result JSON object"));

        let payload: Value =
            serde_json::from_str(messages[1].content.as_str()).expect("delegated_result json");
        assert_eq!(
            payload.get("type").and_then(Value::as_str),
            Some("delegated_result")
        );
        assert_eq!(
            payload
                .get("primary_output")
                .and_then(|value| value.get("render_blocks"))
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn running_delegated_session_preserves_running_status_meta() {
        let session = DelegatedExecutionSession {
            record: DelegatedExecutionRecord {
                execution_id: "exec-running".to_string(),
                kind: DelegatedExecutionKind::Workflow,
                status: DelegatedExecutionStatus::Running,
                target: DelegatedExecutionTarget {
                    id: "agent-1".to_string(),
                    name: "Workflow Agent".to_string(),
                    invocation_kind: Some("chat".to_string()),
                    worker_ref: Some("user_worker_profile:agent-1".to_string()),
                    workflow_run_id: Some("run-123".to_string()),
                },
                selection: DelegatedExecutionSelection {
                    explicit: false,
                    score: Some(88),
                    reason_codes: vec!["coverage".to_string()],
                    reason_text: Some("best match".to_string()),
                    candidate_count: 3,
                    selected_from_top_k: 2,
                    callable_coverage_score: Some(0.8),
                    modality_fit_score: Some(1.0),
                    profile_prior_score: Some(0.0),
                },
                packet_receipt: None,
                available_actions: vec![DelegatedExecutionAction {
                    kind: "open".to_string(),
                }],
                children: Vec::new(),
                summary: Some("workflow run-123 running".to_string()),
                primary_output: Some(json!({
                    "status": "running",
                    "workflow_run_id": "run-123"
                })),
                error: None,
                started_at_ms: 1,
                completed_at_ms: None,
            },
            feedback_messages: Vec::new(),
            trace_blocks: vec![json!({
                "type": "tool_call",
                "callId": "delegated-workflow-run-123",
                "toolName": "workflow/Workflow Agent",
                "status": "running"
            })],
        };

        let status_meta = session
            .record
            .status_meta_with_status(DelegatedExecutionStatus::Running);

        assert_eq!(
            status_meta.get("execution_status").and_then(Value::as_str),
            Some("running")
        );
        assert_eq!(
            status_meta.get("terminal_status").and_then(Value::as_str),
            Some("running")
        );
        assert_eq!(
            status_meta.get("workflow_run_id").and_then(Value::as_str),
            Some("run-123")
        );
    }

    #[test]
    fn direct_delegated_return_only_applies_to_explicit_media_agents() {
        let mut session = DelegatedExecutionSession {
            record: DelegatedExecutionRecord {
                execution_id: "exec-media".to_string(),
                kind: DelegatedExecutionKind::CustomTaskAgent,
                status: DelegatedExecutionStatus::Succeeded,
                target: DelegatedExecutionTarget {
                    id: "agent-media".to_string(),
                    name: "Voice Agent".to_string(),
                    invocation_kind: Some("text_to_speech".to_string()),
                    worker_ref: None,
                    workflow_run_id: None,
                },
                selection: DelegatedExecutionSelection {
                    explicit: true,
                    score: Some(100),
                    reason_codes: vec!["explicit_task_agent".to_string()],
                    reason_text: Some("explicit".to_string()),
                    candidate_count: 1,
                    selected_from_top_k: 1,
                    callable_coverage_score: Some(1.0),
                    modality_fit_score: Some(1.0),
                    profile_prior_score: Some(0.0),
                },
                packet_receipt: None,
                available_actions: Vec::new(),
                children: Vec::new(),
                summary: Some("audio ready".to_string()),
                primary_output: Some(json!({ "audios": ["local-asset://audio-1"] })),
                error: None,
                started_at_ms: 1,
                completed_at_ms: Some(2),
            },
            feedback_messages: Vec::new(),
            trace_blocks: vec![json!({
                "type": "ui",
                "viewType": "audio.result",
                "payload": { "asset": { "url": "local-asset://audio-1" } }
            })],
        };

        assert!(should_return_delegated_result_directly(
            Some("agent-media"),
            &session
        ));
        assert!(!should_return_delegated_result_directly(None, &session));
        assert!(!should_return_delegated_result_directly(
            Some("agent-other"),
            &session
        ));

        session.record.target.invocation_kind = Some("chat".to_string());
        assert!(!should_return_delegated_result_directly(
            Some("agent-media"),
            &session
        ));
    }
}
