use super::evaluator::{
    normalize_task_learning_user_response_signal, rebuild_task_learning_evaluation_from_outcome,
};
use super::types::{EvaluatedOutcome, PolicyDelta, TaskFingerprint, TaskLearningSignals};
use crate::modules::desktop_runtime::runtime::{LocalExecutionPolicy, LocalRouteDecision};
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::{McpStore, TaskLearningRevisionRow, TaskLearningRunRow};
use mcp_session::admin::{
    LocalTaskLearningRevisionItem, LocalTaskLearningRunDetail, LocalTaskLearningRunListItem,
    LocalTaskLearningRunListResponse, LocalTaskLearningRunQuery, LocalTaskPolicyPriorItem,
    LocalTaskPolicyPriorListResponse, LocalTaskPolicyPriorQuery,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

fn parse_json<T>(raw: &str) -> Result<T, McpError>
where
    T: DeserializeOwned,
{
    serde_json::from_str(raw).map_err(|err| McpError::Storage(err.to_string()))
}

fn parse_optional_json<T>(raw: Option<&str>) -> Result<Option<T>, McpError>
where
    T: DeserializeOwned,
{
    raw.map(parse_json).transpose()
}

fn parse_json_value(raw: &str) -> Value {
    serde_json::from_str(raw).unwrap_or_else(|_| Value::Null)
}

fn signed_delta(delta: &PolicyDelta) -> f64 {
    match delta.direction.as_str() {
        "strengthen" | "positive" => delta.magnitude.abs(),
        "weaken" | "negative" => -delta.magnitude.abs(),
        _ => delta.magnitude,
    }
}

async fn apply_signed_delta(
    store: &McpStore,
    fingerprint_key: &str,
    delta: &PolicyDelta,
    signed_weight: f64,
    run_id: &str,
    evidence_delta: i64,
) -> Result<(), McpError> {
    if signed_weight.abs() < f64::EPSILON {
        return Ok(());
    }
    store
        .adjust_task_policy_prior(
            fingerprint_key,
            delta.decision_point.as_str(),
            delta.action_key.as_str(),
            signed_weight,
            delta.state.as_str(),
            delta.magnitude.abs().clamp(0.0, 1.0),
            Some(run_id),
            evidence_delta,
        )
        .await
}

async fn reconcile_policy_delta(
    store: &McpStore,
    fingerprint_key: &str,
    previous_delta: Option<&PolicyDelta>,
    next_delta: Option<&PolicyDelta>,
    run_id: &str,
) -> Result<(), McpError> {
    match (previous_delta, next_delta) {
        (Some(previous), Some(next))
            if previous.decision_point == next.decision_point
                && previous.action_key == next.action_key =>
        {
            let diff = signed_delta(next) - signed_delta(previous);
            apply_signed_delta(store, fingerprint_key, next, diff, run_id, 0).await
        }
        (Some(previous), Some(next)) => {
            apply_signed_delta(
                store,
                fingerprint_key,
                previous,
                -signed_delta(previous),
                run_id,
                0,
            )
            .await?;
            apply_signed_delta(store, fingerprint_key, next, signed_delta(next), run_id, 0).await
        }
        (Some(previous), None) => {
            apply_signed_delta(
                store,
                fingerprint_key,
                previous,
                -signed_delta(previous),
                run_id,
                0,
            )
            .await
        }
        (None, Some(next)) => {
            apply_signed_delta(store, fingerprint_key, next, signed_delta(next), run_id, 1).await
        }
        (None, None) => Ok(()),
    }
}

fn signals_from_outcome(outcome: &EvaluatedOutcome) -> TaskLearningSignals {
    TaskLearningSignals {
        tool_call_count: outcome.tool_call_count,
        tool_error_count: if matches!(outcome.final_status.as_str(), "partial" | "failed")
            && outcome.error_profile != "none"
        {
            1
        } else {
            0
        },
        requires_approval_count: if outcome.final_status == "blocked" {
            1
        } else {
            0
        },
        search_sdk_calls: outcome.search_sdk_calls,
        used_attach_capability: outcome.used_attach_capability,
        attach_capability_errors: if outcome.used_attach_capability
            && outcome.final_status != "success"
            && outcome.error_profile == "structural"
        {
            1
        } else {
            0
        },
        used_execute_code_plan: outcome.used_execute_code_plan,
        successful_execute_code_plan: outcome.used_execute_code_plan
            && outcome.execution_judgment == "justified"
            && outcome.final_status == "success",
        delegated_execution: outcome.had_delegated_execution
            || outcome.delegated_execution.is_some(),
        observed_error_codes: outcome.observed_error_codes.clone(),
    }
}

fn revise_outcome_for_signal(
    outcome: &EvaluatedOutcome,
    user_response_signal: &str,
) -> EvaluatedOutcome {
    let normalized_signal =
        normalize_task_learning_user_response_signal(Some(user_response_signal));
    let mut revised = outcome.clone();
    revised.user_response_signal = normalized_signal.clone();
    match normalized_signal.as_str() {
        "accepted" => {
            if revised.final_status == "success"
                && matches!(
                    revised.verification_result.as_str(),
                    "unverified" | "weak_pass"
                )
            {
                revised.verification_result = if revised.tool_call_count > 0
                    || revised.had_delegated_execution
                    || revised.delegated_execution.is_some()
                {
                    "passed".to_string()
                } else {
                    "weak_pass".to_string()
                };
            }
            revised.confidence = (revised.confidence + 0.12).clamp(0.0, 1.0);
        }
        "corrected" => {
            if revised.final_status == "success" {
                revised.final_status = "partial".to_string();
            }
            revised.verification_result = "failed".to_string();
            revised.confidence = (revised.confidence - 0.28).clamp(0.0, 1.0);
        }
        "rejected" => {
            if revised.final_status != "blocked" {
                revised.final_status = "failed".to_string();
            }
            revised.verification_result = "failed".to_string();
            revised.confidence = (revised.confidence - 0.35).clamp(0.0, 1.0);
        }
        _ => {}
    }
    revised
}

fn decision_point_from_run(row: &TaskLearningRunRow) -> Option<String> {
    row.policy_delta_json
        .as_deref()
        .and_then(|raw| parse_json_value(raw).get("decision_point").cloned())
        .and_then(|value| value.as_str().map(str::to_string))
        .or_else(|| {
            parse_json_value(row.attribution_json.as_str())
                .get("primary_stage")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn summary_item_from_row(row: TaskLearningRunRow) -> LocalTaskLearningRunListItem {
    let outcome = parse_json_value(row.outcome_json.as_str());
    let decision_point = decision_point_from_run(&row);
    LocalTaskLearningRunListItem {
        run_id: row.run_id,
        session_id: row.session_id,
        request_id: row.request_id,
        trace_id: row.trace_id,
        fingerprint_key: row.fingerprint_key,
        decision_point,
        learning_eligible: row.learning_eligible,
        delta_state: row.delta_state,
        final_status: outcome
            .get("final_status")
            .and_then(Value::as_str)
            .map(str::to_string),
        verification_result: outcome
            .get("verification_result")
            .and_then(Value::as_str)
            .map(str::to_string),
        user_response_signal: outcome
            .get("user_response_signal")
            .and_then(Value::as_str)
            .map(str::to_string),
        confidence: outcome.get("confidence").and_then(Value::as_f64),
        revision_count: row.revision_count,
        last_signal: row.last_signal,
        created_at_unix_ms: row.created_at_unix_ms,
        last_revision_at_unix_ms: row.last_revision_at_unix_ms,
    }
}

fn revision_item_from_row(row: TaskLearningRevisionRow) -> LocalTaskLearningRevisionItem {
    LocalTaskLearningRevisionItem {
        id: row.id,
        run_id: row.run_id,
        revision_index: row.revision_index,
        trigger_source: row.trigger_source,
        user_response_signal: row.user_response_signal,
        note: row.note,
        outcome: parse_json_value(row.outcome_json.as_str()),
        attribution: parse_json_value(row.attribution_json.as_str()),
        policy_delta: row.policy_delta_json.as_deref().map(parse_json_value),
        delta_state: row.delta_state,
        created_at_unix_ms: row.created_at_unix_ms,
    }
}

#[allow(dead_code)]
pub(crate) fn infer_followup_user_response_signal(user_text: &str) -> Option<String> {
    let normalized = user_text.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    let corrected_markers = [
        "actually",
        "that is wrong",
        "that's wrong",
        "not correct",
        "correction",
        "you missed",
        "you are wrong",
        "不对",
        "错了",
        "不是",
        "纠正",
        "反驳",
        "补充证据",
        "根据这个日志",
    ];
    if corrected_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return Some("corrected".to_string());
    }
    let rejected_markers = ["redo this", "try again", "重新来", "重做", "不行", "没解决"];
    if rejected_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return Some("rejected".to_string());
    }
    None
}

pub(crate) async fn list_task_learning_runs_for_query(
    store: &McpStore,
    query: &LocalTaskLearningRunQuery,
) -> Result<LocalTaskLearningRunListResponse, McpError> {
    let skip = query.skip.unwrap_or(0).max(0) as usize;
    let limit = query.limit.unwrap_or(50).max(1) as usize;
    let total = store
        .count_task_learning_runs(
            query.session_id.as_deref(),
            query.fingerprint_key.as_deref(),
            query.decision_point.as_deref(),
            query.user_response_signal.as_deref(),
            query.learning_eligible,
        )
        .await?;
    let items = store
        .list_task_learning_runs(
            query.session_id.as_deref(),
            query.fingerprint_key.as_deref(),
            query.decision_point.as_deref(),
            query.user_response_signal.as_deref(),
            query.learning_eligible,
            skip,
            limit,
        )
        .await?
        .into_iter()
        .map(summary_item_from_row)
        .collect();
    Ok(LocalTaskLearningRunListResponse {
        total,
        skip: skip as i64,
        limit: limit as i64,
        items,
    })
}

pub(crate) async fn list_task_policy_priors_for_query(
    store: &McpStore,
    query: &LocalTaskPolicyPriorQuery,
) -> Result<LocalTaskPolicyPriorListResponse, McpError> {
    let skip = query.skip.unwrap_or(0).max(0) as usize;
    let limit = query.limit.unwrap_or(50).max(1) as usize;
    let total = store
        .count_task_policy_priors(
            query.fingerprint_key.as_deref(),
            query.decision_point.as_deref(),
        )
        .await?;
    let items = store
        .list_task_policy_priors(
            query.fingerprint_key.as_deref(),
            query.decision_point.as_deref(),
            skip,
            limit,
        )
        .await?
        .into_iter()
        .map(|row| LocalTaskPolicyPriorItem {
            fingerprint_key: row.fingerprint_key,
            decision_point: row.decision_point,
            action_key: row.action_key,
            weight: row.weight,
            confidence: row.confidence,
            evidence_count: row.evidence_count,
            maturity: row.maturity,
            updated_at_unix_ms: row.updated_at_unix_ms,
        })
        .collect();
    Ok(LocalTaskPolicyPriorListResponse {
        total,
        skip: skip as i64,
        limit: limit as i64,
        items,
    })
}

pub(crate) async fn list_task_learning_revisions_for_run(
    store: &McpStore,
    run_id: &str,
) -> Result<Vec<LocalTaskLearningRevisionItem>, McpError> {
    store
        .list_task_learning_revisions(run_id)
        .await
        .map(|items| items.into_iter().map(revision_item_from_row).collect())
}

pub(crate) async fn load_task_learning_run_detail(
    store: &McpStore,
    run_id: &str,
) -> Result<Option<LocalTaskLearningRunDetail>, McpError> {
    let Some(row) = store.get_task_learning_run(run_id).await? else {
        return Ok(None);
    };
    let revisions = list_task_learning_revisions_for_run(store, run_id).await?;
    let trace_feedback = match row.trace_id.as_deref() {
        Some(trace_id) => {
            store
                .list_local_trace_feedback_by_trace_id(trace_id)
                .await?
        }
        None => Vec::new(),
    };
    Ok(Some(LocalTaskLearningRunDetail {
        run_id: row.run_id,
        session_id: row.session_id,
        request_id: row.request_id,
        trace_id: row.trace_id,
        fingerprint_key: row.fingerprint_key,
        task_fingerprint: parse_json_value(row.task_fingerprint_json.as_str()),
        route_decision: row.route_decision_json.as_deref().map(parse_json_value),
        execution_policy: parse_json_value(row.execution_policy_json.as_str()),
        outcome: parse_json_value(row.outcome_json.as_str()),
        attribution: parse_json_value(row.attribution_json.as_str()),
        policy_delta: row.policy_delta_json.as_deref().map(parse_json_value),
        learning_eligible: row.learning_eligible,
        delta_state: row.delta_state,
        revision_count: row.revision_count,
        last_signal: row.last_signal,
        created_at_unix_ms: row.created_at_unix_ms,
        last_revision_at_unix_ms: row.last_revision_at_unix_ms,
        revisions,
        trace_feedback,
    }))
}

pub(crate) async fn apply_task_learning_revision(
    store: &McpStore,
    run_id: &str,
    user_response_signal: &str,
    trigger_source: &str,
    note: Option<&str>,
) -> Result<Option<LocalTaskLearningRunDetail>, McpError> {
    let Some(row) = store.get_task_learning_run(run_id).await? else {
        return Ok(None);
    };
    let fingerprint: TaskFingerprint = parse_json(row.task_fingerprint_json.as_str())?;
    let route_decision: Option<LocalRouteDecision> =
        parse_optional_json(row.route_decision_json.as_deref())?;
    let execution_policy: LocalExecutionPolicy = parse_json(row.execution_policy_json.as_str())?;
    let previous_outcome: EvaluatedOutcome = parse_json(row.outcome_json.as_str())?;
    let previous_delta: Option<PolicyDelta> =
        parse_optional_json(row.policy_delta_json.as_deref())?;
    let revised_outcome = revise_outcome_for_signal(&previous_outcome, user_response_signal);
    let finish_reason = revised_outcome.finish_reason.clone();
    let signals = signals_from_outcome(&revised_outcome);
    let evaluation = rebuild_task_learning_evaluation_from_outcome(
        &fingerprint,
        route_decision.as_ref(),
        &execution_policy,
        finish_reason.as_str(),
        &signals,
        revised_outcome,
    );
    let outcome_json = serde_json::to_string(&evaluation.outcome)
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let attribution_json = serde_json::to_string(&evaluation.attribution)
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let policy_delta_json = evaluation
        .policy_delta
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|err| McpError::Storage(err.to_string()))?;
    reconcile_policy_delta(
        store,
        row.fingerprint_key.as_str(),
        previous_delta.as_ref(),
        evaluation.policy_delta.as_ref(),
        row.run_id.as_str(),
    )
    .await?;
    let revision = store
        .append_task_learning_revision(
            row.run_id.as_str(),
            trigger_source,
            evaluation.outcome.user_response_signal.as_str(),
            note,
            outcome_json.as_str(),
            attribution_json.as_str(),
            policy_delta_json.as_deref(),
            evaluation.delta_state.as_str(),
        )
        .await?;
    store
        .update_task_learning_run_revision_state(
            row.run_id.as_str(),
            outcome_json.as_str(),
            attribution_json.as_str(),
            policy_delta_json.as_deref(),
            evaluation.learning_eligible,
            evaluation.delta_state.as_str(),
            Some(evaluation.outcome.user_response_signal.as_str()),
            row.revision_count.saturating_add(1),
            revision.created_at_unix_ms,
        )
        .await?;
    load_task_learning_run_detail(store, row.run_id.as_str()).await
}

pub(crate) async fn replay_task_learning_run(
    store: &McpStore,
    run_id: &str,
    note: Option<&str>,
) -> Result<Option<LocalTaskLearningRunDetail>, McpError> {
    let Some(row) = store.get_task_learning_run(run_id).await? else {
        return Ok(None);
    };
    let fingerprint: TaskFingerprint = parse_json(row.task_fingerprint_json.as_str())?;
    let route_decision: Option<LocalRouteDecision> =
        parse_optional_json(row.route_decision_json.as_deref())?;
    let execution_policy: LocalExecutionPolicy = parse_json(row.execution_policy_json.as_str())?;
    let current_outcome: EvaluatedOutcome = parse_json(row.outcome_json.as_str())?;
    let previous_delta: Option<PolicyDelta> =
        parse_optional_json(row.policy_delta_json.as_deref())?;
    let finish_reason = current_outcome.finish_reason.clone();
    let signals = signals_from_outcome(&current_outcome);
    let evaluation = rebuild_task_learning_evaluation_from_outcome(
        &fingerprint,
        route_decision.as_ref(),
        &execution_policy,
        finish_reason.as_str(),
        &signals,
        current_outcome,
    );
    let outcome_json = serde_json::to_string(&evaluation.outcome)
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let attribution_json = serde_json::to_string(&evaluation.attribution)
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let policy_delta_json = evaluation
        .policy_delta
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|err| McpError::Storage(err.to_string()))?;
    reconcile_policy_delta(
        store,
        row.fingerprint_key.as_str(),
        previous_delta.as_ref(),
        evaluation.policy_delta.as_ref(),
        row.run_id.as_str(),
    )
    .await?;
    let revision = store
        .append_task_learning_revision(
            row.run_id.as_str(),
            "admin_replay",
            evaluation.outcome.user_response_signal.as_str(),
            note,
            outcome_json.as_str(),
            attribution_json.as_str(),
            policy_delta_json.as_deref(),
            evaluation.delta_state.as_str(),
        )
        .await?;
    store
        .update_task_learning_run_revision_state(
            row.run_id.as_str(),
            outcome_json.as_str(),
            attribution_json.as_str(),
            policy_delta_json.as_deref(),
            evaluation.learning_eligible,
            evaluation.delta_state.as_str(),
            Some(evaluation.outcome.user_response_signal.as_str()),
            row.revision_count.saturating_add(1),
            revision.created_at_unix_ms,
        )
        .await?;
    load_task_learning_run_detail(store, row.run_id.as_str()).await
}
