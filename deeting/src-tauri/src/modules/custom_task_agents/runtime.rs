use std::collections::HashMap;

use base64::Engine;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::modules::ai_upstream::{
    request_provider_chat_completion, resolve_local_model_connection,
};
use crate::modules::chat_assets::resolve_chat_assets_dir;
use crate::modules::custom_task_agents::image_config::resolve_custom_task_agent_image_config;
use crate::modules::custom_task_agents::voice_config::resolve_custom_task_agent_tts_config;
use crate::modules::image_generation::commands::run_local_image_generation_task_inline;
use crate::modules::image_generation::types::{
    LocalImageGenerationTaskCreateRequest, LocalImageGenerationTaskDetail,
};
use crate::modules::mcp::commands::runtime::{execute_mcp_tool, resolve_callable_mcp_tool_by_ref};
use crate::state::AppState;
use mcp_core::types::{LocalChatInputMessage, McpTool};
use tauri::{AppHandle, Manager};

use super::bound_callables::{BoundCallableLane, BoundCallablePayload};
use super::skill_actions::{execute_skill_action, load_callable_skill_actions};
use super::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentPreviewRequest, CustomTaskAgentPreviewResponse,
    CustomTaskAgentProfile,
};
use crate::modules::voice_capabilities::tts::request_provider_text_to_speech;
use crate::modules::voice_capabilities::types::TtsRequest;

const MAX_CUSTOM_TASK_AGENT_TOOL_ROUNDS: usize = 4;
const MAX_GUIDANCE_SKILL_DOCS: usize = 3;
pub(crate) const IMAGE_AGENT_INPUT_REQUIRED_CODE: &str = "IMAGE_AGENT_INPUT_REQUIRED";
pub(crate) const IMAGE_AGENT_INPUT_LIMIT_EXCEEDED_CODE: &str = "IMAGE_AGENT_INPUT_LIMIT_EXCEEDED";
pub(crate) const IMAGE_AGENT_UPSTREAM_INPUT_LIMIT_EXCEEDED_CODE: &str =
    "IMAGE_AGENT_UPSTREAM_INPUT_LIMIT_EXCEEDED";
pub(crate) const IMAGE_AGENT_INPUT_RESOLUTION_FAILED_CODE: &str =
    "IMAGE_AGENT_INPUT_RESOLUTION_FAILED";

#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct CustomTaskAgentRuntimeError {
    pub(crate) code: Option<String>,
    pub(crate) message: String,
}

impl CustomTaskAgentRuntimeError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            code: None,
            message: message.into(),
        }
    }

    pub(crate) fn with_code(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: Some(code.into()),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for CustomTaskAgentRuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message.as_str())
    }
}

impl From<String> for CustomTaskAgentRuntimeError {
    fn from(value: String) -> Self {
        Self::new(value)
    }
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
) -> Result<CustomTaskAgentPreviewResponse, CustomTaskAgentRuntimeError> {
    if !profile.is_enabled {
        return Err(CustomTaskAgentRuntimeError::new(
            "custom task agent is disabled",
        ));
    }

    let message = request.message.trim();
    if message.is_empty() {
        return Err(CustomTaskAgentRuntimeError::new(
            "preview message is required",
        ));
    }

    let (model, provider_model_id) =
        resolve_custom_task_agent_model_selection(profile.model_config.as_ref());
    let model_connection =
        resolve_local_model_connection(app_state, &model, provider_model_id.as_deref())
            .await
            .map_err(CustomTaskAgentRuntimeError::from)?;

    if profile.invocation_kind == CustomTaskAgentInvocationKind::ImageGeneration {
        let image_config = resolve_custom_task_agent_image_config(profile.model_config.as_ref());
        let allow_text_only = image_config.allow_text_only.unwrap_or(true);
        let configured_max_input_images =
            image_config.max_input_images.unwrap_or(1).max(0) as usize;
        let upstream_max_input_images =
            resolve_upstream_max_input_images(app_state, &model_connection.provider_model_id)
                .await
                .unwrap_or(1);
        let input_image_count = request.image_urls.len();

        if input_image_count == 0 && !allow_text_only {
            return Err(CustomTaskAgentRuntimeError::with_code(
                IMAGE_AGENT_INPUT_REQUIRED_CODE,
                "this image agent requires at least one uploaded image",
            ));
        }
        if input_image_count > configured_max_input_images {
            return Err(CustomTaskAgentRuntimeError::with_code(
                IMAGE_AGENT_INPUT_LIMIT_EXCEEDED_CODE,
                format!(
                    "this image agent accepts at most {} input image(s), but you uploaded {}",
                    configured_max_input_images, input_image_count
                ),
            ));
        }
        if input_image_count > upstream_max_input_images {
            return Err(CustomTaskAgentRuntimeError::with_code(
                IMAGE_AGENT_UPSTREAM_INPUT_LIMIT_EXCEEDED_CODE,
                format!(
                    "the selected upstream model accepts at most {} input image(s), but you uploaded {}",
                    upstream_max_input_images, input_image_count
                ),
            ));
        }

        let image_urls = resolve_request_image_urls(
            app_handle,
            app_state,
            request
                .image_urls
                .into_iter()
                .take(configured_max_input_images.min(upstream_max_input_images))
                .collect::<Vec<_>>()
                .as_slice(),
        )
        .await
        .map_err(|err| {
            CustomTaskAgentRuntimeError::with_code(IMAGE_AGENT_INPUT_RESOLUTION_FAILED_CODE, err)
        })?;
        let detail = run_local_image_generation_task_inline(
            app_handle,
            app_state,
            LocalImageGenerationTaskCreateRequest {
                model: model_connection.model_id.clone(),
                prompt: message.to_string(),
                image_urls: image_urls.clone(),
                negative_prompt: image_config.negative_prompt,
                width: image_config.width,
                height: image_config.height,
                aspect_ratio: image_config.aspect_ratio,
                num_outputs: image_config.num_outputs.or(Some(1)),
                steps: image_config.steps,
                cfg_scale: image_config.cfg_scale,
                seed: image_config.seed,
                sampler_name: image_config.sampler_name,
                quality: image_config.quality,
                style: image_config.style,
                response_format: image_config.response_format,
                extra_params: image_config.extra_params,
                provider_model_id: model_connection.provider_model_id.clone(),
                session_id: None,
                request_id: None,
                encrypt_prompt: Some(false),
                image_url: image_urls.first().cloned(),
            },
        )
        .await
        .map_err(CustomTaskAgentRuntimeError::from)?;
        validate_image_generation_detail(&detail)?;
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
            audios: Vec::new(),
            raw: serde_json::to_value(detail).ok(),
        });
    }

    if profile.invocation_kind == CustomTaskAgentInvocationKind::TextToSpeech {
        let tts_config = resolve_custom_task_agent_tts_config(profile.model_config.as_ref());
        let payload = request_provider_text_to_speech(
            app_handle,
            app_state,
            &TtsRequest {
                model: model_connection.model_id.clone(),
                provider_model_id: model_connection.provider_model_id.clone(),
                text: message.to_string(),
                voice: tts_config.voice.clone(),
                response_format: tts_config.response_format.clone(),
                extra_params: merge_tts_extra_params(tts_config.speed, tts_config.extra_params),
            },
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
            callable_mcp_tool_ids: profile.callable_mcp_tool_ids.clone(),
            guidance_skill_ids: profile.guidance_skill_ids.clone(),
            callable_skill_action_refs: profile.callable_skill_action_refs.clone(),
            images: Vec::new(),
            audios: vec![payload.asset.url.clone()],
            raw: serde_json::to_value(payload).ok(),
        });
    }

    let mcp_tools = load_callable_mcp_tools(app_state, &profile.callable_mcp_tool_ids)
        .await
        .map_err(CustomTaskAgentRuntimeError::from)?;
    let guidance_skills = load_guidance_skill_docs(app_state, &profile.guidance_skill_ids)
        .await
        .map_err(CustomTaskAgentRuntimeError::from)?;
    let skill_actions = load_callable_skill_actions(app_state, &profile.callable_skill_action_refs)
        .await
        .map_err(CustomTaskAgentRuntimeError::from)?;
    let callable_payload = BoundCallablePayload::build(&mcp_tools, &skill_actions);
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
            callable_payload.tool_payload(),
            request.temperature,
            request.max_tokens,
            None,
            None,
        )
        .await
        .map_err(CustomTaskAgentRuntimeError::from)?;
        let callables = callable_payload.parse_tool_calls(&response);
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
                audios: Vec::new(),
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
            match callable.lane {
                BoundCallableLane::McpTool => {
                    let Some(tool) = mcp_tools.get(callable.name.as_str()) else {
                        return Err(format!(
                            "bound MCP tool '{}' is no longer available",
                            callable.name
                        )
                        .into());
                    };
                    match execute_mcp_tool(
                        Some(&app_state.mcp),
                        app_state.mcp.store.as_ref(),
                        tool,
                        &callable.arguments,
                    )
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
                BoundCallableLane::SkillAction => {
                    let Some(action) = skill_actions.get(callable.name.as_str()) else {
                        return Err(format!(
                            "bound skill action '{}' is no longer available",
                            callable.name
                        )
                        .into());
                    };
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
                BoundCallableLane::Unknown => {}
            }

            if let Some(tool) = mcp_tools.get(callable.name.as_str()) {
                match execute_mcp_tool(
                    Some(&app_state.mcp),
                    app_state.mcp.store.as_ref(),
                    tool,
                    &callable.arguments,
                )
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
            )
            .into());
        }

        messages.push(LocalChatInputMessage {
            role: "user".to_string(),
            content: build_callable_feedback_message(round, &action_results),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        });
    }

    Err(format!("custom task agent exceeded {} callable rounds", max_rounds).into())
}

async fn resolve_request_image_urls(
    app_handle: &AppHandle,
    app_state: &AppState,
    image_urls: &[String],
) -> Result<Vec<String>, String> {
    let mut resolved = Vec::new();
    for image_url in image_urls {
        let trimmed = image_url.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(object_key) = trimmed.strip_prefix("asset://") {
            let object_key = object_key.trim_start_matches('/');
            if object_key.is_empty() {
                continue;
            }
            if let Some(public_url) = app_state
                .providers
                .store
                .get_local_desktop_object_storage_config()
                .await
                .map_err(|err| err.to_string())?
                .and_then(|config| config.build_public_url(object_key))
            {
                resolved.push(public_url);
                continue;
            }
            let read_ticket = app_state
                .providers
                .store
                .prepare_local_desktop_object_storage_read(
                    crate::modules::providers::types::DesktopObjectStorageReadRequest {
                        object_key: object_key.to_string(),
                        expires_seconds: Some(900),
                    },
                )
                .await
                .map_err(|err| err.to_string())?;
            resolved.push(read_ticket.asset_url);
            continue;
        }
        if let Some(sha256) = trimmed.strip_prefix("local-asset://") {
            let data_url = read_local_chat_asset_as_data_url(app_handle, sha256.trim()).await?;
            resolved.push(data_url);
            continue;
        }
        resolved.push(trimmed.to_string());
    }
    Ok(resolved)
}

async fn read_local_chat_asset_as_data_url(
    app_handle: &AppHandle,
    sha256: &str,
) -> Result<String, String> {
    let app_data_dir = app_handle.path().app_data_dir().ok();
    let dir = resolve_chat_assets_dir(app_data_dir);
    let exts = [
        ("png", "image/png"),
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("gif", "image/gif"),
        ("webp", "image/webp"),
        ("svg", "image/svg+xml"),
        ("bmp", "image/bmp"),
        ("tiff", "image/tiff"),
        ("bin", "application/octet-stream"),
    ];
    for (ext, content_type) in exts {
        let path = dir.join(format!("{sha256}.{ext}"));
        if !path.exists() {
            continue;
        }
        let bytes = std::fs::read(&path)
            .map_err(|err| format!("failed to read local chat asset {}: {}", sha256, err))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        return Ok(format!("data:{};base64,{}", content_type, encoded));
    }
    Err(format!("local chat asset {} not found", sha256))
}

async fn resolve_upstream_max_input_images(
    app_state: &AppState,
    provider_model_id: &str,
) -> Result<usize, String> {
    let provider_model_uuid = Uuid::parse_str(provider_model_id).map_err(|err| err.to_string())?;
    let model = app_state
        .providers
        .store
        .get_model(&provider_model_uuid)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "provider model not found".to_string())?;

    let explicit_limit = model
        .routing_config
        .get("max_input_images")
        .and_then(Value::as_u64)
        .or_else(|| {
            model
                .config_override
                .get("max_input_images")
                .and_then(Value::as_u64)
        })
        .map(|value| value as usize);
    if let Some(limit) = explicit_limit {
        return Ok(limit);
    }

    let supports_singular = model
        .config_override
        .get("request_template")
        .and_then(Value::as_object)
        .map(|template| template.contains_key("image_url"))
        .unwrap_or(false)
        || model
            .routing_config
            .get("request_template")
            .and_then(Value::as_object)
            .map(|template| template.contains_key("image_url"))
            .unwrap_or(false);
    let supports_multiple = model
        .config_override
        .get("request_template")
        .and_then(Value::as_object)
        .map(|template| {
            template.contains_key("input_images") || template.contains_key("image_urls")
        })
        .unwrap_or(false)
        || model
            .routing_config
            .get("request_template")
            .and_then(Value::as_object)
            .map(|template| {
                template.contains_key("input_images") || template.contains_key("image_urls")
            })
            .unwrap_or(false);

    if supports_multiple {
        return Ok(1);
    }
    if supports_singular {
        return Ok(1);
    }
    Ok(0)
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
        "If a guidance skill describes a CLI or terminal workflow, and one of your bound callable MCP tools can execute host commands, translate the documented workflow into that callable tool instead of blocking on the absence of a dedicated skill action.",
        "Do not require a bespoke skill action name when the delegated task can be completed through a bound shell or host-execution tool.",
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

fn validate_image_generation_detail(
    detail: &LocalImageGenerationTaskDetail,
) -> Result<(), CustomTaskAgentRuntimeError> {
    if detail.status.eq_ignore_ascii_case("succeeded") {
        return Ok(());
    }

    Err(CustomTaskAgentRuntimeError {
        code: detail
            .error_code
            .clone()
            .or_else(|| Some("upstream_failed".to_string())),
        message: detail.error_message.clone().unwrap_or_else(|| {
            format!(
                "image generation failed with status {}",
                detail.status.trim()
            )
        }),
    })
}

fn build_callable_feedback_message(round: usize, action_results: &[Value]) -> String {
    format!(
        "## Callable Results\nRound: {}\nResults:\n{}\nContinue the same delegated task using only these callable results.",
        round + 1,
        serde_json::to_string_pretty(action_results).unwrap_or_else(|_| "[]".to_string())
    )
}

fn merge_tts_extra_params(speed: Option<f64>, extra_params: Option<Value>) -> Option<Value> {
    let mut object = extra_params
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if let Some(speed) = speed {
        object.insert("speed".to_string(), json!(speed));
    }
    if object.is_empty() {
        None
    } else {
        Some(Value::Object(object))
    }
}

#[cfg(test)]
mod tests {
    use super::{build_initial_messages, validate_image_generation_detail};
    use crate::modules::custom_task_agents::types::{
        CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
    };
    use crate::modules::image_generation::types::LocalImageGenerationTaskDetail;

    fn make_detail(
        status: &str,
        error_code: Option<&str>,
        error_message: Option<&str>,
    ) -> LocalImageGenerationTaskDetail {
        LocalImageGenerationTaskDetail {
            task_id: "task-1".to_string(),
            status: status.to_string(),
            model: "test-model".to_string(),
            created_at: "2026-03-26T00:00:00Z".to_string(),
            updated_at: "2026-03-26T00:00:01Z".to_string(),
            completed_at: Some("2026-03-26T00:00:02Z".to_string()),
            error_code: error_code.map(str::to_string),
            error_message: error_message.map(str::to_string),
            outputs: Vec::new(),
        }
    }

    #[test]
    fn validate_image_generation_detail_accepts_succeeded_status() {
        let detail = make_detail("succeeded", None, None);

        assert!(validate_image_generation_detail(&detail).is_ok());
    }

    #[test]
    fn validate_image_generation_detail_returns_runtime_error_for_failed_status() {
        let detail = make_detail(
            "failed",
            Some("bad_response_status_code"),
            Some("upstream returned 404"),
        );

        let error = validate_image_generation_detail(&detail).expect_err("expected failure");

        assert_eq!(error.code.as_deref(), Some("bad_response_status_code"));
        assert_eq!(error.message, "upstream returned 404");
    }

    #[test]
    fn build_initial_messages_allows_cli_guidance_to_use_bound_shell_tools() {
        let profile = CustomTaskAgentProfile {
            id: "agent-1".to_string(),
            name: "CLI helper".to_string(),
            description: Some("Runs terminal-oriented delegated tasks".to_string()),
            task_prompt: "Complete the delegated task.".to_string(),
            invocation_kind: CustomTaskAgentInvocationKind::Chat,
            preferred_for_image_generation: false,
            model_config: None,
            callable_mcp_tool_ids: vec!["tool.shell_execute".to_string()],
            guidance_skill_ids: vec!["skill.cli-docs".to_string()],
            callable_skill_action_refs: vec![],
            tags: vec![],
            discoverable: true,
            is_enabled: true,
            is_deleted: false,
            source_kind: None,
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "2026-04-02T00:00:00Z".to_string(),
            updated_at: "2026-04-02T00:00:00Z".to_string(),
        };

        let messages = build_initial_messages(
            &profile,
            "Check whether a CLI tool is installed.",
            "## Guidance Skill skill.cli-docs\nDocs: use the CLI in a terminal.",
        );
        let system = messages
            .first()
            .map(|message| message.content.clone())
            .unwrap_or_default();

        assert!(system.contains("Guidance skills are documentation-only context"));
        assert!(system.contains("CLI or terminal workflow"));
        assert!(system.contains("bound callable MCP tools can execute host commands"));
        assert!(system.contains("absence of a dedicated skill action"));
        assert!(system.contains("bound shell or host-execution tool"));
    }
}
