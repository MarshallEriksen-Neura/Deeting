use std::collections::HashSet;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use crate::state::AppState;

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
        for entry in std::fs::read_dir(dir_path).map_err(|err| err.to_string())? {
            let entry = entry.map_err(|err| err.to_string())?;
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
            let resolved =
                crate::modules::mcp::commands::skill_registry_impl::resolve_local_skill_definition(
                    &skill_path,
                    source_prefix,
                    None,
                    None,
                )
                .map_err(|err| err.to_string())?;
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
        .map_err(|err| err.to_string())?;

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
            .map_err(|err| err.to_string())?;
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
    let purged = crate::modules::mcp::commands::skill_registry_impl::purge_legacy_skill_tool_state(
        app_state,
    )
    .await?;
    if purged > 0 {
        log::info!(
            "register_local_skills_refresh: purged {} legacy skill-tool state entries before refresh",
            purged
        );
    }
    let scan_targets =
        crate::modules::mcp::commands::skill_registry_scan_impl::resolve_local_skill_scan_targets(
            &app,
        )?;
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
    crate::modules::mcp::commands::skill_registry_scan_impl::register_local_skills_from_scan_targets_inner(
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
