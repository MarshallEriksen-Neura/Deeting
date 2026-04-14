use super::fingerprint::build_task_fingerprint;
use super::types::{
    TaskPolicyHint, TaskPolicyHintItem, ACTION_ROUTE_DIRECT, ACTION_ROUTE_WORKER,
    DECISION_POINT_CAPABILITY_ATTACH, DECISION_POINT_DISCOVERY, DECISION_POINT_EXECUTION,
    DECISION_POINT_ROUTE, DECISION_POINT_VERIFICATION,
};
use crate::modules::desktop_runtime::runtime::LocalRouteDecision;

const PRIOR_HALF_LIFE_MS: f64 = 21.0 * 24.0 * 60.0 * 60.0 * 1000.0;
const ROUTE_OVERRIDE_THRESHOLD: f64 = 0.35;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RoutePriorApplication {
    pub(crate) decision: LocalRouteDecision,
    pub(crate) hint: TaskPolicyHint,
    pub(crate) direct_score: f64,
    pub(crate) worker_score: f64,
    pub(crate) override_applied: bool,
}

pub(crate) fn normalize_decision_point(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "route" => DECISION_POINT_ROUTE.to_string(),
        "discovery" | "search" | "search_sdk" => DECISION_POINT_DISCOVERY.to_string(),
        "capability_attach" | "attach" | "attach_capability" => {
            DECISION_POINT_CAPABILITY_ATTACH.to_string()
        }
        "execution" | "execution_escalation" | "execute" | "execute_code_plan" => {
            DECISION_POINT_EXECUTION.to_string()
        }
        "verification" | "verify" => DECISION_POINT_VERIFICATION.to_string(),
        other => other.to_string(),
    }
}

fn guidance_for_decision_point(decision_point: &str) -> Option<String> {
    match decision_point {
        DECISION_POINT_ROUTE => Some(
            "Route priors are infrastructure-owned. Prefer them only as a tie-breaker over the base direct/worker router, never as a safety override.".to_string(),
        ),
        DECISION_POINT_DISCOVERY => Some(
            "Discovery priors should influence whether to call `search_sdk` early and whether to refine weak results before concluding capability limits.".to_string(),
        ),
        DECISION_POINT_CAPABILITY_ATTACH => Some(
            "Capability-attach priors should influence whether `attach_capability` is justified for this task family.".to_string(),
        ),
        DECISION_POINT_EXECUTION => Some(
            "Execution priors should influence whether escalation into `execute_code_plan` is justified or whether lighter direct tools should stay preferred.".to_string(),
        ),
        DECISION_POINT_VERIFICATION => Some(
            "Verification priors should tighten or relax completion checks before returning the answer.".to_string(),
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

fn decision_has_safety_lock(decision: &LocalRouteDecision) -> bool {
    decision.reasons.iter().any(|reason| {
        matches!(
            reason.as_str(),
            "explicit_route"
                | "destructive_intent"
                | "approval_sensitive"
                | "mutating_capability"
                | "high_risk_capability"
        )
    })
}

pub(crate) fn apply_route_prior(
    base_decision: LocalRouteDecision,
    hint: TaskPolicyHint,
) -> RoutePriorApplication {
    let direct_weight = hint
        .priors
        .iter()
        .find(|item| item.action_key == ACTION_ROUTE_DIRECT)
        .map(|item| item.effective_weight)
        .unwrap_or(0.0);
    let worker_weight = hint
        .priors
        .iter()
        .find(|item| item.action_key == ACTION_ROUTE_WORKER)
        .map(|item| item.effective_weight)
        .unwrap_or(0.0);

    let mut direct_score = if base_decision.route.as_str() == ACTION_ROUTE_DIRECT {
        1.0
    } else {
        0.0
    };
    let mut worker_score = if base_decision.route.as_str() == ACTION_ROUTE_WORKER {
        1.0
    } else {
        0.0
    };
    direct_score += direct_weight;
    worker_score += worker_weight;

    let preferred_route = if direct_score > worker_score {
        ACTION_ROUTE_DIRECT
    } else {
        ACTION_ROUTE_WORKER
    };
    let override_applied = !decision_has_safety_lock(&base_decision)
        && !hint.priors.is_empty()
        && preferred_route != base_decision.route.as_str()
        && (direct_score - worker_score).abs() >= ROUTE_OVERRIDE_THRESHOLD;

    let mut decision = base_decision;
    if override_applied {
        decision.route = if preferred_route == ACTION_ROUTE_DIRECT {
            crate::modules::desktop_runtime::runtime::LocalRouteKind::Direct
        } else {
            crate::modules::desktop_runtime::runtime::LocalRouteKind::Worker
        };
        decision
            .reasons
            .push(format!("task_learning_route_prior:{preferred_route}"));
    } else if !hint.priors.is_empty() {
        decision
            .reasons
            .push("task_learning_route_prior_observed".to_string());
    }

    RoutePriorApplication {
        decision,
        hint,
        direct_score,
        worker_score,
        override_applied,
    }
}

pub(crate) async fn apply_policy_delta(
    store: &crate::modules::mcp::store::McpStore,
    fingerprint_key: &str,
    delta: &super::types::PolicyDelta,
    run_id: Option<&str>,
) -> Result<(), crate::modules::mcp::error::McpError> {
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

pub(crate) fn route_hint_status_meta(application: &RoutePriorApplication) -> serde_json::Value {
    serde_json::json!({
        "fingerprint_key": application.hint.fingerprint_key,
        "recommended_action": application.hint.recommended_action,
        "prior_count": application.hint.priors.len(),
        "direct_score": application.direct_score,
        "worker_score": application.worker_score,
        "override_applied": application.override_applied,
        "priors": application.hint.priors,
    })
}

#[cfg(test)]
mod tests {
    use super::apply_route_prior;
    use super::normalize_decision_point;
    use super::TaskPolicyHint;
    use crate::modules::desktop_runtime::runtime::task_learning::build_task_fingerprint;
    use crate::modules::desktop_runtime::runtime::{LocalRouteDecision, LocalRouteKind};
    use mcp_runtime::route::{RouteEvidence, TaskProfile};

    fn test_decision(route: LocalRouteKind) -> LocalRouteDecision {
        LocalRouteDecision {
            route,
            reasons: vec!["fallback_worker".to_string()],
            profile: TaskProfile {
                explicit_route: None,
                has_batch_scope: false,
                wants_programmatic_logic: false,
                wants_analysis: false,
                wants_single_action: true,
                destructive_intent: false,
                approval_sensitive: false,
            },
            evidence: RouteEvidence {
                direct_callable_capability_count: 1,
                has_programmatic_executor: true,
                any_mutating_capability: false,
                any_high_risk_capability: false,
                direct_capability_names: vec!["shell_execute".to_string()],
                callable_direct_capability_names: vec!["shell_execute".to_string()],
            },
        }
    }

    #[test]
    fn normalize_decision_point_maps_aliases() {
        assert_eq!(normalize_decision_point("attach"), "capability_attach");
        assert_eq!(normalize_decision_point("execute_code_plan"), "execution");
        assert_eq!(normalize_decision_point("search"), "discovery");
    }

    #[test]
    fn apply_route_prior_can_override_non_safety_worker_route() {
        let fingerprint = build_task_fingerprint("fix this local config");
        let application = apply_route_prior(
            test_decision(LocalRouteKind::Worker),
            TaskPolicyHint {
                query: "fix this local config".to_string(),
                decision_point: "route".to_string(),
                fingerprint_key: fingerprint.key(),
                task_fingerprint: fingerprint,
                recommended_action: Some("direct".to_string()),
                priors: vec![super::TaskPolicyHintItem {
                    action_key: "direct".to_string(),
                    raw_weight: 0.9,
                    effective_weight: 0.9,
                    confidence: 0.8,
                    evidence_count: 3,
                    maturity: "confirmed".to_string(),
                    updated_at_unix_ms: 0,
                }],
                guidance: None,
            },
        );

        assert_eq!(application.decision.route, LocalRouteKind::Direct);
        assert!(application.override_applied);
    }

    #[test]
    fn apply_route_prior_does_not_override_safety_locked_direct_route() {
        let mut decision = test_decision(LocalRouteKind::Direct);
        decision.reasons = vec!["approval_sensitive".to_string()];
        let fingerprint = build_task_fingerprint("provider token rotation");
        let application = apply_route_prior(
            decision,
            TaskPolicyHint {
                query: "provider token rotation".to_string(),
                decision_point: "route".to_string(),
                fingerprint_key: fingerprint.key(),
                task_fingerprint: fingerprint,
                recommended_action: Some("worker".to_string()),
                priors: vec![super::TaskPolicyHintItem {
                    action_key: "worker".to_string(),
                    raw_weight: 1.2,
                    effective_weight: 1.2,
                    confidence: 0.9,
                    evidence_count: 5,
                    maturity: "confirmed".to_string(),
                    updated_at_unix_ms: 0,
                }],
                guidance: None,
            },
        );

        assert_eq!(application.decision.route, LocalRouteKind::Direct);
        assert!(!application.override_applied);
    }
}
