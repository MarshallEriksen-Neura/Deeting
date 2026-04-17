use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::modules::sandbox::installer::BoxLiteInstallProgress;
use crate::modules::sandbox::types::{
    SandboxInstallGuide, SandboxReadinessReport, SandboxSnippetRunRequest,
    SandboxSnippetRunResponse,
};
use crate::state::AppState;

const BOXLITE_INSTALL_EVENT: &str = "sandbox://boxlite-install";

fn to_command_error(err: crate::modules::sandbox::error::SandboxError) -> String {
    err.user_message()
}

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
        .map_err(to_command_error)
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
        .map_err(to_command_error)
}

#[tauri::command]
pub async fn rebuild_local_sandbox_runtime(
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    state
        .sandbox
        .manager
        .rebuild_runtime()
        .await
        .map_err(to_command_error)
}

#[tauri::command]
pub async fn install_local_sandbox_boxlite(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    let app_for_reporter = app.clone();
    let reporter: Arc<dyn Fn(BoxLiteInstallProgress) + Send + Sync> =
        Arc::new(move |progress: BoxLiteInstallProgress| {
            if let Err(err) = app_for_reporter.emit(BOXLITE_INSTALL_EVENT, progress) {
                log::warn!("failed to emit BoxLite install progress: {err}");
            }
        });
    state
        .sandbox
        .manager
        .install_boxlite(Some(reporter))
        .await
        .map_err(to_command_error)
}

#[tauri::command]
pub async fn get_local_sandbox_install_guide(
    state: State<'_, AppState>,
) -> Result<SandboxInstallGuide, String> {
    Ok(state.sandbox.manager.install_guide().await)
}

#[tauri::command]
pub async fn run_local_sandbox_code_snippet(
    state: State<'_, AppState>,
    payload: SandboxSnippetRunRequest,
) -> Result<SandboxSnippetRunResponse, String> {
    Ok(state
        .sandbox
        .manager
        .run_local_code_snippet(
            payload.session_id.as_str(),
            payload.language,
            payload.code.as_str(),
            payload.execution_timeout_secs,
        )
        .await)
}
