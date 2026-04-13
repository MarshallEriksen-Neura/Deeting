use tauri::State;

use crate::state::AppState;

use super::service::{
    bootstrap_local_llm_wiki_workspace, create_or_update_local_llm_wiki_maintainer_agent,
    get_local_llm_wiki_state, save_local_llm_wiki_binding,
};
use super::types::{
    BootstrapLocalLlmWikiWorkspaceResult, CreateOrUpdateLocalLlmWikiMaintainerAgentResult,
    LocalLlmWikiState, SaveLocalLlmWikiBindingRequest,
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
    save_local_llm_wiki_binding(state.mcp.store.as_ref(), payload).await
}

#[tauri::command]
pub async fn bootstrap_local_llm_wiki_workspace_command(
    state: State<'_, AppState>,
) -> Result<BootstrapLocalLlmWikiWorkspaceResult, String> {
    bootstrap_local_llm_wiki_workspace(state.mcp.store.as_ref()).await
}

#[tauri::command]
pub async fn create_or_update_local_llm_wiki_maintainer_agent_command(
    state: State<'_, AppState>,
) -> Result<CreateOrUpdateLocalLlmWikiMaintainerAgentResult, String> {
    create_or_update_local_llm_wiki_maintainer_agent(state.inner()).await
}
