mod direct_handler;
mod worker_handler;

use super::control_plane::LocalExecutionPlane;
use super::{
    project_execution_graph_snapshot, run_local_chat_complete_with_tools, GraphProjectionInput,
    LocalExecutionPolicy,
};
use crate::modules::ai_upstream::types::LocalModelConnection;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use mcp_session::context::LocalConversationChatContext;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::mpsc::UnboundedSender;

pub(crate) const EXECUTION_TREE_SCHEMA_VERSION: i64 = 1;

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
    pub(crate) available_actions: Vec<DelegatedExecutionAction>,
    pub(crate) children: Vec<DelegatedExecutionChildRecord>,
    pub(crate) summary: Option<String>,
    #[allow(dead_code)]
    pub(crate) result_payload: Option<Value>,
    pub(crate) error: Option<String>,
    pub(crate) started_at_ms: i64,
    pub(crate) completed_at_ms: Option<i64>,
}

impl DelegatedExecutionRecord {
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
            "selection": {
                "explicit": self.selection.explicit,
                "score": self.selection.score,
                "reason_codes": self.selection.reason_codes,
                "reason_text": self.selection.reason_text,
            },
            "available_actions": self
                .available_actions
                .iter()
                .map(|action| json!({ "kind": action.kind }))
                .collect::<Vec<_>>(),
            "children": self
                .children
                .iter()
                .map(|child| json!({
                    "id": child.id,
                    "phase_id": child.phase_id,
                    "step_type": child.step_type,
                    "title": child.title,
                    "status": child.status,
                    "worker_ref": child.worker_ref,
                    "summary": child.summary,
                    "error": child.error,
                    "available_actions": child
                        .available_actions
                        .iter()
                        .map(|action| json!({ "kind": action.kind }))
                        .collect::<Vec<_>>(),
                }))
                .collect::<Vec<_>>(),
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
                },
                "available_actions": serialize_execution_actions(&self.record.available_actions),
                "summary": self.record.summary,
                "error": self.record.error,
                "started_at_ms": self.record.started_at_ms,
                "completed_at_ms": self.record.completed_at_ms,
                "children": serialize_execution_children(&self.record.children),
                "result_payload": self.record.result_payload,
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
}
