use serde_json::{json, Value};

use crate::types::LocalCapabilityRegistrySnapshot;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum CapabilityRegistryReadMode {
    #[default]
    RegistryFirst,
    LegacyOnly,
}

impl CapabilityRegistryReadMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RegistryFirst => "registry_first",
            Self::LegacyOnly => "legacy_only",
        }
    }
}

pub fn local_capability_registry_entry_is_usable(entry: &LocalCapabilityRegistrySnapshot) -> bool {
    if entry.asset_kind != "skill_tool" {
        return true;
    }
    entry
        .entry_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(std::path::Path::new)
        .map_or(true, |path| path.exists())
}

pub fn build_capability_assets_for_read_mode(
    mut memory_assets: Vec<Value>,
    registry_entries: &[LocalCapabilityRegistrySnapshot],
    read_path_mode: CapabilityRegistryReadMode,
    legacy_core_assets: Vec<Value>,
) -> Vec<Value> {
    if matches!(read_path_mode, CapabilityRegistryReadMode::LegacyOnly) {
        memory_assets.extend(legacy_core_assets);
        return memory_assets;
    }

    memory_assets.retain(|asset| !is_legacy_control_plane_asset(asset));
    memory_assets.extend(
        registry_entries
            .iter()
            .filter(|entry| local_capability_registry_entry_is_usable(entry))
            .map(local_capability_registry_entry_to_asset),
    );
    let registry_keys = memory_assets
        .iter()
        .filter_map(capability_asset_match_key)
        .collect::<std::collections::HashSet<_>>();
    memory_assets.extend(legacy_core_assets.into_iter().filter(|asset| {
        capability_asset_match_key(asset)
            .map(|key| !registry_keys.contains(&key))
            .unwrap_or(true)
    }));
    memory_assets
}

pub fn is_legacy_control_plane_asset(asset: &Value) -> bool {
    let source_type = asset
        .get("source_type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let asset_type = asset
        .get("asset_type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    matches!(
        (source_type, asset_type),
        ("builtin" | "user", "skill" | "skill_tool")
            | ("mcp", "tool")
            | ("code_mode_core", "tool")
            | ("local_assistant", "assistant")
    )
}

pub fn capability_asset_match_key(asset: &Value) -> Option<String> {
    let source_type = asset
        .get("source_type")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let asset_type = asset
        .get("asset_type")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let asset_id = asset
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let metadata = asset.get("metadata");

    match (source_type, asset_type) {
        ("builtin" | "user", "skill") => asset
            .get("pkg_name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| {
                metadata
                    .and_then(|value| value.get("skill_id"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
            .or(asset_id)
            .map(|value| format!("skill_bundle:{value}")),
        ("builtin" | "user", "skill_tool") => metadata
            .and_then(|value| value.get("binding_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| asset_id.map(str::to_string))
            .or_else(|| {
                let skill_id = asset
                    .get("pkg_name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .or_else(|| {
                        metadata
                            .and_then(|value| value.get("skill_id"))
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string)
                    })?;
                let tool_name = metadata
                    .and_then(|value| value.get("tool_name"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .or_else(|| {
                        asset
                            .get("name")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string)
                    })?;
                Some(format!("{skill_id}::{tool_name}"))
            })
            .map(|value| format!("skill_tool:{value}")),
        ("mcp", "tool") => asset_id.map(|value| format!("mcp_tool:{value}")),
        ("code_mode_core", "tool") => asset_id
            .or_else(|| {
                asset
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
            .map(|value| format!("core_tool:{value}")),
        ("local_assistant", "assistant") => asset_id.map(|value| format!("assistant:{value}")),
        _ => asset_id.map(|value| format!("generic:{source_type}:{asset_type}:{value}")),
    }
}

pub fn local_capability_registry_entry_to_asset(entry: &LocalCapabilityRegistrySnapshot) -> Value {
    let descriptor = &entry.descriptor_json;
    let restricted = descriptor
        .get("restricted")
        .and_then(Value::as_bool)
        .or_else(|| {
            descriptor
                .get("manifest")
                .and_then(|manifest| manifest.get("restricted"))
                .and_then(Value::as_bool)
        })
        .unwrap_or(false);
    let allowed_roles = descriptor
        .get("allowed_roles")
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| {
            descriptor
                .get("manifest")
                .and_then(|manifest| manifest.get("allowed_roles"))
                .and_then(Value::as_array)
                .cloned()
        })
        .unwrap_or_default();

    match entry.asset_kind.as_str() {
        "assistant" => json!({
            "id": entry.capability_id,
            "name": entry.title,
            "description": entry.description,
            "asset_type": "assistant",
            "source_type": "local_assistant",
            "pkg_name": entry.package_id,
            "metadata": descriptor,
        }),
        "mcp_tool" => json!({
            "id": entry.capability_id,
            "name": entry.tool_name.as_deref().unwrap_or(entry.title.as_str()),
            "description": entry.description,
            "asset_type": "tool",
            "source_type": "mcp",
            "pkg_name": descriptor
                .get("source_id")
                .and_then(Value::as_str)
                .map(|value| format!("mcp.{}", value))
                .unwrap_or_else(|| "mcp.local".to_string()),
            "metadata": descriptor,
        }),
        "core_tool" => json!({
            "id": entry.capability_id,
            "name": entry.tool_name.as_deref().unwrap_or(entry.title.as_str()),
            "description": entry.description,
            "asset_type": "tool",
            "source_type": "code_mode_core",
            "pkg_name": "code_mode.core",
            "metadata": descriptor,
        }),
        "skill_tool" => {
            let binding_id = descriptor
                .get("binding_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(entry.capability_id.as_str());
            let callable_name = entry
                .callable_name
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| descriptor.get("callable_name").and_then(Value::as_str))
                .unwrap_or(entry.title.as_str());
            let tool_name = entry
                .tool_name
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| descriptor.get("tool_name").and_then(Value::as_str))
                .unwrap_or(callable_name);
            json!({
                "id": binding_id,
                "name": callable_name,
                "description": entry.description,
                "asset_type": "skill_tool",
                "source_type": entry.source_kind,
                "pkg_name": entry.package_id,
                "restricted": restricted,
                "allowed_roles": allowed_roles,
                "metadata": {
                    "asset_namespace": "skill",
                    "registry_capability_id": entry.capability_id,
                    "binding_id": binding_id,
                    "binding_kind": entry.binding_kind,
                    "skill_id": entry.package_id,
                    "tool_name": tool_name,
                    "callable_name": callable_name,
                    "execution_lane": "skill_runtime",
                    "execution_surface": entry.execution_surface,
                    "runtime": entry.runtime,
                    "entry_path": entry.entry_path,
                    "input_schema": descriptor.get("input_schema").cloned(),
                    "output_schema": descriptor.get("output_schema").cloned(),
                    "timeout_seconds": descriptor.get("timeout_seconds").cloned(),
                    "compatibility": descriptor.get("compatibility").cloned().or_else(|| {
                        descriptor
                            .get("manifest")
                            .and_then(|manifest| manifest.get("compatibility"))
                            .cloned()
                    }),
                    "restricted": restricted,
                    "allowed_roles": allowed_roles,
                    "activation_state": entry.activation_state,
                    "runtime_state": entry.runtime_state,
                    "search_index_state": entry.search_index_state,
                    "generation": entry.generation,
                }
            })
        }
        _ => {
            let asset_id = descriptor
                .get("skill_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(entry.package_id.as_str());
            let description = descriptor
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| entry.description.clone());
            let mut metadata = descriptor.get("manifest").cloned().unwrap_or_else(|| {
                json!({
                    "id": entry.package_id,
                    "name": entry.title,
                    "description": entry.description,
                })
            });
            if let Some(object) = metadata.as_object_mut() {
                object.insert(
                    "registry_capability_id".to_string(),
                    json!(entry.capability_id.clone()),
                );
                object.insert(
                    "activation_state".to_string(),
                    json!(entry.activation_state.clone()),
                );
                object.insert(
                    "runtime_state".to_string(),
                    json!(entry.runtime_state.clone()),
                );
                object.insert(
                    "search_index_state".to_string(),
                    json!(entry.search_index_state.clone()),
                );
                object.insert("generation".to_string(), json!(entry.generation));
            }
            json!({
                "id": asset_id,
                "name": entry.title,
                "description": description,
                "asset_type": "skill",
                "source_type": entry.source_kind,
                "pkg_name": entry.package_id,
                "restricted": restricted,
                "allowed_roles": allowed_roles,
                "metadata": metadata,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            Vec::new(),
        );

        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0]["id"], json!("cloud.skill.alpha"));
    }

    #[test]
    fn registry_first_mode_keeps_legacy_core_assets_when_registry_has_none() {
        let assets = build_capability_assets_for_read_mode(
            Vec::new(),
            &[],
            CapabilityRegistryReadMode::RegistryFirst,
            vec![json!({
                "id": "core.shell_execute",
                "name": "shell_execute",
                "asset_type": "tool",
                "source_type": "code_mode_core",
            })],
        );

        assert!(assets.iter().any(|asset| {
            asset.get("source_type").and_then(Value::as_str) == Some("code_mode_core")
                && asset.get("name").and_then(Value::as_str) == Some("shell_execute")
        }));
    }

    #[test]
    fn registry_first_mode_dedupes_legacy_core_assets_against_registry_entries() {
        let assets = build_capability_assets_for_read_mode(
            Vec::new(),
            &[LocalCapabilityRegistrySnapshot {
                capability_id: "core.search_sdk".to_string(),
                source_kind: "core".to_string(),
                asset_kind: "core_tool".to_string(),
                package_id: "code_mode.core".to_string(),
                package_version: Some("1".to_string()),
                title: "search_sdk".to_string(),
                description: "Search SDK".to_string(),
                tool_name: Some("search_sdk".to_string()),
                callable_name: None,
                binding_kind: None,
                execution_surface: "host".to_string(),
                runtime: Some("host".to_string()),
                entry_path: None,
                is_direct_callable: true,
                activation_state: "enabled".to_string(),
                runtime_state: "ready".to_string(),
                search_index_state: "not_required".to_string(),
                generation: 1,
                descriptor_json: json!({
                    "tool_name": "search_sdk",
                    "activation_state": "enabled",
                }),
                updated_at: "2026-03-16T00:00:00Z".to_string(),
            }],
            CapabilityRegistryReadMode::RegistryFirst,
            vec![json!({
                "id": "core.search_sdk",
                "name": "search_sdk",
                "asset_type": "tool",
                "source_type": "code_mode_core",
            })],
        );

        assert_eq!(
            assets
                .iter()
                .filter(|asset| asset.get("name").and_then(Value::as_str) == Some("search_sdk"))
                .count(),
            1
        );
    }

    #[test]
    fn capability_asset_match_key_aligns_legacy_and_registry_skill_bundles() {
        let registry_asset =
            local_capability_registry_entry_to_asset(&LocalCapabilityRegistrySnapshot {
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
            });
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
    fn skill_tool_entry_uses_binding_id_and_callable_name() {
        let asset = local_capability_registry_entry_to_asset(&LocalCapabilityRegistrySnapshot {
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
        });

        assert_eq!(asset["id"], json!("skill_binding::skill.alpha::install"));
        assert_eq!(asset["name"], json!("skill.skill.alpha.install"));
        assert_eq!(asset["asset_type"], json!("skill_tool"));
        assert_eq!(asset["metadata"]["skill_id"], json!("skill.alpha"));
    }
}
