use crate::modules::mcp::commands::support::*;

pub(crate) const LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION: &str = "capability_activation.v1";

pub(crate) async fn build_local_consult_expert_network_result(
    _app_state: &AppState,
    _intent_query: &str,
    _limit: usize,
    _current_assistant_id: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "action": "consulted",
        "scope": "request",
        "format_version": LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
        "candidates": [],
        "recommended_capability_id": serde_json::Value::Null,
        "reason": "expert_network has been retired from the active desktop runtime.",
        "search_mode": "retired",
    })
}

#[cfg(test)]
pub(crate) async fn build_local_consult_expert_network_result_with_runtime(
    _mcp_store: &crate::modules::mcp::store::McpStore,
    _embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    _memory_store: &crate::modules::memory::service::MemoryService,
    _intent_query: &str,
    _limit: usize,
    _current_assistant_id: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "action": "consulted",
        "scope": "request",
        "format_version": LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
        "candidates": [],
        "recommended_capability_id": serde_json::Value::Null,
        "reason": "expert_network has been retired from the active desktop runtime.",
        "search_mode": "retired",
    })
}
