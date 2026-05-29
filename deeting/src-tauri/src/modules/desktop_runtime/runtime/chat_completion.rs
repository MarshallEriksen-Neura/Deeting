#[cfg(test)]
pub(crate) use crate::modules::ai_upstream::chat::normalize_chat_completion_response;
pub(crate) use crate::modules::ai_upstream::chat::{
    request_provider_chat_completion, request_provider_chat_json_object, resolve_local_model_connection,
    resolve_local_model_pool_connection, resolve_provider_model_connection,
};
