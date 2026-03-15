use super::{
    managed_runtime_root_from_install_path, python_venv_candidates, runtime_root_for_skill,
    LocalSkillRuntimeInstallOutcome, LocalSkillRuntimeProvider, LocalSkillRuntimeProviderKind,
    LocalSkillRuntimeStatusSnapshot, LOCAL_SKILL_RUNTIME_MANAGER_UV,
    LOCAL_SKILL_RUNTIME_STATE_INSTALLING, LOCAL_SKILL_RUNTIME_STATE_INSTALL_FAILED,
    LOCAL_SKILL_RUNTIME_STATE_NEEDS_INSTALL, LOCAL_SKILL_RUNTIME_STATE_NEEDS_REINSTALL,
    LOCAL_SKILL_RUNTIME_STATE_READY, LOCAL_SKILL_RUNTIME_STATE_UNSUPPORTED,
};
use crate::modules::mcp::store::{
    LocalSkillInstallDetail, LocalSkillToolBindingSnapshot, McpStore,
};
use crate::state::AppState;
use async_trait::async_trait;
use serde_json::Value as JsonValue;
use sha2::Digest;
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
        .get("command_path")
        .or_else(|| stored_runtime_install_object(user_settings_json)?.get("python_path"))
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

fn binary_exists(binary: &str) -> bool {
    let candidate = binary.trim();
    if candidate.is_empty() {
        return false;
    }
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    for base in std::env::split_paths(&path_var) {
        let full = base.join(candidate);
        if full.is_file() {
            return true;
        }
        if cfg!(target_os = "windows") {
            for ext in ["exe", "cmd", "bat"] {
                let full_with_ext = base.join(format!("{candidate}.{ext}"));
                if full_with_ext.is_file() {
                    return true;
                }
            }
        }
    }
    false
}

pub(crate) fn compute_file_sha256(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = sha2::Sha256::new();
    sha2::Digest::update(&mut hasher, bytes);
    Some(format!("{:x}", sha2::Digest::finalize(hasher)))
}

fn has_python_entrypoint(install_root: &Path, install: &LocalSkillInstallDetail) -> bool {
    let manifest = serde_json::from_str::<JsonValue>(&install.manifest_json)
        .ok()
        .unwrap_or(JsonValue::Null);
    let backend_entry = manifest
        .pointer("/entry/backend")
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| value.ends_with(".py"))
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
        .any(|path| path.extension().and_then(|value| value.to_str()) == Some("py"))
}

fn resolve_existing_runtime_python_path(install: &LocalSkillInstallDetail) -> Option<String> {
    if let Some(stored) = stored_runtime_command_path(install.user_settings_json.as_ref()) {
        let candidate = PathBuf::from(stored.trim());
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    let install_root = PathBuf::from(install.install_path.trim());
    for candidate in python_venv_candidates(&install_root) {
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    if let Some(runtime_root) =
        managed_runtime_root_from_install_path(&install_root, &install.skill_id)
    {
        for candidate in python_venv_candidates(&runtime_root) {
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

pub(crate) fn detect_python_runtime(
    install: &LocalSkillInstallDetail,
) -> Option<LocalSkillRuntimeStatusSnapshot> {
    let install_root = PathBuf::from(install.install_path.trim());
    let requirements_path = install_root.join("requirements.txt");
    if !requirements_path.is_file() {
        return None;
    }
    if !has_python_entrypoint(&install_root, install) {
        return None;
    }

    let command_path = resolve_existing_runtime_python_path(install);
    let current_requirements_hash = compute_file_sha256(&requirements_path);
    let stored_requirements_hash =
        stored_runtime_requirements_hash(install.user_settings_json.as_ref());
    let stored_state = stored_runtime_install_state(install.user_settings_json.as_ref());
    let manager_available = binary_exists(LOCAL_SKILL_RUNTIME_MANAGER_UV);
    let install_error = stored_runtime_install_error(install.user_settings_json.as_ref());
    let state = if stored_state.as_deref() == Some(LOCAL_SKILL_RUNTIME_STATE_INSTALLING) {
        LOCAL_SKILL_RUNTIME_STATE_INSTALLING
    } else if command_path.is_some()
        && current_requirements_hash.is_some()
        && stored_requirements_hash.is_some()
        && current_requirements_hash != stored_requirements_hash
    {
        LOCAL_SKILL_RUNTIME_STATE_NEEDS_REINSTALL
    } else if command_path.is_some() {
        LOCAL_SKILL_RUNTIME_STATE_READY
    } else if install_error.is_some() {
        LOCAL_SKILL_RUNTIME_STATE_INSTALL_FAILED
    } else {
        LOCAL_SKILL_RUNTIME_STATE_NEEDS_INSTALL
    };

    Some(LocalSkillRuntimeStatusSnapshot {
        provider_kind: Some(LocalSkillRuntimeProviderKind::Python),
        supported: true,
        state,
        manager: Some(LOCAL_SKILL_RUNTIME_MANAGER_UV.to_string()),
        manager_available,
        requirements_path: Some(requirements_path.to_string_lossy().to_string()),
        command_path,
        install_error,
    })
}

pub(crate) struct PythonRuntimeProvider;
pub(crate) static PYTHON_RUNTIME_PROVIDER: PythonRuntimeProvider = PythonRuntimeProvider;

#[async_trait]
impl LocalSkillRuntimeProvider for PythonRuntimeProvider {
    fn kind(&self) -> LocalSkillRuntimeProviderKind {
        LocalSkillRuntimeProviderKind::Python
    }

    fn detect(&self, install: &LocalSkillInstallDetail) -> Option<LocalSkillRuntimeStatusSnapshot> {
        detect_python_runtime(install)
    }

    async fn install(
        &self,
        app: &AppHandle,
        app_state: &AppState,
        skill_id: &str,
    ) -> Result<LocalSkillRuntimeInstallOutcome, String> {
        install_python_runtime(app, app_state, skill_id).await
    }

    async fn resolve_command(
        &self,
        store: &McpStore,
        binding: &LocalSkillToolBindingSnapshot,
    ) -> Result<Option<String>, String> {
        resolve_preferred_python_command_for_binding(store, binding).await
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

pub(crate) async fn install_python_runtime(
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
    let status = detect_python_runtime(&install).unwrap_or(LocalSkillRuntimeStatusSnapshot {
        provider_kind: Some(LocalSkillRuntimeProviderKind::Python),
        supported: false,
        state: LOCAL_SKILL_RUNTIME_STATE_UNSUPPORTED,
        manager: Some(LOCAL_SKILL_RUNTIME_MANAGER_UV.to_string()),
        manager_available: binary_exists(LOCAL_SKILL_RUNTIME_MANAGER_UV),
        requirements_path: None,
        command_path: None,
        install_error: None,
    });

    if !status.supported {
        return Err(format!(
            "local skill {} does not expose a managed Python runtime in phase 1",
            normalized_skill_id
        ));
    }
    if !status.manager_available {
        return Err("uv is required to install local skill runtime".to_string());
    }

    let requirements_path = status
        .requirements_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| {
            format!(
                "local skill {} is missing requirements.txt",
                normalized_skill_id
            )
        })?;
    let requirements_hash = compute_file_sha256(&requirements_path)
        .ok_or_else(|| format!("failed to read {}", requirements_path.display()))?;
    let runtime_root = runtime_root_for_skill(app, normalized_skill_id)?;
    let venv_root = runtime_root.join(".venv");
    let command_path = python_venv_candidates(&runtime_root)
        .into_iter()
        .next()
        .ok_or_else(|| "unable to resolve virtualenv python path".to_string())?;

    if let Some(parent) = runtime_root.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    if runtime_root.exists() {
        std::fs::remove_dir_all(&runtime_root).map_err(|err| err.to_string())?;
    }
    std::fs::create_dir_all(&runtime_root).map_err(|err| err.to_string())?;

    run_command_capture(
        LOCAL_SKILL_RUNTIME_MANAGER_UV,
        &[
            String::from("venv"),
            venv_root.to_string_lossy().to_string(),
        ],
        &runtime_root,
    )
    .await?;
    run_command_capture(
        LOCAL_SKILL_RUNTIME_MANAGER_UV,
        &[
            String::from("pip"),
            String::from("install"),
            String::from("--python"),
            command_path.to_string_lossy().to_string(),
            String::from("-r"),
            requirements_path.to_string_lossy().to_string(),
        ],
        &runtime_root,
    )
    .await?;

    Ok(LocalSkillRuntimeInstallOutcome {
        provider_kind: LocalSkillRuntimeProviderKind::Python,
        manager: LOCAL_SKILL_RUNTIME_MANAGER_UV.to_string(),
        requirements_path,
        requirements_hash,
        command_path,
    })
}

pub(crate) async fn resolve_preferred_python_command_for_binding(
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

    Ok(detect_python_runtime(&install).and_then(|status| status.command_path))
}
