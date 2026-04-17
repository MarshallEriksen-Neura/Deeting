use std::fs;
use std::path::Path;

use mcp_storage::helpers::now_rfc3339;

use super::adoption::{normalize_confirm_adoption_payload, preview_adoption};
use super::automation::{
    dismiss_suggestion as dismiss_llm_wiki_automation_suggestion_inner,
    execute_suggestion as execute_llm_wiki_automation_suggestion_inner,
    handle_corpus_reconcile_completed, handle_vault_bound, handle_workspace_bootstrapped,
    update_automation_settings as update_llm_wiki_automation_settings_inner,
};
use super::maintenance::{ingest_selection as ingest_llm_wiki_selection_inner, run_lint};
use crate::modules::custom_task_agents::service::{
    create_custom_task_agent_service, update_custom_task_agent_service,
};
use crate::modules::custom_task_agents::store::list_custom_task_agents as list_custom_task_agents_inner;
use crate::modules::custom_task_agents::types::{
    CreateCustomTaskAgentRequest, CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
    UpdateCustomTaskAgentRequest,
};
use crate::modules::mcp::store::McpStore;
use crate::state::AppState;

use super::config::{
    load_automation_state, load_binding, load_last_bootstrapped_at, load_last_lint_report,
    normalize_required_relative_path, normalize_vault_root, normalize_workspace_relative_path,
    resolve_workspace_path, save_binding, save_last_bootstrapped_at, PersistedLlmWikiBinding,
    LLM_WIKI_MODE_ADOPT_EXISTING_FOLDER, LLM_WIKI_MODE_MANAGED_WORKSPACE, READ_SCOPE_WHOLE_VAULT,
    WRITE_SCOPE_MANAGED_WORKSPACE,
};
use super::corpus::{bootstrap_corpus, load_corpus_status, reconcile_corpus, search_corpus};
use super::scan::{inspect_workspace, scan_vault};
use super::templates::{build_bootstrap_files, build_recommended_agent_prompt};
use super::types::{
    BootstrapLocalLlmWikiWorkspaceResult, ConfirmLocalLlmWikiAdoptionRequest,
    CreateOrUpdateLocalLlmWikiMaintainerAgentResult, IngestLocalLlmWikiSelectionRequest,
    IngestLocalLlmWikiSelectionResult, LocalLlmWikiAdoptionPreview,
    LocalLlmWikiAutomationExecutionResult, LocalLlmWikiBinding, LocalLlmWikiLintReport,
    LocalLlmWikiMaintainerAgentSummary, LocalLlmWikiState, PreviewLocalLlmWikiAdoptionRequest,
    SaveLocalLlmWikiBindingRequest, SearchLocalLlmWikiCorpusRequest,
    SearchLocalLlmWikiCorpusResult, UpdateLocalLlmWikiAutomationSettingsRequest,
};

const LLM_WIKI_MAINTAINER_SOURCE_KIND: &str = "llm_wiki_maintainer";

pub async fn get_local_llm_wiki_state(store: &McpStore) -> Result<LocalLlmWikiState, String> {
    let Some(binding) = load_binding(store).await.map_err(|err| err.to_string())? else {
        return Ok(LocalLlmWikiState {
            binding: None,
            workspace_status: None,
            corpus_status: None,
            maintainer_agent: None,
            recommended_agent_prompt: None,
            automation: load_automation_state(store)
                .await
                .map_err(|err| err.to_string())?,
            last_lint_report: load_last_lint_report(store)
                .await
                .map_err(|err| err.to_string())?,
        });
    };

    build_state_from_binding(store, binding).await
}

pub async fn save_local_llm_wiki_binding(
    app_state: &AppState,
    payload: SaveLocalLlmWikiBindingRequest,
) -> Result<LocalLlmWikiState, String> {
    let store = app_state.mcp.store.as_ref();
    let vault_root = normalize_vault_root(&payload.vault_root)?;
    let mode = payload
        .mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(LLM_WIKI_MODE_MANAGED_WORKSPACE);
    let adopted_folder_relative_path = payload
        .adopted_folder_relative_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(normalize_required_relative_path)
        .transpose()?;
    let workspace_relative_path = if mode == LLM_WIKI_MODE_ADOPT_EXISTING_FOLDER {
        let adopted = adopted_folder_relative_path
            .clone()
            .ok_or_else(|| "adopted folder path is required for adopt mode".to_string())?;
        let adopted_target = vault_root.join(&adopted);
        if !adopted_target.exists() || !adopted_target.is_dir() {
            return Err("adopted folder must exist inside the vault root".to_string());
        }
        adopted
    } else {
        normalize_workspace_relative_path(payload.workspace_relative_path.as_deref())?
    };

    let binding = PersistedLlmWikiBinding {
        vault_root: vault_root.to_string_lossy().to_string(),
        workspace_relative_path,
        mode: mode.to_string(),
        adopted_folder_relative_path,
    };

    save_binding(store, &binding)
        .await
        .map_err(|err| err.to_string())?;
    handle_vault_bound(app_state).await?;
    build_state_from_binding(store, binding).await
}

pub async fn bootstrap_local_llm_wiki_workspace(
    app_state: &AppState,
) -> Result<BootstrapLocalLlmWikiWorkspaceResult, String> {
    let store = app_state.mcp.store.as_ref();
    let binding = load_binding(store)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "llm wiki binding has not been configured yet".to_string())?;

    let vault_root = normalize_vault_root(&binding.vault_root)?;
    let scan_summary = tokio::task::spawn_blocking({
        let vault_root = vault_root.clone();
        move || scan_vault(&vault_root)
    })
    .await
    .map_err(|err| format!("vault scan task failed: {}", err))??;

    let public_binding = build_public_binding(&vault_root, &binding);
    let now = now_rfc3339().map_err(|err| err.to_string())?;
    let workspace_path = resolve_workspace_path(&vault_root, &binding.workspace_relative_path);
    let bootstrap_files = build_bootstrap_files(&public_binding, &scan_summary, &now);

    let workspace_path_for_task = workspace_path.clone();
    let now_for_task = now.clone();
    let bootstrap_result = tokio::task::spawn_blocking(move || {
        bootstrap_workspace_files(&workspace_path_for_task, &bootstrap_files)
    })
    .await
    .map_err(|err| format!("workspace bootstrap task failed: {}", err))??;

    save_last_bootstrapped_at(store, &now_for_task)
        .await
        .map_err(|err| err.to_string())?;
    let _ = bootstrap_corpus(app_state, &vault_root, &workspace_path).await?;
    handle_workspace_bootstrapped(app_state).await?;

    let state = build_state_from_binding(store, binding.clone()).await?;

    Ok(BootstrapLocalLlmWikiWorkspaceResult {
        workspace_path: workspace_path.to_string_lossy().to_string(),
        created_directories: bootstrap_result.created_directories,
        created_files: bootstrap_result.created_files,
        skipped_files: bootstrap_result.skipped_files,
        state,
    })
}

pub async fn create_or_update_local_llm_wiki_maintainer_agent(
    app_state: &AppState,
) -> Result<CreateOrUpdateLocalLlmWikiMaintainerAgentResult, String> {
    let binding = load_binding(app_state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "llm wiki binding has not been configured yet".to_string())?;

    let vault_root = normalize_vault_root(&binding.vault_root)?;
    let public_binding = build_public_binding(&vault_root, &binding);
    let workspace_path = resolve_workspace_path(&vault_root, &binding.workspace_relative_path);
    let workspace_path_string = workspace_path.to_string_lossy().to_string();
    let prompt = build_recommended_agent_prompt(&public_binding);
    let maintainer_name = format!("{} Wiki Maintainer", public_binding.vault_name);
    let description = format!(
        "Maintains the Deeting-managed LLM Wiki workspace at {}",
        public_binding.workspace_relative_path
    );

    let existing = find_existing_maintainer_agent(
        app_state.mcp.store.as_ref(),
        workspace_path_string.as_str(),
    )
    .await
    .map_err(|err| err.to_string())?;

    if let Some(existing) = existing {
        update_custom_task_agent_service(
            app_state,
            &existing.id,
            UpdateCustomTaskAgentRequest {
                name: Some(maintainer_name),
                description: Some(description),
                task_prompt: Some(prompt),
                invocation_kind: Some(CustomTaskAgentInvocationKind::Chat),
                preferred_for_image_generation: Some(false),
                model_config: None,
                callable_mcp_tool_ids: Some(Vec::new()),
                guidance_skill_ids: Some(Vec::new()),
                callable_skill_action_refs: Some(Vec::new()),
                bound_asset_id: Some(String::new()),
                tags: Some(vec![
                    "llm-wiki".to_string(),
                    "obsidian".to_string(),
                    "maintainer".to_string(),
                ]),
                discoverable: Some(true),
                is_enabled: Some(true),
                source_kind: Some(LLM_WIKI_MAINTAINER_SOURCE_KIND.to_string()),
                source_path: Some(workspace_path_string.clone()),
                source_repo: None,
                source_ref: None,
                source_hash: None,
            },
        )
        .await?;
    } else {
        create_custom_task_agent_service(
            app_state,
            CreateCustomTaskAgentRequest {
                name: maintainer_name,
                description: Some(description),
                task_prompt: prompt,
                invocation_kind: Some(CustomTaskAgentInvocationKind::Chat),
                preferred_for_image_generation: Some(false),
                model_config: None,
                callable_mcp_tool_ids: Vec::new(),
                guidance_skill_ids: Vec::new(),
                callable_skill_action_refs: Vec::new(),
                bound_asset_id: None,
                tags: Some(vec![
                    "llm-wiki".to_string(),
                    "obsidian".to_string(),
                    "maintainer".to_string(),
                ]),
                discoverable: Some(true),
                is_enabled: Some(true),
                source_kind: Some(LLM_WIKI_MAINTAINER_SOURCE_KIND.to_string()),
                source_path: Some(workspace_path_string),
                source_repo: None,
                source_ref: None,
                source_hash: None,
            },
        )
        .await?;
    }

    let state = build_state_from_binding(app_state.mcp.store.as_ref(), binding).await?;
    Ok(CreateOrUpdateLocalLlmWikiMaintainerAgentResult { state })
}

pub async fn reconcile_local_llm_wiki_corpus(
    app_state: &AppState,
) -> Result<super::types::ReconcileLocalLlmWikiCorpusResult, String> {
    let binding = load_binding(app_state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "llm wiki binding has not been configured yet".to_string())?;

    let vault_root = normalize_vault_root(&binding.vault_root)?;
    let workspace_path = resolve_workspace_path(&vault_root, &binding.workspace_relative_path);
    let (indexed_files, removed_files, _) =
        reconcile_corpus(app_state, &vault_root, &workspace_path).await?;
    handle_corpus_reconcile_completed(app_state, indexed_files, removed_files).await?;

    let state = build_state_from_binding(app_state.mcp.store.as_ref(), binding).await?;
    Ok(super::types::ReconcileLocalLlmWikiCorpusResult {
        indexed_files,
        removed_files,
        state,
    })
}

pub async fn search_local_llm_wiki_corpus(
    app_state: &AppState,
    payload: SearchLocalLlmWikiCorpusRequest,
) -> Result<SearchLocalLlmWikiCorpusResult, String> {
    let binding = load_binding(app_state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "llm wiki binding has not been configured yet".to_string())?;

    let vault_root = normalize_vault_root(&binding.vault_root)?;
    let workspace_path = resolve_workspace_path(&vault_root, &binding.workspace_relative_path);
    let limit = payload.limit.unwrap_or(6).clamp(1, 12);
    let hits = search_corpus(app_state, &workspace_path, &payload.query, limit).await?;
    Ok(SearchLocalLlmWikiCorpusResult { hits })
}

pub async fn preview_local_llm_wiki_adoption(
    payload: PreviewLocalLlmWikiAdoptionRequest,
) -> Result<LocalLlmWikiAdoptionPreview, String> {
    preview_adoption(payload)
}

pub async fn confirm_local_llm_wiki_adoption(
    app_state: &AppState,
    payload: ConfirmLocalLlmWikiAdoptionRequest,
) -> Result<LocalLlmWikiState, String> {
    let store = app_state.mcp.store.as_ref();
    let (vault_root, folder_relative_path) = normalize_confirm_adoption_payload(payload)?;
    let binding = PersistedLlmWikiBinding {
        vault_root: vault_root.to_string_lossy().to_string(),
        workspace_relative_path: folder_relative_path.clone(),
        mode: LLM_WIKI_MODE_ADOPT_EXISTING_FOLDER.to_string(),
        adopted_folder_relative_path: Some(folder_relative_path),
    };

    save_binding(store, &binding)
        .await
        .map_err(|err| err.to_string())?;
    handle_vault_bound(app_state).await?;
    build_state_from_binding(store, binding).await
}

pub async fn ingest_local_llm_wiki_selection(
    app_state: &AppState,
    payload: IngestLocalLlmWikiSelectionRequest,
) -> Result<IngestLocalLlmWikiSelectionResult, String> {
    let (ingested_paths, skipped_paths, source_pages_created, raw_files_copied) =
        ingest_llm_wiki_selection_inner(app_state, payload).await?;
    let state = get_local_llm_wiki_state(app_state.mcp.store.as_ref()).await?;
    Ok(IngestLocalLlmWikiSelectionResult {
        ingested_paths,
        skipped_paths,
        source_pages_created,
        raw_files_copied,
        state,
    })
}

pub async fn run_local_llm_wiki_lint(
    app_state: &AppState,
) -> Result<LocalLlmWikiLintReport, String> {
    run_lint(app_state).await
}

pub async fn update_local_llm_wiki_automation_settings(
    store: &McpStore,
    payload: UpdateLocalLlmWikiAutomationSettingsRequest,
) -> Result<LocalLlmWikiState, String> {
    update_llm_wiki_automation_settings_inner(store, payload).await?;
    get_local_llm_wiki_state(store).await
}

pub async fn dismiss_local_llm_wiki_automation_suggestion(
    store: &McpStore,
    suggestion_id: String,
) -> Result<LocalLlmWikiState, String> {
    dismiss_llm_wiki_automation_suggestion_inner(store, &suggestion_id).await?;
    get_local_llm_wiki_state(store).await
}

pub async fn execute_local_llm_wiki_automation_suggestion(
    app_state: &AppState,
    suggestion_id: String,
) -> Result<LocalLlmWikiAutomationExecutionResult, String> {
    execute_llm_wiki_automation_suggestion_inner(app_state, &suggestion_id).await
}

async fn build_state_from_binding(
    store: &McpStore,
    binding: PersistedLlmWikiBinding,
) -> Result<LocalLlmWikiState, String> {
    let vault_root = normalize_vault_root(&binding.vault_root)?;
    let last_bootstrapped_at = load_last_bootstrapped_at(store)
        .await
        .map_err(|err| err.to_string())?;
    let workspace_path = resolve_workspace_path(&vault_root, &binding.workspace_relative_path);
    let workspace_status = tokio::task::spawn_blocking({
        let workspace_path = workspace_path.clone();
        let last_bootstrapped_at = last_bootstrapped_at.clone();
        move || inspect_workspace(&workspace_path, last_bootstrapped_at)
    })
    .await
    .map_err(|err| format!("workspace inspection task failed: {}", err))?;
    let corpus_status = load_corpus_status(store, &vault_root, &workspace_path, None).await?;
    let public_binding = build_public_binding(&vault_root, &binding);
    let maintainer_agent = find_existing_maintainer_agent(store, &workspace_path.to_string_lossy())
        .await
        .map_err(|err| err.to_string())?
        .map(|profile| LocalLlmWikiMaintainerAgentSummary {
            agent_id: profile.id,
            name: profile.name,
            source_path: profile.source_path,
            updated_at: profile.updated_at,
            discoverable: profile.discoverable,
            is_enabled: profile.is_enabled,
        });

    Ok(LocalLlmWikiState {
        binding: Some(public_binding.clone()),
        workspace_status: Some(workspace_status),
        corpus_status: Some(corpus_status),
        maintainer_agent,
        recommended_agent_prompt: Some(build_recommended_agent_prompt(&public_binding)),
        automation: load_automation_state(store)
            .await
            .map_err(|err| err.to_string())?,
        last_lint_report: load_last_lint_report(store)
            .await
            .map_err(|err| err.to_string())?,
    })
}

fn build_public_binding(
    vault_root: &Path,
    binding: &PersistedLlmWikiBinding,
) -> LocalLlmWikiBinding {
    let vault_name = vault_root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Obsidian Vault")
        .to_string();

    LocalLlmWikiBinding {
        vault_root: vault_root.to_string_lossy().to_string(),
        vault_name,
        workspace_relative_path: binding.workspace_relative_path.replace('\\', "/"),
        mode: binding.mode.clone(),
        adopted_folder_relative_path: binding
            .adopted_folder_relative_path
            .as_ref()
            .map(|value| value.replace('\\', "/")),
        read_scope: READ_SCOPE_WHOLE_VAULT.to_string(),
        write_scope: WRITE_SCOPE_MANAGED_WORKSPACE.to_string(),
        is_probable_obsidian_vault: vault_root.join(".obsidian").is_dir(),
    }
}

async fn find_existing_maintainer_agent(
    store: &McpStore,
    workspace_path: &str,
) -> Result<Option<CustomTaskAgentProfile>, crate::modules::mcp::error::McpError> {
    let normalized = workspace_path.trim();
    let profiles = list_custom_task_agents_inner(store).await?;
    Ok(profiles.into_iter().find(|profile| {
        profile.source_kind.as_deref() == Some(LLM_WIKI_MAINTAINER_SOURCE_KIND)
            && profile
                .source_path
                .as_deref()
                .map(str::trim)
                .map(|value| value.eq_ignore_ascii_case(normalized))
                .unwrap_or(false)
    }))
}

struct BootstrapWorkspaceTaskResult {
    created_directories: Vec<String>,
    created_files: Vec<String>,
    skipped_files: Vec<String>,
}

fn bootstrap_workspace_files(
    workspace_path: &Path,
    files: &[super::templates::BootstrapFile],
) -> Result<BootstrapWorkspaceTaskResult, String> {
    let mut created_directories = Vec::new();
    let mut created_files = Vec::new();
    let mut skipped_files = Vec::new();

    let required_directories = [
        workspace_path.to_path_buf(),
        workspace_path.join("raw"),
        workspace_path.join("raw").join("clips"),
        workspace_path.join("raw").join("docs"),
        workspace_path.join("raw").join("images"),
        workspace_path.join("wiki"),
        workspace_path.join("wiki").join("entities"),
        workspace_path.join("wiki").join("concepts"),
        workspace_path.join("wiki").join("sources"),
        workspace_path.join("wiki").join("analyses"),
    ];

    for dir in required_directories {
        if !dir.exists() {
            fs::create_dir_all(&dir)
                .map_err(|err| format!("failed to create {}: {}", dir.display(), err))?;
            created_directories.push(dir.to_string_lossy().to_string());
        }
    }

    for file in files {
        let path = workspace_path.join(file.relative_path);
        if path.exists() {
            skipped_files.push(path.to_string_lossy().to_string());
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create {}: {}", parent.display(), err))?;
        }
        fs::write(&path, file.content.as_bytes())
            .map_err(|err| format!("failed to write {}: {}", path.display(), err))?;
        created_files.push(path.to_string_lossy().to_string());
    }

    Ok(BootstrapWorkspaceTaskResult {
        created_directories,
        created_files,
        skipped_files,
    })
}

#[cfg(test)]
mod tests {
    use super::bootstrap_workspace_files;
    use crate::modules::llm_wiki::templates::BootstrapFile;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "deeting-llm-wiki-bootstrap-{}-{}",
            label,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    #[test]
    fn bootstrap_creates_missing_files_without_overwriting_existing_ones() {
        let root = temp_dir("workspace");
        fs::create_dir_all(root.join("wiki")).expect("create wiki dir");
        fs::write(root.join("Home.md"), "existing").expect("write existing file");

        let files = vec![
            BootstrapFile {
                relative_path: "Home.md",
                content: "new home".to_string(),
            },
            BootstrapFile {
                relative_path: "index.md",
                content: "index".to_string(),
            },
        ];

        let result = bootstrap_workspace_files(&root, &files).expect("bootstrap workspace");

        assert!(result
            .skipped_files
            .iter()
            .any(|path| path.ends_with("Home.md")));
        assert!(result
            .created_files
            .iter()
            .any(|path| path.ends_with("index.md")));
        assert_eq!(
            fs::read_to_string(root.join("Home.md")).expect("read home"),
            "existing"
        );
    }
}
