use super::super::{common_impl::to_string, support::*};
use super::tool_schemas::normalize_tool_schema_for_llm;

#[derive(Debug, Clone)]
pub(crate) struct LocalAssistantActivationState {
    pub(crate) assistant_id: String,
    pub(crate) assistant_name: String,
    pub(crate) system_prompt: String,
    pub(crate) skill_tools: Vec<serde_json::Value>,
}

pub(crate) async fn resolve_local_skill_refs_to_tools(
    app_state: &AppState,
    skill_refs: &[serde_json::Value],
) -> Result<Vec<serde_json::Value>, String> {
    let mut tools = Vec::new();
    let mut seen_names = HashSet::new();

    for skill_ref in skill_refs {
        let raw_skill_id = skill_ref
            .get("skill_id")
            .or_else(|| skill_ref.get("id"))
            .or_else(|| skill_ref.get("name"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let Some(raw_skill_id) = raw_skill_id else {
            continue;
        };

        let mut candidate_ids = vec![raw_skill_id.clone()];
        let normalized = raw_skill_id.replace('/', ".");
        if normalized != raw_skill_id {
            candidate_ids.push(normalized.clone());
        }
        if let Some(tail) = normalized.split('.').last() {
            let official = format!("official.skills.{}", tail);
            if !candidate_ids.contains(&official) {
                candidate_ids.push(official);
            }
        }

        let mut manifest_json: Option<String> = None;
        for candidate_id in candidate_ids {
            manifest_json = app_state
                .mcp
                .store
                .get_enabled_local_skill_manifest_json(&candidate_id)
                .await
                .map_err(to_string)?;
            if manifest_json.is_some() {
                break;
            }
        }

        let Some(manifest_json) = manifest_json else {
            continue;
        };
        let manifest = serde_json::from_str::<serde_json::Value>(&manifest_json)
            .map_err(|err| err.to_string())?;
        let manifest_tools = manifest
            .get("tools")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        for raw_tool in manifest_tools {
            let Some(tool) = normalize_tool_schema_for_llm(&raw_tool) else {
                continue;
            };
            let Some(name) = tool
                .get("function")
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            if seen_names.insert(name) {
                tools.push(tool);
            }
        }
    }

    Ok(tools)
}

pub(crate) async fn resolve_local_assistant_activation_state(
    app_state: &AppState,
    assistant_id: &str,
) -> Result<LocalAssistantActivationState, String> {
    let normalized_assistant_id = assistant_id.trim().to_string();
    if normalized_assistant_id.is_empty() {
        return Err("assistant_id is required".to_string());
    }

    let enabled_assistant_ids = app_state
        .mcp
        .store
        .list_enabled_local_assistant_ids()
        .await
        .map_err(to_string)?;
    if !enabled_assistant_ids.contains(normalized_assistant_id.as_str()) {
        return Err(format!(
            "assistant '{}' is not installed or enabled in local desktop runtime",
            normalized_assistant_id
        ));
    }

    let version = app_state
        .mcp
        .store
        .get_local_assistant_current_version(&normalized_assistant_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("assistant '{}' not found", normalized_assistant_id))?;

    let skill_tools = resolve_local_skill_refs_to_tools(app_state, &version.skill_refs).await?;
    Ok(LocalAssistantActivationState {
        assistant_id: normalized_assistant_id,
        assistant_name: version.name,
        system_prompt: version.system_prompt,
        skill_tools,
    })
}
