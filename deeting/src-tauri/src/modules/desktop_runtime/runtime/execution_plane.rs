mod chat_completion;
mod composition;
mod delegation;
mod dispatch;
mod execution_graph_projection;
mod request;
mod user_input;

pub(crate) use delegation::{
    build_custom_task_agent_delegated_execution_session, build_delegated_result_feedback_messages,
    build_workflow_delegated_execution_session, DelegatedExecutionAction,
    DelegatedExecutionChildRecord, DelegatedExecutionKind, DelegatedExecutionPacketReceipt,
    DelegatedExecutionRecord, DelegatedExecutionSelection, DelegatedExecutionSession,
    DelegatedExecutionStatus, DelegatedExecutionTarget, DELEGATED_RESULT_SCHEMA_VERSION,
    EXECUTION_TREE_SCHEMA_VERSION,
};
pub(crate) use composition::phase_step::{
    phase_step_for_observable_frame_strategy, phase_step_type_name,
};
pub(crate) use dispatch::run_local_runtime_composition_entrypoint;
pub(crate) use request::{LocalExecutionOutcome, LocalExecutionRequest};

#[cfg(test)]
use composition::phase_step::initial_phase_step_for_policy;
#[cfg(test)]
use delegation::should_return_delegated_result_directly;

#[cfg(test)]
mod tests {
    use super::user_input::latest_user_message;
    use super::*;
    use crate::modules::desktop_runtime::runtime::build_default_local_execution_policy;
    use desktop_runtime_core::PhaseStepType;
    use mcp_core::types::LocalChatInputMessage;
    use serde_json::json;
    use serde_json::Value;

    #[test]
    fn runtime_composition_maps_direct_policy_to_direct_chat_phase() {
        let policy = build_default_local_execution_policy();
        assert_eq!(
            initial_phase_step_for_policy(&policy),
            PhaseStepType::DirectChat
        );
    }

    #[test]
    fn runtime_composition_uses_policy_phase_for_delegated_worker() {
        let mut policy = build_default_local_execution_policy();
        policy.initial_phase_step = PhaseStepType::DelegatedWorker;
        policy.inject_execution_protocol = true;
        policy.allow_worker_delegation = true;

        assert_eq!(
            initial_phase_step_for_policy(&policy),
            PhaseStepType::DelegatedWorker
        );
    }

    #[test]
    fn runtime_composition_maps_worker_policy_preference_to_workflow_phase() {
        let mut policy = build_default_local_execution_policy();
        policy.initial_phase_step = PhaseStepType::DelegatedWorker;
        policy.inject_execution_protocol = true;
        policy.allow_worker_delegation = true;
        policy.prefer_workflow_runtime = true;

        assert_eq!(
            initial_phase_step_for_policy(&policy),
            PhaseStepType::DelegatedWorkflow
        );
    }

    #[test]
    fn latest_user_message_prefers_most_recent_user_turn() {
        let latest = latest_user_message(&[
            LocalChatInputMessage {
                role: "user".to_string(),
                content: "older".to_string(),
                reasoning_content: None,
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            },
            LocalChatInputMessage {
                role: "assistant".to_string(),
                content: "reply".to_string(),
                reasoning_content: None,
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            },
            LocalChatInputMessage {
                role: "user".to_string(),
                content: "newest".to_string(),
                reasoning_content: None,
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            },
        ]);

        assert_eq!(latest.as_deref(), Some("newest"));
    }

    #[test]
    fn delegated_result_uses_canonical_schema() {
        let record = DelegatedExecutionRecord {
            execution_id: "exec-123".to_string(),
            kind: DelegatedExecutionKind::Workflow,
            status: DelegatedExecutionStatus::Succeeded,
            target: DelegatedExecutionTarget {
                id: "worker-1".to_string(),
                name: "Research Worker".to_string(),
                invocation_kind: Some("chat".to_string()),
                worker_ref: Some("user_worker_profile:researcher".to_string()),
                workflow_run_id: Some("run-123".to_string()),
            },
            selection: DelegatedExecutionSelection {
                explicit: false,
                score: Some(92),
                reason_codes: vec!["tag_match".to_string()],
                reason_text: Some("tag_match".to_string()),
                candidate_count: 3,
                selected_from_top_k: 3,
                callable_coverage_score: Some(0.8),
                modality_fit_score: Some(1.0),
                profile_prior_score: Some(0.0),
            },
            packet_receipt: Some(DelegatedExecutionPacketReceipt {
                packet_hash: "packet-123".to_string(),
                task_kind: "analysis".to_string(),
                deliverable_kind: "structured_findings".to_string(),
                selected_profile_id: "worker-1".to_string(),
            }),
            available_actions: vec![DelegatedExecutionAction {
                kind: "open".to_string(),
            }],
            children: vec![DelegatedExecutionChildRecord {
                id: "step-1".to_string(),
                phase_id: Some("phase-1".to_string()),
                step_type: Some("worker_call".to_string()),
                title: "Execute".to_string(),
                status: "succeeded".to_string(),
                worker_ref: Some("user_worker_profile:researcher".to_string()),
                summary: Some("Compiled answer".to_string()),
                error: None,
                available_actions: vec![DelegatedExecutionAction {
                    kind: "open".to_string(),
                }],
            }],
            summary: Some("Compiled answer".to_string()),
            primary_output: Some(json!({
                "workflow_run_id": "run-123",
                "content": "Compiled answer",
            })),
            error: None,
            started_at_ms: 10,
            completed_at_ms: Some(20),
        };

        let delegated_result = record.delegated_result();
        assert_eq!(
            delegated_result.get("type").and_then(Value::as_str),
            Some("delegated_result")
        );
        assert_eq!(
            delegated_result
                .get("schema_version")
                .and_then(Value::as_i64),
            Some(DELEGATED_RESULT_SCHEMA_VERSION)
        );
        assert_eq!(
            delegated_result
                .get("authoritative")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            delegated_result.get("kind").and_then(Value::as_str),
            Some("workflow")
        );
        assert_eq!(
            delegated_result
                .get("primary_output")
                .and_then(|value| value.get("workflow_run_id"))
                .and_then(Value::as_str),
            Some("run-123")
        );
        assert_eq!(
            delegated_result
                .get("packet_receipt")
                .and_then(|value| value.get("packet_hash"))
                .and_then(Value::as_str),
            Some("packet-123")
        );
    }

    #[test]
    fn delegated_result_feedback_messages_inject_json_payload() {
        let record = DelegatedExecutionRecord {
            execution_id: "exec-123".to_string(),
            kind: DelegatedExecutionKind::CustomTaskAgent,
            status: DelegatedExecutionStatus::Succeeded,
            target: DelegatedExecutionTarget {
                id: "agent-1".to_string(),
                name: "Image Worker".to_string(),
                invocation_kind: Some("image_generation".to_string()),
                worker_ref: None,
                workflow_run_id: None,
            },
            selection: DelegatedExecutionSelection {
                explicit: true,
                score: Some(100),
                reason_codes: vec!["explicit".to_string()],
                reason_text: Some("explicit".to_string()),
                candidate_count: 1,
                selected_from_top_k: 1,
                callable_coverage_score: Some(1.0),
                modality_fit_score: Some(1.0),
                profile_prior_score: Some(0.0),
            },
            packet_receipt: Some(DelegatedExecutionPacketReceipt {
                packet_hash: "packet-image".to_string(),
                task_kind: "image_generation".to_string(),
                deliverable_kind: "image_result".to_string(),
                selected_profile_id: "agent-1".to_string(),
            }),
            available_actions: Vec::new(),
            children: Vec::new(),
            summary: Some("Generated image".to_string()),
            primary_output: Some(json!({
                "render_blocks": [{ "view_type": "image.result" }],
            })),
            error: None,
            started_at_ms: 1,
            completed_at_ms: Some(2),
        };

        let messages = build_delegated_result_feedback_messages(&record);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "system");
        assert!(messages[0]
            .content
            .contains("canonical delegated_result JSON object"));

        let payload: Value =
            serde_json::from_str(messages[1].content.as_str()).expect("delegated_result json");
        assert_eq!(
            payload.get("type").and_then(Value::as_str),
            Some("delegated_result")
        );
        assert_eq!(
            payload
                .get("primary_output")
                .and_then(|value| value.get("render_blocks"))
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn running_delegated_session_preserves_running_status_meta() {
        let session = DelegatedExecutionSession {
            record: DelegatedExecutionRecord {
                execution_id: "exec-running".to_string(),
                kind: DelegatedExecutionKind::Workflow,
                status: DelegatedExecutionStatus::Running,
                target: DelegatedExecutionTarget {
                    id: "agent-1".to_string(),
                    name: "Workflow Agent".to_string(),
                    invocation_kind: Some("chat".to_string()),
                    worker_ref: Some("user_worker_profile:agent-1".to_string()),
                    workflow_run_id: Some("run-123".to_string()),
                },
                selection: DelegatedExecutionSelection {
                    explicit: false,
                    score: Some(88),
                    reason_codes: vec!["coverage".to_string()],
                    reason_text: Some("best match".to_string()),
                    candidate_count: 3,
                    selected_from_top_k: 2,
                    callable_coverage_score: Some(0.8),
                    modality_fit_score: Some(1.0),
                    profile_prior_score: Some(0.0),
                },
                packet_receipt: None,
                available_actions: vec![DelegatedExecutionAction {
                    kind: "open".to_string(),
                }],
                children: Vec::new(),
                summary: Some("workflow run-123 running".to_string()),
                primary_output: Some(json!({
                    "status": "running",
                    "workflow_run_id": "run-123"
                })),
                error: None,
                started_at_ms: 1,
                completed_at_ms: None,
            },
            feedback_messages: Vec::new(),
            trace_blocks: vec![json!({
                "type": "tool_call",
                "callId": "delegated-workflow-run-123",
                "toolName": "workflow/Workflow Agent",
                "status": "running"
            })],
        };

        let status_meta = session
            .record
            .status_meta_with_status(DelegatedExecutionStatus::Running);

        assert_eq!(
            status_meta.get("execution_status").and_then(Value::as_str),
            Some("running")
        );
        assert_eq!(
            status_meta.get("terminal_status").and_then(Value::as_str),
            Some("running")
        );
        assert_eq!(
            status_meta.get("workflow_run_id").and_then(Value::as_str),
            Some("run-123")
        );
    }

    #[test]
    fn direct_delegated_return_only_applies_to_explicit_media_agents() {
        let mut session = DelegatedExecutionSession {
            record: DelegatedExecutionRecord {
                execution_id: "exec-media".to_string(),
                kind: DelegatedExecutionKind::CustomTaskAgent,
                status: DelegatedExecutionStatus::Succeeded,
                target: DelegatedExecutionTarget {
                    id: "agent-media".to_string(),
                    name: "Voice Agent".to_string(),
                    invocation_kind: Some("text_to_speech".to_string()),
                    worker_ref: None,
                    workflow_run_id: None,
                },
                selection: DelegatedExecutionSelection {
                    explicit: true,
                    score: Some(100),
                    reason_codes: vec!["explicit_task_agent".to_string()],
                    reason_text: Some("explicit".to_string()),
                    candidate_count: 1,
                    selected_from_top_k: 1,
                    callable_coverage_score: Some(1.0),
                    modality_fit_score: Some(1.0),
                    profile_prior_score: Some(0.0),
                },
                packet_receipt: None,
                available_actions: Vec::new(),
                children: Vec::new(),
                summary: Some("audio ready".to_string()),
                primary_output: Some(json!({ "audios": ["local-asset://audio-1"] })),
                error: None,
                started_at_ms: 1,
                completed_at_ms: Some(2),
            },
            feedback_messages: Vec::new(),
            trace_blocks: vec![json!({
                "type": "ui",
                "viewType": "audio.result",
                "payload": { "asset": { "url": "local-asset://audio-1" } }
            })],
        };

        assert!(should_return_delegated_result_directly(
            Some("agent-media"),
            &session
        ));
        assert!(!should_return_delegated_result_directly(None, &session));
        assert!(!should_return_delegated_result_directly(
            Some("agent-other"),
            &session
        ));

        session.record.target.invocation_kind = Some("chat".to_string());
        assert!(!should_return_delegated_result_directly(
            Some("agent-media"),
            &session
        ));
    }
}
