use super::PersistedInFlightExecutionContext;
use crate::modules::desktop_runtime::runtime::{
    delete_execution_graph_runtime_context,
};

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn now_unix_ms_i64() -> i64 {
    (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn persistable_inflight_context_from_value(
    value: &serde_json::Value,
) -> Option<PersistedInFlightExecutionContext> {
    serde_json::from_value::<PersistedInFlightExecutionContext>(value.clone()).ok()
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn clear_execution_graph_runtime_context(
    store: &crate::modules::mcp::store::McpStore,
    execution_id: Option<&str>,
) {
    let Some(execution_id) = execution_id else {
        return;
    };
    if let Err(err) = delete_execution_graph_runtime_context(store, execution_id).await {
        log::warn!(
            "delete_execution_graph_runtime_context failed execution_id={} err={}",
            execution_id,
            err
        );
    }
}


