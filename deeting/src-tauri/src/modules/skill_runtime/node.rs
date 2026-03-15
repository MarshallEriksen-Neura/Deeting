use super::{
    compute_file_sha256, managed_runtime_root_from_install_path, runtime_root_for_skill,
    LocalSkillRuntimeInstallOutcome, LocalSkillRuntimeProvider, LocalSkillRuntimeProviderKind,
    LocalSkillRuntimeStatusSnapshot, LOCAL_SKILL_RUNTIME_MANAGER_NPM,
    LOCAL_SKILL_RUNTIME_STATE_INSTALLING, LOCAL_SKILL_RUNTIME_STATE_INSTALL_FAILED,
    LOCAL_SKILL_RUNTIME_STATE_NEEDS_INSTALL, LOCAL_SKILL_RUNTIME_STATE_NEEDS_REINSTALL,
    LOCAL_SKILL_RUNTIME_STATE_READY,
};
use crate::modules::mcp::store::{
    LocalSkillInstallDetail, LocalSkillToolBindingSnapshot, McpStore,
};
use crate::state::AppState;
use async_trait::async_trait;
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

fn skill_runtime_settings_object(
    user_settings_json: Option<&JsonValue>,
) -> Option<&serde_json::Map<String, JsonValue>> {
    user_settings_json.and_then(JsonValue::as_object)
}

fn stored_runtime_install_object(
    user_settings_json: Option<&JsonValue>,
) -> Option<&serde_json::Map<String, JsonValue>> {
    skill_runtime_settings_object(user_settings_json)?
        .get("runtime_install")?
        .as_object()
}

fn stored_runtime_install_error(user_settings_json: Option<&JsonValue>) -> Option<String> {
    stored_runtime_install_object(user_settings_json)?
        .get("last_error")
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn stored_runtime_install_state(user_settings_json: Option<&JsonValue>) -> Option<String> {
    stored_runtime_install_object(user_settings_json)?
        .get("state")
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn stored_runtime_command_path(user_settings_json: Option<&JsonValue>) -> Option<String> {
    stored_runtime_install_object(user_settings_json)?
        .get("python_path")
        .or_else(|| stored_runtime_install_object(user_settings_json)?.get("command_path"))
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn stored_runtime_requirements_hash(user_settings_json: Option<&JsonValue>) -> Option<String> {
    stored_runtime_install_object(user_settings_json)?
        .get("requirements_hash")
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn binary_path(binary: &str) -> Option<PathBuf> {
    let candidate = binary.trim();
    if candidate.is_empty() {
        return None;
    }
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    for base in std::env::split_paths(&path_var) {
        let full = base.join(candidate);
        if full.is_file() {
            return Some(full);
        }
        if cfg!(target_os = "windows") {
            for ext in ["exe", "cmd", "bat"] {
                let full_with_ext = base.join(format!("{candidate}.{ext}"));
                if full_with_ext.is_file() {
                    return Some(full_with_ext);
                }
            }
        }
    }
    None
}

fn has_node_entrypoint(install_root: &Path, install: &LocalSkillInstallDetail) -> bool {
    let manifest = serde_json::from_str::<JsonValue>(&install.manifest_json)
        .ok()
        .unwrap_or(JsonValue::Null);
    let backend_entry = manifest
        .pointer("/entry/backend")
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| {
            value.ends_with(".js") || value.ends_with(".mjs") || value.ends_with(".cjs")
        })
        .is_some();
    if backend_entry {
        return true;
    }

    let scripts_dir = install_root.join("scripts");
    let Ok(entries) = std::fs::read_dir(&scripts_dir) else {
        return false;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .any(|path| {
            matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("js" | "mjs" | "cjs")
            )
        })
}

fn package_manifest_path(install_root: &Path) -> PathBuf {
    install_root.join("package.json")
}

fn existing_node_runtime_root(install: &LocalSkillInstallDetail) -> Option<PathBuf> {
    let install_root = PathBuf::from(install.install_path.trim());
    let direct_node_modules = install_root.join("node_modules");
    if direct_node_modules.is_dir() {
        return Some(install_root);
    }
    let runtime_root = managed_runtime_root_from_install_path(&install_root, &install.skill_id)?;
    if runtime_root.join("node_modules").is_dir() {
        return Some(runtime_root);
    }
    None
}

pub(crate) fn detect_node_runtime(
    install: &LocalSkillInstallDetail,
) -> Option<LocalSkillRuntimeStatusSnapshot> {
    let install_root = PathBuf::from(install.install_path.trim());
    let package_json_path = package_manifest_path(&install_root);
    if !package_json_path.is_file() {
        return None;
    }
    if !has_node_entrypoint(&install_root, install) {
        return None;
    }

    let current_manifest_hash = compute_file_sha256(&package_json_path);
    let stored_manifest_hash =
        stored_runtime_requirements_hash(install.user_settings_json.as_ref());
    let stored_state = stored_runtime_install_state(install.user_settings_json.as_ref());
    let install_error = stored_runtime_install_error(install.user_settings_json.as_ref());
    let command_path = stored_runtime_command_path(install.user_settings_json.as_ref())
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| binary_path("node"))
        .map(|path| path.to_string_lossy().to_string());
    let manager_available = binary_path(LOCAL_SKILL_RUNTIME_MANAGER_NPM).is_some();
    let has_runtime_root = existing_node_runtime_root(install).is_some();
    let state = if stored_state.as_deref() == Some(LOCAL_SKILL_RUNTIME_STATE_INSTALLING) {
        LOCAL_SKILL_RUNTIME_STATE_INSTALLING
    } else if has_runtime_root
        && current_manifest_hash.is_some()
        && stored_manifest_hash.is_some()
        && current_manifest_hash != stored_manifest_hash
    {
        LOCAL_SKILL_RUNTIME_STATE_NEEDS_REINSTALL
    } else if has_runtime_root && command_path.is_some() {
        LOCAL_SKILL_RUNTIME_STATE_READY
    } else if install_error.is_some() {
        LOCAL_SKILL_RUNTIME_STATE_INSTALL_FAILED
    } else {
        LOCAL_SKILL_RUNTIME_STATE_NEEDS_INSTALL
    };

    Some(LocalSkillRuntimeStatusSnapshot {
        provider_kind: Some(LocalSkillRuntimeProviderKind::Node),
        supported: true,
        state,
        manager: Some(LOCAL_SKILL_RUNTIME_MANAGER_NPM.to_string()),
        manager_available,
        requirements_path: Some(package_json_path.to_string_lossy().to_string()),
        command_path,
        install_error,
    })
}

pub(crate) struct NodeRuntimeProvider;
pub(crate) static NODE_RUNTIME_PROVIDER: NodeRuntimeProvider = NodeRuntimeProvider;

#[async_trait]
impl LocalSkillRuntimeProvider for NodeRuntimeProvider {
    fn kind(&self) -> LocalSkillRuntimeProviderKind {
        LocalSkillRuntimeProviderKind::Node
    }

    fn detect(&self, install: &LocalSkillInstallDetail) -> Option<LocalSkillRuntimeStatusSnapshot> {
        detect_node_runtime(install)
    }

    async fn install(
        &self,
        app: &AppHandle,
        app_state: &AppState,
        skill_id: &str,
    ) -> Result<LocalSkillRuntimeInstallOutcome, String> {
        install_node_runtime(app, app_state, skill_id).await
    }

    async fn resolve_command(
        &self,
        store: &McpStore,
        binding: &LocalSkillToolBindingSnapshot,
    ) -> Result<Option<String>, String> {
        resolve_preferred_node_command_for_binding(store, binding).await
    }

    async fn resolve_env(
        &self,
        store: &McpStore,
        binding: &LocalSkillToolBindingSnapshot,
    ) -> Result<Option<HashMap<String, String>>, String> {
        resolve_node_runtime_env_for_binding(store, binding).await
    }
}

async fn run_command_capture(program: &str, args: &[String], workdir: &Path) -> Result<(), String> {
    let output = tokio::process::Command::new(program)
        .args(args)
        .current_dir(workdir)
        .output()
        .await
        .map_err(|err| err.to_string())?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "unknown error".to_string()
    };
    Err(format!(
        "{} {} failed (exit={}): {}",
        program,
        args.join(" "),
        output.status,
        detail
    ))
}

fn copy_runtime_manifest_inputs(
    install_root: &Path,
    runtime_root: &Path,
) -> Result<PathBuf, String> {
    let package_json_path = install_root.join("package.json");
    if !package_json_path.is_file() {
        return Err("package.json is missing".to_string());
    }
    std::fs::create_dir_all(runtime_root).map_err(|err| err.to_string())?;
    std::fs::copy(&package_json_path, runtime_root.join("package.json"))
        .map_err(|err| err.to_string())?;
    for lock_name in ["package-lock.json", "npm-shrinkwrap.json"] {
        let lock_path = install_root.join(lock_name);
        if lock_path.is_file() {
            std::fs::copy(&lock_path, runtime_root.join(lock_name))
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(package_json_path)
}

pub(crate) async fn install_node_runtime(
    app: &AppHandle,
    app_state: &AppState,
    skill_id: &str,
) -> Result<LocalSkillRuntimeInstallOutcome, String> {
    let normalized_skill_id = skill_id.trim();
    if normalized_skill_id.is_empty() {
        return Err("skill_id is required".to_string());
    }

    let install = app_state
        .mcp
        .store
        .get_local_skill_install_detail(normalized_skill_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("local skill {} is not installed", normalized_skill_id))?;
    let status = detect_node_runtime(&install).unwrap_or(LocalSkillRuntimeStatusSnapshot {
        provider_kind: Some(LocalSkillRuntimeProviderKind::Node),
        supported: false,
        state: LOCAL_SKILL_RUNTIME_STATE_NEEDS_INSTALL,
        manager: Some(LOCAL_SKILL_RUNTIME_MANAGER_NPM.to_string()),
        manager_available: binary_path(LOCAL_SKILL_RUNTIME_MANAGER_NPM).is_some(),
        requirements_path: None,
        command_path: binary_path("node").map(|path| path.to_string_lossy().to_string()),
        install_error: None,
    });
    if !status.supported {
        return Err(format!(
            "local skill {} does not expose a managed Node runtime in phase 2b",
            normalized_skill_id
        ));
    }
    if !status.manager_available {
        return Err("npm is required to install local skill runtime".to_string());
    }

    let install_root = PathBuf::from(install.install_path.trim());
    let runtime_root = runtime_root_for_skill(app, normalized_skill_id)?;
    if runtime_root.exists() {
        std::fs::remove_dir_all(&runtime_root).map_err(|err| err.to_string())?;
    }
    let package_json_path = copy_runtime_manifest_inputs(&install_root, &runtime_root)?;
    let package_hash = compute_file_sha256(&package_json_path)
        .ok_or_else(|| format!("failed to read {}", package_json_path.display()))?;
    let has_lockfile = runtime_root.join("package-lock.json").is_file()
        || runtime_root.join("npm-shrinkwrap.json").is_file();
    let command = if has_lockfile { "ci" } else { "install" };
    run_command_capture(
        LOCAL_SKILL_RUNTIME_MANAGER_NPM,
        &[command.to_string(), "--omit=dev".to_string()],
        &runtime_root,
    )
    .await?;

    let command_path = binary_path("node")
        .ok_or_else(|| "node is required to execute local node skills".to_string())?;
    Ok(LocalSkillRuntimeInstallOutcome {
        provider_kind: LocalSkillRuntimeProviderKind::Node,
        manager: LOCAL_SKILL_RUNTIME_MANAGER_NPM.to_string(),
        requirements_path: package_json_path,
        requirements_hash: package_hash,
        command_path,
    })
}

pub(crate) async fn resolve_preferred_node_command_for_binding(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
) -> Result<Option<String>, String> {
    let install = store
        .get_local_skill_install_detail(&binding.skill_id)
        .await
        .map_err(|err| err.to_string())?;
    let Some(install) = install else {
        return Ok(None);
    };

    Ok(detect_node_runtime(&install).and_then(|status| status.command_path))
}

pub(crate) async fn resolve_node_runtime_env_for_binding(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
) -> Result<Option<HashMap<String, String>>, String> {
    let install = store
        .get_local_skill_install_detail(&binding.skill_id)
        .await
        .map_err(|err| err.to_string())?;
    let Some(install) = install else {
        return Ok(None);
    };
    let Some(runtime_root) = existing_node_runtime_root(&install) else {
        return Ok(None);
    };
    let node_modules_dir = runtime_root.join("node_modules");
    if !node_modules_dir.is_dir() {
        return Ok(None);
    }

    let mut env = HashMap::new();
    env.insert(
        "NODE_PATH".to_string(),
        node_modules_dir.to_string_lossy().to_string(),
    );
    let bin_dir = node_modules_dir.join(".bin");
    if bin_dir.is_dir() {
        let existing = std::env::var("PATH").unwrap_or_default();
        let merged = if existing.trim().is_empty() {
            bin_dir.to_string_lossy().to_string()
        } else {
            format!("{}:{}", bin_dir.to_string_lossy(), existing)
        };
        env.insert("PATH".to_string(), merged);
    }
    Ok(Some(env))
}
