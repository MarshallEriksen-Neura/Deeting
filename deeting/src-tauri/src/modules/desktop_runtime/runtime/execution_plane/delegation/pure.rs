use crate::modules::custom_task_agents::types::CustomTaskAgentInvocationKind;
use crate::modules::custom_task_agents::types::CustomTaskAgentPreviewRequest;
use crate::modules::desktop_runtime::runtime::worker_dispatch::WorkerTaskPacket;
use crate::modules::workflow::types::QuickWorkflowRequest;
use desktop_runtime_core::PhaseStepType;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::modules::desktop_runtime::runtime::execution_plane) enum WorkerDelegationExecution {
    CustomTaskAgent,
    Workflow,
    SkipWorkflowForNonChatInvocation,
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) fn resolve_worker_delegation_execution(
    step_type: PhaseStepType,
    invocation_kind: &CustomTaskAgentInvocationKind,
) -> WorkerDelegationExecution {
    match (step_type, invocation_kind) {
        (PhaseStepType::DelegatedWorkflow, CustomTaskAgentInvocationKind::Chat) => {
            WorkerDelegationExecution::Workflow
        }
        (PhaseStepType::DelegatedWorkflow, _) => {
            WorkerDelegationExecution::SkipWorkflowForNonChatInvocation
        }
        _ => WorkerDelegationExecution::CustomTaskAgent,
    }
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) fn build_delegated_workflow_request(
    goal: String,
    worker_ref: String,
    user_notes: String,
    execution_model_id: String,
    execution_provider_model_id: String,
    task_packet: WorkerTaskPacket,
) -> QuickWorkflowRequest {
    QuickWorkflowRequest {
        goal,
        worker_ref: Some(worker_ref),
        inject_into_chat: true,
        user_notes: Some(user_notes),
        execution_model_id: Some(execution_model_id),
        execution_provider_model_id: Some(execution_provider_model_id),
        worker_task_packet: Some(task_packet),
    }
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) fn build_custom_task_agent_preview_request(
    message: String,
    image_urls: Vec<String>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    max_rounds: u32,
    task_packet: &WorkerTaskPacket,
) -> CustomTaskAgentPreviewRequest {
    CustomTaskAgentPreviewRequest {
        message,
        image_urls,
        temperature,
        max_tokens,
        max_rounds: Some(max_rounds),
        worker_task_packet: Some(task_packet.as_value()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn workflow_phase_uses_workflow_runtime_for_chat_agents() {
        assert_eq!(
            resolve_worker_delegation_execution(
                PhaseStepType::DelegatedWorkflow,
                &CustomTaskAgentInvocationKind::Chat,
            ),
            WorkerDelegationExecution::Workflow,
        );
    }

    #[test]
    fn workflow_phase_falls_back_for_non_chat_agents() {
        assert_eq!(
            resolve_worker_delegation_execution(
                PhaseStepType::DelegatedWorkflow,
                &CustomTaskAgentInvocationKind::ImageGeneration,
            ),
            WorkerDelegationExecution::SkipWorkflowForNonChatInvocation,
        );
    }

    #[test]
    fn delegated_worker_phase_uses_custom_task_agent_runtime() {
        assert_eq!(
            resolve_worker_delegation_execution(
                PhaseStepType::DelegatedWorker,
                &CustomTaskAgentInvocationKind::Chat,
            ),
            WorkerDelegationExecution::CustomTaskAgent,
        );
    }

    #[test]
    fn workflow_request_preserves_execution_model_and_packet() {
        let packet = WorkerTaskPacket {
            schema_version: 1,
            task_id: "task-1".to_string(),
            route: "worker".to_string(),
            goal: "answer the question".to_string(),
            user_query: "answer the question".to_string(),
            task_kind: "custom_task_agent".to_string(),
            deliverable_kind: "answer".to_string(),
            context_summary: "bounded delegated task".to_string(),
            relevant_inputs: json!({
                "raw_user_text": "answer the question",
                "image_urls": [],
            }),
            required_capabilities: vec!["search_sdk".to_string()],
            candidate_capabilities: vec!["search_sdk".to_string()],
            constraints: vec!["stay scoped".to_string()],
            non_goals: vec!["do not reroute".to_string()],
            allowed_actions: vec!["answer".to_string()],
            forbidden_actions: vec!["reroute".to_string()],
            output_contract: json!({ "kind": "answer" }),
            completion_standard: "return an answer".to_string(),
            escalation_policy: "return blocked when missing evidence".to_string(),
            packet_hash: "hash-1".to_string(),
        };

        let request = build_delegated_workflow_request(
            "answer the question".to_string(),
            "user_worker_profile:agent-1".to_string(),
            "notes".to_string(),
            "model-1".to_string(),
            "provider-model-1".to_string(),
            packet,
        );

        assert_eq!(
            request.worker_ref.as_deref(),
            Some("user_worker_profile:agent-1")
        );
        assert_eq!(request.execution_model_id.as_deref(), Some("model-1"));
        assert_eq!(
            request.execution_provider_model_id.as_deref(),
            Some("provider-model-1")
        );
        assert!(request.inject_into_chat);
        assert!(request.worker_task_packet.is_some());
    }
}
