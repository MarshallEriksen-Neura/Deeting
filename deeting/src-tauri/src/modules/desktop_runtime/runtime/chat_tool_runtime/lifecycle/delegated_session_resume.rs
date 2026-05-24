use super::super::continue_local_chat_complete_with_tools;
use super::{
    attach_execution_graph_to_response, clear_execution_graph_runtime_context,
    mark_delegated_wait_event_consumed, persist_resumed_local_chat_assistant_message,
    persistable_inflight_context_from_value, runtime_state_from_persisted_context,
};
use crate::modules::desktop_runtime::runtime::execution_plane::DelegatedExecutionSession;
use crate::modules::desktop_runtime::runtime::{
    load_execution_graph_runtime_context, persist_execution_graph_runtime_context,
};
use crate::state::AppState;
use tauri::AppHandle;

pub(super) async fn resume_delegated_runtime_with_session(
    app: &AppHandle,
    app_state: &AppState,
    execution_graph_execution_id: &str,
    delegated_run_id: &str,
    event_id: &str,
    delegated_execution: DelegatedExecutionSession,
) -> Result<Option<serde_json::Value>, String> {
    let normalized_execution_id = execution_graph_execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Err("execution_graph_execution_id is required".to_string());
    }

    let context_value =
        load_execution_graph_runtime_context(app_state.mcp.store.as_ref(), normalized_execution_id)
            .await
            .map_err(|err| err.to_string())?
            .ok_or_else(|| {
                format!(
                    "delegated runtime context not found for execution_id {}",
                    normalized_execution_id
                )
            })?;
    let mut persisted = persistable_inflight_context_from_value(&context_value)
        .ok_or_else(|| "delegated runtime context could not be parsed".to_string())?;

    let consumed = mark_delegated_wait_event_consumed(&mut persisted, delegated_run_id, event_id)?;
    let chat_runtime = persisted
        .chat_runtime
        .clone()
        .ok_or_else(|| "delegated runtime context is missing chat_runtime".to_string())?;

    if !consumed {
        return Ok(None);
    }

    persist_execution_graph_runtime_context(
        app_state.mcp.store.as_ref(),
        normalized_execution_id,
        &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
    )
    .await
    .map_err(|err| err.to_string())?;

    let mut state = runtime_state_from_persisted_context(chat_runtime);
    state
        .orchestrated_messages
        .extend(delegated_execution.feedback_messages.clone());

    let session_id = state.session_id.clone();
    let model_connection = state.model_connection.clone();
    let execution_policy = state.execution_policy.clone();
    match continue_local_chat_complete_with_tools(app, app_state, state).await {
        Ok(mut output) => {
            attach_execution_graph_to_response(
                &mut output.response,
                &session_id,
                &execution_policy,
                Some(normalized_execution_id),
                true,
            );
            if let Err(err) = persist_resumed_local_chat_assistant_message(
                app_state,
                &session_id,
                &model_connection,
                &output.response,
            )
            .await
            {
                log::warn!("{err}");
            }
            clear_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                Some(normalized_execution_id),
            )
            .await;
            Ok(Some(output.response))
        }
        Err(err) => {
            persisted.last_error = Some(err.clone());
            if let Some(delegation) = persisted.delegation.as_mut() {
                delegation.last_status = Some("failed".to_string());
            }
            persist_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                normalized_execution_id,
                &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
            )
            .await
            .map_err(|persist_err| persist_err.to_string())?;
            Err(err)
        }
    }
}
