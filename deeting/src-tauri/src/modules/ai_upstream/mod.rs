pub mod chat;
pub(crate) mod connection_resolver;
pub mod gateway_log_recorder;
pub mod image;
pub mod types;

pub(crate) use chat::{
    request_provider_chat_completion,
    request_provider_chat_completion_streaming_with_pool_failover,
    request_provider_chat_completion_with_pool_failover, resolve_local_model_connection,
    ReasoningRequestConfig,
};
pub(crate) use connection_resolver::resolve_cached_model_connection;
pub(crate) use types::LocalModelConnection;
