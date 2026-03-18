#[cfg(test)]
pub(crate) use crate::modules::ai_upstream::chat::normalize_chat_completion_response;
pub(crate) use crate::modules::ai_upstream::chat::{
    request_provider_chat_completion, resolve_local_model_connection,
};
