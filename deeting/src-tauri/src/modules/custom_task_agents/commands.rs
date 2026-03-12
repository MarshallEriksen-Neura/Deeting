use tauri::State;

use crate::state::AppState;

use super::indexing::{
    index_custom_task_agent, index_custom_task_agents, remove_custom_task_agent_index,
};
use super::runtime::preview_custom_task_agent as execute_preview_custom_task_agent;
use super::store::{
    create_custom_task_agent as create_custom_task_agent_inner,
    delete_custom_task_agent as delete_custom_task_agent_inner,
    get_custom_task_agent as get_custom_task_agent_inner,
    list_custom_task_agents as list_custom_task_agents_inner,
    update_custom_task_agent as update_custom_task_agent_inner,
};
use super::types::{
    CreateCustomTaskAgentRequest, CustomTaskAgentBindingCatalogResponse,
    CustomTaskAgentBindableSkill, CustomTaskAgentBindableTool, CustomTaskAgentPreviewRequest,
    CustomTaskAgentPreviewResponse, CustomTaskAgentProfile, UpdateCustomTaskAgentRequest,
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
    let mut tools = state
        .mcp
        .store
        .list_tools()
        .await
        .map_err(|err| err.to_string())?
        .into_iter()
        .map(|tool| CustomTaskAgentBindableTool {
            id: tool.id,
            name: tool.name,
            description: tool.description,
            status: tool.status.as_str().to_string(),
        })
        .collect::<Vec<_>>();
    tools.sort_by(|left, right| left.name.cmp(&right.name));

    let mut skills = state
        .mcp
        .store
        .list_local_skill_installs()
        .await
        .map_err(|err| err.to_string())?
        .into_iter()
        .map(|skill| CustomTaskAgentBindableSkill {
            skill_id: skill.skill_id,
            installed_version: skill.installed_version,
            is_enabled: skill.is_enabled,
            runtime: skill.runtime,
        })
        .collect::<Vec<_>>();
    skills.sort_by(|left, right| left.skill_id.cmp(&right.skill_id));

    Ok(CustomTaskAgentBindingCatalogResponse { tools, skills })
}

#[tauri::command]
pub async fn create_custom_task_agent(
    state: State<'_, AppState>,
    payload: CreateCustomTaskAgentRequest,
) -> Result<CustomTaskAgentProfile, String> {
    let payload = validate_create_payload(state.inner(), payload).await?;
    let profile = create_custom_task_agent_inner(state.mcp.store.as_ref(), payload)
        .await
        .map_err(|err| err.to_string())?;
    sync_custom_task_agent_index(state.inner(), &profile).await?;
    Ok(profile)
}

#[tauri::command]
pub async fn update_custom_task_agent(
    state: State<'_, AppState>,
    agent_id: String,
    payload: UpdateCustomTaskAgentRequest,
) -> Result<CustomTaskAgentProfile, String> {
    let payload = validate_update_payload(state.inner(), payload).await?;
    let profile = update_custom_task_agent_inner(state.mcp.store.as_ref(), &agent_id, payload)
        .await
        .map_err(|err| err.to_string())?;
    sync_custom_task_agent_index(state.inner(), &profile).await?;
    Ok(profile)
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
    state: State<'_, AppState>,
    agent_id: String,
    payload: CustomTaskAgentPreviewRequest,
) -> Result<CustomTaskAgentPreviewResponse, String> {
    let profile = get_custom_task_agent_inner(state.mcp.store.as_ref(), &agent_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "custom task agent not found".to_string())?;
    execute_preview_custom_task_agent(state.inner(), &profile, payload).await
}

#[tauri::command]
pub async fn reindex_custom_task_agents(state: State<'_, AppState>) -> Result<(), String> {
    let profiles = list_custom_task_agents_inner(state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?;
    index_custom_task_agents(state.inner(), &profiles).await?;
    Ok(())
}

async fn sync_custom_task_agent_index(
    app_state: &AppState,
    profile: &CustomTaskAgentProfile,
) -> Result<(), String> {
    if profile.discoverable && profile.is_enabled && !profile.is_deleted {
        index_custom_task_agent(app_state, profile).await
    } else {
        remove_custom_task_agent_index(app_state, &profile.id).await
    }
}

async fn validate_create_payload(
    app_state: &AppState,
    mut payload: CreateCustomTaskAgentRequest,
) -> Result<CreateCustomTaskAgentRequest, String> {
    payload.bound_tool_ids = validate_bound_tool_ids(app_state, &payload.bound_tool_ids).await?;
    payload.bound_skill_ids = validate_bound_skill_ids(app_state, &payload.bound_skill_ids).await?;
    Ok(payload)
}

async fn validate_update_payload(
    app_state: &AppState,
    mut payload: UpdateCustomTaskAgentRequest,
) -> Result<UpdateCustomTaskAgentRequest, String> {
    if let Some(bound_tool_ids) = payload.bound_tool_ids.as_ref() {
        payload.bound_tool_ids = Some(validate_bound_tool_ids(app_state, bound_tool_ids).await?);
    }
    if let Some(bound_skill_ids) = payload.bound_skill_ids.as_ref() {
        payload.bound_skill_ids = Some(validate_bound_skill_ids(app_state, bound_skill_ids).await?);
    }
    Ok(payload)
}

async fn validate_bound_tool_ids(
    app_state: &AppState,
    bound_tool_ids: &[String],
) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for tool_id in bound_tool_ids {
        let trimmed = tool_id.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
            continue;
        }
        crate::modules::mcp::commands::runtime::resolve_callable_mcp_tool_by_ref(
            app_state.mcp.store.as_ref(),
            Some(trimmed),
            None,
        )
        .await
        .map_err(|err| err.to_string())?;
        normalized.push(trimmed.to_string());
    }
    Ok(normalized)
}

async fn validate_bound_skill_ids(
    app_state: &AppState,
    bound_skill_ids: &[String],
) -> Result<Vec<String>, String> {
    let installs = app_state
        .mcp
        .store
        .list_local_skill_installs()
        .await
        .map_err(|err| err.to_string())?;
    let installed_ids = installs
        .into_iter()
        .map(|item| item.skill_id)
        .collect::<std::collections::HashSet<_>>();
    let mut normalized = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for skill_id in bound_skill_ids {
        let trimmed = skill_id.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
            continue;
        }
        if !installed_ids.contains(trimmed) {
            return Err(format!("skill '{}' is not installed locally", trimmed));
        }
        normalized.push(trimmed.to_string());
    }
    Ok(normalized)
}
