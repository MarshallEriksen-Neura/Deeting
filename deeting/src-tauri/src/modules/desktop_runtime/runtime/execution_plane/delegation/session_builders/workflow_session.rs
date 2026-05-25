use super::super::feedback::build_delegated_result_feedback_messages;
use super::super::model::{
    DelegatedExecutionAction, DelegatedExecutionChildRecord, DelegatedExecutionKind,
    DelegatedExecutionPacketReceipt, DelegatedExecutionRecord, DelegatedExecutionSelection,
    DelegatedExecutionSession, DelegatedExecutionStatus, DelegatedExecutionTarget,
};
use super::common::summarize_content;
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
};
use crate::modules::desktop_runtime::runtime::build_local_tool_trace_blocks;
use crate::modules::desktop_runtime::runtime::worker_dispatch::WorkerTargetSelection;
use crate::modules::workflow::types::QuickWorkflowResult;
use crate::modules::workflow::types::WorkflowRunStatus;
use serde_json::{json, Value};

pub(crate) fn build_workflow_delegated_execution_session(
    execution_id: String,
    profile: CustomTaskAgentProfile,
    selection: DelegatedExecutionSelection,
    packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    task_input_source: Option<Value>,
    worker_ref: String,
    result: Result<QuickWorkflowResult, String>,
) -> DelegatedExecutionSession {
    let started_at_ms = chrono::Utc::now().timestamp_millis();
    match result {
        Ok(result) => {
            let workflow_run_id = result.run.id.clone();
            let workflow_status = result.run.status.as_str().to_string();
            let primary_content = result.content.clone();
            let child_records = result
                .steps
                .iter()
                .map(|step| DelegatedExecutionChildRecord {
                    id: step.id.clone(),
                    phase_id: Some(step.phase_id.clone()),
                    step_type: Some(step.step_type.as_str().to_string()),
                    title: step.title.clone(),
                    status: step.status.as_str().to_string(),
                    worker_ref: step.worker_ref.clone(),
                    summary: step.worker_trace_summary.clone(),
                    error: step.error.clone(),
                    available_actions: workflow_child_actions(step.status.as_str()),
                })
                .collect::<Vec<_>>();
            let step_statuses = child_records
                .iter()
                .map(|child| {
                    json!({
                        "id": child.id.clone(),
                        "phase_id": child.phase_id.clone(),
                        "step_type": child.step_type.clone(),
                        "title": child.title.clone(),
                        "status": child.status.clone(),
                        "worker_ref": child.worker_ref.clone(),
                        "summary": child.summary.clone(),
                        "error": child.error.clone(),
                    })
                })
                .collect::<Vec<_>>();
            let status = if result.succeeded {
                "completed"
            } else {
                "failed"
            };
            let mut payload = json!({
                "status": status,
                "agent_id": profile.id,
                "agent_name": profile.name,
                "workflow_run_id": workflow_run_id.clone(),
                "workflow_status": workflow_status,
                "content": primary_content,
                "steps": step_statuses,
            });
            attach_task_input_source(&mut payload, task_input_source.as_ref());
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-workflow-{}", workflow_run_id),
                "name": format!("workflow/{}", profile.name),
                "status": if result.succeeded { "success" } else { "error" },
                "result": payload.clone(),
            })]);
            let record = DelegatedExecutionRecord {
                execution_id,
                kind: DelegatedExecutionKind::Workflow,
                status: if result.succeeded {
                    DelegatedExecutionStatus::Succeeded
                } else {
                    DelegatedExecutionStatus::Failed
                },
                target: DelegatedExecutionTarget {
                    id: profile.id.clone(),
                    name: profile.name.clone(),
                    invocation_kind: Some(profile.invocation_kind.as_str().to_string()),
                    worker_ref: Some(worker_ref),
                    workflow_run_id: Some(workflow_run_id.clone()),
                },
                selection,
                packet_receipt,
                available_actions: vec![DelegatedExecutionAction {
                    kind: "open".to_string(),
                }],
                children: child_records,
                summary: primary_content
                    .as_deref()
                    .and_then(summarize_content)
                    .or_else(|| Some(format!("workflow {}", workflow_status))),
                primary_output: Some(payload.clone()),
                error: (!result.succeeded).then(|| {
                    format!(
                        "workflow execution finished with status {}",
                        workflow_status
                    )
                }),
                started_at_ms,
                completed_at_ms: Some(chrono::Utc::now().timestamp_millis()),
            };
            let feedback_messages = build_delegated_result_feedback_messages(&record);
            DelegatedExecutionSession {
                record,
                feedback_messages,
                trace_blocks: tool_trace_blocks,
            }
        }
        Err(error) => {
            let mut payload = json!({
                "status": "failed",
                "agent_id": profile.id,
                "agent_name": profile.name,
                "execution_path": "workflow_runtime",
                "error": error,
            });
            attach_task_input_source(&mut payload, task_input_source.as_ref());
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-workflow-error-{}", execution_id),
                "name": format!("workflow/{}", profile.name),
                "status": "error",
                "result": payload.clone(),
            })]);
            let record = DelegatedExecutionRecord {
                execution_id,
                kind: DelegatedExecutionKind::Workflow,
                status: DelegatedExecutionStatus::Failed,
                target: DelegatedExecutionTarget {
                    id: profile.id.clone(),
                    name: profile.name.clone(),
                    invocation_kind: Some(CustomTaskAgentInvocationKind::Chat.as_str().to_string()),
                    worker_ref: Some(worker_ref),
                    workflow_run_id: None,
                },
                selection,
                packet_receipt,
                available_actions: vec![DelegatedExecutionAction {
                    kind: "open".to_string(),
                }],
                children: Vec::new(),
                summary: Some("workflow failed".to_string()),
                primary_output: Some(payload.clone()),
                error: Some(error),
                started_at_ms,
                completed_at_ms: Some(chrono::Utc::now().timestamp_millis()),
            };
            let feedback_messages = build_delegated_result_feedback_messages(&record);
            DelegatedExecutionSession {
                record,
                feedback_messages,
                trace_blocks: tool_trace_blocks,
            }
        }
    }
}

fn workflow_child_actions(status: &str) -> Vec<DelegatedExecutionAction> {
    let mut actions = vec![DelegatedExecutionAction {
        kind: "open".to_string(),
    }];
    if status == "waiting_approval" {
        actions.push(DelegatedExecutionAction {
            kind: "approve".to_string(),
        });
    }
    if status == "succeeded" {
        actions.push(DelegatedExecutionAction {
            kind: "view_context".to_string(),
        });
    }
    if status == "failed" {
        actions.push(DelegatedExecutionAction {
            kind: "rerun".to_string(),
        });
    }
    actions
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane::delegation) fn build_running_workflow_session(
    execution_id: &str,
    selection: &WorkerTargetSelection,
    execution_selection: &DelegatedExecutionSelection,
    packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    task_input_source: Option<Value>,
    worker_ref: String,
    workflow_run_id: String,
) -> DelegatedExecutionSession {
    let summary = format!("workflow {} running", workflow_run_id);
    let mut waiting_payload = json!({
        "status": "running",
        "agent_id": selection.profile.id.clone(),
        "agent_name": selection.profile.name.clone(),
        "workflow_run_id": workflow_run_id.clone(),
        "workflow_status": WorkflowRunStatus::Running.as_str(),
        "content": serde_json::Value::Null,
        "steps": []
    });
    attach_task_input_source(&mut waiting_payload, task_input_source.as_ref());
    let waiting_trace_blocks = build_local_tool_trace_blocks(&[json!({
        "id": format!("delegated-workflow-{}", workflow_run_id),
        "name": format!("workflow/{}", selection.profile.name),
        "status": "running",
        "result": waiting_payload.clone(),
    })]);
    let waiting_record = DelegatedExecutionRecord {
        execution_id: execution_id.to_string(),
        kind: DelegatedExecutionKind::Workflow,
        status: DelegatedExecutionStatus::Running,
        target: DelegatedExecutionTarget {
            id: selection.profile.id.clone(),
            name: selection.profile.name.clone(),
            invocation_kind: Some(selection.profile.invocation_kind.as_str().to_string()),
            worker_ref: Some(worker_ref),
            workflow_run_id: Some(workflow_run_id),
        },
        selection: execution_selection.clone(),
        packet_receipt,
        available_actions: vec![DelegatedExecutionAction {
            kind: "open".to_string(),
        }],
        children: Vec::new(),
        summary: Some(summary),
        primary_output: Some(waiting_payload),
        error: None,
        started_at_ms: chrono::Utc::now().timestamp_millis(),
        completed_at_ms: None,
    };

    DelegatedExecutionSession {
        feedback_messages: build_delegated_result_feedback_messages(&waiting_record),
        trace_blocks: waiting_trace_blocks,
        record: waiting_record,
    }
}

fn attach_task_input_source(payload: &mut Value, task_input_source: Option<&Value>) {
    if let (Value::Object(payload), Some(task_input_source)) = (payload, task_input_source) {
        payload.insert("task_input_source".to_string(), task_input_source.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn running_workflow_primary_output_carries_task_input_source() {
        let task_input_source = json!({
            "delegated_agent": {
                "parent_task_id": "parent-task-1",
                "parent_frame_id": "frame-parent-1",
                "agent_id": "workflow.agent",
                "return_channel": "workflow_event"
            }
        });

        let session = build_running_workflow_session(
            "exec-1",
            &WorkerTargetSelection {
                profile: test_profile("workflow.agent"),
                score: 100,
                reason: "explicit".to_string(),
                reason_codes: vec!["explicit".to_string()],
                candidate_count: 1,
                selected_from_top_k: 1,
                callable_coverage_score: 1.0,
                modality_fit_score: 1.0,
                profile_prior_score: 1.0,
            },
            &test_selection(),
            None,
            Some(task_input_source.clone()),
            "user_worker_profile:workflow.agent".to_string(),
            "workflow-run-1".to_string(),
        );

        assert_eq!(
            session
                .record
                .primary_output
                .as_ref()
                .and_then(|value| value.get("task_input_source")),
            Some(&task_input_source)
        );
    }

    fn test_selection() -> DelegatedExecutionSelection {
        DelegatedExecutionSelection {
            explicit: true,
            score: Some(100),
            reason_codes: vec!["explicit".to_string()],
            reason_text: Some("explicit selection".to_string()),
            candidate_count: 1,
            selected_from_top_k: 1,
            callable_coverage_score: Some(1.0),
            modality_fit_score: Some(1.0),
            profile_prior_score: Some(1.0),
        }
    }

    fn test_profile(id: &str) -> CustomTaskAgentProfile {
        CustomTaskAgentProfile {
            id: id.to_string(),
            name: "Workflow Agent".to_string(),
            description: None,
            task_prompt: "Run workflow".to_string(),
            invocation_kind: CustomTaskAgentInvocationKind::Chat,
            preferred_for_image_generation: false,
            model_config: None,
            callable_mcp_tool_ids: Vec::new(),
            guidance_skill_ids: Vec::new(),
            callable_skill_action_refs: Vec::new(),
            bound_asset_id: None,
            tags: Vec::new(),
            discoverable: true,
            is_enabled: true,
            is_deleted: false,
            source_kind: None,
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "1970-01-01T00:00:00Z".to_string(),
            updated_at: "1970-01-01T00:00:00Z".to_string(),
        }
    }
}
