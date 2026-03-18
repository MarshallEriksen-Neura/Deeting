use std::collections::HashMap;

use serde_json::{json, Value};

use crate::modules::ai_upstream::{
    request_provider_chat_completion, resolve_local_model_connection,
};
use crate::modules::image_generation::commands::run_local_image_generation_task_inline;
use crate::modules::image_generation::types::LocalImageGenerationTaskCreateRequest;
use crate::modules::mcp::commands::runtime::{execute_mcp_tool, resolve_callable_mcp_tool_by_ref};
use mcp_core::types::{LocalChatInputMessage, McpTool};
use crate::state::AppState;
use tauri::AppHandle;

use super::skill_actions::{
    execute_skill_action, load_callable_skill_actions, ResolvedSkillAction,
};
use super::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentPreviewRequest, CustomTaskAgentPreviewResponse,
    CustomTaskAgentProfile,
};

const MAX_CUSTOM_TASK_AGENT_TOOL_ROUNDS: usize = 4;
const MAX_GUIDANCE_SKILL_DOCS: usize = 3;

#[derive(Debug, Clone)]
struct BoundCallable {
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
    app_handle: &AppHandle,
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
        let detail = run_local_image_generation_task_inline(
            app_handle,
            app_state,
            LocalImageGenerationTaskCreateRequest {
                model: model_connection.model_id.clone(),
                prompt: message.to_string(),
                negative_prompt: None,
                width: None,
                height: None,
                aspect_ratio: None,
                num_outputs: Some(1),
                steps: None,
                cfg_scale: None,
                seed: None,
                sampler_name: None,
                quality: None,
                style: None,
                response_format: None,
                extra_params: None,
                provider_model_id: model_connection.provider_model_id.clone(),
                session_id: None,
                request_id: None,
                encrypt_prompt: Some(false),
                image_url: None,
            },
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
            callable_mcp_tool_ids: profile.callable_mcp_tool_ids.clone(),
            guidance_skill_ids: profile.guidance_skill_ids.clone(),
            callable_skill_action_refs: profile.callable_skill_action_refs.clone(),
            images: detail
                .outputs
                .iter()
                .filter_map(|item| item.asset_url.clone().or_else(|| item.source_url.clone()))
                .collect(),
            raw: serde_json::to_value(detail).ok(),
        });
    }

    let mcp_tools = load_callable_mcp_tools(app_state, &profile.callable_mcp_tool_ids).await?;
    let guidance_skills = load_guidance_skill_docs(app_state, &profile.guidance_skill_ids).await?;
    let skill_actions =
        load_callable_skill_actions(app_state, &profile.callable_skill_action_refs).await?;
    let tool_payload = build_callable_payload(&mcp_tools, &skill_actions);
    let mut messages = build_initial_messages(profile, message, &guidance_skills);
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
        let callables = extract_bound_callables(&response);
        if callables.is_empty() {
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
                callable_mcp_tool_ids: profile.callable_mcp_tool_ids.clone(),
                guidance_skill_ids: profile.guidance_skill_ids.clone(),
                callable_skill_action_refs: profile.callable_skill_action_refs.clone(),
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
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            });
        }

        let mut action_results = Vec::new();
        for callable in callables {
            if let Some(tool) = mcp_tools.get(callable.name.as_str()) {
                match execute_mcp_tool(app_state.mcp.store.as_ref(), tool, &callable.arguments)
                    .await
                {
                    Ok(result) => {
                        let meta = json!({
                            "id": callable.id,
                            "name": callable.name,
                            "lane": "mcp_tool",
                            "status": "success",
                            "result": result,
                        });
                        tool_trace.push(meta.clone());
                        action_results.push(meta);
                    }
                    Err(err) => {
                        let meta = json!({
                            "id": callable.id,
                            "name": callable.name,
                            "lane": "mcp_tool",
                            "status": "error",
                            "error": err,
                        });
                        tool_trace.push(meta.clone());
                        action_results.push(meta);
                    }
                }
                continue;
            }

            if let Some(action) = skill_actions.get(callable.name.as_str()) {
                match execute_skill_action(app_state, action, &callable.arguments).await {
                    Ok(result) => {
                        let meta = json!({
                            "id": callable.id,
                            "name": callable.name,
                            "lane": "skill_action",
                            "skill_id": action.skill_id,
                            "action_id": action.action_id,
                            "status": "success",
                            "result": result,
                        });
                        tool_trace.push(meta.clone());
                        action_results.push(meta);
                    }
                    Err(err) => {
                        let meta = json!({
                            "id": callable.id,
                            "name": callable.name,
                            "lane": "skill_action",
                            "skill_id": action.skill_id,
                            "action_id": action.action_id,
                            "status": "error",
                            "error": err,
                        });
                        tool_trace.push(meta.clone());
                        action_results.push(meta);
                    }
                }
                continue;
            }

            return Err(format!(
                "callable '{}' is neither a bound MCP tool nor a bound skill action",
                callable.name
            ));
        }

        messages.push(LocalChatInputMessage {
            role: "user".to_string(),
            content: build_callable_feedback_message(round, &action_results),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        });
    }

    Err(format!(
        "custom task agent exceeded {} callable rounds",
        max_rounds
    ))
}

async fn load_callable_mcp_tools(
    app_state: &AppState,
    callable_mcp_tool_ids: &[String],
) -> Result<HashMap<String, McpTool>, String> {
    let mut by_name = HashMap::new();
    for tool_id in callable_mcp_tool_ids {
        let tool =
            resolve_callable_mcp_tool_by_ref(app_state.mcp.store.as_ref(), Some(tool_id), None)
                .await
                .map_err(|err| err.to_string())?;
        by_name.insert(tool.name.clone(), tool);
    }
    Ok(by_name)
}

async fn load_guidance_skill_docs(
    app_state: &AppState,
    guidance_skill_ids: &[String],
) -> Result<String, String> {
    if guidance_skill_ids.is_empty() {
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
    for skill_id in guidance_skill_ids.iter().take(MAX_GUIDANCE_SKILL_DOCS) {
        let Some(install) = installs.iter().find(|item| item.skill_id == *skill_id) else {
            return Err(format!(
                "guidance skill '{}' is not installed locally",
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
                "## Guidance Skill {}\nName: {}\nInstall path: {}\nDocs: {}\nFiles: {}",
                skill_id,
                name,
                install.install_path,
                excerpt.trim(),
                docs
            ));
        } else {
            sections.push(format!(
                "## Guidance Skill {}\nInstall path: {}\nNo indexed skill metadata found.",
                skill_id, install.install_path
            ));
        }
    }
    Ok(sections.join("\n\n"))
}

fn build_initial_messages(
    profile: &CustomTaskAgentProfile,
    message: &str,
    guidance_skills: &str,
) -> Vec<LocalChatInputMessage> {
    let mut system_lines = vec![
        "## Custom Task Agent Runtime",
        "You are a delegated custom task agent.",
        "You only execute the single task assigned in the current request.",
        "Guidance skills are documentation-only context. Read them, but do not treat them as directly callable tools.",
        "Callable MCP tools and callable skill actions are separate execution lanes.",
        "Use only the callable MCP tools and callable skill actions explicitly bound to this custom task agent.",
        "Do not perform extra search, search_sdk, route planning, or orchestration on your own.",
        "If you are blocked, explain the blocker briefly and stop.",
        "",
        "## Agent Task Prompt",
        profile.task_prompt.trim(),
    ];
    if !guidance_skills.trim().is_empty() {
        system_lines.push("");
        system_lines.push(guidance_skills.trim());
    }
    vec![
        LocalChatInputMessage {
            role: "system".to_string(),
            content: system_lines.join("\n"),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
        LocalChatInputMessage {
            role: "user".to_string(),
            content: message.to_string(),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
    ]
}

fn build_callable_payload(
    mcp_tools: &HashMap<String, McpTool>,
    skill_actions: &HashMap<String, ResolvedSkillAction>,
) -> Option<Value> {
    let mut entries = Vec::new();
    for tool in mcp_tools.values() {
        let Some(config_value) = serde_json::from_str::<Value>(&tool.config_json).ok() else {
            continue;
        };
        let input_schema = config_value
            .get("input_schema")
            .cloned()
            .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
        entries.push(json!({
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": input_schema,
            }
        }));
    }
    for action in skill_actions.values() {
        entries.push(json!({
            "type": "function",
            "function": {
                "name": action.callable_name,
                "description": format!(
                    "[Skill Action] {} (skill={}, action={}, runtime={})",
                    action.description,
                    action.skill_id,
                    action.action_id,
                    action.runtime
                ),
                "parameters": action
                    .input_schema
                    .clone()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
            }
        }));
    }
    if entries.is_empty() {
        None
    } else {
        Some(json!({ "tools": entries }))
    }
}

fn build_callable_feedback_message(round: usize, action_results: &[Value]) -> String {
    format!(
        "## Callable Results\nRound: {}\nResults:\n{}\nContinue the same delegated task using only these callable results.",
        round + 1,
        serde_json::to_string_pretty(action_results).unwrap_or_else(|_| "[]".to_string())
    )
}

fn extract_bound_callables(response: &Value) -> Vec<BoundCallable> {
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
                    Some(BoundCallable {
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
