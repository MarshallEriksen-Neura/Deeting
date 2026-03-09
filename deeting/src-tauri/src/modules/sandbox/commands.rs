use tauri::State;

use crate::modules::sandbox::types::{SandboxInstallGuide, SandboxReadinessReport};
use crate::state::AppState;

#[tauri::command]
pub async fn get_local_sandbox_status(
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    Ok(state.sandbox.manager.status_report().await)
}

#[tauri::command]
pub async fn prepare_local_sandbox(
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    state
        .sandbox
        .manager
        .prepare()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn repair_local_sandbox(
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    state
        .sandbox
        .manager
        .repair()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn install_local_sandbox_boxlite(
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    state
        .sandbox
        .manager
        .install_boxlite()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_local_sandbox_install_guide(
    state: State<'_, AppState>,
) -> Result<SandboxInstallGuide, String> {
    Ok(state.sandbox.manager.install_guide().await)
}
