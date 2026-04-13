use crate::modules::mcp::commands::{common_impl::to_string, support::*};
use crate::modules::skill_runtime::{
    compute_file_sha256, detect_local_skill_runtime,
    install_local_skill_runtime as install_managed_local_skill_runtime,
    normalize_runtime_settings_json, runtime_install_metadata_from_outcome, runtime_root_for_skill,
    upsert_runtime_install_metadata, LocalSkillRuntimeProviderKind, LOCAL_SKILL_RUNTIME_MANAGER_UV,
    LOCAL_SKILL_RUNTIME_STATE_INSTALLING, LOCAL_SKILL_RUNTIME_STATE_INSTALL_FAILED,
    LOCAL_SKILL_RUNTIME_STATE_NEEDS_INSTALL, LOCAL_SKILL_RUNTIME_STATE_NEEDS_REINSTALL,
    LOCAL_SKILL_RUNTIME_STATE_READY,
};
use crate::utils::configure_background_tokio_command;
use mcp_registry::types::LocalCapabilityRegistryUpsert;
use serde_json::{json, Map as JsonMap, Value as JsonValue};
use std::{
    collections::{BTreeSet, HashMap},
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

fn normalize_installed_skill_match_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut normalized = String::with_capacity(trimmed.len());
    let mut previous_was_separator = false;
    for ch in trimmed.chars().flat_map(|value| value.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            normalized.push(ch);
            previous_was_separator = false;
        } else if !previous_was_separator {
            normalized.push('-');
            previous_was_separator = true;
        }
    }

    let normalized = normalized.trim_matches('-').to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_installed_skill_repo_key(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut normalized = trimmed.replace('\\', "/").to_ascii_lowercase();
    if let Some(rest) = normalized.strip_prefix("git@github.com:") {
        normalized = format!("https://github.com/{rest}");
    }
    while normalized.ends_with('/') {
        normalized.pop();
    }
    if let Some(stripped) = normalized.strip_suffix(".git") {
        normalized = stripped.to_string();
    }
    if normalized.is_empty() {
        None
    } else {
        Some(format!("repo:{normalized}"))
    }
}

fn insert_installed_skill_id_key(keys: &mut BTreeSet<String>, raw: &str) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return;
    }
    keys.insert(trimmed.to_string());
    if let Some(normalized) = normalize_installed_skill_match_id(trimmed) {
        keys.insert(normalized);
    }
}

fn insert_installed_skill_repo_key(keys: &mut BTreeSet<String>, raw: &str) {
    if let Some(normalized) = normalize_installed_skill_repo_key(raw) {
        keys.insert(normalized);
    }
}

fn collect_local_skill_match_keys(
    install: &crate::modules::mcp::store::LocalSkillInstallDetail,
) -> Vec<String> {
    let mut keys = BTreeSet::new();

    insert_installed_skill_id_key(&mut keys, &install.skill_id);
    if let Some(name) = Path::new(&install.install_path)
        .file_name()
        .and_then(|value| value.to_str())
    {
        insert_installed_skill_id_key(&mut keys, name);
    }

    if let Ok(manifest) = serde_json::from_str::<JsonValue>(&install.manifest_json) {
        for pointer in [
            "/id",
            "/source_metadata/openclaw/package/name",
            "/source_metadata/openclaw/package/displayName",
        ] {
            if let Some(value) = manifest.pointer(pointer).and_then(JsonValue::as_str) {
                insert_installed_skill_id_key(&mut keys, value);
            }
        }
        if let Some(value) = manifest
            .pointer("/source_metadata/source_repo")
            .and_then(JsonValue::as_str)
        {
            insert_installed_skill_repo_key(&mut keys, value);
        }
    }

    keys.into_iter().collect()
}

fn normalize_skill_install_path_for_compare(path: &Path) -> String {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return canonical
            .to_string_lossy()
            .replace('\\', "/")
            .to_ascii_lowercase();
    }
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn local_skill_install_paths_match(left: &Path, right: &Path) -> bool {
    normalize_skill_install_path_for_compare(left)
        == normalize_skill_install_path_for_compare(right)
}

fn merge_local_skill_user_settings(
    primary: Option<&JsonValue>,
    legacy: Option<&JsonValue>,
) -> Option<JsonValue> {
    match (primary, legacy) {
        (Some(JsonValue::Object(primary_map)), Some(JsonValue::Object(legacy_map))) => {
            let mut merged = primary_map.clone();
            for (key, value) in legacy_map {
                merged.entry(key.clone()).or_insert_with(|| value.clone());
            }
            Some(JsonValue::Object(merged))
        }
        (Some(primary), _) => Some(primary.clone()),
        (None, Some(legacy)) => Some(legacy.clone()),
        (None, None) => None,
    }
}

async fn migrate_conflicting_local_skill_installs_for_path(
    store: &crate::modules::mcp::store::McpStore,
    canonical_skill_id: &str,
    install_path: &Path,
) -> Result<(), String> {
    let installs = store
        .list_local_skill_install_details()
        .await
        .map_err(to_string)?;
    let Some(canonical_install) = installs
        .iter()
        .find(|item| {
            item.skill_id == canonical_skill_id
                && local_skill_install_paths_match(Path::new(&item.install_path), install_path)
        })
        .cloned()
    else {
        return Ok(());
    };

    let conflicting_installs = installs
        .into_iter()
        .filter(|item| item.skill_id != canonical_skill_id)
        .filter(|item| local_skill_install_paths_match(Path::new(&item.install_path), install_path))
        .collect::<Vec<_>>();
    if conflicting_installs.is_empty() {
        return Ok(());
    }

    let merged_settings = conflicting_installs.iter().fold(
        canonical_install.user_settings_json.clone(),
        |current, install| {
            merge_local_skill_user_settings(current.as_ref(), install.user_settings_json.as_ref())
        },
    );
    if merged_settings != canonical_install.user_settings_json {
        store
            .upsert_local_skill_install_state(
                &canonical_install.skill_id,
                canonical_install.installed_version.as_deref(),
                canonical_install.is_enabled,
                canonical_install.runtime.as_deref(),
                &canonical_install.manifest_json,
                &canonical_install.install_path,
                merged_settings.as_ref(),
            )
            .await
            .map_err(to_string)?;
    }

    for conflicting in conflicting_installs {
        log::info!(
            "migrating legacy local skill install '{}' into canonical '{}'",
            conflicting.skill_id,
            canonical_skill_id
        );
        store
            .delete_local_skill_install(&conflicting.skill_id)
            .await
            .map_err(to_string)?;
    }

    Ok(())
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

const DEFAULT_SKILL_ACTION_TIMEOUT_SECS: u64 = 60;

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

#[derive(Debug, Clone)]
pub(crate) struct LocalSkillToolBindingDefinition {
    pub(crate) binding_id: String,
    pub(crate) binding_kind: String,
    pub(crate) callable_name: String,
    pub(crate) tool_name: String,
    pub(crate) description: String,
    pub(crate) input_schema: Option<JsonValue>,
    pub(crate) output_schema: Option<JsonValue>,
    pub(crate) entry_path: String,
    pub(crate) runtime: String,
    pub(crate) timeout_seconds: u64,
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
    parameters: Option<JsonValue>,
    #[serde(default)]
    input_schema: Option<JsonValue>,
    #[serde(default)]
    output_schema: Option<JsonValue>,
}

#[derive(Debug, Clone)]
struct LocalSkillScriptBindingCandidate {
    tool_name: String,
    entry_path: String,
    runtime: String,
}

#[derive(Debug, Default)]
struct SkillBundleSnapshot {
    visible_entries: Vec<String>,
    doc_paths: Vec<String>,
    script_paths: Vec<String>,
    reference_paths: Vec<String>,
    resource_paths: Vec<String>,
    doc_excerpt: Option<String>,
    frontmatter: Option<JsonValue>,
    package_metadata: Option<JsonValue>,
    tool_manifest_path: Option<PathBuf>,
    has_ui: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NormalizedSkillAdapterKind {
    DeetingToolBinding,
    OpenClawScript,
    DocsBundle,
}

impl NormalizedSkillAdapterKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::DeetingToolBinding => "deeting_tool_binding",
            Self::OpenClawScript => "openclaw_script",
            Self::DocsBundle => "docs_bundle",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NormalizedSkillExecutionSurface {
    DesktopCapability,
    ScriptRunner,
    Recipe,
}

impl NormalizedSkillExecutionSurface {
    fn as_str(self) -> &'static str {
        match self {
            Self::DesktopCapability => "desktop_capability",
            Self::ScriptRunner => "script_runner",
            Self::Recipe => "recipe",
        }
    }
}

fn classify_normalized_skill_execution(
    snapshot: &SkillBundleSnapshot,
    parsed_manifest: Option<&DeetingManifest>,
    frontmatter: Option<&JsonValue>,
) -> (NormalizedSkillAdapterKind, NormalizedSkillExecutionSurface) {
    if parsed_manifest.is_some() && snapshot.tool_manifest_path.is_some() {
        return (
            NormalizedSkillAdapterKind::DeetingToolBinding,
            NormalizedSkillExecutionSurface::DesktopCapability,
        );
    }
    if !snapshot.script_paths.is_empty() {
        return (
            if extract_openclaw_metadata(frontmatter).is_some() {
                NormalizedSkillAdapterKind::OpenClawScript
            } else {
                NormalizedSkillAdapterKind::DocsBundle
            },
            NormalizedSkillExecutionSurface::ScriptRunner,
        );
    }
    (
        NormalizedSkillAdapterKind::DocsBundle,
        NormalizedSkillExecutionSurface::Recipe,
    )
}

const SKILL_DOC_SCAN_DEPTH: usize = 2;
const SKILL_DOC_SCAN_LIMIT: usize = 6;
const SKILL_DOC_FILE_SIZE_LIMIT: u64 = 256 * 1024;

pub(crate) fn is_hidden_name(name: &OsStr) -> bool {
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

fn is_probably_script(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "py" | "js" | "mjs" | "cjs" | "sh" | "bash" | "zsh" | "ts"
    )
}

fn script_tool_name_from_path(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("run");
    normalize_skill_dir_name(stem)
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

pub(crate) fn callable_skill_binding_name(skill_id: &str, tool_name: &str) -> String {
    let normalized_skill_id = skill_id.trim().trim_matches('.').to_ascii_lowercase();
    let normalized_tool_name = tool_name.trim().trim_matches('.').to_ascii_lowercase();
    format!("skill.{normalized_skill_id}.{normalized_tool_name}")
}

fn skill_tool_binding_id(skill_id: &str, tool_name: &str) -> String {
    format!("skill_binding::{skill_id}::{tool_name}")
}

fn local_skill_bundle_capability_id(skill_id: &str) -> String {
    format!("skill_bundle::{skill_id}")
}

fn local_skill_tool_capability_id(skill_id: &str, tool_name: &str) -> String {
    format!("skill_tool::{skill_id}::{tool_name}")
}

fn build_local_skill_registry_entries(
    skill_path: &Path,
    skill_def: &LocalSkillDefinition,
    bindings: &[LocalSkillToolBindingDefinition],
    source_kind: &str,
    activation_state: &str,
    runtime_state: &str,
    search_index_state: &str,
    generation: i64,
) -> Result<Vec<LocalCapabilityRegistryUpsert>, String> {
    let manifest_value =
        serde_json::from_str::<JsonValue>(&skill_def.manifest_json).map_err(to_string)?;
    let compatibility = manifest_value.get("compatibility").cloned();
    let bundle_execution_surface = manifest_value
        .pointer("/compatibility/normalized_execution_surface")
        .and_then(JsonValue::as_str)
        .unwrap_or(if bindings.is_empty() {
            "recipe"
        } else {
            "desktop_capability"
        });
    let bundle_entry_path = resolve_skill_backend_entry_path(skill_path, &skill_def.manifest_json)?
        .map(|path| path.to_string_lossy().to_string());
    let bundle_runtime =
        (!skill_def.runtime_values.is_empty()).then(|| skill_def.runtime_values.join(","));

    let mut entries = Vec::with_capacity(bindings.len() + 1);
    entries.push(LocalCapabilityRegistryUpsert {
        capability_id: local_skill_bundle_capability_id(&skill_def.skill_id),
        source_kind: source_kind.to_string(),
        asset_kind: "skill_bundle".to_string(),
        package_id: skill_def.skill_id.clone(),
        package_version: skill_def.version.clone(),
        title: skill_def.display_name.clone(),
        description: skill_def.description.clone(),
        tool_name: None,
        callable_name: None,
        binding_kind: None,
        execution_surface: bundle_execution_surface.to_string(),
        runtime: bundle_runtime.clone(),
        entry_path: bundle_entry_path.clone(),
        is_direct_callable: false,
        activation_state: activation_state.to_string(),
        runtime_state: runtime_state.to_string(),
        search_index_state: search_index_state.to_string(),
        generation,
        descriptor_json: json!({
            "capability_id": local_skill_bundle_capability_id(&skill_def.skill_id),
            "source_kind": source_kind,
            "asset_kind": "skill_bundle",
            "skill_id": skill_def.skill_id.clone(),
            "display_name": skill_def.display_name.clone(),
            "version": skill_def.version.clone(),
            "description": skill_def.description.clone(),
            "doc_excerpt": skill_def.doc_excerpt.clone(),
            "execution_surface": bundle_execution_surface,
            "runtime_values": skill_def.runtime_values.clone(),
            "manifest": manifest_value.clone(),
        })
        .to_string(),
    });

    for binding in bindings {
        let execution_surface = if binding.binding_kind == "script_runner" {
            "script_runner"
        } else {
            "desktop_capability"
        };
        entries.push(LocalCapabilityRegistryUpsert {
            capability_id: local_skill_tool_capability_id(&skill_def.skill_id, &binding.tool_name),
            source_kind: source_kind.to_string(),
            asset_kind: "skill_tool".to_string(),
            package_id: skill_def.skill_id.clone(),
            package_version: skill_def.version.clone(),
            title: format!("{} / {}", skill_def.display_name, binding.tool_name),
            description: binding.description.clone(),
            tool_name: Some(binding.tool_name.clone()),
            callable_name: Some(binding.callable_name.clone()),
            binding_kind: Some(binding.binding_kind.clone()),
            execution_surface: execution_surface.to_string(),
            runtime: Some(binding.runtime.clone()),
            entry_path: Some(binding.entry_path.clone()),
            is_direct_callable: true,
            activation_state: activation_state.to_string(),
            runtime_state: runtime_state.to_string(),
            search_index_state: search_index_state.to_string(),
            generation,
            descriptor_json: json!({
                "capability_id": local_skill_tool_capability_id(&skill_def.skill_id, &binding.tool_name),
                "source_kind": source_kind,
                "asset_kind": "skill_tool",
                "skill_id": skill_def.skill_id.clone(),
                "display_name": skill_def.display_name.clone(),
                "version": skill_def.version.clone(),
                "binding_id": binding.binding_id.clone(),
                "binding_kind": binding.binding_kind.clone(),
                "callable_name": binding.callable_name.clone(),
                "tool_name": binding.tool_name.clone(),
                "description": binding.description.clone(),
                "execution_surface": execution_surface,
                "runtime": binding.runtime.clone(),
                "entry_path": binding.entry_path.clone(),
                "timeout_seconds": binding.timeout_seconds,
                "input_schema": binding.input_schema.clone(),
                "output_schema": binding.output_schema.clone(),
                "compatibility": compatibility.clone(),
                "restricted": skill_def.restricted,
                "allowed_roles": skill_def.allowed_roles.clone(),
            })
            .to_string(),
        });
    }

    Ok(entries)
}

fn registry_activation_state_for_install(
    install: &crate::modules::mcp::store::LocalSkillInstallDetail,
) -> &'static str {
    if install.is_enabled {
        "enabled"
    } else {
        "disabled"
    }
}

fn registry_runtime_state_for_install(
    install: &crate::modules::mcp::store::LocalSkillInstallDetail,
) -> String {
    let runtime = detect_local_skill_runtime(install);
    if runtime.supported {
        runtime.state.to_string()
    } else {
        "not_required".to_string()
    }
}

fn read_skill_tool_manifest(path: &Path) -> Result<Vec<SkillToolManifestEntry>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path).map_err(to_string)?;
    let manifest = serde_yaml::from_str::<SkillToolManifest>(&raw).map_err(to_string)?;
    Ok(manifest
        .tools
        .into_iter()
        .filter(|entry| !entry.name.trim().is_empty())
        .collect())
}

pub(crate) fn resolve_skill_backend_entry_path(
    skill_path: &Path,
    manifest_json: &str,
) -> Result<Option<PathBuf>, String> {
    let manifest = serde_json::from_str::<JsonValue>(manifest_json).map_err(to_string)?;
    Ok(manifest
        .get("entry")
        .and_then(|value| value.get("backend"))
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|entry| skill_path.join(entry)))
}

pub(crate) fn resolve_skill_execution_timeout(manifest_json: &str) -> Result<u64, String> {
    let manifest = serde_json::from_str::<JsonValue>(manifest_json).map_err(to_string)?;
    Ok(manifest
        .get("execution")
        .and_then(|value| value.get("timeout_seconds"))
        .and_then(JsonValue::as_u64)
        .unwrap_or(DEFAULT_SKILL_ACTION_TIMEOUT_SECS))
}

pub(crate) fn resolve_skill_entry_runtime(entry_path: &Path) -> Result<&'static str, String> {
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

pub(crate) fn collect_local_skill_tool_bindings(
    skill_path: &Path,
    skill_def: &LocalSkillDefinition,
) -> Result<Vec<LocalSkillToolBindingDefinition>, String> {
    let timeout_seconds = resolve_skill_execution_timeout(&skill_def.manifest_json)?;
    let mut bindings = Vec::new();

    if let Some(backend_entry) =
        resolve_skill_backend_entry_path(skill_path, &skill_def.manifest_json)?
    {
        let runtime = resolve_skill_entry_runtime(&backend_entry)?.to_string();
        let entries = read_skill_tool_manifest(&skill_path.join("llm-tool.yaml"))?;
        bindings.extend(
            entries
                .into_iter()
                .map(|entry| LocalSkillToolBindingDefinition {
                    binding_id: skill_tool_binding_id(&skill_def.skill_id, &entry.name),
                    binding_kind: "deeting_tool".to_string(),
                    callable_name: callable_skill_binding_name(&skill_def.skill_id, &entry.name),
                    tool_name: entry.name.clone(),
                    description: entry.description.unwrap_or_else(|| {
                        format!("Callable tool binding for {}", skill_def.display_name)
                    }),
                    input_schema: entry.parameters.or(entry.input_schema),
                    output_schema: entry.output_schema,
                    entry_path: backend_entry.to_string_lossy().to_string(),
                    runtime: runtime.clone(),
                    timeout_seconds,
                }),
        );
    }

    let existing_tool_names = bindings
        .iter()
        .map(|binding| binding.tool_name.clone())
        .collect::<HashSet<_>>();
    let generated_scripts =
        collect_generated_script_binding_candidates(skill_path, &existing_tool_names)?;
    bindings.extend(generated_scripts.into_iter().map(|candidate| {
        LocalSkillToolBindingDefinition {
            binding_id: skill_tool_binding_id(&skill_def.skill_id, &candidate.tool_name),
            binding_kind: "script_runner".to_string(),
            callable_name: callable_skill_binding_name(&skill_def.skill_id, &candidate.tool_name),
            tool_name: candidate.tool_name.clone(),
            description: format!(
                "Generated script binding for {} ({})",
                skill_def.display_name, candidate.tool_name
            ),
            input_schema: Some(build_generated_script_input_schema()),
            output_schema: None,
            entry_path: candidate.entry_path,
            runtime: candidate.runtime,
            timeout_seconds,
        }
    }));

    Ok(bindings)
}

fn collect_generated_script_binding_candidates(
    skill_path: &Path,
    existing_tool_names: &HashSet<String>,
) -> Result<Vec<LocalSkillScriptBindingCandidate>, String> {
    let scripts_dir = skill_path.join("scripts");
    if !scripts_dir.exists() || !scripts_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut candidates = Vec::new();
    for entry in std::fs::read_dir(&scripts_dir).map_err(to_string)? {
        let path = entry.map_err(to_string)?.path();
        if path.is_dir() || !is_probably_script(&path) {
            continue;
        }
        let tool_name = script_tool_name_from_path(&path);
        if tool_name.is_empty() || existing_tool_names.contains(&tool_name) {
            continue;
        }
        let runtime = resolve_skill_entry_runtime(&path)?.to_string();
        candidates.push(LocalSkillScriptBindingCandidate {
            tool_name,
            entry_path: path.to_string_lossy().to_string(),
            runtime,
        });
    }
    candidates.sort_by(|left, right| left.tool_name.cmp(&right.tool_name));
    Ok(candidates)
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

fn relative_skill_path(skill_path: &Path, path: &Path) -> String {
    path.strip_prefix(skill_path)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn first_path_segment(value: &str) -> Option<&str> {
    value
        .split('/')
        .next()
        .filter(|segment| !segment.is_empty())
}

fn extract_openclaw_metadata(frontmatter: Option<&JsonValue>) -> Option<JsonValue> {
    frontmatter
        .and_then(|value| value.get("metadata"))
        .and_then(|value| value.get("openclaw"))
        .cloned()
}

fn value_to_string_list(value: Option<&JsonValue>) -> Vec<String> {
    match value {
        Some(JsonValue::String(raw)) => {
            let normalized = raw.trim();
            if normalized.is_empty() {
                Vec::new()
            } else {
                vec![normalized.to_string()]
            }
        }
        Some(JsonValue::Array(items)) => items
            .iter()
            .filter_map(|item| item.as_str())
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
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
                if base.join(format!("{candidate}.{ext}")).is_file() {
                    return true;
                }
            }
        }
    }
    false
}

fn build_generated_script_input_schema() -> JsonValue {
    json!({
        "type": "object",
        "properties": {
            "input": {
                "description": "Optional JSON payload written to stdin for the script.",
                "oneOf": [
                    { "type": "object" },
                    {
                        "type": "array",
                        "items": {}
                    },
                    { "type": "string" },
                    { "type": "number" },
                    { "type": "boolean" }
                ]
            },
            "args": {
                "type": "array",
                "description": "Optional CLI arguments appended after the script path.",
                "items": { "type": "string" }
            }
        }
    })
}

fn build_skill_compatibility_metadata(
    snapshot: &SkillBundleSnapshot,
    parsed_manifest: Option<&DeetingManifest>,
    frontmatter: Option<&JsonValue>,
) -> JsonValue {
    let openclaw = extract_openclaw_metadata(frontmatter);
    let (adapter_kind, normalized_surface) =
        classify_normalized_skill_execution(snapshot, parsed_manifest, frontmatter);
    let skill_key = openclaw
        .as_ref()
        .and_then(|value| value.get("skillKey"))
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let requires = openclaw
        .as_ref()
        .and_then(|value| value.get("requires"))
        .cloned()
        .unwrap_or_else(|| JsonValue::Object(JsonMap::new()));
    let required_bins = value_to_string_list(requires.get("bin").or_else(|| requires.get("bins")));
    let required_env = value_to_string_list(requires.get("env"));
    let required_config = value_to_string_list(requires.get("config"));
    let install_hints = value_to_string_list(
        openclaw
            .as_ref()
            .and_then(|value| value.get("install"))
            .or_else(|| requires.get("install")),
    );
    let missing_bins = required_bins
        .iter()
        .filter(|item| !binary_exists(item))
        .cloned()
        .collect::<Vec<_>>();
    let missing_env = required_env
        .iter()
        .filter(|item| {
            std::env::var(item)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .is_none()
        })
        .cloned()
        .collect::<Vec<_>>();
    let execution_mode = if parsed_manifest.is_some() && snapshot.tool_manifest_path.is_some() {
        "deeting_binding"
    } else if !snapshot.script_paths.is_empty() {
        "script_guidance"
    } else {
        "docs_only"
    };
    let ecosystem = if openclaw.is_some() {
        "openclaw_agentskills"
    } else {
        "agentskills_compatible"
    };

    json!({
        "ecosystem": ecosystem,
        "execution_mode": execution_mode,
        "adapter_kind": adapter_kind.as_str(),
        "normalized_execution_surface": normalized_surface.as_str(),
        "supports_deeting_binding": parsed_manifest.is_some() && snapshot.tool_manifest_path.is_some(),
        "has_scripts": !snapshot.script_paths.is_empty(),
        "has_references": !snapshot.reference_paths.is_empty(),
        "has_resources": !snapshot.resource_paths.is_empty(),
        "skill_key": skill_key,
        "requires": {
            "bin": required_bins,
            "env": required_env,
            "config": required_config
        },
        "install_hints": install_hints,
        "eligibility": {
            "runnable_now": missing_bins.is_empty() && missing_env.is_empty() && required_config.is_empty(),
            "missing_bins": missing_bins,
            "missing_env": missing_env,
            "missing_config": required_config
        },
        "openclaw": openclaw
    })
}

async fn configured_env_source(
    store: &crate::modules::mcp::store::McpStore,
    skill_id: &str,
    key: &str,
    user_env_keys: &HashMap<String, String>,
) -> Option<String> {
    if user_env_keys.contains_key(key) {
        return Some("local_secret_store".to_string());
    }
    if store
        .has_local_skill_env_secret(skill_id, key)
        .await
        .ok()
        .unwrap_or(false)
    {
        return Some("local_secret_store".to_string());
    }
    if std::env::var(key)
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return Some("process_env".to_string());
    }
    None
}

fn configured_config_source(key: &str, user_config: &HashMap<String, JsonValue>) -> Option<String> {
    if user_config.get(key).is_some() {
        Some("user_settings".to_string())
    } else {
        None
    }
}

fn parse_user_settings_maps(
    user_settings_json: Option<&JsonValue>,
) -> (HashMap<String, String>, HashMap<String, JsonValue>) {
    let env_json = user_settings_json
        .and_then(|value| value.get("env_json"))
        .and_then(JsonValue::as_object)
        .map(|obj| {
            obj.iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|text| (key.clone(), text.to_string()))
                })
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let config_json = user_settings_json
        .and_then(|value| value.get("config_json"))
        .and_then(JsonValue::as_object)
        .map(|obj| {
            obj.iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default();
    (env_json, config_json)
}

async fn build_local_skill_runtime_status(
    store: &crate::modules::mcp::store::McpStore,
    install: &crate::modules::mcp::store::LocalSkillInstallDetail,
) -> Result<LocalSkillRuntimeStatus, String> {
    let manifest = serde_json::from_str::<JsonValue>(&install.manifest_json).map_err(to_string)?;
    let compatibility = manifest
        .get("compatibility")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let (plain_env, current_config) = parse_user_settings_maps(install.user_settings_json.as_ref());
    let stored_secrets = store
        .get_local_skill_env_secrets(&install.skill_id)
        .await
        .map_err(to_string)?;
    let execution_mode = compatibility
        .get("execution_mode")
        .and_then(JsonValue::as_str)
        .unwrap_or("docs_only")
        .to_string();
    let ecosystem = compatibility
        .get("ecosystem")
        .and_then(JsonValue::as_str)
        .unwrap_or("unknown")
        .to_string();
    let adapter_kind = compatibility
        .get("adapter_kind")
        .and_then(JsonValue::as_str)
        .unwrap_or("unknown")
        .to_string();
    let normalized_execution_surface = compatibility
        .get("normalized_execution_surface")
        .and_then(JsonValue::as_str)
        .unwrap_or("recipe")
        .to_string();
    let install_hints = value_to_string_list(compatibility.get("install_hints"));
    let display_name = manifest
        .get("name")
        .and_then(JsonValue::as_str)
        .unwrap_or(install.skill_id.as_str())
        .to_string();

    let env_keys = value_to_string_list(
        compatibility
            .get("requires")
            .and_then(|value| value.get("env")),
    );
    let required_bins = value_to_string_list(
        compatibility
            .get("requires")
            .and_then(|value| value.get("bin")),
    );
    let config_keys = value_to_string_list(
        compatibility
            .get("requires")
            .and_then(|value| value.get("config")),
    );
    let mut required_bins = required_bins;
    let mut missing_bins = value_to_string_list(
        compatibility
            .get("eligibility")
            .and_then(|value| value.get("missing_bins")),
    );
    let managed_runtime = detect_local_skill_runtime(install);
    if managed_runtime.supported {
        if managed_runtime.command_path.is_some() {
            match managed_runtime.provider_kind {
                Some(LocalSkillRuntimeProviderKind::Python) => {
                    missing_bins.retain(|item| !matches!(item.as_str(), "python" | "python3"));
                }
                Some(LocalSkillRuntimeProviderKind::Node) => {
                    missing_bins.retain(|item| !matches!(item.as_str(), "node" | "nodejs"));
                }
                None => {}
            }
        } else if !managed_runtime.manager_available {
            let manager_name = managed_runtime
                .manager
                .as_deref()
                .unwrap_or(LOCAL_SKILL_RUNTIME_MANAGER_UV);
            if !required_bins.iter().any(|item| item == manager_name) {
                required_bins.push(manager_name.to_string());
            }
            if !missing_bins.iter().any(|item| item == manager_name) {
                missing_bins.push(manager_name.to_string());
            }
        }
    }

    let required_env = env_keys
        .iter()
        .map(|key| async {
            let source =
                configured_env_source(store, &install.skill_id, key, &stored_secrets).await;
            LocalSkillRuntimeRequirementStatus {
                key: key.clone(),
                configured: source.is_some(),
                source,
            }
        })
        .collect::<Vec<_>>();
    let mut resolved_required_env = Vec::with_capacity(required_env.len());
    for item in required_env {
        resolved_required_env.push(item.await);
    }
    let missing_env = resolved_required_env
        .iter()
        .filter(|item| !item.configured)
        .map(|item| item.key.clone())
        .collect::<Vec<_>>();

    let required_config = config_keys
        .iter()
        .map(|key| {
            let source = configured_config_source(key, &current_config);
            LocalSkillRuntimeRequirementStatus {
                key: key.clone(),
                configured: source.is_some(),
                source,
            }
        })
        .collect::<Vec<_>>();
    let missing_config = required_config
        .iter()
        .filter(|item| !item.configured)
        .map(|item| item.key.clone())
        .collect::<Vec<_>>();

    let blocking_reason = if !install.is_enabled {
        Some("skill_disabled".to_string())
    } else if managed_runtime.supported
        && managed_runtime.state == LOCAL_SKILL_RUNTIME_STATE_INSTALLING
    {
        Some("runtime_installing".to_string())
    } else if managed_runtime.supported
        && managed_runtime.state == LOCAL_SKILL_RUNTIME_STATE_NEEDS_REINSTALL
    {
        Some("runtime_reinstall_required".to_string())
    } else if managed_runtime.supported
        && managed_runtime.state == LOCAL_SKILL_RUNTIME_STATE_INSTALL_FAILED
    {
        Some("runtime_install_failed".to_string())
    } else if managed_runtime.supported
        && managed_runtime.state == LOCAL_SKILL_RUNTIME_STATE_NEEDS_INSTALL
        && !managed_runtime.manager_available
    {
        Some("runtime_manager_missing".to_string())
    } else if managed_runtime.supported
        && managed_runtime.state == LOCAL_SKILL_RUNTIME_STATE_NEEDS_INSTALL
    {
        Some("runtime_install_required".to_string())
    } else if !missing_bins.is_empty() {
        Some("missing_binary".to_string())
    } else if !missing_env.is_empty() {
        Some("missing_env".to_string())
    } else if !missing_config.is_empty() {
        Some("missing_config".to_string())
    } else {
        compatibility
            .get("execution_mode")
            .and_then(JsonValue::as_str)
            .filter(|mode| *mode == "docs_only")
            .map(|_| "docs_only".to_string())
    };

    Ok(LocalSkillRuntimeStatus {
        skill_id: install.skill_id.clone(),
        display_name,
        installed_version: install.installed_version.clone(),
        is_enabled: install.is_enabled,
        execution_mode,
        ecosystem,
        adapter_kind,
        normalized_execution_surface,
        runnable_now: install.is_enabled
            && (!managed_runtime.supported
                || managed_runtime.state == LOCAL_SKILL_RUNTIME_STATE_READY)
            && missing_bins.is_empty()
            && missing_env.is_empty()
            && missing_config.is_empty(),
        required_bins,
        missing_bins,
        required_env: resolved_required_env,
        missing_env,
        required_config,
        missing_config,
        blocking_reason,
        install_hints,
        runtime_install_supported: managed_runtime.supported,
        runtime_kind: managed_runtime
            .provider_kind
            .map(|kind| kind.as_str().to_string()),
        runtime_install_state: managed_runtime.state.to_string(),
        runtime_install_manager: managed_runtime.manager,
        runtime_manager_available: managed_runtime.manager_available,
        runtime_install_error: managed_runtime.install_error,
        runtime_dependency_manifest_path: managed_runtime.requirements_path,
        runtime_command_path: managed_runtime.command_path,
        compatibility,
        current_env: plain_env
            .keys()
            .map(|key| (key.clone(), "".to_string()))
            .collect(),
        current_config,
    })
}

fn local_skill_visible_to_current_user(
    manifest: &JsonValue,
    current_user: Option<&crate::modules::capability_control_plane::DesktopCurrentUserInfo>,
) -> bool {
    let restricted = manifest
        .get("restricted")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let allowed_roles = manifest
        .get("allowed_roles")
        .and_then(JsonValue::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(JsonValue::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let id_hint = manifest.get("id").and_then(JsonValue::as_str);
    crate::modules::capability_control_plane::current_user_can_access_restricted_asset(
        current_user,
        restricted,
        &allowed_roles,
        id_hint,
    )
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
        let rel = relative_skill_path(skill_path, &path);
        match first_path_segment(&rel) {
            Some("scripts") if is_probably_script(&path) => snapshot.script_paths.push(rel.clone()),
            Some("references") => snapshot.reference_paths.push(rel.clone()),
            Some("assets") => snapshot.resource_paths.push(rel.clone()),
            _ => {}
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
    let compatibility =
        build_skill_compatibility_metadata(&snapshot, parsed_manifest.as_ref(), frontmatter);

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
            "script_paths": snapshot.script_paths,
            "reference_paths": snapshot.reference_paths,
            "resource_paths": snapshot.resource_paths,
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
    manifest_value.insert("compatibility".to_string(), compatibility);
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
    configure_background_tokio_command(&mut cmd);
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

#[derive(Debug, Clone, Serialize)]
pub struct LocalSkillRuntimeRequirementStatus {
    pub key: String,
    pub configured: bool,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalSkillRuntimeStatus {
    pub skill_id: String,
    pub display_name: String,
    pub installed_version: Option<String>,
    pub is_enabled: bool,
    pub execution_mode: String,
    pub ecosystem: String,
    pub adapter_kind: String,
    pub normalized_execution_surface: String,
    pub runnable_now: bool,
    pub required_bins: Vec<String>,
    pub missing_bins: Vec<String>,
    pub required_env: Vec<LocalSkillRuntimeRequirementStatus>,
    pub missing_env: Vec<String>,
    pub required_config: Vec<LocalSkillRuntimeRequirementStatus>,
    pub missing_config: Vec<String>,
    pub blocking_reason: Option<String>,
    pub install_hints: Vec<String>,
    pub runtime_install_supported: bool,
    pub runtime_kind: Option<String>,
    pub runtime_install_state: String,
    pub runtime_install_manager: Option<String>,
    pub runtime_manager_available: bool,
    pub runtime_install_error: Option<String>,
    pub runtime_dependency_manifest_path: Option<String>,
    pub runtime_command_path: Option<String>,
    pub compatibility: JsonValue,
    pub current_env: HashMap<String, String>,
    pub current_config: HashMap<String, JsonValue>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateLocalSkillRuntimeSettingsRequest {
    #[serde(default)]
    pub env_json: Option<HashMap<String, String>>,
    #[serde(default)]
    pub config_json: Option<HashMap<String, JsonValue>>,
}

pub(crate) async fn install_skill_to_local(
    app: &AppHandle,
    app_state: &AppState,
    repo_url: &str,
    revision: Option<&str>,
    alias: Option<&str>,
    expected_skill_id: Option<&str>,
) -> Result<SkillInstallResult, String> {
    let skills_dir = app.path().app_data_dir().map_err(to_string)?.join("skills");
    let materialized = materialize_skill_repo_to_dir(
        &skills_dir,
        repo_url,
        revision,
        "user_skill",
        expected_skill_id,
    )
    .await?;
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
    migrate_conflicting_local_skill_installs_for_path(store.as_ref(), &skill_id, &final_dir)
        .await?;

    if let Some(alias) = alias.map(str::trim).filter(|value| !value.is_empty()) {
        store
            .update_local_skill_user_settings(&skill_id, &json!({ "alias": alias }))
            .await
            .map_err(to_string)?;
    }

    let indexed_tools = register_local_skills_inner(app.clone(), app_state)
        .await
        .unwrap_or(0);

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
            asset
                .get("pkg_name")
                .and_then(JsonValue::as_str)
                .is_some_and(|pkg| pkg.starts_with("skill."))
        })
        .filter_map(|asset| {
            asset
                .get("id")
                .and_then(JsonValue::as_str)
                .map(str::to_string)
        })
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
    let registry_generation = app_state
        .mcp
        .store
        .next_local_capability_registry_generation()
        .await
        .map_err(to_string)?;
    let install_detail = app_state
        .mcp
        .store
        .get_local_skill_install_detail(normalized_skill_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| {
            format!(
                "local skill install {} missing during reindex",
                normalized_skill_id
            )
        })?;
    let activation_state = registry_activation_state_for_install(&install_detail);
    let runtime_state = registry_runtime_state_for_install(&install_detail);

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
    .await?;

    let bindings = collect_local_skill_tool_bindings(&skill_path, &skill_def)?;
    app_state
        .mcp
        .store
        .replace_local_skill_tool_bindings(
            normalized_skill_id,
            &bindings
                .iter()
                .map(
                    |binding| crate::modules::mcp::store::LocalSkillToolBindingUpsert {
                        binding_id: binding.binding_id.clone(),
                        binding_kind: binding.binding_kind.clone(),
                        callable_name: binding.callable_name.clone(),
                        tool_name: binding.tool_name.clone(),
                        description: binding.description.clone(),
                        input_schema_json: binding
                            .input_schema
                            .as_ref()
                            .map(|value| value.to_string()),
                        output_schema_json: binding
                            .output_schema
                            .as_ref()
                            .map(|value| value.to_string()),
                        entry_path: binding.entry_path.clone(),
                        runtime: binding.runtime.clone(),
                        timeout_seconds: binding.timeout_seconds,
                    },
                )
                .collect::<Vec<_>>(),
        )
        .await
        .map_err(to_string)?;
    index_local_skill_tool_binding_assets(
        app_state.providers.clone(),
        app_state.memory.clone(),
        normalized_skill_id,
        &skill_def.display_name,
        &bindings,
        &skill_def.manifest_json,
        infer_local_skill_asset_source_type(&skill_path),
    )
    .await?;

    let registry_entries = build_local_skill_registry_entries(
        &skill_path,
        &skill_def,
        &bindings,
        infer_local_skill_asset_source_type(&skill_path),
        activation_state,
        &runtime_state,
        "pending",
        registry_generation,
    )?;
    app_state
        .mcp
        .store
        .replace_local_capability_registry_entries(normalized_skill_id, &registry_entries)
        .await
        .map_err(to_string)?;
    app_state
        .mcp
        .store
        .update_local_capability_registry_states(normalized_skill_id, None, None, Some("ready"))
        .await
        .map_err(to_string)?;
    Ok(())
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
        let normalized_install_path = install_path.to_string_lossy().replace('\\', "/");
        if normalized_install_path.contains("/official-skills/") {
            return Err("cannot uninstall official (read-only) skills".to_string());
        }
        return Err(
            "cannot uninstall externally managed skills; remove them from the shared agent skills directory"
                .to_string(),
        );
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
    let runtime_root = runtime_root_for_skill(app, skill_id)?;
    if runtime_root.exists() {
        std::fs::remove_dir_all(&runtime_root).map_err(to_string)?;
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

async fn index_local_skill_tool_binding_assets(
    provider_state: std::sync::Arc<crate::modules::providers::ProviderState>,
    memory_state: std::sync::Arc<crate::modules::memory::MemoryState>,
    skill_id: &str,
    skill_display_name: &str,
    bindings: &[LocalSkillToolBindingDefinition],
    skill_manifest_json: &str,
    source_type: &str,
) -> Result<(), String> {
    let manifest_value = serde_json::from_str::<JsonValue>(skill_manifest_json).ok();
    let compatibility = manifest_value
        .as_ref()
        .and_then(|value| value.get("compatibility").cloned());
    let restricted = manifest_value
        .as_ref()
        .and_then(|value| value.get("restricted"))
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let allowed_roles = manifest_value
        .as_ref()
        .and_then(|value| value.get("allowed_roles"))
        .and_then(JsonValue::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(JsonValue::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for binding in bindings {
        let mut body = format!(
            "skill: {}\nskill_id: {}\ncallable_name: {}\ntool_name: {}\ndescription: {}\nexecution_lane: skill_runtime",
            skill_display_name,
            skill_id,
            binding.callable_name,
            binding.tool_name,
            binding.description
        );
        if let Some(input_schema) = binding.input_schema.as_ref() {
            body.push_str("\ninput_schema:\n");
            body.push_str(&input_schema.to_string());
        }
        if let Some(output_schema) = binding.output_schema.as_ref() {
            body.push_str("\noutput_schema:\n");
            body.push_str(&output_schema.to_string());
        }

        let vector = provider_state
            .embedding
            .embed_text(&body)
            .await
            .map_err(|e| e.to_string())?;

        let metadata = serde_json::json!({
            "asset_namespace": "skill",
            "binding_id": binding.binding_id,
            "binding_kind": binding.binding_kind,
            "skill_id": skill_id,
            "tool_name": binding.tool_name,
            "callable_name": binding.callable_name,
            "execution_lane": "skill_runtime",
            "input_schema": binding.input_schema,
            "output_schema": binding.output_schema,
            "entry_path": binding.entry_path,
            "runtime": binding.runtime,
            "timeout_seconds": binding.timeout_seconds,
            "compatibility": compatibility,
            "restricted": restricted,
            "allowed_roles": allowed_roles,
        });

        memory_state
            .store
            .upsert_asset(
                binding.binding_id.clone(),
                binding.callable_name.clone(),
                binding.description.clone(),
                "skill_tool".to_string(),
                source_type.to_string(),
                Some(skill_id.to_string()),
                vector,
                Some(metadata),
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Automatically install runtimes for official skills that need it.
/// Called once after `register_local_skills_inner` during app startup.
/// Each install runs in a background task so it never blocks the launch.
#[allow(dead_code)]
pub(crate) async fn auto_install_official_skill_runtimes(app: &AppHandle, app_state: &AppState) {
    let installs = match app_state.mcp.store.list_local_skill_install_details().await {
        Ok(list) => list,
        Err(err) => {
            log::warn!(
                "auto_install_official_skill_runtimes: failed to list installs: {}",
                err
            );
            return;
        }
    };

    let official_skills_marker = format!(
        "{}official-skills{}",
        std::path::MAIN_SEPARATOR,
        std::path::MAIN_SEPARATOR
    );
    let official_skills_marker_alt = "/official-skills/";

    for install in installs {
        let is_official = install.install_path.contains(&official_skills_marker)
            || install.install_path.contains(official_skills_marker_alt);
        if !is_official {
            continue;
        }

        let runtime_status = detect_local_skill_runtime(&install);
        if !runtime_status.supported {
            continue;
        }
        if !runtime_status.manager_available {
            log::info!(
                "auto_install_official_skill_runtimes: skipping {} — runtime manager ({}) not available",
                install.skill_id,
                runtime_status.manager.as_deref().unwrap_or("unknown"),
            );
            continue;
        }

        let dominated_by_ready = runtime_status.state == LOCAL_SKILL_RUNTIME_STATE_READY;
        let needs_work = runtime_status.state == LOCAL_SKILL_RUNTIME_STATE_NEEDS_INSTALL
            || runtime_status.state == LOCAL_SKILL_RUNTIME_STATE_NEEDS_REINSTALL;
        if dominated_by_ready || !needs_work {
            continue;
        }

        log::info!(
            "auto_install_official_skill_runtimes: scheduling runtime install for official skill {}",
            install.skill_id,
        );

        // Mark as installing
        let requirements_path = runtime_status
            .requirements_path
            .as_deref()
            .map(PathBuf::from);
        let requirements_hash = requirements_path.as_deref().and_then(compute_file_sha256);
        let runtime_root = runtime_root_for_skill(app, &install.skill_id).ok();
        let mut settings = normalize_runtime_settings_json(install.user_settings_json.as_ref());
        if upsert_runtime_install_metadata(
            &mut settings,
            LOCAL_SKILL_RUNTIME_STATE_INSTALLING,
            runtime_status
                .manager
                .as_deref()
                .or(Some(LOCAL_SKILL_RUNTIME_MANAGER_UV)),
            runtime_root.as_deref(),
            requirements_path.as_deref(),
            requirements_hash.as_deref(),
            None,
            None,
        )
        .is_ok()
        {
            let _ = app_state
                .mcp
                .store
                .update_local_skill_user_settings(&install.skill_id, &settings)
                .await;
        }

        // Spawn background install
        let app_handle = app.clone();
        let app_state_cloned = app_state.clone();
        let skill_id = install.skill_id.clone();
        tauri::async_runtime::spawn(async move {
            match install_managed_local_skill_runtime(&app_handle, &app_state_cloned, &skill_id)
                .await
            {
                Ok(outcome) => {
                    if let Ok(Some(detail)) = app_state_cloned
                        .mcp
                        .store
                        .get_local_skill_install_detail(&skill_id)
                        .await
                    {
                        let mut ready_settings =
                            normalize_runtime_settings_json(detail.user_settings_json.as_ref());
                        let (_provider_kind, manager, runtime_root, req_path, req_hash, cmd_path) =
                            runtime_install_metadata_from_outcome(&outcome);
                        if upsert_runtime_install_metadata(
                            &mut ready_settings,
                            LOCAL_SKILL_RUNTIME_STATE_READY,
                            manager,
                            runtime_root,
                            req_path,
                            req_hash,
                            cmd_path,
                            None,
                        )
                        .is_ok()
                        {
                            let _ = app_state_cloned
                                .mcp
                                .store
                                .update_local_skill_user_settings(&skill_id, &ready_settings)
                                .await;
                        }
                    }
                    log::info!(
                        "auto_install_official_skill_runtimes: {} runtime installed successfully",
                        skill_id,
                    );
                }
                Err(err) => {
                    if let Ok(Some(detail)) = app_state_cloned
                        .mcp
                        .store
                        .get_local_skill_install_detail(&skill_id)
                        .await
                    {
                        let resolved = detect_local_skill_runtime(&detail);
                        let mut failed_settings =
                            normalize_runtime_settings_json(detail.user_settings_json.as_ref());
                        let req_path = resolved.requirements_path.as_deref().map(PathBuf::from);
                        let req_hash = req_path.as_deref().and_then(compute_file_sha256);
                        let runtime_root = runtime_root_for_skill(&app_handle, &skill_id).ok();
                        let _ = upsert_runtime_install_metadata(
                            &mut failed_settings,
                            LOCAL_SKILL_RUNTIME_STATE_INSTALL_FAILED,
                            resolved
                                .manager
                                .as_deref()
                                .or(Some(LOCAL_SKILL_RUNTIME_MANAGER_UV)),
                            runtime_root.as_deref(),
                            req_path.as_deref(),
                            req_hash.as_deref(),
                            None,
                            Some(&err),
                        );
                        let _ = app_state_cloned
                            .mcp
                            .store
                            .update_local_skill_user_settings(&skill_id, &failed_settings)
                            .await;
                    }
                    log::warn!(
                        "auto_install_official_skill_runtimes: {} runtime install failed: {}",
                        skill_id,
                        err,
                    );
                }
            }
        });
    }
}

pub async fn list_local_skill_runtime_statuses(
    app_state: State<'_, AppState>,
) -> Result<Vec<LocalSkillRuntimeStatus>, String> {
    let current_user =
        crate::modules::capability_control_plane::current_desktop_user_info_optional().await;
    let installs = app_state
        .mcp
        .store
        .list_local_skill_install_details()
        .await
        .map_err(to_string)?;
    let mut statuses = Vec::with_capacity(installs.len());
    for install in &installs {
        let manifest =
            serde_json::from_str::<JsonValue>(&install.manifest_json).map_err(to_string)?;
        if !local_skill_visible_to_current_user(&manifest, current_user.as_ref()) {
            continue;
        }
        statuses
            .push(build_local_skill_runtime_status(app_state.mcp.store.as_ref(), install).await?);
    }
    Ok(statuses)
}

pub async fn update_local_skill_runtime_settings(
    app_state: State<'_, AppState>,
    skill_id: String,
    payload: UpdateLocalSkillRuntimeSettingsRequest,
) -> Result<LocalSkillRuntimeStatus, String> {
    let normalized_skill_id = skill_id.trim().to_string();
    if normalized_skill_id.is_empty() {
        return Err("skill_id is required".to_string());
    }
    let installs = app_state
        .mcp
        .store
        .list_local_skill_install_details()
        .await
        .map_err(to_string)?;
    let install = installs
        .into_iter()
        .find(|item| item.skill_id == normalized_skill_id)
        .ok_or_else(|| format!("local skill {} is not installed", normalized_skill_id))?;

    let mut settings = install
        .user_settings_json
        .clone()
        .unwrap_or_else(|| json!({}));
    if !settings.is_object() {
        settings = json!({});
    }
    let settings_obj = settings
        .as_object_mut()
        .ok_or_else(|| "skill settings must be an object".to_string())?;
    if let Some(env_json) = payload.env_json.as_ref() {
        app_state
            .mcp
            .store
            .replace_local_skill_env_secrets(&normalized_skill_id, env_json)
            .await
            .map_err(to_string)?;
        settings_obj.remove("env_json");
    }
    if let Some(config_json) = payload.config_json {
        settings_obj.insert("config_json".to_string(), json!(config_json));
    }

    app_state
        .mcp
        .store
        .update_local_skill_user_settings(&normalized_skill_id, &settings)
        .await
        .map_err(to_string)?;

    let updated = app_state
        .mcp
        .store
        .list_local_skill_install_details()
        .await
        .map_err(to_string)?
        .into_iter()
        .find(|item| item.skill_id == normalized_skill_id)
        .ok_or_else(|| format!("local skill {} missing after update", normalized_skill_id))?;
    build_local_skill_runtime_status(app_state.mcp.store.as_ref(), &updated).await
}

pub async fn install_local_skill_runtime(
    app: AppHandle,
    app_state: State<'_, AppState>,
    skill_id: String,
) -> Result<LocalSkillRuntimeStatus, String> {
    let normalized_skill_id = skill_id.trim().to_string();
    if normalized_skill_id.is_empty() {
        return Err("skill_id is required".to_string());
    }

    let install = app_state
        .mcp
        .store
        .get_local_skill_install_detail(&normalized_skill_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("local skill {} is not installed", normalized_skill_id))?;

    let managed_runtime = detect_local_skill_runtime(&install);
    if !managed_runtime.supported {
        return Err(format!(
            "local skill {} does not expose a managed runtime in the current phase",
            normalized_skill_id
        ));
    }
    if !managed_runtime.manager_available {
        return Err("uv is required to install local skill runtime".to_string());
    }

    let requirements_path = managed_runtime
        .requirements_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| {
            format!(
                "local skill {} is missing requirements.txt",
                normalized_skill_id
            )
        })?;
    let mut settings = normalize_runtime_settings_json(install.user_settings_json.as_ref());
    let requirements_hash = compute_file_sha256(&requirements_path)
        .ok_or_else(|| format!("failed to read {}", requirements_path.display()))?;
    let runtime_root = runtime_root_for_skill(&app, &normalized_skill_id)?;
    upsert_runtime_install_metadata(
        &mut settings,
        LOCAL_SKILL_RUNTIME_STATE_INSTALLING,
        managed_runtime
            .manager
            .as_deref()
            .or(Some(LOCAL_SKILL_RUNTIME_MANAGER_UV)),
        Some(&runtime_root),
        Some(&requirements_path),
        Some(requirements_hash.as_str()),
        None,
        None,
    )?;

    app_state
        .mcp
        .store
        .update_local_skill_user_settings(&normalized_skill_id, &settings)
        .await
        .map_err(to_string)?;

    let app_handle = app.clone();
    let app_state_cloned = app_state.inner().clone();
    let skill_id_for_task = normalized_skill_id.clone();
    tauri::async_runtime::spawn(async move {
        match install_managed_local_skill_runtime(
            &app_handle,
            &app_state_cloned,
            &skill_id_for_task,
        )
        .await
        {
            Ok(outcome) => {
                if let Ok(Some(install_detail)) = app_state_cloned
                    .mcp
                    .store
                    .get_local_skill_install_detail(&skill_id_for_task)
                    .await
                {
                    let mut ready_settings =
                        normalize_runtime_settings_json(install_detail.user_settings_json.as_ref());
                    let (
                        _provider_kind,
                        manager,
                        runtime_root,
                        requirements_path,
                        requirements_hash,
                        command_path,
                    ) = runtime_install_metadata_from_outcome(&outcome);
                    if upsert_runtime_install_metadata(
                        &mut ready_settings,
                        LOCAL_SKILL_RUNTIME_STATE_READY,
                        manager,
                        runtime_root,
                        requirements_path,
                        requirements_hash,
                        command_path,
                        None,
                    )
                    .is_ok()
                    {
                        let _ = app_state_cloned
                            .mcp
                            .store
                            .update_local_skill_user_settings(&skill_id_for_task, &ready_settings)
                            .await;
                    }
                }
            }
            Err(err) => {
                match app_state_cloned
                    .mcp
                    .store
                    .get_local_skill_install_detail(&skill_id_for_task)
                    .await
                {
                    Ok(Some(install_detail)) => {
                        let resolved = detect_local_skill_runtime(&install_detail);
                        let mut failed_settings = normalize_runtime_settings_json(
                            install_detail.user_settings_json.as_ref(),
                        );
                        let requirements_path =
                            resolved.requirements_path.as_deref().map(PathBuf::from);
                        let requirements_hash =
                            requirements_path.as_deref().and_then(compute_file_sha256);
                        let runtime_root =
                            runtime_root_for_skill(&app_handle, &skill_id_for_task).ok();
                        if upsert_runtime_install_metadata(
                            &mut failed_settings,
                            LOCAL_SKILL_RUNTIME_STATE_INSTALL_FAILED,
                            resolved
                                .manager
                                .as_deref()
                                .or(Some(LOCAL_SKILL_RUNTIME_MANAGER_UV)),
                            runtime_root.as_deref(),
                            requirements_path.as_deref(),
                            requirements_hash.as_deref(),
                            None,
                            Some(&err),
                        )
                        .is_ok()
                        {
                            let _ = app_state_cloned
                                .mcp
                                .store
                                .update_local_skill_user_settings(
                                    &skill_id_for_task,
                                    &failed_settings,
                                )
                                .await;
                        }
                    }
                    Ok(None) => {}
                    Err(fetch_err) => {
                        log::warn!(
                            "install_local_skill_runtime {}: failed to refresh install detail after error: {}",
                            skill_id_for_task,
                            fetch_err
                        );
                    }
                }
                log::warn!(
                    "install_local_skill_runtime {}: background install failed: {}",
                    skill_id_for_task,
                    err
                );
            }
        }
    });

    let updated = app_state
        .mcp
        .store
        .get_local_skill_install_detail(&normalized_skill_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| {
            format!(
                "local skill {} missing after runtime install",
                normalized_skill_id
            )
        })?;
    build_local_skill_runtime_status(app_state.mcp.store.as_ref(), &updated).await
}

pub async fn install_skill_from_repo(
    app: AppHandle,
    app_state: State<'_, AppState>,
    repo_url: String,
    revision: Option<String>,
    alias: Option<String>,
    expected_skill_id: Option<String>,
    #[allow(non_snake_case)] expectedSkillId: Option<String>,
) -> Result<SkillInstallResult, String> {
    let normalized_expected_skill_id = expectedSkillId
        .or(expected_skill_id)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    install_skill_to_local(
        &app,
        app_state.inner(),
        &repo_url,
        revision.as_deref(),
        alias.as_deref(),
        normalized_expected_skill_id.as_deref(),
    )
    .await
}

pub async fn uninstall_skill(
    app: AppHandle,
    app_state: State<'_, AppState>,
    skill_id: String,
) -> Result<(), String> {
    uninstall_local_skill(&app, app_state.inner(), &skill_id).await
}

pub async fn list_local_installed_skill_ids(
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let installs = app_state
        .mcp
        .store
        .list_local_skill_install_details()
        .await
        .map_err(to_string)?;
    let mut keys = BTreeSet::new();
    for install in installs.into_iter().filter(|item| item.is_enabled) {
        keys.extend(collect_local_skill_match_keys(&install));
    }
    Ok(keys.into_iter().collect())
}

pub(crate) async fn register_local_skills_inner(
    app: AppHandle,
    app_state: &AppState,
) -> Result<usize, String> {
    crate::modules::skills::commands::register_local_skills_inner(app, app_state).await
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

    fn temp_sqlite_url(prefix: &str) -> (String, PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "deeting-{}-{}.db",
            prefix,
            uuid::Uuid::new_v4().simple()
        ));
        (
            format!("sqlite:{}", path.to_string_lossy().replace('\\', "/")),
            path,
        )
    }

    #[test]
    fn select_official_skills_scan_dir_prefers_workspace_when_bundled_copy_exists() {
        let workspace_dir = temp_skill_dir("workspace-official-skills");
        let bundled_dir = temp_skill_dir("bundled-official-skills");

        let selected = crate::modules::skills::registry_scan::select_official_skills_scan_dir(
            workspace_dir.clone(),
            Some(bundled_dir.clone()),
        );

        assert_eq!(selected, workspace_dir);

        let _ = std::fs::remove_dir_all(bundled_dir);
        let _ = std::fs::remove_dir_all(workspace_dir);
    }

    #[test]
    fn select_official_skills_scan_dir_falls_back_to_bundled_copy_when_workspace_missing() {
        let workspace_dir = std::env::temp_dir().join(format!(
            "deeting-missing-workspace-official-skills-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let bundled_dir = temp_skill_dir("bundled-official-skills-fallback");

        let selected = crate::modules::skills::registry_scan::select_official_skills_scan_dir(
            workspace_dir.clone(),
            Some(bundled_dir.clone()),
        );

        assert_eq!(selected, bundled_dir);

        let _ = std::fs::remove_dir_all(workspace_dir);
        let _ = std::fs::remove_dir_all(bundled_dir);
    }

    fn write_managed_python_skill(dir: &Path, skill_id: &str) {
        std::fs::write(
            dir.join("deeting.json"),
            serde_json::json!({
                "id": skill_id,
                "name": "Managed Python Skill",
                "runtime": ["local"],
                "execution": { "timeout_seconds": 30 },
                "capabilities": { "llm_tools": "llm-tool.yaml" }
            })
            .to_string(),
        )
        .expect("write manifest");
        std::fs::write(
            dir.join("llm-tool.yaml"),
            "tools:\n  - name: ping\n    description: Ping.\n    parameters:\n      type: object\n      properties: {}\n",
        )
        .expect("write tool manifest");
        std::fs::write(dir.join("main.py"), "print('ok')\n").expect("write entrypoint");
        std::fs::write(dir.join("requirements.txt"), "httpx>=0.27.0\n")
            .expect("write requirements");
    }

    fn write_managed_node_skill(dir: &Path, skill_id: &str) {
        std::fs::write(
            dir.join("deeting.json"),
            serde_json::json!({
                "id": skill_id,
                "name": "Managed Node Skill",
                "runtime": ["local"],
                "entry": { "backend": "main.js" },
                "execution": { "timeout_seconds": 30 }
            })
            .to_string(),
        )
        .expect("write manifest");
        std::fs::write(dir.join("main.js"), "console.log('ok')\n").expect("write entrypoint");
        std::fs::write(
            dir.join("package.json"),
            serde_json::json!({
                "name": skill_id,
                "version": "1.0.0",
                "dependencies": {
                    "lodash": "^4.17.21"
                }
            })
            .to_string(),
        )
        .expect("write package manifest");
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
                .pointer("/compatibility/adapter_kind")
                .and_then(|value| value.as_str()),
            Some("docs_bundle")
        );
        assert_eq!(
            manifest
                .pointer("/compatibility/normalized_execution_surface")
                .and_then(|value| value.as_str()),
            Some("recipe")
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
        assert!(resolved.skill_id.contains("tool-skill"));
        assert_eq!(
            manifest
                .pointer("/source_metadata/assets/has_tool_manifest")
                .and_then(|value| value.as_bool()),
            Some(true)
        );
        assert_eq!(
            manifest
                .pointer("/compatibility/normalized_execution_surface")
                .and_then(|value| value.as_str()),
            Some("recipe")
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn resolve_local_skill_definition_marks_deeting_binding_as_desktop_capability_surface() {
        let dir = temp_skill_dir("desktop-capability-skill");
        std::fs::write(dir.join("notes.txt"), "Desktop host capability skill.")
            .expect("write docs");
        std::fs::write(
            dir.join("deeting.json"),
            serde_json::json!({
                "id": "desktop-capability-skill",
                "name": "Desktop Capability Skill",
                "runtime": ["local"],
                "execution": { "timeout_seconds": 30 }
            })
            .to_string(),
        )
        .expect("write manifest");
        std::fs::write(
            dir.join("llm-tool.yaml"),
            "tools:\n  - name: ping_host\n    description: Ping desktop host capability.\n    parameters: { type: object, properties: {} }\n",
        )
        .expect("write tool manifest");
        std::fs::write(dir.join("main.py"), "print('hello')\n").expect("write entrypoint");

        let resolved = resolve_local_skill_definition(&dir, "user_skill", None, None)
            .expect("resolve skill")
            .expect("skill exists");

        let manifest: JsonValue =
            serde_json::from_str(&resolved.manifest_json).expect("manifest json");
        assert_eq!(
            manifest
                .pointer("/compatibility/adapter_kind")
                .and_then(|value| value.as_str()),
            Some("deeting_tool_binding")
        );
        assert_eq!(
            manifest
                .pointer("/compatibility/normalized_execution_surface")
                .and_then(|value| value.as_str()),
            Some("desktop_capability")
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
    fn resolve_local_skill_definition_captures_openclaw_metadata_and_scripts() {
        let dir = temp_skill_dir("openclaw-compat-skill");
        std::fs::write(
            dir.join("SKILL.md"),
            concat!(
                "---\n",
                "name: weather helper\n",
                "description: OpenClaw compatible weather skill\n",
                "metadata:\n",
                "  openclaw:\n",
                "    skillKey: clawhub.weather\n",
                "    requires:\n",
                "      env: [OPENWEATHER_API_KEY]\n",
                "      bin: [python3]\n",
                "      config: [weather.city]\n",
                "    install:\n",
                "      - pip install -r requirements.txt\n",
                "---\n\n",
                "Use scripts/fetch_weather.py to fetch weather data.\n"
            ),
        )
        .expect("write skill docs");
        std::fs::create_dir_all(dir.join("scripts")).expect("create scripts dir");
        std::fs::create_dir_all(dir.join("references")).expect("create references dir");
        std::fs::create_dir_all(dir.join("assets")).expect("create assets dir");
        std::fs::write(
            dir.join("scripts").join("fetch_weather.py"),
            "print('ok')\n",
        )
        .expect("write script");
        std::fs::write(
            dir.join("references").join("usage.md"),
            "Reference content for this skill.",
        )
        .expect("write reference");
        std::fs::write(dir.join("assets").join("icon.svg"), "<svg />").expect("write asset");

        let resolved = resolve_local_skill_definition(&dir, "user_skill", None, None)
            .expect("resolve skill")
            .expect("skill exists");

        let manifest: JsonValue =
            serde_json::from_str(&resolved.manifest_json).expect("manifest json");
        assert_eq!(
            manifest
                .pointer("/compatibility/ecosystem")
                .and_then(|value| value.as_str()),
            Some("openclaw_agentskills")
        );
        assert_eq!(
            manifest
                .pointer("/compatibility/adapter_kind")
                .and_then(|value| value.as_str()),
            Some("openclaw_script")
        );
        assert_eq!(
            manifest
                .pointer("/compatibility/execution_mode")
                .and_then(|value| value.as_str()),
            Some("script_guidance")
        );
        assert_eq!(
            manifest
                .pointer("/compatibility/normalized_execution_surface")
                .and_then(|value| value.as_str()),
            Some("script_runner")
        );
        assert_eq!(
            manifest
                .pointer("/compatibility/skill_key")
                .and_then(|value| value.as_str()),
            Some("clawhub.weather")
        );
        assert_eq!(
            manifest
                .pointer("/compatibility/requires/config/0")
                .and_then(|value| value.as_str()),
            Some("weather.city")
        );
        assert_eq!(
            manifest
                .pointer("/compatibility/eligibility/missing_config/0")
                .and_then(|value| value.as_str()),
            Some("weather.city")
        );
        assert_eq!(
            manifest
                .pointer("/source_metadata/assets/script_paths/0")
                .and_then(|value| value.as_str()),
            Some("scripts/fetch_weather.py")
        );
        assert_eq!(
            manifest
                .pointer("/source_metadata/assets/reference_paths/0")
                .and_then(|value| value.as_str()),
            Some("references/usage.md")
        );
        assert_eq!(
            manifest
                .pointer("/source_metadata/assets/resource_paths/0")
                .and_then(|value| value.as_str()),
            Some("assets/icon.svg")
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn detect_local_skill_runtime_reports_ready_when_hash_matches() {
        let dir = temp_skill_dir("managed-python-ready");
        let skill_id = "managed.python.ready";
        write_managed_python_skill(&dir, skill_id);
        let requirements_path = dir.join("requirements.txt");
        let requirements_hash = compute_file_sha256(&requirements_path).expect("requirements hash");
        let python_path = dir.join(".venv").join("bin").join("python");
        std::fs::create_dir_all(python_path.parent().expect("venv parent"))
            .expect("create venv dir");
        std::fs::write(&python_path, "").expect("write fake python");

        let install = crate::modules::mcp::store::LocalSkillInstallDetail {
            skill_id: skill_id.to_string(),
            installed_version: Some("1.0.0".to_string()),
            is_enabled: true,
            runtime: Some("local".to_string()),
            install_path: dir.to_string_lossy().to_string(),
            manifest_json: std::fs::read_to_string(dir.join("deeting.json"))
                .expect("read manifest"),
            user_settings_json: Some(json!({
                "runtime_install": {
                    "python_path": python_path.to_string_lossy().to_string(),
                    "requirements_hash": requirements_hash,
                }
            })),
        };

        let status = detect_local_skill_runtime(&install);

        assert!(status.supported);
        assert_eq!(status.state, LOCAL_SKILL_RUNTIME_STATE_READY);
        assert!(status.command_path.is_some());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn detect_local_skill_runtime_reports_ready_for_shared_python_when_runtime_root_recorded() {
        let dir = temp_skill_dir("managed-python-shared-runtime");
        let runtime_root = temp_skill_dir("managed-python-shared-runtime-root");
        let skill_id = "managed.python.shared";
        write_managed_python_skill(&dir, skill_id);
        let requirements_path = dir.join("requirements.txt");
        let requirements_hash = compute_file_sha256(&requirements_path).expect("requirements hash");
        let python_path = if cfg!(target_os = "windows") {
            runtime_root
                .join(".venv")
                .join("Scripts")
                .join("python.exe")
        } else {
            runtime_root.join(".venv").join("bin").join("python")
        };
        std::fs::create_dir_all(python_path.parent().expect("venv parent"))
            .expect("create shared runtime venv dir");
        std::fs::write(&python_path, "").expect("write fake shared runtime python");

        let install = crate::modules::mcp::store::LocalSkillInstallDetail {
            skill_id: skill_id.to_string(),
            installed_version: Some("1.0.0".to_string()),
            is_enabled: true,
            runtime: Some("local".to_string()),
            install_path: dir.to_string_lossy().to_string(),
            manifest_json: std::fs::read_to_string(dir.join("deeting.json"))
                .expect("read manifest"),
            user_settings_json: Some(json!({
                "runtime_install": {
                    "runtime_root": runtime_root.to_string_lossy().to_string(),
                    "command_path": python_path.to_string_lossy().to_string(),
                    "requirements_hash": requirements_hash,
                }
            })),
        };

        let status = detect_local_skill_runtime(&install);

        assert!(status.supported);
        assert_eq!(status.state, LOCAL_SKILL_RUNTIME_STATE_READY);
        assert_eq!(
            status.command_path.as_deref(),
            Some(python_path.to_string_lossy().as_ref())
        );

        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[test]
    fn detect_local_skill_runtime_reports_needs_reinstall_when_requirements_change() {
        let dir = temp_skill_dir("managed-python-reinstall");
        let skill_id = "managed.python.reinstall";
        write_managed_python_skill(&dir, skill_id);
        let python_path = dir.join(".venv").join("bin").join("python");
        std::fs::create_dir_all(python_path.parent().expect("venv parent"))
            .expect("create venv dir");
        std::fs::write(&python_path, "").expect("write fake python");

        let install = crate::modules::mcp::store::LocalSkillInstallDetail {
            skill_id: skill_id.to_string(),
            installed_version: Some("1.0.0".to_string()),
            is_enabled: true,
            runtime: Some("local".to_string()),
            install_path: dir.to_string_lossy().to_string(),
            manifest_json: std::fs::read_to_string(dir.join("deeting.json"))
                .expect("read manifest"),
            user_settings_json: Some(json!({
                "runtime_install": {
                    "python_path": python_path.to_string_lossy().to_string(),
                    "requirements_hash": "stale-hash",
                }
            })),
        };

        let status = detect_local_skill_runtime(&install);

        assert!(status.supported);
        assert_eq!(status.state, LOCAL_SKILL_RUNTIME_STATE_NEEDS_REINSTALL);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn detect_local_skill_runtime_reports_installing_when_marked_in_settings() {
        let dir = temp_skill_dir("managed-python-installing");
        let skill_id = "managed.python.installing";
        write_managed_python_skill(&dir, skill_id);
        let python_path = dir.join(".venv").join("bin").join("python");
        std::fs::create_dir_all(python_path.parent().expect("venv parent"))
            .expect("create venv dir");
        std::fs::write(&python_path, "").expect("write fake python");

        let install = crate::modules::mcp::store::LocalSkillInstallDetail {
            skill_id: skill_id.to_string(),
            installed_version: Some("1.0.0".to_string()),
            is_enabled: true,
            runtime: Some("local".to_string()),
            install_path: dir.to_string_lossy().to_string(),
            manifest_json: std::fs::read_to_string(dir.join("deeting.json"))
                .expect("read manifest"),
            user_settings_json: Some(json!({
                "runtime_install": {
                    "state": "installing",
                    "python_path": python_path.to_string_lossy().to_string(),
                }
            })),
        };

        let status = detect_local_skill_runtime(&install);

        assert!(status.supported);
        assert_eq!(status.state, LOCAL_SKILL_RUNTIME_STATE_INSTALLING);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn detect_local_skill_runtime_reports_ready_for_node_when_hash_matches() {
        let dir = temp_skill_dir("managed-node-ready");
        let skill_id = "managed.node.ready";
        write_managed_node_skill(&dir, skill_id);
        std::fs::create_dir_all(dir.join("node_modules")).expect("create node_modules");
        let package_json_path = dir.join("package.json");
        let package_hash = compute_file_sha256(&package_json_path).expect("package hash");

        let install = crate::modules::mcp::store::LocalSkillInstallDetail {
            skill_id: skill_id.to_string(),
            installed_version: Some("1.0.0".to_string()),
            is_enabled: true,
            runtime: Some("local".to_string()),
            install_path: dir.to_string_lossy().to_string(),
            manifest_json: std::fs::read_to_string(dir.join("deeting.json"))
                .expect("read manifest"),
            user_settings_json: Some(json!({
                "runtime_install": {
                    "requirements_hash": package_hash,
                }
            })),
        };

        let status = detect_local_skill_runtime(&install);

        assert_eq!(
            status.provider_kind,
            Some(LocalSkillRuntimeProviderKind::Node)
        );
        assert!(status.supported);
        assert_eq!(status.state, LOCAL_SKILL_RUNTIME_STATE_READY);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn detect_local_skill_runtime_reports_ready_for_shared_node_when_runtime_root_recorded() {
        let dir = temp_skill_dir("managed-node-shared-runtime");
        let runtime_root = temp_skill_dir("managed-node-shared-runtime-root");
        let skill_id = "managed.node.shared";
        write_managed_node_skill(&dir, skill_id);
        std::fs::create_dir_all(runtime_root.join("node_modules"))
            .expect("create shared runtime node_modules");
        let command_path = if cfg!(target_os = "windows") {
            runtime_root.join("node.exe")
        } else {
            runtime_root.join("node")
        };
        std::fs::write(&command_path, "").expect("write fake node command");
        let package_json_path = dir.join("package.json");
        let package_hash = compute_file_sha256(&package_json_path).expect("package hash");

        let install = crate::modules::mcp::store::LocalSkillInstallDetail {
            skill_id: skill_id.to_string(),
            installed_version: Some("1.0.0".to_string()),
            is_enabled: true,
            runtime: Some("local".to_string()),
            install_path: dir.to_string_lossy().to_string(),
            manifest_json: std::fs::read_to_string(dir.join("deeting.json"))
                .expect("read manifest"),
            user_settings_json: Some(json!({
                "runtime_install": {
                    "runtime_root": runtime_root.to_string_lossy().to_string(),
                    "command_path": command_path.to_string_lossy().to_string(),
                    "requirements_hash": package_hash,
                }
            })),
        };

        let status = detect_local_skill_runtime(&install);

        assert_eq!(
            status.provider_kind,
            Some(LocalSkillRuntimeProviderKind::Node)
        );
        assert!(status.supported);
        assert_eq!(status.state, LOCAL_SKILL_RUNTIME_STATE_READY);
        assert_eq!(
            status.command_path.as_deref(),
            Some(command_path.to_string_lossy().as_ref())
        );

        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(runtime_root);
    }

    #[test]
    fn detect_local_skill_runtime_reports_needs_reinstall_for_node_when_package_changes() {
        let dir = temp_skill_dir("managed-node-reinstall");
        let skill_id = "managed.node.reinstall";
        write_managed_node_skill(&dir, skill_id);
        std::fs::create_dir_all(dir.join("node_modules")).expect("create node_modules");

        let install = crate::modules::mcp::store::LocalSkillInstallDetail {
            skill_id: skill_id.to_string(),
            installed_version: Some("1.0.0".to_string()),
            is_enabled: true,
            runtime: Some("local".to_string()),
            install_path: dir.to_string_lossy().to_string(),
            manifest_json: std::fs::read_to_string(dir.join("deeting.json"))
                .expect("read manifest"),
            user_settings_json: Some(json!({
                "runtime_install": {
                    "requirements_hash": "stale-hash",
                }
            })),
        };

        let status = detect_local_skill_runtime(&install);

        assert_eq!(
            status.provider_kind,
            Some(LocalSkillRuntimeProviderKind::Node)
        );
        assert!(status.supported);
        assert_eq!(status.state, LOCAL_SKILL_RUNTIME_STATE_NEEDS_REINSTALL);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn resolve_runtime_env_for_shared_node_binding_uses_recorded_runtime_root() {
        let (database_url, db_path) = temp_sqlite_url("shared-node-runtime-env");
        let store = crate::modules::mcp::store::McpStore::new(&database_url)
            .await
            .expect("create store");
        store.init().await.expect("init store");

        let dir = temp_skill_dir("shared-node-runtime-env-skill");
        let runtime_root = temp_skill_dir("shared-node-runtime-env-root");
        let skill_id = "managed.node.shared.env";
        write_managed_node_skill(&dir, skill_id);
        let node_modules_dir = runtime_root.join("node_modules");
        let bin_dir = node_modules_dir.join(".bin");
        std::fs::create_dir_all(&bin_dir).expect("create node bin dir");
        std::fs::write(bin_dir.join("demo"), "").expect("write fake node bin");
        let command_path = if cfg!(target_os = "windows") {
            runtime_root.join("node.exe")
        } else {
            runtime_root.join("node")
        };
        std::fs::write(&command_path, "").expect("write fake node command");

        store
            .upsert_local_skill_install_state(
                skill_id,
                Some("1.0.0"),
                true,
                Some("local"),
                &std::fs::read_to_string(dir.join("deeting.json")).expect("read manifest"),
                dir.to_string_lossy().as_ref(),
                Some(&json!({
                    "runtime_install": {
                        "runtime_root": runtime_root.to_string_lossy().to_string(),
                        "command_path": command_path.to_string_lossy().to_string(),
                    }
                })),
            )
            .await
            .expect("seed install");

        let binding = crate::modules::mcp::store::LocalSkillToolBindingSnapshot {
            binding_id: "binding-demo".to_string(),
            skill_id: skill_id.to_string(),
            callable_name: "skill.demo".to_string(),
            tool_name: "demo".to_string(),
            description: "demo".to_string(),
            binding_kind: "script_runner".to_string(),
            input_schema: None,
            output_schema: None,
            entry_path: dir.join("main.js").to_string_lossy().to_string(),
            runtime: "node".to_string(),
            timeout_seconds: 30,
            updated_at: "2026-03-16T00:00:00Z".to_string(),
        };

        let env = crate::modules::skill_runtime::resolve_runtime_env_for_binding(&store, &binding)
            .await
            .expect("resolve runtime env")
            .expect("shared node runtime env");

        assert_eq!(
            env.get("NODE_PATH").map(String::as_str),
            Some(node_modules_dir.to_string_lossy().as_ref())
        );
        assert!(env
            .get("PATH")
            .map(|value| value.contains(bin_dir.to_string_lossy().as_ref()))
            .unwrap_or(false));

        drop(store);
        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(db_path.with_extension("db-shm"));
        let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(runtime_root);
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

    #[test]
    fn collect_local_skill_match_keys_includes_aliases_and_repo_keys() {
        let install = crate::modules::mcp::store::LocalSkillInstallDetail {
            skill_id: "official.skills.skill_manager".to_string(),
            installed_version: Some("1.1.0".to_string()),
            is_enabled: true,
            runtime: Some("local".to_string()),
            install_path: std::env::temp_dir()
                .join("skill_manager")
                .to_string_lossy()
                .to_string(),
            manifest_json: json!({
                "id": "official.skills.skill_manager",
                "source_metadata": {
                    "source_repo": "https://github.com/Deeting/skill-manager.git",
                    "openclaw": {
                        "package": {
                            "name": "skill_manager"
                        }
                    }
                }
            })
            .to_string(),
            user_settings_json: None,
        };

        let keys = collect_local_skill_match_keys(&install);

        assert!(keys.contains(&"official.skills.skill_manager".to_string()));
        assert!(keys.contains(&"official-skills-skill-manager".to_string()));
        assert!(keys.contains(&"skill_manager".to_string()));
        assert!(keys.contains(&"skill-manager".to_string()));
        assert!(keys.contains(&"repo:https://github.com/deeting/skill-manager".to_string()));
    }

    #[test]
    fn merge_local_skill_user_settings_fills_missing_keys_from_legacy() {
        let merged = merge_local_skill_user_settings(
            Some(&json!({
                "runtime_install": {
                    "state": "ready"
                }
            })),
            Some(&json!({
                "alias": "legacy-manager",
                "runtime_install": {
                    "state": "installing"
                }
            })),
        )
        .expect("merged settings");

        assert_eq!(
            merged,
            json!({
                "runtime_install": {
                    "state": "ready"
                },
                "alias": "legacy-manager"
            })
        );
    }

    #[test]
    fn build_generated_script_input_schema_includes_items_for_array_input_payloads() {
        let schema = build_generated_script_input_schema();
        let array_branch = schema
            .pointer("/properties/input/oneOf/1")
            .expect("array branch in oneOf");

        assert_eq!(array_branch.get("type"), Some(&json!("array")));
        assert_eq!(array_branch.get("items"), Some(&json!({})));
    }

    #[tokio::test]
    async fn migrate_conflicting_local_skill_installs_for_path_removes_legacy_ids() {
        let (database_url, db_path) = temp_sqlite_url("skill-install-migration");
        let store = crate::modules::mcp::store::McpStore::new(&database_url)
            .await
            .expect("create store");
        store.init().await.expect("init store");

        let skill_dir = temp_skill_dir("skill-install-migration-dir");
        let legacy_settings = json!({ "alias": "legacy-manager" });
        store
            .upsert_local_skill_install_state(
                "skill_manager",
                Some("1.0.0"),
                true,
                Some("local"),
                &json!({ "id": "skill_manager" }).to_string(),
                skill_dir.to_string_lossy().as_ref(),
                Some(&legacy_settings),
            )
            .await
            .expect("seed legacy install");
        store
            .upsert_local_skill_install_state(
                "official.skills.skill_manager",
                Some("1.1.0"),
                true,
                Some("local"),
                &json!({ "id": "official.skills.skill_manager" }).to_string(),
                skill_dir.to_string_lossy().as_ref(),
                None,
            )
            .await
            .expect("seed canonical install");

        migrate_conflicting_local_skill_installs_for_path(
            &store,
            "official.skills.skill_manager",
            &skill_dir,
        )
        .await
        .expect("migrate duplicate installs");

        let canonical = store
            .get_local_skill_install_detail("official.skills.skill_manager")
            .await
            .expect("get canonical install")
            .expect("canonical install exists");
        assert_eq!(canonical.user_settings_json, Some(legacy_settings));
        assert!(store
            .get_local_skill_install_detail("skill_manager")
            .await
            .expect("get legacy install")
            .is_none());

        drop(store);
        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(db_path.with_extension("db-shm"));
        let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
        let _ = std::fs::remove_dir_all(skill_dir);
    }
}
