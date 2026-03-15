mod node;
mod python;

use crate::modules::mcp::store::{
    LocalSkillInstallDetail, LocalSkillToolBindingSnapshot, McpStore,
};
use crate::state::AppState;
use serde_json::{json, Value as JsonValue};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub(crate) const LOCAL_SKILL_RUNTIME_MANAGER_UV: &str = "uv";
pub(crate) const LOCAL_SKILL_RUNTIME_MANAGER_NPM: &str = "npm";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_INSTALLING: &str = "installing";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_READY: &str = "ready";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_NEEDS_INSTALL: &str = "needs_install";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_NEEDS_REINSTALL: &str = "needs_reinstall";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_INSTALL_FAILED: &str = "install_failed";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_UNSUPPORTED: &str = "unsupported";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LocalSkillRuntimeProviderKind {
    Python,
    Node,
}

impl LocalSkillRuntimeProviderKind {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Python => "python",
            Self::Node => "node",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct LocalSkillRuntimeStatusSnapshot {
    pub(crate) provider_kind: Option<LocalSkillRuntimeProviderKind>,
    pub(crate) supported: bool,
    pub(crate) state: &'static str,
    pub(crate) manager: Option<String>,
    pub(crate) manager_available: bool,
    pub(crate) requirements_path: Option<String>,
    pub(crate) command_path: Option<String>,
    pub(crate) install_error: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct LocalSkillRuntimeInstallOutcome {
    pub(crate) provider_kind: LocalSkillRuntimeProviderKind,
    pub(crate) manager: String,
    pub(crate) requirements_path: PathBuf,
    pub(crate) requirements_hash: String,
    pub(crate) command_path: PathBuf,
}

pub(crate) fn normalize_runtime_dir_name(skill_id: &str) -> String {
    let mut out = String::with_capacity(skill_id.len());
    for ch in skill_id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let normalized = out.trim_matches('_').trim().to_string();
    if normalized.is_empty() {
        "skill".to_string()
    } else {
        normalized
    }
}

pub(crate) fn runtime_root_for_skill(app: &AppHandle, skill_id: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|err: tauri::Error| err.to_string())?
        .join("skills")
        .join(".runtime")
        .join(normalize_runtime_dir_name(skill_id)))
}

pub(crate) fn python_venv_candidates(base_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![base_dir.join(".venv").join("bin").join("python")];
    if cfg!(target_os = "windows") {
        candidates.insert(0, base_dir.join(".venv").join("Scripts").join("python.exe"));
    }
    candidates
}

pub(crate) fn managed_runtime_root_from_install_path(
    install_path: &Path,
    skill_id: &str,
) -> Option<PathBuf> {
    Some(
        install_path
            .parent()?
            .join(".runtime")
            .join(normalize_runtime_dir_name(skill_id)),
    )
}

pub(crate) fn compute_file_sha256(path: &Path) -> Option<String> {
    python::compute_file_sha256(path)
}

pub(crate) fn normalize_runtime_settings_json(user_settings_json: Option<&JsonValue>) -> JsonValue {
    match user_settings_json {
        Some(JsonValue::Object(object)) => JsonValue::Object(object.clone()),
        _ => json!({}),
    }
}

pub(crate) fn upsert_runtime_install_metadata(
    settings: &mut JsonValue,
    state: &str,
    manager: Option<&str>,
    requirements_path: Option<&Path>,
    requirements_hash: Option<&str>,
    command_path: Option<&Path>,
    last_error: Option<&str>,
) -> Result<(), String> {
    if !settings.is_object() {
        *settings = json!({});
    }
    let object = settings
        .as_object_mut()
        .ok_or_else(|| "skill settings must be an object".to_string())?;

    let mut runtime_install = serde_json::Map::new();
    runtime_install.insert("state".to_string(), json!(state));
    runtime_install.insert("manager".to_string(), json!(manager));
    runtime_install.insert(
        "runtime_kind".to_string(),
        json!(manager.map(|value| {
            if value == LOCAL_SKILL_RUNTIME_MANAGER_NPM {
                LocalSkillRuntimeProviderKind::Node.as_str()
            } else {
                LocalSkillRuntimeProviderKind::Python.as_str()
            }
        })),
    );
    runtime_install.insert(
        "requirements_path".to_string(),
        json!(requirements_path.map(|value| value.to_string_lossy().to_string())),
    );
    runtime_install.insert("requirements_hash".to_string(), json!(requirements_hash));
    runtime_install.insert(
        "python_path".to_string(),
        json!(command_path.map(|value| value.to_string_lossy().to_string())),
    );
    runtime_install.insert(
        "command_path".to_string(),
        json!(command_path.map(|value| value.to_string_lossy().to_string())),
    );
    runtime_install.insert("last_error".to_string(), json!(last_error));
    object.insert(
        "runtime_install".to_string(),
        JsonValue::Object(runtime_install),
    );
    Ok(())
}

pub(crate) fn detect_local_skill_runtime(
    install: &LocalSkillInstallDetail,
) -> LocalSkillRuntimeStatusSnapshot {
    [
        LocalSkillRuntimeProviderKind::Python,
        LocalSkillRuntimeProviderKind::Node,
    ]
    .iter()
    .find_map(|kind| match kind {
        LocalSkillRuntimeProviderKind::Python => python::detect_python_runtime(install),
        LocalSkillRuntimeProviderKind::Node => node::detect_node_runtime(install),
    })
    .unwrap_or(LocalSkillRuntimeStatusSnapshot {
        provider_kind: None,
        supported: false,
        state: LOCAL_SKILL_RUNTIME_STATE_UNSUPPORTED,
        manager: None,
        manager_available: false,
        requirements_path: None,
        command_path: None,
        install_error: None,
    })
}

pub(crate) async fn install_local_skill_runtime(
    app: &AppHandle,
    app_state: &AppState,
    skill_id: &str,
) -> Result<LocalSkillRuntimeInstallOutcome, String> {
    let install = app_state
        .mcp
        .store
        .get_local_skill_install_detail(skill_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("local skill {} is not installed", skill_id))?;
    let runtime = detect_local_skill_runtime(&install);
    match runtime.provider_kind {
        Some(LocalSkillRuntimeProviderKind::Python) => {
            python::install_python_runtime(app, app_state, skill_id).await
        }
        Some(LocalSkillRuntimeProviderKind::Node) => {
            node::install_node_runtime(app, app_state, skill_id).await
        }
        None => Err(format!(
            "local skill {} does not expose a managed runtime in the current phase",
            skill_id
        )),
    }
}

pub(crate) async fn resolve_runtime_command_for_binding(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
) -> Result<Option<String>, String> {
    match binding.runtime.as_str() {
        "python" => python::resolve_preferred_python_command_for_binding(store, binding).await,
        "node" => node::resolve_preferred_node_command_for_binding(store, binding).await,
        _ => Ok(None),
    }
}

pub(crate) async fn resolve_runtime_env_for_binding(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
) -> Result<Option<HashMap<String, String>>, String> {
    match binding.runtime.as_str() {
        "python" => Ok(None),
        "node" => node::resolve_node_runtime_env_for_binding(store, binding).await,
        _ => Ok(None),
    }
}

pub(crate) fn runtime_install_metadata_from_outcome(
    outcome: &LocalSkillRuntimeInstallOutcome,
) -> (
    LocalSkillRuntimeProviderKind,
    Option<&str>,
    Option<&Path>,
    Option<&str>,
    Option<&Path>,
) {
    (
        outcome.provider_kind,
        Some(outcome.manager.as_str()),
        Some(outcome.requirements_path.as_path()),
        Some(outcome.requirements_hash.as_str()),
        Some(outcome.command_path.as_path()),
    )
}
