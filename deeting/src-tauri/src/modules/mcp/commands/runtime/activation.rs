use super::super::{common_impl::to_string, support::*};

#[derive(Debug, Clone)]
pub(crate) struct LocalAssistantActivationState {
    pub(crate) assistant_id: String,
    pub(crate) assistant_name: String,
    pub(crate) capability_summary: String,
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

    Ok(LocalAssistantActivationState {
        assistant_id: normalized_assistant_id,
        assistant_name: version.name,
        capability_summary: version.description.unwrap_or_default(),
    })
}
