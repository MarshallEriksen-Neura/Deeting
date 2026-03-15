use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::modules::mcp::commands::skill_registry_impl::resolve_local_skill_scan_targets;
use crate::state::AppState;

use super::actions::{
    run_scan_review_action as execute_scan_review_action,
    run_scan_review_actions as execute_scan_review_actions,
};
use super::service::{
    scan_directory as run_scan_directory, scan_file as run_scan_file, AssetIndexSnapshot,
};
use super::types::{
    ScanReviewActionRequest, ScanReviewActionResult, ScanReviewBatchRequest, ScanReviewBatchResult,
    ScanRun,
};

#[tauri::command]
pub async fn scan_directory(
    app: AppHandle,
    app_state: State<'_, AppState>,
    path: Option<String>,
) -> Result<ScanRun, String> {
    let targets = resolve_scan_directory_targets(&app, path)?;
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

    let mut runs = Vec::new();
    for target in targets {
        if !target.exists() {
            continue;
        }
        runs.push(run_scan_directory(&target, &installs, &assets)?);
    }

    merge_scan_runs(runs)
}

#[tauri::command]
pub async fn scan_file(app_state: State<'_, AppState>, path: String) -> Result<ScanRun, String> {
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

#[tauri::command]
pub async fn run_scan_review_actions(
    app_state: State<'_, AppState>,
    request: ScanReviewBatchRequest,
) -> Result<ScanReviewBatchResult, String> {
    execute_scan_review_actions(app_state.inner(), request).await
}

fn resolve_scan_directory_targets(
    app: &AppHandle,
    path: Option<String>,
) -> Result<Vec<PathBuf>, String> {
    if let Some(path) = path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok(vec![PathBuf::from(path)]);
    }

    let targets = resolve_local_skill_scan_targets(app)?
        .into_iter()
        .map(|(path, _source_prefix)| path)
        .collect::<Vec<_>>();
    Ok(targets)
}

fn merge_scan_runs(mut runs: Vec<ScanRun>) -> Result<ScanRun, String> {
    let mut merged = runs
        .drain(..1)
        .next()
        .ok_or_else(|| "no scan targets available".to_string())?;

    if runs.is_empty() {
        return Ok(merged);
    }

    let mut target_paths = vec![merged.target_path.clone()];
    for run in runs {
        target_paths.push(run.target_path.clone());
        merged.finished_at = run.finished_at;
        merged.summary.document_count += run.summary.document_count;
        merged.summary.finding_count += run.summary.finding_count;
        merged.summary.warning_count += run.summary.warning_count;
        merged.summary.error_count += run.summary.error_count;
        merged.summary.skill_bundle_count += run.summary.skill_bundle_count;
        merged.summary.index_missing_count += run.summary.index_missing_count;
        merged.summary.install_missing_count += run.summary.install_missing_count;
        merged.summary.security_warning_count += run.summary.security_warning_count;
        merged.summary.high_risk_script_count += run.summary.high_risk_script_count;
        merged.summary.missing_skill_doc_count += run.summary.missing_skill_doc_count;
        merged.documents.extend(run.documents);
        merged.findings.extend(run.findings);
    }

    merged.target_path = target_paths.join(", ");
    Ok(merged)
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
