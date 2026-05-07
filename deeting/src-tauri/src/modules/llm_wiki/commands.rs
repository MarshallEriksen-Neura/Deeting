use tauri::State;

use crate::state::AppState;

use super::service::{
    bootstrap_local_llm_wiki_workspace, commit_local_llm_wiki_candidate,
    confirm_local_llm_wiki_adoption, create_or_update_local_llm_wiki_maintainer_agent,
    dismiss_local_llm_wiki_automation_suggestion, execute_local_llm_wiki_automation_suggestion,
    get_local_llm_wiki_state, ingest_local_llm_wiki_selection, preview_local_llm_wiki_adoption,
    preview_local_llm_wiki_candidate, reconcile_local_llm_wiki_corpus, run_local_llm_wiki_lint,
    save_local_llm_wiki_binding, search_local_llm_wiki_corpus,
    update_local_llm_wiki_automation_settings,
};
use super::types::{
    BootstrapLocalLlmWikiWorkspaceResult, CommitLocalLlmWikiCandidateRequest,
    CommitLocalLlmWikiCandidateResult, ConfirmLocalLlmWikiAdoptionRequest,
    CreateOrUpdateLocalLlmWikiMaintainerAgentResult, IngestLocalLlmWikiSelectionRequest,
    IngestLocalLlmWikiSelectionResult, LocalLlmWikiAdoptionPreview,
    LocalLlmWikiAutomationExecutionResult, LocalLlmWikiCandidatePreview, LocalLlmWikiLintReport,
    LocalLlmWikiState, PreviewLocalLlmWikiAdoptionRequest, PreviewLocalLlmWikiCandidateRequest,
    ReconcileLocalLlmWikiCorpusResult, SaveLocalLlmWikiBindingRequest,
    SearchLocalLlmWikiCorpusRequest, SearchLocalLlmWikiCorpusResult,
    UpdateLocalLlmWikiAutomationSettingsRequest,
};

#[tauri::command]
pub async fn get_local_llm_wiki_state_command(
    state: State<'_, AppState>,
) -> Result<LocalLlmWikiState, String> {
    get_local_llm_wiki_state(state.mcp.store.as_ref()).await
}

#[tauri::command]
pub async fn save_local_llm_wiki_binding_command(
    state: State<'_, AppState>,
    payload: SaveLocalLlmWikiBindingRequest,
) -> Result<LocalLlmWikiState, String> {
    save_local_llm_wiki_binding(state.inner(), payload).await
}

#[tauri::command]
pub async fn bootstrap_local_llm_wiki_workspace_command(
    state: State<'_, AppState>,
) -> Result<BootstrapLocalLlmWikiWorkspaceResult, String> {
    bootstrap_local_llm_wiki_workspace(state.inner()).await
}

#[tauri::command]
pub async fn create_or_update_local_llm_wiki_maintainer_agent_command(
    state: State<'_, AppState>,
) -> Result<CreateOrUpdateLocalLlmWikiMaintainerAgentResult, String> {
    create_or_update_local_llm_wiki_maintainer_agent(state.inner()).await
}

#[tauri::command]
pub async fn reconcile_local_llm_wiki_corpus_command(
    state: State<'_, AppState>,
) -> Result<ReconcileLocalLlmWikiCorpusResult, String> {
    reconcile_local_llm_wiki_corpus(state.inner()).await
}

#[tauri::command]
pub async fn search_local_llm_wiki_corpus_command(
    state: State<'_, AppState>,
    payload: SearchLocalLlmWikiCorpusRequest,
) -> Result<SearchLocalLlmWikiCorpusResult, String> {
    search_local_llm_wiki_corpus(state.inner(), payload).await
}

#[tauri::command]
pub async fn preview_local_llm_wiki_candidate_command(
    state: State<'_, AppState>,
    payload: PreviewLocalLlmWikiCandidateRequest,
) -> Result<LocalLlmWikiCandidatePreview, String> {
    preview_local_llm_wiki_candidate(state.inner(), payload).await
}

#[tauri::command]
pub async fn commit_local_llm_wiki_candidate_command(
    state: State<'_, AppState>,
    payload: CommitLocalLlmWikiCandidateRequest,
) -> Result<CommitLocalLlmWikiCandidateResult, String> {
    commit_local_llm_wiki_candidate(state.inner(), payload).await
}

#[tauri::command]
pub async fn update_local_llm_wiki_automation_settings_command(
    state: State<'_, AppState>,
    payload: UpdateLocalLlmWikiAutomationSettingsRequest,
) -> Result<LocalLlmWikiState, String> {
    update_local_llm_wiki_automation_settings(state.mcp.store.as_ref(), payload).await
}

#[tauri::command]
pub async fn dismiss_local_llm_wiki_automation_suggestion_command(
    state: State<'_, AppState>,
    suggestion_id: String,
) -> Result<LocalLlmWikiState, String> {
    dismiss_local_llm_wiki_automation_suggestion(state.mcp.store.as_ref(), suggestion_id).await
}

#[tauri::command]
pub async fn execute_local_llm_wiki_automation_suggestion_command(
    state: State<'_, AppState>,
    suggestion_id: String,
) -> Result<LocalLlmWikiAutomationExecutionResult, String> {
    execute_local_llm_wiki_automation_suggestion(state.inner(), suggestion_id).await
}

#[tauri::command]
pub async fn preview_local_llm_wiki_adoption_command(
    payload: PreviewLocalLlmWikiAdoptionRequest,
) -> Result<LocalLlmWikiAdoptionPreview, String> {
    preview_local_llm_wiki_adoption(payload).await
}

#[tauri::command]
pub async fn confirm_local_llm_wiki_adoption_command(
    state: State<'_, AppState>,
    payload: ConfirmLocalLlmWikiAdoptionRequest,
) -> Result<LocalLlmWikiState, String> {
    confirm_local_llm_wiki_adoption(state.inner(), payload).await
}

#[tauri::command]
pub async fn ingest_local_llm_wiki_selection_command(
    state: State<'_, AppState>,
    payload: IngestLocalLlmWikiSelectionRequest,
) -> Result<IngestLocalLlmWikiSelectionResult, String> {
    ingest_local_llm_wiki_selection(state.inner(), payload).await
}

#[tauri::command]
pub async fn run_local_llm_wiki_lint_command(
    state: State<'_, AppState>,
) -> Result<LocalLlmWikiLintReport, String> {
    run_local_llm_wiki_lint(state.inner()).await
}
