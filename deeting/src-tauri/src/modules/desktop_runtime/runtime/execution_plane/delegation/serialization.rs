use super::model::{
    DelegatedExecutionAction, DelegatedExecutionChildRecord, DelegatedExecutionPacketReceipt,
    DelegatedExecutionSelection, DelegatedExecutionTarget,
};
use serde_json::{json, Value};

pub(super) fn serialize_execution_target(target: &DelegatedExecutionTarget) -> Value {
    json!({
        "id": target.id.clone(),
        "name": target.name.clone(),
        "invocation_kind": target.invocation_kind.clone(),
        "worker_ref": target.worker_ref.clone(),
        "workflow_run_id": target.workflow_run_id.clone(),
    })
}

pub(super) fn serialize_execution_selection(selection: &DelegatedExecutionSelection) -> Value {
    json!({
        "explicit": selection.explicit,
        "score": selection.score,
        "reason_codes": selection.reason_codes.clone(),
        "reason_text": selection.reason_text.clone(),
        "candidate_count": selection.candidate_count,
        "selected_from_top_k": selection.selected_from_top_k,
        "callable_coverage_score": selection.callable_coverage_score,
        "modality_fit_score": selection.modality_fit_score,
        "profile_prior_score": selection.profile_prior_score,
    })
}

pub(super) fn serialize_packet_receipt(receipt: &Option<DelegatedExecutionPacketReceipt>) -> Value {
    match receipt {
        Some(receipt) => json!({
            "packet_hash": receipt.packet_hash.clone(),
            "task_kind": receipt.task_kind.clone(),
            "deliverable_kind": receipt.deliverable_kind.clone(),
            "selected_profile_id": receipt.selected_profile_id.clone(),
        }),
        None => Value::Null,
    }
}

pub(super) fn serialize_execution_actions(
    actions: &[DelegatedExecutionAction],
) -> Vec<serde_json::Value> {
    actions
        .iter()
        .map(|action| json!({ "kind": action.kind.clone() }))
        .collect::<Vec<_>>()
}

pub(super) fn serialize_execution_children(
    children: &[DelegatedExecutionChildRecord],
) -> Vec<serde_json::Value> {
    children
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
                "available_actions": serialize_execution_actions(&child.available_actions),
            })
        })
        .collect::<Vec<_>>()
}
