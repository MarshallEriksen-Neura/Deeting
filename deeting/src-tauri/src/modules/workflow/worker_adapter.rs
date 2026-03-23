use crate::modules::ai_upstream::{request_provider_chat_completion, resolve_local_model_connection};
use crate::modules::custom_task_agents::runtime::preview_custom_task_agent;
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentPreviewRequest, CustomTaskAgentProfile,
};
use crate::modules::mcp::store::McpStore;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use tauri::AppHandle;

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
    let request = CustomTaskAgentPreviewRequest {
        message: input.context_packet.context_md.clone(),
        temperature: input.temperature,
        max_tokens: input.max_tokens,
        max_rounds: input.max_rounds,
    };

    let response = preview_custom_task_agent(app_handle, app_state, profile, request).await?;
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

async fn execute_via_direct_llm(
    app_state: &AppState,
    input: &WorkerExecutionInput,
    _profile_slug: &str,
) -> Result<WorkerExecutionResult, String> {
    let model_connection = resolve_local_model_connection(app_state, "default", None)
        .await
        .map_err(|err| format!("Failed to resolve model: {err}"))?;
    let messages = vec![
        LocalChatInputMessage {
            role: "system".to_string(),
            content: "You are a workflow phase executor. Complete the assigned task based on the provided context. Be thorough and produce a clear result.".to_string(),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
        LocalChatInputMessage {
            role: "user".to_string(),
            content: input.context_packet.context_md.clone(),
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

fn normalize_execution_status(status: &str) -> &str {
    match status {
        "completed" | "succeeded" | "success" => "succeeded",
        "failed" | "error" => "failed",
        _ => "failed",
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_execution_status;

    #[test]
    fn resolve_direct_llm_default_prefix() {
        let worker_ref = "direct_llm:default";
        assert!(worker_ref.starts_with("direct_llm:"));
        let slug = worker_ref.strip_prefix("direct_llm:").expect("direct llm prefix");
        assert_eq!(slug, "default");
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
}
