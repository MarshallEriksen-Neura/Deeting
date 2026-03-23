use tauri::State;

use crate::state::AppState;

use super::store;
use super::types::{
    CreateWorkflowRunRequest, WorkflowRun, WorkflowRunDetail,
};

#[tauri::command]
pub async fn list_workflow_runs(state: State<'_, AppState>) -> Result<Vec<WorkflowRun>, String> {
    store::list_workflow_runs(state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_workflow_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<WorkflowRun, String> {
    store::get_workflow_run(state.mcp.store.as_ref(), &run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "workflow run not found".to_string())
}

#[tauri::command]
pub async fn create_workflow_run(
    state: State<'_, AppState>,
    payload: CreateWorkflowRunRequest,
) -> Result<WorkflowRun, String> {
    store::create_workflow_run(state.mcp.store.as_ref(), payload)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_workflow_run_detail(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<WorkflowRunDetail, String> {
    let run = store::get_workflow_run(state.mcp.store.as_ref(), &run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "workflow run not found".to_string())?;
    let steps = store::list_workflow_step_runs_by_run(state.mcp.store.as_ref(), &run_id)
        .await
        .map_err(|err| err.to_string())?;
    let events = store::list_workflow_events_by_run(state.mcp.store.as_ref(), &run_id)
        .await
        .map_err(|err| err.to_string())?;

    Ok(WorkflowRunDetail { run, steps, events })
}
