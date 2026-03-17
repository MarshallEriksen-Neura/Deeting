mod code_mode_handler;
mod direct_handler;
mod worker_handler;

use super::control_plane::LocalExecutionPlane;
use super::{run_local_chat_complete_with_auto_code_mode, LocalExecutionPolicy};
use crate::modules::ai_upstream::types::LocalModelConnection;
use crate::modules::mcp::types::LocalChatInputMessage;
use crate::state::AppState;
use mcp_session::context::LocalConversationChatContext;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::mpsc::UnboundedSender;

#[derive(Debug, Clone)]
pub(crate) struct DelegatedWorkerExecution {
    pub(crate) feedback_messages: Vec<LocalChatInputMessage>,
    pub(crate) trace_blocks: Vec<Value>,
}

#[derive(Clone)]
pub(crate) struct LocalExecutionRequest {
    pub(crate) app_handle: AppHandle,
    pub(crate) app_state: AppState,
    pub(crate) model_connection: LocalModelConnection,
    pub(crate) session_id: String,
    pub(crate) capability_id: Option<String>,
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
    pub(crate) delegated_worker: Option<DelegatedWorkerExecution>,
    pub(crate) response_json: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LocalExecutionHandlerKind {
    Direct,
    Worker,
    CodeMode,
}

impl LocalExecutionHandlerKind {
    fn from_policy(policy: &LocalExecutionPolicy) -> Self {
        match policy.plane {
            LocalExecutionPlane::ResponseOnly => Self::Direct,
            LocalExecutionPlane::WorkerReasoning => Self::Worker,
            LocalExecutionPlane::CodeModeOrchestration => Self::CodeMode,
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::Direct => "direct_handler",
            Self::Worker => "worker_handler",
            Self::CodeMode => "code_mode_handler",
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
        LocalExecutionHandlerKind::CodeMode => {
            code_mode_handler::run_code_mode_execution_handler(request, &mut emit_status).await
        }
    }
}

pub(super) async fn run_policy_scoped_chat_completion<F>(
    mut request: LocalExecutionRequest,
    delegated_worker: Option<DelegatedWorkerExecution>,
    emit_status: &mut F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    if let Some(execution) = delegated_worker.as_ref() {
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
    let response_json = run_local_chat_complete_with_auto_code_mode(
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

    Ok(LocalExecutionOutcome {
        delegated_worker,
        response_json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcp::commands::runtime::{
        build_default_local_execution_policy, build_local_execution_policy, select_local_route,
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
    fn execution_handler_kind_maps_code_mode_policy_to_code_mode_handler() {
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
            LocalExecutionHandlerKind::CodeMode
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
