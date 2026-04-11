use crate::state::AppState;

use super::indexing::{index_custom_task_agent, remove_custom_task_agent_index};
use super::skill_actions::validate_callable_skill_action_refs;
use super::store::{
    create_custom_task_agent as create_custom_task_agent_inner,
    update_custom_task_agent as update_custom_task_agent_inner,
};
use super::types::{
    CreateCustomTaskAgentRequest, CustomTaskAgentProfile, UpdateCustomTaskAgentRequest,
};

pub(crate) async fn create_custom_task_agent_service(
    app_state: &AppState,
    mut payload: CreateCustomTaskAgentRequest,
) -> Result<CustomTaskAgentProfile, String> {
    payload.callable_mcp_tool_ids =
        validate_callable_mcp_tool_ids(app_state, &payload.callable_mcp_tool_ids).await?;
    payload.guidance_skill_ids =
        validate_guidance_skill_ids(app_state, &payload.guidance_skill_ids).await?;
    payload.callable_skill_action_refs =
        validate_callable_skill_action_refs(app_state, &payload.callable_skill_action_refs).await?;
    payload.bound_asset_id =
        validate_bound_asset_id(app_state, payload.bound_asset_id.as_deref()).await?;

    let profile = create_custom_task_agent_inner(app_state.mcp.store.as_ref(), payload)
        .await
        .map_err(|err| err.to_string())?;
    sync_custom_task_agent_index(app_state, &profile).await?;
    Ok(profile)
}

pub(crate) async fn update_custom_task_agent_service(
    app_state: &AppState,
    agent_id: &str,
    mut payload: UpdateCustomTaskAgentRequest,
) -> Result<CustomTaskAgentProfile, String> {
    if let Some(callable_mcp_tool_ids) = payload.callable_mcp_tool_ids.as_ref() {
        payload.callable_mcp_tool_ids =
            Some(validate_callable_mcp_tool_ids(app_state, callable_mcp_tool_ids).await?);
    }
    if let Some(guidance_skill_ids) = payload.guidance_skill_ids.as_ref() {
        payload.guidance_skill_ids =
            Some(validate_guidance_skill_ids(app_state, guidance_skill_ids).await?);
    }
    if let Some(callable_skill_action_refs) = payload.callable_skill_action_refs.as_ref() {
        payload.callable_skill_action_refs =
            Some(validate_callable_skill_action_refs(app_state, callable_skill_action_refs).await?);
    }
    if payload.bound_asset_id.is_some() {
        payload.bound_asset_id =
            validate_bound_asset_id(app_state, payload.bound_asset_id.as_deref()).await?;
    }

    let profile = update_custom_task_agent_inner(app_state.mcp.store.as_ref(), agent_id, payload)
        .await
        .map_err(|err| err.to_string())?;
    sync_custom_task_agent_index(app_state, &profile).await?;
    Ok(profile)
}

pub(crate) async fn sync_custom_task_agent_index(
    app_state: &AppState,
    profile: &CustomTaskAgentProfile,
) -> Result<(), String> {
    if profile.discoverable && profile.is_enabled && !profile.is_deleted {
        index_custom_task_agent(app_state, profile).await
    } else {
        remove_custom_task_agent_index(app_state, &profile.id).await
    }
}

async fn validate_callable_mcp_tool_ids(
    app_state: &AppState,
    callable_mcp_tool_ids: &[String],
) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for tool_id in callable_mcp_tool_ids {
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

async fn validate_guidance_skill_ids(
    app_state: &AppState,
    guidance_skill_ids: &[String],
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
    for skill_id in guidance_skill_ids {
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

async fn validate_bound_asset_id(
    app_state: &AppState,
    bound_asset_id: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(asset_id) = bound_asset_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    else {
        return Ok(None);
    };

    let Some(record) = app_state
        .mcp
        .store
        .get_local_asset_record(&asset_id)
        .await
        .map_err(|err| err.to_string())?
    else {
        return Err(format!("local asset '{}' not found", asset_id));
    };

    if record.is_archived || !record.status.eq_ignore_ascii_case("active") {
        return Err(format!("local asset '{}' is unavailable", asset_id));
    }
    if !record.asset_kind.eq_ignore_ascii_case("html_asset") {
        return Err(format!(
            "local asset '{}' is not a bindable html asset",
            asset_id
        ));
    }

    Ok(Some(asset_id))
}
