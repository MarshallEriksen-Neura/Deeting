use std::collections::HashSet;

use crate::modules::custom_task_agents::skill_actions::sanitize_callable_name;

const DYNAMIC_CAPABILITY_ALIAS_PREFIX: &str = "cap_";

fn is_provider_safe_tool_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn stable_tool_name_hash(name: &str) -> u32 {
    let mut hash = 0x811c9dc5u32;
    for byte in name.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

pub(crate) fn dynamic_capability_alias(name: &str) -> String {
    let sanitized = sanitize_callable_name(name).trim().to_ascii_lowercase();
    let stem = if sanitized.is_empty() {
        "tool"
    } else {
        sanitized.as_str()
    };
    format!(
        "{DYNAMIC_CAPABILITY_ALIAS_PREFIX}{stem}_{:08x}",
        stable_tool_name_hash(name.trim())
    )
}

pub(crate) fn direct_capability_requires_alias(
    name: &str,
    reserved_names: &HashSet<String>,
) -> bool {
    let normalized = name.trim().to_lowercase();
    normalized.is_empty()
        || !is_provider_safe_tool_name(name)
        || reserved_names.contains(&normalized)
}

pub(crate) fn resolve_dynamic_direct_capability_tool_name(
    provider_tool_name: &str,
    capability_snapshot: Option<&serde_json::Value>,
    reserved_names: &HashSet<String>,
) -> Option<String> {
    let requested = provider_tool_name.trim().to_lowercase();
    if requested.is_empty() {
        return None;
    }

    let capabilities = capability_snapshot
        .and_then(|snapshot| snapshot.get("capabilities"))
        .and_then(serde_json::Value::as_array)?;

    for capability in capabilities {
        let callable = capability
            .pointer("/status/callable")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let invocation_mode = capability
            .get("invocation_mode")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if !callable || invocation_mode != "direct" {
            continue;
        }
        let Some(canonical_name) = capability
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| name.to_lowercase())
        else {
            continue;
        };
        if !direct_capability_requires_alias(&canonical_name, reserved_names) {
            continue;
        }
        if dynamic_capability_alias(&canonical_name) == requested {
            return Some(canonical_name);
        }
    }

    None
}

pub(crate) fn build_dynamic_direct_capability_tools(
    capability_snapshot: Option<&serde_json::Value>,
    allowlist: &HashSet<String>,
    existing_tool_names: &HashSet<String>,
    reserved_names: &HashSet<String>,
) -> Vec<serde_json::Value> {
    let Some(capabilities) = capability_snapshot
        .and_then(|snapshot| snapshot.get("capabilities"))
        .and_then(serde_json::Value::as_array)
    else {
        return Vec::new();
    };

    let mut existing_names = existing_tool_names.clone();
    existing_names.extend(reserved_names.iter().cloned());
    let mut direct_tools = Vec::new();

    for capability in capabilities {
        let callable = capability
            .pointer("/status/callable")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let invocation_mode = capability
            .get("invocation_mode")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if !callable || invocation_mode != "direct" {
            continue;
        }
        let Some(name) = capability
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
        else {
            continue;
        };
        let normalized_name = name.to_lowercase();
        if !allowlist.contains(&normalized_name) {
            continue;
        }
        let provider_tool_name = if direct_capability_requires_alias(name, reserved_names) {
            dynamic_capability_alias(&normalized_name)
        } else {
            name.to_string()
        };
        if !existing_names.insert(provider_tool_name.to_lowercase()) {
            continue;
        }
        let description = capability
            .get("description")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Direct callable capability discovered by search_sdk.");
        let parameters = capability
            .get("input_schema")
            .cloned()
            .filter(|value| value.is_object())
            .unwrap_or_else(|| serde_json::json!({"type":"object","properties":{}}));
        direct_tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": provider_tool_name,
                "description": description,
                "parameters": parameters
            }
        }));
    }

    direct_tools
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_dynamic_direct_capability_tools_aliases_invalid_names() {
        let allowlist = HashSet::from(["skill.official.skills.weather.get_weather".to_string()]);
        let reserved_names = HashSet::new();
        let tools = build_dynamic_direct_capability_tools(
            Some(&serde_json::json!({
                "capabilities": [
                    {
                        "name": "skill.official.skills.weather.get_weather",
                        "description": "Fetch weather forecast",
                        "invocation_mode": "direct",
                        "status": {"callable": true},
                        "input_schema": {
                            "type": "object",
                            "properties": {
                                "city": {"type": "string"}
                            },
                            "required": ["city"]
                        }
                    }
                ]
            })),
            &allowlist,
            &HashSet::new(),
            &reserved_names,
        );

        let provider_name = tools[0]["function"]["name"].as_str().expect("tool name");
        assert_ne!(provider_name, "skill.official.skills.weather.get_weather");
        assert!(provider_name.starts_with("cap_"));
    }

    #[test]
    fn resolve_dynamic_direct_capability_tool_name_maps_alias_back_to_canonical() {
        let canonical_name = "skill.official.skills.weather.get_weather";
        let resolved = resolve_dynamic_direct_capability_tool_name(
            &dynamic_capability_alias(canonical_name),
            Some(&serde_json::json!({
                "capabilities": [
                    {
                        "name": canonical_name,
                        "invocation_mode": "direct",
                        "status": {"callable": true}
                    }
                ]
            })),
            &HashSet::new(),
        );

        assert_eq!(resolved.as_deref(), Some(canonical_name));
    }
}
