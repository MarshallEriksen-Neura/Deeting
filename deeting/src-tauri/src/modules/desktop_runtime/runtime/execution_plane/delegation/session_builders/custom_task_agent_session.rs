use super::super::feedback::build_delegated_result_feedback_messages;
use super::super::model::{
    DelegatedExecutionAction, DelegatedExecutionChildRecord, DelegatedExecutionKind,
    DelegatedExecutionPacketReceipt, DelegatedExecutionRecord, DelegatedExecutionSelection,
    DelegatedExecutionSession, DelegatedExecutionStatus, DelegatedExecutionTarget,
};
use super::common::summarize_content;
use crate::modules::custom_task_agents::runtime::CustomTaskAgentRuntimeError;
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentPreviewResponse, CustomTaskAgentProfile,
};
use crate::modules::desktop_runtime::runtime::build_local_tool_trace_blocks;
use serde_json::{json, Value};

pub(crate) fn build_custom_task_agent_delegated_execution_session(
    execution_id: String,
    profile: CustomTaskAgentProfile,
    selection: DelegatedExecutionSelection,
    packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    result: Result<CustomTaskAgentPreviewResponse, CustomTaskAgentRuntimeError>,
    render_blocks: Vec<Value>,
) -> DelegatedExecutionSession {
    let started_at_ms = chrono::Utc::now().timestamp_millis();
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
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-agent-{}", profile.id),
                "name": format!("custom_task_agent/{}", profile.name),
                "status": "success",
                "result": payload.clone(),
            })]);
            let primary_child = DelegatedExecutionChildRecord {
                id: format!("{}:primary", execution_id),
                phase_id: None,
                step_type: Some("worker_call".to_string()),
                title: profile.name.clone(),
                status: "succeeded".to_string(),
                worker_ref: Some(format!("user_worker_profile:{}", profile.id)),
                summary: summarize_content(result.content.as_str()),
                error: None,
                available_actions: if render_blocks.is_empty() {
                    Vec::new()
                } else {
                    vec![DelegatedExecutionAction {
                        kind: "view_result".to_string(),
                    }]
                },
            };
            let record = DelegatedExecutionRecord {
                execution_id,
                kind: DelegatedExecutionKind::CustomTaskAgent,
                status: DelegatedExecutionStatus::Succeeded,
                target: DelegatedExecutionTarget {
                    id: profile.id.clone(),
                    name: profile.name.clone(),
                    invocation_kind: Some(result.invocation_kind.as_str().to_string()),
                    worker_ref: None,
                    workflow_run_id: None,
                },
                selection,
                packet_receipt,
                available_actions: Vec::new(),
                children: vec![primary_child],
                summary: summarize_content(result.content.as_str()),
                primary_output: Some(payload.clone()),
                error: None,
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
            let error_text = error.message.clone();
            let payload = json!({
                "status": "failed",
                "agent_id": profile.id,
                "agent_name": profile.name,
                "error_code": error.code.clone(),
                "error": error_text,
            });
            let tool_trace_blocks = build_local_tool_trace_blocks(&[json!({
                "id": format!("delegated-agent-{}", profile.id),
                "name": format!("custom_task_agent/{}", profile.name),
                "status": "error",
                "error_code": error.code,
                "error": error.message,
            })]);
            let primary_child = DelegatedExecutionChildRecord {
                id: format!("{}:primary", execution_id),
                phase_id: None,
                step_type: Some("worker_call".to_string()),
                title: profile.name.clone(),
                status: "failed".to_string(),
                worker_ref: Some(format!("user_worker_profile:{}", profile.id)),
                summary: Some(error_text.clone()),
                error: Some(error_text.clone()),
                available_actions: Vec::new(),
            };
            let record = DelegatedExecutionRecord {
                execution_id,
                kind: DelegatedExecutionKind::CustomTaskAgent,
                status: DelegatedExecutionStatus::Failed,
                target: DelegatedExecutionTarget {
                    id: profile.id.clone(),
                    name: profile.name.clone(),
                    invocation_kind: Some(profile.invocation_kind.as_str().to_string()),
                    worker_ref: None,
                    workflow_run_id: None,
                },
                selection,
                packet_receipt,
                available_actions: Vec::new(),
                children: vec![primary_child],
                summary: Some(error_text.clone()),
                primary_output: Some(payload.clone()),
                error: Some(error_text),
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
