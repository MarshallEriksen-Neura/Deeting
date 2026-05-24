use super::approval_gate_recovery::recover_waiting_approval_runtime_context;
use super::delegated_workflow_recovery::recover_delegated_workflow_runtime_context;
use super::post_approval_recovery::{
    recover_resume_failed_runtime_context, recover_resuming_after_approval_runtime_context,
};
use super::tool_running_recovery::recover_tool_running_runtime_context;
use super::{persistable_inflight_context_from_value, InFlightExecutionStage};
use crate::modules::desktop_runtime::runtime::list_execution_graph_runtime_contexts;
use crate::state::AppState;
use tauri::AppHandle;

pub(crate) async fn recover_inflight_local_execution_state(
    _app: &AppHandle,
    app_state: &AppState,
) -> Result<(), String> {
    let store = app_state.mcp.store.as_ref();
    let rows = list_execution_graph_runtime_contexts(store)
        .await
        .map_err(|err| err.to_string())?;

    for row in rows {
        let Some(mut persisted) = persistable_inflight_context_from_value(&row.context) else {
            continue;
        };
        let Some(execution_id) = persisted
            .execution_graph_execution_id
            .clone()
            .or_else(|| Some(row.execution_id.clone()))
        else {
            continue;
        };

        match persisted.stage {
            InFlightExecutionStage::WaitingApproval => {
                recover_waiting_approval_runtime_context(store, execution_id.as_str(), &persisted)
                    .await?;
            }
            InFlightExecutionStage::ResumingAfterApproval => {
                recover_resuming_after_approval_runtime_context(
                    store,
                    execution_id.as_str(),
                    &mut persisted,
                )
                .await?;
            }
            InFlightExecutionStage::ResumeFailed => {
                recover_resume_failed_runtime_context(
                    store,
                    execution_id.as_str(),
                    &mut persisted,
                )
                .await?;
            }
            InFlightExecutionStage::ToolRunning => {
                recover_tool_running_runtime_context(store, execution_id.as_str(), &mut persisted)
                    .await?;
            }
            InFlightExecutionStage::DelegatedWorkflowRunning => {
                recover_delegated_workflow_runtime_context(
                    _app,
                    app_state,
                    execution_id.as_str(),
                    &mut persisted,
                )
                .await?;
            }
            InFlightExecutionStage::Interrupted => {}
        }
    }

    Ok(())
}
