use std::collections::HashSet;

#[cfg(test)]
pub(crate) use super::capability_toolset::dynamic_capability_alias;
use super::capability_toolset::{
    build_dynamic_direct_capability_tools,
    resolve_dynamic_direct_capability_tool_name as resolve_dynamic_direct_capability_tool_name_inner,
};
use crate::modules::code_mode::core_tool_contracts::build_core_tool_function_entries;
#[cfg(test)]
use mcp_runtime::policy::full_execution_tool_names;

#[cfg(test)]
pub(crate) fn build_local_code_mode_entry_tools() -> serde_json::Value {
    build_local_code_mode_entry_tools_with_allowlist(&full_execution_tool_names(), None)
        .unwrap_or_else(|| serde_json::json!({ "tools": [] }))
}

pub(crate) fn build_local_code_mode_entry_tools_with_allowlist(
    allowed_tool_names: &[String],
    capability_snapshot: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let allowlist: HashSet<String> = allowed_tool_names
        .iter()
        .map(|name| name.trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .collect();
    let mut tools = build_core_tool_function_entries()
        .into_iter()
        .filter(|tool| {
            function_tool_name(tool)
                .map(|name| allowlist.contains(&name.to_lowercase()))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    tools.extend(
        build_local_execution_lane_aux_tools()
            .into_iter()
            .filter(|tool| {
                function_tool_name(tool)
                    .map(|name| allowlist.contains(&name.to_lowercase()))
                    .unwrap_or(false)
            }),
    );
    let reserved_names = reserved_local_execution_tool_names();
    let existing_tool_names = tools
        .iter()
        .filter_map(function_tool_name)
        .map(|name| name.trim().to_lowercase())
        .collect::<HashSet<_>>();
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

fn build_local_execution_lane_aux_tools() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "attach_capability",
                "description": "Attach an expert capability explicitly for the current request-scoped agent loop. This augments domain capability without changing reply personality.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "capability_id": { "type": "string", "description": "Capability id discovered from search_sdk or other capability lookup surfaces." },
                        "reason": { "type": "string", "description": "Optional reason for the capability attachment decision." }
                    },
                    "required": ["capability_id"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "detach_capability",
                "description": "Detach the current request-scoped expert capability and return to the default capability-neutral context.",
                "parameters": { "type": "object", "properties": { "reason": { "type": "string", "description": "Optional reason for the capability detachment." } } }
            }
        }),
    ]
}

fn function_tool_name(tool: &serde_json::Value) -> Option<&str> {
    tool.get("function")?.get("name")?.as_str()
}

fn reserved_local_execution_tool_names() -> HashSet<String> {
    let mut reserved = build_core_tool_function_entries()
        .into_iter()
        .filter_map(|tool| function_tool_name(&tool).map(|name| name.trim().to_lowercase()))
        .filter(|name| !name.is_empty())
        .collect::<HashSet<_>>();
    reserved.extend(
        build_local_execution_lane_aux_tools()
            .into_iter()
            .filter_map(|tool| function_tool_name(&tool).map(|name| name.trim().to_lowercase()))
            .filter(|name| !name.is_empty()),
    );
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_local_code_mode_entry_tools_with_allowlist_filters_tools() {
        let payload = build_local_code_mode_entry_tools_with_allowlist(
            &["search_sdk".to_string(), "attach_capability".to_string()],
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

        assert_eq!(names, vec!["search_sdk", "attach_capability"]);
    }

    #[test]
    fn build_local_code_mode_entry_tools_with_allowlist_includes_direct_capability_tools() {
        let payload = build_local_code_mode_entry_tools_with_allowlist(
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
    fn build_local_code_mode_entry_tools_aliases_invalid_direct_capability_names() {
        let payload = build_local_code_mode_entry_tools_with_allowlist(
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
}
