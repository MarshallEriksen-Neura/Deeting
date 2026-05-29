use super::fingerprint::build_task_fingerprint;
use super::types::{
    is_legacy_route_control_delta, TaskPolicyHint, TaskPolicyHintItem,
    DECISION_POINT_DISCOVERY, DECISION_POINT_EXECUTION,
    DECISION_POINT_VERIFICATION, DECISION_POINT_WORKER_SELECTION,
};

const PRIOR_HALF_LIFE_MS: f64 = 21.0 * 24.0 * 60.0 * 60.0 * 1000.0;

pub(crate) fn normalize_decision_point(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "worker_selection" | "worker_profile" | "delegated_worker" => {
            DECISION_POINT_WORKER_SELECTION.to_string()
        }
        "discovery" | "search" | "search_sdk" => DECISION_POINT_DISCOVERY.to_string(),
        "execution" | "execution_escalation" | "execute" | "execute_code_plan" => {
            DECISION_POINT_EXECUTION.to_string()
        }
        "verification" | "verify" => DECISION_POINT_VERIFICATION.to_string(),
        other => other.to_string(),
    }
}

fn guidance_for_decision_point(decision_point: &str) -> Option<String> {
    match decision_point {
        DECISION_POINT_WORKER_SELECTION => Some(
            "Worker-selection priors should bias ranking between candidate custom task agent profiles for the same task family, but never override explicit profile selection.".to_string(),
        ),
        DECISION_POINT_DISCOVERY => Some(
            "Discovery priors should influence whether to call `search_sdk` early and whether to refine weak results before concluding capability limits.".to_string(),
        ),
        DECISION_POINT_EXECUTION => Some(
            "Execution priors should influence whether escalation into `execute_code_plan` is justified or whether lighter direct tools should stay preferred.".to_string(),
        ),
        DECISION_POINT_VERIFICATION => Some(
            "Verification priors are policy telemetry for evidence strength. They must not override the user's requested deliverable or introduce extra verification narration unless verification is part of the user's goal.".to_string(),
        ),
        _ => None,
    }
}

fn decay_weight(raw_weight: f64, updated_at_unix_ms: i64, now_unix_ms: i64) -> f64 {
    let age_ms = (now_unix_ms - updated_at_unix_ms).max(0) as f64;
    let decay = 0.5_f64.powf(age_ms / PRIOR_HALF_LIFE_MS);
    raw_weight * decay
}

pub(crate) async fn query_task_policy_hint(
    store: &crate::modules::mcp::store::McpStore,
    query: &str,
    decision_point: &str,
    limit: usize,
) -> TaskPolicyHint {
    let task_fingerprint = build_task_fingerprint(query);
    let fingerprint_key = task_fingerprint.key();
    let normalized_decision_point = normalize_decision_point(decision_point);
    let now_unix_ms = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;
    let rows = store
        .list_task_policy_prior_rows(&fingerprint_key, &normalized_decision_point, limit.max(1))
        .await
        .unwrap_or_default();
    let mut priors = rows
        .into_iter()
        .map(|row| TaskPolicyHintItem {
            action_key: row.action_key,
            raw_weight: row.weight,
            effective_weight: decay_weight(row.weight, row.updated_at_unix_ms, now_unix_ms),
            confidence: row.confidence,
            evidence_count: row.evidence_count,
            maturity: row.maturity,
            updated_at_unix_ms: row.updated_at_unix_ms,
        })
        .collect::<Vec<_>>();
    priors.sort_by(|left, right| {
        right
            .effective_weight
            .partial_cmp(&left.effective_weight)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let recommended_action = priors
        .iter()
        .find(|item| item.effective_weight > 0.1)
        .map(|item| item.action_key.clone());

    TaskPolicyHint {
        query: query.trim().to_string(),
        decision_point: normalized_decision_point.clone(),
        fingerprint_key,
        task_fingerprint,
        recommended_action,
        priors,
        guidance: guidance_for_decision_point(&normalized_decision_point),
    }
}

pub(crate) async fn apply_policy_delta(
    store: &crate::modules::mcp::store::McpStore,
    fingerprint_key: &str,
    delta: &super::types::PolicyDelta,
    run_id: Option<&str>,
) -> Result<(), crate::modules::mcp::error::McpError> {
    if is_legacy_route_control_delta(delta.decision_point.as_str(), delta.action_key.as_str()) {
        return Ok(());
    }
    let signed_delta = match delta.direction.as_str() {
        "strengthen" | "positive" => delta.magnitude.abs(),
        "weaken" | "negative" => -delta.magnitude.abs(),
        _ => delta.magnitude,
    };
    store
        .apply_task_policy_delta(
            fingerprint_key,
            &delta.decision_point,
            &delta.action_key,
            signed_delta,
            delta.state.as_str(),
            delta.magnitude.abs().clamp(0.0, 1.0),
            run_id,
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::normalize_decision_point;

    #[test]
    fn normalize_decision_point_maps_aliases() {
        assert_eq!(normalize_decision_point("execute_code_plan"), "execution");
        assert_eq!(normalize_decision_point("search"), "discovery");
        assert_eq!(
            normalize_decision_point("worker_profile"),
            "worker_selection"
        );
    }
}
