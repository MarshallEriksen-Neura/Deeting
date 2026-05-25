use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
};
use crate::modules::desktop_runtime::runtime::execution_plane::{
    build_workflow_delegated_execution_session, DelegatedExecutionSession,
};
use crate::modules::desktop_runtime::runtime::DelegatedExecutionSelection;
use serde_json::Value;

pub(super) fn build_workflow_delegated_execution_session_for_resume(
    execution_graph_execution_id: String,
    detail: crate::modules::workflow::types::WorkflowRunDetail,
    task_input_source: Option<Value>,
) -> DelegatedExecutionSession {
    let content = crate::modules::workflow::service::extract_primary_content(&detail);
    let succeeded =
        detail.run.status == crate::modules::workflow::types::WorkflowRunStatus::Completed;

    build_workflow_delegated_execution_session(
        execution_graph_execution_id,
        CustomTaskAgentProfile {
            id: "workflow".to_string(),
            name: "Workflow".to_string(),
            description: None,
            task_prompt: "delegated workflow wake resume".to_string(),
            invocation_kind: CustomTaskAgentInvocationKind::Chat,
            preferred_for_image_generation: false,
            model_config: None,
            callable_mcp_tool_ids: Vec::new(),
            guidance_skill_ids: Vec::new(),
            callable_skill_action_refs: Vec::new(),
            bound_asset_id: None,
            tags: Vec::new(),
            discoverable: false,
            is_enabled: true,
            is_deleted: false,
            source_kind: Some("delegated_workflow_runtime".to_string()),
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "1970-01-01T00:00:00Z".to_string(),
            updated_at: "1970-01-01T00:00:00Z".to_string(),
        },
        DelegatedExecutionSelection {
            explicit: false,
            score: None,
            reason_codes: Vec::new(),
            reason_text: Some("delegated workflow wake resume".to_string()),
            candidate_count: 0,
            selected_from_top_k: 0,
            callable_coverage_score: None,
            modality_fit_score: None,
            profile_prior_score: None,
        },
        None,
        task_input_source,
        "workflow".to_string(),
        Ok(crate::modules::workflow::types::QuickWorkflowResult {
            run: detail.run,
            steps: detail.steps,
            content,
            succeeded,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::workflow::types::{
        WorkflowEvent, WorkflowRun, WorkflowRunDetail, WorkflowRunStatus, WorkflowStepRun,
        WorkflowStepStatus, WorkflowStepType,
    };
    use serde_json::json;

    #[test]
    fn resumed_workflow_session_carries_persisted_task_input_source() {
        let task_input_source = json!({
            "delegated_agent": {
                "parent_frame_id": "frame-parent-1",
                "agent_id": "workflow.agent",
                "return_channel": "workflow_event"
            }
        });
        let session = build_workflow_delegated_execution_session_for_resume(
            "exec-1".to_string(),
            sample_detail(),
            Some(task_input_source.clone()),
        );

        assert_eq!(
            session
                .record
                .primary_output
                .as_ref()
                .and_then(|value| value.get("task_input_source")),
            Some(&task_input_source)
        );
        assert_eq!(
            session
                .record
                .primary_output
                .as_ref()
                .and_then(
                    |value| value.pointer("/task_input_source/delegated_agent/parent_frame_id")
                )
                .and_then(serde_json::Value::as_str),
            Some("frame-parent-1")
        );
    }

    fn sample_detail() -> WorkflowRunDetail {
        WorkflowRunDetail {
            run: WorkflowRun {
                id: "workflow-run-1".to_string(),
                title: "Delegated workflow".to_string(),
                goal: "Finish delegated work".to_string(),
                status: WorkflowRunStatus::Completed,
                proposal_text: None,
                snapshot_json: None,
                proposal_version: 1,
                snapshot_version: 1,
                run_dir: None,
                error: None,
                created_at: "2026-05-25T00:00:00Z".to_string(),
                updated_at: "2026-05-25T00:00:01Z".to_string(),
            },
            steps: vec![WorkflowStepRun {
                id: "step-1".to_string(),
                run_id: "workflow-run-1".to_string(),
                phase_id: "phase-1".to_string(),
                phase_index: 0,
                step_type: WorkflowStepType::WorkerCall,
                title: "Execute".to_string(),
                status: WorkflowStepStatus::Succeeded,
                worker_ref: Some("user_worker_profile:workflow.agent".to_string()),
                goal: Some("Finish delegated work".to_string()),
                input_snapshot: None,
                output_artifact_refs: Vec::new(),
                worker_trace_summary: Some("done".to_string()),
                retry_count: 0,
                error: None,
                started_at: Some("2026-05-25T00:00:00Z".to_string()),
                completed_at: Some("2026-05-25T00:00:01Z".to_string()),
                created_at: "2026-05-25T00:00:00Z".to_string(),
                updated_at: "2026-05-25T00:00:01Z".to_string(),
            }],
            events: Vec::<WorkflowEvent>::new(),
        }
    }
}
