use std::collections::{HashMap, HashSet};

use mcp_core::types::McpTool;
use serde_json::{json, Value};

use crate::modules::desktop_runtime::runtime::capability_toolset::{
    dynamic_capability_alias, is_provider_safe_tool_name, PROVIDER_MAX_TOOL_NAME_LEN,
};

use super::skill_actions::ResolvedSkillAction;

#[derive(Debug, Clone)]
pub(super) struct BuiltinCallableDefinition {
    pub(super) callable_name: String,
    pub(super) description: String,
    pub(super) parameters: Value,
    pub(super) lane: BoundCallableLane,
}

/// Provider-visible callable projected back into the custom-task-agent runtime.
///
/// Bound callable names come from runtime truth, not from provider-safe naming rules.
/// MCP tools and skill actions may contain dots, spaces, or other characters that are
/// valid locally but rejected by upstream tool-schema validators. This module is the
/// single place that projects those runtime names into provider-safe aliases and then
/// resolves model-returned tool calls back to the original callable name.
#[derive(Debug, Clone)]
pub(super) struct BoundCallable {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) lane: BoundCallableLane,
    pub(super) arguments: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum BoundCallableLane {
    McpTool,
    SkillAction,
    BuiltinAction,
    Unknown,
}

#[derive(Debug, Clone)]
struct BoundCallableBinding {
    callable_name: String,
    lane: BoundCallableLane,
}

#[derive(Debug, Default)]
pub(super) struct BoundCallablePayload {
    tool_payload: Option<Value>,
    bindings_by_provider_name: HashMap<String, BoundCallableBinding>,
}

impl BoundCallablePayload {
    pub(super) fn build(
        mcp_tools: &HashMap<String, McpTool>,
        skill_actions: &HashMap<String, ResolvedSkillAction>,
        builtin_callables: &[BuiltinCallableDefinition],
    ) -> Self {
        let mut entries = Vec::new();
        let mut bindings_by_provider_name = HashMap::new();
        let mut used_provider_names = HashSet::new();

        for tool in mcp_tools.values() {
            let Some(config_value) = serde_json::from_str::<Value>(&tool.config_json).ok() else {
                continue;
            };
            let input_schema = config_value
                .get("input_schema")
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
            push_bound_callable_entry(
                &mut entries,
                &mut bindings_by_provider_name,
                &mut used_provider_names,
                tool.name.as_str(),
                BoundCallableLane::McpTool,
                tool.description.clone(),
                input_schema,
            );
        }

        for action in skill_actions.values() {
            push_bound_callable_entry(
                &mut entries,
                &mut bindings_by_provider_name,
                &mut used_provider_names,
                action.callable_name.as_str(),
                BoundCallableLane::SkillAction,
                format!(
                    "[Skill Action] {} (skill={}, action={}, runtime={})",
                    action.description, action.skill_id, action.action_id, action.runtime
                ),
                action
                    .input_schema
                    .clone()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
            );
        }

        for builtin in builtin_callables {
            push_bound_callable_entry(
                &mut entries,
                &mut bindings_by_provider_name,
                &mut used_provider_names,
                builtin.callable_name.as_str(),
                builtin.lane,
                builtin.description.clone(),
                builtin.parameters.clone(),
            );
        }

        Self {
            tool_payload: if entries.is_empty() {
                None
            } else {
                Some(json!({ "tools": entries }))
            },
            bindings_by_provider_name,
        }
    }

    pub(super) fn tool_payload(&self) -> Option<Value> {
        self.tool_payload.clone()
    }

    pub(super) fn parse_tool_calls(&self, response: &Value) -> Vec<BoundCallable> {
        response
            .get("tool_calls")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let provider_name =
                            item.get("name").and_then(Value::as_str)?.trim().to_string();
                        if provider_name.is_empty() {
                            return None;
                        }
                        let binding = self
                            .bindings_by_provider_name
                            .get(&provider_name.to_ascii_lowercase())
                            .cloned();
                        Some(BoundCallable {
                            id: item
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                            name: binding
                                .as_ref()
                                .map(|value| value.callable_name.clone())
                                .unwrap_or(provider_name),
                            lane: binding
                                .as_ref()
                                .map(|value| value.lane)
                                .unwrap_or(BoundCallableLane::Unknown),
                            arguments: item.get("arguments").cloned().unwrap_or_else(|| json!({})),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    }
}

fn with_provider_suffix(base: &str, suffix: &str) -> String {
    let max_base_len = PROVIDER_MAX_TOOL_NAME_LEN.saturating_sub(suffix.len());
    let truncated_base = if base.len() > max_base_len {
        &base[..max_base_len]
    } else {
        base
    };
    format!("{truncated_base}{suffix}")
}

fn reserve_provider_callable_name(
    callable_name: &str,
    used_provider_names: &mut HashSet<String>,
) -> String {
    let trimmed = callable_name.trim();
    let base_candidate = if is_provider_safe_tool_name(trimmed) {
        trimmed.to_string()
    } else {
        dynamic_capability_alias(trimmed)
    };
    let mut candidate = if base_candidate.is_empty() {
        dynamic_capability_alias(trimmed)
    } else {
        base_candidate.clone()
    };
    let mut suffix = 2usize;
    while !used_provider_names.insert(candidate.to_ascii_lowercase()) {
        candidate = with_provider_suffix(&base_candidate, &format!("_{suffix}"));
        suffix += 1;
    }
    candidate
}

fn push_bound_callable_entry(
    entries: &mut Vec<Value>,
    bindings_by_provider_name: &mut HashMap<String, BoundCallableBinding>,
    used_provider_names: &mut HashSet<String>,
    callable_name: &str,
    lane: BoundCallableLane,
    description: String,
    parameters: Value,
) {
    // The provider-facing name is only a transport alias. Execution still resolves by
    // the original callable name so runtime behavior stays stable.
    let provider_name = reserve_provider_callable_name(callable_name, used_provider_names);
    bindings_by_provider_name.insert(
        provider_name.to_ascii_lowercase(),
        BoundCallableBinding {
            callable_name: callable_name.to_string(),
            lane,
        },
    );
    entries.push(json!({
        "type": "function",
        "function": {
            "name": provider_name,
            "description": description,
            "parameters": parameters,
        }
    }));
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;

    use mcp_core::types::{McpConflictStatus, McpSourceType, McpTool, McpToolStatus};
    use serde_json::{json, Value};

    use super::{BoundCallableLane, BoundCallablePayload, BuiltinCallableDefinition};
    use crate::modules::custom_task_agents::skill_actions::ResolvedSkillAction;
    use crate::modules::desktop_runtime::runtime::capability_toolset::{
        dynamic_capability_alias, PROVIDER_MAX_TOOL_NAME_LEN,
    };

    fn sample_mcp_tool(name: &str) -> McpTool {
        McpTool {
            id: format!("tool-{name}"),
            identifier: None,
            name: name.to_string(),
            service_key: None,
            service_display_name: None,
            service_description: None,
            source_type: McpSourceType::Local,
            source_id: Some("local".to_string()),
            status: McpToolStatus::Healthy,
            ping_ms: None,
            capabilities: vec!["network".to_string()],
            description: format!("Tool {name}"),
            error: None,
            command: None,
            args: None,
            env: None,
            pending_config_json: None,
            config_json:
                r#"{"input_schema":{"type":"object","properties":{"query":{"type":"string"}}}}"#
                    .to_string(),
            config_hash: "hash".to_string(),
            pending_config_hash: None,
            conflict_status: McpConflictStatus::None,
            is_read_only: true,
            is_new: false,
            created_at: "2026-03-13T00:00:00Z".to_string(),
            updated_at: "2026-03-13T00:00:00Z".to_string(),
        }
    }

    fn sample_skill_action(callable_name: &str) -> ResolvedSkillAction {
        ResolvedSkillAction {
            callable_name: callable_name.to_string(),
            skill_id: "skill.sample".to_string(),
            action_id: "run".to_string(),
            description: "Sample action".to_string(),
            entry_path: PathBuf::from("main.py"),
            runtime: "python".to_string(),
            input_schema: Some(json!({"type":"object","properties":{"value":{"type":"string"}}})),
            timeout_seconds: 60,
        }
    }

    #[test]
    fn aliases_provider_unsafe_names_and_restores_original_callables() {
        let mcp_tools = HashMap::from([
            (
                "monitor.create".to_string(),
                sample_mcp_tool("monitor.create"),
            ),
            (
                "Firecrawl Scrape".to_string(),
                sample_mcp_tool("Firecrawl Scrape"),
            ),
        ]);

        let payload = BoundCallablePayload::build(&mcp_tools, &HashMap::new(), &[]);
        let tool_payload = payload.tool_payload().expect("tool payload");
        let provider_names = tool_payload
            .get("tools")
            .and_then(Value::as_array)
            .expect("tools array")
            .iter()
            .filter_map(|entry| entry.pointer("/function/name").and_then(Value::as_str))
            .collect::<Vec<_>>();

        assert!(provider_names.contains(&dynamic_capability_alias("monitor.create").as_str()));
        assert!(provider_names.contains(&dynamic_capability_alias("Firecrawl Scrape").as_str()));
        assert!(provider_names
            .iter()
            .all(|name| name.len() <= PROVIDER_MAX_TOOL_NAME_LEN));

        let response = json!({
            "tool_calls": [
                {
                    "id": "call-monitor",
                    "name": dynamic_capability_alias("monitor.create"),
                    "arguments": {"cron": "0 * * * *"}
                },
                {
                    "id": "call-firecrawl",
                    "name": dynamic_capability_alias("Firecrawl Scrape"),
                    "arguments": {"url": "https://example.com"}
                }
            ]
        });
        let callables = payload.parse_tool_calls(&response);

        assert_eq!(callables.len(), 2);
        assert_eq!(callables[0].name, "monitor.create");
        assert_eq!(callables[0].lane, BoundCallableLane::McpTool);
        assert_eq!(callables[1].name, "Firecrawl Scrape");
        assert_eq!(callables[1].lane, BoundCallableLane::McpTool);
    }

    #[test]
    fn preserves_provider_safe_names() {
        let mcp_tools = HashMap::from([(
            "firecrawl_search".to_string(),
            sample_mcp_tool("firecrawl_search"),
        )]);

        let payload = BoundCallablePayload::build(&mcp_tools, &HashMap::new(), &[]);
        let tool_payload = payload.tool_payload().expect("tool payload");
        let provider_name = tool_payload
            .pointer("/tools/0/function/name")
            .and_then(Value::as_str)
            .expect("provider tool name");

        assert_eq!(provider_name, "firecrawl_search");

        let response = json!({
            "tool_calls": [
                {
                    "id": "call-firecrawl",
                    "name": "firecrawl_search",
                    "arguments": {"query": "docs"}
                }
            ]
        });
        let callables = payload.parse_tool_calls(&response);

        assert_eq!(callables.len(), 1);
        assert_eq!(callables[0].name, "firecrawl_search");
        assert_eq!(callables[0].lane, BoundCallableLane::McpTool);
    }

    #[test]
    fn disambiguates_duplicate_provider_names_across_lanes() {
        let mcp_tools = HashMap::from([("search_sdk".to_string(), sample_mcp_tool("search_sdk"))]);
        let skill_actions =
            HashMap::from([("search_sdk".to_string(), sample_skill_action("search_sdk"))]);

        let payload = BoundCallablePayload::build(&mcp_tools, &skill_actions, &[]);
        let tool_payload = payload.tool_payload().expect("tool payload");
        let provider_names = tool_payload
            .get("tools")
            .and_then(Value::as_array)
            .expect("tools array")
            .iter()
            .filter_map(|entry| entry.pointer("/function/name").and_then(Value::as_str))
            .collect::<Vec<_>>();

        assert_eq!(provider_names.len(), 2);
        assert!(provider_names.contains(&"search_sdk"));
        assert!(provider_names.iter().any(|name| *name != "search_sdk"));

        let aliased_name = provider_names
            .iter()
            .copied()
            .find(|name| *name != "search_sdk")
            .expect("aliased duplicate name");
        let response = json!({
            "tool_calls": [
                {
                    "id": "call-skill-action",
                    "name": aliased_name,
                    "arguments": {"value": "test"}
                }
            ]
        });
        let callables = payload.parse_tool_calls(&response);

        assert_eq!(callables.len(), 1);
        assert_eq!(callables[0].name, "search_sdk");
        assert_eq!(callables[0].lane, BoundCallableLane::SkillAction);
    }

    #[test]
    fn disambiguates_duplicate_provider_names_within_length_limit() {
        let long_safe_name = "a23456789012345678901234567890123456789012345678901234567890123";
        assert_eq!(long_safe_name.len(), PROVIDER_MAX_TOOL_NAME_LEN);

        let mcp_tools =
            HashMap::from([(long_safe_name.to_string(), sample_mcp_tool(long_safe_name))]);
        let skill_actions = HashMap::from([(
            long_safe_name.to_string(),
            sample_skill_action(long_safe_name),
        )]);

        let payload = BoundCallablePayload::build(&mcp_tools, &skill_actions, &[]);
        let tool_payload = payload.tool_payload().expect("tool payload");
        let provider_names = tool_payload
            .get("tools")
            .and_then(Value::as_array)
            .expect("tools array")
            .iter()
            .filter_map(|entry| entry.pointer("/function/name").and_then(Value::as_str))
            .collect::<Vec<_>>();

        assert_eq!(provider_names.len(), 2);
        assert!(provider_names
            .iter()
            .all(|name| name.len() <= PROVIDER_MAX_TOOL_NAME_LEN));
        assert!(provider_names.contains(&long_safe_name));
        assert!(provider_names.iter().any(|name| *name != long_safe_name));
    }

    #[test]
    fn parses_builtin_callable_lane() {
        let builtins = vec![BuiltinCallableDefinition {
            callable_name: "llm_wiki_search_corpus".to_string(),
            description: "Search corpus".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"}
                },
                "required": ["query"]
            }),
            lane: BoundCallableLane::BuiltinAction,
        }];

        let payload = BoundCallablePayload::build(&HashMap::new(), &HashMap::new(), &builtins);
        let response = json!({
            "tool_calls": [
                {
                    "id": "call-corpus",
                    "name": "llm_wiki_search_corpus",
                    "arguments": {"query": "context compression"}
                }
            ]
        });

        let callables = payload.parse_tool_calls(&response);

        assert_eq!(callables.len(), 1);
        assert_eq!(callables[0].name, "llm_wiki_search_corpus");
        assert_eq!(callables[0].lane, BoundCallableLane::BuiltinAction);
    }
}
