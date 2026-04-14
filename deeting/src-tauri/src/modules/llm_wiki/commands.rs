use tauri::State;

use crate::state::AppState;

use super::service::{
    bootstrap_local_llm_wiki_workspace, create_or_update_local_llm_wiki_maintainer_agent,
    dismiss_local_llm_wiki_automation_suggestion, execute_local_llm_wiki_automation_suggestion,
    get_local_llm_wiki_state, save_local_llm_wiki_binding, search_local_llm_wiki_corpus,
    sync_local_llm_wiki_corpus, update_local_llm_wiki_automation_settings,
};
use super::types::{
    BootstrapLocalLlmWikiWorkspaceResult, CreateOrUpdateLocalLlmWikiMaintainerAgentResult,
    LocalLlmWikiAutomationExecutionResult, LocalLlmWikiState, SaveLocalLlmWikiBindingRequest,
    SearchLocalLlmWikiCorpusRequest, SearchLocalLlmWikiCorpusResult, SyncLocalLlmWikiCorpusResult,
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
pub async fn sync_local_llm_wiki_corpus_command(
    state: State<'_, AppState>,
) -> Result<SyncLocalLlmWikiCorpusResult, String> {
    sync_local_llm_wiki_corpus(state.inner()).await
}

#[tauri::command]
pub async fn search_local_llm_wiki_corpus_command(
    state: State<'_, AppState>,
    payload: SearchLocalLlmWikiCorpusRequest,
) -> Result<SearchLocalLlmWikiCorpusResult, String> {
    search_local_llm_wiki_corpus(state.inner(), payload).await
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
