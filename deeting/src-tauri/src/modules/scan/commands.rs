use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::state::AppState;

use super::actions::run_scan_review_action as execute_scan_review_action;
use super::service::{scan_directory as run_scan_directory, scan_file as run_scan_file, AssetIndexSnapshot};
use super::types::{ScanReviewActionRequest, ScanReviewActionResult, ScanRun};

#[tauri::command]
pub async fn scan_directory(
    app: AppHandle,
    app_state: State<'_, AppState>,
    path: Option<String>,
) -> Result<ScanRun, String> {
    let target = resolve_scan_directory_target(&app, path)?;
    let installs = app_state
        .mcp
        .store
        .list_local_skill_installs()
        .await
        .map_err(to_string)?;
    let assets = app_state
        .memory
        .service
        .list_assets_catalog()
        .await
        .map_err(to_string)?
        .iter()
        .filter_map(AssetIndexSnapshot::from_catalog_value)
        .collect::<Vec<_>>();

    run_scan_directory(&target, &installs, &assets)
}

#[tauri::command]
pub async fn scan_file(
    app_state: State<'_, AppState>,
    path: String,
) -> Result<ScanRun, String> {
    let normalized_path = path.trim();
    if normalized_path.is_empty() {
        return Err("path is required".to_string());
    }

    let installs = app_state
        .mcp
        .store
        .list_local_skill_installs()
        .await
        .map_err(to_string)?;
    let assets = app_state
        .memory
        .service
        .list_assets_catalog()
        .await
        .map_err(to_string)?
        .iter()
        .filter_map(AssetIndexSnapshot::from_catalog_value)
        .collect::<Vec<_>>();

    run_scan_file(&PathBuf::from(normalized_path), &installs, &assets)
}

#[tauri::command]
pub async fn run_scan_review_action(
    app_state: State<'_, AppState>,
    request: ScanReviewActionRequest,
) -> Result<ScanReviewActionResult, String> {
    execute_scan_review_action(app_state.inner(), request).await
}

fn resolve_scan_directory_target(app: &AppHandle, path: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = path.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(path));
    }

    let skills_dir = app.path().app_data_dir().map_err(to_string)?.join("skills");
    if !skills_dir.exists() {
        std::fs::create_dir_all(&skills_dir).map_err(to_string)?;
    }
    Ok(skills_dir)
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}