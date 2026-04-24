use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::state::AppState;

const DEFAULT_SKILL_DOC_MAX_BYTES: usize = 40 * 1024;
const RESOURCE_INDEX_LIMIT: usize = 80;
const DEFAULT_RESOURCE_READ_BYTES: usize = 24 * 1024;
const HARD_RESOURCE_READ_BYTES: usize = 96 * 1024;

const RESOURCE_DIRS: &[&str] = &["references", "examples", "templates", "scripts", "assets"];
const ROOT_RESOURCE_FILES: &[&str] = &[
    "SKILL.md",
    "README.md",
    "README.txt",
    "deeting.json",
    "llm-tool.yaml",
    "package.json",
];

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub(crate) struct ActiveSkillContextState {
    pub(crate) skill_id: String,
    pub(crate) doc_hash: Option<String>,
    pub(crate) doc_length: usize,
    pub(crate) resources_read: Vec<String>,
}

impl ActiveSkillContextState {
    pub(crate) fn record_resource_read(&mut self, path: &str) {
        if !self.resources_read.iter().any(|existing| existing == path) {
            self.resources_read.push(path.to_string());
        }
    }
}

pub(crate) async fn activate_skill_from_args(
    app_state: &AppState,
    arguments: &Value,
) -> Result<(ActiveSkillContextState, Value), String> {
    let skill_id = arguments
        .get("skill_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "activate_skill requires skill_id".to_string())?;
    activate_skill(app_state, skill_id).await
}

pub(crate) async fn read_skill_resource_from_args(
    app_state: &AppState,
    arguments: &Value,
    active_skill: Option<&ActiveSkillContextState>,
) -> Result<(ActiveSkillContextState, Value), String> {
    let skill_id = arguments
        .get("skill_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| active_skill.map(|state| state.skill_id.clone()))
        .ok_or_else(|| {
            "read_skill_resource requires skill_id when no skill is active; call activate_skill first"
                .to_string()
        })?;
    let path = arguments
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "read_skill_resource requires path".to_string())?;
    let max_bytes = arguments
        .get("max_bytes")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_RESOURCE_READ_BYTES)
        .clamp(1, HARD_RESOURCE_READ_BYTES);
    let offset = arguments.get("offset").and_then(Value::as_u64).unwrap_or(0);

    let result = read_skill_resource(app_state, &skill_id, path, max_bytes, offset).await?;
    let mut next_state = active_skill
        .cloned()
        .unwrap_or_else(|| ActiveSkillContextState {
            skill_id: skill_id.clone(),
            ..Default::default()
        });
    if next_state.skill_id != skill_id {
        next_state = ActiveSkillContextState {
            skill_id: skill_id.clone(),
            ..Default::default()
        };
    }
    if let Some(resource_path) = result.get("path").and_then(Value::as_str) {
        next_state.record_resource_read(resource_path);
    }
    Ok((next_state, result))
}

async fn activate_skill(
    app_state: &AppState,
    skill_id: &str,
) -> Result<(ActiveSkillContextState, Value), String> {
    let install = app_state
        .mcp
        .store
        .get_local_skill_install_detail(skill_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("skill '{}' is not installed locally", skill_id))?;
    if !install.is_enabled {
        return Err(format!(
            "skill '{}' is installed but disabled",
            install.skill_id
        ));
    }

    let root = canonical_skill_root(&install.install_path)?;
    let doc_path = root.join("SKILL.md");
    let (instructions, doc_hash, doc_length, doc_truncated) =
        read_skill_doc_preview(&doc_path, DEFAULT_SKILL_DOC_MAX_BYTES)?;
    let resources = collect_resource_index(&root);
    let state = ActiveSkillContextState {
        skill_id: install.skill_id.clone(),
        doc_hash: doc_hash.clone(),
        doc_length,
        resources_read: Vec::new(),
    };
    let result = json!({
        "status": "active",
        "scope": "request",
        "skill_id": install.skill_id,
        "installed_version": install.installed_version,
        "runtime": install.runtime,
        "instructions_path": "SKILL.md",
        "instructions": instructions,
        "instructions_hash": doc_hash,
        "instructions_length": doc_length,
        "instructions_truncated": doc_truncated,
        "resource_index": resources,
        "next_step": "Use read_skill_resource for package-local references/examples/templates/scripts named by SKILL.md. Use shell_execute only for actual command execution."
    });
    Ok((state, result))
}

async fn read_skill_resource(
    app_state: &AppState,
    skill_id: &str,
    requested_path: &str,
    max_bytes: usize,
    offset: u64,
) -> Result<Value, String> {
    let install = app_state
        .mcp
        .store
        .get_local_skill_install_detail(skill_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("skill '{}' is not installed locally", skill_id))?;
    if !install.is_enabled {
        return Err(format!(
            "skill '{}' is installed but disabled",
            install.skill_id
        ));
    }

    let root = canonical_skill_root(&install.install_path)?;
    let relative_path = normalize_package_relative_path(requested_path)?;
    let target = root.join(&relative_path);
    let canonical_target = fs::canonicalize(&target).map_err(|err| {
        format!(
            "skill resource '{}' is not readable: {}",
            requested_path, err
        )
    })?;
    if !canonical_target.starts_with(&root) {
        return Err(format!(
            "skill resource '{}' escapes the skill package root",
            requested_path
        ));
    }
    if !canonical_target.is_file() {
        return Err(format!(
            "skill resource '{}' is not a regular file",
            requested_path
        ));
    }

    let metadata = fs::metadata(&canonical_target).map_err(|err| err.to_string())?;
    let total_bytes = metadata.len();
    let mut file = fs::File::open(&canonical_target).map_err(|err| err.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|err| err.to_string())?;
    let mut buffer = vec![0_u8; max_bytes.saturating_add(1)];
    let bytes_read = file.read(&mut buffer).map_err(|err| err.to_string())?;
    buffer.truncate(bytes_read.min(max_bytes));
    let truncated =
        bytes_read > max_bytes || offset.saturating_add(bytes_read as u64) < total_bytes;
    let text = String::from_utf8(buffer).map_err(|_| {
        format!(
            "skill resource '{}' is not valid UTF-8 text; binary resources are not exposed to the model",
            requested_path
        )
    })?;
    let returned_bytes = text.as_bytes().len() as u64;
    let next_offset = if truncated {
        Some(offset.saturating_add(returned_bytes))
    } else {
        None
    };

    Ok(json!({
        "skill_id": install.skill_id,
        "path": relative_path.to_string_lossy().replace('\\', "/"),
        "content": text,
        "offset": offset,
        "bytes_returned": returned_bytes,
        "total_bytes": total_bytes,
        "truncated": truncated,
        "next_offset": next_offset,
    }))
}

fn canonical_skill_root(install_path: &str) -> Result<PathBuf, String> {
    let trimmed = install_path.trim();
    if trimmed.is_empty() {
        return Err("skill install path is empty".to_string());
    }
    let root = PathBuf::from(trimmed);
    fs::canonicalize(&root).map_err(|err| format!("skill install path is not readable: {}", err))
}

fn normalize_package_relative_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err("resource path is required".to_string());
    }
    let candidate = Path::new(&trimmed);
    if candidate.is_absolute() {
        return Err("resource path must be package-relative".to_string());
    }
    let mut normalized = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("resource path must stay inside the skill package".to_string());
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err("resource path is required".to_string());
    }
    Ok(normalized)
}

fn read_skill_doc_preview(
    path: &Path,
    max_bytes: usize,
) -> Result<(String, Option<String>, usize, bool), String> {
    if !path.exists() {
        return Ok((String::new(), None, 0, false));
    }
    let bytes = fs::read(path).map_err(|err| format!("failed to read SKILL.md: {}", err))?;
    let hash = Some(sha256_hex(&bytes));
    let length = bytes.len();
    let truncated = length > max_bytes;
    let slice = if truncated {
        &bytes[..max_bytes]
    } else {
        bytes.as_slice()
    };
    let text = String::from_utf8_lossy(slice).to_string();
    Ok((text, hash, length, truncated))
}

fn collect_resource_index(root: &Path) -> Vec<Value> {
    let mut entries = Vec::new();
    for file in ROOT_RESOURCE_FILES {
        let path = root.join(file);
        if path.is_file() {
            push_resource_entry(root, &path, "file", &mut entries);
        }
    }
    for dir in RESOURCE_DIRS {
        let path = root.join(dir);
        if path.is_dir() {
            collect_resource_dir(root, &path, 0, &mut entries);
        }
        if entries.len() >= RESOURCE_INDEX_LIMIT {
            break;
        }
    }
    entries
}

fn collect_resource_dir(root: &Path, dir: &Path, depth: usize, entries: &mut Vec<Value>) {
    if depth > 3 || entries.len() >= RESOURCE_INDEX_LIMIT {
        return;
    }
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if file_name.starts_with('.') || matches!(file_name, "node_modules" | "target" | ".venv") {
            continue;
        }
        if path.is_dir() {
            collect_resource_dir(root, &path, depth + 1, entries);
        } else if path.is_file() {
            push_resource_entry(root, &path, "file", entries);
        }
        if entries.len() >= RESOURCE_INDEX_LIMIT {
            break;
        }
    }
}

fn push_resource_entry(root: &Path, path: &Path, kind: &str, entries: &mut Vec<Value>) {
    if entries.len() >= RESOURCE_INDEX_LIMIT {
        return;
    }
    let Ok(relative) = path.strip_prefix(root) else {
        return;
    };
    let size_bytes = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    entries.push(json!({
        "path": relative.to_string_lossy().replace('\\', "/"),
        "kind": kind,
        "size_bytes": size_bytes,
    }));
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::normalize_package_relative_path;

    #[test]
    fn normalize_package_relative_path_rejects_escape() {
        assert!(normalize_package_relative_path("../SKILL.md").is_err());
        assert!(normalize_package_relative_path("/tmp/SKILL.md").is_err());
        assert!(normalize_package_relative_path("references/../SKILL.md").is_err());
    }

    #[test]
    fn normalize_package_relative_path_accepts_nested_resource() {
        let path = normalize_package_relative_path("references/guide.md").expect("path");
        assert_eq!(
            path.to_string_lossy().replace('\\', "/"),
            "references/guide.md"
        );
    }
}
