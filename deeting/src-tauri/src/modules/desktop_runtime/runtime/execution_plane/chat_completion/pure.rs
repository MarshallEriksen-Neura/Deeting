use super::super::super::LocalExecutionPolicy;
use crate::modules::ai_upstream::types::LocalModelConnection;
use mcp_core::types::LocalChatInputMessage;
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use tokio::sync::mpsc::UnboundedSender;

pub(in crate::modules::desktop_runtime::runtime::execution_plane) struct ChatCompletionPureInput {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) model_connection:
        LocalModelConnection,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) session_id: String,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) capability_id: Option<String>,
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
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) struct ChatCompletionPureResult {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) response_json: Value,
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) trait ChatCompletionProviderClient
{
    fn complete_chat<'a>(
        &'a self,
        input: ChatCompletionPureInput,
    ) -> Pin<Box<dyn Future<Output = Result<ChatCompletionPureResult, String>> + Send + 'a>>;
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) async fn execute_chat_completion_pure<
    C,
>(
    input: ChatCompletionPureInput,
    provider_client: &C,
) -> Result<ChatCompletionPureResult, String>
where
    C: ChatCompletionProviderClient + ?Sized,
{
    provider_client.complete_chat(input).await
}
