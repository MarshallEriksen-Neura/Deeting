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
    task_input_source: Option<Value>,
    result: Result<CustomTaskAgentPreviewResponse, CustomTaskAgentRuntimeError>,
    render_blocks: Vec<Value>,
) -> DelegatedExecutionSession {
    let started_at_ms = chrono::Utc::now().timestamp_millis();
    match result {
        Ok(result) => {
            let mut payload = json!({
                "status": result.status,
                "agent_id": profile.id,
                "agent_name": profile.name,
                "model_id": result.model_id,
                "provider_model_id": result.provider_model_id,
                "invocation_kind": result.invocation_kind.as_str(),
                "content": result.content,
                "reasoning_content": result.reasoning_content,
                "images": result.images,
                "audios": result.audios,
                "tool_trace": result.tool_trace,
                "callable_mcp_tool_ids": result.callable_mcp_tool_ids,
                "guidance_skill_ids": result.guidance_skill_ids,
                "callable_skill_action_refs": result.callable_skill_action_refs,
                "raw": result.raw,
                "render_blocks": render_blocks,
            });
            attach_task_input_source(&mut payload, task_input_source.as_ref());
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
            let mut payload = json!({
                "status": "failed",
                "agent_id": profile.id,
                "agent_name": profile.name,
                "error_code": error.code.clone(),
                "error": error_text,
            });
            attach_task_input_source(&mut payload, task_input_source.as_ref());
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

fn attach_task_input_source(payload: &mut Value, task_input_source: Option<&Value>) {
    if let (Value::Object(payload), Some(task_input_source)) = (payload, task_input_source) {
        payload.insert("task_input_source".to_string(), task_input_source.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::custom_task_agents::types::{
        CustomTaskAgentInvocationKind, CustomTaskAgentPreviewResponse,
    };

    #[test]
    fn custom_task_agent_primary_output_carries_task_input_source() {
        let task_input_source = json!({
            "delegated_agent": {
                "parent_task_id": "parent-task-1",
                "parent_frame_id": "frame-parent-1",
                "agent_id": "agent.research",
                "return_channel": "parent_frame_observation"
            }
        });

        let session = build_custom_task_agent_delegated_execution_session(
            "exec-1".to_string(),
            test_profile("agent.research", CustomTaskAgentInvocationKind::Chat),
            test_selection(),
            None,
            Some(task_input_source.clone()),
            Ok(CustomTaskAgentPreviewResponse {
                status: "completed".to_string(),
                content: "done".to_string(),
                model_id: "model".to_string(),
                provider_model_id: "provider/model".to_string(),
                invocation_kind: CustomTaskAgentInvocationKind::Chat,
                reasoning_content: None,
                tool_calls: Vec::new(),
                tool_trace: Vec::new(),
                callable_mcp_tool_ids: Vec::new(),
                guidance_skill_ids: Vec::new(),
                callable_skill_action_refs: Vec::new(),
                images: Vec::new(),
                audios: Vec::new(),
                raw: None,
            }),
            Vec::new(),
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

    fn test_profile(
        id: &str,
        invocation_kind: CustomTaskAgentInvocationKind,
    ) -> CustomTaskAgentProfile {
        CustomTaskAgentProfile {
            id: id.to_string(),
            name: "Research Agent".to_string(),
            description: None,
            task_prompt: "Research".to_string(),
            invocation_kind,
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
