use std::collections::HashSet;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use mcp_registry::assets::CapabilityRegistryReadMode;
use mcp_registry::types::LocalCapabilityRegistryUpsert;
use mcp_session::assistant::LocalAssistant;
use serde_json::Value;

#[derive(Debug, Clone, Copy)]
pub(crate) struct AssistantCapabilityAvailability {
    pub install_required: bool,
    pub activation_required: bool,
    pub recommended_action: &'static str,
    pub status_reason: &'static str,
}

#[cfg(test)]
pub(crate) fn replaced_by_assistant_registry(
    asset: &Value,
    assistant_ids: &HashSet<String>,
) -> bool {
    let asset_type = asset
        .get("asset_type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if asset_type != "assistant" {
        return false;
    }
    let source_type = asset
        .get("source_type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if source_type != "local_assistant" {
        return false;
    }
    let id = asset.get("id").and_then(Value::as_str).unwrap_or_default();
    assistant_ids.contains(id)
}

pub(crate) fn assistant_registry_availability_override(
    asset_metadata: Option<&Value>,
) -> Option<AssistantCapabilityAvailability> {
    let metadata = asset_metadata?;
    let activation_state = metadata
        .get("activation_state")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if activation_state == "enabled" {
        return Some(AssistantCapabilityAvailability {
            install_required: false,
            activation_required: false,
            recommended_action: "consult_then_activate",
            status_reason: "assistant_available_for_activation",
        });
    }
    Some(AssistantCapabilityAvailability {
        install_required: false,
        activation_required: true,
        recommended_action: "enable_assistant",
        status_reason: "assistant_installed_but_disabled",
    })
}

pub(crate) fn assistant_capability_availability(
    asset_id: &str,
    asset_metadata: Option<&Value>,
    read_path_mode: CapabilityRegistryReadMode,
    enabled_assistant_ids: &HashSet<String>,
) -> AssistantCapabilityAvailability {
    if let Some(availability) = assistant_registry_availability_override(asset_metadata) {
        return availability;
    }
    if matches!(read_path_mode, CapabilityRegistryReadMode::RegistryFirst) {
        return AssistantCapabilityAvailability {
            install_required: false,
            activation_required: false,
            recommended_action: "review",
            status_reason: "assistant_registry_metadata_missing",
        };
    }
    if enabled_assistant_ids.contains(asset_id) {
        AssistantCapabilityAvailability {
            install_required: false,
            activation_required: false,
            recommended_action: "consult_then_activate",
            status_reason: "assistant_available_for_activation",
        }
    } else {
        AssistantCapabilityAvailability {
            install_required: false,
            activation_required: true,
            recommended_action: "enable_assistant",
            status_reason: "assistant_installed_but_disabled",
        }
    }
}

impl McpStore {
    pub async fn sync_assistant_registry_entry(&self, assistant_id: &str) -> Result<i64, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }
        let assistants = self.list_local_assistants().await?;
        let enabled_ids = self.list_enabled_local_assistant_ids().await?;
        let generation = self.next_local_capability_registry_generation().await?;
        let Some(assistant) = assistants
            .into_iter()
            .find(|assistant| assistant.id == normalized_assistant_id)
        else {
            return self
                .delete_local_capability_registry_entries(&normalized_assistant_id)
                .await;
        };
        let entry = build_assistant_registry_entry(
            &assistant,
            enabled_ids.contains(assistant.id.as_str()),
            generation,
        );
        self.replace_local_capability_registry_entries(&assistant.id, &[entry])
            .await
    }

    pub async fn sync_all_assistant_registry_entries(&self) -> Result<i64, McpError> {
        let assistants = self.list_local_assistants().await?;
        let enabled_ids = self.list_enabled_local_assistant_ids().await?;
        let generation = self.next_local_capability_registry_generation().await?;
        let mut registry_packages = self
            .list_local_capability_registry_entries()
            .await?
            .into_iter()
            .filter(|entry| entry.source_kind == "assistant")
            .map(|entry| entry.package_id)
            .collect::<std::collections::BTreeSet<_>>();
        let mut count = 0i64;
        for assistant in assistants {
            let entry = build_assistant_registry_entry(
                &assistant,
                enabled_ids.contains(assistant.id.as_str()),
                generation,
            );
            count += self
                .replace_local_capability_registry_entries(&assistant.id, &[entry])
                .await?;
            registry_packages.remove(&assistant.id);
        }
        for stale_package in registry_packages {
            count += self
                .delete_local_capability_registry_entries(&stale_package)
                .await?;
        }
        Ok(count)
    }
}

fn build_assistant_registry_entry(
    assistant: &LocalAssistant,
    is_enabled: bool,
    generation: i64,
) -> LocalCapabilityRegistryUpsert {
    let activation_state = if is_enabled { "enabled" } else { "disabled" };
    LocalCapabilityRegistryUpsert {
        capability_id: assistant.id.clone(),
        source_kind: "assistant".to_string(),
        asset_kind: "assistant".to_string(),
        package_id: assistant.id.clone(),
        package_version: None,
        title: assistant.name.clone(),
        description: assistant.description.clone().unwrap_or_default(),
        tool_name: None,
        callable_name: None,
        binding_kind: None,
        execution_surface: "assistant".to_string(),
        runtime: None,
        entry_path: None,
        is_direct_callable: false,
        activation_state: activation_state.to_string(),
        runtime_state: "not_required".to_string(),
        search_index_state: "auxiliary".to_string(),
        generation,
        descriptor_json: serde_json::json!({
            "assistant_id": assistant.id.clone(),
            "name": assistant.name.clone(),
            "description": assistant.description.clone(),
            "avatar": assistant.avatar.clone(),
            "system_prompt": assistant.system_prompt.clone(),
            "model_config": assistant.model_config.clone(),
            "tags": assistant.tags.clone(),
            "visibility": assistant.visibility.clone(),
            "source": assistant.source.clone(),
            "cloud_id": assistant.cloud_id.clone(),
            "is_deleted": assistant.is_deleted,
            "activation_state": activation_state,
            "runtime_state": "not_required",
            "search_index_state": "auxiliary",
        })
        .to_string(),
    }
}
