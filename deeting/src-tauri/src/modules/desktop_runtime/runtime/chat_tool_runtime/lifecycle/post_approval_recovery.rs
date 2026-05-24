use super::interrupted_graph::mark_inflight_execution_interrupted;
use super::recovery_prompt::append_recovery_assistant_message_if_missing;
use super::{now_unix_ms_i64, PersistedInFlightExecutionContext};
use crate::modules::desktop_runtime::runtime::{
    load_execution_graph_snapshot, persist_execution_graph_runtime_context,
    persist_execution_graph_snapshot,
};

pub(super) async fn recover_resuming_after_approval_runtime_context(
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
    let message = "The previous run was interrupted while continuing after approval. Confirm the restored state before retrying or continuing.";
    mark_inflight_execution_interrupted(
        &mut execution_graph,
        persisted.current_call_id.as_deref(),
        message,
    );
    persist_execution_graph_snapshot(
        store,
        &execution_graph,
        persisted.session_id.as_str(),
        "desktop_local_chat_resuming_after_approval_interrupted",
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
        "resuming_after_approval",
        message,
        &["continue", "retry", "abandon"],
    )
    .await?;
    persisted.last_error = Some(message.to_string());
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

pub(super) async fn recover_resume_failed_runtime_context(
    store: &crate::modules::mcp::store::McpStore,
    execution_id: &str,
    persisted: &mut PersistedInFlightExecutionContext,
) -> Result<(), String> {
    if persisted.recovery_notice_emitted_at_unix_ms.is_some() {
        return Ok(());
    }
    let Some(execution_graph) = load_execution_graph_snapshot(store, execution_id)
        .await
        .map_err(|err| err.to_string())?
    else {
        return Ok(());
    };
    append_recovery_assistant_message_if_missing(
        store,
        persisted.session_id.as_str(),
        &execution_graph,
        execution_id,
        "resume_failed",
        persisted
            .last_error
            .as_deref()
            .unwrap_or("The previous local chat could not resume after approval."),
        &["retry", "abandon"],
    )
    .await?;
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
