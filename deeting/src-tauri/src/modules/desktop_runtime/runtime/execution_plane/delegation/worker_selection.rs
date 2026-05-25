use super::super::user_input::LatestUserImageInput;
use super::super::LocalExecutionRequest;
use super::bound_asset_reference::build_bound_asset_reference;
use super::events::{build_execution_selection, emit_delegation_lifecycle};
use super::{
    DelegatedExecutionKind, DelegatedExecutionPacketReceipt, DelegatedExecutionSelection,
    DelegatedExecutionStatus,
};
use crate::modules::desktop_runtime::runtime::select_worker_custom_task_agent;
use crate::modules::desktop_runtime::runtime::worker_dispatch::{
    build_worker_task_packet, WorkerTargetSelection, WorkerTaskPacket, WorkerTaskPacketInput,
};
use crate::state::AppState;
use serde_json::{json, Value};
use uuid::Uuid;

struct WorkerDelegationInput<'a> {
    app_state: &'a AppState,
    explicit_task_agent_id: Option<&'a str>,
    root_execution_id: Option<&'a str>,
    route: &'a str,
    allowed_tool_names: &'a [String],
    prefer_workflow_runtime: bool,
    explicit_selection_override: Option<WorkerTargetSelection>,
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) struct WorkerDelegationSelection {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) execution_id: String,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) query: String,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) selection:
        WorkerTargetSelection,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) execution_selection:
        DelegatedExecutionSelection,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) packet_receipt:
        Option<DelegatedExecutionPacketReceipt>,
    pub(in crate::modules::desktop_runtime::runtime::execution_plane) task_packet: WorkerTaskPacket,
}

impl<'a> From<&'a LocalExecutionRequest> for WorkerDelegationInput<'a> {
    fn from(request: &'a LocalExecutionRequest) -> Self {
        Self {
            app_state: &request.app_state,
            explicit_task_agent_id: request.explicit_task_agent_id.as_deref(),
            root_execution_id: request.root_execution_id.as_deref(),
            route: request.execution_policy.route.as_str(),
            allowed_tool_names: &request.execution_policy.allowed_tool_names,
            prefer_workflow_runtime: request.execution_policy.prefer_workflow_runtime,
            explicit_selection_override: request.explicit_task_agent_profile_override.as_ref().map(
                |profile| WorkerTargetSelection {
                    profile: profile.clone(),
                    score: 10_000,
                    reason: "explicit_task_agent_override".to_string(),
                    reason_codes: vec!["explicit_task_agent_override".to_string()],
                    candidate_count: 1,
                    selected_from_top_k: 1,
                    callable_coverage_score: 1.0,
                    modality_fit_score: 1.0,
                    profile_prior_score: 0.0,
                },
            ),
        }
    }
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane) async fn select_worker_delegation_for_request<
    F,
>(
    request: &LocalExecutionRequest,
    emit_status: &mut F,
    latest_input: &LatestUserImageInput,
) -> Result<Option<WorkerDelegationSelection>, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    let input = WorkerDelegationInput::from(request);
    select_worker_delegation(&input, emit_status, latest_input).await
}

async fn select_worker_delegation<F>(
    input: &WorkerDelegationInput<'_>,
    emit_status: &mut F,
    latest_input: &LatestUserImageInput,
) -> Result<Option<WorkerDelegationSelection>, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    let query = build_worker_delegation_query(latest_input);
    if query.trim().is_empty() {
        return Ok(None);
    }
    let selection = match input.explicit_selection_override.clone() {
        Some(selection) => selection,
        None => {
            let Some(selection) = select_worker_custom_task_agent(
                input.app_state,
                input.explicit_task_agent_id,
                query.as_str(),
            )
            .await?
            else {
                return Ok(None);
            };
            selection
        }
    };
    let execution_id = input
        .root_execution_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let task_packet = build_worker_task_packet(
        &selection,
        WorkerTaskPacketInput {
            task_id: execution_id.clone(),
            route: input.route.to_string(),
            goal: query.clone(),
            user_query: if !latest_input.raw_text.trim().is_empty() {
                latest_input.raw_text.clone()
            } else {
                query.clone()
            },
            raw_user_text: (!latest_input.raw_text.trim().is_empty())
                .then(|| latest_input.raw_text.clone()),
            image_urls: latest_input.image_urls.clone(),
            parent_allowed_tool_names: input.allowed_tool_names.to_vec(),
            prefer_workflow_runtime: input.prefer_workflow_runtime,
            explicit_task_agent_id: input.explicit_task_agent_id.map(str::to_string),
            bound_asset_reference: build_bound_asset_reference(input.app_state, &selection.profile)
                .await,
        },
    );
    let packet_receipt = Some(DelegatedExecutionPacketReceipt {
        packet_hash: task_packet.packet_hash.clone(),
        task_kind: task_packet.task_kind.clone(),
        deliverable_kind: task_packet.deliverable_kind.clone(),
        selected_profile_id: selection.profile.id.clone(),
    });
    let execution_selection = build_execution_selection(input.explicit_task_agent_id, &selection);

    emit_selected_worker_delegation(
        input,
        emit_status,
        execution_id.as_str(),
        &selection,
        &execution_selection,
        &task_packet,
    );

    Ok(Some(WorkerDelegationSelection {
        execution_id,
        query,
        selection,
        execution_selection,
        packet_receipt,
        task_packet,
    }))
}

fn build_worker_delegation_query(latest_input: &LatestUserImageInput) -> String {
    if !latest_input.prompt.trim().is_empty() {
        latest_input.prompt.clone()
    } else if !latest_input.image_urls.is_empty() {
        "image".to_string()
    } else {
        latest_input.raw_text.clone()
    }
}

fn emit_selected_worker_delegation<F>(
    input: &WorkerDelegationInput<'_>,
    emit_status: &mut F,
    execution_id: &str,
    selection: &WorkerTargetSelection,
    execution_selection: &DelegatedExecutionSelection,
    task_packet: &WorkerTaskPacket,
) where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    emit_delegation_lifecycle(
        emit_status,
        "worker_delegation",
        DelegatedExecutionStatus::Selected,
        execution_id,
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
            "agent_id": selection.profile.id.clone(),
            "agent_name": selection.profile.name.clone(),
            "selection_score": selection.score,
            "selection_reason": selection.reason.clone(),
            "packet_hash": task_packet.packet_hash.clone(),
            "candidate_count": selection.candidate_count,
            "selected_from_top_k": selection.selected_from_top_k,
            "explicit_task_agent_id": input.explicit_task_agent_id,
        })),
    );
}
