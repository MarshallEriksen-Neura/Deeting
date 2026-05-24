use super::approval_recovery::advance_local_chat_execution_from_graph_state;
use super::recovery_prompt::resolve_recovery_prompt_message;
use super::{
    clear_execution_graph_runtime_context, load_suspended_chat_tool_execution_for_resume,
    persistable_inflight_context_from_value, InFlightExecutionStage,
};
use crate::modules::desktop_runtime::runtime::{
    load_execution_graph_runtime_context, load_execution_graph_snapshot,
};
use crate::state::AppState;
use tauri::AppHandle;

pub(crate) async fn recover_local_chat_execution_from_action(
    app: &AppHandle,
    app_state: &AppState,
    execution_graph_execution_id: &str,
    action: &str,
) -> Result<serde_json::Value, String> {
    let normalized_execution_id = execution_graph_execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Err("execution_graph_execution_id is required".to_string());
    }

    let normalized_action = action.trim().to_ascii_lowercase();
    if normalized_action.is_empty() {
        return Err("action is required".to_string());
    }

    let Some(runtime_context_value) =
        load_execution_graph_runtime_context(app_state.mcp.store.as_ref(), normalized_execution_id)
            .await
            .map_err(|err| err.to_string())?
    else {
        return Err("local chat recovery context not found".to_string());
    };
    let Some(persisted) = persistable_inflight_context_from_value(&runtime_context_value) else {
        return Err("local chat recovery context is invalid".to_string());
    };

    match normalized_action.as_str() {
        "abandon" => {
            clear_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                Some(normalized_execution_id),
            )
            .await;
            resolve_recovery_prompt_message(
                app_state.mcp.store.as_ref(),
                persisted.session_id.as_str(),
                normalized_execution_id,
                "abandon",
            )
            .await?;
            let execution_graph = load_execution_graph_snapshot(
                app_state.mcp.store.as_ref(),
                normalized_execution_id,
            )
            .await
            .map_err(|err| err.to_string())?;
            return Ok(serde_json::json!({
                "status": "LOCAL_CHAT_RECOVERY_ABANDONED",
                "execution_graph_execution_id": normalized_execution_id,
                "execution_graph": execution_graph,
            }));
        }
        "continue" | "retry" => {}
        _ => {
            return Err(format!(
                "unsupported local chat recovery action: {normalized_action}"
            ))
        }
    }

    if persisted.stage != InFlightExecutionStage::ResumingAfterApproval
        && persisted.stage != InFlightExecutionStage::ResumeFailed
    {
        return Err(format!(
            "local chat recovery action '{}' is not supported for stage '{}'",
            normalized_action,
            serde_json::to_string(&persisted.stage).unwrap_or_else(|_| "\"unknown\"".to_string())
        ));
    }

    let Some(suspended) =
        load_suspended_chat_tool_execution_for_resume(app_state, "", Some(normalized_execution_id))
            .await?
    else {
        return Err("local chat suspended execution not found".to_string());
    };

    let payload = advance_local_chat_execution_from_graph_state(
        app,
        app_state,
        suspended,
        None,
        None,
        &serde_json::Value::Null,
    )
    .await?;

    let is_terminal_success = payload
        .get("status")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|status| status == "LOCAL_CHAT_RESUMED");
    if is_terminal_success {
        resolve_recovery_prompt_message(
            app_state.mcp.store.as_ref(),
            persisted.session_id.as_str(),
            normalized_execution_id,
            normalized_action.as_str(),
        )
        .await?;
    }

    Ok(payload)
}
