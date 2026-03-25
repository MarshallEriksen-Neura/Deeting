use super::{
    run_policy_scoped_chat_completion, DelegatedWorkerExecution, LocalExecutionOutcome,
    LocalExecutionRequest,
};
use crate::modules::audio::result_blocks::build_audio_result_block;
use crate::modules::chat_assets::resolve_chat_assets_dir;
use crate::modules::custom_task_agents::runtime::{
    preview_custom_task_agent, CustomTaskAgentRuntimeError,
};
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentPreviewRequest, CustomTaskAgentPreviewResponse,
    CustomTaskAgentProfile,
};
use crate::modules::desktop_runtime::runtime::control_plane::LocalExecutionPlane;
use crate::modules::desktop_runtime::runtime::{
    build_local_tool_trace_blocks, select_worker_custom_task_agent,
};
use crate::modules::workflow::service as workflow_service;
use crate::modules::workflow::types::QuickWorkflowRequest;
use crate::state::AppState;
use base64::Engine;
use mcp_core::types::LocalChatInputMessage;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct LatestUserImageInput {
    prompt: String,
    image_urls: Vec<String>,
    raw_text: String,
}

pub(super) async fn run_worker_execution_handler<F>(
    request: LocalExecutionRequest,
    emit_status: &mut F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    debug_assert_eq!(
        request.execution_policy.plane,
        LocalExecutionPlane::WorkerReasoning
    );
    let delegated_worker =
        maybe_delegate_worker_to_custom_task_agent(&request, emit_status).await?;
    run_policy_scoped_chat_completion(request, delegated_worker, emit_status).await
}

async fn maybe_delegate_worker_to_custom_task_agent<F>(
    request: &LocalExecutionRequest,
    emit_status: &mut F,
) -> Result<Option<DelegatedWorkerExecution>, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    if !request.execution_policy.allow_worker_delegation {
        return Ok(None);
    }

    let latest_input = latest_user_image_input(&request.messages);
    let query = if !latest_input.prompt.trim().is_empty() {
        latest_input.prompt.clone()
    } else if !latest_input.image_urls.is_empty() {
        "image".to_string()
    } else {
        latest_input.raw_text.clone()
    };
    if query.trim().is_empty() {
        return Ok(None);
    }
    let Some(selection) = select_worker_custom_task_agent(
        &request.app_state,
        request.explicit_task_agent_id.as_deref(),
        query.as_str(),
    )
    .await?
    else {
        return Ok(None);
    };

    emit_status(
        "evolve",
        Some("worker_delegation"),
        "running",
        "worker.task.delegated",
        Some(json!({
            "agent_id": selection.profile.id,
            "agent_name": selection.profile.name,
            "selection_score": selection.score,
            "selection_reason": selection.reason,
        })),
    );

    let should_route_through_workflow = request.execution_policy.prefer_workflow_runtime
        && selection.profile.invocation_kind == CustomTaskAgentInvocationKind::Chat;
    if should_route_through_workflow {
        let execution = match workflow_service::quick_workflow_run(
            &request.app_handle,
            &request.app_state,
            QuickWorkflowRequest {
                goal: query.clone(),
                worker_ref: Some(format!("user_worker_profile:{}", selection.profile.id)),
                inject_into_chat: true,
            },
        )
        .await
        {
            Ok(result) => {
                let workflow_run_id = result.run.id.clone();
                let workflow_status = result.run.status.as_str().to_string();
                let step_count = result.steps.len();
                let status = if result.succeeded { "success" } else { "error" };
                emit_status(
                    "evolve",
                    Some("worker_delegation"),
                    status,
                    if result.succeeded {
                        "worker.task.completed"
                    } else {
                        "worker.task.failed"
                    },
                    Some(json!({
                        "agent_id": selection.profile.id,
                        "agent_name": selection.profile.name,
                        "execution_path": "workflow_runtime",
                        "workflow_run_id": workflow_run_id,
                        "workflow_status": workflow_status,
                        "step_count": step_count,
                    })),
                );
                build_workflow_delegated_worker_execution(&selection.profile, Ok(result))
            }
            Err(err) => {
                emit_status(
                    "evolve",
                    Some("worker_delegation"),
                    "error",
                    "worker.task.failed",
                    Some(json!({
                        "agent_id": selection.profile.id,
                        "agent_name": selection.profile.name,
                        "execution_path": "workflow_runtime",
                        "error": err,
                    })),
                );
                build_workflow_delegated_worker_execution(&selection.profile, Err(err))
            }
        };

        return Ok(Some(execution));
    }

    if request.execution_policy.prefer_workflow_runtime
        && selection.profile.invocation_kind != CustomTaskAgentInvocationKind::Chat
    {
        emit_status(
            "evolve",
            Some("worker_delegation"),
            "success",
            "worker.workflow_route.skipped",
            Some(json!({
                "agent_id": selection.profile.id,
                "agent_name": selection.profile.name,
                "reason": "non_chat_invocation_kind",
                "invocation_kind": selection.profile.invocation_kind.as_str(),
            })),
        );
    }

    let execution = match preview_custom_task_agent(
        &request.app_handle,
        &request.app_state,
        &selection.profile,
        CustomTaskAgentPreviewRequest {
            message: latest_input.prompt.clone(),
            image_urls: latest_input.image_urls.clone(),
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            max_rounds: Some(4),
        },
    )
    .await
    {
        Ok(result) => {
            let render_blocks = build_custom_task_agent_render_blocks(
                &request.app_handle,
                &request.app_state,
                &selection.profile,
                &result,
                Some(&query),
            )
            .await;
            emit_status(
                "evolve",
                Some("worker_delegation"),
                "success",
                "worker.task.completed",
                Some(json!({
                    "agent_id": selection.profile.id,
                    "agent_name": selection.profile.name,
                    "invocation_kind": result.invocation_kind.as_str(),
                    "images": result.images.len(),
                    "audios": result.audios.len(),
                    "tool_trace_count": result.tool_trace.len(),
                })),
            );
            build_delegated_worker_execution(&selection.profile, Ok(result), render_blocks)
        }
        Err(err) => {
            let err_text = err.to_string();
            emit_status(
                "evolve",
                Some("worker_delegation"),
                "error",
                "worker.task.failed",
                Some(json!({
                    "agent_id": selection.profile.id,
                    "agent_name": selection.profile.name,
                    "error": err_text,
                })),
            );
            build_delegated_worker_execution(&selection.profile, Err(err), Vec::new())
        }
    };

    Ok(Some(execution))
}

pub(super) fn latest_user_message(messages: &[LocalChatInputMessage]) -> Option<String> {
    messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.content.clone())
}

fn latest_user_image_input(messages: &[LocalChatInputMessage]) -> LatestUserImageInput {
    let Some(message) = messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
    else {
        return LatestUserImageInput::default();
    };

    let raw_text = message.content.trim().to_string();
    if raw_text.is_empty() {
        return LatestUserImageInput::default();
    }

    let trimmed = raw_text.trim();
    if !(trimmed.starts_with('[') || trimmed.starts_with('{')) {
        return LatestUserImageInput {
            prompt: raw_text.clone(),
            image_urls: Vec::new(),
            raw_text,
        };
    }

    let parsed = match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => value,
        Err(_) => {
            return LatestUserImageInput {
                prompt: raw_text.clone(),
                image_urls: Vec::new(),
                raw_text,
            }
        }
    };
    let items = parsed.as_array().cloned().unwrap_or_else(|| vec![parsed]);
    let mut text_parts = Vec::new();
    let mut image_urls = Vec::new();

    for item in items {
        let Some(object) = item.as_object() else {
            continue;
        };
        let block_type = object
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        match block_type {
            "text" => {
                if let Some(text) = object
                    .get("text")
                    .and_then(|value| value.as_str())
                    .or_else(|| object.get("content").and_then(|value| value.as_str()))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    text_parts.push(text.to_string());
                }
            }
            "image_url" => {
                if let Some(url) = object
                    .get("image_url")
                    .and_then(|value| {
                        value.as_str().map(str::to_string).or_else(|| {
                            value
                                .get("url")
                                .and_then(|entry| entry.as_str())
                                .map(str::to_string)
                        })
                    })
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                {
                    image_urls.push(url);
                }
            }
            _ => {}
        }
    }

    LatestUserImageInput {
        prompt: text_parts.join("\n"),
        image_urls,
        raw_text,
    }
}

fn build_delegated_worker_execution(
    profile: &CustomTaskAgentProfile,
    result: Result<CustomTaskAgentPreviewResponse, CustomTaskAgentRuntimeError>,
    render_blocks: Vec<Value>,
) -> DelegatedWorkerExecution {
    match result {
        Ok(result) => {
            let payload = json!({
                "status": result.status,
                "agent_id": profile.id,
                "agent_name": profile.name,
                "invocation_kind": result.invocation_kind.as_str(),
                "content": result.content,
                "reasoning_content": result.reasoning_content,
                "images": result.images,
                "audios": result.audios,
                "tool_trace": result.tool_trace,
                "callable_mcp_tool_ids": result.callable_mcp_tool_ids,
                "guidance_skill_ids": result.guidance_skill_ids,
                "callable_skill_action_refs": result.callable_skill_action_refs,
                "render_blocks": render_blocks,
            });
            let pretty_payload =
                serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string());
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-agent-{}", profile.id),
                "name": format!("custom_task_agent/{}", profile.name),
                "status": "success",
                "result": payload.clone(),
            })]);
            let system_message = LocalChatInputMessage {
                role: "system".to_string(),
                content: format!(
                    "[Delegated Custom Task Agent Completed: {}]\nUse the delegated result as authoritative for the delegated subtask. Do not re-run the delegated task unless the user asks or the result is blocked.",
                    profile.name
                ),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            };
            let user_message = LocalChatInputMessage {
                role: "user".to_string(),
                content: format!(
                    "## Delegated Agent Result\n{}\n\nUse this delegated result to answer the user's original request. Do not re-run the delegated task.",
                    pretty_payload
                ),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            };
            DelegatedWorkerExecution {
                feedback_messages: vec![system_message, user_message],
                trace_blocks: tool_trace_blocks,
            }
        }
        Err(error) => {
            let error_text = error.message.clone();
            let payload = json!({
                "status": "failed",
                "agent_id": profile.id,
                "agent_name": profile.name,
                "error_code": error.code.clone(),
                "error": error_text,
            });
            let pretty_payload =
                serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string());
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-agent-{}", profile.id),
                "name": format!("custom_task_agent/{}", profile.name),
                "status": "error",
                "error_code": error.code,
                "error": error.message,
            })]);
            let system_message = LocalChatInputMessage {
                role: "system".to_string(),
                content: format!(
                    "[Delegated Custom Task Agent Failed: {}]\nThe delegated task failed. You may continue with your own reasoning and explain the fallback clearly.",
                    profile.name
                ),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            };
            let user_message = LocalChatInputMessage {
                role: "user".to_string(),
                content: format!("## Delegated Agent Failure\n{}", pretty_payload),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            };
            DelegatedWorkerExecution {
                feedback_messages: vec![system_message, user_message],
                trace_blocks: tool_trace_blocks,
            }
        }
    }
}

fn build_workflow_delegated_worker_execution(
    profile: &CustomTaskAgentProfile,
    result: Result<crate::modules::workflow::types::QuickWorkflowResult, String>,
) -> DelegatedWorkerExecution {
    match result {
        Ok(result) => {
            let workflow_run_id = result.run.id.clone();
            let workflow_status = result.run.status.as_str().to_string();
            let primary_content = result.content.clone();
            let step_statuses = result
                .steps
                .iter()
                .map(|step| {
                    json!({
                        "phase_id": step.phase_id,
                        "title": step.title,
                        "status": step.status.as_str(),
                    })
                })
                .collect::<Vec<_>>();
            let status = if result.succeeded {
                "completed"
            } else {
                "failed"
            };
            let payload = json!({
                "status": status,
                "agent_id": profile.id,
                "agent_name": profile.name,
                "workflow_run_id": workflow_run_id.clone(),
                "workflow_status": workflow_status,
                "content": primary_content,
                "steps": step_statuses,
            });
            let pretty_payload =
                serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string());
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-workflow-{}", workflow_run_id),
                "name": format!("workflow/{}", profile.name),
                "status": if result.succeeded { "success" } else { "error" },
                "result": payload.clone(),
            })]);
            let system_message = LocalChatInputMessage {
                role: "system".to_string(),
                content: if result.succeeded {
                    format!(
                        "[Delegated Workflow Completed: {}]\nUse the persisted workflow result as authoritative for the delegated subtask. Do not re-run the delegated task unless the user asks or the result is blocked.",
                        profile.name
                    )
                } else {
                    format!(
                        "[Delegated Workflow Failed: {}]\nThe delegated workflow failed. You may continue with your own reasoning and explain the fallback clearly.",
                        profile.name
                    )
                },
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            };
            let user_message = LocalChatInputMessage {
                role: "user".to_string(),
                content: if result.succeeded {
                    format!(
                        "## Delegated Workflow Result\n{}\n\nUse this delegated workflow result to answer the user's original request. Do not re-run the delegated task.",
                        pretty_payload
                    )
                } else {
                    format!("## Delegated Workflow Failure\n{}", pretty_payload)
                },
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            };
            DelegatedWorkerExecution {
                feedback_messages: vec![system_message, user_message],
                trace_blocks: tool_trace_blocks,
            }
        }
        Err(error) => {
            let payload = json!({
                "status": "failed",
                "agent_id": profile.id,
                "agent_name": profile.name,
                "execution_path": "workflow_runtime",
                "error": error,
            });
            let pretty_payload =
                serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string());
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-workflow-error-{}", profile.id),
                "name": format!("workflow/{}", profile.name),
                "status": "error",
                "error": payload.get("error").cloned().unwrap_or(Value::Null),
            })]);
            let system_message = LocalChatInputMessage {
                role: "system".to_string(),
                content: format!(
                    "[Delegated Workflow Failed: {}]\nThe delegated workflow failed. You may continue with your own reasoning and explain the fallback clearly.",
                    profile.name
                ),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            };
            let user_message = LocalChatInputMessage {
                role: "user".to_string(),
                content: format!("## Delegated Workflow Failure\n{}", pretty_payload),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            };
            DelegatedWorkerExecution {
                feedback_messages: vec![system_message, user_message],
                trace_blocks: tool_trace_blocks,
            }
        }
    }
}

fn build_custom_task_agent_render_blocks(
    app_handle: &AppHandle,
    app_state: &AppState,
    profile: &CustomTaskAgentProfile,
    result: &CustomTaskAgentPreviewResponse,
    prompt: Option<&str>,
) -> futures_util::future::BoxFuture<'static, Vec<Value>> {
    let profile = profile.clone();
    let result = result.clone();
    let prompt = prompt.map(|value| value.to_string());
    let app_state = app_state.clone();
    let app_handle = app_handle.clone();
    Box::pin(async move {
        if result.invocation_kind == CustomTaskAgentInvocationKind::ImageGeneration {
            let outputs =
                persist_custom_task_agent_image_outputs(&app_handle, &app_state, &result).await;
            if outputs.is_empty() {
                return Vec::new();
            }
            let preview = outputs.first().cloned().unwrap_or_else(|| json!({}));
            return vec![json!({
                "view_type": "image.result",
                "title": format!("{} Image Result", profile.name),
                "payload": {
                    "preview": preview,
                    "outputs": outputs,
                    "prompt": prompt.unwrap_or_default(),
                    "model": result.model_id,
                },
                "metadata": {
                    "agentId": profile.id,
                    "agentName": profile.name,
                    "invocationKind": result.invocation_kind.as_str(),
                    "providerModelId": result.provider_model_id,
                }
            })];
        }

        if result.invocation_kind == CustomTaskAgentInvocationKind::TextToSpeech {
            let Some(payload) = result.raw.as_ref() else {
                return Vec::new();
            };
            let Some(audio_payload) = serde_json::from_value(payload.clone()).ok() else {
                return Vec::new();
            };
            let title = format!("{} Audio Result", profile.name);
            return vec![build_audio_result_block(
                profile.id.as_str(),
                Some(title.as_str()),
                &audio_payload,
                Some(json!({
                    "agentId": profile.id,
                    "agentName": profile.name,
                    "invocationKind": result.invocation_kind.as_str(),
                    "providerModelId": result.provider_model_id,
                })),
            )];
        }

        Vec::new()
    })
}

#[cfg(test)]
mod tests {
    use super::{latest_user_image_input, LatestUserImageInput};
    use mcp_core::types::LocalChatInputMessage;

    #[test]
    fn latest_user_image_input_reads_structured_text_and_images() {
        let input = latest_user_image_input(&[LocalChatInputMessage {
            role: "user".to_string(),
            content: r#"[{"type":"text","text":"draw a cat"},{"type":"image_url","image_url":{"url":"asset://chat-assets/demo.png"}},{"type":"image_url","image_url":{"url":"local-asset://abc123"}}]"#.to_string(),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        }]);

        assert_eq!(input.prompt, "draw a cat");
        assert_eq!(
            input.image_urls,
            vec![
                "asset://chat-assets/demo.png".to_string(),
                "local-asset://abc123".to_string()
            ]
        );
    }

    #[test]
    fn latest_user_image_input_keeps_plain_text_messages() {
        let input = latest_user_image_input(&[LocalChatInputMessage {
            role: "user".to_string(),
            content: "@image-agent draw a cat".to_string(),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        }]);

        assert_eq!(
            input,
            LatestUserImageInput {
                prompt: "@image-agent draw a cat".to_string(),
                image_urls: vec![],
                raw_text: "@image-agent draw a cat".to_string(),
            }
        );
    }
}

async fn persist_custom_task_agent_image_outputs(
    app_handle: &AppHandle,
    app_state: &AppState,
    result: &CustomTaskAgentPreviewResponse,
) -> Vec<Value> {
    if let Some(outputs) = result
        .raw
        .as_ref()
        .and_then(|raw| raw.get("outputs"))
        .and_then(Value::as_array)
    {
        return outputs.to_vec();
    }
    let raw_items = result
        .raw
        .as_ref()
        .and_then(|raw| raw.get("data"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut outputs = Vec::new();
    for (index, image) in result.images.iter().enumerate() {
        let raw_item = raw_items.get(index);
        let content_type = raw_item
            .and_then(|item| item.get("content_type"))
            .and_then(Value::as_str)
            .unwrap_or_else(|| infer_image_content_type(image))
            .to_string();
        let persisted =
            persist_custom_task_agent_image(app_handle, app_state, image, &content_type).await;
        let (asset_url, source_url, size_bytes) = match persisted {
            Some(PersistedImageLocation::ObjectStorage {
                object_key,
                public_url,
                size_bytes,
            }) => (
                public_url.map(Value::String).unwrap_or(Value::Null),
                Value::String(format!("asset://{}", object_key)),
                json!(size_bytes),
            ),
            Some(PersistedImageLocation::Local { sha256, size_bytes }) => (
                Value::Null,
                Value::String(format!("local-asset://{}", sha256)),
                json!(size_bytes),
            ),
            None => (Value::Null, Value::String(image.clone()), Value::Null),
        };

        outputs.push(json!({
            "output_index": index,
            "asset_url": asset_url,
            "source_url": source_url,
            "seed": raw_item.and_then(|item| item.get("seed")).cloned().unwrap_or(Value::Null),
            "content_type": content_type,
            "size_bytes": size_bytes,
            "width": raw_item.and_then(|item| item.get("width")).cloned().unwrap_or(Value::Null),
            "height": raw_item.and_then(|item| item.get("height")).cloned().unwrap_or(Value::Null),
        }));
    }
    outputs
}

enum PersistedImageLocation {
    ObjectStorage {
        object_key: String,
        public_url: Option<String>,
        size_bytes: usize,
    },
    Local {
        sha256: String,
        size_bytes: usize,
    },
}

async fn persist_custom_task_agent_image(
    app_handle: &AppHandle,
    app_state: &AppState,
    image: &str,
    content_type: &str,
) -> Option<PersistedImageLocation> {
    let bytes = if let Some(bytes) = decode_data_url_bytes(image) {
        bytes
    } else if image.trim_start().starts_with("http://")
        || image.trim_start().starts_with("https://")
    {
        let response = app_state
            .mcp
            .transport
            .client
            .get(image)
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.bytes().await.ok()?.to_vec()
    } else {
        return None;
    };
    let sha256 = compute_sha256_hex(&bytes);
    let ext = image_ext_from_content_type(content_type);
    let object_key = format!("chat-assets/generated/{}.{}", sha256, ext);

    match app_state
        .providers
        .store
        .put_local_desktop_object_storage_bytes(&object_key, content_type, &bytes)
        .await
    {
        Ok(Some(saved_object_key)) => {
            let public_url = app_state
                .providers
                .store
                .get_local_desktop_object_storage_config()
                .await
                .ok()
                .flatten()
                .and_then(|config| config.build_public_url(&saved_object_key));
            Some(PersistedImageLocation::ObjectStorage {
                object_key: saved_object_key,
                public_url,
                size_bytes: bytes.len(),
            })
        }
        Ok(None) | Err(_) => {
            let app_data_dir = app_handle.path().app_data_dir().ok();
            let dir = resolve_chat_assets_dir(app_data_dir);
            std::fs::create_dir_all(&dir).ok()?;
            let path = dir.join(format!("{}.{}", sha256, ext));
            if !path.exists() {
                std::fs::write(&path, &bytes).ok()?;
            }
            Some(PersistedImageLocation::Local {
                sha256,
                size_bytes: bytes.len(),
            })
        }
    }
}

fn decode_data_url_bytes(value: &str) -> Option<Vec<u8>> {
    let trimmed = value.trim();
    let marker = ";base64,";
    let idx = trimmed.find(marker)?;
    let encoded = &trimmed[idx + marker.len()..];
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()
}

fn infer_image_content_type(value: &str) -> &str {
    let trimmed = value.trim();
    if let Some(rest) = trimmed.strip_prefix("data:") {
        if let Some(idx) = rest.find(';') {
            let content_type = &rest[..idx];
            if !content_type.trim().is_empty() {
                return content_type;
            }
        }
    }
    "image/png"
}

fn image_ext_from_content_type(content_type: &str) -> &str {
    match content_type {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        _ => "bin",
    }
}

fn compute_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}
