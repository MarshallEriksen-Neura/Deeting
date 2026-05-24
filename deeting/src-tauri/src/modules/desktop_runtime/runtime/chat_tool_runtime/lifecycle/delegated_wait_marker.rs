use super::{
    now_unix_ms_i64, persistable_inflight_context_from_value, InFlightExecutionStage,
    PersistedInFlightExecutionContext,
};
use crate::modules::desktop_runtime::runtime::{
    load_execution_graph_runtime_context, persist_execution_graph_runtime_context,
};

#[cfg_attr(not(test), allow(dead_code))]
pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn mark_delegated_wait_event_consumed(
    persisted: &mut PersistedInFlightExecutionContext,
    delegated_run_id: &str,
    event_id: &str,
) -> Result<bool, String> {
    if persisted.stage != InFlightExecutionStage::DelegatedWorkflowRunning {
        let stage = serde_json::to_value(&persisted.stage)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_else(|| "unknown".to_string());
        return Err(format!(
            "expected delegated_workflow_running stage, got {stage}"
        ));
    }

    let normalized_run_id = delegated_run_id.trim();
    if normalized_run_id.is_empty() {
        return Err("delegated_run_id is required".to_string());
    }

    let normalized_event_id = event_id.trim();
    if normalized_event_id.is_empty() {
        return Err("event_id is required".to_string());
    }

    let expected_run_id = persisted
        .delegation
        .as_ref()
        .ok_or_else(|| "delegated runtime context is missing delegation".to_string())?
        .delegated_run_id
        .trim();
    let expected_run_id = (!expected_run_id.is_empty())
        .then_some(expected_run_id)
        .ok_or_else(|| "delegated runtime context is missing delegated_run_id".to_string())?;

    if expected_run_id != normalized_run_id {
        return Err(format!(
            "delegated_run_id mismatch: expected '{}', got '{}'",
            expected_run_id, normalized_run_id
        ));
    }

    let delegation = persisted
        .delegation
        .as_mut()
        .expect("delegation should exist after validation");

    if delegation
        .consumed_event_ids
        .iter()
        .any(|consumed| consumed.trim() == normalized_event_id)
    {
        return Ok(false);
    }

    delegation
        .consumed_event_ids
        .push(normalized_event_id.to_string());
    persisted.last_heartbeat_at_unix_ms = now_unix_ms_i64();
    Ok(true)
}

#[allow(dead_code)]
pub(crate) async fn consume_delegated_wait_event_marker(
    store: &crate::modules::mcp::store::McpStore,
    execution_id: &str,
    delegated_run_id: &str,
    event_id: &str,
) -> Result<serde_json::Value, String> {
    let normalized_execution_id = execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Err("execution_id is required".to_string());
    }

    let context = load_execution_graph_runtime_context(store, normalized_execution_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| {
            format!(
                "delegated runtime context not found for execution_id {normalized_execution_id}"
            )
        })?;
    let mut persisted = persistable_inflight_context_from_value(&context)
        .ok_or_else(|| "delegated runtime context could not be parsed".to_string())?;

    let consumed = mark_delegated_wait_event_consumed(&mut persisted, delegated_run_id, event_id)?;
    if consumed {
        persist_execution_graph_runtime_context(
            store,
            normalized_execution_id,
            &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
        )
        .await
        .map_err(|err| err.to_string())?;
    }

    Ok(serde_json::json!({
        "status": if consumed { "consumed" } else { "duplicate" },
        "execution_graph_execution_id": normalized_execution_id,
        "delegated_run_id": delegated_run_id.trim(),
        "event_id": event_id.trim(),
        "stage": persisted.stage,
    }))
}
