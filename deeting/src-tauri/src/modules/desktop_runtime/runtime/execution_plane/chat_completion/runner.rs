use super::super::super::run_local_chat_complete_with_tools;
use super::super::super::LocalExecutionPolicy;
use super::super::delegation::{
    build_direct_delegated_execution_outcome, should_return_delegated_result_directly,
};
use super::super::execution_graph_projection::{
    completed_chat_execution_outcome, running_delegated_execution_outcome, ExecutionGraphContext,
};
use super::super::{DelegatedExecutionSession, DelegatedExecutionStatus, LocalExecutionOutcome};
use super::{
    execute_chat_completion_pure, ChatCompletionProviderClient, ChatCompletionPureInput,
    ChatCompletionPureResult,
};
use crate::modules::ai_upstream::types::LocalModelConnection;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use mcp_session::context::LocalConversationChatContext;
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use tauri::AppHandle;
use tokio::sync::mpsc::UnboundedSender;

pub(in crate::modules::desktop_runtime::runtime::execution_plane) struct PolicyScopedChatCompletionInput
{
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) app_handle: AppHandle,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) app_state: AppState,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) model_connection:
        LocalModelConnection,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) session_id: String,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) capability_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) explicit_task_agent_id:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) messages:
        Vec<LocalChatInputMessage>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) execution_policy:
        LocalExecutionPolicy,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) temperature: Option<f32>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) max_tokens: Option<u32>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) reasoning_enabled:
        Option<bool>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) reasoning_effort:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) terminal_context:
        Option<Value>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) workflow_context:
        Option<Value>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) event_tx:
        Option<UnboundedSender<String>>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) trace_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) request_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) selected_knowledge_file_ids:
        Vec<String>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) graph_context:
        ExecutionGraphContext,
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) async fn run_policy_scoped_chat_completion<
    F,
>(
    mut input: PolicyScopedChatCompletionInput,
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
        return Ok(running_delegated_execution_outcome(
            &input.graph_context,
            delegated_execution,
        ));
    }

    if let Some(execution) = delegated_execution.as_ref() {
        if should_return_delegated_result_directly(
            input.explicit_task_agent_id.as_deref(),
            execution,
        ) {
            return Ok(build_direct_delegated_execution_outcome(
                &input.graph_context,
                execution.clone(),
            ));
        }
    }

    if let Some(execution) = delegated_execution.as_ref() {
        input.messages.extend(execution.feedback_messages.clone());
    }

    emit_status(
        "evolve",
        Some("upstream_call"),
        "running",
        "upstream.request.batch",
        None,
    );
    let graph_context = input.graph_context.clone();
    let provider_client = DeetingChatCompletionProviderClient {
        app_handle: input.app_handle,
        app_state: input.app_state,
    };
    let response_json = execute_chat_completion_pure(
        ChatCompletionPureInput {
            model_connection: input.model_connection,
            session_id: input.session_id,
            capability_id: input.capability_id,
            messages: input.messages,
            execution_policy: input.execution_policy,
            temperature: input.temperature,
            max_tokens: input.max_tokens,
            reasoning_enabled: input.reasoning_enabled,
            reasoning_effort: input.reasoning_effort,
            terminal_context: input.terminal_context,
            workflow_context: input.workflow_context,
            event_tx: input.event_tx,
            trace_id: input.trace_id,
            request_id: input.request_id,
            selected_knowledge_file_ids: input.selected_knowledge_file_ids,
        },
        &provider_client,
    )
    .await?
    .response_json;
    Ok(completed_chat_execution_outcome(
        &graph_context,
        response_json,
        delegated_execution,
    ))
}

struct DeetingChatCompletionProviderClient {
    app_handle: AppHandle,
    app_state: AppState,
}

impl ChatCompletionProviderClient for DeetingChatCompletionProviderClient {
    fn complete_chat<'a>(
        &'a self,
        input: ChatCompletionPureInput,
    ) -> Pin<Box<dyn Future<Output = Result<ChatCompletionPureResult, String>> + Send + 'a>> {
        Box::pin(async move {
            let chat_context = LocalConversationChatContext {
                session_id: input.session_id.clone(),
                assistant_id: input.capability_id.clone(),
                messages: input.messages.clone(),
            };
            let response_json = run_local_chat_complete_with_tools(
                &self.app_handle,
                &self.app_state,
                &input.model_connection,
                input.messages,
                &chat_context,
                &input.execution_policy,
                input.temperature,
                input.max_tokens,
                input.reasoning_enabled,
                input.reasoning_effort.clone(),
                input.terminal_context.clone(),
                input.workflow_context.clone(),
                input.event_tx.clone(),
                input.trace_id.as_deref(),
                input.request_id.as_deref(),
                input.selected_knowledge_file_ids.clone(),
            )
            .await?;
            Ok(ChatCompletionPureResult { response_json })
        })
    }
}
