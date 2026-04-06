use std::path::{Path, PathBuf};

use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::modules::custom_task_agents::store::{
    create_custom_task_agent, list_custom_task_agents, update_custom_task_agent,
};
use crate::modules::custom_task_agents::types::{
    ClaudeAgentImportPreviewItem, ClaudeAgentImportPreviewResponse, CreateCustomTaskAgentRequest,
    ImportClaudeAgentsResponse, UpdateCustomTaskAgentRequest,
};
use crate::modules::custom_task_agents::import_templates::resolve_import_binding_defaults;
use crate::modules::mcp::store::McpStore;
use crate::utils::configure_background_tokio_command;

const CLAUDE_AGENT_SOURCE_KIND: &str = "claude_agent";

#[derive(Debug, Clone)]
struct ParsedClaudeAgentFile {
    source_path: String,
    relative_path: String,
    name: String,
    description: Option<String>,
    task_prompt: String,
    tags: Vec<String>,
    source_hash: String,
}

pub(crate) fn default_claude_agents_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".claude").join("agents"))
        .ok_or_else(|| "home directory is unavailable".to_string())
}

pub(crate) async fn preview_claude_agents_import(
    store: &McpStore,
    source_path: Option<&str>,
    repo_url: Option<&str>,
    revision: Option<&str>,
) -> Result<ClaudeAgentImportPreviewResponse, String> {
    let import_source = prepare_import_source(source_path, repo_url, revision).await?;
    let parsed_files = collect_parsed_claude_agent_files(import_source.root_path())?;
    let existing = list_custom_task_agents(store)
        .await
        .map_err(|err| err.to_string())?;

    let mut items = Vec::new();
    for item in parsed_files {
        let defaults = resolve_import_binding_defaults(
            store,
            &item.tags,
            &item.relative_path,
            &item.name,
        )
        .await?;
        let existing_profile = existing.iter().find(|profile| {
            profile.source_kind.as_deref() == Some(CLAUDE_AGENT_SOURCE_KIND)
                && normalized_paths_match(profile.source_path.as_deref(), &item.source_path)
        });
        items.push(ClaudeAgentImportPreviewItem {
            source_path: item.source_path,
            relative_path: item.relative_path,
            name: item.name,
            description: item.description,
            tags: item.tags,
            inferred_mcp_tool_ids: defaults.callable_mcp_tool_ids,
            inferred_guidance_skill_ids: defaults.guidance_skill_ids,
            exists: existing_profile.is_some(),
            existing_agent_id: existing_profile.map(|profile| profile.id.clone()),
            existing_agent_name: existing_profile.map(|profile| profile.name.clone()),
        });
    }

    Ok(ClaudeAgentImportPreviewResponse {
        root_path: normalize_path(import_source.root_path()),
        items,
    })
}

pub(crate) async fn import_claude_agents(
    store: &McpStore,
    source_path: Option<&str>,
    repo_url: Option<&str>,
    revision: Option<&str>,
) -> Result<ImportClaudeAgentsResponse, String> {
    let import_source = prepare_import_source(source_path, repo_url, revision).await?;
    let parsed_files = collect_parsed_claude_agent_files(import_source.root_path())?;
    let existing = list_custom_task_agents(store)
        .await
        .map_err(|err| err.to_string())?;

    let mut profiles = Vec::new();
    let mut created_count = 0usize;
    let mut updated_count = 0usize;

    for parsed in parsed_files {
        if let Some(existing_profile) = existing.iter().find(|profile| {
            profile.source_kind.as_deref() == Some(CLAUDE_AGENT_SOURCE_KIND)
                && normalized_paths_match(profile.source_path.as_deref(), &parsed.source_path)
        }) {
            let updated = update_custom_task_agent(
                store,
                &existing_profile.id,
                UpdateCustomTaskAgentRequest {
                    name: Some(parsed.name.clone()),
                    description: Some(parsed.description.clone().unwrap_or_default()),
                    task_prompt: Some(parsed.task_prompt.clone()),
                    invocation_kind: None,
                    preferred_for_image_generation: None,
                    model_config: None,
                    callable_mcp_tool_ids: None,
                    guidance_skill_ids: None,
                    callable_skill_action_refs: None,
                    tags: Some(merge_tags(&existing_profile.tags, &parsed.tags)),
                    discoverable: None,
                    is_enabled: None,
                    source_kind: Some(CLAUDE_AGENT_SOURCE_KIND.to_string()),
                    source_path: Some(parsed.source_path.clone()),
                    source_repo: repo_url
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string),
                    source_ref: revision
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string),
                    source_hash: Some(parsed.source_hash.clone()),
                },
            )
            .await
            .map_err(|err| err.to_string())?;
            profiles.push(updated);
            updated_count += 1;
            continue;
        }

        let defaults = resolve_import_binding_defaults(
            store,
            &parsed.tags,
            &parsed.relative_path,
            &parsed.name,
        )
        .await?;
        let created = create_custom_task_agent(
            store,
            CreateCustomTaskAgentRequest {
                name: parsed.name.clone(),
                description: parsed.description.clone(),
                task_prompt: parsed.task_prompt.clone(),
                invocation_kind: None,
                preferred_for_image_generation: None,
                model_config: None,
                callable_mcp_tool_ids: defaults.callable_mcp_tool_ids,
                guidance_skill_ids: defaults.guidance_skill_ids,
                callable_skill_action_refs: Vec::new(),
                tags: Some(parsed.tags.clone()),
                discoverable: Some(true),
                is_enabled: Some(true),
                source_kind: Some(CLAUDE_AGENT_SOURCE_KIND.to_string()),
                source_path: Some(parsed.source_path.clone()),
                source_repo: repo_url
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                source_ref: revision
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                source_hash: Some(parsed.source_hash.clone()),
            },
        )
        .await
        .map_err(|err| err.to_string())?;
        profiles.push(created);
        created_count += 1;
    }

    Ok(ImportClaudeAgentsResponse {
        root_path: normalize_path(import_source.root_path()),
        created_count,
        updated_count,
        profiles,
    })
}

enum PreparedImportSource {
    Local(PathBuf),
    TempClone { root_path: PathBuf, temp_dir: PathBuf },
}

impl PreparedImportSource {
    fn root_path(&self) -> &Path {
        match self {
            Self::Local(path) => path.as_path(),
            Self::TempClone { root_path, .. } => root_path.as_path(),
        }
    }
}

impl Drop for PreparedImportSource {
    fn drop(&mut self) {
        if let Self::TempClone { temp_dir, .. } = self {
            let _ = std::fs::remove_dir_all(temp_dir);
        }
    }
}

async fn prepare_import_source(
    source_path: Option<&str>,
    repo_url: Option<&str>,
    revision: Option<&str>,
) -> Result<PreparedImportSource, String> {
    let normalized_source_path = source_path
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let normalized_repo_url = repo_url
        .map(str::trim)
        .filter(|value| !value.is_empty());

    match (normalized_source_path, normalized_repo_url) {
        (Some(_), Some(_)) => Err("provide either source_path or repo_url, not both".to_string()),
        (Some(path), None) => Ok(PreparedImportSource::Local(resolve_import_root_path(path)?)),
        (None, Some(url)) => clone_import_repo(url, revision).await,
        (None, None) => {
            let path = default_claude_agents_dir()?;
            let canonical = std::fs::canonicalize(&path)
                .map_err(|err| format!("failed to resolve import path {}: {}", path.display(), err))?;
            if !canonical.exists() {
                return Err(format!("import path does not exist: {}", canonical.display()));
            }
            Ok(PreparedImportSource::Local(canonical))
        }
    }
}

fn resolve_import_root_path(source_path: &str) -> Result<PathBuf, String> {
    let raw = PathBuf::from(source_path.trim());
    let canonical = std::fs::canonicalize(&raw)
        .map_err(|err| format!("failed to resolve import path {}: {}", raw.display(), err))?;
    if !canonical.exists() {
        return Err(format!("import path does not exist: {}", canonical.display()));
    }
    Ok(canonical)
}

async fn clone_import_repo(
    repo_url: &str,
    revision: Option<&str>,
) -> Result<PreparedImportSource, String> {
    let normalized_repo = repo_url.trim();
    if normalized_repo.is_empty() {
        return Err("repo_url is empty".to_string());
    }
    if !is_allowed_repo_url(normalized_repo) {
        return Err("repo URL is not in the allowed host list".to_string());
    }

    let temp_dir = std::env::temp_dir().join(format!("claude-agent-import-{}", Uuid::new_v4()));
    let mut cmd = tokio::process::Command::new("git");
    configure_background_tokio_command(&mut cmd);
    cmd.arg("clone").arg("--depth").arg("1");
    if let Some(rev) = revision.map(str::trim).filter(|value| !value.is_empty()) {
        cmd.arg("--branch").arg(rev);
    }
    cmd.arg(normalized_repo).arg(&temp_dir);
    let output = cmd.output().await.map_err(|err| err.to_string())?;
    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "git clone failed: {}",
            if stderr.is_empty() { "unknown error" } else { &stderr }
        ));
    }
    Ok(PreparedImportSource::TempClone {
        root_path: temp_dir.clone(),
        temp_dir,
    })
}

fn is_allowed_repo_url(repo_url: &str) -> bool {
    let normalized = repo_url.trim().to_ascii_lowercase();
    normalized.starts_with("https://github.com/") || normalized.starts_with("git@github.com:")
}

fn collect_parsed_claude_agent_files(root_path: &Path) -> Result<Vec<ParsedClaudeAgentFile>, String> {
    let markdown_files = collect_markdown_files(root_path)?;
    let mut parsed = markdown_files
        .into_iter()
        .filter_map(|file_path| parse_claude_agent_file(root_path, &file_path).transpose())
        .collect::<Result<Vec<_>, _>>()?;
    parsed.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(parsed)
}

fn collect_markdown_files(root_path: &Path) -> Result<Vec<PathBuf>, String> {
    if root_path.is_file() {
        return if is_markdown_path(root_path) {
            Ok(vec![root_path.to_path_buf()])
        } else {
            Err(format!(
                "import path is not a markdown file: {}",
                root_path.display()
            ))
        };
    }

    let mut files = Vec::new();
    collect_markdown_files_recursive(root_path, &mut files)?;
    Ok(files)
}

fn collect_markdown_files_recursive(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_markdown_files_recursive(&path, files)?;
            continue;
        }
        if is_markdown_path(&path) {
            files.push(path);
        }
    }
    Ok(())
}

fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase()),
        Some(ext) if ext == "md" || ext == "mdx"
    )
}

fn parse_claude_agent_file(
    root_path: &Path,
    file_path: &Path,
) -> Result<Option<ParsedClaudeAgentFile>, String> {
    let raw = std::fs::read_to_string(file_path).map_err(|err| err.to_string())?;
    let body = strip_frontmatter(&raw).unwrap_or_else(|| raw.clone());
    let body = body.trim();
    if body.is_empty() {
        return Ok(None);
    }
    let frontmatter = parse_frontmatter(&raw);
    let relative_path = if root_path.is_file() {
        file_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string()
    } else {
        file_path
            .strip_prefix(root_path)
            .unwrap_or(file_path)
            .to_string_lossy()
            .replace('\\', "/")
    };
    let fallback_name = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(slug_to_title)
        .unwrap_or_else(|| "Imported Agent".to_string());
    let name = frontmatter
        .as_ref()
        .and_then(|value| select_frontmatter_string(value, &["name", "title"]))
        .unwrap_or(fallback_name);
    let description = frontmatter
        .as_ref()
        .and_then(|value| select_frontmatter_string(value, &["description", "summary"]));
    let tags = build_tags_from_relative_path(&relative_path);
    let source_path = normalize_path(file_path);
    let source_hash = compute_sha256_hex(raw.as_bytes());

    Ok(Some(ParsedClaudeAgentFile {
        source_path,
        relative_path,
        name,
        description,
        task_prompt: body.to_string(),
        tags,
        source_hash,
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

fn select_frontmatter_string(frontmatter: &JsonValue, keys: &[&str]) -> Option<String> {
    let obj = frontmatter.as_object()?;
    keys.iter().find_map(|key| {
        obj.get(*key)
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
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

fn build_tags_from_relative_path(relative_path: &str) -> Vec<String> {
    let mut tags = relative_path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.trim_end_matches(".md").trim_end_matches(".mdx"))
        .map(|segment| segment.replace(['_', '.'], "-"))
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.to_ascii_lowercase())
        .collect::<Vec<_>>();
    if !tags.iter().any(|tag| tag == "claude-agent") {
        tags.push("claude-agent".to_string());
    }
    dedupe_strings(tags)
}

fn dedupe_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
            continue;
        }
        result.push(trimmed.to_string());
    }
    result
}

fn merge_tags(existing: &[String], imported: &[String]) -> Vec<String> {
    let mut combined = existing.to_vec();
    combined.extend(imported.iter().cloned());
    dedupe_strings(combined)
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalized_paths_match(left: Option<&str>, right: &str) -> bool {
    let Some(left) = left else {
        return false;
    };
    left.replace('\\', "/").eq_ignore_ascii_case(&right.replace('\\', "/"))
}

fn compute_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::{
        build_tags_from_relative_path, import_claude_agents, parse_frontmatter,
        preview_claude_agents_import, strip_frontmatter, CLAUDE_AGENT_SOURCE_KIND,
    };
    use crate::modules::mcp::store::McpStore;
    use std::path::PathBuf;

    async fn create_test_store(name: &str) -> McpStore {
        let db_path = std::env::temp_dir().join(format!("claude-agent-import-{name}.db"));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        let store = McpStore::new(&database_url).await.expect("create store");
        store.init().await.expect("init store");
        store
    }

    fn create_temp_agents_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("claude-agent-dir-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp agents dir");
        dir
    }

    #[test]
    fn strip_frontmatter_returns_body_only() {
        let raw = "---\nname: Frontend Developer\ndescription: Builds UI\n---\n\n# Prompt\n";
        let body = strip_frontmatter(raw).expect("body");
        assert_eq!(body.trim(), "# Prompt");
    }

    #[test]
    fn parse_frontmatter_reads_basic_fields() {
        let raw = "---\nname: Frontend Developer\ndescription: Builds UI\n---\n\n# Prompt\n";
        let value = parse_frontmatter(raw).expect("frontmatter");
        assert_eq!(value.get("name").and_then(|item| item.as_str()), Some("Frontend Developer"));
    }

    #[test]
    fn build_tags_from_relative_path_includes_category_and_source_tag() {
        let tags = build_tags_from_relative_path("engineering/frontend-developer.md");
        assert!(tags.iter().any(|tag| tag == "engineering"));
        assert!(tags.iter().any(|tag| tag == "frontend-developer"));
        assert!(tags.iter().any(|tag| tag == "claude-agent"));
    }

    #[tokio::test]
    async fn preview_claude_import_lists_markdown_agents() {
        let store = create_test_store("preview").await;
        let dir = create_temp_agents_dir("preview");
        std::fs::create_dir_all(dir.join("engineering")).expect("create nested dir");
        std::fs::write(
            dir.join("engineering").join("frontend-developer.md"),
            "---\nname: Frontend Developer\ndescription: Builds UI\n---\n\n# Prompt\nShip the UI.\n",
        )
        .expect("write agent file");

        let preview = preview_claude_agents_import(
            &store,
            Some(dir.to_string_lossy().as_ref()),
            None,
            None,
        )
        .await
        .expect("preview import");

        assert_eq!(preview.items.len(), 1);
        assert_eq!(preview.items[0].name, "Frontend Developer");
        assert!(!preview.items[0].exists);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn import_claude_agents_creates_and_updates_profiles() {
        let store = create_test_store("import").await;
        let dir = create_temp_agents_dir("import");
        std::fs::write(
            dir.join("planner.md"),
            "---\nname: Planner\ndescription: Plans work\n---\n\nPlan the delegated task.\n",
        )
        .expect("write planner");

        let first = import_claude_agents(&store, Some(dir.to_string_lossy().as_ref()), None, None)
            .await
            .expect("first import");
        assert_eq!(first.created_count, 1);
        assert_eq!(first.updated_count, 0);
        assert_eq!(first.profiles[0].source_kind.as_deref(), Some(CLAUDE_AGENT_SOURCE_KIND));

        std::fs::write(
            dir.join("planner.md"),
            "---\nname: Planner\ndescription: Plans work better\n---\n\nPlan the delegated task with more detail.\n",
        )
        .expect("rewrite planner");

        let second = import_claude_agents(&store, Some(dir.to_string_lossy().as_ref()), None, None)
            .await
            .expect("second import");
        assert_eq!(second.created_count, 0);
        assert_eq!(second.updated_count, 1);
        assert_eq!(second.profiles[0].description.as_deref(), Some("Plans work better"));
        assert!(second.profiles[0].task_prompt.contains("more detail"));

        let _ = std::fs::remove_dir_all(dir);
    }
}
