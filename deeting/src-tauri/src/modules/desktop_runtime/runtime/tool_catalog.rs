use std::collections::HashSet;

pub(crate) use super::capability_toolset::dynamic_capability_alias;
use super::capability_toolset::{
    build_dynamic_direct_capability_tools,
    resolve_dynamic_direct_capability_tool_name as resolve_dynamic_direct_capability_tool_name_inner,
};
use crate::modules::code_mode::core_tool_contracts::build_core_tool_function_entries;
#[cfg(test)]
use mcp_runtime::policy::full_execution_tool_names;
use mcp_runtime::policy::{
    DELEGATIONS_STATUS_TOOL_NAME, START_DELEGATE_AGENT_TOOL_NAME, START_DELEGATE_MANY_TOOL_NAME,
    STOP_DELEGATIONS_TOOL_NAME, WAIT_DELEGATIONS_TOOL_NAME,
};

pub(crate) const WORLD_MODEL_UPDATE_TOOL_NAME: &str = "world_model_update";
const ALWAYS_AVAILABLE_BOOTSTRAP_TOOL_NAMES: &[&str] = &[
    "search_sdk",
    "get_tool_schema",
    "query_task_policy",
    "activate_skill",
    "read_skill_resource",
];

const DELEGATION_START_TOOL_NAMES: &[&str] = &[
    START_DELEGATE_AGENT_TOOL_NAME,
    START_DELEGATE_MANY_TOOL_NAME,
];
const DELEGATION_JOIN_COMPANION_TOOL_NAMES: &[&str] =
    &[DELEGATIONS_STATUS_TOOL_NAME, WAIT_DELEGATIONS_TOOL_NAME];
const DELEGATION_CANCEL_COMPANION_TOOL_NAMES: &[&str] = &[STOP_DELEGATIONS_TOOL_NAME];

const BROWSER_OBSERVATION_COMPANION_TOOL_NAMES: &[&str] = &[
    "browser_agent_status",
    "browser_get_active_page",
    "browser_get_page_snapshot",
    "browser_find_element",
    "browser_extract",
    "browser_wait",
    "browser_wait_for_element",
    "browser_wait_for_navigation",
    "browser_region_screenshot",
    "browser_full_page_screenshot",
    "browser_console_log",
    "browser_network_log",
    "browser_storage_read",
    "browser_downloads",
    "browser_accessibility_audit",
];

#[derive(Clone, Debug)]
pub(crate) struct LocalRuntimeToolAvailability {
    tool_names: HashSet<String>,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct LocalRuntimeToolAvailabilityOptions {
    pub(crate) include_bootstrap_tools: bool,
    pub(crate) include_delegation_companion_tools: bool,
}

impl LocalRuntimeToolAvailability {
    pub(crate) fn contains(&self, tool_name: &str) -> bool {
        normalize_tool_name(tool_name).is_some_and(|name| self.tool_names.contains(&name))
    }

    fn as_set(&self) -> &HashSet<String> {
        &self.tool_names
    }
}

pub(crate) fn is_always_available_bootstrap_tool(tool_name: &str) -> bool {
    let normalized = tool_name.trim();
    ALWAYS_AVAILABLE_BOOTSTRAP_TOOL_NAMES
        .iter()
        .any(|name| normalized.eq_ignore_ascii_case(name))
}

fn normalize_tool_name(tool_name: &str) -> Option<String> {
    let normalized = tool_name.trim().to_lowercase();
    (!normalized.is_empty()).then_some(normalized)
}

pub(crate) fn resolve_local_runtime_tool_availability(
    allowed_tool_names: &[String],
    include_bootstrap_tools: bool,
) -> LocalRuntimeToolAvailability {
    resolve_local_runtime_tool_availability_with_options(
        allowed_tool_names,
        LocalRuntimeToolAvailabilityOptions {
            include_bootstrap_tools,
            include_delegation_companion_tools: false,
        },
    )
}

pub(crate) fn resolve_local_runtime_tool_availability_with_options(
    allowed_tool_names: &[String],
    options: LocalRuntimeToolAvailabilityOptions,
) -> LocalRuntimeToolAvailability {
    let mut tool_names = allowed_tool_names
        .iter()
        .filter_map(|name| normalize_tool_name(name))
        .filter(|name| !is_always_available_bootstrap_tool(name))
        .collect::<HashSet<_>>();

    tool_names.insert(WORLD_MODEL_UPDATE_TOOL_NAME.to_string());

    if options.include_bootstrap_tools {
        extend_tool_names(&mut tool_names, ALWAYS_AVAILABLE_BOOTSTRAP_TOOL_NAMES);
    }

    apply_required_companion_tool_closure(&mut tool_names, options);

    LocalRuntimeToolAvailability { tool_names }
}

fn extend_tool_names(tool_names: &mut HashSet<String>, names: &[&str]) {
    for name in names {
        if let Some(normalized) = normalize_tool_name(name) {
            tool_names.insert(normalized);
        }
    }
}

fn apply_required_companion_tool_closure(
    tool_names: &mut HashSet<String>,
    options: LocalRuntimeToolAvailabilityOptions,
) {
    if options.include_delegation_companion_tools
        || DELEGATION_START_TOOL_NAMES
            .iter()
            .any(|name| tool_names.contains(*name))
    {
        extend_tool_names(tool_names, DELEGATION_JOIN_COMPANION_TOOL_NAMES);
        extend_tool_names(tool_names, DELEGATION_CANCEL_COMPANION_TOOL_NAMES);
    }

    if tool_names.iter().any(|name| name.starts_with("browser_")) {
        extend_tool_names(tool_names, BROWSER_OBSERVATION_COMPANION_TOOL_NAMES);
    }
}

#[cfg(test)]
pub(crate) fn build_local_runtime_tools() -> serde_json::Value {
    build_local_runtime_tools_with_allowlist(&full_execution_tool_names(), None, true)
        .unwrap_or_else(|| serde_json::json!({ "tools": [] }))
}

pub(crate) fn build_local_runtime_tools_with_allowlist(
    allowed_tool_names: &[String],
    capability_snapshot: Option<&serde_json::Value>,
    include_bootstrap_tools: bool,
) -> Option<serde_json::Value> {
    let availability =
        resolve_local_runtime_tool_availability(allowed_tool_names, include_bootstrap_tools);
    let mut used_provider_tool_names = HashSet::new();
    let mut tools = build_core_tool_function_entries()
        .into_iter()
        .filter_map(|tool| {
            let canonical_name = function_tool_name(&tool)
                .map(|name| name.trim().to_lowercase())
                .filter(|name| !name.is_empty())?;
            if !availability.contains(&canonical_name) {
                return None;
            }
            alias_tool_definition_for_provider(tool, &mut used_provider_tool_names)
        })
        .collect::<Vec<_>>();
    let reserved_names = reserved_local_execution_tool_names();
    let existing_tool_names = used_provider_tool_names;
    tools.extend(build_dynamic_direct_capability_tools(
        capability_snapshot,
        availability.as_set(),
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
    build_core_tool_function_entries()
        .into_iter()
        .filter_map(|tool| function_tool_name(&tool).map(|name| name.trim().to_lowercase()))
        .filter(|name| !name.is_empty())
        .collect::<HashSet<_>>()
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
    include_bootstrap_tools: bool,
) -> Option<String> {
    let requested = provider_tool_name.trim().to_lowercase();
    if requested.is_empty() {
        return None;
    }
    let availability =
        resolve_local_runtime_tool_availability(allowed_tool_names, include_bootstrap_tools);

    if let Some(canonical_name) =
        resolve_dynamic_direct_capability_tool_name(&requested, capability_snapshot)
    {
        return Some(canonical_name);
    }

    if availability.contains(&requested) {
        return Some(requested);
    }

    availability
        .as_set()
        .iter()
        .find(|name| provider_safe_tool_name_for_callable(name) == requested)
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_local_runtime_tools_with_allowlist_filters_tools() {
        let payload =
            build_local_runtime_tools_with_allowlist(&["search_sdk".to_string()], None, false)
                .expect("tool payload");

        let tools = payload
            .get("tools")
            .and_then(serde_json::Value::as_array)
            .expect("tools array");
        let names = tools
            .iter()
            .filter_map(function_tool_name)
            .collect::<Vec<_>>();

        assert_eq!(names, vec![WORLD_MODEL_UPDATE_TOOL_NAME]);
    }

    #[test]
    fn build_local_runtime_tools_with_allowlist_includes_bootstrap_tools_when_requested() {
        let payload =
            build_local_runtime_tools_with_allowlist(&[], None, true).expect("tool payload");

        let tools = payload
            .get("tools")
            .and_then(serde_json::Value::as_array)
            .expect("tools array");
        let names = tools
            .iter()
            .filter_map(function_tool_name)
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "search_sdk",
                "query_task_policy",
                "get_tool_schema",
                "activate_skill",
                "read_skill_resource",
                WORLD_MODEL_UPDATE_TOOL_NAME,
            ]
        );
        assert!(!names.contains(&"refresh_skill_index"));
        assert!(!names.contains(&"execute_code_plan"));
        assert!(!names.contains(&"shell_execute"));
    }

    #[test]
    fn build_local_runtime_tools_with_allowlist_omits_bootstrap_tools_after_first_round() {
        let payload =
            build_local_runtime_tools_with_allowlist(&[], None, false).expect("tool payload");

        let tools = payload
            .get("tools")
            .and_then(serde_json::Value::as_array)
            .expect("tools array");
        let names = tools
            .iter()
            .filter_map(function_tool_name)
            .collect::<Vec<_>>();

        assert_eq!(names, vec![WORLD_MODEL_UPDATE_TOOL_NAME]);
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
            false,
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
        assert!(!names.contains(&"search_sdk"));
        assert!(names.contains(&WORLD_MODEL_UPDATE_TOOL_NAME));
        assert!(names.contains(&"weather_lookup"));
    }

    #[test]
    fn build_local_runtime_tools_with_allowlist_adds_delegation_companion_tools() {
        let payload = build_local_runtime_tools_with_allowlist(
            &[START_DELEGATE_AGENT_TOOL_NAME.to_string()],
            None,
            false,
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

        assert!(names.contains(&START_DELEGATE_AGENT_TOOL_NAME));
        assert!(names.contains(&DELEGATIONS_STATUS_TOOL_NAME));
        assert!(names.contains(&WAIT_DELEGATIONS_TOOL_NAME));
        assert!(names.contains(&STOP_DELEGATIONS_TOOL_NAME));
    }

    #[test]
    fn build_local_runtime_tools_with_allowlist_adds_browser_observation_companions() {
        let payload =
            build_local_runtime_tools_with_allowlist(&["browser_fill".to_string()], None, false)
                .expect("tool payload");

        let tools = payload
            .get("tools")
            .and_then(serde_json::Value::as_array)
            .expect("tools array");
        let names = tools
            .iter()
            .filter_map(function_tool_name)
            .collect::<Vec<_>>();

        assert!(names.contains(&"browser_fill"));
        assert!(names.contains(&"browser_agent_status"));
        assert!(names.contains(&"browser_get_active_page"));
        assert!(names.contains(&"browser_get_page_snapshot"));
        assert!(names.contains(&"browser_wait"));
        assert!(!names.contains(&"browser_storage_write"));
        assert!(!names.contains(&"browser_eval"));
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
            false,
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
                    .map(|name| name.starts_with("cap_"))
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
            build_local_runtime_tools_with_allowlist(&["monitor.create".to_string()], None, false)
                .expect("tool payload");

        let tools = payload
            .get("tools")
            .and_then(serde_json::Value::as_array)
            .expect("tools array");
        let names = tools
            .iter()
            .filter_map(function_tool_name)
            .collect::<Vec<_>>();

        assert_eq!(names.len(), 2);
        assert!(names.contains(&WORLD_MODEL_UPDATE_TOOL_NAME));
        let monitor_alias = names
            .iter()
            .find(|name| **name != WORLD_MODEL_UPDATE_TOOL_NAME)
            .expect("monitor alias");
        assert_ne!(*monitor_alias, "monitor.create");
        assert!(monitor_alias
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'));
    }

    #[test]
    fn resolve_provider_tool_name_for_execution_maps_alias_back_to_core_tool_name() {
        let resolved = resolve_provider_tool_name_for_execution(
            &dynamic_capability_alias("monitor.create"),
            &["monitor.create".to_string()],
            None,
            false,
        );

        assert_eq!(resolved.as_deref(), Some("monitor.create"));
    }

    #[test]
    fn resolve_provider_tool_name_for_execution_allows_world_model_update_without_policy_entry() {
        let resolved = resolve_provider_tool_name_for_execution(
            WORLD_MODEL_UPDATE_TOOL_NAME,
            &[],
            None,
            false,
        );

        assert_eq!(resolved.as_deref(), Some(WORLD_MODEL_UPDATE_TOOL_NAME));
    }

    #[test]
    fn resolve_provider_tool_name_for_execution_allows_bootstrap_tools_on_first_round_only() {
        for tool_name in ALWAYS_AVAILABLE_BOOTSTRAP_TOOL_NAMES {
            let resolved = resolve_provider_tool_name_for_execution(tool_name, &[], None, true);

            assert_eq!(resolved.as_deref(), Some(*tool_name));
            assert_eq!(
                resolve_provider_tool_name_for_execution(tool_name, &[], None, false),
                None
            );
        }
        assert_eq!(
            resolve_provider_tool_name_for_execution("refresh_skill_index", &[], None, true),
            None
        );
    }

    #[test]
    fn resolve_local_runtime_tool_availability_can_force_delegation_companion_tools() {
        let availability = resolve_local_runtime_tool_availability_with_options(
            &[],
            LocalRuntimeToolAvailabilityOptions {
                include_bootstrap_tools: false,
                include_delegation_companion_tools: true,
            },
        );

        assert!(availability.contains(DELEGATIONS_STATUS_TOOL_NAME));
        assert!(availability.contains(WAIT_DELEGATIONS_TOOL_NAME));
        assert!(availability.contains(STOP_DELEGATIONS_TOOL_NAME));
        assert!(!availability.contains(START_DELEGATE_AGENT_TOOL_NAME));
    }
}
