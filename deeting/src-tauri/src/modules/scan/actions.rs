use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::modules::mcp::commands::skill_registry_impl::{
    reindex_local_skill_bundle_asset, resolve_local_skill_definition,
};
use crate::state::AppState;

use super::types::{ScanReviewActionRequest, ScanReviewActionResult};

pub async fn run_scan_review_action(
    app_state: &AppState,
    request: ScanReviewActionRequest,
) -> Result<ScanReviewActionResult, String> {
    match request.kind.trim() {
        "register_bundle" => register_bundle(app_state, request).await,
        "reindex_bundle" => reindex_bundle(app_state, request).await,
        "cleanup_missing_install" => cleanup_missing_install(app_state, request).await,
        other => Err(format!("unsupported scan review action: {}", other)),
    }
}

async fn register_bundle(
    app_state: &AppState,
    request: ScanReviewActionRequest,
) -> Result<ScanReviewActionResult, String> {
    let path = normalize_bundle_path(request.path.as_deref())?;
    let Some(skill_def) = resolve_local_skill_definition(&path, infer_source_prefix(&path), None, None)?
    else {
        return Err(format!("bundle at {} is not a valid skill bundle", path.display()));
    };

    if let Some(expected_skill_id) = request.bundle_id.as_deref().filter(|value| !value.trim().is_empty()) {
        if skill_def.skill_id != expected_skill_id.trim() {
            return Err(format!(
                "bundle id mismatch: expected {}, resolved {}",
                expected_skill_id, skill_def.skill_id
            ));
        }
    }

    let runtime = skill_def.runtime_values.join(",");
    let install_path = path.to_string_lossy().to_string();
    app_state
        .mcp
        .store
        .upsert_local_skill_install(
            &skill_def.skill_id,
            skill_def.version.as_deref(),
            Some(&runtime),
            &skill_def.manifest_json,
            &install_path,
        )
        .await
        .map_err(to_string)?;
    reindex_local_skill_bundle_asset(app_state, &skill_def.skill_id).await?;

    Ok(ScanReviewActionResult {
        kind: "register_bundle".to_string(),
        status: "applied".to_string(),
        message: format!("Registered and indexed skill bundle {}", skill_def.skill_id),
        bundle_id: Some(skill_def.skill_id),
        path: Some(install_path),
    })
}

async fn reindex_bundle(
    app_state: &AppState,
    request: ScanReviewActionRequest,
) -> Result<ScanReviewActionResult, String> {
    let bundle_id = required_bundle_id(&request)?;
    reindex_local_skill_bundle_asset(app_state, &bundle_id).await?;
    Ok(ScanReviewActionResult {
        kind: "reindex_bundle".to_string(),
        status: "applied".to_string(),
        message: format!("Rebuilt local asset index for {}", bundle_id),
        bundle_id: Some(bundle_id),
        path: request.path,
    })
}

async fn cleanup_missing_install(
    app_state: &AppState,
    request: ScanReviewActionRequest,
) -> Result<ScanReviewActionResult, String> {
    let bundle_id = required_bundle_id(&request)?;
    let _ = app_state.memory.service.delete_assets_by_package(&bundle_id).await;
    app_state
        .mcp
        .store
        .delete_local_skill_install(&bundle_id)
        .await
        .map_err(to_string)?;
    Ok(ScanReviewActionResult {
        kind: "cleanup_missing_install".to_string(),
        status: "applied".to_string(),
        message: format!("Removed stale install record for {}", bundle_id),
        bundle_id: Some(bundle_id),
        path: request.path,
    })
}

fn normalize_bundle_path(raw: Option<&str>) -> Result<PathBuf, String> {
    let value = raw.map(str::trim).filter(|value| !value.is_empty()).ok_or_else(|| "path is required".to_string())?;
    let path = PathBuf::from(value);
    if path.is_dir() {
        return Ok(path);
    }
    if !path.exists() {
        return Err(format!("bundle path does not exist: {}", value));
    }
    path.parent()
        .filter(|parent| parent.exists())
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("bundle path does not exist: {}", value))
}

fn required_bundle_id(request: &ScanReviewActionRequest) -> Result<String, String> {
    request
        .bundle_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "bundle_id is required".to_string())
}

fn infer_source_prefix(path: &Path) -> &'static str {
    if path.components().any(|component| component.as_os_str() == OsStr::new("official-skills")) {
        "system_plugin"
    } else {
        "user_skill"
    }
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}