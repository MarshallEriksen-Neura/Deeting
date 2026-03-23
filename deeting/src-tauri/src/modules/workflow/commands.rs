use tauri::{AppHandle, Manager, State};

use crate::state::AppState;

use super::service;
use super::store;
use super::types::{
    ApproveWorkflowRequest, CompileResult, CreateWorkflowRunRequest,
    EditRemainingPhasesRequest, GenerateProposalRequest, RegenerateProposalRequest,
    RerunPhaseRequest, UpdateProposalRequest, WorkflowRun, WorkflowRunDetail,
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

#[tauri::command]
pub async fn generate_workflow_proposal(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: GenerateProposalRequest,
) -> Result<WorkflowRun, String> {
    service::generate_proposal_workflow(
        state.inner(),
        state.mcp.store.as_ref(),
        app.path().app_data_dir().ok(),
        payload,
    )
    .await
}

#[tauri::command]
pub async fn update_workflow_proposal(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: UpdateProposalRequest,
) -> Result<WorkflowRun, String> {
    service::update_proposal_workflow(
        state.mcp.store.as_ref(),
        app.path().app_data_dir().ok(),
        payload,
    )
    .await
}

#[tauri::command]
pub async fn compile_workflow_proposal(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<CompileResult, String> {
    service::compile_current_proposal(
        state.mcp.store.as_ref(),
        app.path().app_data_dir().ok(),
        &run_id,
    )
    .await
}

#[tauri::command]
pub async fn regenerate_workflow_proposal(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: RegenerateProposalRequest,
) -> Result<WorkflowRun, String> {
    service::regenerate_proposal_workflow(
        state.inner(),
        state.mcp.store.as_ref(),
        app.path().app_data_dir().ok(),
        payload,
    )
    .await
}

#[tauri::command]
pub async fn start_workflow_run(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<WorkflowRun, String> {
    service::start_workflow_run(&app, state.inner(), &run_id).await
}

#[tauri::command]
pub async fn get_workflow_run_status(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<WorkflowRunDetail, String> {
    service::get_workflow_run_status(state.inner(), &run_id).await
}

#[tauri::command]
pub async fn approve_workflow(
    app: AppHandle,
    state: State<'_, AppState>,
    req: ApproveWorkflowRequest,
) -> Result<WorkflowRun, String> {
    service::approve_workflow(&app, state.inner(), req).await
}

#[tauri::command]
pub async fn edit_remaining_phases(
    state: State<'_, AppState>,
    req: EditRemainingPhasesRequest,
) -> Result<WorkflowRun, String> {
    service::edit_remaining_phases(state.inner(), req).await
}

#[tauri::command]
pub async fn resume_workflow(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<WorkflowRun, String> {
    service::resume_workflow(&app, state.inner(), &run_id).await
}

#[tauri::command]
pub async fn rerun_phase(
    state: State<'_, AppState>,
    req: RerunPhaseRequest,
) -> Result<WorkflowRun, String> {
    service::rerun_phase(state.inner(), req).await
}
