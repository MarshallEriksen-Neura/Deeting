#[cfg(test)]
pub(crate) use crate::modules::ai_upstream::chat::normalize_chat_completion_response;
pub(crate) use crate::modules::ai_upstream::chat::{
    request_provider_chat_completion, request_provider_structured_tool_arguments,
    request_provider_structured_tool_arguments_with_choice, resolve_local_model_connection,
    resolve_local_model_pool_connection, resolve_provider_model_connection,
};
