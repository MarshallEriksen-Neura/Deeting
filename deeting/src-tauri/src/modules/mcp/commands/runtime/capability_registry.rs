use std::collections::{HashMap, HashSet};

use mcp_registry::assets::{
    build_capability_assets_for_read_mode as build_capability_assets_for_read_mode_inner,
    local_capability_registry_entry_is_usable, local_capability_registry_entry_to_asset,
};
pub(crate) use mcp_registry::assets::{
    capability_asset_match_key, is_legacy_control_plane_asset, CapabilityRegistryReadMode,
};
use serde_json::{json, Value};

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
    pub read_path_mode: CapabilityRegistryReadMode,
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
    let read_path_mode = CapabilityRegistryReadMode::RegistryFirst;
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
    let memory_assets = memory_store.list_assets_catalog().await.unwrap_or_default();
    let registry_entries = mcp_store
        .list_local_capability_registry_entries()
        .await
        .unwrap_or_default();
    let assets =
        build_capability_assets_for_read_mode(memory_assets, &registry_entries, read_path_mode);
    let current_user =
        crate::modules::mcp::desktop_capabilities::desktop_current_user_info_optional().await;

    let entries = assets
        .into_iter()
        .filter(|asset| asset_visible_to_desktop_user(asset, current_user.as_ref()))
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
                    read_path_mode,
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
        read_path_mode,
    }
}

pub(crate) fn build_capability_assets_for_read_mode(
    memory_assets: Vec<Value>,
    registry_entries: &[crate::modules::mcp::store::LocalCapabilityRegistrySnapshot],
    read_path_mode: CapabilityRegistryReadMode,
) -> Vec<Value> {
    build_capability_assets_for_read_mode_inner(
        memory_assets,
        registry_entries,
        read_path_mode,
        build_core_tool_assets(),
    )
}

#[cfg(test)]
fn replaced_by_local_capability_registry(
    asset: &Value,
    registry_package_ids: &HashSet<String>,
) -> bool {
    let asset_type = asset
        .get("asset_type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !matches!(asset_type, "skill" | "skill_tool") {
        return false;
    }
    let source_type = asset
        .get("source_type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !matches!(source_type, "builtin" | "user") {
        return false;
    }
    let package_id = asset
        .get("pkg_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            asset
                .get("metadata")
                .and_then(|metadata| metadata.get("skill_id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        });
    package_id
        .map(|value| registry_package_ids.contains(value))
        .unwrap_or(false)
}

#[cfg(test)]
fn replaced_by_db_mcp_tool(asset: &Value, db_mcp_tool_ids: &HashSet<String>) -> bool {
    let asset_type = asset
        .get("asset_type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if asset_type != "tool" {
        return false;
    }
    let source_type = asset
        .get("source_type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if source_type != "mcp" {
        return false;
    }
    let id = asset.get("id").and_then(Value::as_str).unwrap_or_default();
    db_mcp_tool_ids.contains(id)
}

#[cfg(test)]
fn replaced_by_core_tool_registry(asset: &Value, core_tool_names: &HashSet<String>) -> bool {
    let asset_type = asset
        .get("asset_type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if asset_type != "tool" {
        return false;
    }
    let source_type = asset
        .get("source_type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if source_type != "code_mode_core" {
        return false;
    }
    let name = asset
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    core_tool_names.contains(name)
}

#[cfg(test)]
fn replaced_by_assistant_registry(asset: &Value, assistant_ids: &HashSet<String>) -> bool {
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

#[cfg(test)]
fn db_mcp_tool_to_asset(tool: &crate::modules::mcp::types::McpTool) -> Value {
    json!({
        "id": tool.id,
        "name": tool.name,
        "description": tool.description,
        "asset_type": "tool",
        "source_type": "mcp",
        "pkg_name": tool
            .source_id
            .as_deref()
            .map(|source_id| format!("mcp.{}", source_id))
            .unwrap_or_else(|| "mcp.local".to_string()),
        "metadata": {
            "asset_namespace": "user_mcp",
            "source_id": tool.source_id,
            "identifier": tool.identifier,
            "transport": tool.transport_label(),
            "remote_sse_url": tool.remote_sse_url(),
            "remote_tool_name": tool.remote_tool_name(),
            "remote_server_name": tool.remote_server_name(),
            "capabilities": tool.capabilities,
            "read_only": tool.is_read_only,
            "command": tool.command,
            "args": tool.args,
            "status": tool.status.as_str(),
        }
    })
}

fn asset_visible_to_desktop_user(
    asset: &Value,
    current_user: Option<&crate::modules::mcp::desktop_capabilities::DesktopCurrentUserInfo>,
) -> bool {
    let restricted = asset
        .get("restricted")
        .and_then(Value::as_bool)
        .or_else(|| {
            asset
                .get("metadata")
                .and_then(|metadata| metadata.get("restricted"))
                .and_then(Value::as_bool)
        })
        .unwrap_or(false);
    let allowed_roles = asset
        .get("allowed_roles")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .or_else(|| {
            asset
                .get("metadata")
                .and_then(|metadata| metadata.get("allowed_roles"))
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
        })
        .unwrap_or_default();
    let id_hint = asset.get("id").and_then(Value::as_str).or_else(|| {
        asset
            .get("metadata")
            .and_then(|metadata| metadata.get("skill_id"))
            .and_then(Value::as_str)
    });
    crate::modules::mcp::desktop_capabilities::desktop_user_can_access_restricted_asset(
        current_user,
        restricted,
        &allowed_roles,
        id_hint,
    )
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
        read_path_mode: CapabilityRegistryReadMode,
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
                if let Some(availability) =
                    local_skill_registry_availability_override(asset_metadata)
                {
                    return availability;
                }
                if matches!(read_path_mode, CapabilityRegistryReadMode::RegistryFirst) {
                    return Self::missing_registry_readiness(
                        "skill_tool_registry_metadata_missing",
                    );
                }
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
                if source_type == "mcp" {
                    if let Some(availability) = mcp_registry_availability_override(asset_metadata) {
                        return availability;
                    }
                    if matches!(read_path_mode, CapabilityRegistryReadMode::RegistryFirst) {
                        return Self::missing_registry_readiness(
                            "mcp_tool_registry_metadata_missing",
                        );
                    }
                }
                if let Some(skill_id) = pkg_name.filter(|value| value.starts_with("skill.")) {
                    if matches!(read_path_mode, CapabilityRegistryReadMode::RegistryFirst) {
                        return Self::missing_registry_readiness(
                            "skill_tool_registry_metadata_missing",
                        );
                    }
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
                    if let Some(availability) = core_registry_availability_override(asset_metadata)
                    {
                        return availability;
                    }
                    if matches!(read_path_mode, CapabilityRegistryReadMode::RegistryFirst) {
                        return Self::missing_registry_readiness(
                            "core_tool_registry_metadata_missing",
                        );
                    }
                    return Self {
                        class: ToolAvailabilityClass::CallableDirect,
                        install_required: false,
                        activation_required: false,
                        recommended_action: "execute",
                        status_reason: "core_code_mode_tool",
                    };
                }
                if source_type == "mcp" {
                    if matches!(read_path_mode, CapabilityRegistryReadMode::RegistryFirst) {
                        return Self::missing_registry_readiness(
                            "mcp_tool_registry_metadata_missing",
                        );
                    }
                    if let Some(availability) =
                        tool_availability_catalog.get_for_asset(asset_id, tool_name)
                    {
                        return Self::from_tool_availability(availability);
                    }
                }
                if matches!(read_path_mode, CapabilityRegistryReadMode::RegistryFirst) {
                    return Self::missing_registry_readiness("tool_registry_metadata_missing");
                }
                Self::from_tool_availability(&fallback_local_tool_availability(pkg_name))
            }
            "assistant" => {
                if let Some(availability) = assistant_registry_availability_override(asset_metadata)
                {
                    return availability;
                }
                if matches!(read_path_mode, CapabilityRegistryReadMode::RegistryFirst) {
                    return Self::missing_registry_readiness("assistant_registry_metadata_missing");
                }
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

    fn missing_registry_readiness(status_reason: &'static str) -> Self {
        Self {
            class: ToolAvailabilityClass::Unavailable,
            install_required: false,
            activation_required: false,
            recommended_action: "review",
            status_reason,
        }
    }

    pub(crate) fn is_direct_callable(&self) -> bool {
        matches!(self.class, ToolAvailabilityClass::CallableDirect)
    }

    pub(crate) fn needs_setup(&self) -> bool {
        matches!(self.class, ToolAvailabilityClass::NeedsSetup)
    }
}

fn local_skill_registry_availability_override(
    asset_metadata: Option<&Value>,
) -> Option<RegistryAvailability> {
    let metadata = asset_metadata?;
    let activation_state = metadata
        .get("activation_state")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if activation_state != "enabled" {
        return Some(RegistryAvailability {
            class: ToolAvailabilityClass::NeedsSetup,
            install_required: false,
            activation_required: true,
            recommended_action: "enable_skill",
            status_reason: "skill_installed_but_disabled",
        });
    }

    let runtime_state = metadata
        .get("runtime_state")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown");

    Some(match runtime_state {
        "ready" | "not_required" => RegistryAvailability {
            class: ToolAvailabilityClass::CallableDirect,
            install_required: false,
            activation_required: false,
            recommended_action: "execute",
            status_reason: "ready_in_local_runtime",
        },
        "needs_install" => RegistryAvailability {
            class: ToolAvailabilityClass::NeedsSetup,
            install_required: true,
            activation_required: false,
            recommended_action: "install_skill_runtime",
            status_reason: "skill_runtime_install_required",
        },
        "needs_reinstall" => RegistryAvailability {
            class: ToolAvailabilityClass::NeedsSetup,
            install_required: true,
            activation_required: false,
            recommended_action: "reinstall_skill_runtime",
            status_reason: "skill_runtime_reinstall_required",
        },
        "installing" => RegistryAvailability {
            class: ToolAvailabilityClass::Unavailable,
            install_required: false,
            activation_required: false,
            recommended_action: "wait_for_runtime",
            status_reason: "skill_runtime_installing",
        },
        "install_failed" => RegistryAvailability {
            class: ToolAvailabilityClass::Unavailable,
            install_required: false,
            activation_required: false,
            recommended_action: "review",
            status_reason: "skill_runtime_install_failed",
        },
        "unsupported" => RegistryAvailability {
            class: ToolAvailabilityClass::Unavailable,
            install_required: false,
            activation_required: false,
            recommended_action: "review",
            status_reason: "skill_runtime_unsupported",
        },
        _ => RegistryAvailability {
            class: ToolAvailabilityClass::Unavailable,
            install_required: false,
            activation_required: false,
            recommended_action: "review",
            status_reason: "skill_runtime_unknown",
        },
    })
}

fn mcp_registry_availability_override(
    asset_metadata: Option<&Value>,
) -> Option<RegistryAvailability> {
    let metadata = asset_metadata?;
    let runtime_state = metadata
        .get("runtime_state")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    Some(match runtime_state {
        "ready" => RegistryAvailability {
            class: ToolAvailabilityClass::CallableDirect,
            install_required: false,
            activation_required: false,
            recommended_action: "execute",
            status_reason: "ready_via_registry_runtime",
        },
        "stopped" => RegistryAvailability {
            class: ToolAvailabilityClass::NeedsSetup,
            install_required: false,
            activation_required: true,
            recommended_action: "start_tool",
            status_reason: "tool_installed_but_stopped",
        },
        "pending" => RegistryAvailability {
            class: ToolAvailabilityClass::Unavailable,
            install_required: false,
            activation_required: false,
            recommended_action: "wait_for_runtime",
            status_reason: "tool_runtime_pending",
        },
        "error" => RegistryAvailability {
            class: ToolAvailabilityClass::Unavailable,
            install_required: false,
            activation_required: false,
            recommended_action: "review",
            status_reason: "tool_runtime_error",
        },
        _ => RegistryAvailability {
            class: ToolAvailabilityClass::Unavailable,
            install_required: false,
            activation_required: false,
            recommended_action: "review",
            status_reason: "tool_runtime_unknown",
        },
    })
}

fn core_registry_availability_override(
    asset_metadata: Option<&Value>,
) -> Option<RegistryAvailability> {
    let metadata = asset_metadata?;
    let activation_state = metadata
        .get("activation_state")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if activation_state != "enabled" {
        return Some(RegistryAvailability {
            class: ToolAvailabilityClass::Unavailable,
            install_required: false,
            activation_required: false,
            recommended_action: "review",
            status_reason: "core_tool_disabled",
        });
    }
    Some(RegistryAvailability {
        class: ToolAvailabilityClass::CallableDirect,
        install_required: false,
        activation_required: false,
        recommended_action: "execute",
        status_reason: "core_code_mode_tool",
    })
}

fn assistant_registry_availability_override(
    asset_metadata: Option<&Value>,
) -> Option<RegistryAvailability> {
    let metadata = asset_metadata?;
    let activation_state = metadata
        .get("activation_state")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if activation_state == "enabled" {
        return Some(RegistryAvailability {
            class: ToolAvailabilityClass::Unavailable,
            install_required: false,
            activation_required: false,
            recommended_action: "consult_then_activate",
            status_reason: "assistant_available_for_activation",
        });
    }
    Some(RegistryAvailability {
        class: ToolAvailabilityClass::NeedsSetup,
        install_required: false,
        activation_required: true,
        recommended_action: "enable_assistant",
        status_reason: "assistant_installed_but_disabled",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_registry_skill_assets_replace_memory_backed_skill_assets() {
        let registry_packages = HashSet::from(["skill.alpha".to_string()]);
        assert!(replaced_by_local_capability_registry(
            &json!({
                "asset_type": "skill_tool",
                "source_type": "user",
                "pkg_name": "skill.alpha",
            }),
            &registry_packages
        ));
        assert!(replaced_by_local_capability_registry(
            &json!({
                "asset_type": "skill",
                "source_type": "builtin",
                "metadata": { "skill_id": "skill.alpha" },
            }),
            &registry_packages
        ));
        assert!(!replaced_by_local_capability_registry(
            &json!({
                "asset_type": "skill",
                "source_type": "cloud_mirror",
                "pkg_name": "skill.alpha",
            }),
            &registry_packages
        ));
    }

    #[test]
    fn local_registry_skill_tool_asset_uses_binding_id_and_callable_name() {
        let asset = local_capability_registry_entry_to_asset(
            &crate::modules::mcp::store::LocalCapabilityRegistrySnapshot {
                capability_id: "skill_tool::skill.alpha::install".to_string(),
                source_kind: "user".to_string(),
                asset_kind: "skill_tool".to_string(),
                package_id: "skill.alpha".to_string(),
                package_version: Some("1.0.0".to_string()),
                title: "Skill Alpha / install".to_string(),
                description: "Install alpha".to_string(),
                tool_name: Some("install".to_string()),
                callable_name: Some("skill.skill.alpha.install".to_string()),
                binding_kind: Some("deeting_tool".to_string()),
                execution_surface: "desktop_capability".to_string(),
                runtime: Some("python".to_string()),
                entry_path: Some("C:/skills/skill.alpha/main.py".to_string()),
                is_direct_callable: true,
                activation_state: "enabled".to_string(),
                runtime_state: "registered".to_string(),
                search_index_state: "pending".to_string(),
                generation: 3,
                descriptor_json: json!({
                    "binding_id": "skill_binding::skill.alpha::install",
                    "tool_name": "install",
                    "callable_name": "skill.skill.alpha.install",
                    "input_schema": {"type":"object","properties":{"package":{"type":"string"}}},
                    "restricted": false,
                    "allowed_roles": [],
                }),
                updated_at: "2026-03-16T00:00:00Z".to_string(),
            },
        );

        assert_eq!(asset["id"], json!("skill_binding::skill.alpha::install"));
        assert_eq!(asset["name"], json!("skill.skill.alpha.install"));
        assert_eq!(asset["asset_type"], json!("skill_tool"));
        assert_eq!(asset["metadata"]["skill_id"], json!("skill.alpha"));
        assert_eq!(asset["metadata"]["tool_name"], json!("install"));
    }

    #[test]
    fn build_capability_assets_for_read_mode_skips_missing_skill_tool_entry_paths() {
        let missing_entry = crate::modules::mcp::store::LocalCapabilityRegistrySnapshot {
            capability_id: "skill_tool::skill.deleted::install".to_string(),
            source_kind: "builtin".to_string(),
            asset_kind: "skill_tool".to_string(),
            package_id: "skill.deleted".to_string(),
            package_version: Some("1.0.0".to_string()),
            title: "Deleted Skill / install".to_string(),
            description: "Install deleted skill".to_string(),
            tool_name: Some("install".to_string()),
            callable_name: Some("skill.official.skills.deleted.install".to_string()),
            binding_kind: Some("script_runner".to_string()),
            execution_surface: "script_runner".to_string(),
            runtime: Some("python".to_string()),
            entry_path: Some("C:/definitely-missing/deleted-skill/main.py".to_string()),
            is_direct_callable: true,
            activation_state: "enabled".to_string(),
            runtime_state: "registered".to_string(),
            search_index_state: "ready".to_string(),
            generation: 9,
            descriptor_json: json!({
                "binding_id": "skill_binding::skill.deleted::install",
                "tool_name": "install",
                "callable_name": "skill.official.skills.deleted.install",
                "timeout_seconds": 60
            }),
            updated_at: "2026-03-17T00:00:00Z".to_string(),
        };

        assert!(!local_capability_registry_entry_is_usable(&missing_entry));
        let assets = build_capability_assets_for_read_mode(
            Vec::new(),
            &[missing_entry],
            CapabilityRegistryReadMode::RegistryFirst,
        );
        assert!(assets.is_empty());
    }

    #[test]
    fn local_registry_skill_bundle_asset_keeps_readiness_metadata() {
        let asset = local_capability_registry_entry_to_asset(
            &crate::modules::mcp::store::LocalCapabilityRegistrySnapshot {
                capability_id: "skill_bundle::skill.alpha".to_string(),
                source_kind: "user".to_string(),
                asset_kind: "skill_bundle".to_string(),
                package_id: "skill.alpha".to_string(),
                package_version: Some("1.0.0".to_string()),
                title: "Skill Alpha".to_string(),
                description: "Bundle".to_string(),
                tool_name: None,
                callable_name: None,
                binding_kind: None,
                execution_surface: "recipe".to_string(),
                runtime: Some("local".to_string()),
                entry_path: None,
                is_direct_callable: false,
                activation_state: "disabled".to_string(),
                runtime_state: "not_required".to_string(),
                search_index_state: "pending".to_string(),
                generation: 7,
                descriptor_json: json!({
                    "manifest": {
                        "id": "skill.alpha",
                        "name": "Skill Alpha"
                    }
                }),
                updated_at: "2026-03-16T00:00:00Z".to_string(),
            },
        );

        assert_eq!(asset["asset_type"], json!("skill"));
        assert_eq!(asset["metadata"]["activation_state"], json!("disabled"));
        assert_eq!(asset["metadata"]["search_index_state"], json!("pending"));
        assert_eq!(asset["metadata"]["generation"], json!(7));
    }

    #[test]
    fn db_mcp_tools_replace_memory_backed_mcp_assets() {
        let ids = HashSet::from(["tool-1".to_string()]);
        assert!(replaced_by_db_mcp_tool(
            &json!({
                "id": "tool-1",
                "asset_type": "tool",
                "source_type": "mcp",
            }),
            &ids
        ));
        assert!(!replaced_by_db_mcp_tool(
            &json!({
                "id": "tool-1",
                "asset_type": "skill_tool",
                "source_type": "mcp",
            }),
            &ids
        ));
    }

    #[test]
    fn db_mcp_tool_asset_preserves_transport_metadata() {
        let asset = db_mcp_tool_to_asset(&crate::modules::mcp::types::McpTool {
            id: "tool-1".to_string(),
            identifier: Some("search_web".to_string()),
            name: "search_web".to_string(),
            source_type: crate::modules::mcp::types::McpSourceType::Local,
            source_id: Some("source-1".to_string()),
            status: crate::modules::mcp::types::McpToolStatus::Healthy,
            ping_ms: Some(12),
            capabilities: vec!["network".to_string()],
            description: "Search the web".to_string(),
            error: None,
            command: Some("python".to_string()),
            args: Some(vec!["tool.py".to_string()]),
            env: None,
            config_json: "{}".to_string(),
            pending_config_json: None,
            config_hash: "hash".to_string(),
            pending_config_hash: None,
            conflict_status: crate::modules::mcp::types::McpConflictStatus::None,
            is_read_only: false,
            is_new: false,
            created_at: "2026-03-16T00:00:00Z".to_string(),
            updated_at: "2026-03-16T00:00:00Z".to_string(),
        });

        assert_eq!(asset["id"], json!("tool-1"));
        assert_eq!(asset["source_type"], json!("mcp"));
        assert_eq!(asset["metadata"]["asset_namespace"], json!("user_mcp"));
        assert_eq!(asset["metadata"]["transport"], json!("stdio"));
    }

    #[test]
    fn core_registry_replaces_runtime_core_assets() {
        let names = HashSet::from(["search_sdk".to_string()]);
        assert!(replaced_by_core_tool_registry(
            &json!({
                "asset_type": "tool",
                "source_type": "code_mode_core",
                "name": "search_sdk",
            }),
            &names
        ));
    }

    #[test]
    fn assistant_registry_replaces_local_assistant_assets() {
        let ids = HashSet::from(["assistant-1".to_string()]);
        assert!(replaced_by_assistant_registry(
            &json!({
                "id": "assistant-1",
                "asset_type": "assistant",
                "source_type": "local_assistant",
            }),
            &ids
        ));
    }

    #[test]
    fn local_registry_runtime_state_changes_availability() {
        let availability = local_skill_registry_availability_override(Some(&json!({
            "activation_state": "enabled",
            "runtime_state": "needs_install"
        })))
        .expect("availability");
        assert_eq!(availability.class, ToolAvailabilityClass::NeedsSetup);
        assert!(availability.install_required);
        assert_eq!(availability.recommended_action, "install_skill_runtime");
    }

    #[test]
    fn local_registry_disabled_skill_requires_enable_action() {
        let availability = local_skill_registry_availability_override(Some(&json!({
            "activation_state": "disabled",
            "runtime_state": "ready"
        })))
        .expect("availability");
        assert_eq!(availability.class, ToolAvailabilityClass::NeedsSetup);
        assert!(availability.activation_required);
        assert_eq!(availability.recommended_action, "enable_skill");
    }

    #[test]
    fn mcp_registry_stopped_tool_requires_start() {
        let availability = mcp_registry_availability_override(Some(&json!({
            "runtime_state": "stopped"
        })))
        .expect("availability");
        assert_eq!(availability.class, ToolAvailabilityClass::NeedsSetup);
        assert!(availability.activation_required);
        assert_eq!(availability.recommended_action, "start_tool");
    }

    #[test]
    fn core_registry_enabled_tool_is_direct_callable() {
        let availability = core_registry_availability_override(Some(&json!({
            "activation_state": "enabled"
        })))
        .expect("availability");
        assert_eq!(availability.class, ToolAvailabilityClass::CallableDirect);
        assert_eq!(availability.recommended_action, "execute");
    }

    #[test]
    fn assistant_registry_enabled_entry_allows_consult_activation() {
        let availability = assistant_registry_availability_override(Some(&json!({
            "activation_state": "enabled"
        })))
        .expect("availability");
        assert_eq!(availability.class, ToolAvailabilityClass::Unavailable);
        assert_eq!(availability.recommended_action, "consult_then_activate");
    }

    #[test]
    fn assistant_registry_disabled_entry_requires_enable() {
        let availability = assistant_registry_availability_override(Some(&json!({
            "activation_state": "disabled"
        })))
        .expect("availability");
        assert_eq!(availability.class, ToolAvailabilityClass::NeedsSetup);
        assert_eq!(availability.recommended_action, "enable_assistant");
    }

    #[test]
    fn assistant_registry_asset_is_emitted_as_local_assistant() {
        let asset = local_capability_registry_entry_to_asset(
            &crate::modules::mcp::store::LocalCapabilityRegistrySnapshot {
                capability_id: "assistant-1".to_string(),
                source_kind: "assistant".to_string(),
                asset_kind: "assistant".to_string(),
                package_id: "assistant-1".to_string(),
                package_version: None,
                title: "Research Assistant".to_string(),
                description: "Helps with research".to_string(),
                tool_name: None,
                callable_name: None,
                binding_kind: None,
                execution_surface: "assistant".to_string(),
                runtime: None,
                entry_path: None,
                is_direct_callable: false,
                activation_state: "enabled".to_string(),
                runtime_state: "not_required".to_string(),
                search_index_state: "auxiliary".to_string(),
                generation: 9,
                descriptor_json: json!({
                    "assistant_id": "assistant-1",
                    "name": "Research Assistant"
                }),
                updated_at: "2026-03-16T00:00:00Z".to_string(),
            },
        );

        assert_eq!(asset["asset_type"], json!("assistant"));
        assert_eq!(asset["source_type"], json!("local_assistant"));
    }

    #[test]
    fn capability_registry_read_mode_defaults_to_registry_first() {
        assert_eq!(
            CapabilityRegistryReadMode::default(),
            CapabilityRegistryReadMode::RegistryFirst
        );
    }

    #[test]
    fn registry_first_mode_filters_legacy_local_assets_but_keeps_cloud_mirror_assets() {
        let assets = build_capability_assets_for_read_mode(
            vec![
                json!({
                    "id": "skill.alpha",
                    "asset_type": "skill",
                    "source_type": "user",
                }),
                json!({
                    "id": "cloud.skill.alpha",
                    "asset_type": "skill",
                    "source_type": "cloud_mirror",
                }),
            ],
            &[],
            CapabilityRegistryReadMode::RegistryFirst,
        );

        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0]["id"], json!("cloud.skill.alpha"));
    }

    #[test]
    fn legacy_only_mode_keeps_core_tool_assets_available() {
        let assets = build_capability_assets_for_read_mode(
            Vec::new(),
            &[],
            CapabilityRegistryReadMode::LegacyOnly,
        );
        assert!(assets.iter().any(|asset| {
            asset.get("source_type").and_then(Value::as_str) == Some("code_mode_core")
                && asset.get("name").and_then(Value::as_str) == Some("search_sdk")
        }));
    }

    #[test]
    fn capability_asset_match_key_aligns_legacy_and_registry_skill_bundles() {
        let registry_asset = local_capability_registry_entry_to_asset(
            &crate::modules::mcp::store::LocalCapabilityRegistrySnapshot {
                capability_id: "skill_bundle::skill.alpha".to_string(),
                source_kind: "user".to_string(),
                asset_kind: "skill_bundle".to_string(),
                package_id: "skill.alpha".to_string(),
                package_version: Some("1.0.0".to_string()),
                title: "Skill Alpha".to_string(),
                description: "Bundle".to_string(),
                tool_name: None,
                callable_name: None,
                binding_kind: None,
                execution_surface: "recipe".to_string(),
                runtime: Some("local".to_string()),
                entry_path: None,
                is_direct_callable: false,
                activation_state: "enabled".to_string(),
                runtime_state: "not_required".to_string(),
                search_index_state: "ready".to_string(),
                generation: 1,
                descriptor_json: json!({
                    "manifest": {
                        "id": "skill.alpha",
                        "name": "Skill Alpha"
                    }
                }),
                updated_at: "2026-03-16T00:00:00Z".to_string(),
            },
        );
        let legacy_asset = json!({
            "id": "skill.alpha",
            "asset_type": "skill",
            "source_type": "user",
            "pkg_name": "skill.alpha",
        });

        assert_eq!(
            capability_asset_match_key(&registry_asset),
            capability_asset_match_key(&legacy_asset)
        );
    }

    #[test]
    fn registry_first_mode_does_not_fallback_to_legacy_skill_state_without_metadata() {
        let availability = RegistryAvailability::from_asset(
            "skill_tool",
            "user",
            "skill_binding::skill.alpha::install",
            "skill.skill.alpha.install",
            Some("skill.alpha"),
            None,
            CapabilityRegistryReadMode::RegistryFirst,
            &HashSet::new(),
            &HashSet::from(["skill.alpha".to_string()]),
            &ToolAvailabilityCatalog::default(),
        );

        assert_eq!(availability.class, ToolAvailabilityClass::Unavailable);
        assert_eq!(
            availability.status_reason,
            "skill_tool_registry_metadata_missing"
        );
    }
}
