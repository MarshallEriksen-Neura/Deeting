use std::collections::HashSet;

pub(crate) use super::capability_toolset::dynamic_capability_alias;
use super::capability_toolset::{
    build_dynamic_direct_capability_tools,
    resolve_dynamic_direct_capability_tool_name as resolve_dynamic_direct_capability_tool_name_inner,
};
use crate::modules::code_mode::core_tool_contracts::build_core_tool_function_entries;
#[cfg(test)]
use mcp_runtime::policy::full_execution_tool_names;

#[cfg(test)]
pub(crate) fn build_local_runtime_tools() -> serde_json::Value {
    build_local_runtime_tools_with_allowlist(&full_execution_tool_names(), None)
        .unwrap_or_else(|| serde_json::json!({ "tools": [] }))
}

pub(crate) fn build_local_runtime_tools_with_allowlist(
    allowed_tool_names: &[String],
    capability_snapshot: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let allowlist: HashSet<String> = allowed_tool_names
        .iter()
        .map(|name| name.trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .collect();
    let mut used_provider_tool_names = HashSet::new();
    let mut tools = build_core_tool_function_entries()
        .into_iter()
        .filter_map(|tool| {
            let canonical_name = function_tool_name(&tool)
                .map(|name| name.trim().to_lowercase())
                .filter(|name| !name.is_empty())?;
            if !allowlist.contains(&canonical_name) {
                return None;
            }
            alias_tool_definition_for_provider(tool, &mut used_provider_tool_names)
        })
        .collect::<Vec<_>>();
    let reserved_names = reserved_local_execution_tool_names();
    let existing_tool_names = used_provider_tool_names;
    tools.extend(build_dynamic_direct_capability_tools(
        capability_snapshot,
        &allowlist,
        &existing_tool_names,
        &reserved_names,
    ));

    if tools.is_empty() {
        None
    } else {
        Some(serde_json::json!({ "tools": tools }))
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn build_local_sdk_search_result_with_runtime(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query: &str,
    limit: usize,
) -> serde_json::Value {
    crate::modules::capability_control_plane::build_search_sdk_result(
        mcp_store,
        embedding_service,
        memory_store,
        query,
        limit,
        super::capability_discovery::SearchSdkDetailLevel::Summary,
    )
    .await
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn build_local_sdk_search_result_with_runtime_full(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query: &str,
    limit: usize,
) -> serde_json::Value {
    crate::modules::capability_control_plane::build_search_sdk_result(
        mcp_store,
        embedding_service,
        memory_store,
        query,
        limit,
        super::capability_discovery::SearchSdkDetailLevel::Full,
    )
    .await
}

pub(crate) async fn build_local_sdk_search_result_bundle_with_feedback_runtime(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query: &str,
    limit: usize,
    feedback_context: &crate::modules::desktop_runtime::runtime::search_feedback::SearchFeedbackContext,
) -> crate::modules::capability_control_plane::CapabilitySearchResultBundle {
    crate::modules::capability_control_plane::build_search_sdk_result_bundle_with_feedback(
        mcp_store,
        embedding_service,
        memory_store,
        query,
        limit,
        feedback_context,
    )
    .await
}

fn function_tool_name(tool: &serde_json::Value) -> Option<&str> {
    tool.get("function")?.get("name")?.as_str()
}

fn is_provider_safe_tool_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn provider_safe_tool_name_for_callable(canonical_name: &str) -> String {
    let normalized = canonical_name.trim().to_lowercase();
    if is_provider_safe_tool_name(&normalized) {
        normalized
    } else {
        dynamic_capability_alias(&normalized)
    }
}

fn alias_tool_definition_for_provider(
    mut tool: serde_json::Value,
    used_provider_tool_names: &mut HashSet<String>,
) -> Option<serde_json::Value> {
    let canonical_name = function_tool_name(&tool)
        .map(|name| name.trim().to_lowercase())
        .filter(|name| !name.is_empty())?;
    let provider_tool_name = provider_safe_tool_name_for_callable(&canonical_name);
    if !used_provider_tool_names.insert(provider_tool_name.to_lowercase()) {
        return None;
    }
    let function_obj = tool.get_mut("function")?.as_object_mut()?;
    function_obj.insert(
        "name".to_string(),
        serde_json::Value::String(provider_tool_name),
    );
    Some(tool)
}

fn reserved_local_execution_tool_names() -> HashSet<String> {
    let mut reserved = build_core_tool_function_entries()
        .into_iter()
        .filter_map(|tool| function_tool_name(&tool).map(|name| name.trim().to_lowercase()))
        .filter(|name| !name.is_empty())
        .collect::<HashSet<_>>();
    reserved
}

pub(crate) fn resolve_dynamic_direct_capability_tool_name(
    provider_tool_name: &str,
    capability_snapshot: Option<&serde_json::Value>,
) -> Option<String> {
    let reserved_names = reserved_local_execution_tool_names();
    resolve_dynamic_direct_capability_tool_name_inner(
        provider_tool_name,
        capability_snapshot,
        &reserved_names,
    )
}

pub(crate) fn resolve_provider_tool_name_for_execution(
    provider_tool_name: &str,
    allowed_tool_names: &[String],
    capability_snapshot: Option<&serde_json::Value>,
) -> Option<String> {
    let requested = provider_tool_name.trim().to_lowercase();
    if requested.is_empty() {
        return None;
    }

    if let Some(canonical_name) =
        resolve_dynamic_direct_capability_tool_name(&requested, capability_snapshot)
    {
        return Some(canonical_name);
    }

    if allowed_tool_names.iter().any(|item| item == &requested) {
        return Some(requested);
    }

    allowed_tool_names
        .iter()
        .map(|name| name.trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .find(|name| provider_safe_tool_name_for_callable(name) == requested)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_local_runtime_tools_with_allowlist_filters_tools() {
        let payload = build_local_runtime_tools_with_allowlist(
            &["search_sdk".to_string()],
            None,
        )
        .expect("tool payload");

        let tools = payload
            .get("tools")
            .and_then(serde_json::Value::as_array)
            .expect("tools array");
        let names = tools
            .iter()
            .filter_map(function_tool_name)
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["search_sdk"]);
    }

    #[test]
    fn build_local_runtime_tools_with_allowlist_includes_direct_capability_tools() {
        let payload = build_local_runtime_tools_with_allowlist(
            &["weather_lookup".to_string(), "search_sdk".to_string()],
            Some(&serde_json::json!({
                "capabilities": [
                    {
                        "name": "weather_lookup",
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
        )
        .expect("tool payload");

        let tools = payload
            .get("tools")
            .and_then(serde_json::Value::as_array)
            .expect("tools array");
        let names = tools
            .iter()
            .filter_map(function_tool_name)
            .collect::<Vec<_>>();
        assert!(names.contains(&"search_sdk"));
        assert!(names.contains(&"weather_lookup"));
    }

    #[test]
    fn build_local_runtime_tools_aliases_invalid_direct_capability_names() {
        let payload = build_local_runtime_tools_with_allowlist(
            &[
                "skill.official.skills.weather.get_weather".to_string(),
                "search_sdk".to_string(),
            ],
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
        )
        .expect("tool payload");

        let tools = payload
            .get("tools")
            .and_then(serde_json::Value::as_array)
            .expect("tools array");
        let weather_tool = tools
            .iter()
            .find(|tool| {
                function_tool_name(tool)
                    .map(|name| name != "search_sdk")
                    .unwrap_or(false)
            })
            .expect("direct capability tool");
        let provider_name = function_tool_name(weather_tool).expect("tool name");

        assert_ne!(provider_name, "skill.official.skills.weather.get_weather");
        assert!(provider_name.starts_with("cap_"));
        assert!(provider_name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'));
    }

    #[test]
    fn build_local_runtime_tools_aliases_invalid_core_tool_names() {
        let payload =
            build_local_runtime_tools_with_allowlist(&["monitor.create".to_string()], None)
                .expect("tool payload");

        let tools = payload
            .get("tools")
            .and_then(serde_json::Value::as_array)
            .expect("tools array");
        let names = tools
            .iter()
            .filter_map(function_tool_name)
            .collect::<Vec<_>>();

        assert_eq!(names.len(), 1);
        assert_ne!(names[0], "monitor.create");
        assert!(names[0]
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'));
    }

    #[test]
    fn resolve_provider_tool_name_for_execution_maps_alias_back_to_core_tool_name() {
        let resolved = resolve_provider_tool_name_for_execution(
            &dynamic_capability_alias("monitor.create"),
            &["monitor.create".to_string()],
            None,
        );

        assert_eq!(resolved.as_deref(), Some("monitor.create"));
    }
}
