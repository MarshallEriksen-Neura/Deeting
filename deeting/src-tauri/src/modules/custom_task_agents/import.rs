use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};

use crate::modules::custom_task_agents::import_templates::resolve_import_binding_defaults;
use crate::modules::custom_task_agents::store::{
    create_custom_task_agent, list_custom_task_agents, update_custom_task_agent,
};
use crate::modules::custom_task_agents::types::{
    ClaudeAgentImportPreviewItem, ClaudeAgentImportPreviewResponse, CreateCustomTaskAgentRequest,
    ImportClaudeAgentsResponse, UpdateCustomTaskAgentRequest, UploadedClaudeAgentDocument,
};
use crate::modules::mcp::store::McpStore;

const CLAUDE_AGENT_SOURCE_KIND: &str = "claude_agent";
const UPLOADED_CLAUDE_AGENT_ROOT: &str = "uploaded-files";

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

pub(crate) async fn preview_claude_agents_import(
    store: &McpStore,
    documents: &[UploadedClaudeAgentDocument],
) -> Result<ClaudeAgentImportPreviewResponse, String> {
    let parsed_files = collect_parsed_claude_agent_documents(documents)?;
    let existing = list_custom_task_agents(store)
        .await
        .map_err(|err| err.to_string())?;

    let mut items = Vec::new();
    for item in parsed_files {
        let defaults =
            resolve_import_binding_defaults(store, &item.tags, &item.relative_path, &item.name)
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
        root_path: UPLOADED_CLAUDE_AGENT_ROOT.to_string(),
        items,
    })
}

pub(crate) async fn import_claude_agents(
    store: &McpStore,
    documents: &[UploadedClaudeAgentDocument],
) -> Result<ImportClaudeAgentsResponse, String> {
    let parsed_files = collect_parsed_claude_agent_documents(documents)?;
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
                    source_repo: None,
                    source_ref: None,
                    source_hash: Some(parsed.source_hash.clone()),
                },
            )
            .await
            .map_err(|err| err.to_string())?;
            profiles.push(updated);
            updated_count += 1;
            continue;
        }

        let defaults =
            resolve_import_binding_defaults(store, &parsed.tags, &parsed.relative_path, &parsed.name)
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
                source_repo: None,
                source_ref: None,
                source_hash: Some(parsed.source_hash.clone()),
            },
        )
        .await
        .map_err(|err| err.to_string())?;
        profiles.push(created);
        created_count += 1;
    }

    Ok(ImportClaudeAgentsResponse {
        root_path: UPLOADED_CLAUDE_AGENT_ROOT.to_string(),
        created_count,
        updated_count,
        profiles,
    })
}

fn collect_parsed_claude_agent_documents(
    documents: &[UploadedClaudeAgentDocument],
) -> Result<Vec<ParsedClaudeAgentFile>, String> {
    if documents.is_empty() {
        return Err("at least one markdown file is required".to_string());
    }

    let mut parsed = documents
        .iter()
        .filter_map(|document| parse_uploaded_claude_agent_document(document).transpose())
        .collect::<Result<Vec<_>, _>>()?;
    parsed.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(parsed)
}

fn parse_uploaded_claude_agent_document(
    document: &UploadedClaudeAgentDocument,
) -> Result<Option<ParsedClaudeAgentFile>, String> {
    let relative_path = normalize_uploaded_relative_path(document)?;
    if !is_markdown_relative_path(&relative_path) {
        return Err(format!("uploaded file is not markdown: {}", relative_path));
    }

    let raw = document.content.replace("\r\n", "\n");
    let body = strip_frontmatter(&raw).unwrap_or_else(|| raw.clone());
    let body = body.trim();
    if body.is_empty() {
        return Ok(None);
    }

    let frontmatter = parse_frontmatter(&raw);
    let fallback_name = relative_path
        .rsplit('/')
        .next()
        .map(|filename| filename.trim_end_matches(".md").trim_end_matches(".mdx"))
        .filter(|value| !value.is_empty())
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
    let source_hash = compute_sha256_hex(raw.as_bytes());

    Ok(Some(ParsedClaudeAgentFile {
        source_path: build_uploaded_source_path(&relative_path),
        relative_path,
        name,
        description,
        task_prompt: body.to_string(),
        tags,
        source_hash,
    }))
}

fn normalize_uploaded_relative_path(document: &UploadedClaudeAgentDocument) -> Result<String, String> {
    let candidate = document
        .relative_path
        .as_deref()
        .unwrap_or(document.filename.as_str())
        .trim()
        .replace('\\', "/");
    let normalized = candidate.trim_start_matches('/').to_string();
    if normalized.is_empty() {
        return Err("uploaded markdown file is missing a filename".to_string());
    }
    Ok(normalized)
}

fn is_markdown_relative_path(path: &str) -> bool {
    let lower = path.trim().to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".mdx")
}

fn build_uploaded_source_path(relative_path: &str) -> String {
    format!("upload://{}", relative_path.trim_start_matches('/'))
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

fn normalized_paths_match(left: Option<&str>, right: &str) -> bool {
    let Some(left) = left else {
        return false;
    };
    left.replace('\\', "/").eq_ignore_ascii_case(&right.replace('\\', "/"))
}

fn compute_sha256_hex(raw: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::{
        build_tags_from_relative_path, import_claude_agents, parse_frontmatter,
        preview_claude_agents_import, UploadedClaudeAgentDocument, UPLOADED_CLAUDE_AGENT_ROOT,
    };
    use crate::modules::mcp::store::McpStore;
    use uuid::Uuid;

    async fn create_test_store(test_name: &str) -> McpStore {
        let mut db_path = std::env::temp_dir();
        db_path.push(format!(
            "deeting-custom-task-agent-import-{test_name}-{}.db",
            Uuid::new_v4()
        ));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        let store = McpStore::new(&database_url).await.expect("create test store");
        store.init().await.expect("init test store");
        store.ensure_local_source().await.expect("ensure local source");
        store
    }

    fn uploaded_doc(filename: &str, content: &str) -> UploadedClaudeAgentDocument {
        UploadedClaudeAgentDocument {
            filename: filename.to_string(),
            relative_path: Some(filename.to_string()),
            content: content.to_string(),
        }
    }

    #[test]
    fn parse_frontmatter_returns_json() {
        let value = parse_frontmatter(
            "---\nname: Frontend Developer\ndescription: Builds UI\n---\n\n# Prompt\nShip it.\n",
        )
        .expect("frontmatter");

        assert_eq!(value.get("name").and_then(|value| value.as_str()), Some("Frontend Developer"));
        assert_eq!(value.get("description").and_then(|value| value.as_str()), Some("Builds UI"));
    }

    #[test]
    fn build_tags_from_relative_path_includes_category_and_source_tag() {
        let tags = build_tags_from_relative_path("engineering/frontend-developer.md");
        assert!(tags.iter().any(|tag| tag == "engineering"));
        assert!(tags.iter().any(|tag| tag == "frontend-developer"));
        assert!(tags.iter().any(|tag| tag == "claude-agent"));
    }

    #[tokio::test]
    async fn preview_claude_import_lists_uploaded_markdown_agents() {
        let store = create_test_store("preview").await;
        let preview = preview_claude_agents_import(
            &store,
            &[UploadedClaudeAgentDocument {
                filename: "frontend-developer.md".to_string(),
                relative_path: Some("engineering/frontend-developer.md".to_string()),
                content: "---\nname: Frontend Developer\ndescription: Builds UI\n---\n\n# Prompt\nShip the UI.\n"
                    .to_string(),
            }],
        )
        .await
        .expect("preview import");

        assert_eq!(preview.root_path, UPLOADED_CLAUDE_AGENT_ROOT);
        assert_eq!(preview.items.len(), 1);
        assert_eq!(preview.items[0].name, "Frontend Developer");
        assert!(!preview.items[0].exists);
    }

    #[tokio::test]
    async fn import_claude_agents_creates_and_updates_profiles() {
        let store = create_test_store("import").await;

        let first = import_claude_agents(
            &store,
            &[uploaded_doc(
                "planner.md",
                "---\nname: Planner\ndescription: Plans work\n---\n\nPlan the delegated task.\n",
            )],
        )
        .await
        .expect("first import");
        assert_eq!(first.created_count, 1);
        assert_eq!(first.updated_count, 0);
        assert_eq!(first.profiles[0].source_kind.as_deref(), Some("claude_agent"));

        let second = import_claude_agents(
            &store,
            &[uploaded_doc(
                "planner.md",
                "---\nname: Planner\ndescription: Plans work better\n---\n\nPlan the delegated task with more detail.\n",
            )],
        )
        .await
        .expect("second import");
        assert_eq!(second.created_count, 0);
        assert_eq!(second.updated_count, 1);
        assert_eq!(second.profiles[0].description.as_deref(), Some("Plans work better"));
        assert!(second.profiles[0].task_prompt.contains("more detail"));
    }
}
