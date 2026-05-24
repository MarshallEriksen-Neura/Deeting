use super::delegated_workflow_missing_run::mark_delegated_workflow_runtime_interrupted_without_run;
use super::delegated_workflow_notice::workflow_recovery_notice_text;
use super::recovery_prompt::append_recovery_assistant_message_if_missing;
use super::resume_delegated_runtime_after_workflow_event;
use super::{clear_execution_graph_runtime_context, now_unix_ms_i64, InFlightExecutionStage};
use crate::modules::desktop_runtime::runtime::persist_execution_graph_runtime_context;
use crate::state::AppState;
use tauri::AppHandle;

pub(super) async fn recover_delegated_workflow_runtime_context(
    app: &AppHandle,
    app_state: &AppState,
    execution_id: &str,
    persisted: &mut super::PersistedInFlightExecutionContext,
) -> Result<(), String> {
    let store = app_state.mcp.store.as_ref();

    if persisted.recovery_notice_emitted_at_unix_ms.is_some() {
        return Ok(());
    }
    let workflow_run_id = persisted
        .delegation
        .as_ref()
        .map(|delegation| delegation.delegated_run_id.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(workflow_run_id) = workflow_run_id else {
        mark_delegated_workflow_runtime_interrupted_without_run(store, execution_id, persisted)
            .await?;
        return Ok(());
    };
    let detail =
        crate::modules::workflow::service::get_workflow_run_status(app_state, workflow_run_id)
            .await?;
    if detail.run.status == crate::modules::workflow::types::WorkflowRunStatus::Completed {
        if let Ok(Some(_)) = resume_delegated_runtime_after_workflow_event(
            app,
            app_state,
            execution_id,
            workflow_run_id,
            &format!(
                "workflow:{}:completed:{}",
                workflow_run_id, detail.run.updated_at
            ),
        )
        .await
        {
            return Ok(());
        }
    }
    let workflow_text = workflow_recovery_notice_text(workflow_run_id, &detail);
    append_recovery_assistant_message_if_missing(
        store,
        persisted.session_id.as_str(),
        &serde_json::json!({
            "execution_id": execution_id,
            "metadata": {
                "status": detail.run.status.as_str(),
                "workflow_run_id": workflow_run_id,
            },
            "nodes": [],
            "events": [],
        }),
        execution_id,
        "delegated_workflow_running",
        workflow_text.as_str(),
        &["retry", "abandon"],
    )
    .await?;
    persisted.recovery_notice_emitted_at_unix_ms = Some(now_unix_ms_i64());
    if detail.run.status == crate::modules::workflow::types::WorkflowRunStatus::Running {
        persisted.stage = InFlightExecutionStage::Interrupted;
        persist_execution_graph_runtime_context(
            store,
            execution_id,
            &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
        )
        .await
        .map_err(|err| err.to_string())?;
    } else {
        clear_execution_graph_runtime_context(store, Some(execution_id)).await;
    }
    Ok(())
}
