use super::interrupted_graph::mark_inflight_execution_interrupted;
use super::recovery_prompt::append_recovery_assistant_message_if_missing;
use super::{now_unix_ms_i64, InFlightExecutionStage, PersistedInFlightExecutionContext};
use crate::modules::desktop_runtime::runtime::{
    load_execution_graph_snapshot, persist_execution_graph_runtime_context,
    persist_execution_graph_snapshot,
};

pub(super) async fn recover_tool_running_runtime_context(
    store: &crate::modules::mcp::store::McpStore,
    execution_id: &str,
    persisted: &mut PersistedInFlightExecutionContext,
) -> Result<(), String> {
    if persisted.recovery_notice_emitted_at_unix_ms.is_some() {
        return Ok(());
    }
    let Some(mut execution_graph) = load_execution_graph_snapshot(store, execution_id)
        .await
        .map_err(|err| err.to_string())?
    else {
        return Ok(());
    };
    let message = "The previous run was interrupted while a tool was running. The system did not auto-replay it, so confirm the tool state before continuing, retrying, or abandoning.";
    mark_inflight_execution_interrupted(
        &mut execution_graph,
        persisted.current_call_id.as_deref(),
        message,
    );
    persist_execution_graph_snapshot(
        store,
        &execution_graph,
        persisted.session_id.as_str(),
        "desktop_local_chat_recovered_interrupt",
        persisted.request_id.as_deref(),
        Some("interrupted"),
    )
    .await
    .map_err(|err| err.to_string())?;
    append_recovery_assistant_message_if_missing(
        store,
        persisted.session_id.as_str(),
        &execution_graph,
        execution_id,
        "tool_running_interrupted",
        message,
        &["continue", "retry", "abandon"],
    )
    .await?;
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
