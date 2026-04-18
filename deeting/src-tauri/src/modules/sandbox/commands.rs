use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::modules::desktop_config::network::resolve_desktop_network_proxy_settings;
use crate::modules::sandbox::installer::BoxLiteInstallProgress;
use crate::modules::sandbox::provisioner::PrepareProgress;
use crate::modules::sandbox::types::{
    SandboxInstallGuide, SandboxReadinessReport, SandboxSnippetRunRequest,
    SandboxSnippetRunResponse,
};
use crate::state::AppState;

const BOXLITE_INSTALL_EVENT: &str = "sandbox://boxlite-install";
const BOXLITE_PREPARE_EVENT: &str = "sandbox://boxlite-prepare";

fn to_command_error(err: crate::modules::sandbox::error::SandboxError) -> String {
    err.user_message()
}

async fn resolve_sandbox_proxy_settings(
    state: &AppState,
) -> Result<crate::modules::desktop_config::network::DesktopNetworkProxySettings, String> {
    resolve_desktop_network_proxy_settings(state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_local_sandbox_status(
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    Ok(state.sandbox.manager.status_report().await)
}

fn build_prepare_reporter(app: &AppHandle) -> Arc<dyn Fn(PrepareProgress) + Send + Sync> {
    let app = app.clone();
    Arc::new(move |progress: PrepareProgress| {
        if let Err(err) = app.emit(BOXLITE_PREPARE_EVENT, progress) {
            log::warn!("failed to emit BoxLite prepare progress: {err}");
        }
    })
}

#[tauri::command]
pub async fn prepare_local_sandbox(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    let proxy_settings = resolve_sandbox_proxy_settings(&state).await?;
    let reporter = build_prepare_reporter(&app);
    state
        .sandbox
        .manager
        .prepare_with_proxy_settings_and_progress(Some(&proxy_settings), Some(&reporter))
        .await
        .map_err(to_command_error)
}

#[tauri::command]
pub async fn repair_local_sandbox(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    let proxy_settings = resolve_sandbox_proxy_settings(&state).await?;
    let reporter = build_prepare_reporter(&app);
    state
        .sandbox
        .manager
        .repair_with_proxy_settings_and_progress(Some(&proxy_settings), Some(&reporter))
        .await
        .map_err(to_command_error)
}

#[tauri::command]
pub async fn rebuild_local_sandbox_runtime(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    let proxy_settings = resolve_sandbox_proxy_settings(&state).await?;
    let reporter = build_prepare_reporter(&app);
    state
        .sandbox
        .manager
        .rebuild_runtime_with_proxy_settings_and_progress(Some(&proxy_settings), Some(&reporter))
        .await
        .map_err(to_command_error)
}

#[tauri::command]
pub async fn install_local_sandbox_boxlite(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    let proxy_settings = resolve_sandbox_proxy_settings(&state).await?;
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
        .install_boxlite_with_proxy_settings(Some(reporter), Some(&proxy_settings))
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
