use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

pub(super) const LLM_WIKI_CONFIG_KEY: &str = "llm_wiki.binding.v1";
pub(super) const LLM_WIKI_LAST_BOOTSTRAPPED_AT_KEY: &str = "llm_wiki.last_bootstrapped_at";
pub(super) const DEFAULT_WORKSPACE_RELATIVE_PATH: &str = "Deeting Wiki";
pub(super) const READ_SCOPE_WHOLE_VAULT: &str = "whole_vault";
pub(super) const WRITE_SCOPE_MANAGED_WORKSPACE: &str = "managed_workspace";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct PersistedLlmWikiBinding {
    pub(super) vault_root: String,
    pub(super) workspace_relative_path: String,
}

pub(super) async fn load_binding(
    store: &McpStore,
) -> Result<Option<PersistedLlmWikiBinding>, McpError> {
    let Some(raw) = store.get_desktop_config(LLM_WIKI_CONFIG_KEY).await? else {
        return Ok(None);
    };

    if raw.trim().is_empty() {
        return Ok(None);
    }

    serde_json::from_str::<PersistedLlmWikiBinding>(&raw)
        .map(Some)
        .map_err(|err| McpError::Storage(format!("invalid llm wiki binding config: {}", err)))
}

pub(super) async fn save_binding(
    store: &McpStore,
    binding: &PersistedLlmWikiBinding,
) -> Result<(), McpError> {
    let raw = serde_json::to_string(binding)
        .map_err(|err| McpError::Storage(format!("serialize llm wiki binding failed: {}", err)))?;
    store.set_desktop_config(LLM_WIKI_CONFIG_KEY, &raw).await
}

pub(super) async fn load_last_bootstrapped_at(
    store: &McpStore,
) -> Result<Option<String>, McpError> {
    store
        .get_desktop_config(LLM_WIKI_LAST_BOOTSTRAPPED_AT_KEY)
        .await
}

pub(super) async fn save_last_bootstrapped_at(
    store: &McpStore,
    value: &str,
) -> Result<(), McpError> {
    store
        .set_desktop_config(LLM_WIKI_LAST_BOOTSTRAPPED_AT_KEY, value)
        .await
}

pub(super) fn normalize_vault_root(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("vault root is required".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err("vault root does not exist".to_string());
    }
    if !path.is_dir() {
        return Err("vault root must be a directory".to_string());
    }

    path.canonicalize()
        .map_err(|err| format!("failed to resolve vault root: {}", err))
}

pub(super) fn normalize_workspace_relative_path(raw: Option<&str>) -> Result<String, String> {
    let candidate = raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_WORKSPACE_RELATIVE_PATH);

    let path = Path::new(candidate);
    if path.is_absolute() {
        return Err("workspace path must be relative to the vault root".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(value) => normalized.push(value),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("workspace path cannot escape the vault root".to_string())
            }
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err("workspace path is required".to_string());
    }

    Ok(normalized.to_string_lossy().to_string())
}

pub(super) fn resolve_workspace_path(vault_root: &Path, relative_path: &str) -> PathBuf {
    vault_root.join(relative_path)
}
