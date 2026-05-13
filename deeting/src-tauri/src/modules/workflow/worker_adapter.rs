use crate::modules::ai_upstream::{
    request_provider_chat_completion, resolve_local_model_connection,
};
use crate::modules::custom_task_agents::runtime::preview_custom_task_agent;
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentPreviewRequest, CustomTaskAgentProfile,
};
use crate::modules::mcp::store::McpStore;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
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
    let (requested_model, requested_provider_model_id) =
        direct_llm_model_resolution_request(profile_slug);
    let model_connection = resolve_local_model_connection(
        app_state,
        &requested_model,
        requested_provider_model_id.as_deref(),
    )
    .await
    .map_err(|err| format!("Failed to resolve model: {err}"))?;
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

    let response = request_provider_chat_completion(
        app_state,
        &model_connection.provider_model_id,
        &model_connection.model_id,
        messages,
        None,
        input.temperature.or(Some(0.3)),
        input.max_tokens.or(Some(4096)),
        crate::modules::ai_upstream::ReasoningRequestConfig::default(),
        None,
        None,
    )
    .await?;

    let content = response
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
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
        error: if status == "failed" {
            Some("LLM returned empty response".to_string())
        } else {
            None
        },
    })
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
        build_worker_profile_preview_request, direct_llm_model_resolution_request,
        normalize_execution_status,
    };
    use crate::modules::workflow::types::{
        ContextConstraints, ContextInputs, ContextJson, ContextPacket, WorkerExecutionInput,
    };
    use serde_json::json;

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
    fn build_worker_profile_preview_request_forwards_worker_task_packet() {
        let packet: crate::modules::desktop_runtime::runtime::worker_dispatch::WorkerTaskPacket =
            serde_json::from_value(json!({
            "schema_version": 1,
            "task_id": "exec-1",
            "route": "worker",
            "goal": "Analyze findings",
            "user_query": "Analyze findings",
            "task_kind": "analysis",
            "deliverable_kind": "structured_findings",
            "context_summary": "runtime-selected worker",
            "relevant_inputs": {},
            "required_capabilities": ["tool.search"],
            "candidate_capabilities": ["search_sdk"],
            "constraints": ["Stay scoped"],
            "non_goals": ["Do not reroute"],
            "allowed_actions": ["Analyze"],
            "forbidden_actions": ["Reroute"],
            "output_contract": {"kind":"structured_findings"},
            "completion_standard": "Return findings",
            "escalation_policy": "Block explicitly",
            "packet_hash": "packet-123"
            }))
            .expect("worker task packet");
        let input = WorkerExecutionInput {
            run_id: "run-1".to_string(),
            phase_id: "phase-1".to_string(),
            worker_ref: "user_worker_profile:research".to_string(),
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
                    worker_ref: "user_worker_profile:research".to_string(),
                    goal: "Analyze findings".to_string(),
                    constraints: ContextConstraints {
                        timeout_ms: 1000,
                        allowed_tools: Vec::new(),
                    },
                    inputs: ContextInputs::default(),
                    expected_output: None,
                    worker_task_packet: Some(packet.clone()),
                },
                worker_task_packet: Some(packet),
            },
            temperature: Some(0.2),
            max_tokens: Some(2048),
            max_rounds: Some(3),
        };

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
}
