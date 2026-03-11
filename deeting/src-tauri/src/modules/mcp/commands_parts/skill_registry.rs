use super::{common_impl::to_string, support::*};
use serde_json::{Map as JsonMap, Value as JsonValue};
use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
};

pub(crate) fn normalize_skill_dir_name(skill_id: &str) -> String {
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

fn derive_skill_id_from_identifier(raw: Option<&str>) -> Option<&str> {
    let normalized = raw?.trim();
    if !normalized.starts_with("skill.") {
        return None;
    }
    Some(normalized.split('/').next().unwrap_or(normalized))
}

pub(crate) fn resolve_local_skill_scan_targets(
    app: &AppHandle,
) -> Result<Vec<(std::path::PathBuf, &'static str)>, String> {
    let official_skills_dir = app
        .path()
        .resource_dir()
        .ok()
        .map(|p| p.join("official-skills"))
        .filter(|p| p.exists())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .join("packages")
                .join("official-skills")
        });
    let user_skills_dir = app.path().app_data_dir().map_err(to_string)?.join("skills");
    if !user_skills_dir.exists() {
        let _ = std::fs::create_dir_all(&user_skills_dir);
    }

    Ok(vec![
        (official_skills_dir, "system_plugin"),
        (user_skills_dir, "user_skill"),
    ])
}

pub(crate) async fn register_local_skills_from_scan_targets_inner(
    scan_targets: &[(std::path::PathBuf, &'static str)],
    _sdk_pythonpath: &str,
    store: &crate::modules::mcp::store::McpStore,
    provider_state: std::sync::Arc<crate::modules::providers::ProviderState>,
    memory_state: std::sync::Arc<crate::modules::memory::MemoryState>,
    wait_for_vector_index: bool,
) -> Result<usize, String> {
    let mut total_indexed = 0;

    for (dir_path, source_prefix) in scan_targets {
        if !dir_path.exists() {
            continue;
        }
        for entry in std::fs::read_dir(dir_path).map_err(to_string)? {
            let skill_path = entry.map_err(to_string)?.path();
            if !skill_path.is_dir() {
                continue;
            }
            let Some(skill_def) =
                resolve_local_skill_definition(&skill_path, source_prefix, None, None)?
            else {
                continue;
            };

            let id = skill_def.skill_id.as_str();
            let version = skill_def.version.as_deref();
            let runtime_str = skill_def.runtime_values.join(",");
            let runtime = Some(runtime_str.as_str());

            store
                .upsert_local_skill_install(
                    id,
                    version,
                    runtime,
                    &skill_def.manifest_json,
                    &skill_path.to_string_lossy(),
                )
                .await
                .map_err(to_string)?;

            let _ = memory_state.service.delete_assets_by_package(id).await;

            let final_source_type = if *source_prefix == "system_plugin" {
                "builtin"
            } else {
                "user"
            }
            .to_string();
            if wait_for_vector_index {
                index_local_skill_bundle_asset(
                    provider_state.clone(),
                    memory_state.clone(),
                    id,
                    &skill_def.display_name,
                    &skill_def.description,
                    skill_def.doc_excerpt.as_deref(),
                    &skill_def.manifest_json,
                    &final_source_type,
                )
                .await?;
            } else {
                let provider_state_clone = provider_state.clone();
                let memory_state_clone = memory_state.clone();
                let skill_id = id.to_string();
                let display_name = skill_def.display_name.clone();
                let description = skill_def.description.clone();
                let doc_excerpt = skill_def.doc_excerpt.clone();
                let manifest_json = skill_def.manifest_json.clone();
                let final_source_type_clone = final_source_type.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = index_local_skill_bundle_asset(
                        provider_state_clone,
                        memory_state_clone,
                        &skill_id,
                        &display_name,
                        &description,
                        doc_excerpt.as_deref(),
                        &manifest_json,
                        &final_source_type_clone,
                    )
                    .await;
                });
            }
            total_indexed += 1;
        }
    }

    Ok(total_indexed)
}

fn is_allowed_skill_repo_url(repo_url: &str) -> bool {
    let normalized = repo_url.trim().to_ascii_lowercase();
    normalized.starts_with("https://github.com/") || normalized.starts_with("git@github.com:")
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct DeetingManifestExecution {
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
}

fn default_timeout() -> u64 {
    60
}

impl Default for DeetingManifestExecution {
    fn default() -> Self {
        Self {
            timeout_seconds: default_timeout(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct DeetingManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub entry: Option<serde_json::Value>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub restricted: bool,
    #[serde(default)]
    pub allowed_roles: Vec<String>,
    #[serde(default = "default_runtime")]
    pub runtime: Vec<String>,
    #[serde(default)]
    pub execution: DeetingManifestExecution,
    #[serde(default)]
    pub env_requirements: Vec<String>,
    #[serde(default)]
    pub capabilities: Option<serde_json::Value>,
}

fn default_runtime() -> Vec<String> {
    vec!["cloud".to_string(), "local".to_string()]
}

fn parse_deeting_manifest(raw: &str) -> Result<DeetingManifest, String> {
    serde_json::from_str::<DeetingManifest>(raw).map_err(|e| format!("invalid deeting.json: {}", e))
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub(crate) struct LocalSkillDefinition {
    pub(crate) skill_id: String,
    pub(crate) display_name: String,
    pub(crate) version: Option<String>,
    pub(crate) description: String,
    pub(crate) manifest_json: String,
    pub(crate) runtime_values: Vec<String>,
    pub(crate) env_requirements: Vec<String>,
    pub(crate) restricted: bool,
    pub(crate) allowed_roles: Vec<String>,
    pub(crate) execution_timeout_seconds: u64,
    pub(crate) doc_excerpt: Option<String>,
}

#[derive(Debug, Default)]
struct SkillBundleSnapshot {
    visible_entries: Vec<String>,
    doc_paths: Vec<String>,
    doc_excerpt: Option<String>,
    frontmatter: Option<JsonValue>,
    package_metadata: Option<JsonValue>,
    tool_manifest_path: Option<PathBuf>,
    has_ui: bool,
}

const SKILL_DOC_SCAN_DEPTH: usize = 2;
const SKILL_DOC_SCAN_LIMIT: usize = 6;
const SKILL_DOC_FILE_SIZE_LIMIT: u64 = 256 * 1024;

fn is_hidden_name(name: &OsStr) -> bool {
    name.to_str()
        .map(|value| value.starts_with('.'))
        .unwrap_or(false)
}

fn is_probably_text_document(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "md" | "mdx" | "txt" | "rst" | "adoc" | "prompt" | "yaml" | "yml" | "json" | "toml"
    )
}

fn trim_excerpt(content: &str, max_chars: usize) -> String {
    let compact = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    compact.chars().take(max_chars).collect::<String>()
}

fn first_non_empty_line(content: &str) -> Option<String> {
    content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

fn parse_frontmatter(content: &str) -> Option<JsonValue> {
    let stripped = content.strip_prefix("---\n")?;
    let end = stripped.find("\n---\n")?;
    let raw = &stripped[..end];
    serde_yaml::from_str::<serde_yaml::Value>(raw)
        .ok()
        .and_then(|value| serde_json::to_value(value).ok())
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
    let compact = raw.replace(['/', '-', '_', '.'], " ");
    compact
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

fn repo_hint_from_url(repo_url: Option<&str>) -> Option<String> {
    let trimmed = repo_url?.trim().trim_end_matches('/');
    let segment = trimmed.rsplit('/').next()?.trim_end_matches(".git");
    if segment.is_empty() {
        None
    } else {
        Some(segment.to_string())
    }
}

fn read_package_metadata(skill_path: &Path) -> Option<JsonValue> {
    let raw = std::fs::read_to_string(skill_path.join("package.json")).ok()?;
    let value = serde_json::from_str::<JsonValue>(&raw).ok()?;
    let obj = value.as_object()?;
    let mut subset = JsonMap::new();
    for key in [
        "name",
        "displayName",
        "version",
        "description",
        "keywords",
        "homepage",
        "author",
        "repository",
    ] {
        if let Some(value) = obj.get(key) {
            subset.insert(key.to_string(), value.clone());
        }
    }
    if subset.is_empty() {
        None
    } else {
        Some(JsonValue::Object(subset))
    }
}

fn collect_skill_bundle_snapshot(skill_path: &Path) -> Result<SkillBundleSnapshot, String> {
    let mut snapshot = SkillBundleSnapshot::default();
    let mut root_entries = std::fs::read_dir(skill_path).map_err(to_string)?;
    let mut children = Vec::new();
    while let Some(entry) = root_entries.next().transpose().map_err(to_string)? {
        if is_hidden_name(&entry.file_name()) {
            continue;
        }
        children.push(entry.path());
    }
    children.sort();

    snapshot.visible_entries = children
        .iter()
        .filter_map(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_string())
        })
        .collect();
    snapshot.has_ui = children
        .iter()
        .any(|path| path.is_dir() && path.file_name() == Some(OsStr::new("ui")));

    let mut doc_sections = Vec::new();
    let mut queue: Vec<(PathBuf, usize)> =
        children.into_iter().map(|path| (path, 0usize)).collect();
    while let Some((path, depth)) = queue.pop() {
        if path.is_dir() {
            if depth >= SKILL_DOC_SCAN_DEPTH {
                continue;
            }
            let mut nested = std::fs::read_dir(&path).map_err(to_string)?;
            let mut nested_paths = Vec::new();
            while let Some(entry) = nested.next().transpose().map_err(to_string)? {
                if is_hidden_name(&entry.file_name()) {
                    continue;
                }
                nested_paths.push(entry.path());
            }
            nested_paths.sort();
            for nested_path in nested_paths.into_iter().rev() {
                queue.push((nested_path, depth + 1));
            }
            continue;
        }
        if path.file_name() == Some(OsStr::new("llm-tool.yaml")) {
            snapshot.tool_manifest_path = Some(path.clone());
        }
        if doc_sections.len() >= SKILL_DOC_SCAN_LIMIT || !is_probably_text_document(&path) {
            continue;
        }
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > SKILL_DOC_FILE_SIZE_LIMIT {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let rel = path
            .strip_prefix(skill_path)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        if snapshot.frontmatter.is_none() {
            snapshot.frontmatter = parse_frontmatter(&raw);
        }
        snapshot.doc_paths.push(rel.clone());
        doc_sections.push(format!("[{}]\n{}", rel, trim_excerpt(&raw, 1200)));
    }

    snapshot.package_metadata = read_package_metadata(skill_path);
    if !doc_sections.is_empty() {
        snapshot.doc_excerpt = Some(doc_sections.join("\n\n"));
    }
    Ok(snapshot)
}

pub(crate) fn resolve_local_skill_definition(
    skill_path: &Path,
    source_prefix: &str,
    repo_url: Option<&str>,
    revision: Option<&str>,
) -> Result<Option<LocalSkillDefinition>, String> {
    if !skill_path.exists() || !skill_path.is_dir() {
        return Ok(None);
    }

    let snapshot = collect_skill_bundle_snapshot(skill_path)?;
    if snapshot.visible_entries.is_empty() {
        return Ok(None);
    }

    let manifest_path = skill_path.join("deeting.json");
    let parsed_manifest = if manifest_path.exists() {
        let raw = std::fs::read_to_string(&manifest_path).map_err(to_string)?;
        match parse_deeting_manifest(&raw) {
            Ok(manifest) => Some(manifest),
            Err(err) => {
                warn!(
                    "local skill manifest at {} is invalid ({}); falling back to bundle inference",
                    skill_path.display(),
                    err
                );
                None
            }
        }
    } else {
        None
    };

    let frontmatter = snapshot.frontmatter.as_ref();
    let package_metadata = snapshot.package_metadata.as_ref();
    let fallback_hint = skill_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .or_else(|| repo_hint_from_url(repo_url))
        .unwrap_or_else(|| "skill".to_string());

    let skill_id = parsed_manifest
        .as_ref()
        .map(|manifest| manifest.id.clone())
        .or_else(|| {
            frontmatter.and_then(|value| select_frontmatter_string(value, &["id", "slug", "name"]))
        })
        .or_else(|| {
            package_metadata
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        })
        .unwrap_or_else(|| fallback_hint.clone());
    let skill_id = normalize_skill_dir_name(&skill_id.to_ascii_lowercase());

    let display_name = parsed_manifest
        .as_ref()
        .map(|manifest| manifest.name.clone())
        .or_else(|| {
            frontmatter.and_then(|value| {
                select_frontmatter_string(value, &["displayName", "title", "name"])
            })
        })
        .or_else(|| {
            package_metadata
                .and_then(|value| value.get("displayName").or_else(|| value.get("name")))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        })
        .unwrap_or_else(|| slug_to_title(&fallback_hint));

    let version = parsed_manifest
        .as_ref()
        .and_then(|manifest| manifest.version.clone())
        .or_else(|| frontmatter.and_then(|value| select_frontmatter_string(value, &["version"])))
        .or_else(|| {
            package_metadata
                .and_then(|value| value.get("version"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        });

    let description = parsed_manifest
        .as_ref()
        .and_then(|manifest| manifest.description.clone())
        .or_else(|| {
            frontmatter
                .and_then(|value| select_frontmatter_string(value, &["summary", "description"]))
        })
        .or_else(|| {
            package_metadata
                .and_then(|value| value.get("description"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        })
        .or_else(|| {
            snapshot
                .doc_excerpt
                .as_deref()
                .and_then(first_non_empty_line)
        })
        .unwrap_or_else(|| format!("Installed skill bundle for {}", display_name));

    let runtime_values = parsed_manifest
        .as_ref()
        .map(|manifest| manifest.runtime.clone())
        .filter(|values| !values.is_empty())
        .unwrap_or_else(|| vec!["local".to_string()]);
    let env_requirements = parsed_manifest
        .as_ref()
        .map(|manifest| manifest.env_requirements.clone())
        .unwrap_or_default();
    let restricted = parsed_manifest
        .as_ref()
        .map(|manifest| manifest.restricted)
        .unwrap_or(false);
    let allowed_roles = parsed_manifest
        .as_ref()
        .map(|manifest| manifest.allowed_roles.clone())
        .unwrap_or_default();
    let execution_timeout_seconds = parsed_manifest
        .as_ref()
        .map(|manifest| manifest.execution.timeout_seconds)
        .unwrap_or_else(default_timeout);

    let mut source_metadata = JsonMap::new();
    source_metadata.insert(
        "source_type".to_string(),
        JsonValue::String(source_prefix.to_string()),
    );
    source_metadata.insert(
        "visible_entries".to_string(),
        serde_json::json!(snapshot.visible_entries),
    );
    source_metadata.insert(
        "doc_paths".to_string(),
        serde_json::json!(snapshot.doc_paths),
    );
    source_metadata.insert(
        "assets".to_string(),
        serde_json::json!({
            "has_ui": snapshot.has_ui,
            "has_tool_manifest": snapshot.tool_manifest_path.is_some(),
        }),
    );
    if let Some(doc_excerpt) = snapshot
        .doc_excerpt
        .clone()
        .filter(|text| !text.trim().is_empty())
    {
        source_metadata.insert("doc_excerpt".to_string(), JsonValue::String(doc_excerpt));
    }
    if let Some(repo_url) = repo_url.filter(|value| !value.trim().is_empty()) {
        source_metadata.insert(
            "source_repo".to_string(),
            JsonValue::String(repo_url.to_string()),
        );
    }
    if let Some(revision) = revision.filter(|value| !value.trim().is_empty()) {
        source_metadata.insert(
            "source_revision".to_string(),
            JsonValue::String(revision.to_string()),
        );
    }
    let mut openclaw = JsonMap::new();
    if let Some(frontmatter) = snapshot.frontmatter.clone() {
        openclaw.insert("frontmatter".to_string(), frontmatter);
    }
    if let Some(package_metadata) = snapshot.package_metadata.clone() {
        openclaw.insert("package".to_string(), package_metadata);
    }
    if !openclaw.is_empty() {
        source_metadata.insert("openclaw".to_string(), JsonValue::Object(openclaw));
    }

    let mut manifest_value = JsonMap::new();
    manifest_value.insert("id".to_string(), JsonValue::String(skill_id.clone()));
    manifest_value.insert("name".to_string(), JsonValue::String(display_name.clone()));
    manifest_value.insert(
        "description".to_string(),
        JsonValue::String(description.clone()),
    );
    manifest_value.insert("runtime".to_string(), serde_json::json!(runtime_values));
    manifest_value.insert(
        "env_requirements".to_string(),
        serde_json::json!(env_requirements),
    );
    manifest_value.insert(
        "capabilities".to_string(),
        serde_json::json!([
            source_prefix,
            "guidance",
            if snapshot.tool_manifest_path.is_some() {
                "tooling"
            } else {
                "docs"
            },
            if snapshot.has_ui { "ui" } else { "bundle" }
        ]),
    );
    manifest_value.insert("restricted".to_string(), JsonValue::Bool(restricted));
    manifest_value.insert(
        "allowed_roles".to_string(),
        serde_json::json!(allowed_roles),
    );
    manifest_value.insert(
        "execution".to_string(),
        serde_json::json!({ "timeout_seconds": execution_timeout_seconds }),
    );
    manifest_value.insert(
        "source_metadata".to_string(),
        JsonValue::Object(source_metadata),
    );
    if let Some(version) = version.clone() {
        manifest_value.insert("version".to_string(), JsonValue::String(version));
    }
    if let Some(manifest) = parsed_manifest.as_ref() {
        if let Some(author) = manifest
            .author
            .clone()
            .filter(|value| !value.trim().is_empty())
        {
            manifest_value.insert("author".to_string(), JsonValue::String(author));
        }
        if let Some(entry) = manifest.entry.clone() {
            manifest_value.insert("entry".to_string(), entry);
        }
        if let Some(capabilities) = manifest.capabilities.clone() {
            manifest_value.insert("declared_capabilities".to_string(), capabilities);
        }
        if !manifest.permissions.is_empty() {
            manifest_value.insert(
                "permissions".to_string(),
                serde_json::json!(manifest.permissions),
            );
        }
    }

    let manifest_json =
        serde_json::to_string(&JsonValue::Object(manifest_value)).map_err(to_string)?;
    Ok(Some(LocalSkillDefinition {
        skill_id,
        display_name,
        version,
        description,
        manifest_json,
        runtime_values,
        env_requirements,
        restricted,
        allowed_roles,
        execution_timeout_seconds,
        doc_excerpt: snapshot.doc_excerpt,
    }))
}

#[derive(Debug, Clone)]
pub(crate) struct MaterializedSkillBundle {
    pub(crate) skill_def: LocalSkillDefinition,
    pub(crate) install_path: PathBuf,
}

pub(crate) fn finalize_materialized_skill_bundle(
    temp_dir: &Path,
    skills_dir: &Path,
    source_prefix: &str,
    repo_url: Option<&str>,
    revision: Option<&str>,
    expected_skill_id: Option<&str>,
) -> Result<MaterializedSkillBundle, String> {
    let Some(skill_def) =
        resolve_local_skill_definition(temp_dir, source_prefix, repo_url, revision)?
    else {
        let _ = std::fs::remove_dir_all(temp_dir);
        return Err("cloned repo does not contain a usable skill bundle".to_string());
    };

    let skill_id = skill_def.skill_id.trim().to_string();
    if skill_id.is_empty() {
        let _ = std::fs::remove_dir_all(temp_dir);
        return Err("manifest id is empty".to_string());
    }
    if let Some(expected) = expected_skill_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| *value != skill_id)
    {
        let _ = std::fs::remove_dir_all(temp_dir);
        return Err(format!(
            "cloned repo resolved skill id '{}' but expected '{}'",
            skill_id, expected
        ));
    }

    let final_dir = skills_dir.join(&skill_id);
    if final_dir.exists() {
        let _ = std::fs::remove_dir_all(&final_dir);
    }
    std::fs::rename(temp_dir, &final_dir).map_err(|e| {
        let _ = std::fs::remove_dir_all(temp_dir);
        format!("failed to move skill to final location: {}", e)
    })?;

    Ok(MaterializedSkillBundle {
        skill_def,
        install_path: final_dir,
    })
}

pub(crate) async fn materialize_skill_repo_to_dir(
    skills_dir: &Path,
    repo_url: &str,
    revision: Option<&str>,
    source_prefix: &str,
    expected_skill_id: Option<&str>,
) -> Result<MaterializedSkillBundle, String> {
    let normalized_repo = repo_url.trim();
    if normalized_repo.is_empty() {
        return Err("repo_url is empty".to_string());
    }
    if !is_allowed_skill_repo_url(normalized_repo) {
        return Err("repo URL is not in the allowed host list".to_string());
    }
    if !skills_dir.exists() {
        std::fs::create_dir_all(skills_dir).map_err(to_string)?;
    }

    let temp_name = format!("_installing_{}", uuid::Uuid::new_v4());
    let temp_dir = skills_dir.join(&temp_name);
    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("clone").arg("--depth").arg("1");
    if let Some(rev) = revision.map(|r| r.trim()).filter(|r| !r.is_empty()) {
        cmd.arg("--branch").arg(rev);
    }
    cmd.arg(normalized_repo).arg(&temp_dir);
    let output = cmd.output().await.map_err(to_string)?;
    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "git clone failed: {}",
            if stderr.is_empty() {
                "unknown error"
            } else {
                &stderr
            }
        ));
    }

    finalize_materialized_skill_bundle(
        &temp_dir,
        skills_dir,
        source_prefix,
        Some(normalized_repo),
        revision,
        expected_skill_id,
    )
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillInstallResult {
    pub skill_id: String,
    pub tool_count: usize,
    pub install_path: String,
}

pub(crate) async fn install_skill_to_local(
    app: &AppHandle,
    app_state: &AppState,
    repo_url: &str,
    revision: Option<&str>,
) -> Result<SkillInstallResult, String> {
    let skill_install_start = std::time::Instant::now();
    let skills_dir = app.path().app_data_dir().map_err(to_string)?.join("skills");
    let materialized =
        materialize_skill_repo_to_dir(&skills_dir, repo_url, revision, "user_skill", None).await?;
    let skill_def = materialized.skill_def;
    let skill_id = skill_def.skill_id.clone();
    let final_dir = materialized.install_path;

    let store = &app_state.mcp.store;
    let version = skill_def.version.as_deref();
    let runtime_str = skill_def.runtime_values.join(",");
    store
        .upsert_local_skill_install(
            &skill_id,
            version,
            Some(&runtime_str),
            &skill_def.manifest_json,
            &final_dir.to_string_lossy(),
        )
        .await
        .map_err(to_string)?;

    let indexed_tools = register_local_skills_inner(app.clone(), app_state)
        .await
        .unwrap_or(0);

    let bandit_store = app_state.providers.store.clone();
    let bandit_skill_id = skill_id.clone();
    let bandit_elapsed = skill_install_start.elapsed().as_millis() as f64;
    tauri::async_runtime::spawn(async move {
        if let Err(e) = bandit_store
            .record_feedback_simple("router:skill", &bandit_skill_id, true, Some(bandit_elapsed))
            .await
        {
            log::warn!("bandit feedback failed for router:skill install: {}", e);
        }
    });

    Ok(SkillInstallResult {
        skill_id,
        tool_count: indexed_tools,
        install_path: final_dir.to_string_lossy().to_string(),
    })
}

pub(crate) async fn purge_legacy_skill_tool_state(app_state: &AppState) -> Result<usize, String> {
    let legacy_tool_ids = app_state
        .mcp
        .store
        .list_tools()
        .await
        .map_err(to_string)?
        .into_iter()
        .filter(|tool| derive_skill_id_from_identifier(tool.identifier.as_deref()).is_some())
        .map(|tool| tool.id)
        .collect::<Vec<_>>();

    let legacy_asset_ids = app_state
        .memory
        .service
        .list_assets_catalog()
        .await
        .map_err(to_string)?
        .into_iter()
        .filter(|asset| asset.get("asset_type").and_then(JsonValue::as_str) == Some("tool"))
        .filter(|asset| {
            asset.get("pkg_name")
                .and_then(JsonValue::as_str)
                .is_some_and(|pkg| pkg.starts_with("skill."))
        })
        .filter_map(|asset| asset.get("id").and_then(JsonValue::as_str).map(str::to_string))
        .collect::<Vec<_>>();

    if !legacy_tool_ids.is_empty() {
        let _ = app_state
            .mcp
            .store
            .delete_tools_by_ids(&legacy_tool_ids)
            .await
            .map_err(to_string)?;
    }
    if !legacy_asset_ids.is_empty() {
        app_state
            .memory
            .service
            .delete_assets_by_ids(&legacy_asset_ids)
            .await
            .map_err(to_string)?;
    }

    let purged_mcp_rows = app_state
        .mcp
        .store
        .purge_legacy_skill_mcp_rows()
        .await
        .map_err(to_string)? as usize;

    Ok(legacy_tool_ids
        .len()
        .max(legacy_asset_ids.len())
        .max(purged_mcp_rows))
}

fn infer_local_skill_asset_source_type(skill_path: &Path) -> &'static str {
    if skill_path
        .components()
        .any(|component| component.as_os_str() == OsStr::new("official-skills"))
    {
        "builtin"
    } else {
        "user"
    }
}

pub(crate) async fn reindex_local_skill_bundle_asset(
    app_state: &AppState,
    skill_id: &str,
) -> Result<(), String> {
    let normalized_skill_id = skill_id.trim();
    if normalized_skill_id.is_empty() {
        return Err("skill_id is required".to_string());
    }

    let skill_path = app_state
        .mcp
        .store
        .get_local_skill_install_path(normalized_skill_id)
        .await
        .map_err(to_string)?
        .map(PathBuf::from)
        .ok_or_else(|| format!("skill install {} not found", normalized_skill_id))?;
    let Some(skill_def) =
        resolve_local_skill_definition(&skill_path, "reindex", None, None).map_err(to_string)?
    else {
        return Err(format!(
            "skill bundle at {} is no longer readable",
            skill_path.display()
        ));
    };

    app_state
        .memory
        .service
        .delete_assets_by_package(normalized_skill_id)
        .await
        .map_err(to_string)?;

    index_local_skill_bundle_asset(
        app_state.providers.clone(),
        app_state.memory.clone(),
        normalized_skill_id,
        &skill_def.display_name,
        &skill_def.description,
        skill_def.doc_excerpt.as_deref(),
        &skill_def.manifest_json,
        infer_local_skill_asset_source_type(&skill_path),
    )
    .await
}

pub(crate) async fn uninstall_local_skill(
    app: &AppHandle,
    app_state: &AppState,
    skill_id: &str,
) -> Result<(), String> {
    let store = &app_state.mcp.store;
    let install_path = store
        .get_local_skill_install_path(skill_id)
        .await
        .map_err(to_string)?
        .map(PathBuf::from)
        .ok_or_else(|| format!("local skill {} is not installed", skill_id))?;

    let managed_skills_root = app.path().app_data_dir().map_err(to_string)?.join("skills");
    if !install_path.starts_with(&managed_skills_root) {
        return Err("cannot uninstall official (read-only) skills".to_string());
    }

    if let Err(e) = app_state
        .memory
        .service
        .delete_assets_by_package(skill_id)
        .await
    {
        warn!(
            "uninstall_local_skill {}: failed to delete embeddings: {}",
            skill_id, e
        );
    }
    let _ = purge_legacy_skill_tool_state(app_state).await;
    store
        .delete_local_skill_install(skill_id)
        .await
        .map_err(to_string)?;
    if install_path.exists() {
        std::fs::remove_dir_all(&install_path).map_err(to_string)?;
    }
    log::info!("uninstall_local_skill {}: complete", skill_id);
    Ok(())
}

async fn index_local_skill_bundle_asset(
    provider_state: std::sync::Arc<crate::modules::providers::ProviderState>,
    memory_state: std::sync::Arc<crate::modules::memory::MemoryState>,
    skill_id: &str,
    display_name: &str,
    description: &str,
    doc_excerpt: Option<&str>,
    manifest_json: &str,
    source_type: &str,
) -> Result<(), String> {
    let mut body = format!(
        "skill: {}\ndescription: {}\nsource_type: {}\nmanifest: {}",
        display_name, description, source_type, manifest_json
    );
    if let Some(doc_excerpt) = doc_excerpt.filter(|text| !text.trim().is_empty()) {
        body.push_str("\n\ndocs:\n");
        body.push_str(doc_excerpt);
    }
    let vector = provider_state
        .embedding
        .embed_text(&body)
        .await
        .map_err(|e| e.to_string())?;
    let metadata = serde_json::from_str::<JsonValue>(manifest_json).ok();
    memory_state
        .store
        .upsert_asset(
            skill_id.to_string(),
            display_name.to_string(),
            description.to_string(),
            "skill".to_string(),
            source_type.to_string(),
            Some(skill_id.to_string()),
            vector,
            metadata,
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn register_local_skills(
    app: AppHandle,
    app_state: State<'_, AppState>,
) -> Result<usize, String> {
    register_local_skills_inner(app, app_state.inner()).await
}

#[tauri::command]
pub async fn install_skill_from_repo(
    app: AppHandle,
    app_state: State<'_, AppState>,
    repo_url: String,
    revision: Option<String>,
) -> Result<SkillInstallResult, String> {
    install_skill_to_local(&app, app_state.inner(), &repo_url, revision.as_deref()).await
}

#[tauri::command]
pub async fn uninstall_skill(
    app: AppHandle,
    app_state: State<'_, AppState>,
    skill_id: String,
) -> Result<(), String> {
    uninstall_local_skill(&app, app_state.inner(), &skill_id).await
}

pub(crate) async fn register_local_skills_inner(
    app: AppHandle,
    app_state: &AppState,
) -> Result<usize, String> {
    let purged = purge_legacy_skill_tool_state(app_state).await?;
    if purged > 0 {
        log::info!("purged {} legacy skill-tool state entries before reindex", purged);
    }
    let scan_targets = resolve_local_skill_scan_targets(&app)?;
    let sdk_dir = app
        .path()
        .resource_dir()
        .ok()
        .map(|p| p.join("deeting-sdk"))
        .filter(|p| p.exists())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .join("packages")
                .join("deeting-sdk")
        });
    let sdk_pythonpath = sdk_dir.to_string_lossy().to_string();
    register_local_skills_from_scan_targets_inner(
        &scan_targets,
        &sdk_pythonpath,
        app_state.mcp.store.as_ref(),
        app_state.providers.clone(),
        app_state.memory.clone(),
        false,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_skill_dir(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "deeting-{}-{}",
            prefix,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).expect("create temp skill dir");
        dir
    }

    #[test]
    fn resolve_local_skill_definition_accepts_docs_first_bundle() {
        let dir = temp_skill_dir("docs-skill");
        std::fs::write(
            dir.join("guide.mdx"),
            "---\ntitle: Find Skills\ndescription: Discover and install skills\nversion: 0.1.0\n---\n\nUse this skill to search for reusable abilities.",
        )
        .expect("write docs");
        std::fs::write(
            dir.join("package.json"),
            r#"{"name":"find-skills","displayName":"Find Skills","version":"0.1.0","description":"Package metadata description"}"#,
        )
        .expect("write package metadata");
        std::fs::create_dir_all(dir.join("ui")).expect("create ui dir");

        let resolved = resolve_local_skill_definition(
            &dir,
            "user_skill",
            Some("https://github.com/example/find-skills.git"),
            Some("abc123"),
        )
        .expect("resolve skill")
        .expect("skill exists");

        assert_eq!(resolved.skill_id, "find-skills");
        assert_eq!(resolved.display_name, "Find Skills");
        assert_eq!(resolved.version.as_deref(), Some("0.1.0"));
        assert!(resolved.description.contains("Discover and install skills"));
        assert!(resolved
            .doc_excerpt
            .as_deref()
            .unwrap_or_default()
            .contains("guide.mdx"));
        let manifest: JsonValue =
            serde_json::from_str(&resolved.manifest_json).expect("manifest json");
        assert_eq!(
            manifest.get("name").and_then(|value| value.as_str()),
            Some("Find Skills")
        );
        assert_eq!(
            manifest
                .pointer("/source_metadata/openclaw/package/name")
                .and_then(|value| value.as_str()),
            Some("find-skills")
        );
        assert_eq!(
            manifest
                .pointer("/source_metadata/source_repo")
                .and_then(|value| value.as_str()),
            Some("https://github.com/example/find-skills.git")
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn resolve_local_skill_definition_keeps_doc_first_metadata_when_optional_tool_files_exist() {
        let dir = temp_skill_dir("tool-skill");
        std::fs::write(dir.join("notes.txt"), "This skill has an optional tool.")
            .expect("write docs");
        std::fs::write(dir.join("llm-tool.yaml"), "tools: []").expect("write tool manifest");
        std::fs::write(dir.join("main.py"), "print('hello')\n").expect("write entrypoint");

        let resolved = resolve_local_skill_definition(&dir, "user_skill", None, None)
            .expect("resolve skill")
            .expect("skill exists");

        let manifest: JsonValue =
            serde_json::from_str(&resolved.manifest_json).expect("manifest json");
        assert_eq!(resolved.skill_id, "tool-skill");
        assert_eq!(
            manifest
                .pointer("/source_metadata/assets/has_tool_manifest")
                .and_then(|value| value.as_bool()),
            Some(true)
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn resolve_local_skill_definition_preserves_manifest_author_and_declared_capabilities() {
        let dir = temp_skill_dir("manifest-metadata-skill");
        std::fs::write(dir.join("notes.txt"), "Manifest metadata test.").expect("write docs");
        std::fs::write(
            dir.join("deeting.json"),
            serde_json::json!({
                "id": "manifest-meta-skill",
                "name": "Manifest Meta Skill",
                "author": "NeuralCore",
                "capabilities": ["search", "summarize"],
                "runtime": ["local"],
                "execution": { "timeout_seconds": 30 }
            })
            .to_string(),
        )
        .expect("write manifest");

        let resolved = resolve_local_skill_definition(&dir, "user_skill", None, None)
            .expect("resolve skill")
            .expect("skill exists");

        let manifest: JsonValue =
            serde_json::from_str(&resolved.manifest_json).expect("manifest json");
        assert_eq!(
            manifest.get("author").and_then(|value| value.as_str()),
            Some("NeuralCore")
        );
        assert_eq!(
            manifest
                .pointer("/declared_capabilities/0")
                .and_then(|value| value.as_str()),
            Some("search")
        );
        assert_eq!(
            manifest
                .pointer("/capabilities/0")
                .and_then(|value| value.as_str()),
            Some("user_skill")
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn finalize_materialized_skill_bundle_moves_docs_first_bundle_into_final_skill_dir() {
        let skills_dir = temp_skill_dir("materialized-skills-root");
        let temp_dir = skills_dir.join("_installing_test");
        std::fs::create_dir_all(&temp_dir).expect("create temp install dir");
        std::fs::write(
            temp_dir.join("guide.mdx"),
            "---\nid: official.find-skills\ntitle: Find Skills\ndescription: Market skill\n---\n\nDocs-first bundle.",
        )
        .expect("write docs");

        let materialized = finalize_materialized_skill_bundle(
            &temp_dir,
            &skills_dir,
            "user_skill",
            Some("https://github.com/example/find-skills.git"),
            Some("rev-123"),
            Some("official.find-skills"),
        )
        .expect("materialize skill bundle");

        assert_eq!(materialized.skill_def.skill_id, "official.find-skills");
        assert_eq!(
            materialized.install_path,
            skills_dir.join("official.find-skills")
        );
        assert!(materialized.install_path.exists());
        assert!(!temp_dir.exists());

        let _ = std::fs::remove_dir_all(skills_dir);
    }

    #[test]
    fn finalize_materialized_skill_bundle_rejects_expected_skill_id_mismatch() {
        let skills_dir = temp_skill_dir("materialized-mismatch-root");
        let temp_dir = skills_dir.join("_installing_test");
        std::fs::create_dir_all(&temp_dir).expect("create temp install dir");
        std::fs::write(
            temp_dir.join("guide.mdx"),
            "---\nid: actual.skill\ntitle: Actual Skill\n---\n\nMismatch bundle.",
        )
        .expect("write docs");

        let err = finalize_materialized_skill_bundle(
            &temp_dir,
            &skills_dir,
            "user_skill",
            Some("https://github.com/example/actual-skill.git"),
            Some("rev-999"),
            Some("expected.skill"),
        )
        .expect_err("mismatch should fail");

        assert!(err.contains("expected 'expected.skill'"));
        assert!(!temp_dir.exists());

        let _ = std::fs::remove_dir_all(skills_dir);
    }
}
