use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::core_tool_contracts::build_core_tool_assets;
use super::tool_resolution::ToolAvailabilityClass;
use super::{
    build_db_tool_availability_catalog, fallback_local_tool_availability, ToolAvailability,
    ToolAvailabilityCatalog,
};

#[derive(Clone)]
pub(crate) struct CapabilityRegistry {
    pub entries: Vec<CapabilityRegistryEntry>,
    pub enabled_assistant_count: usize,
}

#[derive(Clone)]
pub(crate) struct CapabilityRegistryEntry {
    pub asset: Value,
    pub availability: RegistryAvailability,
    pub tool_contract_source: Option<ToolContractSource>,
}

#[derive(Clone)]
pub(crate) struct ToolContractSource {
    pub config: Value,
    pub is_read_only: bool,
    pub capabilities: Vec<String>,
    pub command: Option<String>,
    pub source_type: String,
}

#[derive(Clone)]
pub(crate) struct RegistryAvailability {
    pub class: ToolAvailabilityClass,
    pub install_required: bool,
    pub activation_required: bool,
    pub recommended_action: &'static str,
    pub status_reason: &'static str,
}

pub(crate) async fn build_capability_registry(
    mcp_store: &crate::modules::mcp::store::McpStore,
    memory_store: &crate::modules::memory::service::MemoryService,
) -> CapabilityRegistry {
    let enabled_assistant_ids = mcp_store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let enabled_skill_ids = mcp_store
        .list_enabled_local_skill_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let tool_availability_catalog = build_db_tool_availability_catalog(mcp_store)
        .await
        .unwrap_or_default();
    let tool_contracts = load_tool_contract_sources(mcp_store).await;
    let mut assets = memory_store.list_assets_catalog().await.unwrap_or_default();
    assets.extend(build_core_tool_assets());

    let entries = assets
        .into_iter()
        .map(|asset| {
            let asset_type = asset
                .get("asset_type")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            let source_type = asset
                .get("source_type")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            let asset_id = asset
                .get("id")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let tool_name = asset
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let pkg_name = asset.get("pkg_name").and_then(|value| value.as_str());
            let asset_metadata = asset.get("metadata");
            let tool_contract_source = tool_contracts.get(tool_name).cloned();

            CapabilityRegistryEntry {
                availability: RegistryAvailability::from_asset(
                    asset_type,
                    source_type,
                    asset_id,
                    tool_name,
                    pkg_name,
                    asset_metadata,
                    &enabled_assistant_ids,
                    &enabled_skill_ids,
                    &tool_availability_catalog,
                ),
                tool_contract_source,
                asset,
            }
        })
        .collect();

    CapabilityRegistry {
        entries,
        enabled_assistant_count: enabled_assistant_ids.len(),
    }
}

async fn load_tool_contract_sources(
    mcp_store: &crate::modules::mcp::store::McpStore,
) -> HashMap<String, ToolContractSource> {
    let Ok(tools) = mcp_store.list_tools().await else {
        return HashMap::new();
    };
    tools
        .into_iter()
        .filter_map(|tool| {
            let normalized = tool.name.trim().to_string();
            if normalized.is_empty() {
                return None;
            }
            let config = serde_json::from_str::<Value>(&tool.config_json).ok()?;
            Some((
                normalized,
                ToolContractSource {
                    config,
                    is_read_only: tool.is_read_only,
                    capabilities: tool.capabilities,
                    command: tool.command,
                    source_type: tool.source_type.as_str().to_string(),
                },
            ))
        })
        .collect()
}

impl RegistryAvailability {
    fn from_asset(
        asset_type: &str,
        source_type: &str,
        asset_id: &str,
        tool_name: &str,
        pkg_name: Option<&str>,
        asset_metadata: Option<&Value>,
        enabled_assistant_ids: &HashSet<String>,
        enabled_skill_ids: &HashSet<String>,
        tool_availability_catalog: &ToolAvailabilityCatalog,
    ) -> Self {
        if source_type == "cloud_mirror" {
            let recommended_action = if asset_type == "assistant" {
                "install_assistant"
            } else {
                "install_skill"
            };
            return Self {
                class: ToolAvailabilityClass::NeedsSetup,
                install_required: true,
                activation_required: false,
                recommended_action,
                status_reason: "not_installed_locally",
            };
        }

        match asset_type {
            "skill_tool" => {
                let explicit_skill_id = asset_metadata
                    .and_then(|value| value.get("skill_id"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let resolved_skill_id = explicit_skill_id.or(pkg_name.map(str::trim));
                if let Some(skill_id) = resolved_skill_id {
                    if !enabled_skill_ids.contains(skill_id) {
                        return Self {
                            class: ToolAvailabilityClass::NeedsSetup,
                            install_required: false,
                            activation_required: true,
                            recommended_action: "enable_skill",
                            status_reason: "skill_installed_but_disabled",
                        };
                    }
                    return Self::from_tool_availability(&fallback_local_tool_availability(
                        resolved_skill_id,
                    ));
                }
                Self {
                    class: ToolAvailabilityClass::Unavailable,
                    install_required: false,
                    activation_required: false,
                    recommended_action: "review",
                    status_reason: "skill_binding_missing_skill_reference",
                }
            }
            "tool" => {
                if let Some(skill_id) = pkg_name.filter(|value| value.starts_with("skill.")) {
                    if !enabled_skill_ids.contains(skill_id) {
                        return Self {
                            class: ToolAvailabilityClass::NeedsSetup,
                            install_required: false,
                            activation_required: true,
                            recommended_action: "enable_skill",
                            status_reason: "skill_installed_but_disabled",
                        };
                    }
                    if source_type == "mcp" {
                        if let Some(availability) =
                            tool_availability_catalog.get_for_asset(asset_id, tool_name)
                        {
                            return Self::from_tool_availability(availability);
                        }
                    }
                    return Self::from_tool_availability(&fallback_local_tool_availability(
                        pkg_name,
                    ));
                }
                if source_type == "code_mode_core" {
                    return Self {
                        class: ToolAvailabilityClass::CallableDirect,
                        install_required: false,
                        activation_required: false,
                        recommended_action: "execute",
                        status_reason: "core_code_mode_tool",
                    };
                }
                if source_type == "mcp" {
                    if let Some(availability) =
                        tool_availability_catalog.get_for_asset(asset_id, tool_name)
                    {
                        return Self::from_tool_availability(availability);
                    }
                }
                Self::from_tool_availability(&fallback_local_tool_availability(pkg_name))
            }
            "assistant" => {
                if enabled_assistant_ids.contains(asset_id) {
                    Self {
                        class: ToolAvailabilityClass::Unavailable,
                        install_required: false,
                        activation_required: false,
                        recommended_action: "consult_then_activate",
                        status_reason: "assistant_available_for_activation",
                    }
                } else {
                    Self {
                        class: ToolAvailabilityClass::NeedsSetup,
                        install_required: false,
                        activation_required: true,
                        recommended_action: "enable_assistant",
                        status_reason: "assistant_installed_but_disabled",
                    }
                }
            }
            _ => Self {
                class: ToolAvailabilityClass::Unavailable,
                install_required: false,
                activation_required: false,
                recommended_action: "review",
                status_reason: "non_callable_catalog_item",
            },
        }
    }

    fn from_tool_availability(availability: &ToolAvailability) -> Self {
        Self {
            class: availability.class,
            install_required: availability.install_required,
            activation_required: availability.activation_required,
            recommended_action: availability.recommended_action,
            status_reason: availability.status_reason,
        }
    }

    pub(crate) fn is_direct_callable(&self) -> bool {
        matches!(self.class, ToolAvailabilityClass::CallableDirect)
    }

    pub(crate) fn needs_setup(&self) -> bool {
        matches!(self.class, ToolAvailabilityClass::NeedsSetup)
    }
}
