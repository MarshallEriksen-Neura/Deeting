mod node;
mod python;

use crate::modules::mcp::commands::support::{
    resolve_effective_desktop_scout_base_url, SCOUT_SERVICE_URL_ENV_KEY,
};
use crate::modules::mcp::store::McpStore;
use crate::state::AppState;
use crate::utils::configure_background_tokio_command;
use async_trait::async_trait;
use mcp_core::types::McpTool;
use mcp_storage::types::{LocalSkillInstallDetail, LocalSkillToolBindingSnapshot};
use serde_json::{json, Value as JsonValue};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

pub(crate) const LOCAL_SKILL_RUNTIME_MANAGER_UV: &str = "uv";
pub(crate) const LOCAL_SKILL_RUNTIME_MANAGER_NPM: &str = "npm";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_INSTALLING: &str = "installing";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_READY: &str = "ready";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_NEEDS_INSTALL: &str = "needs_install";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_NEEDS_REINSTALL: &str = "needs_reinstall";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_INSTALL_FAILED: &str = "install_failed";
pub(crate) const LOCAL_SKILL_RUNTIME_STATE_UNSUPPORTED: &str = "unsupported";

const TOOL_CALL_MARKER: &str = "__DEETING_TOOL_CALL_REQUEST__";
const MAX_MARKER_REEXEC: usize = 8;

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
    pub(crate) runtime_root: PathBuf,
    pub(crate) requirements_path: PathBuf,
    pub(crate) requirements_hash: String,
    pub(crate) command_path: PathBuf,
}

#[async_trait]
pub(crate) trait LocalSkillRuntimeProvider: Send + Sync {
    fn kind(&self) -> LocalSkillRuntimeProviderKind;
    fn detect(&self, install: &LocalSkillInstallDetail) -> Option<LocalSkillRuntimeStatusSnapshot>;
    async fn install(
        &self,
        app: &AppHandle,
        app_state: &AppState,
        skill_id: &str,
    ) -> Result<LocalSkillRuntimeInstallOutcome, String>;
    async fn resolve_command(
        &self,
        store: &McpStore,
        binding: &LocalSkillToolBindingSnapshot,
    ) -> Result<Option<String>, String>;
    async fn resolve_env(
        &self,
        _store: &McpStore,
        _binding: &LocalSkillToolBindingSnapshot,
    ) -> Result<Option<HashMap<String, String>>, String> {
        Ok(None)
    }
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

fn providers() -> [&'static dyn LocalSkillRuntimeProvider; 2] {
    [
        &python::PYTHON_RUNTIME_PROVIDER,
        &node::NODE_RUNTIME_PROVIDER,
    ]
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

pub(crate) fn stored_runtime_root_path(user_settings_json: Option<&JsonValue>) -> Option<PathBuf> {
    user_settings_json
        .and_then(JsonValue::as_object)
        .and_then(|object| object.get("runtime_install"))
        .and_then(JsonValue::as_object)
        .and_then(|object| object.get("runtime_root"))
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
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
    runtime_root: Option<&Path>,
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
    let existing_runtime_root = object
        .get("runtime_install")
        .and_then(JsonValue::as_object)
        .and_then(|runtime_install| runtime_install.get("runtime_root"))
        .cloned();

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
        "command_path".to_string(),
        json!(command_path.map(|value| value.to_string_lossy().to_string())),
    );
    if let Some(value) = runtime_root
        .map(|value| JsonValue::String(value.to_string_lossy().to_string()))
        .or(existing_runtime_root)
    {
        runtime_install.insert("runtime_root".to_string(), value);
    }
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
    providers()
        .into_iter()
        .find_map(|provider| provider.detect(install))
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
    let Some(provider_kind) = runtime.provider_kind else {
        return Err(format!(
            "local skill {} does not expose a managed runtime in the current phase",
            skill_id
        ));
    };
    let provider = providers()
        .into_iter()
        .find(|provider| provider.kind() == provider_kind)
        .ok_or_else(|| {
            format!(
                "runtime provider '{}' is not registered",
                provider_kind.as_str()
            )
        })?;
    provider.install(app, app_state, skill_id).await
}

pub(crate) async fn resolve_runtime_command_for_binding(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
) -> Result<Option<String>, String> {
    let Some(provider) = providers()
        .into_iter()
        .find(|provider| provider.kind().as_str() == binding.runtime.as_str())
    else {
        return Ok(None);
    };
    provider.resolve_command(store, binding).await
}

pub(crate) async fn resolve_runtime_env_for_binding(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
) -> Result<Option<HashMap<String, String>>, String> {
    let Some(provider) = providers()
        .into_iter()
        .find(|provider| provider.kind().as_str() == binding.runtime.as_str())
    else {
        return Ok(None);
    };
    provider.resolve_env(store, binding).await
}

fn resolve_deeting_sdk_pythonpath(binding: &LocalSkillToolBindingSnapshot) -> Option<String> {
    let env_override = std::env::var("DEETING_SDK_PYTHONPATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if env_override.is_some() {
        return env_override;
    }

    let entry_path = Path::new(&binding.entry_path);
    let mut current = entry_path.parent();
    while let Some(path) = current {
        if path.file_name().and_then(|value| value.to_str()) == Some("official-skills") {
            let candidate = path
                .parent()
                .map(|parent| parent.join("deeting-sdk"))
                .filter(|candidate| candidate.exists());
            if let Some(candidate) = candidate {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        current = path.parent();
    }

    std::env::current_dir()
        .ok()
        .map(|cwd| cwd.join("packages").join("deeting-sdk"))
        .filter(|candidate| candidate.exists())
        .map(|candidate| candidate.to_string_lossy().to_string())
}

pub(crate) async fn resolve_skill_binding_env(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
) -> Result<Option<HashMap<String, String>>, String> {
    let mut env = HashMap::new();
    env.insert("DEETING_SKILL_ID".to_string(), binding.skill_id.clone());
    env.insert(
        "DEETING_SKILL_ACTION_ID".to_string(),
        binding.tool_name.clone(),
    );
    if binding.binding_kind == "deeting_tool" && binding.runtime == "python" {
        if let Some(pythonpath) = resolve_deeting_sdk_pythonpath(binding) {
            let merged = std::env::var("PYTHONPATH")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(|existing| format!("{pythonpath}:{existing}"))
                .unwrap_or(pythonpath);
            env.insert("PYTHONPATH".to_string(), merged);
        }
    }
    if binding.skill_id == "official.skills.crawler"
        || matches!(
            binding.tool_name.as_str(),
            "fetch_web_content" | "crawl_website"
        )
    {
        if let Some(override_url) = resolve_effective_desktop_scout_base_url(store)
            .await
            .map_err(|err| err.to_string())?
        {
            env.insert(SCOUT_SERVICE_URL_ENV_KEY.to_string(), override_url);
        }
    }
    if let Some(install) = store
        .get_local_skill_install_detail(&binding.skill_id)
        .await
        .map_err(|err| err.to_string())?
    {
        let secret_env = store
            .get_local_skill_env_secrets(&binding.skill_id)
            .await
            .map_err(|err| err.to_string())?;
        env.extend(secret_env);

        if let Some(user_settings) = install.user_settings_json.as_ref() {
            if let Some(config_json) = user_settings.get("config_json") {
                env.insert(
                    "DEETING_SKILL_CONFIG_JSON".to_string(),
                    config_json.to_string(),
                );
            }
        }
    }
    if let Some(runtime_env) = resolve_runtime_env_for_binding(store, binding).await? {
        env.extend(runtime_env);
    }
    if env.is_empty() {
        Ok(None)
    } else {
        Ok(Some(env))
    }
}

fn build_command_for_skill_binding(
    binding: &LocalSkillToolBindingSnapshot,
    arguments: &JsonValue,
) -> Result<(String, Vec<String>), String> {
    let mut cli_args = arguments
        .get("args")
        .and_then(JsonValue::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(JsonValue::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    match binding.runtime.as_str() {
        "python" => {
            let mut args = vec![binding.entry_path.clone()];
            args.append(&mut cli_args);
            Ok((
                if cfg!(target_os = "windows") {
                    "python".to_string()
                } else {
                    "python3".to_string()
                },
                args,
            ))
        }
        "node" => {
            let mut args = vec![binding.entry_path.clone()];
            args.append(&mut cli_args);
            Ok(("node".to_string(), args))
        }
        "bash" => {
            let mut args = vec![binding.entry_path.clone()];
            args.append(&mut cli_args);
            Ok(("bash".to_string(), args))
        }
        other => Err(format!(
            "unsupported skill binding runtime '{}' for {}",
            other, binding.callable_name
        )),
    }
}

pub(crate) async fn build_command_for_skill_binding_with_store(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
    arguments: &JsonValue,
) -> Result<(String, Vec<String>), String> {
    let mut cli_args = arguments
        .get("args")
        .and_then(JsonValue::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(JsonValue::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if binding.runtime == "python" {
        let mut args = vec![binding.entry_path.clone()];
        args.append(&mut cli_args);
        if let Some(command) = resolve_runtime_command_for_binding(store, binding).await? {
            return Ok((command, args));
        }
        return Ok((
            if cfg!(target_os = "windows") {
                "python".to_string()
            } else {
                "python3".to_string()
            },
            args,
        ));
    }

    build_command_for_skill_binding(binding, arguments)
}

pub(crate) async fn resolve_skill_binding_by_ref(
    store: &McpStore,
    binding_id: Option<&str>,
    callable_name: Option<&str>,
) -> Result<Option<LocalSkillToolBindingSnapshot>, String> {
    store
        .get_enabled_local_skill_tool_binding_by_ref(binding_id, callable_name)
        .await
        .map_err(|err| err.to_string())
}

pub(crate) fn skill_binding_fingerprint(binding: &LocalSkillToolBindingSnapshot) -> String {
    format!("{}:{}", binding.binding_id, binding.updated_at)
}

async fn ensure_skill_binding_entry_path_exists(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
) -> Result<(), String> {
    let entry_path = Path::new(&binding.entry_path);
    if entry_path.exists() {
        return Ok(());
    }
    let _ = store.delete_local_skill_install(&binding.skill_id).await;
    Err(format!(
        "skill binding '{}' points to a missing entry path: {}. Stale local skill state was removed; refresh the local skill index if you want to rescan current bundles.",
        binding.callable_name,
        entry_path.display()
    ))
}

fn extract_tool_call_marker(stdout: &str) -> Option<JsonValue> {
    for line in stdout.lines().rev() {
        let trimmed = line.trim();
        if let Some(json_str) = trimmed.strip_prefix(TOOL_CALL_MARKER) {
            let json_str = json_str.trim();
            if json_str.is_empty() {
                return Some(json!({}));
            }
            if let Ok(parsed) = serde_json::from_str::<JsonValue>(json_str) {
                return Some(parsed);
            }
            return Some(json!({}));
        }
    }
    None
}

async fn resolve_skill_binding_config_json(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
) -> Result<Option<JsonValue>, String> {
    let install = store
        .get_local_skill_install_detail(&binding.skill_id)
        .await
        .map_err(|err| err.to_string())?;
    Ok(install
        .and_then(|detail| detail.user_settings_json)
        .and_then(|settings| settings.get("config_json").cloned()))
}

fn build_script_runner_payload(
    binding: &LocalSkillToolBindingSnapshot,
    arguments: &JsonValue,
    config_json: Option<&JsonValue>,
) -> JsonValue {
    let input_payload = arguments
        .get("input")
        .cloned()
        .unwrap_or_else(|| match arguments {
            JsonValue::Object(object) => {
                let mut filtered = object.clone();
                filtered.remove("args");
                JsonValue::Object(filtered)
            }
            _ => arguments.clone(),
        });

    let context = json!({
        "skill_id": binding.skill_id,
        "tool_name": binding.tool_name,
        "callable_name": binding.callable_name,
        "binding_kind": binding.binding_kind,
    });

    match input_payload {
        JsonValue::Object(mut object) => {
            if let Some(config) = config_json {
                object.insert("__deeting_config".to_string(), config.clone());
            }
            object.insert("__deeting_context".to_string(), context);
            JsonValue::Object(object)
        }
        other => json!({
            "input": other,
            "__deeting_config": config_json.cloned().unwrap_or_else(|| json!({})),
            "__deeting_context": context,
        }),
    }
}

async fn dispatch_internal_skill_host_tool(
    store: &McpStore,
    tool_name: &str,
    arguments: &JsonValue,
) -> Result<Option<JsonValue>, String> {
    crate::modules::capability_control_plane::dispatch_internal_skill_host_tool(
        store, tool_name, arguments,
    )
    .await
}

async fn execute_deeting_tool_binding(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
    arguments: &JsonValue,
) -> Result<JsonValue, String> {
    ensure_skill_binding_entry_path_exists(store, binding).await?;
    let timeout_secs = binding.timeout_seconds.max(1);
    let mut tool_results: Vec<JsonValue> = Vec::new();
    for attempt in 0..=MAX_MARKER_REEXEC {
        let (command, args) =
            build_command_for_skill_binding_with_store(store, binding, arguments).await?;
        let env = resolve_skill_binding_env(store, binding).await?;
        let skill_dir = Path::new(&binding.entry_path)
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf());

        let runtime_context = json!({
            "tool_results": tool_results,
            "max_tool_calls": MAX_MARKER_REEXEC,
        });
        let mut env_map = env.unwrap_or_default();
        env_map.insert(
            "DEETING_RUNTIME_CONTEXT".to_string(),
            serde_json::to_string(&runtime_context).unwrap_or_default(),
        );

        let mut cmd = tokio::process::Command::new(&command);
        configure_background_tokio_command(&mut cmd);
        cmd.args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(ref dir) = skill_dir {
            cmd.current_dir(dir);
        }
        if !env_map.is_empty() {
            cmd.envs(&env_map);
        }

        let mut child = cmd.spawn().map_err(|err| err.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            let payload = json!({
                "method": binding.tool_name,
                "arguments": arguments,
            });
            let payload_bytes = serde_json::to_vec(&payload).map_err(|err| err.to_string())?;
            stdin
                .write_all(&payload_bytes)
                .await
                .map_err(|err| err.to_string())?;
        }
        let output = match tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            child.wait_with_output(),
        )
        .await
        {
            Ok(result) => {
                result.map_err(|err| format!("skill binding execution error: {}", err))?
            }
            Err(_) => {
                return Err(format!(
                    "skill binding '{}' timed out after {}s",
                    binding.callable_name, timeout_secs
                ));
            }
        };
        let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
        if let Some(marker_payload) = extract_tool_call_marker(&stdout_str) {
            let requested_tool = marker_payload
                .get("tool_name")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let requested_args = marker_payload
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            if requested_tool.is_empty() {
                return Err("skill requested a tool call with empty tool_name".to_string());
            }
            if attempt >= MAX_MARKER_REEXEC {
                return Err(format!(
                    "skill exceeded {} marker re-execution rounds",
                    MAX_MARKER_REEXEC
                ));
            }
            if let Some(result) =
                dispatch_internal_skill_host_tool(store, &requested_tool, &requested_args).await?
            {
                tool_results.push(result);
                continue;
            }
            tool_results.push(json!({
                "status": "error",
                "error": format!("desktop skill binding host bridge cannot resolve tool '{}'", requested_tool)
            }));
            continue;
        }
        if !output.status.success() {
            return Err(format!(
                "skill binding '{}' failed (exit={}): {}",
                binding.callable_name,
                output.status,
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        if output.stdout.is_empty() {
            return Ok(json!({ "ok": true }));
        }
        return serde_json::from_slice::<JsonValue>(&output.stdout).or_else(|_| {
            Ok(json!({
                "ok": true,
                "raw": stdout_str,
            }))
        });
    }
    Err("skill binding marker loop exhausted".to_string())
}

pub(crate) async fn execute_skill_binding(
    store: &McpStore,
    binding: &LocalSkillToolBindingSnapshot,
    arguments: &JsonValue,
) -> Result<JsonValue, String> {
    if binding.binding_kind == "deeting_tool" && binding.runtime == "python" {
        return execute_deeting_tool_binding(store, binding, arguments).await;
    }
    let (command, args) =
        build_command_for_skill_binding_with_store(store, binding, arguments).await?;
    let env = resolve_skill_binding_env(store, binding).await?;
    ensure_skill_binding_entry_path_exists(store, binding).await?;
    let config_json = resolve_skill_binding_config_json(store, binding).await?;

    let skill_dir = Path::new(&binding.entry_path)
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let mut cmd = tokio::process::Command::new(&command);
    configure_background_tokio_command(&mut cmd);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(ref dir) = skill_dir {
        cmd.current_dir(dir);
    }

    if let Some(ref env_map) = env {
        cmd.envs(env_map);
    }

    let mut child = cmd.spawn().map_err(|err| err.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let payload = if binding.binding_kind == "script_runner" {
            build_script_runner_payload(binding, arguments, config_json.as_ref())
        } else {
            json!({
                "method": binding.tool_name,
                "arguments": arguments,
            })
        };
        let payload_bytes = serde_json::to_vec(&payload).map_err(|err| err.to_string())?;
        if !payload_bytes.is_empty() {
            stdin
                .write_all(&payload_bytes)
                .await
                .map_err(|err| err.to_string())?;
        }
    }

    let output = match tokio::time::timeout(
        std::time::Duration::from_secs(binding.timeout_seconds.max(1)),
        child.wait_with_output(),
    )
    .await
    {
        Ok(result) => result.map_err(|err| format!("skill binding execution error: {}", err))?,
        Err(_) => {
            return Err(format!(
                "skill binding '{}' timed out after {}s",
                binding.callable_name, binding.timeout_seconds
            ));
        }
    };

    if !output.status.success() {
        return Err(format!(
            "skill binding '{}' failed (exit={}): {}",
            binding.callable_name,
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    if output.stdout.is_empty() {
        return Ok(json!({ "ok": true }));
    }
    serde_json::from_slice::<JsonValue>(&output.stdout).or_else(|_| {
        Ok(json!({
            "ok": true,
            "raw": String::from_utf8_lossy(&output.stdout).to_string(),
        }))
    })
}

fn parse_timeout_from_tool(tool: &McpTool) -> u64 {
    serde_json::from_str::<JsonValue>(&tool.config_json)
        .ok()
        .and_then(|v| v.get("execution")?.get("timeout_seconds")?.as_u64())
        .unwrap_or(60)
}

pub(crate) async fn resolve_local_tool_env(
    store: &McpStore,
    tool: &McpTool,
) -> Result<Option<HashMap<String, String>>, String> {
    let mut env = tool.env.clone().unwrap_or_default();
    let is_official_crawler_tool = tool
        .identifier
        .as_deref()
        .map(|id| id.starts_with("official.skills.crawler/"))
        .unwrap_or(false)
        || matches!(tool.name.as_str(), "fetch_web_content" | "crawl_website");
    if is_official_crawler_tool {
        env.remove(SCOUT_SERVICE_URL_ENV_KEY);
        let override_url = resolve_effective_desktop_scout_base_url(store)
            .await
            .map_err(|err| err.to_string())?;
        if let Some(normalized) = override_url {
            env.insert(SCOUT_SERVICE_URL_ENV_KEY.to_string(), normalized);
        }
    }
    if env.is_empty() {
        Ok(None)
    } else {
        Ok(Some(env))
    }
}

async fn spawn_local_tool_subprocess(
    store: &McpStore,
    tool: &McpTool,
    arguments: &JsonValue,
    tool_results: &[JsonValue],
    timeout_secs: u64,
) -> Result<std::process::Output, String> {
    let command = tool
        .command
        .clone()
        .ok_or_else(|| format!("tool {} has no executable command", tool.name))?;
    let mut cmd = tokio::process::Command::new(command);
    configure_background_tokio_command(&mut cmd);
    if let Some(args) = &tool.args {
        cmd.args(args);
    }
    if let Some(env) = resolve_local_tool_env(store, tool).await? {
        cmd.envs(env);
    }
    if !tool_results.is_empty() {
        let ctx = json!({ "tool_results": tool_results, "max_tool_calls": MAX_MARKER_REEXEC });
        cmd.env(
            "DEETING_RUNTIME_CONTEXT",
            serde_json::to_string(&ctx).unwrap_or_default(),
        );
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|err| err.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let payload_bytes =
            serde_json::to_vec(&json!({ "method": tool.name, "arguments": arguments }))
                .map_err(|err| err.to_string())?;
        stdin
            .write_all(&payload_bytes)
            .await
            .map_err(|err| err.to_string())?;
    }
    match tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        child.wait_with_output(),
    )
    .await
    {
        Ok(result) => result.map_err(|e| format!("tool execution error: {}", e)),
        Err(_) => Err(format!("skill execution timed out after {}s", timeout_secs)),
    }
}

pub(crate) async fn execute_local_mcp_tool(
    store: &McpStore,
    tool: &McpTool,
    arguments: &JsonValue,
) -> Result<JsonValue, String> {
    let timeout_secs = parse_timeout_from_tool(tool);
    let mut tool_results: Vec<JsonValue> = Vec::new();
    for attempt in 0..=MAX_MARKER_REEXEC {
        let output =
            spawn_local_tool_subprocess(store, tool, arguments, &tool_results, timeout_secs)
                .await?;
        let stdout_str = String::from_utf8_lossy(&output.stdout);
        if let Some(marker_payload) = extract_tool_call_marker(&stdout_str) {
            let requested_tool = marker_payload
                .get("tool_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if requested_tool.is_empty() {
                return Err("skill requested a tool call with empty tool_name".to_string());
            }
            if attempt >= MAX_MARKER_REEXEC {
                return Err(format!(
                    "skill exceeded {} marker re-execution rounds",
                    MAX_MARKER_REEXEC
                ));
            }
            tool_results.push(json!({
                "status": "error",
                "error": format!("cross-tool call to '{}' not yet supported in desktop Marker mode", requested_tool)
            }));
            continue;
        }
        if output.status.success() {
            if output.stdout.is_empty() {
                return Ok(json!({ "ok": true }));
            }
            return match serde_json::from_slice::<JsonValue>(&output.stdout) {
                Ok(parsed) => Ok(parsed),
                Err(_) => Ok(json!({ "ok": true, "raw": stdout_str.to_string() })),
            };
        }
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "tool execution failed (exit={}): {}",
            output.status, stderr
        ));
    }
    Err("skill marker re-execution loop exhausted".to_string())
}

pub(crate) fn runtime_install_metadata_from_outcome(
    outcome: &LocalSkillRuntimeInstallOutcome,
) -> (
    LocalSkillRuntimeProviderKind,
    Option<&str>,
    Option<&Path>,
    Option<&Path>,
    Option<&str>,
    Option<&Path>,
) {
    (
        outcome.provider_kind,
        Some(outcome.manager.as_str()),
        Some(outcome.runtime_root.as_path()),
        Some(outcome.requirements_path.as_path()),
        Some(outcome.requirements_hash.as_str()),
        Some(outcome.command_path.as_path()),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        build_command_for_skill_binding_with_store, execute_skill_binding,
        resolve_skill_binding_by_ref, resolve_skill_binding_env, skill_binding_fingerprint,
    };
    use crate::modules::mcp::store::{LocalSkillToolBindingUpsert, McpStore};
    use mcp_storage::types::LocalSkillToolBindingSnapshot;
    use uuid::Uuid;

    async fn create_test_store(test_name: &str) -> McpStore {
        let mut db_path = std::env::temp_dir();
        db_path.push(format!(
            "deeting-skill-runtime-{test_name}-{}.db",
            Uuid::new_v4()
        ));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        let store = McpStore::new(&database_url)
            .await
            .expect("create test store");
        store.init().await.expect("init test store");
        store
    }

    #[tokio::test]
    async fn resolve_skill_binding_by_ref_reads_enabled_binding_and_fingerprint_from_skill_runtime()
    {
        let store = create_test_store("resolve-skill-binding-by-ref").await;
        let skill_id = "official.skills.weather";
        let skill_root = std::env::temp_dir().join(format!(
            "deeting-skill-runtime-binding-{}",
            Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&skill_root).expect("create temp skill dir");
        std::fs::write(skill_root.join("main.py"), "print('ok')").expect("write skill entry");
        let manifest_json = serde_json::json!({
            "id": skill_id,
            "name": "Weather Skill",
            "entry": { "backend": "main.py" },
            "runtime": ["local"]
        })
        .to_string();

        store
            .upsert_local_skill_install(
                skill_id,
                Some("1.0.0"),
                Some("python"),
                &manifest_json,
                &skill_root.to_string_lossy(),
            )
            .await
            .expect("upsert local skill install");
        store
            .replace_local_skill_tool_bindings(
                skill_id,
                &[LocalSkillToolBindingUpsert {
                    binding_id: "skill_binding::official.skills.weather::get_weather".to_string(),
                    binding_kind: "deeting_tool".to_string(),
                    callable_name: "skill.official.skills.weather.get_weather".to_string(),
                    tool_name: "get_weather".to_string(),
                    description: "Fetch weather".to_string(),
                    input_schema_json: None,
                    output_schema_json: None,
                    entry_path: skill_root.join("main.py").to_string_lossy().to_string(),
                    runtime: "python".to_string(),
                    timeout_seconds: 15,
                }],
            )
            .await
            .expect("replace skill bindings");

        let binding = resolve_skill_binding_by_ref(
            &store,
            None,
            Some("skill.official.skills.weather.get_weather"),
        )
        .await
        .expect("resolve binding")
        .expect("binding should exist");

        assert_eq!(
            binding.binding_id,
            "skill_binding::official.skills.weather::get_weather"
        );
        assert_eq!(
            skill_binding_fingerprint(&binding),
            format!("{}:{}", binding.binding_id, binding.updated_at)
        );

        let _ = std::fs::remove_dir_all(&skill_root);
    }

    #[tokio::test]
    async fn build_command_for_skill_binding_with_store_falls_back_to_python_entrypoint() {
        let store = create_test_store("build-skill-binding-command").await;
        let binding = LocalSkillToolBindingSnapshot {
            binding_id: "skill_binding::official.skills.weather::get_weather".to_string(),
            skill_id: "official.skills.weather".to_string(),
            callable_name: "skill.official.skills.weather.get_weather".to_string(),
            tool_name: "get_weather".to_string(),
            description: "Fetch weather".to_string(),
            binding_kind: "deeting_tool".to_string(),
            input_schema: None,
            output_schema: None,
            entry_path: "/tmp/official.skills.weather/main.py".to_string(),
            runtime: "python".to_string(),
            timeout_seconds: 15,
            updated_at: "2026-03-18T00:00:00Z".to_string(),
        };

        let (command, args) = build_command_for_skill_binding_with_store(
            &store,
            &binding,
            &serde_json::json!({
                "args": ["--city", "Paris"]
            }),
        )
        .await
        .expect("build command");

        assert_eq!(
            command,
            if cfg!(target_os = "windows") {
                "python"
            } else {
                "python3"
            }
        );
        assert_eq!(
            args,
            vec![
                "/tmp/official.skills.weather/main.py".to_string(),
                "--city".to_string(),
                "Paris".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn resolve_skill_binding_env_applies_scout_override_and_config_json() {
        let store = create_test_store("resolve-skill-binding-env").await;
        let skill_id = "official.skills.crawler";
        let skill_root = std::env::temp_dir().join(format!(
            "deeting-skill-runtime-env-{}",
            Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&skill_root).expect("create temp skill dir");
        std::fs::write(skill_root.join("main.py"), "print('ok')").expect("write skill entry");
        let manifest_json = serde_json::json!({
            "id": skill_id,
            "name": "Crawler Skill",
            "entry": { "backend": "main.py" },
            "runtime": ["local"]
        })
        .to_string();

        store
            .upsert_local_skill_install(
                skill_id,
                Some("1.0.0"),
                Some("python"),
                &manifest_json,
                &skill_root.to_string_lossy(),
            )
            .await
            .expect("upsert local skill install");
        store
            .update_local_skill_user_settings(
                skill_id,
                &serde_json::json!({
                    "config_json": {
                        "mode": "deep",
                        "max_pages": 3
                    }
                }),
            )
            .await
            .expect("update skill settings");
        store
            .set_desktop_config("scout.base_url", "https://scout.example.com/")
            .await
            .expect("set desktop scout base url");

        let binding = LocalSkillToolBindingSnapshot {
            binding_id: "skill_binding::official.skills.crawler::crawl_website".to_string(),
            skill_id: skill_id.to_string(),
            callable_name: "skill.official.skills.crawler.crawl_website".to_string(),
            tool_name: "crawl_website".to_string(),
            description: "Crawl website".to_string(),
            binding_kind: "deeting_tool".to_string(),
            input_schema: None,
            output_schema: None,
            entry_path: skill_root.join("main.py").to_string_lossy().to_string(),
            runtime: "python".to_string(),
            timeout_seconds: 15,
            updated_at: "2026-03-18T00:00:00Z".to_string(),
        };

        let env = resolve_skill_binding_env(&store, &binding)
            .await
            .expect("resolve skill binding env")
            .expect("skill binding env should exist");

        assert_eq!(
            env.get("SCOUT_SERVICE_URL").map(String::as_str),
            Some("https://scout.example.com")
        );
        assert_eq!(
            env.get("DEETING_SKILL_ID").map(String::as_str),
            Some("official.skills.crawler")
        );
        assert_eq!(
            env.get("DEETING_SKILL_ACTION_ID").map(String::as_str),
            Some("crawl_website")
        );
        assert_eq!(
            env.get("DEETING_SKILL_CONFIG_JSON").map(String::as_str),
            Some(r#"{"max_pages":3,"mode":"deep"}"#)
        );

        let _ = std::fs::remove_dir_all(&skill_root);
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn execute_skill_binding_runs_python_deeting_tool_binding() {
        let store = create_test_store("execute-skill-binding-direct").await;
        let skill_root = std::env::temp_dir().join(format!(
            "deeting-skill-runtime-exec-{}",
            Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&skill_root).expect("create temp skill dir");
        std::fs::write(
            skill_root.join("main.py"),
            "import json,sys\npayload=json.load(sys.stdin)\njson.dump({\"tool\": payload.get(\"method\"), \"city\": payload.get(\"arguments\", {}).get(\"city\")}, sys.stdout)\n",
        )
        .expect("write skill entry");

        let skill_id = "official.skills.weather";
        let manifest_json = serde_json::json!({
            "id": skill_id,
            "name": "Weather Skill",
            "entry": { "backend": "main.py" },
            "runtime": ["local"]
        })
        .to_string();
        store
            .upsert_local_skill_install(
                skill_id,
                Some("1.0.0"),
                Some("python"),
                &manifest_json,
                &skill_root.to_string_lossy(),
            )
            .await
            .expect("upsert local skill install");

        let binding = LocalSkillToolBindingSnapshot {
            binding_id: "skill_binding::official.skills.weather::get_weather".to_string(),
            skill_id: skill_id.to_string(),
            callable_name: "skill.official.skills.weather.get_weather".to_string(),
            tool_name: "get_weather".to_string(),
            description: "Fetch weather".to_string(),
            binding_kind: "deeting_tool".to_string(),
            input_schema: None,
            output_schema: None,
            entry_path: skill_root.join("main.py").to_string_lossy().to_string(),
            runtime: "python".to_string(),
            timeout_seconds: 15,
            updated_at: "2026-03-18T00:00:00Z".to_string(),
        };

        let result =
            execute_skill_binding(&store, &binding, &serde_json::json!({ "city": "Paris" }))
                .await
                .expect("execute skill binding");

        assert_eq!(result["tool"], serde_json::json!("get_weather"));
        assert_eq!(result["city"], serde_json::json!("Paris"));

        let _ = std::fs::remove_dir_all(&skill_root);
    }
}
