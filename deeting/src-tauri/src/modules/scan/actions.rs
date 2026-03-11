use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::modules::mcp::commands::skill_registry_impl::{
    reindex_local_skill_bundle_asset, resolve_local_skill_definition,
};
use crate::state::AppState;

use super::types::{
    ScanReviewActionRequest, ScanReviewActionResult, ScanReviewBatchRequest, ScanReviewBatchResult,
};

pub async fn run_scan_review_action(
    app_state: &AppState,
    request: ScanReviewActionRequest,
) -> Result<ScanReviewActionResult, String> {
    let request = normalize_request(request);
    match request.kind.trim() {
        "register_bundle" => register_bundle(app_state, request).await,
        "reindex_bundle" => reindex_bundle(app_state, request).await,
        "cleanup_missing_install" => cleanup_missing_install(app_state, request).await,
        other => Err(format!("unsupported scan review action: {}", other)),
    }
}

pub async fn run_scan_review_actions(
    app_state: &AppState,
    request: ScanReviewBatchRequest,
) -> Result<ScanReviewBatchResult, String> {
    let total = request.actions.len();
    let mut applied = 0usize;
    let mut failed = 0usize;
    let mut skipped = 0usize;
    let mut deduped = HashSet::new();
    let mut results = Vec::with_capacity(total);

    for raw_action in request.actions {
        let action = normalize_request(raw_action);
        if !deduped.insert(action.clone()) {
            skipped += 1;
            results.push(ScanReviewActionResult {
                kind: action.kind,
                status: "skipped".to_string(),
                message: "Skipped duplicate scan review action".to_string(),
                bundle_id: action.bundle_id,
                path: action.path,
            });
            continue;
        }

        match run_scan_review_action(app_state, action.clone()).await {
            Ok(result) => {
                if result.status == "applied" {
                    applied += 1;
                } else {
                    skipped += 1;
                }
                results.push(result);
            }
            Err(error) => {
                failed += 1;
                results.push(ScanReviewActionResult {
                    kind: action.kind,
                    status: "failed".to_string(),
                    message: error,
                    bundle_id: action.bundle_id,
                    path: action.path,
                });
            }
        }
    }

    Ok(ScanReviewBatchResult {
        total,
        applied,
        failed,
        skipped,
        results,
    })
}

async fn register_bundle(
    app_state: &AppState,
    request: ScanReviewActionRequest,
) -> Result<ScanReviewActionResult, String> {
    let path = normalize_bundle_path(request.path.as_deref())?;
    let Some(skill_def) =
        resolve_local_skill_definition(&path, infer_source_prefix(&path), None, None)?
    else {
        return Err(format!(
            "bundle at {} is not a valid skill bundle",
            path.display()
        ));
    };

    if let Some(expected_skill_id) = request
        .bundle_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
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
    let _ = app_state
        .memory
        .service
        .delete_assets_by_package(&bundle_id)
        .await;
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
    let value = raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "path is required".to_string())?;
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
    if path
        .components()
        .any(|component| component.as_os_str() == OsStr::new("official-skills"))
    {
        "system_plugin"
    } else {
        "user_skill"
    }
}

fn normalize_request(request: ScanReviewActionRequest) -> ScanReviewActionRequest {
    ScanReviewActionRequest {
        kind: request.kind.trim().to_string(),
        bundle_id: normalize_optional_field(request.bundle_id),
        path: normalize_optional_field(request.path),
    }
}

fn normalize_optional_field(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
