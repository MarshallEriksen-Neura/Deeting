use std::collections::HashMap;

use serde_json::{json, Value};

use crate::modules::ai_upstream::image::request_provider_image_generation;
use crate::modules::ai_upstream::{
    request_provider_chat_completion, resolve_local_model_connection,
};
use crate::modules::mcp::commands::runtime::{execute_mcp_tool, resolve_callable_mcp_tool_by_ref};
use crate::modules::mcp::types::{LocalChatInputMessage, McpTool};
use crate::state::AppState;

use super::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentPreviewRequest, CustomTaskAgentPreviewResponse,
    CustomTaskAgentProfile,
};

const MAX_CUSTOM_TASK_AGENT_TOOL_ROUNDS: usize = 4;
const MAX_BOUND_SKILL_DOCS: usize = 3;

#[derive(Debug, Clone)]
struct BoundToolCall {
    id: String,
    name: String,
    arguments: Value,
}

pub(crate) fn resolve_custom_task_agent_model_selection(
    model_config: Option<&serde_json::Value>,
) -> (String, Option<String>) {
    let provider_model_id = model_config
        .and_then(|value| value.get("provider_model_id"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let model = model_config
        .and_then(|value| value.get("model"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            model_config
                .and_then(|value| value.get("model_name"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "default".to_string());
    (model, provider_model_id)
}

pub(crate) async fn preview_custom_task_agent(
    app_state: &AppState,
    profile: &CustomTaskAgentProfile,
    request: CustomTaskAgentPreviewRequest,
) -> Result<CustomTaskAgentPreviewResponse, String> {
    if !profile.is_enabled {
        return Err("custom task agent is disabled".to_string());
    }

    let message = request.message.trim();
    if message.is_empty() {
        return Err("preview message is required".to_string());
    }

    let (model, provider_model_id) =
        resolve_custom_task_agent_model_selection(profile.model_config.as_ref());
    let model_connection =
        resolve_local_model_connection(app_state, &model, provider_model_id.as_deref()).await?;

    if profile.invocation_kind == CustomTaskAgentInvocationKind::ImageGeneration {
        let raw = request_provider_image_generation(
            app_state,
            &model_connection.provider_model_id,
            &model_connection.model_id,
            message,
            None,
        )
        .await?;
        return Ok(CustomTaskAgentPreviewResponse {
            status: "completed".to_string(),
            content: String::new(),
            model_id: model_connection.model_id,
            provider_model_id: model_connection.provider_model_id,
            invocation_kind: profile.invocation_kind.clone(),
            reasoning_content: None,
            tool_calls: Vec::new(),
            tool_trace: Vec::new(),
            bound_tool_ids: profile.bound_tool_ids.clone(),
            bound_skill_ids: profile.bound_skill_ids.clone(),
            images: extract_image_outputs(&raw),
            raw: Some(raw),
        });
    }

    let bound_tools = load_bound_tools(app_state, &profile.bound_tool_ids).await?;
    let bound_skills = load_bound_skill_docs(app_state, &profile.bound_skill_ids).await?;
    let tool_payload = build_bound_tool_payload(&bound_tools);
    let mut messages = build_initial_messages(profile, message, &bound_skills);
    let mut tool_trace = Vec::<Value>::new();
    let max_rounds = request
        .max_rounds
        .map(|value| value.max(1) as usize)
        .unwrap_or(MAX_CUSTOM_TASK_AGENT_TOOL_ROUNDS);

    for round in 0..max_rounds {
        let response = request_provider_chat_completion(
            app_state,
            &model_connection.provider_model_id,
            &model_connection.model_id,
            messages.clone(),
            tool_payload.clone(),
            request.temperature,
            request.max_tokens,
            None,
            None,
        )
        .await?;
        let tool_calls = extract_bound_tool_calls(&response);
        if tool_calls.is_empty() {
            return Ok(CustomTaskAgentPreviewResponse {
                status: "completed".to_string(),
                content: response
                    .get("content")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                model_id: model_connection.model_id,
                provider_model_id: model_connection.provider_model_id,
                invocation_kind: profile.invocation_kind.clone(),
                reasoning_content: response
                    .get("reasoning_content")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                tool_calls: response
                    .get("tool_calls")
                    .and_then(|value| value.as_array())
                    .cloned()
                    .unwrap_or_default(),
                tool_trace,
                bound_tool_ids: profile.bound_tool_ids.clone(),
                bound_skill_ids: profile.bound_skill_ids.clone(),
                images: Vec::new(),
                raw: Some(response),
            });
        }

        if let Some(content) = response
            .get("content")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            messages.push(LocalChatInputMessage {
                role: "assistant".to_string(),
                content: content.to_string(),
            });
        }

        let mut tool_results = Vec::new();
        for call in tool_calls {
            let Some(bound_tool) = bound_tools.get(call.name.as_str()) else {
                return Err(format!(
                    "tool '{}' is not bound to this custom task agent",
                    call.name
                ));
            };
            match execute_mcp_tool(app_state.mcp.store.as_ref(), bound_tool, &call.arguments).await
            {
                Ok(tool_result) => {
                    let meta = json!({
                        "id": call.id,
                        "name": call.name,
                        "status": "success",
                        "result": tool_result,
                    });
                    tool_trace.push(meta.clone());
                    tool_results.push(meta);
                }
                Err(err) => {
                    let meta = json!({
                        "id": call.id,
                        "name": call.name,
                        "status": "error",
                        "error": err,
                    });
                    tool_trace.push(meta.clone());
                    tool_results.push(meta);
                }
            }
        }

        messages.push(LocalChatInputMessage {
            role: "user".to_string(),
            content: build_tool_feedback_message(round, &tool_results),
        });
    }

    Err(format!(
        "custom task agent exceeded {} tool rounds",
        max_rounds
    ))
}

async fn load_bound_tools(
    app_state: &AppState,
    bound_tool_ids: &[String],
) -> Result<HashMap<String, McpTool>, String> {
    let mut by_name = HashMap::new();
    for tool_id in bound_tool_ids {
        let tool =
            resolve_callable_mcp_tool_by_ref(app_state.mcp.store.as_ref(), Some(tool_id), None)
                .await
                .map_err(|err| err.to_string())?;
        by_name.insert(tool.name.clone(), tool);
    }
    Ok(by_name)
}

async fn load_bound_skill_docs(
    app_state: &AppState,
    bound_skill_ids: &[String],
) -> Result<String, String> {
    if bound_skill_ids.is_empty() {
        return Ok(String::new());
    }

    let installs = app_state
        .mcp
        .store
        .list_local_skill_installs()
        .await
        .map_err(|err| err.to_string())?;
    let assets = app_state
        .memory
        .service
        .list_assets_catalog()
        .await
        .map_err(|err| err.to_string())?;

    let mut sections = Vec::new();
    for skill_id in bound_skill_ids.iter().take(MAX_BOUND_SKILL_DOCS) {
        let Some(install) = installs.iter().find(|item| item.skill_id == *skill_id) else {
            return Err(format!(
                "bound skill '{}' is not installed locally",
                skill_id
            ));
        };
        let asset = assets.iter().find(|asset| {
            asset.get("asset_type").and_then(Value::as_str) == Some("skill")
                && (asset.get("id").and_then(Value::as_str) == Some(skill_id.as_str())
                    || asset.get("pkg_name").and_then(Value::as_str) == Some(skill_id.as_str()))
        });
        if let Some(asset) = asset {
            let name = asset
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(skill_id.as_str());
            let excerpt = asset
                .pointer("/metadata/source_metadata/doc_excerpt")
                .and_then(Value::as_str)
                .unwrap_or("");
            let docs = asset
                .pointer("/metadata/source_metadata/doc_paths")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .take(3)
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            sections.push(format!(
                "## Bound Skill {}\nName: {}\nInstall path: {}\nDocs: {}\nFiles: {}",
                skill_id,
                name,
                install.install_path,
                excerpt.trim(),
                docs
            ));
        } else {
            sections.push(format!(
                "## Bound Skill {}\nInstall path: {}\nNo indexed skill metadata found.",
                skill_id, install.install_path
            ));
        }
    }
    Ok(sections.join("\n\n"))
}

fn build_initial_messages(
    profile: &CustomTaskAgentProfile,
    message: &str,
    bound_skills: &str,
) -> Vec<LocalChatInputMessage> {
    let mut system_lines = vec![
        "## Custom Task Agent Runtime",
        "You are a delegated custom task agent.",
        "You only execute the single task assigned in the current request.",
        "Do not use any tool except the tools explicitly bound to this custom task agent.",
        "Do not perform extra search, search_sdk, route planning, or orchestration on your own.",
        "If you are blocked, explain the blocker briefly and stop.",
        "",
        "## Agent Task Prompt",
        profile.task_prompt.trim(),
    ];
    if !bound_skills.trim().is_empty() {
        system_lines.push("");
        system_lines.push(bound_skills.trim());
    }
    vec![
        LocalChatInputMessage {
            role: "system".to_string(),
            content: system_lines.join("\n"),
        },
        LocalChatInputMessage {
            role: "user".to_string(),
            content: message.to_string(),
        },
    ]
}

fn build_bound_tool_payload(bound_tools: &HashMap<String, McpTool>) -> Option<Value> {
    if bound_tools.is_empty() {
        return None;
    }
    let entries = bound_tools
        .values()
        .filter_map(|tool| {
            let config_value = serde_json::from_str::<Value>(&tool.config_json).ok()?;
            let input_schema = config_value
                .get("input_schema")
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
            Some(json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": input_schema,
                }
            }))
        })
        .collect::<Vec<_>>();
    Some(json!({ "tools": entries }))
}

fn build_tool_feedback_message(round: usize, tool_results: &[Value]) -> String {
    format!(
        "## Bound Tool Results\nRound: {}\nTool results:\n{}\nContinue the same delegated task using only these tool results.",
        round + 1,
        serde_json::to_string_pretty(tool_results).unwrap_or_else(|_| "[]".to_string())
    )
}

fn extract_bound_tool_calls(response: &Value) -> Vec<BoundToolCall> {
    response
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = item.get("name").and_then(Value::as_str)?.trim().to_string();
                    if name.is_empty() {
                        return None;
                    }
                    Some(BoundToolCall {
                        id: item
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        name,
                        arguments: item.get("arguments").cloned().unwrap_or_else(|| json!({})),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn extract_image_outputs(raw: &Value) -> Vec<String> {
    raw.get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("url")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or_else(|| {
                            item.get("b64_json")
                                .and_then(Value::as_str)
                                .map(|value| format!("data:image/png;base64,{}", value))
                        })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}
