use std::path::{Path, PathBuf};

use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};

use crate::modules::custom_task_agents::import_templates::resolve_import_binding_defaults;
use crate::modules::custom_task_agents::service::{
    create_custom_task_agent_service, update_custom_task_agent_service,
};
use crate::modules::custom_task_agents::store::list_custom_task_agents;
use crate::modules::custom_task_agents::types::{
    CreateCustomTaskAgentRequest, ExternalAgentCandidate, ImportExternalAgentsResponse,
    ScanExternalAgentsResponse, UpdateCustomTaskAgentRequest,
};
use crate::modules::mcp::store::McpStore;
use crate::state::AppState;

const CLAUDE_AGENT_SOURCE_KIND: &str = "claude_agent";
const CODEX_AGENT_SOURCE_KIND: &str = "codex_agent";

#[derive(Debug, Clone)]
struct ParsedExternalAgent {
    source_kind: String,
    source_path: String,
    relative_path: String,
    name: String,
    description: Option<String>,
    task_prompt: String,
    tags: Vec<String>,
    model_config: Option<JsonValue>,
    source_hash: String,
}

pub(crate) async fn scan_external_agents(
    store: &McpStore,
    roots: &[String],
    include_user_defaults: bool,
) -> Result<ScanExternalAgentsResponse, String> {
    let roots = resolve_scan_roots(roots, include_user_defaults);
    let existing = list_custom_task_agents(store)
        .await
        .map_err(|err| err.to_string())?;
    let mut candidates = Vec::new();

    for root in &roots {
        let parsed = scan_root(root)?;
        for item in parsed {
            let defaults =
                resolve_import_binding_defaults(store, &item.tags, &item.relative_path, &item.name)
                    .await?;
            let existing_profile = existing.iter().find(|profile| {
                profile.source_kind.as_deref() == Some(item.source_kind.as_str())
                    && normalized_paths_match(profile.source_path.as_deref(), &item.source_path)
            });
            candidates.push(ExternalAgentCandidate {
                source_kind: item.source_kind,
                source_path: item.source_path,
                relative_path: item.relative_path,
                name: item.name,
                description: item.description,
                task_prompt: item.task_prompt,
                tags: item.tags,
                inferred_mcp_tool_ids: defaults.callable_mcp_tool_ids,
                inferred_guidance_skill_ids: defaults.guidance_skill_ids,
                model_config: item.model_config,
                source_hash: item.source_hash,
                exists: existing_profile.is_some(),
                existing_agent_id: existing_profile.map(|profile| profile.id.clone()),
                existing_agent_name: existing_profile.map(|profile| profile.name.clone()),
            });
        }
    }

    candidates.sort_by(|left, right| left.source_path.cmp(&right.source_path));
    Ok(ScanExternalAgentsResponse {
        roots: roots
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        candidates,
    })
}

pub(crate) async fn import_external_agents(
    app_state: &AppState,
    candidates: &[ExternalAgentCandidate],
) -> Result<ImportExternalAgentsResponse, String> {
    let existing = list_custom_task_agents(app_state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?;
    let mut profiles = Vec::new();
    let mut created_count = 0usize;
    let mut updated_count = 0usize;

    for candidate in candidates {
        if let Some(existing_profile) = existing.iter().find(|profile| {
            profile.source_kind.as_deref() == Some(candidate.source_kind.as_str())
                && normalized_paths_match(profile.source_path.as_deref(), &candidate.source_path)
        }) {
            let updated = update_custom_task_agent_service(
                app_state,
                &existing_profile.id,
                UpdateCustomTaskAgentRequest {
                    name: Some(candidate.name.clone()),
                    description: Some(candidate.description.clone().unwrap_or_default()),
                    task_prompt: Some(candidate.task_prompt.clone()),
                    invocation_kind: None,
                    preferred_for_image_generation: None,
                    model_config: candidate.model_config.clone(),
                    callable_mcp_tool_ids: Some(candidate.inferred_mcp_tool_ids.clone()),
                    guidance_skill_ids: Some(candidate.inferred_guidance_skill_ids.clone()),
                    callable_skill_action_refs: Some(Vec::new()),
                    bound_asset_id: None,
                    tags: Some(candidate.tags.clone()),
                    discoverable: Some(true),
                    is_enabled: Some(true),
                    source_kind: Some(candidate.source_kind.clone()),
                    source_path: Some(candidate.source_path.clone()),
                    source_repo: None,
                    source_ref: None,
                    source_hash: Some(candidate.source_hash.clone()),
                },
            )
            .await?;
            profiles.push(updated);
            updated_count += 1;
            continue;
        }

        let created = create_custom_task_agent_service(
            app_state,
            CreateCustomTaskAgentRequest {
                name: candidate.name.clone(),
                description: candidate.description.clone(),
                task_prompt: candidate.task_prompt.clone(),
                invocation_kind: None,
                preferred_for_image_generation: None,
                model_config: candidate.model_config.clone(),
                callable_mcp_tool_ids: candidate.inferred_mcp_tool_ids.clone(),
                guidance_skill_ids: candidate.inferred_guidance_skill_ids.clone(),
                callable_skill_action_refs: Vec::new(),
                bound_asset_id: None,
                tags: Some(candidate.tags.clone()),
                discoverable: Some(true),
                is_enabled: Some(true),
                source_kind: Some(candidate.source_kind.clone()),
                source_path: Some(candidate.source_path.clone()),
                source_repo: None,
                source_ref: None,
                source_hash: Some(candidate.source_hash.clone()),
            },
        )
        .await?;
        profiles.push(created);
        created_count += 1;
    }

    Ok(ImportExternalAgentsResponse {
        created_count,
        updated_count,
        profiles,
    })
}

fn resolve_scan_roots(roots: &[String], include_user_defaults: bool) -> Vec<PathBuf> {
    let mut resolved = roots
        .iter()
        .map(|value| expand_home(value))
        .filter(|path| !path.as_os_str().is_empty())
        .collect::<Vec<_>>();
    if include_user_defaults {
        if let Some(home) = dirs::home_dir() {
            resolved.push(home.join(".claude").join("agents"));
            resolved.push(home.join(".codex").join("agents"));
        }
    }
    dedupe_paths(resolved)
}

fn scan_root(root: &Path) -> Result<Vec<ParsedExternalAgent>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    scan_dir(root, root, &mut result)?;
    Ok(result)
}

fn scan_dir(root: &Path, dir: &Path, out: &mut Vec<ParsedExternalAgent>) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            scan_dir(root, &path, out)?;
            continue;
        }
        match path.extension().and_then(|value| value.to_str()) {
            Some("md") | Some("mdx") => {
                if let Some(agent) = parse_claude_agent_file(root, &path)? {
                    out.push(agent);
                }
            }
            Some("toml") => {
                if let Some(agent) = parse_codex_agent_file(root, &path)? {
                    out.push(agent);
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn parse_claude_agent_file(
    root: &Path,
    path: &Path,
) -> Result<Option<ParsedExternalAgent>, String> {
    let raw = std::fs::read_to_string(path).map_err(|err| err.to_string())?;
    let body = strip_frontmatter(&raw).unwrap_or_else(|| raw.clone());
    let body = body.trim();
    if body.is_empty() {
        return Ok(None);
    }
    let frontmatter = parse_frontmatter(&raw);
    let relative_path = relative_path(root, path);
    let fallback_name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(slug_to_title)
        .unwrap_or_else(|| "Imported Agent".to_string());
    let name = frontmatter
        .as_ref()
        .and_then(|value| select_string(value, &["name", "title"]))
        .unwrap_or(fallback_name);
    let description = frontmatter
        .as_ref()
        .and_then(|value| select_string(value, &["description", "summary"]));
    let mut tags = tags_from_relative_path(&relative_path);
    tags.push("claude-agent".to_string());
    Ok(Some(ParsedExternalAgent {
        source_kind: CLAUDE_AGENT_SOURCE_KIND.to_string(),
        source_path: path.to_string_lossy().to_string(),
        relative_path,
        name,
        description,
        task_prompt: body.to_string(),
        tags: dedupe_strings(tags),
        model_config: None,
        source_hash: sha256_hex(raw.as_bytes()),
    }))
}

fn parse_codex_agent_file(root: &Path, path: &Path) -> Result<Option<ParsedExternalAgent>, String> {
    let raw = std::fs::read_to_string(path).map_err(|err| err.to_string())?;
    let value = raw
        .parse::<toml::Value>()
        .map_err(|err| format!("failed to parse {}: {err}", path.display()))?;
    let prompt = value
        .get("developer_instructions")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            value
                .get("instructions")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        });
    let Some(prompt) = prompt else {
        return Ok(None);
    };
    let relative_path = relative_path(root, path);
    let fallback_name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(slug_to_title)
        .unwrap_or_else(|| "Imported Agent".to_string());
    let name = value
        .get("name")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or(fallback_name);
    let description = value
        .get("description")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let model_config = codex_model_config(&value);
    let mut tags = tags_from_relative_path(&relative_path);
    tags.push("codex-agent".to_string());
    Ok(Some(ParsedExternalAgent {
        source_kind: CODEX_AGENT_SOURCE_KIND.to_string(),
        source_path: path.to_string_lossy().to_string(),
        relative_path,
        name,
        description,
        task_prompt: prompt.to_string(),
        tags: dedupe_strings(tags),
        model_config,
        source_hash: sha256_hex(raw.as_bytes()),
    }))
}

fn codex_model_config(value: &toml::Value) -> Option<JsonValue> {
    let model = value
        .get("model")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let effort = value
        .get("model_reasoning_effort")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if model.is_none() && effort.is_none() {
        return None;
    }
    Some(json!({
        "mode": "inherit_parent",
        "source_model_hint": model,
        "source_reasoning_effort": effort,
    }))
}

fn parse_frontmatter(content: &str) -> Option<JsonValue> {
    let normalized = content.replace("\r\n", "\n");
    let stripped = normalized.strip_prefix("---\n")?;
    let end = stripped.find("\n---\n")?;
    let raw = &stripped[..end];
    serde_yaml::from_str::<serde_yaml::Value>(raw)
        .ok()
        .and_then(|value| serde_json::to_value(value).ok())
}

fn strip_frontmatter(content: &str) -> Option<String> {
    let normalized = content.replace("\r\n", "\n");
    let stripped = normalized.strip_prefix("---\n")?;
    let end = stripped.find("\n---\n")?;
    Some(stripped[end + 5..].to_string())
}

fn select_string(value: &JsonValue, keys: &[&str]) -> Option<String> {
    let obj = value.as_object()?;
    keys.iter().find_map(|key| {
        obj.get(*key)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn tags_from_relative_path(relative_path: &str) -> Vec<String> {
    relative_path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            segment
                .trim_end_matches(".md")
                .trim_end_matches(".mdx")
                .trim_end_matches(".toml")
        })
        .map(|segment| segment.replace(['_', '.'], "-"))
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.to_ascii_lowercase())
        .collect()
}

fn slug_to_title(raw: &str) -> String {
    raw.replace(['-', '_', '.'], " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn expand_home(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed == "~" {
        return dirs::home_dir().unwrap_or_default();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return dirs::home_dir().unwrap_or_default().join(rest);
    }
    PathBuf::from(trimmed)
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for path in paths {
        let key = path.to_string_lossy().to_ascii_lowercase();
        if seen.insert(key) {
            result.push(path);
        }
    }
    result
}

fn dedupe_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if !trimmed.is_empty() && seen.insert(trimmed.to_string()) {
            result.push(trimmed.to_string());
        }
    }
    result
}

fn normalized_paths_match(left: Option<&str>, right: &str) -> bool {
    left.map(|value| value.replace('\\', "/")).as_deref() == Some(right.replace('\\', "/").as_str())
}

#[cfg(test)]
mod tests {
    use super::{codex_model_config, parse_codex_agent_file, parse_frontmatter, strip_frontmatter};
    use std::path::Path;

    #[test]
    fn strip_frontmatter_returns_body() {
        let content = "---\nname: Agent\n---\nBody here";
        assert_eq!(strip_frontmatter(content).as_deref(), Some("Body here"));
    }

    #[test]
    fn parse_frontmatter_reads_yaml_object() {
        let content = "---\nname: Agent\ndescription: Test\n---\nBody here";
        let value = parse_frontmatter(content).expect("frontmatter");
        assert_eq!(
            value.get("name").and_then(|value| value.as_str()),
            Some("Agent")
        );
    }

    #[test]
    fn codex_model_config_keeps_hint_and_inherit_mode() {
        let value = toml::from_str::<toml::Value>(
            r#"
name = "executor"
model = "gpt-5.4"
model_reasoning_effort = "high"
developer_instructions = "Do the work"
"#,
        )
        .expect("toml");

        let config = codex_model_config(&value).expect("config");
        assert_eq!(
            config.get("mode").and_then(|value| value.as_str()),
            Some("inherit_parent")
        );
        assert_eq!(
            config
                .get("source_model_hint")
                .and_then(|value| value.as_str()),
            Some("gpt-5.4")
        );
        assert_eq!(
            config
                .get("source_reasoning_effort")
                .and_then(|value| value.as_str()),
            Some("high")
        );
    }

    #[test]
    fn parse_codex_agent_file_extracts_prompt() {
        let dir = std::env::temp_dir().join(format!(
            "deeting-external-agent-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("executor.toml");
        std::fs::write(
            &path,
            r#"
name = "executor"
description = "Code implementation"
model = "gpt-5.4"
developer_instructions = "Complete the task"
"#,
        )
        .expect("write");

        let parsed = parse_codex_agent_file(Path::new(&dir), &path)
            .expect("parse")
            .expect("agent");
        assert_eq!(parsed.source_kind, "codex_agent");
        assert_eq!(parsed.name, "executor");
        assert_eq!(parsed.description.as_deref(), Some("Code implementation"));
        assert_eq!(parsed.task_prompt, "Complete the task");
        assert_eq!(parsed.relative_path, "executor.toml");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
