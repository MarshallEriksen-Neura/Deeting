use super::super::{common_impl::to_string, support::*};

#[derive(Debug, Clone)]
pub(crate) struct LocalCapabilityActivationState {
    pub(crate) capability_id: String,
    pub(crate) capability_name: String,
    pub(crate) capability_summary: String,
}

pub(crate) async fn resolve_local_capability_activation_state(
    app_state: &AppState,
    capability_id: &str,
) -> Result<LocalCapabilityActivationState, String> {
    let normalized_capability_id = capability_id.trim().to_string();
    if normalized_capability_id.is_empty() {
        return Err("capability_id is required".to_string());
    }

    let enabled_capability_ids = app_state
        .mcp
        .store
        .list_enabled_local_assistant_ids()
        .await
        .map_err(to_string)?;
    if !enabled_capability_ids.contains(normalized_capability_id.as_str()) {
        return Err(format!(
            "capability '{}' is not available in local desktop runtime",
            normalized_capability_id
        ));
    }

    let version = app_state
        .mcp
        .store
        .get_local_assistant_current_version(&normalized_capability_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("capability '{}' not found", normalized_capability_id))?;

    Ok(LocalCapabilityActivationState {
        capability_id: normalized_capability_id,
        capability_name: version.name,
        capability_summary: version.description.unwrap_or_default(),
    })
}
