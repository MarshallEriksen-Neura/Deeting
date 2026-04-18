use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::modules::desktop_config::{
    parse_sandbox_image_registries, DESKTOP_SANDBOX_IMAGE_REGISTRIES_CONFIG_KEY,
};
use crate::modules::sandbox::installer::BoxLiteInstallProgress;
use crate::modules::sandbox::prepare_config::resolve_sandbox_prepare_config;
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

async fn resolve_sandbox_image_registries(state: &AppState) -> Result<Vec<String>, String> {
    let raw = state
        .mcp
        .store
        .get_desktop_config(DESKTOP_SANDBOX_IMAGE_REGISTRIES_CONFIG_KEY)
        .await
        .map_err(|err| err.to_string())?;
    Ok(parse_sandbox_image_registries(raw.as_deref()))
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
    let prepare_config = resolve_sandbox_prepare_config(&state).await?;
    let reporter = build_prepare_reporter(&app);
    state
        .sandbox
        .manager
        .prepare_with_proxy_settings_and_progress(
            prepare_config.proxy_settings.as_ref(),
            &prepare_config.image_registries,
            Some(&reporter),
        )
        .await
        .map_err(to_command_error)
}

#[tauri::command]
pub async fn repair_local_sandbox(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    let prepare_config = resolve_sandbox_prepare_config(&state).await?;
    let reporter = build_prepare_reporter(&app);
    state
        .sandbox
        .manager
        .repair_with_proxy_settings_and_progress(
            prepare_config.proxy_settings.as_ref(),
            &prepare_config.image_registries,
            Some(&reporter),
        )
        .await
        .map_err(to_command_error)
}

#[tauri::command]
pub async fn rebuild_local_sandbox_runtime(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    let prepare_config = resolve_sandbox_prepare_config(&state).await?;
    let reporter = build_prepare_reporter(&app);
    state
        .sandbox
        .manager
        .rebuild_runtime_with_proxy_settings_and_progress(
            prepare_config.proxy_settings.as_ref(),
            &prepare_config.image_registries,
            Some(&reporter),
        )
        .await
        .map_err(to_command_error)
}

#[tauri::command]
pub async fn install_local_sandbox_boxlite(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SandboxReadinessReport, String> {
    let prepare_config = resolve_sandbox_prepare_config(&state).await?;
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
        .install_boxlite_with_proxy_settings(
            Some(reporter),
            prepare_config.proxy_settings.as_ref(),
            &prepare_config.image_registries,
        )
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
    let prepare_config = resolve_sandbox_prepare_config(&state).await?;
    Ok(state
        .sandbox
        .manager
        .run_local_code_snippet_with_prepare_config(
            payload.session_id.as_str(),
            payload.language,
            payload.code.as_str(),
            payload.execution_timeout_secs,
            Some(&prepare_config),
        )
        .await)
}

#[tauri::command]
pub async fn get_local_sandbox_image_registries(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    resolve_sandbox_image_registries(&state).await
}

#[tauri::command]
pub async fn set_local_sandbox_image_registries(
    state: State<'_, AppState>,
    registries: Vec<String>,
) -> Result<Vec<String>, String> {
    // Normalize incoming list the same way we parse on read:
    // trim + dedupe (case-insensitive) + preserve order.
    let joined = registries.join("\n");
    let normalized = parse_sandbox_image_registries(Some(joined.as_str()));
    let serialized = normalized.join("\n");
    state
        .mcp
        .store
        .set_desktop_config(DESKTOP_SANDBOX_IMAGE_REGISTRIES_CONFIG_KEY, &serialized)
        .await
        .map_err(|err| err.to_string())?;
    Ok(normalized)
}
