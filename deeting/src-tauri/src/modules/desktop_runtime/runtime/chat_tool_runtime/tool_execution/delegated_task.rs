use super::super::audit;
use super::super::lifecycle::now_unix_ms_i64;
use super::super::runtime_state::{resolve_child_agent_max_rounds, LocalChatToolRuntimeState};
use crate::modules::custom_task_agents::runtime::preview_custom_task_agent_with_parent_model;
use crate::modules::custom_task_agents::types::CustomTaskAgentPreviewRequest;
use crate::modules::desktop_runtime::runtime::execution_plane::{
    build_delegated_result_feedback_messages, DelegatedExecutionAction,
    DelegatedExecutionChildRecord, DelegatedExecutionKind, DelegatedExecutionPacketReceipt,
    DelegatedExecutionRecord, DelegatedExecutionSelection, DelegatedExecutionStatus,
    DelegatedExecutionTarget,
};
use crate::modules::desktop_runtime::runtime::worker_dispatch::{
    build_worker_task_packet, select_worker_custom_task_agent, WorkerTaskPacketInput,
};
use crate::state::AppState;
use tauri::AppHandle;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct DelegateTaskToolExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_delegate_task_tool(
    app: &AppHandle,
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    session_id: &str,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
    effective_allowed_tool_names: &[String],
) -> Result<DelegateTaskToolExecutionResult, String> {
    let task = arguments
        .get("task")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "delegate_task requires a non-empty 'task' argument".to_string())?;
    let agent_id = arguments
        .get("agent_id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let selection = select_worker_custom_task_agent(app_state, agent_id, task)
        .await?
        .ok_or_else(|| "no enabled custom task agent matched delegate_task".to_string())?;
    let execution_id = uuid::Uuid::new_v4().to_string();
    let requires_bound_callable_surface = matches!(
        selection.profile.invocation_kind,
        crate::modules::custom_task_agents::types::CustomTaskAgentInvocationKind::Chat
    );
    if requires_bound_callable_surface
        && selection.profile.callable_mcp_tool_ids.is_empty()
        && selection.profile.callable_skill_action_refs.is_empty()
    {
        let started_at_ms = now_unix_ms_i64();
        let record = DelegatedExecutionRecord {
            execution_id: execution_id.clone(),
            kind: DelegatedExecutionKind::CustomTaskAgent,
            status: DelegatedExecutionStatus::Failed,
            target: DelegatedExecutionTarget {
                id: selection.profile.id.clone(),
                name: selection.profile.name.clone(),
                invocation_kind: Some(selection.profile.invocation_kind.as_str().to_string()),
                worker_ref: None,
                workflow_run_id: None,
            },
            selection: DelegatedExecutionSelection {
                explicit: agent_id.is_some(),
                score: Some(selection.score),
                reason_codes: selection.reason_codes.clone(),
                reason_text: Some(selection.reason.clone()).filter(|value| !value.trim().is_empty()),
                candidate_count: selection.candidate_count,
                selected_from_top_k: selection.selected_from_top_k,
                callable_coverage_score: Some(selection.callable_coverage_score),
                modality_fit_score: Some(selection.modality_fit_score),
                profile_prior_score: Some(selection.profile_prior_score),
            },
            packet_receipt: None,
            available_actions: vec![DelegatedExecutionAction {
                kind: "reconfigure_agent".to_string(),
            }],
            children: vec![DelegatedExecutionChildRecord {
                id: format!("{}:preflight", execution_id),
                phase_id: Some("preflight".to_string()),
                step_type: Some("capability_check".to_string()),
                title: "Validate delegated capability surface".to_string(),
                status: "blocked".to_string(),
                worker_ref: Some(format!("custom_task_agent:{}", selection.profile.id)),
                summary: Some("Delegation blocked before launch because the selected task agent has no executable tools or skill actions bound.".to_string()),
                error: Some("The selected task agent only has prompt or guidance context. Bind at least one executable MCP tool or callable skill action before using delegate_task.".to_string()),
                available_actions: vec![DelegatedExecutionAction {
                    kind: "reconfigure_agent".to_string(),
                }],
            }],
            summary: Some("Delegation blocked before launch".to_string()),
            primary_output: Some(serde_json::json!({
                "status": "blocked",
                "agent_id": selection.profile.id,
                "agent_name": selection.profile.name,
                "reason": "missing_executable_surface",
                "message": "The selected task agent has no executable MCP tools or callable skill actions bound.",
                "callable_mcp_tool_ids": [],
                "guidance_skill_ids": selection.profile.guidance_skill_ids,
                "callable_skill_action_refs": [],
                "session_id": session_id,
                "tool_call_id": call_id,
            })),
            error: Some("delegate_task blocked: selected task agent has no executable surface".to_string()),
            started_at_ms,
            completed_at_ms: Some(now_unix_ms_i64()),
        };
        let result = record.delegated_result();
        let result_message = format!(
            "Delegated task result:\n{}",
            serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
        );
        return Ok(DelegateTaskToolExecutionResult {
            meta: serde_json::json!({
                "id": call_id,
                "name": tool_name,
                "status": "success",
                "result": result,
            }),
            result_message,
        });
    }
    let constraints = arguments
        .get("constraints")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let context_refs = arguments
        .get("context_refs")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let max_rounds = resolve_child_agent_max_rounds(arguments, state.max_rounds);
    let task_packet = build_worker_task_packet(
        &selection,
        WorkerTaskPacketInput {
            task_id: execution_id.clone(),
            route: state.execution_policy.route.as_str().to_string(),
            goal: task.to_string(),
            user_query: task.to_string(),
            raw_user_text: Some(task.to_string()),
            image_urls: Vec::new(),
            parent_allowed_tool_names: effective_allowed_tool_names.to_vec(),
            prefer_workflow_runtime: state.execution_policy.prefer_workflow_runtime,
            explicit_task_agent_id: agent_id.map(str::to_string),
            bound_asset_reference: None,
        },
    );
    let started_at_ms = now_unix_ms_i64();
    let response_result = preview_custom_task_agent_with_parent_model(
        app,
        app_state,
        &selection.profile,
        CustomTaskAgentPreviewRequest {
            message: task.to_string(),
            image_urls: Vec::new(),
            temperature: state.temperature,
            max_tokens: state.max_tokens,
            max_rounds: Some(max_rounds),
            worker_task_packet: Some(task_packet.as_value()),
        },
        Some(&state.model_connection),
    )
    .await;
    let selection_payload = DelegatedExecutionSelection {
        explicit: agent_id.is_some(),
        score: Some(selection.score),
        reason_codes: selection.reason_codes.clone(),
        reason_text: Some(selection.reason.clone()).filter(|value| !value.trim().is_empty()),
        candidate_count: selection.candidate_count,
        selected_from_top_k: selection.selected_from_top_k,
        callable_coverage_score: Some(selection.callable_coverage_score),
        modality_fit_score: Some(selection.modality_fit_score),
        profile_prior_score: Some(selection.profile_prior_score),
    };
    let packet_receipt = Some(DelegatedExecutionPacketReceipt {
        packet_hash: task_packet.packet_hash.clone(),
        task_kind: task_packet.task_kind.clone(),
        deliverable_kind: task_packet.deliverable_kind.clone(),
        selected_profile_id: selection.profile.id.clone(),
    });
    let mut base_children = vec![
        DelegatedExecutionChildRecord {
            id: format!("{}:selection", execution_id),
            phase_id: Some("selection".to_string()),
            step_type: Some("agent_selection".to_string()),
            title: "Select delegated agent".to_string(),
            status: "succeeded".to_string(),
            worker_ref: None,
            summary: Some(format!(
                "Selected '{}' with reason {}.",
                selection.profile.name, selection.reason
            )),
            error: None,
            available_actions: Vec::new(),
        },
        DelegatedExecutionChildRecord {
            id: format!("{}:packet", execution_id),
            phase_id: Some("packet".to_string()),
            step_type: Some("task_packet".to_string()),
            title: "Build delegated task packet".to_string(),
            status: "succeeded".to_string(),
            worker_ref: None,
            summary: Some(format!(
                "Task kind '{}', deliverable '{}', {} context refs, {} constraints.",
                task_packet.task_kind,
                task_packet.deliverable_kind,
                context_refs.len(),
                constraints.len()
            )),
            error: None,
            available_actions: Vec::new(),
        },
    ];
    let record = match response_result {
        Ok(response) => {
            let summary = response
                .content
                .trim()
                .lines()
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("Delegated task completed")
                .to_string();
            base_children.push(DelegatedExecutionChildRecord {
                id: format!("{}:execution", execution_id),
                phase_id: Some("execution".to_string()),
                step_type: Some("custom_task_agent".to_string()),
                title: "Run delegated custom task agent".to_string(),
                status: response.status.clone(),
                worker_ref: Some(format!("custom_task_agent:{}", selection.profile.id)),
                summary: Some(summary.clone()),
                error: None,
                available_actions: Vec::new(),
            });
            DelegatedExecutionRecord {
                execution_id: execution_id.clone(),
                kind: DelegatedExecutionKind::CustomTaskAgent,
                status: DelegatedExecutionStatus::Succeeded,
                target: DelegatedExecutionTarget {
                    id: selection.profile.id.clone(),
                    name: selection.profile.name.clone(),
                    invocation_kind: Some(response.invocation_kind.as_str().to_string()),
                    worker_ref: None,
                    workflow_run_id: None,
                },
                selection: selection_payload,
                packet_receipt,
                available_actions: Vec::new(),
                children: base_children,
                summary: Some(summary),
                primary_output: Some(serde_json::json!({
                    "status": response.status,
                    "agent_id": selection.profile.id,
                    "agent_name": selection.profile.name,
                    "invocation_kind": response.invocation_kind.as_str(),
                    "content": response.content,
                    "reasoning_content": response.reasoning_content,
                    "images": response.images,
                    "audios": response.audios,
                    "tool_trace": response.tool_trace,
                    "callable_mcp_tool_ids": response.callable_mcp_tool_ids,
                    "guidance_skill_ids": response.guidance_skill_ids,
                    "callable_skill_action_refs": response.callable_skill_action_refs,
                    "model_id": response.model_id,
                    "provider_model_id": response.provider_model_id,
                    "delegated_model_policy": "inherit_parent_unless_profile_overrides",
                    "context_refs": context_refs,
                    "constraints": constraints,
                    "expected_output": arguments.get("expected_output").cloned(),
                    "session_id": session_id,
                    "tool_call_id": call_id,
                })),
                error: None,
                started_at_ms,
                completed_at_ms: Some(now_unix_ms_i64()),
            }
        }
        Err(err) => {
            let error_text = err.to_string();
            base_children.push(DelegatedExecutionChildRecord {
                id: format!("{}:execution", execution_id),
                phase_id: Some("execution".to_string()),
                step_type: Some("custom_task_agent".to_string()),
                title: "Run delegated custom task agent".to_string(),
                status: "failed".to_string(),
                worker_ref: Some(format!("custom_task_agent:{}", selection.profile.id)),
                summary: None,
                error: Some(error_text.clone()),
                available_actions: vec![DelegatedExecutionAction {
                    kind: "retry".to_string(),
                }],
            });
            DelegatedExecutionRecord {
                execution_id: execution_id.clone(),
                kind: DelegatedExecutionKind::CustomTaskAgent,
                status: DelegatedExecutionStatus::Failed,
                target: DelegatedExecutionTarget {
                    id: selection.profile.id.clone(),
                    name: selection.profile.name.clone(),
                    invocation_kind: Some(selection.profile.invocation_kind.as_str().to_string()),
                    worker_ref: None,
                    workflow_run_id: None,
                },
                selection: selection_payload,
                packet_receipt,
                available_actions: vec![DelegatedExecutionAction {
                    kind: "retry".to_string(),
                }],
                children: base_children,
                summary: Some("Delegated task failed".to_string()),
                primary_output: Some(serde_json::json!({
                    "status": "failed",
                    "agent_id": selection.profile.id,
                    "agent_name": selection.profile.name,
                    "error": error_text,
                    "context_refs": context_refs,
                    "constraints": constraints,
                    "expected_output": arguments.get("expected_output").cloned(),
                    "session_id": session_id,
                    "tool_call_id": call_id,
                })),
                error: Some(error_text),
                started_at_ms,
                completed_at_ms: Some(now_unix_ms_i64()),
            }
        }
    };
    let delegated_execution_tree =
        record.status_meta_with_status(DelegatedExecutionStatus::Integrated);
    audit::persist_delegate_task_execution_graph_snapshot(
        app_state.mcp.store.as_ref(),
        session_id,
        state.execution_policy.route.as_str(),
        state.execution_policy.initial_phase_step_name(),
        state.trace_id.as_str(),
        state.request_id.as_deref(),
        execution_id.as_str(),
        &state.runtime_transition_blocks,
        delegated_execution_tree,
    )
    .await;
    let _feedback = build_delegated_result_feedback_messages(&record);
    let result = record.delegated_result();
    let result_message = format!(
        "Delegated task result:\n{}",
        serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
    );
    Ok(DelegateTaskToolExecutionResult {
        meta: serde_json::json!({
            "id": call_id,
            "name": tool_name,
            "status": "success",
            "result": result,
        }),
        result_message,
    })
}
