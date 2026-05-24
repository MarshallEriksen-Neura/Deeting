use super::super::user_input::LatestUserImageInput;
use super::super::LocalExecutionRequest;
use super::events::emit_delegation_lifecycle;
use super::media_rendering::build_custom_task_agent_render_blocks;
use super::{
    build_custom_task_agent_delegated_execution_session, build_custom_task_agent_preview_request,
    build_delegated_result_feedback_messages, DelegatedExecutionAction, DelegatedExecutionKind,
    DelegatedExecutionPacketReceipt, DelegatedExecutionRecord, DelegatedExecutionSelection,
    DelegatedExecutionSession, DelegatedExecutionStatus, DelegatedExecutionTarget,
};
use crate::modules::custom_task_agents::runtime::preview_custom_task_agent_with_parent_model;
use crate::modules::custom_task_agents::store::{
    complete_custom_task_agent_run, create_custom_task_agent_run, fail_custom_task_agent_run,
};
use crate::modules::custom_task_agents::types::{CustomTaskAgentProfile, CustomTaskAgentRunStatus};
use crate::modules::desktop_config::{parse_max_agentic_rounds, MAX_AGENTIC_ROUNDS_CONFIG_KEY};
use crate::modules::desktop_runtime::runtime::chat_tool_runtime::{
    build_persisted_chat_runtime_context_from_execution_request,
    resume_delegated_runtime_after_custom_task_agent_run, serialize_delegated_runtime_context,
};
use crate::modules::desktop_runtime::runtime::worker_dispatch::{
    WorkerTargetSelection, WorkerTaskPacket,
};
use crate::modules::desktop_runtime::runtime::{
    build_local_tool_trace_blocks, persist_execution_graph_runtime_context,
};
use crate::modules::mcp::store::McpStore;
use serde_json::{json, Value};
use uuid::Uuid;

pub(in crate::modules::desktop_runtime::runtime::execution_plane) async fn delegate_selected_custom_task_agent<
    F,
>(
    request: &LocalExecutionRequest,
    emit_status: &mut F,
    execution_id: String,
    query: String,
    latest_input: LatestUserImageInput,
    selection: WorkerTargetSelection,
    execution_selection: DelegatedExecutionSelection,
    packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    task_packet: WorkerTaskPacket,
) -> Result<Option<DelegatedExecutionSession>, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    emit_delegation_lifecycle(
        emit_status,
        "worker_delegation",
        DelegatedExecutionStatus::Launching,
        execution_id.as_str(),
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
        execution_id.as_str(),
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

    let max_rounds =
        resolve_worker_task_agent_max_rounds(request.app_state.mcp.store.as_ref()).await;
    let child_run_id = Uuid::new_v4().to_string();
    create_custom_task_agent_run(
        request.app_state.mcp.store.as_ref(),
        child_run_id.as_str(),
        selection.profile.id.as_str(),
        execution_id.as_str(),
        &json!({
            "message": latest_input.raw_text.clone(),
            "image_urls": latest_input.image_urls.clone(),
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "max_rounds": max_rounds,
            "worker_task_packet": task_packet.as_value(),
        }),
    )
    .await
    .map_err(|err| err.to_string())?;

    if request.explicit_task_agent_id.as_deref() == Some(selection.profile.id.as_str()) {
        let result = preview_custom_task_agent_with_parent_model(
            &request.app_handle,
            &request.app_state,
            &selection.profile,
            build_custom_task_agent_preview_request(
                latest_input.raw_text.clone(),
                latest_input.image_urls.clone(),
                request.temperature,
                request.max_tokens,
                max_rounds,
                &task_packet,
            ),
            Some(&request.model_connection),
        )
        .await;

        let session = match result {
            Ok(result) => {
                let render_blocks = build_custom_task_agent_render_blocks(
                    &request.app_handle,
                    &request.app_state,
                    &selection.profile,
                    &result,
                    Some(query.as_str()),
                )
                .await;
                let session = build_custom_task_agent_delegated_execution_session(
                    execution_id.clone(),
                    selection.profile.clone(),
                    execution_selection,
                    packet_receipt,
                    Ok(result),
                    render_blocks,
                );
                if let Err(err) = complete_custom_task_agent_run(
                    request.app_state.mcp.store.as_ref(),
                    child_run_id.as_str(),
                    &session.record.delegated_result(),
                )
                .await
                {
                    log::warn!(
                        "complete_custom_task_agent_run failed run_id={} err={}",
                        child_run_id,
                        err
                    );
                }
                session
            }
            Err(err) => {
                let session = build_custom_task_agent_delegated_execution_session(
                    execution_id.clone(),
                    selection.profile.clone(),
                    execution_selection,
                    packet_receipt,
                    Err(err.clone()),
                    Vec::new(),
                );
                if let Err(store_err) = fail_custom_task_agent_run(
                    request.app_state.mcp.store.as_ref(),
                    child_run_id.as_str(),
                    err.to_string().as_str(),
                )
                .await
                {
                    log::warn!(
                        "fail_custom_task_agent_run failed run_id={} err={}",
                        child_run_id,
                        store_err
                    );
                }
                session
            }
        };

        return Ok(Some(session));
    }

    persist_custom_task_agent_delegated_runtime_context(
        request,
        execution_id.as_str(),
        child_run_id.as_str(),
        &selection.profile,
        query.as_str(),
        max_rounds,
    )
    .await;

    spawn_custom_task_agent_preview(
        request,
        execution_id.clone(),
        query.clone(),
        latest_input,
        selection.clone(),
        execution_selection.clone(),
        packet_receipt.clone(),
        task_packet,
        child_run_id.clone(),
        max_rounds,
    );

    Ok(Some(build_running_custom_task_agent_session(
        execution_id,
        selection,
        execution_selection,
        packet_receipt,
        child_run_id,
    )))
}

async fn resolve_worker_task_agent_max_rounds(store: &McpStore) -> u32 {
    let configured_max_rounds = store
        .get_desktop_config(MAX_AGENTIC_ROUNDS_CONFIG_KEY)
        .await
        .ok()
        .flatten();
    parse_max_agentic_rounds(configured_max_rounds.as_deref()).min(u32::MAX as usize) as u32
}

async fn persist_custom_task_agent_delegated_runtime_context(
    request: &LocalExecutionRequest,
    execution_id: &str,
    child_run_id: &str,
    profile: &CustomTaskAgentProfile,
    query: &str,
    max_rounds: u32,
) {
    let trace_id = request
        .trace_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let chat_runtime = build_persisted_chat_runtime_context_from_execution_request(
        request,
        Some(query.to_string()),
        trace_id.clone(),
        max_rounds as usize,
    );
    let context = serialize_delegated_runtime_context(
        Some(format!("custom_task_agent_run:{child_run_id}")),
        None,
        DelegatedExecutionKind::CustomTaskAgent.as_str(),
        child_run_id.to_string(),
        Some(profile.id.as_str()),
        Some(profile.name.as_str()),
        Some(CustomTaskAgentRunStatus::Running.as_str()),
        true,
        Some(chat_runtime),
        request.session_id.as_str(),
        trace_id.as_str(),
        request.request_id.as_deref(),
        Some(execution_id),
        None,
    );

    if let Err(err) = persist_execution_graph_runtime_context(
        request.app_state.mcp.store.as_ref(),
        execution_id,
        &context,
    )
    .await
    {
        log::warn!(
            "persist custom task agent delegated runtime context failed execution_id={} run_id={} err={}",
            execution_id,
            child_run_id,
            err
        );
    }
}

fn spawn_custom_task_agent_preview(
    request: &LocalExecutionRequest,
    execution_id: String,
    query: String,
    latest_input: LatestUserImageInput,
    selection: WorkerTargetSelection,
    execution_selection: DelegatedExecutionSelection,
    packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    task_packet: WorkerTaskPacket,
    child_run_id: String,
    max_rounds: u32,
) {
    let app_handle = request.app_handle.clone();
    let app_state = request.app_state.clone();
    let profile = selection.profile.clone();
    let selection_payload = execution_selection.clone();
    let packet_receipt_payload = packet_receipt.clone();
    let model_connection = request.model_connection.clone();
    let preview_request = build_custom_task_agent_preview_request(
        latest_input.raw_text.clone(),
        latest_input.image_urls.clone(),
        request.temperature,
        request.max_tokens,
        max_rounds,
        &task_packet,
    );
    tauri::async_runtime::spawn(async move {
        let result = preview_custom_task_agent_with_parent_model(
            &app_handle,
            &app_state,
            &profile,
            preview_request,
            Some(&model_connection),
        )
        .await;

        match result {
            Ok(result) => {
                let render_blocks = build_custom_task_agent_render_blocks(
                    &app_handle,
                    &app_state,
                    &profile,
                    &result,
                    Some(&query),
                )
                .await;
                let session = build_custom_task_agent_delegated_execution_session(
                    execution_id.clone(),
                    profile.clone(),
                    selection_payload.clone(),
                    packet_receipt_payload.clone(),
                    Ok(result),
                    render_blocks,
                );
                let payload = session.record.delegated_result();
                if let Err(err) = complete_custom_task_agent_run(
                    app_state.mcp.store.as_ref(),
                    child_run_id.as_str(),
                    &payload,
                )
                .await
                {
                    log::warn!(
                        "complete_custom_task_agent_run failed run_id={} err={}",
                        child_run_id,
                        err
                    );
                }
                let _ = resume_delegated_runtime_after_custom_task_agent_run(
                    &app_handle,
                    &app_state,
                    execution_id.as_str(),
                    child_run_id.as_str(),
                    &format!("custom_task_agent:{}:completed", child_run_id),
                    session,
                )
                .await;
            }
            Err(err) => {
                let session = build_custom_task_agent_delegated_execution_session(
                    execution_id.clone(),
                    profile.clone(),
                    selection_payload.clone(),
                    packet_receipt_payload.clone(),
                    Err(err.clone()),
                    Vec::new(),
                );
                if let Err(store_err) = fail_custom_task_agent_run(
                    app_state.mcp.store.as_ref(),
                    child_run_id.as_str(),
                    err.to_string().as_str(),
                )
                .await
                {
                    log::warn!(
                        "fail_custom_task_agent_run failed run_id={} err={}",
                        child_run_id,
                        store_err
                    );
                }
                let _ = resume_delegated_runtime_after_custom_task_agent_run(
                    &app_handle,
                    &app_state,
                    execution_id.as_str(),
                    child_run_id.as_str(),
                    &format!("custom_task_agent:{}:failed", child_run_id),
                    session,
                )
                .await;
            }
        }
    });
}

fn build_running_custom_task_agent_session(
    execution_id: String,
    selection: WorkerTargetSelection,
    execution_selection: DelegatedExecutionSelection,
    packet_receipt: Option<DelegatedExecutionPacketReceipt>,
    child_run_id: String,
) -> DelegatedExecutionSession {
    let agent_id = selection.profile.id.clone();
    let agent_name = selection.profile.name.clone();
    let record = DelegatedExecutionRecord {
        execution_id: execution_id.clone(),
        kind: DelegatedExecutionKind::CustomTaskAgent,
        status: DelegatedExecutionStatus::Running,
        target: DelegatedExecutionTarget {
            id: selection.profile.id.clone(),
            name: selection.profile.name.clone(),
            invocation_kind: Some(selection.profile.invocation_kind.as_str().to_string()),
            worker_ref: Some(format!("custom_task_agent_run:{child_run_id}")),
            workflow_run_id: None,
        },
        selection: execution_selection,
        packet_receipt,
        available_actions: vec![DelegatedExecutionAction {
            kind: "open".to_string(),
        }],
        children: Vec::new(),
        summary: Some(format!("custom task agent {} running", agent_name)),
        primary_output: Some(json!({
            "status": CustomTaskAgentRunStatus::Running.as_str(),
            "agent_id": agent_id,
            "agent_name": agent_name,
            "run_id": child_run_id.clone(),
        })),
        error: None,
        started_at_ms: chrono::Utc::now().timestamp_millis(),
        completed_at_ms: None,
    };

    DelegatedExecutionSession {
        feedback_messages: build_delegated_result_feedback_messages(&record),
        trace_blocks: build_local_tool_trace_blocks(&[json!({
            "id": format!("delegated-agent-run-{}", child_run_id),
            "name": format!("custom_task_agent/{}", selection.profile.name),
            "status": "running",
            "result": {
                "status": CustomTaskAgentRunStatus::Running.as_str(),
                "run_id": child_run_id.clone(),
                "agent_id": selection.profile.id.clone(),
                "agent_name": selection.profile.name.clone(),
            }
        })]),
        record,
    }
}
