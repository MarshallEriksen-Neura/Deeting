use super::{
    build_delegated_result_feedback_messages, build_workflow_delegated_execution_session,
    run_policy_scoped_chat_completion, DelegatedExecutionAction, DelegatedExecutionChildRecord,
    DelegatedExecutionKind, DelegatedExecutionPacketReceipt, DelegatedExecutionRecord,
    DelegatedExecutionSelection, DelegatedExecutionSession, DelegatedExecutionStatus,
    DelegatedExecutionTarget, LocalExecutionOutcome, LocalExecutionRequest,
};
use crate::modules::audio::result_blocks::build_audio_result_block;
use crate::modules::chat_assets::resolve_chat_assets_dir;
use crate::modules::custom_task_agents::runtime::{
    preview_custom_task_agent_with_parent_model, CustomTaskAgentRuntimeError,
};
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentPreviewRequest, CustomTaskAgentPreviewResponse,
    CustomTaskAgentProfile,
};
use crate::modules::desktop_config::{parse_max_agentic_rounds, MAX_AGENTIC_ROUNDS_CONFIG_KEY};
use crate::modules::desktop_runtime::runtime::chat_tool_runtime::{
    build_persisted_chat_runtime_context_from_execution_request,
    serialize_delegated_workflow_runtime_context,
};
use crate::modules::desktop_runtime::runtime::control_plane::LocalExecutionPlane;
use crate::modules::desktop_runtime::runtime::worker_dispatch::{
    build_worker_task_packet, render_worker_task_packet_notes, WorkerTargetSelection,
    WorkerTaskPacketInput,
};
use crate::modules::desktop_runtime::runtime::{
    build_local_tool_trace_blocks, persist_execution_graph_runtime_context,
    persist_execution_graph_snapshot, project_execution_graph_snapshot,
    select_worker_custom_task_agent, GraphProjectionInput,
};
use crate::modules::workflow::service as workflow_service;
use crate::modules::workflow::types::{QuickWorkflowRequest, WorkflowRunStatus};
use crate::state::AppState;
use base64::Engine;
use mcp_core::types::LocalChatInputMessage;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct LatestUserImageInput {
    prompt: String,
    image_urls: Vec<String>,
    raw_text: String,
}

pub(super) async fn run_worker_execution_handler<F>(
    request: LocalExecutionRequest,
    emit_status: &mut F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    debug_assert_eq!(
        request.execution_policy.plane,
        LocalExecutionPlane::WorkerReasoning
    );
    let delegated_execution =
        maybe_delegate_worker_to_custom_task_agent(&request, emit_status).await?;
    run_policy_scoped_chat_completion(request, delegated_execution, emit_status).await
}

async fn maybe_delegate_worker_to_custom_task_agent<F>(
    request: &LocalExecutionRequest,
    emit_status: &mut F,
) -> Result<Option<DelegatedExecutionSession>, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    if !request.execution_policy.allow_worker_delegation {
        return Ok(None);
    }

    let latest_input = latest_user_image_input(&request.messages);
    let query = if !latest_input.prompt.trim().is_empty() {
        latest_input.prompt.clone()
    } else if !latest_input.image_urls.is_empty() {
        "image".to_string()
    } else {
        latest_input.raw_text.clone()
    };
    if query.trim().is_empty() {
        return Ok(None);
    }
    let Some(selection) = select_worker_custom_task_agent(
        &request.app_state,
        request.explicit_task_agent_id.as_deref(),
        query.as_str(),
    )
    .await?
    else {
        return Ok(None);
    };
    let execution_id = request
        .root_execution_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let task_packet = build_worker_task_packet(
        &selection,
        WorkerTaskPacketInput {
            task_id: execution_id.clone(),
            route: request.execution_policy.route.as_str().to_string(),
            goal: query.clone(),
            user_query: if !latest_input.raw_text.trim().is_empty() {
                latest_input.raw_text.clone()
            } else {
                query.clone()
            },
            raw_user_text: (!latest_input.raw_text.trim().is_empty())
                .then(|| latest_input.raw_text.clone()),
            image_urls: latest_input.image_urls.clone(),
            parent_allowed_tool_names: request.execution_policy.allowed_tool_names.clone(),
            prefer_workflow_runtime: request.execution_policy.prefer_workflow_runtime,
            explicit_task_agent_id: request.explicit_task_agent_id.clone(),
            bound_asset_reference: build_bound_asset_reference(
                &request.app_state,
                &selection.profile,
            )
            .await,
        },
    );
    let packet_receipt = Some(DelegatedExecutionPacketReceipt {
        packet_hash: task_packet.packet_hash.clone(),
        task_kind: task_packet.task_kind.clone(),
        deliverable_kind: task_packet.deliverable_kind.clone(),
        selected_profile_id: selection.profile.id.clone(),
    });
    let execution_selection =
        build_execution_selection(request.explicit_task_agent_id.as_deref(), &selection);
    emit_delegation_lifecycle(
        emit_status,
        "worker_delegation",
        DelegatedExecutionStatus::Selected,
        &execution_id,
        DelegatedExecutionKind::CustomTaskAgent,
        &selection.profile.id,
        &selection.profile.name,
        Some(selection.profile.invocation_kind.as_str()),
        None,
        execution_selection.score,
        execution_selection.reason_text.as_deref(),
        None,
        None,
    );

    emit_status(
        "evolve",
        Some("worker_delegation"),
        "running",
        "worker.task.delegated",
        Some(json!({
            "agent_id": selection.profile.id,
            "agent_name": selection.profile.name,
            "selection_score": selection.score,
            "selection_reason": selection.reason,
            "packet_hash": task_packet.packet_hash,
            "candidate_count": selection.candidate_count,
            "selected_from_top_k": selection.selected_from_top_k,
        })),
    );

    let should_route_through_workflow = request.execution_policy.prefer_workflow_runtime
        && selection.profile.invocation_kind == CustomTaskAgentInvocationKind::Chat;
    if should_route_through_workflow {
        let worker_ref = format!("user_worker_profile:{}", selection.profile.id);
        emit_delegation_lifecycle(
            emit_status,
            "worker_delegation",
            DelegatedExecutionStatus::Launching,
            &execution_id,
            DelegatedExecutionKind::Workflow,
            &selection.profile.id,
            &selection.profile.name,
            Some(selection.profile.invocation_kind.as_str()),
            Some(worker_ref.as_str()),
            execution_selection.score,
            execution_selection.reason_text.as_deref(),
            None,
            None,
        );
        emit_delegation_lifecycle(
            emit_status,
            "worker_delegation",
            DelegatedExecutionStatus::Running,
            &execution_id,
            DelegatedExecutionKind::Workflow,
            &selection.profile.id,
            &selection.profile.name,
            Some(selection.profile.invocation_kind.as_str()),
            Some(worker_ref.as_str()),
            execution_selection.score,
            execution_selection.reason_text.as_deref(),
            None,
            None,
        );
        let execution = match workflow_service::prepare_quick_workflow_run(
            &request.app_handle,
            &request.app_state,
            QuickWorkflowRequest {
                goal: query.clone(),
                worker_ref: Some(worker_ref.clone()),
                inject_into_chat: true,
                user_notes: Some(render_worker_task_packet_notes(&task_packet)),
                worker_task_packet: Some(task_packet.clone()),
            },
        )
        .await
        {
            Ok(prepared_run) => {
                let delegated_execution_tree = json!({
                    "execution_id": execution_id,
                    "execution_kind": "workflow",
                    "execution_status": "running",
                    "terminal_status": "running",
                    "target_id": selection.profile.id,
                    "target_name": selection.profile.name,
                    "invocation_kind": selection.profile.invocation_kind.as_str(),
                    "worker_ref": worker_ref.as_str(),
                    "workflow_run_id": prepared_run.id.clone(),
                    "selection": {
                        "explicit": request.explicit_task_agent_id.as_deref() == Some(selection.profile.id.as_str()),
                        "score": execution_selection.score,
                        "reason_codes": execution_selection.reason_codes,
                        "reason_text": execution_selection.reason_text,
                        "candidate_count": execution_selection.candidate_count,
                        "selected_from_top_k": execution_selection.selected_from_top_k,
                        "callable_coverage_score": execution_selection.callable_coverage_score,
                        "modality_fit_score": execution_selection.modality_fit_score,
                        "profile_prior_score": execution_selection.profile_prior_score,
                    },
                    "packet_receipt": packet_receipt.clone(),
                    "children": [],
                });
                let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
                    session_id: request.session_id.clone(),
                    route: request.execution_policy.route.as_str().to_string(),
                    plane: request.execution_policy.plane.as_str().to_string(),
                    trace_id: request.trace_id.clone(),
                    request_id: request.request_id.clone(),
                    root_execution_id: Some(execution_id.clone()),
                    response_content: None,
                    tool_trace_blocks: Vec::new(),
                    delegated_execution_tree: Some(delegated_execution_tree),
                })
                .to_value();
                let _ = persist_execution_graph_snapshot(
                    request.app_state.mcp.store.as_ref(),
                    &execution_graph,
                    request.session_id.as_str(),
                    "desktop_local_chat_delegated_workflow_running",
                    request.request_id.as_deref(),
                    Some("active"),
                )
                .await;
                let _ = persist_execution_graph_runtime_context(
                    request.app_state.mcp.store.as_ref(),
                    execution_id.as_str(),
                    &serialize_delegated_workflow_runtime_context(
                        Some(format!("workflow:{}", prepared_run.id)),
                        None,
                        prepared_run.id.clone(),
                        Some(selection.profile.id.as_str()),
                        Some(selection.profile.name.as_str()),
                        Some("running"),
                        true,
                        Some(build_persisted_chat_runtime_context_from_execution_request(
                            request,
                            Some(query.clone()),
                            request
                                .trace_id
                                .clone()
                                .unwrap_or_else(|| Uuid::new_v4().to_string()),
                            parse_max_agentic_rounds(
                                request
                                    .app_state
                                    .mcp
                                    .store
                                    .get_desktop_config(MAX_AGENTIC_ROUNDS_CONFIG_KEY)
                                    .await
                                    .ok()
                                    .flatten()
                                    .as_deref(),
                            ),
                        )),
                        request.session_id.as_str(),
                        request.trace_id.as_deref().unwrap_or_default(),
                        request.request_id.as_deref(),
                        Some(execution_id.as_str()),
                        None,
                    ),
                )
                .await;

                let app_handle = request.app_handle.clone();
                let app_state = request.app_state.clone();
                let workflow_run_id = prepared_run.id.clone();
                let execution_id_for_spawn = execution_id.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = workflow_service::start_workflow_run(
                        &app_handle,
                        &app_state,
                        &workflow_run_id,
                    )
                    .await
                    {
                        log::warn!(
                            "delegated workflow start failed execution_id={} workflow_run_id={} err={}",
                            execution_id_for_spawn,
                            workflow_run_id,
                            err
                        );
                    }
                });

                let waiting_payload = json!({
                    "status": "running",
                    "agent_id": selection.profile.id,
                    "agent_name": selection.profile.name,
                    "workflow_run_id": prepared_run.id.clone(),
                    "workflow_status": WorkflowRunStatus::Running.as_str(),
                    "content": serde_json::Value::Null,
                    "steps": []
                });
                let waiting_trace_blocks = build_local_tool_trace_blocks(&[json!({
                    "id": format!("delegated-workflow-{}", prepared_run.id),
                    "name": format!("workflow/{}", selection.profile.name),
                    "status": "running",
                    "result": waiting_payload.clone(),
                })]);
                let waiting_record = DelegatedExecutionRecord {
                    execution_id: execution_id.clone(),
                    kind: DelegatedExecutionKind::Workflow,
                    status: DelegatedExecutionStatus::Running,
                    target: DelegatedExecutionTarget {
                        id: selection.profile.id.clone(),
                        name: selection.profile.name.clone(),
                        invocation_kind: Some(
                            selection.profile.invocation_kind.as_str().to_string(),
                        ),
                        worker_ref: Some(worker_ref.clone()),
                        workflow_run_id: Some(prepared_run.id.clone()),
                    },
                    selection: execution_selection.clone(),
                    packet_receipt: packet_receipt.clone(),
                    available_actions: vec![DelegatedExecutionAction {
                        kind: "open".to_string(),
                    }],
                    children: Vec::new(),
                    summary: Some(format!("workflow {} running", prepared_run.id)),
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
            Err(err) => {
                emit_delegation_lifecycle(
                    emit_status,
                    "worker_delegation",
                    DelegatedExecutionStatus::Failed,
                    &execution_id,
                    DelegatedExecutionKind::Workflow,
                    &selection.profile.id,
                    &selection.profile.name,
                    Some(selection.profile.invocation_kind.as_str()),
                    Some(worker_ref.as_str()),
                    execution_selection.score,
                    execution_selection.reason_text.as_deref(),
                    None,
                    Some(err.as_str()),
                );
                emit_status(
                    "evolve",
                    Some("worker_delegation"),
                    "error",
                    "worker.task.failed",
                    Some(json!({
                        "agent_id": selection.profile.id,
                        "agent_name": selection.profile.name,
                        "execution_path": "workflow_runtime",
                        "error": err,
                    })),
                );
                build_workflow_delegated_execution_session(
                    execution_id.clone(),
                    selection.profile.clone(),
                    execution_selection.clone(),
                    packet_receipt.clone(),
                    worker_ref,
                    Err(err),
                )
            }
        };

        return Ok(Some(execution));
    }

    if request.execution_policy.prefer_workflow_runtime
        && selection.profile.invocation_kind != CustomTaskAgentInvocationKind::Chat
    {
        emit_status(
            "evolve",
            Some("worker_delegation"),
            "success",
            "worker.workflow_route.skipped",
            Some(json!({
                "agent_id": selection.profile.id,
                "agent_name": selection.profile.name,
                "reason": "non_chat_invocation_kind",
                "invocation_kind": selection.profile.invocation_kind.as_str(),
            })),
        );
    }

    emit_delegation_lifecycle(
        emit_status,
        "worker_delegation",
        DelegatedExecutionStatus::Launching,
        &execution_id,
        DelegatedExecutionKind::CustomTaskAgent,
        &selection.profile.id,
        &selection.profile.name,
        Some(selection.profile.invocation_kind.as_str()),
        None,
        execution_selection.score,
        execution_selection.reason_text.as_deref(),
        None,
        None,
    );
    emit_delegation_lifecycle(
        emit_status,
        "worker_delegation",
        DelegatedExecutionStatus::Running,
        &execution_id,
        DelegatedExecutionKind::CustomTaskAgent,
        &selection.profile.id,
        &selection.profile.name,
        Some(selection.profile.invocation_kind.as_str()),
        None,
        execution_selection.score,
        execution_selection.reason_text.as_deref(),
        None,
        None,
    );
    let max_rounds = resolve_worker_task_agent_max_rounds(&request.app_state).await;
    let execution = match preview_custom_task_agent_with_parent_model(
        &request.app_handle,
        &request.app_state,
        &selection.profile,
        CustomTaskAgentPreviewRequest {
            message: latest_input.raw_text.clone(),
            image_urls: latest_input.image_urls.clone(),
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            max_rounds: Some(max_rounds),
            worker_task_packet: Some(task_packet.as_value()),
        },
        Some(&request.model_connection),
    )
    .await
    {
        Ok(result) => {
            let summary = summarize_content(result.content.as_str());
            emit_delegation_lifecycle(
                emit_status,
                "worker_delegation",
                DelegatedExecutionStatus::Succeeded,
                &execution_id,
                DelegatedExecutionKind::CustomTaskAgent,
                &selection.profile.id,
                &selection.profile.name,
                Some(result.invocation_kind.as_str()),
                None,
                execution_selection.score,
                execution_selection.reason_text.as_deref(),
                None,
                summary.as_deref(),
            );
            let render_blocks = build_custom_task_agent_render_blocks(
                &request.app_handle,
                &request.app_state,
                &selection.profile,
                &result,
                Some(&query),
            )
            .await;
            emit_status(
                "evolve",
                Some("worker_delegation"),
                "success",
                "worker.task.completed",
                Some(json!({
                    "agent_id": selection.profile.id,
                    "agent_name": selection.profile.name,
                    "invocation_kind": result.invocation_kind.as_str(),
                    "images": result.images.len(),
                    "audios": result.audios.len(),
                    "tool_trace_count": result.tool_trace.len(),
                })),
            );
            build_delegated_execution_session(
                execution_id.clone(),
                selection.profile.clone(),
                execution_selection.clone(),
                packet_receipt.clone(),
                Ok(result),
                render_blocks,
            )
        }
        Err(err) => {
            let err_text = err.to_string();
            emit_delegation_lifecycle(
                emit_status,
                "worker_delegation",
                DelegatedExecutionStatus::Failed,
                &execution_id,
                DelegatedExecutionKind::CustomTaskAgent,
                &selection.profile.id,
                &selection.profile.name,
                Some(selection.profile.invocation_kind.as_str()),
                None,
                execution_selection.score,
                execution_selection.reason_text.as_deref(),
                None,
                Some(err_text.as_str()),
            );
            emit_status(
                "evolve",
                Some("worker_delegation"),
                "error",
                "worker.task.failed",
                Some(json!({
                    "agent_id": selection.profile.id,
                    "agent_name": selection.profile.name,
                    "error": err_text,
                })),
            );
            build_delegated_execution_session(
                execution_id,
                selection.profile.clone(),
                execution_selection,
                packet_receipt,
                Err(err),
                Vec::new(),
            )
        }
    };

    Ok(Some(execution))
}

async fn resolve_worker_task_agent_max_rounds(app_state: &AppState) -> u32 {
    let configured_max_rounds = app_state
        .mcp
        .store
        .get_desktop_config(MAX_AGENTIC_ROUNDS_CONFIG_KEY)
        .await
        .ok()
        .flatten();
    parse_max_agentic_rounds(configured_max_rounds.as_deref()).min(u32::MAX as usize) as u32
}

fn build_execution_selection(
    explicit_task_agent_id: Option<&str>,
    selection: &WorkerTargetSelection,
) -> DelegatedExecutionSelection {
    DelegatedExecutionSelection {
        explicit: explicit_task_agent_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some(),
        score: Some(selection.score),
        reason_codes: selection.reason_codes.clone(),
        reason_text: Some(selection.reason.clone()).filter(|value| !value.trim().is_empty()),
        candidate_count: selection.candidate_count,
        selected_from_top_k: selection.selected_from_top_k,
        callable_coverage_score: Some(selection.callable_coverage_score),
        modality_fit_score: Some(selection.modality_fit_score),
        profile_prior_score: Some(selection.profile_prior_score),
    }
}

fn emit_delegation_lifecycle<F>(
    emit_status: &mut F,
    step: &str,
    status: DelegatedExecutionStatus,
    execution_id: &str,
    kind: DelegatedExecutionKind,
    target_id: &str,
    target_name: &str,
    invocation_kind: Option<&str>,
    worker_ref: Option<&str>,
    selection_score: Option<i32>,
    selection_reason: Option<&str>,
    workflow_run_id: Option<&str>,
    summary: Option<&str>,
) where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    let state = match status {
        DelegatedExecutionStatus::Failed | DelegatedExecutionStatus::Cancelled => "error",
        DelegatedExecutionStatus::Succeeded | DelegatedExecutionStatus::Integrated => "success",
        DelegatedExecutionStatus::Selected
        | DelegatedExecutionStatus::Launching
        | DelegatedExecutionStatus::Running => "running",
    };
    emit_status(
        "evolve",
        Some(step),
        state,
        &format!("delegation.{}", status.as_str()),
        Some(json!({
            "execution_id": execution_id,
            "execution_kind": kind.as_str(),
            "execution_status": status.as_str(),
            "target_id": target_id,
            "target_name": target_name,
            "invocation_kind": invocation_kind,
            "worker_ref": worker_ref,
            "selection_score": selection_score,
            "selection_reason": selection_reason,
            "workflow_run_id": workflow_run_id,
            "summary": summary,
        })),
    );
}

fn summarize_content(content: &str) -> Option<String> {
    let summary = content
        .split_whitespace()
        .take(32)
        .collect::<Vec<_>>()
        .join(" ");
    if summary.is_empty() {
        None
    } else {
        Some(summary)
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn latest_user_message(messages: &[LocalChatInputMessage]) -> Option<String> {
    messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.content.clone())
}

fn latest_user_image_input(messages: &[LocalChatInputMessage]) -> LatestUserImageInput {
    let Some(message) = messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
    else {
        return LatestUserImageInput::default();
    };

    let raw_text = message.content.trim().to_string();
    if raw_text.is_empty() {
        return LatestUserImageInput::default();
    }

    let trimmed = raw_text.trim();
    if !(trimmed.starts_with('[') || trimmed.starts_with('{')) {
        return LatestUserImageInput {
            prompt: raw_text.clone(),
            image_urls: Vec::new(),
            raw_text,
        };
    }

    let parsed = match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => value,
        Err(_) => {
            return LatestUserImageInput {
                prompt: raw_text.clone(),
                image_urls: Vec::new(),
                raw_text,
            }
        }
    };
    let items = parsed.as_array().cloned().unwrap_or_else(|| vec![parsed]);
    let mut text_parts = Vec::new();
    let mut image_urls = Vec::new();

    for item in items {
        let Some(object) = item.as_object() else {
            continue;
        };
        let block_type = object
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        match block_type {
            "text" => {
                if let Some(text) = object
                    .get("text")
                    .and_then(|value| value.as_str())
                    .or_else(|| object.get("content").and_then(|value| value.as_str()))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    text_parts.push(text.to_string());
                }
            }
            "image_url" => {
                if let Some(url) = object
                    .get("image_url")
                    .and_then(|value| {
                        value.as_str().map(str::to_string).or_else(|| {
                            value
                                .get("url")
                                .and_then(|entry| entry.as_str())
                                .map(str::to_string)
                        })
                    })
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                {
                    image_urls.push(url);
                }
            }
            _ => {}
        }
    }

    LatestUserImageInput {
        prompt: text_parts.join("\n"),
        image_urls,
        raw_text,
    }
}

fn build_delegated_execution_session(
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
            let primary_child = build_primary_child_execution_record(
                execution_id.as_str(),
                &profile,
                "succeeded",
                summarize_content(result.content.as_str()),
                None,
                if render_blocks.is_empty() {
                    Vec::new()
                } else {
                    vec![DelegatedExecutionAction {
                        kind: "view_result".to_string(),
                    }]
                },
            );
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
            let primary_child = build_primary_child_execution_record(
                execution_id.as_str(),
                &profile,
                "failed",
                Some(error_text.clone()),
                Some(error_text.clone()),
                Vec::new(),
            );
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

fn build_primary_child_execution_record(
    execution_id: &str,
    profile: &CustomTaskAgentProfile,
    status: &str,
    summary: Option<String>,
    error: Option<String>,
    available_actions: Vec<DelegatedExecutionAction>,
) -> DelegatedExecutionChildRecord {
    DelegatedExecutionChildRecord {
        id: format!("{execution_id}:primary"),
        phase_id: None,
        step_type: Some("worker_call".to_string()),
        title: profile.name.clone(),
        status: status.to_string(),
        worker_ref: Some(format!("user_worker_profile:{}", profile.id)),
        summary,
        error,
        available_actions,
    }
}

fn build_custom_task_agent_render_blocks(
    app_handle: &AppHandle,
    app_state: &AppState,
    profile: &CustomTaskAgentProfile,
    result: &CustomTaskAgentPreviewResponse,
    prompt: Option<&str>,
) -> futures_util::future::BoxFuture<'static, Vec<Value>> {
    let profile = profile.clone();
    let result = result.clone();
    let prompt = prompt.map(|value| value.to_string());
    let app_state = app_state.clone();
    let app_handle = app_handle.clone();
    Box::pin(async move {
        let mut blocks = Vec::new();
        if result.invocation_kind == CustomTaskAgentInvocationKind::ImageGeneration {
            let outputs =
                persist_custom_task_agent_image_outputs(&app_handle, &app_state, &result).await;
            if outputs.is_empty() {
                return blocks;
            }
            let preview = outputs.first().cloned().unwrap_or_else(|| json!({}));
            blocks.push(json!({
                "view_type": "image.result",
                "title": format!("{} Image Result", profile.name),
                "payload": {
                    "preview": preview,
                    "outputs": outputs,
                    "prompt": prompt.unwrap_or_default(),
                    "model": result.model_id,
                },
                "metadata": {
                    "agentId": profile.id,
                    "agentName": profile.name,
                    "invocationKind": result.invocation_kind.as_str(),
                    "providerModelId": result.provider_model_id,
                }
            }));
            return blocks;
        }

        if result.invocation_kind == CustomTaskAgentInvocationKind::TextToSpeech {
            let Some(payload) = result.raw.as_ref() else {
                return blocks;
            };
            let Some(audio_payload) = serde_json::from_value(payload.clone()).ok() else {
                return blocks;
            };
            let title = format!("{} Audio Result", profile.name);
            blocks.push(build_audio_result_block(
                profile.id.as_str(),
                Some(title.as_str()),
                &audio_payload,
                Some(json!({
                    "agentId": profile.id,
                    "agentName": profile.name,
                    "invocationKind": result.invocation_kind.as_str(),
                    "providerModelId": result.provider_model_id,
                })),
            ));
            return blocks;
        }

        blocks
    })
}

async fn build_bound_asset_reference(
    app_state: &AppState,
    profile: &CustomTaskAgentProfile,
) -> Option<Value> {
    let asset_id = profile
        .bound_asset_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let record = app_state
        .mcp
        .store
        .get_local_asset_record(asset_id)
        .await
        .ok()
        .flatten()?;
    if record.is_archived
        || !record.status.eq_ignore_ascii_case("active")
        || !record.asset_kind.eq_ignore_ascii_case("html_asset")
    {
        return None;
    }
    Some(json!({
        "asset_id": record.asset_id,
        "title": record.title,
        "summary": record.summary,
        "render_hint": record.render_hint,
        "data_mode": record.data_mode,
        "match_hints": parse_json_string_list(record.match_hints_json.as_deref()),
        "props_hint": parse_json_string_list(record.props_hint_json.as_deref()),
        "output_example": parse_json_value(record.output_example_json.as_deref()),
    }))
}

fn parse_json_string_list(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .unwrap_or_default()
}

fn parse_json_value(raw: Option<&str>) -> Option<Value> {
    raw.and_then(|value| serde_json::from_str::<Value>(value).ok())
}

#[cfg(test)]
mod tests {
    use super::{latest_user_image_input, LatestUserImageInput};
    use mcp_core::types::LocalChatInputMessage;

    #[test]
    fn latest_user_image_input_reads_structured_text_and_images() {
        let input = latest_user_image_input(&[LocalChatInputMessage {
            role: "user".to_string(),
            content: r#"[{"type":"text","text":"draw a cat"},{"type":"image_url","image_url":{"url":"asset://chat-assets/demo.png"}},{"type":"image_url","image_url":{"url":"local-asset://abc123"}}]"#.to_string(),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        }]);

        assert_eq!(input.prompt, "draw a cat");
        assert_eq!(
            input.image_urls,
            vec![
                "asset://chat-assets/demo.png".to_string(),
                "local-asset://abc123".to_string()
            ]
        );
    }

    #[test]
    fn latest_user_image_input_keeps_plain_text_messages() {
        let input = latest_user_image_input(&[LocalChatInputMessage {
            role: "user".to_string(),
            content: "@image-agent draw a cat".to_string(),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        }]);

        assert_eq!(
            input,
            LatestUserImageInput {
                prompt: "@image-agent draw a cat".to_string(),
                image_urls: vec![],
                raw_text: "@image-agent draw a cat".to_string(),
            }
        );
    }
}

async fn persist_custom_task_agent_image_outputs(
    app_handle: &AppHandle,
    app_state: &AppState,
    result: &CustomTaskAgentPreviewResponse,
) -> Vec<Value> {
    if let Some(outputs) = result
        .raw
        .as_ref()
        .and_then(|raw| raw.get("outputs"))
        .and_then(Value::as_array)
    {
        return outputs.to_vec();
    }
    let raw_items = result
        .raw
        .as_ref()
        .and_then(|raw| raw.get("data"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut outputs = Vec::new();
    for (index, image) in result.images.iter().enumerate() {
        let raw_item = raw_items.get(index);
        let content_type = raw_item
            .and_then(|item| item.get("content_type"))
            .and_then(Value::as_str)
            .unwrap_or_else(|| infer_image_content_type(image))
            .to_string();
        let persisted =
            persist_custom_task_agent_image(app_handle, app_state, image, &content_type).await;
        let (asset_url, source_url, size_bytes) = match persisted {
            Some(PersistedImageLocation::ObjectStorage {
                object_key,
                public_url,
                size_bytes,
            }) => (
                public_url.map(Value::String).unwrap_or(Value::Null),
                Value::String(format!("asset://{}", object_key)),
                json!(size_bytes),
            ),
            Some(PersistedImageLocation::Local { sha256, size_bytes }) => (
                Value::Null,
                Value::String(format!("local-asset://{}", sha256)),
                json!(size_bytes),
            ),
            None => (Value::Null, Value::String(image.clone()), Value::Null),
        };

        outputs.push(json!({
            "output_index": index,
            "asset_url": asset_url,
            "source_url": source_url,
            "seed": raw_item.and_then(|item| item.get("seed")).cloned().unwrap_or(Value::Null),
            "content_type": content_type,
            "size_bytes": size_bytes,
            "width": raw_item.and_then(|item| item.get("width")).cloned().unwrap_or(Value::Null),
            "height": raw_item.and_then(|item| item.get("height")).cloned().unwrap_or(Value::Null),
        }));
    }
    outputs
}

enum PersistedImageLocation {
    ObjectStorage {
        object_key: String,
        public_url: Option<String>,
        size_bytes: usize,
    },
    Local {
        sha256: String,
        size_bytes: usize,
    },
}

async fn persist_custom_task_agent_image(
    app_handle: &AppHandle,
    app_state: &AppState,
    image: &str,
    content_type: &str,
) -> Option<PersistedImageLocation> {
    let bytes = if let Some(bytes) = decode_data_url_bytes(image) {
        bytes
    } else if image.trim_start().starts_with("http://")
        || image.trim_start().starts_with("https://")
    {
        let response = app_state
            .mcp
            .transport
            .client
            .get(image)
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.bytes().await.ok()?.to_vec()
    } else {
        return None;
    };
    let sha256 = compute_sha256_hex(&bytes);
    let ext = image_ext_from_content_type(content_type);
    let object_key = format!("chat-assets/generated/{}.{}", sha256, ext);

    match app_state
        .providers
        .store
        .put_local_desktop_object_storage_bytes(&object_key, content_type, &bytes)
        .await
    {
        Ok(Some(saved_object_key)) => {
            let public_url = app_state
                .providers
                .store
                .get_local_desktop_object_storage_config()
                .await
                .ok()
                .flatten()
                .and_then(|config| config.build_public_url(&saved_object_key));
            Some(PersistedImageLocation::ObjectStorage {
                object_key: saved_object_key,
                public_url,
                size_bytes: bytes.len(),
            })
        }
        Ok(None) | Err(_) => {
            let app_data_dir = app_handle.path().app_data_dir().ok();
            let dir = resolve_chat_assets_dir(app_data_dir);
            std::fs::create_dir_all(&dir).ok()?;
            let path = dir.join(format!("{}.{}", sha256, ext));
            if !path.exists() {
                std::fs::write(&path, &bytes).ok()?;
            }
            Some(PersistedImageLocation::Local {
                sha256,
                size_bytes: bytes.len(),
            })
        }
    }
}

fn decode_data_url_bytes(value: &str) -> Option<Vec<u8>> {
    let trimmed = value.trim();
    let marker = ";base64,";
    let idx = trimmed.find(marker)?;
    let encoded = &trimmed[idx + marker.len()..];
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()
}

fn infer_image_content_type(value: &str) -> &str {
    let trimmed = value.trim();
    if let Some(rest) = trimmed.strip_prefix("data:") {
        if let Some(idx) = rest.find(';') {
            let content_type = &rest[..idx];
            if !content_type.trim().is_empty() {
                return content_type;
            }
        }
    }
    "image/png"
}

fn image_ext_from_content_type(content_type: &str) -> &str {
    match content_type {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        _ => "bin",
    }
}

fn compute_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}
