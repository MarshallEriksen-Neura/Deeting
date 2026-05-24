use super::{
    now_unix_ms_i64, InFlightExecutionStage, PersistedInFlightExecutionContext,
};
use crate::modules::desktop_runtime::runtime::persist_execution_graph_runtime_context;

pub(super) async fn mark_delegated_workflow_runtime_interrupted_without_run(
    store: &crate::modules::mcp::store::McpStore,
    execution_id: &str,
    persisted: &mut PersistedInFlightExecutionContext,
) -> Result<(), String> {
    persisted.stage = InFlightExecutionStage::Interrupted;
    persisted.recovery_notice_emitted_at_unix_ms = Some(now_unix_ms_i64());
    persist_execution_graph_runtime_context(
        store,
        execution_id,
        &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
    )
    .await
    .map_err(|err| err.to_string())?;
    Ok(())
}
