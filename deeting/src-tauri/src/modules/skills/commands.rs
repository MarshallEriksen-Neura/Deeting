use std::collections::HashSet;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use crate::modules::skills::registry_impl::{
    LocalSkillRuntimeStatus, SkillInstallResult, UpdateLocalSkillRuntimeSettingsRequest,
};
use crate::state::AppState;

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn normalize_install_path_for_compare(path: &Path) -> String {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return canonical
            .to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_ascii_lowercase();
    }
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn normalized_path_is_within_root(path: &str, root: &str) -> bool {
    path == root
        || path
            .strip_prefix(root)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn discover_visible_skill_paths(
    scan_targets: &[(PathBuf, &'static str)],
) -> Result<HashSet<String>, String> {
    let mut visible = HashSet::new();
    for (dir_path, source_prefix) in scan_targets {
        if !dir_path.exists() {
            continue;
        }
        for entry in std::fs::read_dir(dir_path).map_err(to_string)? {
            let entry = entry.map_err(to_string)?;
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str() else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let skill_path = entry.path();
            if !skill_path.is_dir() {
                continue;
            }
            let resolved = crate::modules::skills::registry_impl::resolve_local_skill_definition(
                &skill_path,
                source_prefix,
                None,
                None,
            )
            .map_err(to_string)?;
            if resolved.is_some() {
                visible.insert(normalize_install_path_for_compare(&skill_path));
            }
        }
    }
    Ok(visible)
}

async fn prune_stale_local_skill_state(
    scan_targets: &[(PathBuf, &'static str)],
    app_state: &AppState,
) -> Result<usize, String> {
    let visible_paths = discover_visible_skill_paths(scan_targets)?;
    let normalized_roots = scan_targets
        .iter()
        .map(|(root, _)| normalize_install_path_for_compare(root))
        .collect::<Vec<_>>();
    let installs = app_state
        .mcp
        .store
        .list_local_skill_install_details()
        .await
        .map_err(to_string)?;

    let mut pruned = 0usize;
    for install in installs {
        let normalized_install_path =
            normalize_install_path_for_compare(Path::new(&install.install_path));
        if !normalized_roots
            .iter()
            .any(|root| normalized_path_is_within_root(&normalized_install_path, root))
        {
            continue;
        }
        if visible_paths.contains(&normalized_install_path) {
            continue;
        }

        log::info!(
            "register_local_skills_refresh: pruning stale local skill '{}' at {}",
            install.skill_id,
            install.install_path
        );
        app_state
            .mcp
            .store
            .delete_local_skill_install(&install.skill_id)
            .await
            .map_err(to_string)?;
        let _ = app_state
            .memory
            .service
            .delete_assets_by_package(&install.skill_id)
            .await;
        pruned += 1;
    }

    Ok(pruned)
}

pub(crate) async fn register_local_skills_inner(
    app: AppHandle,
    app_state: &AppState,
) -> Result<usize, String> {
    let purged =
        crate::modules::skills::registry_impl::purge_legacy_skill_tool_state(app_state).await?;
    if purged > 0 {
        log::info!(
            "register_local_skills_refresh: purged {} legacy skill-tool state entries before refresh",
            purged
        );
    }
    let scan_targets =
        crate::modules::skills::registry_scan::resolve_local_skill_scan_targets(&app)?;
    let pruned = prune_stale_local_skill_state(&scan_targets, app_state).await?;
    if pruned > 0 {
        log::info!(
            "register_local_skills_refresh: pruned {} stale local skill installs before refresh",
            pruned
        );
    }
    let sdk_dir = app
        .path()
        .resource_dir()
        .ok()
        .map(|p| p.join("deeting-sdk"))
        .filter(|p| p.exists())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .join("packages")
                .join("deeting-sdk")
        });
    let sdk_pythonpath = sdk_dir.to_string_lossy().to_string();
    crate::modules::skills::registry_scan::register_local_skills_from_scan_targets_inner(
        &scan_targets,
        &sdk_pythonpath,
        app_state.mcp.store.clone(),
        app_state.providers.clone(),
        app_state.memory.clone(),
        false,
    )
    .await
}

#[tauri::command]
pub async fn register_local_skills(
    app: AppHandle,
    app_state: State<'_, AppState>,
) -> Result<usize, String> {
    register_local_skills_inner(app, app_state.inner()).await
}

#[tauri::command]
pub async fn sync_official_skills_index(app_state: State<'_, AppState>) -> Result<usize, String> {
    let state = &app_state.mcp;
    let base_url = state.transport.cloud_base_url.read().await.clone();
    let url = format!(
        "{}/api/v1/plugin-market/?limit=100",
        base_url.trim_end_matches('/')
    );

    let response = state
        .transport
        .client
        .get(&url)
        .send()
        .await
        .map_err(to_string)?;
    if !response.status().is_success() {
        return Err("failed to fetch marketplace index".to_string());
    }

    let skills: Vec<serde_json::Value> = response.json().await.map_err(to_string)?;
    let count = skills.len();

    for skill in skills {
        let id = skill["id"].as_str().unwrap_or("").to_string();
        let name = skill["name"].as_str().unwrap_or("").to_string();
        let desc = skill["description"].as_str().unwrap_or("").to_string();

        let app_state_clone = app_state.inner().clone();
        tauri::async_runtime::spawn(async move {
            let text = format!("name: {}\ndescription: {}", name, desc);
            if let Ok(vector) = app_state_clone.providers.embedding.embed_text(&text).await {
                let _ = app_state_clone
                    .memory
                    .service
                    .upsert_asset(
                        id,
                        name,
                        desc,
                        "skill".to_string(),
                        "cloud_mirror".to_string(),
                        None,
                        vector,
                        Some(skill),
                    )
                    .await;
            }
        });
    }

    Ok(count)
}

#[tauri::command]
pub async fn enable_local_skill(
    state: State<'_, AppState>,
    skill_id: Option<String>,
    #[allow(non_snake_case)] skillId: Option<String>,
) -> Result<(), String> {
    let normalized_skill_id = skillId.or(skill_id).unwrap_or_default().trim().to_string();
    if normalized_skill_id.is_empty() {
        return Err("skillId is required".to_string());
    }

    let updated = state
        .mcp
        .store
        .enable_local_skills_by_ids(&[normalized_skill_id.clone()])
        .await
        .map_err(to_string)?;
    if updated <= 0 {
        return Err(format!(
            "local skill {} is not installed and cannot be enabled",
            normalized_skill_id
        ));
    }

    crate::modules::skills::registry_impl::reindex_local_skill_bundle_asset(
        state.inner(),
        &normalized_skill_id,
    )
    .await?;

    Ok(())
}

#[tauri::command]
pub async fn disable_local_skill(
    state: State<'_, AppState>,
    skill_id: Option<String>,
    #[allow(non_snake_case)] skillId: Option<String>,
) -> Result<(), String> {
    let normalized_skill_id = skillId.or(skill_id).unwrap_or_default().trim().to_string();
    if normalized_skill_id.is_empty() {
        return Err("skillId is required".to_string());
    }

    let updated = state
        .mcp
        .store
        .disable_local_skills_by_ids(&[normalized_skill_id.clone()])
        .await
        .map_err(to_string)?;
    if updated <= 0 {
        return Err(format!(
            "local skill {} is not installed or already disabled",
            normalized_skill_id
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn list_local_skill_runtime_statuses(
    app_state: State<'_, AppState>,
) -> Result<Vec<LocalSkillRuntimeStatus>, String> {
    crate::modules::skills::registry_impl::list_local_skill_runtime_statuses(app_state).await
}

#[tauri::command]
pub async fn update_local_skill_runtime_settings(
    app_state: State<'_, AppState>,
    skill_id: String,
    payload: UpdateLocalSkillRuntimeSettingsRequest,
) -> Result<LocalSkillRuntimeStatus, String> {
    crate::modules::skills::registry_impl::update_local_skill_runtime_settings(
        app_state, skill_id, payload,
    )
    .await
}

#[tauri::command]
pub async fn install_local_skill_runtime(
    app: AppHandle,
    app_state: State<'_, AppState>,
    skill_id: String,
) -> Result<LocalSkillRuntimeStatus, String> {
    crate::modules::skills::registry_impl::install_local_skill_runtime(app, app_state, skill_id)
        .await
}

#[tauri::command]
pub async fn install_skill_from_repo(
    app: AppHandle,
    app_state: State<'_, AppState>,
    repo_url: String,
    revision: Option<String>,
    alias: Option<String>,
    expected_skill_id: Option<String>,
    #[allow(non_snake_case)] expectedSkillId: Option<String>,
) -> Result<SkillInstallResult, String> {
    crate::modules::skills::registry_impl::install_skill_from_repo(
        app,
        app_state,
        repo_url,
        revision,
        alias,
        expected_skill_id,
        expectedSkillId,
    )
    .await
}

#[tauri::command]
pub async fn uninstall_skill(
    app: AppHandle,
    app_state: State<'_, AppState>,
    skill_id: String,
) -> Result<(), String> {
    crate::modules::skills::registry_impl::uninstall_skill(app, app_state, skill_id).await
}

#[tauri::command]
pub async fn list_local_installed_skill_ids(
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    crate::modules::skills::registry_impl::list_local_installed_skill_ids(app_state).await
}
