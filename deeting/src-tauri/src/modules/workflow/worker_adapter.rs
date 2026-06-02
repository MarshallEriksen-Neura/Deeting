use crate::modules::ai_upstream::{
    request_provider_chat_completion_with_pool_failover, resolve_local_model_connection,
};
use crate::modules::custom_task_agents::runtime::preview_custom_task_agent;
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentPreviewRequest, CustomTaskAgentProfile,
};
use crate::modules::desktop_runtime::runtime::worker_dispatch::{
    delegated_agent_task_input_source, WorkerTargetSelection, WorkerTaskPacket,
};
use crate::modules::mcp::store::McpStore;
use crate::modules::providers::model_guard::resolve_local_secretary_model_connection;
use crate::state::AppState;
use desktop_runtime_core::{ApprovalInheritance, DelegationReturnChannel};
use mcp_core::types::LocalChatInputMessage;
use serde_json::Value;
use tauri::AppHandle;
use uuid::Uuid;

use crate::modules::workflow::types::{
    ResolvedWorker, WorkerExecutionInput, WorkerExecutionResult,
};

pub(crate) async fn resolve_worker(
    store: &McpStore,
    worker_ref: &str,
) -> Result<ResolvedWorker, String> {
    if let Some(profile_id) = worker_ref.strip_prefix("user_worker_profile:") {
        let profile = store
            .list_custom_task_agents()
            .await
            .map_err(|err| err.to_string())?
            .into_iter()
            .find(|profile| {
                (profile.id == profile_id || profile.name == profile_id)
                    && profile.is_enabled
                    && !profile.is_deleted
            })
            .ok_or_else(|| format!("Worker profile not found or disabled: {profile_id}"))?;
        Ok(ResolvedWorker::UserWorkerProfile { profile })
    } else if let Some(slug) = worker_ref.strip_prefix("direct_llm:") {
        Ok(ResolvedWorker::DirectLlm {
            profile_slug: slug.to_string(),
        })
    } else if worker_ref.starts_with("system_worker_template:") {
        Ok(ResolvedWorker::DirectLlm {
            profile_slug: "default".to_string(),
        })
    } else {
        Ok(ResolvedWorker::DirectLlm {
            profile_slug: "default".to_string(),
        })
    }
}

pub(crate) async fn execute_phase(
    app_handle: &AppHandle,
    app_state: &AppState,
    input: &WorkerExecutionInput,
    resolved: &ResolvedWorker,
) -> Result<WorkerExecutionResult, String> {
    match resolved {
        ResolvedWorker::UserWorkerProfile { profile } => {
            execute_via_worker_profile(app_handle, app_state, input, profile).await
        }
        ResolvedWorker::DirectLlm { profile_slug } => {
            execute_via_direct_llm(app_state, input, profile_slug).await
        }
    }
}

async fn execute_via_worker_profile(
    app_handle: &AppHandle,
    app_state: &AppState,
    input: &WorkerExecutionInput,
    profile: &CustomTaskAgentProfile,
) -> Result<WorkerExecutionResult, String> {
    let request = build_worker_profile_preview_request(input);

    let response = preview_custom_task_agent(app_handle, app_state, profile, request)
        .await
        .map_err(|err| err.to_string())?;
    let status = normalize_execution_status(&response.status);

    Ok(WorkerExecutionResult {
        status: status.to_string(),
        content: response.content,
        model_id: response.model_id,
        provider_model_id: response.provider_model_id,
        tool_trace: response.tool_trace,
        images: response.images,
        metadata: build_worker_profile_result_metadata(input, profile),
        error: if status == "failed" {
            Some("Worker execution reported error status".to_string())
        } else {
            None
        },
    })
}

fn build_worker_profile_preview_request(
    input: &WorkerExecutionInput,
) -> CustomTaskAgentPreviewRequest {
    let worker_task_packet = input
        .context_packet
        .worker_task_packet
        .as_ref()
        .and_then(|packet| serde_json::to_value(packet).ok())
        .or_else(|| {
            input
                .context_packet
                .context_json
                .worker_task_packet
                .as_ref()
                .and_then(|packet| serde_json::to_value(packet).ok())
        });

    CustomTaskAgentPreviewRequest {
        message: input.context_packet.context_md.clone(),
        temperature: input.temperature,
        max_tokens: input.max_tokens,
        max_rounds: input.max_rounds,
        image_urls: Vec::new(),
        worker_task_packet,
    }
}

async fn execute_via_direct_llm(
    app_state: &AppState,
    input: &WorkerExecutionInput,
    profile_slug: &str,
) -> Result<WorkerExecutionResult, String> {
    let model_connection = if profile_slug.trim().is_empty() || profile_slug.trim() == "default" {
        resolve_local_secretary_model_connection(app_state)
            .await
            .map_err(|err| format!("Failed to resolve default workflow model: {err}"))?
    } else {
        let (requested_model, requested_provider_model_id) =
            direct_llm_model_resolution_request(profile_slug);
        resolve_local_model_connection(
            app_state,
            &requested_model,
            requested_provider_model_id.as_deref(),
        )
        .await
        .map_err(|err| format!("Failed to resolve model: {err}"))?
    };
    let messages = vec![
        LocalChatInputMessage {
            role: "system".to_string(),
            content: "You are a workflow phase executor. Complete the assigned task based on the provided context. Be thorough and produce a clear result.".to_string(),
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
        LocalChatInputMessage {
            role: "user".to_string(),
            content: input.context_packet.context_md.clone(),
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
    ];

    let trace_id = format!("workflow:{}:{}", input.run_id, input.phase_id);
    let response = request_provider_chat_completion_with_pool_failover(
        app_state,
        &model_connection.provider_model_id,
        &model_connection.model_id,
        messages,
        None,
        input.temperature.or(Some(0.3)),
        input.max_tokens.or(Some(4096)),
        crate::modules::ai_upstream::ReasoningRequestConfig::default(),
        model_connection.failover_pool_key.as_deref(),
        Some(trace_id.as_str()),
        None,
    )
    .await?;

    let content = extract_chat_response_content(&response);
    let status = if content.trim().is_empty() {
        "failed"
    } else {
        "succeeded"
    };

    Ok(WorkerExecutionResult {
        status: status.to_string(),
        content,
        model_id: model_connection.model_id,
        provider_model_id: model_connection.provider_model_id,
        tool_trace: Vec::new(),
        images: Vec::new(),
        metadata: None,
        error: if status == "failed" {
            Some("LLM returned empty response".to_string())
        } else {
            None
        },
    })
}

fn extract_chat_response_content(response: &Value) -> String {
    let mut content = extract_text_value(response.get("content"));
    if content.trim().is_empty() {
        content = response
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|choice| {
                choice
                    .get("message")
                    .and_then(|message| message.get("content"))
                    .or_else(|| choice.get("text"))
            })
            .map(|value| extract_text_value(Some(value)))
            .unwrap_or_default();
    }
    if content.trim().is_empty() {
        content = extract_text_value(response.get("completion"));
    }
    if content.trim().is_empty()
        && response
            .get("tool_calls")
            .and_then(Value::as_array)
            .map(|items| items.is_empty())
            .unwrap_or(true)
    {
        content = extract_text_value(response.get("reasoning_content"));
    }
    content
}

fn extract_text_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| {
                let object = item.as_object()?;
                let block_type = object.get("type").and_then(Value::as_str);
                if matches!(block_type, Some("tool_use") | Some("server_tool_use")) {
                    return None;
                }
                object
                    .get("text")
                    .and_then(Value::as_str)
                    .or_else(|| object.get("content").and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(ToString::to_string)
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(Value::Object(object)) => object
            .get("text")
            .and_then(Value::as_str)
            .or_else(|| object.get("content").and_then(Value::as_str))
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToString::to_string)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn build_worker_profile_result_metadata(
    input: &WorkerExecutionInput,
    profile: &CustomTaskAgentProfile,
) -> Option<Value> {
    let packet = workflow_worker_task_packet(input)?;
    let selection = WorkerTargetSelection {
        profile: profile.clone(),
        score: 0,
        reason: "workflow_worker_ref".to_string(),
        reason_codes: vec!["workflow_worker_ref".to_string()],
        candidate_count: 1,
        selected_from_top_k: 1,
        callable_coverage_score: 1.0,
        modality_fit_score: 1.0,
        profile_prior_score: 0.0,
    };
    let fallback_child_run_id = format!("workflow:{}:phase:{}", input.run_id, input.phase_id);
    let task_input_source = workflow_task_input_source(input)
        .cloned()
        .unwrap_or_else(|| {
            serde_json::to_value(delegated_agent_task_input_source(
                &selection,
                packet,
                None,
                Some(fallback_child_run_id.clone()),
                DelegationReturnChannel::WorkflowEvent,
                ApprovalInheritance::ParentDecides,
            ))
            .unwrap_or(Value::Null)
        });

    Some(serde_json::json!({
        "execution_path": "workflow_worker_profile",
        "worker_task_packet": packet,
        "task_input_source": task_input_source,
    }))
}

fn workflow_worker_task_packet(input: &WorkerExecutionInput) -> Option<&WorkerTaskPacket> {
    input.context_packet.worker_task_packet.as_ref().or(input
        .context_packet
        .context_json
        .worker_task_packet
        .as_ref())
}

fn workflow_task_input_source(input: &WorkerExecutionInput) -> Option<&Value> {
    input.context_packet.task_input_source.as_ref().or(input
        .context_packet
        .context_json
        .task_input_source
        .as_ref())
}

fn direct_llm_model_resolution_request(profile_slug: &str) -> (String, Option<String>) {
    let trimmed = profile_slug.trim();
    if trimmed.is_empty() || trimmed == "default" {
        return ("default".to_string(), None);
    }

    if Uuid::parse_str(trimmed).is_ok() {
        return ("".to_string(), Some(trimmed.to_string()));
    }

    (trimmed.to_string(), None)
}

fn normalize_execution_status(status: &str) -> &str {
    match status {
        "completed" | "succeeded" | "success" => "succeeded",
        "failed" | "error" => "failed",
        _ => "failed",
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_worker_profile_preview_request, build_worker_profile_result_metadata,
        direct_llm_model_resolution_request, extract_chat_response_content,
        normalize_execution_status,
    };
    use crate::modules::custom_task_agents::types::{
        CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
    };
    use crate::modules::desktop_runtime::runtime::worker_dispatch::WorkerTaskPacket;
    use crate::modules::workflow::types::{
        ContextConstraints, ContextInputs, ContextJson, ContextPacket, WorkerExecutionInput,
    };
    use serde_json::json;

    fn worker_task_packet() -> WorkerTaskPacket {
        serde_json::from_value(json!({
            "schema_version": 1,
            "task_id": "exec-1",
            "goal": "Analyze findings",
            "user_query": "Analyze findings",
            "task_kind": "analysis",
            "deliverable_kind": "structured_findings",
            "context_summary": "delegated worker phase",
            "relevant_inputs": {},
            "required_capabilities": ["tool.search"],
            "candidate_capabilities": ["search_sdk"],
            "constraints": ["Stay scoped"],
            "non_goals": ["Do not change the delegated phase boundary"],
            "allowed_actions": ["Analyze"],
            "forbidden_actions": ["Change delegated phase boundary"],
            "output_contract": {"kind":"structured_findings"},
            "completion_standard": "Return findings",
            "escalation_policy": "Block explicitly",
            "packet_hash": "packet-123"
        }))
        .expect("worker task packet")
    }

    fn worker_execution_input(packet: WorkerTaskPacket) -> WorkerExecutionInput {
        WorkerExecutionInput {
            run_id: "run-1".to_string(),
            phase_id: "phase-1".to_string(),
            worker_ref: "user_worker_profile:research.worker".to_string(),
            context_packet: ContextPacket {
                run_id: "run-1".to_string(),
                phase_id: "phase-1".to_string(),
                phase_title: "Research".to_string(),
                context_md: "## Task".to_string(),
                context_json: ContextJson {
                    run_id: "run-1".to_string(),
                    phase_id: "phase-1".to_string(),
                    phase_title: "Research".to_string(),
                    proposal_version: 1,
                    snapshot_version: 1,
                    worker_ref: "user_worker_profile:research.worker".to_string(),
                    goal: "Analyze findings".to_string(),
                    constraints: ContextConstraints {
                        timeout_ms: 1000,
                        allowed_tools: Vec::new(),
                    },
                    inputs: ContextInputs::default(),
                    expected_output: None,
                    worker_task_packet: Some(packet.clone()),
                    task_input_source: None,
                },
                worker_task_packet: Some(packet),
                task_input_source: None,
            },
            temperature: Some(0.2),
            max_tokens: Some(2048),
            max_rounds: Some(3),
        }
    }

    fn worker_profile() -> CustomTaskAgentProfile {
        CustomTaskAgentProfile {
            id: "research.worker".to_string(),
            name: "Research Worker".to_string(),
            description: Some("Researches delegated workflow phases".to_string()),
            task_prompt: "Complete the delegated task.".to_string(),
            invocation_kind: CustomTaskAgentInvocationKind::Chat,
            preferred_for_image_generation: false,
            model_config: None,
            callable_mcp_tool_ids: vec!["tool.search".to_string()],
            guidance_skill_ids: Vec::new(),
            callable_skill_action_refs: Vec::new(),
            bound_asset_id: None,
            tags: vec!["research".to_string()],
            discoverable: true,
            is_enabled: true,
            is_deleted: false,
            source_kind: None,
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "2026-05-25T00:00:00Z".to_string(),
            updated_at: "2026-05-25T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn resolve_direct_llm_default_prefix() {
        let worker_ref = "direct_llm:default";
        assert!(worker_ref.starts_with("direct_llm:"));
        let slug = worker_ref
            .strip_prefix("direct_llm:")
            .expect("direct llm prefix");
        assert_eq!(slug, "default");
    }

    #[test]
    fn direct_llm_default_uses_default_model_resolution() {
        assert_eq!(
            direct_llm_model_resolution_request("default"),
            ("default".to_string(), None)
        );
        assert_eq!(
            direct_llm_model_resolution_request(""),
            ("default".to_string(), None)
        );
    }

    #[test]
    fn direct_llm_uuid_slug_resolves_as_provider_model_id() {
        assert_eq!(
            direct_llm_model_resolution_request("22222222-2222-4222-8222-222222222222"),
            (
                "".to_string(),
                Some("22222222-2222-4222-8222-222222222222".to_string())
            )
        );
    }

    #[test]
    fn direct_llm_named_slug_resolves_as_model_key() {
        assert_eq!(
            direct_llm_model_resolution_request("gpt-4o-mini"),
            ("gpt-4o-mini".to_string(), None)
        );
    }

    #[test]
    fn resolve_user_worker_profile_prefix() {
        let worker_ref = "user_worker_profile:abc-123";
        assert!(worker_ref.starts_with("user_worker_profile:"));
        let profile_id = worker_ref
            .strip_prefix("user_worker_profile:")
            .expect("profile prefix");
        assert_eq!(profile_id, "abc-123");
    }

    #[test]
    fn system_worker_template_is_currently_deferred() {
        let worker_ref = "system_worker_template:researcher";
        assert!(worker_ref.starts_with("system_worker_template:"));
    }

    #[test]
    fn normalize_execution_status_maps_completed_to_succeeded() {
        assert_eq!(normalize_execution_status("completed"), "succeeded");
        assert_eq!(normalize_execution_status("error"), "failed");
    }

    #[test]
    fn extract_chat_response_content_reads_normalized_content() {
        let response = json!({ "content": " phase result " });
        assert_eq!(extract_chat_response_content(&response), "phase result");
    }

    #[test]
    fn extract_chat_response_content_reads_openai_choice_content() {
        let response = json!({
            "choices": [{
                "message": { "content": "choice result" },
                "finish_reason": "stop"
            }]
        });
        assert_eq!(extract_chat_response_content(&response), "choice result");
    }

    #[test]
    fn extract_chat_response_content_reads_structured_text_blocks() {
        let response = json!({
            "choices": [{
                "message": {
                    "content": [
                        { "type": "text", "text": "line 1" },
                        { "type": "tool_use", "name": "search" },
                        { "type": "text", "text": "line 2" }
                    ]
                }
            }]
        });
        assert_eq!(extract_chat_response_content(&response), "line 1\nline 2");
    }

    #[test]
    fn extract_chat_response_content_falls_back_to_reasoning_without_tools() {
        let response = json!({
            "content": "",
            "reasoning_content": "visible terminal answer",
            "tool_calls": []
        });
        assert_eq!(
            extract_chat_response_content(&response),
            "visible terminal answer"
        );
    }

    #[test]
    fn build_worker_profile_preview_request_forwards_worker_task_packet() {
        let input = worker_execution_input(worker_task_packet());

        let request = build_worker_profile_preview_request(&input);
        assert_eq!(
            request
                .worker_task_packet
                .as_ref()
                .and_then(|value| value.get("packet_hash"))
                .and_then(|value| value.as_str()),
            Some("packet-123")
        );
    }

    #[test]
    fn worker_profile_result_metadata_carries_workflow_delegation_source() {
        let input = worker_execution_input(worker_task_packet());
        let metadata = build_worker_profile_result_metadata(&input, &worker_profile())
            .expect("workflow worker metadata");

        assert_eq!(
            metadata
                .pointer("/worker_task_packet/packet_hash")
                .and_then(serde_json::Value::as_str),
            Some("packet-123")
        );
        assert_eq!(
            metadata
                .pointer("/task_input_source/delegated_agent/agent_id")
                .and_then(serde_json::Value::as_str),
            Some("research.worker")
        );
        assert_eq!(
            metadata
                .pointer("/task_input_source/delegated_agent/child_run_id")
                .and_then(serde_json::Value::as_str),
            Some("workflow:run-1:phase:phase-1")
        );
        assert_eq!(
            metadata
                .pointer("/task_input_source/delegated_agent/child_frame_id")
                .and_then(serde_json::Value::as_str),
            Some("delegation:workflow:run-1:phase:phase-1")
        );
        assert_eq!(
            metadata
                .pointer("/task_input_source/delegated_agent/return_channel")
                .and_then(serde_json::Value::as_str),
            Some("workflow_event")
        );
        assert_eq!(
            metadata
                .pointer("/task_input_source/delegated_agent/approval_inheritance")
                .and_then(serde_json::Value::as_str),
            Some("parent_decides")
        );
    }

    #[test]
    fn worker_profile_result_metadata_prefers_carried_workflow_task_input_source() {
        let mut input = worker_execution_input(worker_task_packet());
        let carried_source = json!({
            "delegated_agent": {
                "parent_frame_id": "frame-parent-1",
                "agent_id": "research.worker",
                "return_channel": "workflow_event"
            }
        });
        input.context_packet.task_input_source = Some(carried_source.clone());
        input.context_packet.context_json.task_input_source = Some(json!({
            "delegated_agent": {
                "parent_frame_id": "stale-context-json-frame"
            }
        }));

        let metadata = build_worker_profile_result_metadata(&input, &worker_profile())
            .expect("workflow worker metadata");

        assert_eq!(
            metadata
                .pointer("/task_input_source/delegated_agent/parent_frame_id")
                .and_then(serde_json::Value::as_str),
            Some("frame-parent-1")
        );
        assert_eq!(metadata.get("task_input_source"), Some(&carried_source));
    }
}
