use super::{DelegatedExecutionKind, DelegatedExecutionSelection, DelegatedExecutionStatus};
use crate::modules::desktop_runtime::runtime::worker_dispatch::WorkerTargetSelection;
use serde_json::{json, Value};

pub(super) fn build_execution_selection(
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

pub(super) fn emit_delegation_lifecycle<F>(
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
