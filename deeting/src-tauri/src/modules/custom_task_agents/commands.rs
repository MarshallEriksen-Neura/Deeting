use tauri::{AppHandle, State};

use crate::state::AppState;

use super::import::{
    import_claude_agents as import_claude_agents_inner,
    preview_claude_agents_import as preview_claude_agents_import_inner,
};
use super::indexing::{index_custom_task_agents, remove_custom_task_agent_index};
use super::runtime::preview_custom_task_agent as execute_preview_custom_task_agent;
use super::service::{
    create_custom_task_agent_service, sync_custom_task_agent_index,
    update_custom_task_agent_service,
};
use super::skill_actions::list_bindable_skill_actions;
use super::store::{
    delete_custom_task_agent as delete_custom_task_agent_inner,
    get_custom_task_agent as get_custom_task_agent_inner,
    list_custom_task_agents as list_custom_task_agents_inner,
};
use super::types::{
    ClaudeAgentImportPreviewResponse, CreateCustomTaskAgentRequest,
    CustomTaskAgentBindableGuidanceSkill, CustomTaskAgentBindableMcpTool,
    CustomTaskAgentBindingCatalogResponse, CustomTaskAgentPreviewRequest,
    CustomTaskAgentPreviewResponse, CustomTaskAgentProfile, ImportClaudeAgentsRequest,
    ImportClaudeAgentsResponse, PreviewClaudeAgentImportRequest, UpdateCustomTaskAgentRequest,
};

#[tauri::command]
pub async fn list_custom_task_agents(
    state: State<'_, AppState>,
) -> Result<Vec<CustomTaskAgentProfile>, String> {
    list_custom_task_agents_inner(state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_custom_task_agent(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<CustomTaskAgentProfile, String> {
    get_custom_task_agent_inner(state.mcp.store.as_ref(), &agent_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "custom task agent not found".to_string())
}

#[tauri::command]
pub async fn get_custom_task_agent_binding_catalog(
    state: State<'_, AppState>,
) -> Result<CustomTaskAgentBindingCatalogResponse, String> {
    let mut mcp_tools = state
        .mcp
        .store
        .list_tools()
        .await
        .map_err(|err| err.to_string())?
        .into_iter()
        .map(|tool| CustomTaskAgentBindableMcpTool {
            id: tool.id,
            name: tool.name,
            description: tool.description,
            status: tool.status.as_str().to_string(),
        })
        .collect::<Vec<_>>();
    mcp_tools.sort_by(|left, right| left.name.cmp(&right.name));

    let mut guidance_skills = state
        .mcp
        .store
        .list_local_skill_installs()
        .await
        .map_err(|err| err.to_string())?
        .into_iter()
        .map(|skill| CustomTaskAgentBindableGuidanceSkill {
            skill_id: skill.skill_id,
            installed_version: skill.installed_version,
            is_enabled: skill.is_enabled,
            runtime: skill.runtime,
        })
        .collect::<Vec<_>>();
    guidance_skills.sort_by(|left, right| left.skill_id.cmp(&right.skill_id));

    let skill_actions = list_bindable_skill_actions(state.inner()).await?;

    Ok(CustomTaskAgentBindingCatalogResponse {
        mcp_tools,
        guidance_skills,
        skill_actions,
    })
}

#[tauri::command]
pub async fn create_custom_task_agent(
    state: State<'_, AppState>,
    payload: CreateCustomTaskAgentRequest,
) -> Result<CustomTaskAgentProfile, String> {
    create_custom_task_agent_service(state.inner(), payload).await
}

#[tauri::command]
pub async fn update_custom_task_agent(
    state: State<'_, AppState>,
    agent_id: String,
    payload: UpdateCustomTaskAgentRequest,
) -> Result<CustomTaskAgentProfile, String> {
    update_custom_task_agent_service(state.inner(), &agent_id, payload).await
}

#[tauri::command]
pub async fn delete_custom_task_agent(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<(), String> {
    delete_custom_task_agent_inner(state.mcp.store.as_ref(), &agent_id)
        .await
        .map_err(|err| err.to_string())?;
    remove_custom_task_agent_index(state.inner(), &agent_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn preview_custom_task_agent(
    app: AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
    payload: CustomTaskAgentPreviewRequest,
) -> Result<CustomTaskAgentPreviewResponse, String> {
    let profile = get_custom_task_agent_inner(state.mcp.store.as_ref(), &agent_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "custom task agent not found".to_string())?;
    execute_preview_custom_task_agent(&app, state.inner(), &profile, payload)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn reindex_custom_task_agents(state: State<'_, AppState>) -> Result<(), String> {
    let profiles = list_custom_task_agents_inner(state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?;
    index_custom_task_agents(state.inner(), &profiles).await?;
    Ok(())
}

#[tauri::command]
pub async fn preview_claude_agent_import(
    state: State<'_, AppState>,
    payload: PreviewClaudeAgentImportRequest,
) -> Result<ClaudeAgentImportPreviewResponse, String> {
    preview_claude_agents_import_inner(state.mcp.store.as_ref(), &payload.documents).await
}

#[tauri::command]
pub async fn import_claude_agents(
    state: State<'_, AppState>,
    payload: ImportClaudeAgentsRequest,
) -> Result<ImportClaudeAgentsResponse, String> {
    let response = import_claude_agents_inner(state.mcp.store.as_ref(), &payload.documents).await?;
    for profile in &response.profiles {
        sync_custom_task_agent_index(state.inner(), profile).await?;
    }
    Ok(response)
}

