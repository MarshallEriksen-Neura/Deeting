use std::collections::HashSet;

#[cfg(test)]
use super::control_plane::full_code_mode_tool_names;
use super::core_tool_contracts::build_core_tool_function_entries;

#[cfg(test)]
pub(crate) fn build_local_code_mode_entry_tools() -> serde_json::Value {
    build_local_code_mode_entry_tools_with_allowlist(&full_code_mode_tool_names(), None)
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
    tools.extend(build_dynamic_direct_capability_tools(
        capability_snapshot,
        &allowlist,
        &tools,
    ));

    if tools.is_empty() {
        None
    } else {
        Some(serde_json::json!({ "tools": tools }))
    }
}

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
    )
    .await
}

fn build_local_execution_lane_aux_tools() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "consult_expert_network",
                "description": "Search expert capabilities by intent query and return top candidates. This tool only searches and does not change reply personality by itself.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "intent_query": { "type": "string", "description": "The intent or task description to search for expert capabilities." },
                        "k": { "type": "integer", "description": "Number of candidates to return.", "default": 3 },
                        "confidence": { "type": "number", "description": "Model confidence in the routing decision (0-1).", "default": 0 }
                    },
                    "required": ["intent_query", "confidence"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "attach_capability",
                "description": "Attach an expert capability explicitly for the current request-scoped agent loop. This augments domain capability without changing reply personality.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "capability_id": { "type": "string", "description": "Capability id returned by consult_expert_network." },
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

fn build_dynamic_direct_capability_tools(
    capability_snapshot: Option<&serde_json::Value>,
    allowlist: &HashSet<String>,
    existing_tools: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    let Some(capabilities) = capability_snapshot
        .and_then(|snapshot| snapshot.get("capabilities"))
        .and_then(serde_json::Value::as_array)
    else {
        return Vec::new();
    };

    let mut existing_names = existing_tools
        .iter()
        .filter_map(function_tool_name)
        .map(|name| name.trim().to_lowercase())
        .collect::<HashSet<_>>();
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
        if !allowlist.contains(&normalized_name) || !existing_names.insert(normalized_name) {
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
                "name": name,
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
}
