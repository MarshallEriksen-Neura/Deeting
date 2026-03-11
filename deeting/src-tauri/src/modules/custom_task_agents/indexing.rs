use serde_json::json;

use crate::state::AppState;

use super::types::CustomTaskAgentProfile;

pub(crate) async fn index_custom_task_agent(
    app_state: &AppState,
    profile: &CustomTaskAgentProfile,
) -> Result<(), String> {
    let text = build_index_text(profile);
    let vector = app_state
        .providers
        .embedding
        .embed_text(&text)
        .await
        .map_err(|err| err.to_string())?;
    app_state
        .memory
        .store
        .upsert_asset(
            profile.id.clone(),
            profile.name.clone(),
            profile.description.clone().unwrap_or_default(),
            "custom_task_agent".to_string(),
            "local_custom_task_agent".to_string(),
            Some(format!("custom_task_agent:{}", profile.id)),
            vector,
            Some(json!({
                "invocation_kind": profile.invocation_kind.as_str(),
                "model_config": profile.model_config.clone(),
                "bound_tool_ids": profile.bound_tool_ids.clone(),
                "bound_skill_ids": profile.bound_skill_ids.clone(),
                "tags": profile.tags.clone(),
                "discoverable": profile.discoverable,
                "is_enabled": profile.is_enabled,
            })),
        )
        .await
        .map_err(|err| err.to_string())
}

pub(crate) async fn index_custom_task_agents(
    app_state: &AppState,
    profiles: &[CustomTaskAgentProfile],
) -> Result<(), String> {
    for profile in profiles {
        if profile.discoverable && profile.is_enabled && !profile.is_deleted {
            index_custom_task_agent(app_state, profile).await?;
        } else {
            remove_custom_task_agent_index(app_state, &profile.id).await?;
        }
    }
    Ok(())
}

pub(crate) async fn remove_custom_task_agent_index(
    app_state: &AppState,
    profile_id: &str,
) -> Result<(), String> {
    app_state
        .memory
        .store
        .delete_assets_by_ids(&[profile_id.trim().to_string()])
        .await
        .map_err(|err| err.to_string())
}

fn build_index_text(profile: &CustomTaskAgentProfile) -> String {
    let tags = if profile.tags.is_empty() {
        String::new()
    } else {
        profile.tags.join(", ")
    };
    let tool_ids = if profile.bound_tool_ids.is_empty() {
        String::new()
    } else {
        profile.bound_tool_ids.join(", ")
    };
    let skill_ids = if profile.bound_skill_ids.is_empty() {
        String::new()
    } else {
        profile.bound_skill_ids.join(", ")
    };
    let prompt_excerpt = profile.task_prompt.chars().take(240).collect::<String>();
    format!(
        "name: {}\ndescription: {}\ninvocation_kind: {}\ntags: {}\nbound_tools: {}\nbound_skills: {}\nprompt_excerpt: {}",
        profile.name,
        profile.description.as_deref().unwrap_or(""),
        profile.invocation_kind.as_str(),
        tags,
        tool_ids,
        skill_ids,
        prompt_excerpt,
    )
}

#[cfg(test)]
mod tests {
    use super::build_index_text;
    use crate::modules::custom_task_agents::types::{
        CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
    };

    #[test]
    fn build_index_text_includes_bound_resources() {
        let text = build_index_text(&CustomTaskAgentProfile {
            id: "agent-1".to_string(),
            name: "Image Agent".to_string(),
            description: Some("Creates images".to_string()),
            task_prompt: "Generate image variants".to_string(),
            invocation_kind: CustomTaskAgentInvocationKind::ImageGeneration,
            model_config: None,
            bound_tool_ids: vec!["tool.image.generate".to_string()],
            bound_skill_ids: vec!["skill.prompt-polish".to_string()],
            tags: vec!["image".to_string()],
            discoverable: true,
            is_enabled: true,
            is_deleted: false,
            created_at: "2026-03-11T00:00:00Z".to_string(),
            updated_at: "2026-03-11T00:00:00Z".to_string(),
        });

        assert!(text.contains("bound_tools: tool.image.generate"));
        assert!(text.contains("bound_skills: skill.prompt-polish"));
        assert!(text.contains("invocation_kind: image_generation"));
    }
}
