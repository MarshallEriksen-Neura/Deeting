use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

use crate::modules::custom_task_agents::types::{
    CustomTaskAgentBindableSkillAction, CustomTaskAgentSkillActionRef,
};
use crate::state::AppState;
use crate::utils::configure_background_tokio_command;

const DEFAULT_SKILL_ACTION_TIMEOUT_SECS: u64 = 60;

#[derive(Debug, Clone)]
pub(crate) struct ResolvedSkillAction {
    pub callable_name: String,
    pub skill_id: String,
    pub action_id: String,
    pub description: String,
    pub entry_path: PathBuf,
    pub runtime: String,
    pub input_schema: Option<Value>,
    pub timeout_seconds: u64,
}

#[derive(Debug, Deserialize)]
struct SkillToolManifest {
    #[serde(default)]
    tools: Vec<SkillToolManifestEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct SkillToolManifestEntry {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    parameters: Option<Value>,
}

pub(crate) async fn list_bindable_skill_actions(
    app_state: &AppState,
) -> Result<Vec<CustomTaskAgentBindableSkillAction>, String> {
    let installs = app_state
        .mcp
        .store
        .list_local_skill_installs()
        .await
        .map_err(|err| err.to_string())?;
    let mut actions = Vec::new();
    for install in installs.into_iter().filter(|item| item.is_enabled) {
        let manifest_json = app_state
            .mcp
            .store
            .get_enabled_local_skill_manifest_json(&install.skill_id)
            .await
            .map_err(|err| err.to_string())?;
        let Some(manifest_json) = manifest_json else {
            continue;
        };
        let install_path = PathBuf::from(&install.install_path);
        let backend_entry = match resolve_backend_entry_path(&install_path, &manifest_json)? {
            Some(path) => path,
            None => continue,
        };
        let runtime = resolve_script_runtime(&backend_entry)?;
        let llm_tool_path = install_path.join("llm-tool.yaml");
        if !llm_tool_path.exists() {
            continue;
        }
        for entry in read_skill_tool_manifest(&llm_tool_path)? {
            actions.push(CustomTaskAgentBindableSkillAction {
                callable_name: callable_skill_action_name(&install.skill_id, &entry.name),
                skill_id: install.skill_id.clone(),
                action_id: entry.name.clone(),
                description: entry.description.clone().unwrap_or_default(),
                runtime: runtime.to_string(),
                entry_path: backend_entry
                    .strip_prefix(&install_path)
                    .unwrap_or(&backend_entry)
                    .to_string_lossy()
                    .replace('\\', "/"),
                input_schema: entry.parameters.clone(),
            });
        }
    }
    actions.sort_by(|left, right| {
        left.skill_id
            .cmp(&right.skill_id)
            .then(left.action_id.cmp(&right.action_id))
    });
    Ok(actions)
}

pub(crate) async fn validate_callable_skill_action_refs(
    app_state: &AppState,
    refs: &[CustomTaskAgentSkillActionRef],
) -> Result<Vec<CustomTaskAgentSkillActionRef>, String> {
    let available = list_bindable_skill_actions(app_state).await?;
    let valid = available
        .into_iter()
        .map(|item| (item.skill_id, item.action_id))
        .collect::<HashSet<_>>();
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for item in refs {
        let skill_id = item.skill_id.trim().to_string();
        let action_id = item.action_id.trim().to_string();
        if skill_id.is_empty() || action_id.is_empty() {
            return Err(
                "callable skill action refs require both skill_id and action_id".to_string(),
            );
        }
        let key = (skill_id.clone(), action_id.clone());
        if !seen.insert(key.clone()) {
            continue;
        }
        if !valid.contains(&key) {
            return Err(format!(
                "skill action '{}#{}' is not available for local execution",
                skill_id, action_id
            ));
        }
        normalized.push(CustomTaskAgentSkillActionRef {
            skill_id,
            action_id,
        });
    }
    Ok(normalized)
}

pub(crate) async fn load_callable_skill_actions(
    app_state: &AppState,
    refs: &[CustomTaskAgentSkillActionRef],
) -> Result<HashMap<String, ResolvedSkillAction>, String> {
    let installs = app_state
        .mcp
        .store
        .list_local_skill_installs()
        .await
        .map_err(|err| err.to_string())?;
    let mut resolved = HashMap::new();

    for reference in refs {
        let Some(install) = installs
            .iter()
            .find(|item| item.skill_id == reference.skill_id)
        else {
            return Err(format!(
                "skill '{}' is not installed locally",
                reference.skill_id
            ));
        };
        if !install.is_enabled {
            return Err(format!("skill '{}' is disabled", reference.skill_id));
        }
        let manifest_json = app_state
            .mcp
            .store
            .get_enabled_local_skill_manifest_json(&reference.skill_id)
            .await
            .map_err(|err| err.to_string())?
            .ok_or_else(|| format!("skill '{}' manifest missing", reference.skill_id))?;
        let install_path = PathBuf::from(&install.install_path);
        let backend_entry = resolve_backend_entry_path(&install_path, &manifest_json)?
            .ok_or_else(|| format!("skill '{}' has no local backend entry", reference.skill_id))?;
        let runtime = resolve_script_runtime(&backend_entry)?.to_string();
        let timeout_seconds =
            resolve_execution_timeout(&manifest_json).unwrap_or(DEFAULT_SKILL_ACTION_TIMEOUT_SECS);
        let llm_tool_path = install_path.join("llm-tool.yaml");
        let manifest = read_skill_tool_manifest(&llm_tool_path)?;
        let Some(action) = manifest
            .into_iter()
            .find(|item| item.name == reference.action_id)
        else {
            return Err(format!(
                "skill action '{}#{}' not found in llm-tool.yaml",
                reference.skill_id, reference.action_id
            ));
        };
        let callable_name = callable_skill_action_name(&reference.skill_id, &reference.action_id);
        resolved.insert(
            callable_name.clone(),
            ResolvedSkillAction {
                callable_name,
                skill_id: reference.skill_id.clone(),
                action_id: reference.action_id.clone(),
                description: action.description.unwrap_or_default(),
                entry_path: backend_entry,
                runtime,
                input_schema: action.parameters,
                timeout_seconds,
            },
        );
    }

    Ok(resolved)
}

pub(crate) async fn execute_skill_action(
    app_state: &AppState,
    action: &ResolvedSkillAction,
    arguments: &Value,
) -> Result<Value, String> {
    let install_dir = action
        .entry_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "skill action entry has no parent directory".to_string())?;
    let (command, args) = build_command_for_entry(&action.entry_path, action.runtime.as_str())?;
    let mut cmd = tokio::process::Command::new(command);
    configure_background_tokio_command(&mut cmd);
    cmd.args(args)
        .current_dir(&install_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let env = resolve_skill_action_env(app_state, action).await?;
    if !env.is_empty() {
        cmd.envs(env);
    }

    let mut child = cmd.spawn().map_err(|err| err.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let payload = serde_json::to_vec(&json!({
            "method": action.action_id,
            "arguments": arguments,
        }))
        .map_err(|err| err.to_string())?;
        stdin
            .write_all(&payload)
            .await
            .map_err(|err| err.to_string())?;
    }

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(action.timeout_seconds.max(1)),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| {
        format!(
            "skill action '{}#{}' timed out after {}s",
            action.skill_id, action.action_id, action.timeout_seconds
        )
    })?
    .map_err(|err| err.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "skill action '{}#{}' failed (exit={}): {}",
            action.skill_id,
            action.action_id,
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    if output.stdout.is_empty() {
        return Ok(json!({ "ok": true }));
    }

    serde_json::from_slice::<Value>(&output.stdout).or_else(|_| {
        Ok(json!({
            "ok": true,
            "raw": String::from_utf8_lossy(&output.stdout).to_string(),
        }))
    })
}

pub(crate) fn callable_skill_action_name(skill_id: &str, action_id: &str) -> String {
    format!(
        "skill_action__{}__{}",
        sanitize_callable_name(skill_id),
        sanitize_callable_name(action_id)
    )
}

pub fn sanitize_callable_name(value: &str) -> String {
    let mut output = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            output.push(ch);
        } else {
            output.push('_');
        }
    }
    while output.contains("__") {
        output = output.replace("__", "_");
    }
    output.trim_matches('_').to_string()
}

fn read_skill_tool_manifest(path: &Path) -> Result<Vec<SkillToolManifestEntry>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path).map_err(|err| err.to_string())?;
    let manifest =
        serde_yaml::from_str::<SkillToolManifest>(&raw).map_err(|err| err.to_string())?;
    Ok(manifest
        .tools
        .into_iter()
        .filter(|item| !item.name.trim().is_empty())
        .collect())
}

fn resolve_backend_entry_path(
    install_path: &Path,
    manifest_json: &str,
) -> Result<Option<PathBuf>, String> {
    let manifest = serde_json::from_str::<Value>(manifest_json).map_err(|err| err.to_string())?;
    let backend = manifest
        .get("entry")
        .and_then(|value| value.get("backend"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    Ok(backend.map(|entry| install_path.join(entry)))
}

fn resolve_execution_timeout(manifest_json: &str) -> Result<u64, String> {
    let manifest = serde_json::from_str::<Value>(manifest_json).map_err(|err| err.to_string())?;
    Ok(manifest
        .get("execution")
        .and_then(|value| value.get("timeout_seconds"))
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_SKILL_ACTION_TIMEOUT_SECS))
}

fn resolve_script_runtime(entry_path: &Path) -> Result<&'static str, String> {
    match entry_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("py") => Ok("python"),
        Some("js") | Some("mjs") | Some("cjs") => Ok("node"),
        Some("sh") => Ok("bash"),
        _ => Err(format!(
            "unsupported skill action backend entry: {}",
            entry_path.display()
        )),
    }
}

fn build_command_for_entry(
    entry_path: &Path,
    runtime: &str,
) -> Result<(String, Vec<String>), String> {
    let path = entry_path
        .to_str()
        .ok_or_else(|| format!("invalid entry path: {}", entry_path.display()))?
        .to_string();
    let command = match runtime {
        "python" => {
            if cfg!(target_os = "windows") {
                "python".to_string()
            } else {
                "python3".to_string()
            }
        }
        "node" => "node".to_string(),
        "bash" => "bash".to_string(),
        other => return Err(format!("unsupported skill action runtime '{}'", other)),
    };
    Ok((command, vec![path]))
}

async fn resolve_skill_action_env(
    app_state: &AppState,
    action: &ResolvedSkillAction,
) -> Result<HashMap<String, String>, String> {
    let mut env = HashMap::new();
    env.insert("DEETING_SKILL_ID".to_string(), action.skill_id.clone());
    env.insert(
        "DEETING_SKILL_ACTION_ID".to_string(),
        action.action_id.clone(),
    );
    Ok(env)
}
