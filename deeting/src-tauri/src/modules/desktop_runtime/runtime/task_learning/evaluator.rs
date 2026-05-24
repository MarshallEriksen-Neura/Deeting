use super::types::{
    EvaluatedOutcome, PolicyDelta, TaskAttribution, TaskFingerprint,
    TaskLearningDelegatedExecution, TaskLearningEvaluation, TaskLearningSignals,
    ACTION_CAPABILITY_ATTACH, ACTION_DISCOVERY_SEARCH_EARLY, ACTION_EXECUTE_CODE_PLAN,
    ACTION_ROUTE_DIRECT, ACTION_ROUTE_WORKER, ACTION_VERIFICATION_STRONGER_CHECKS,
    DECISION_POINT_CAPABILITY_ATTACH, DECISION_POINT_DISCOVERY, DECISION_POINT_EXECUTION,
    DECISION_POINT_ROUTE, DECISION_POINT_VERIFICATION, DECISION_POINT_WORKER_SELECTION,
};
use crate::modules::desktop_runtime::runtime::sovereign::TaskExecutionIngress;
use crate::modules::desktop_runtime::runtime::{LocalExecutionPolicy, LocalRouteDecision};
use serde_json::Value;

const USER_RESPONSE_SIGNALS: &[&str] = &["accepted", "silent", "corrected", "rejected", "unknown"];

fn tool_trace_result_blocks(tool_trace_blocks: &[Value]) -> impl Iterator<Item = &Value> {
    tool_trace_blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
}

pub(crate) fn collect_task_learning_signals(
    tool_trace_blocks: &[Value],
    had_delegated_execution: bool,
) -> TaskLearningSignals {
    let mut signals = TaskLearningSignals::default();
    signals.delegated_execution = had_delegated_execution;

    for block in tool_trace_result_blocks(tool_trace_blocks) {
        signals.tool_call_count = signals.tool_call_count.saturating_add(1);
        let tool_name = block
            .get("toolName")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let status = block
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let error_code = block
            .pointer("/result/error_code")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());

        if status.eq_ignore_ascii_case("error") {
            signals.tool_error_count = signals.tool_error_count.saturating_add(1);
        }
        if status.eq_ignore_ascii_case("requires_approval") {
            signals.requires_approval_count = signals.requires_approval_count.saturating_add(1);
        }
        if let Some(error_code) = error_code {
            signals.observed_error_codes.push(error_code.to_string());
        }

        match tool_name {
            "search_sdk" => {
                signals.search_sdk_calls = signals.search_sdk_calls.saturating_add(1);
            }
            "attach_capability" => {
                signals.used_attach_capability = true;
                if status.eq_ignore_ascii_case("error") {
                    signals.attach_capability_errors =
                        signals.attach_capability_errors.saturating_add(1);
                }
            }
            "execute_code_plan" => {
                signals.used_execute_code_plan = true;
                let success = status.eq_ignore_ascii_case("success")
                    && block
                        .pointer("/result/success")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                signals.successful_execute_code_plan |= success;
            }
            _ => {}
        }
    }

    signals.observed_error_codes.sort();
    signals.observed_error_codes.dedup();
    signals
}

fn derive_final_status(
    finish_reason: &str,
    response_text: &str,
    response_text_was_synthesized_from_error: bool,
    signals: &TaskLearningSignals,
) -> String {
    if signals.requires_approval_count > 0 || finish_reason == "blocked" {
        return "blocked".to_string();
    }
    if response_text_was_synthesized_from_error || finish_reason == "error" {
        return "failed".to_string();
    }
    if signals.tool_error_count > 0 {
        if response_text.trim().is_empty() {
            "failed".to_string()
        } else {
            "partial".to_string()
        }
    } else {
        "success".to_string()
    }
}

fn derive_verification_result(
    final_status: &str,
    finish_reason: &str,
    response_text: &str,
    signals: &TaskLearningSignals,
) -> String {
    if matches!(final_status, "failed" | "blocked") {
        return "failed".to_string();
    }
    if finish_reason == "length" || signals.tool_error_count > 0 {
        return "weak_pass".to_string();
    }
    if !response_text.trim().is_empty()
        && (signals.tool_call_count > 0 || signals.delegated_execution)
    {
        "passed".to_string()
    } else {
        "unverified".to_string()
    }
}

fn derive_route_judgment(
    route_decision: Option<&LocalRouteDecision>,
    final_status: &str,
    signals: &TaskLearningSignals,
) -> String {
    let Some(route_decision) = route_decision else {
        return "acceptable".to_string();
    };
    if route_decision.route.as_str() == "worker"
        && final_status == "success"
        && signals.tool_call_count == 0
        && !signals.delegated_execution
    {
        return "wasteful".to_string();
    }
    if final_status == "failed"
        && route_decision.route.as_str() == "direct"
        && signals.tool_call_count == 0
    {
        return "wrong".to_string();
    }
    if final_status == "partial" {
        return "acceptable".to_string();
    }
    "good".to_string()
}

fn delegated_profile_id(
    delegated_execution: Option<&TaskLearningDelegatedExecution>,
) -> Option<String> {
    delegated_execution?
        .selected_profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

fn derive_worker_selection_judgment(
    delegated_execution: Option<&TaskLearningDelegatedExecution>,
    final_status: &str,
    verification_result: &str,
    finish_reason: &str,
    user_response_signal: &str,
    signals: &TaskLearningSignals,
) -> Option<String> {
    let delegated_execution = delegated_execution?;
    delegated_profile_id(Some(delegated_execution))?;

    let delegated_status = delegated_execution.status.trim().to_ascii_lowercase();
    if matches!(delegated_status.as_str(), "failed" | "cancelled") {
        return Some(if final_status == "blocked" {
            "blocked".to_string()
        } else {
            "failed".to_string()
        });
    }
    if final_status == "blocked" {
        return Some("blocked".to_string());
    }
    if final_status == "partial" {
        return Some("partial".to_string());
    }
    if final_status == "failed"
        || finish_reason == "length"
        || verification_result == "weak_pass"
        || matches!(user_response_signal, "corrected" | "rejected")
        || signals.tool_error_count > 0
        || signals.requires_approval_count > 0
    {
        return Some("unstable".to_string());
    }
    Some("success".to_string())
}

fn derive_discovery_judgment(
    fingerprint: &TaskFingerprint,
    final_status: &str,
    signals: &TaskLearningSignals,
) -> String {
    if signals.search_sdk_calls == 0
        && fingerprint.discovery_pressure == "high"
        && matches!(final_status, "failed" | "partial")
    {
        return "skipped_when_needed".to_string();
    }
    if signals.search_sdk_calls >= 3 && final_status == "success" {
        return "excessive".to_string();
    }
    if signals.search_sdk_calls > 0 {
        return "sufficient".to_string();
    }
    if fingerprint.discovery_pressure == "high" {
        return "shallow".to_string();
    }
    "sufficient".to_string()
}

fn derive_execution_judgment(final_status: &str, signals: &TaskLearningSignals) -> String {
    if signals.used_execute_code_plan {
        if signals.successful_execute_code_plan && final_status == "success" {
            return "justified".to_string();
        }
        if final_status == "partial" {
            return "fragile".to_string();
        }
        return "failed".to_string();
    }
    "justified".to_string()
}

fn derive_cost_class(total_latency_ms: i64, signals: &TaskLearningSignals) -> String {
    if total_latency_ms >= 25_000 || signals.tool_call_count >= 6 {
        "disproportionate".to_string()
    } else if total_latency_ms >= 12_000 || signals.tool_call_count >= 4 {
        "high".to_string()
    } else if total_latency_ms >= 4_000 || signals.tool_call_count >= 2 {
        "medium".to_string()
    } else {
        "low".to_string()
    }
}

fn derive_retry_profile(signals: &TaskLearningSignals) -> String {
    if signals.search_sdk_calls >= 4 || signals.tool_call_count >= 6 {
        "looping".to_string()
    } else if signals.search_sdk_calls >= 2 || signals.tool_call_count >= 4 {
        "heavy".to_string()
    } else if signals.tool_call_count >= 2 {
        "light".to_string()
    } else {
        "none".to_string()
    }
}

fn derive_error_profile(signals: &TaskLearningSignals) -> String {
    if signals.observed_error_codes.is_empty() {
        return "none".to_string();
    }
    if signals.observed_error_codes.iter().any(|code| {
        code.starts_with("SANDBOX_") || code == "LOCAL_TOOL_EXECUTION_ENVIRONMENT_BLOCKED"
    }) {
        return "environment_blocked".to_string();
    }
    if signals.observed_error_codes.iter().any(|code| {
        matches!(
            code.as_str(),
            "CODEMODE_EMPTY_CODE"
                | "CODEMODE_SEARCH_REQUIRED"
                | "LOCAL_TOOL_POLICY_BLOCKED"
                | "CAPABILITY_ATTACH_FAILED"
                | "LOCAL_CHAT_MAX_ROUNDS_EXCEEDED"
        )
    }) {
        return "structural".to_string();
    }
    "recoverable".to_string()
}

fn derive_confidence(
    final_status: &str,
    verification_result: &str,
    signals: &TaskLearningSignals,
    finish_reason: &str,
) -> f64 {
    let mut confidence = 0.35_f64;
    if signals.tool_call_count > 0 || signals.delegated_execution {
        confidence += 0.2;
    }
    if verification_result == "passed" {
        confidence += 0.2;
    } else if verification_result == "weak_pass" {
        confidence += 0.1;
    }
    if final_status == "success" {
        confidence += 0.1;
    }
    if finish_reason == "length" {
        confidence -= 0.08;
    }
    if signals.requires_approval_count > 0 {
        confidence -= 0.15;
    }
    if signals
        .observed_error_codes
        .iter()
        .any(|code| code.starts_with("SANDBOX_"))
    {
        confidence -= 0.25;
    }
    confidence.clamp(0.0, 1.0)
}

fn build_secondary_evidence(
    route_decision: Option<&LocalRouteDecision>,
    execution_policy: &LocalExecutionPolicy,
    delegated_execution: Option<&TaskLearningDelegatedExecution>,
    signals: &TaskLearningSignals,
    finish_reason: &str,
) -> Vec<String> {
    let mut evidence = Vec::new();
    evidence.push(format!("route:{}", execution_policy.route.as_str()));
    evidence.push(format!(
        "phase_step_type:{}",
        execution_policy.initial_phase_step_name()
    ));
    evidence.push(format!("finish_reason:{finish_reason}"));
    if let Some(route_decision) = route_decision {
        evidence.extend(
            route_decision
                .reasons
                .iter()
                .map(|reason| format!("route_reason:{reason}")),
        );
    }
    if signals.search_sdk_calls > 0 {
        evidence.push(format!("search_sdk_calls:{}", signals.search_sdk_calls));
    }
    if signals.used_execute_code_plan {
        evidence.push("used_execute_code_plan".to_string());
    }
    if signals.used_attach_capability {
        evidence.push("used_attach_capability".to_string());
    }
    if let Some(delegated_execution) = delegated_execution {
        evidence.push(format!("delegated_kind:{}", delegated_execution.kind));
        evidence.push(format!("delegated_status:{}", delegated_execution.status));
        if let Some(profile_id) = delegated_profile_id(Some(delegated_execution)) {
            evidence.push(format!("delegated_profile:{profile_id}"));
        }
        if let Some(worker_ref) = delegated_execution
            .worker_ref
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            evidence.push(format!("delegated_worker_ref:{worker_ref}"));
        }
    }
    evidence.extend(
        signals
            .observed_error_codes
            .iter()
            .map(|code| format!("error_code:{code}")),
    );
    evidence
}

fn compute_policy_delta(
    fingerprint: &TaskFingerprint,
    route_decision: Option<&LocalRouteDecision>,
    outcome: &EvaluatedOutcome,
    attribution: &TaskAttribution,
    signals: &TaskLearningSignals,
) -> Option<PolicyDelta> {
    let primary_stage = attribution.primary_stage.as_deref()?;
    let magnitude = (0.18 + outcome.confidence * 0.22).clamp(0.08, 0.45);
    let state = if outcome.confidence >= 0.8 && signals.tool_call_count > 0 {
        "confirmed"
    } else {
        "provisional"
    }
    .to_string();

    match primary_stage {
        DECISION_POINT_ROUTE => {
            let chosen_route = route_decision
                .map(|decision| decision.route.as_str())
                .unwrap_or(ACTION_ROUTE_WORKER);
            let other_route = if chosen_route == ACTION_ROUTE_WORKER {
                ACTION_ROUTE_DIRECT
            } else {
                ACTION_ROUTE_WORKER
            };
            if matches!(outcome.route_judgment.as_str(), "wrong" | "wasteful") {
                Some(PolicyDelta {
                    decision_point: DECISION_POINT_ROUTE.to_string(),
                    action_key: other_route.to_string(),
                    direction: "strengthen".to_string(),
                    magnitude,
                    state,
                    rationale: format!(
                        "Route '{}' looked {} for this fingerprint, so the competing route is strengthened.",
                        chosen_route, outcome.route_judgment
                    ),
                })
            } else {
                Some(PolicyDelta {
                    decision_point: DECISION_POINT_ROUTE.to_string(),
                    action_key: chosen_route.to_string(),
                    direction: "strengthen".to_string(),
                    magnitude: (magnitude * 0.8).clamp(0.05, 0.35),
                    state,
                    rationale: format!(
                        "Route '{}' completed successfully for this fingerprint.",
                        chosen_route
                    ),
                })
            }
        }
        DECISION_POINT_WORKER_SELECTION => {
            let action_key = delegated_profile_id(outcome.delegated_execution.as_ref())?;
            let delegated_execution = outcome.delegated_execution.as_ref();
            let judgment = outcome
                .worker_selection_judgment
                .as_deref()
                .unwrap_or("unstable");
            let adjusted_magnitude = match judgment {
                "success" => (magnitude * 0.8).clamp(0.05, 0.35),
                "partial" => (magnitude * 0.65).clamp(0.05, 0.3),
                "blocked" => (magnitude * 0.85).clamp(0.08, 0.38),
                "unstable" => (magnitude * 0.5).clamp(0.05, 0.24),
                _ => magnitude,
            };
            let direction = if judgment == "success" {
                "strengthen"
            } else {
                "weaken"
            };
            let kind = delegated_execution
                .map(|value| value.kind.as_str())
                .unwrap_or("custom_task_agent");
            let worker_ref = delegated_execution
                .and_then(|value| value.worker_ref.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("user_worker_profile:unknown");
            Some(PolicyDelta {
                decision_point: DECISION_POINT_WORKER_SELECTION.to_string(),
                action_key,
                direction: direction.to_string(),
                magnitude: adjusted_magnitude,
                state,
                rationale: format!(
                    "Delegated worker selection via '{}' ({}) evaluated as '{}' for this fingerprint.",
                    worker_ref, kind, judgment
                ),
            })
        }
        DECISION_POINT_DISCOVERY => Some(PolicyDelta {
            decision_point: DECISION_POINT_DISCOVERY.to_string(),
            action_key: ACTION_DISCOVERY_SEARCH_EARLY.to_string(),
            direction: if outcome.discovery_judgment == "excessive" {
                "weaken".to_string()
            } else {
                "strengthen".to_string()
            },
            magnitude,
            state,
            rationale: format!(
                "Discovery judgment '{}' updated the `search_sdk`-early prior.",
                outcome.discovery_judgment
            ),
        }),
        DECISION_POINT_CAPABILITY_ATTACH => Some(PolicyDelta {
            decision_point: DECISION_POINT_CAPABILITY_ATTACH.to_string(),
            action_key: ACTION_CAPABILITY_ATTACH.to_string(),
            direction: if signals.attach_capability_errors > 0 {
                "weaken".to_string()
            } else {
                "strengthen".to_string()
            },
            magnitude,
            state,
            rationale: if signals.attach_capability_errors > 0 {
                "Capability attach failed for this fingerprint.".to_string()
            } else {
                "Capability attach helped this fingerprint.".to_string()
            },
        }),
        DECISION_POINT_EXECUTION => Some(PolicyDelta {
            decision_point: DECISION_POINT_EXECUTION.to_string(),
            action_key: ACTION_EXECUTE_CODE_PLAN.to_string(),
            direction: if outcome.execution_judgment == "justified" {
                "strengthen".to_string()
            } else {
                "weaken".to_string()
            },
            magnitude,
            state,
            rationale: format!(
                "Execution judgment '{}' updated the `execute_code_plan` prior for execution pressure '{}'.",
                outcome.execution_judgment, fingerprint.execution_pressure
            ),
        }),
        DECISION_POINT_VERIFICATION => Some(PolicyDelta {
            decision_point: DECISION_POINT_VERIFICATION.to_string(),
            action_key: ACTION_VERIFICATION_STRONGER_CHECKS.to_string(),
            direction: if outcome.user_response_signal == "accepted"
                && outcome.verification_result == "passed"
            {
                "weaken".to_string()
            } else {
                "strengthen".to_string()
            },
            magnitude: if outcome.user_response_signal == "accepted"
                && outcome.verification_result == "passed"
            {
                (magnitude * 0.6).clamp(0.05, 0.28)
            } else {
                magnitude
            },
            state,
            rationale: format!(
                "Verification judgment '{}' with user signal '{}' updated the evidence-strength prior.",
                outcome.verification_result, outcome.user_response_signal
            ),
        }),
        _ => None,
    }
}

fn learning_eligible_from_outcome(outcome: &EvaluatedOutcome) -> bool {
    let has_posterior_signal = matches!(
        outcome.user_response_signal.as_str(),
        "accepted" | "corrected" | "rejected"
    );
    (outcome.confidence >= 0.45 || has_posterior_signal)
        && outcome.final_status != "blocked"
        && outcome.error_profile != "environment_blocked"
}

fn primary_stage_from_outcome(
    fingerprint: &TaskFingerprint,
    outcome: &EvaluatedOutcome,
    signals: &TaskLearningSignals,
) -> Option<String> {
    if !learning_eligible_from_outcome(outcome) {
        return None;
    }
    if outcome.delegated_execution.is_some() && outcome.worker_selection_judgment.is_some() {
        return Some(DECISION_POINT_WORKER_SELECTION.to_string());
    }
    if matches!(
        outcome.user_response_signal.as_str(),
        "corrected" | "rejected"
    ) {
        return Some(DECISION_POINT_VERIFICATION.to_string());
    }
    if matches!(outcome.route_judgment.as_str(), "wrong" | "wasteful") {
        return Some(DECISION_POINT_ROUTE.to_string());
    }
    if matches!(
        outcome.discovery_judgment.as_str(),
        "skipped_when_needed" | "excessive"
    ) {
        return Some(DECISION_POINT_DISCOVERY.to_string());
    }
    if signals.attach_capability_errors > 0
        || (signals.used_attach_capability && outcome.final_status == "success")
    {
        return Some(DECISION_POINT_CAPABILITY_ATTACH.to_string());
    }
    if signals.used_execute_code_plan {
        return Some(DECISION_POINT_EXECUTION.to_string());
    }
    if matches!(outcome.verification_result.as_str(), "weak_pass" | "failed")
        || fingerprint.verification_demand == "strict"
    {
        return Some(DECISION_POINT_VERIFICATION.to_string());
    }
    Some(DECISION_POINT_ROUTE.to_string())
}

pub(crate) fn rebuild_task_learning_evaluation_from_outcome(
    fingerprint: &TaskFingerprint,
    route_decision: Option<&LocalRouteDecision>,
    execution_policy: &LocalExecutionPolicy,
    finish_reason: &str,
    signals: &TaskLearningSignals,
    mut outcome: EvaluatedOutcome,
) -> TaskLearningEvaluation {
    outcome.worker_selection_judgment = derive_worker_selection_judgment(
        outcome.delegated_execution.as_ref(),
        outcome.final_status.as_str(),
        outcome.verification_result.as_str(),
        finish_reason,
        outcome.user_response_signal.as_str(),
        signals,
    );
    let learning_eligible = learning_eligible_from_outcome(&outcome);
    let attribution = TaskAttribution {
        primary_stage: primary_stage_from_outcome(fingerprint, &outcome, signals),
        secondary_evidence: build_secondary_evidence(
            route_decision,
            execution_policy,
            outcome.delegated_execution.as_ref(),
            signals,
            finish_reason,
        ),
    };
    let policy_delta = if learning_eligible {
        compute_policy_delta(fingerprint, route_decision, &outcome, &attribution, signals)
    } else {
        None
    };
    let delta_state = policy_delta
        .as_ref()
        .map(|delta| delta.state.clone())
        .unwrap_or_else(|| "none".to_string());

    TaskLearningEvaluation {
        outcome,
        attribution,
        policy_delta,
        learning_eligible,
        delta_state,
    }
}

pub(crate) fn normalize_task_learning_user_response_signal(value: Option<&str>) -> String {
    let normalized = value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or("silent")
        .to_ascii_lowercase();
    if USER_RESPONSE_SIGNALS.contains(&normalized.as_str()) {
        normalized
    } else {
        "unknown".to_string()
    }
}

pub(crate) fn evaluate_task_learning_with_runtime(
    fingerprint: &TaskFingerprint,
    route_decision: Option<&LocalRouteDecision>,
    execution_policy: &LocalExecutionPolicy,
    response_text: &str,
    response_text_was_synthesized_from_error: bool,
    finish_reason: &str,
    total_latency_ms: i64,
    tool_trace_blocks: &[Value],
    delegated_execution: Option<TaskLearningDelegatedExecution>,
    user_response_signal: Option<&str>,
) -> TaskLearningEvaluation {
    let had_delegated_execution = delegated_execution.is_some();
    let signals = collect_task_learning_signals(tool_trace_blocks, had_delegated_execution);
    let mut outcome = evaluate_task_learning(
        fingerprint,
        route_decision,
        execution_policy,
        response_text,
        response_text_was_synthesized_from_error,
        finish_reason,
        total_latency_ms,
        tool_trace_blocks,
        delegated_execution,
    )
    .outcome;
    outcome.user_response_signal =
        normalize_task_learning_user_response_signal(user_response_signal);

    let task_execution_ingress = TaskExecutionIngress::new(fingerprint.clone(), outcome);

    rebuild_task_learning_evaluation_from_outcome(
        task_execution_ingress.fingerprint(),
        route_decision,
        execution_policy,
        finish_reason,
        &signals,
        task_execution_ingress.outcome().clone(),
    )
}

pub(crate) fn evaluate_task_learning(
    fingerprint: &TaskFingerprint,
    route_decision: Option<&LocalRouteDecision>,
    execution_policy: &LocalExecutionPolicy,
    response_text: &str,
    response_text_was_synthesized_from_error: bool,
    finish_reason: &str,
    total_latency_ms: i64,
    tool_trace_blocks: &[Value],
    delegated_execution: Option<TaskLearningDelegatedExecution>,
) -> TaskLearningEvaluation {
    let had_delegated_execution = delegated_execution.is_some();
    let signals = collect_task_learning_signals(tool_trace_blocks, had_delegated_execution);
    let final_status = derive_final_status(
        finish_reason,
        response_text,
        response_text_was_synthesized_from_error,
        &signals,
    );
    let verification_result =
        derive_verification_result(&final_status, finish_reason, response_text, &signals);
    let route_judgment = derive_route_judgment(route_decision, &final_status, &signals);
    let discovery_judgment = derive_discovery_judgment(fingerprint, &final_status, &signals);
    let execution_judgment = derive_execution_judgment(&final_status, &signals);
    let error_profile = derive_error_profile(&signals);
    let confidence =
        derive_confidence(&final_status, &verification_result, &signals, finish_reason);

    let outcome = EvaluatedOutcome {
        final_status: final_status.clone(),
        verification_result: verification_result.clone(),
        user_response_signal: "silent".to_string(),
        judgment_mode: "heuristic".to_string(),
        route_judgment: route_judgment.clone(),
        worker_selection_judgment: None,
        discovery_judgment: discovery_judgment.clone(),
        execution_judgment: execution_judgment.clone(),
        cost_class: derive_cost_class(total_latency_ms, &signals),
        retry_profile: derive_retry_profile(&signals),
        error_profile: error_profile.clone(),
        confidence,
        finish_reason: finish_reason.to_string(),
        tool_call_count: signals.tool_call_count,
        search_sdk_calls: signals.search_sdk_calls,
        used_attach_capability: signals.used_attach_capability,
        used_execute_code_plan: signals.used_execute_code_plan,
        had_delegated_execution,
        delegated_execution,
        observed_error_codes: signals.observed_error_codes.clone(),
    };
    rebuild_task_learning_evaluation_from_outcome(
        fingerprint,
        route_decision,
        execution_policy,
        finish_reason,
        &signals,
        outcome,
    )
}

#[cfg(test)]
mod tests {
    use super::evaluate_task_learning;
    use crate::modules::desktop_runtime::runtime::task_learning::fingerprint::build_task_fingerprint;
    use crate::modules::desktop_runtime::runtime::TaskLearningDelegatedExecution;
    use crate::modules::desktop_runtime::runtime::{
        LocalExecutionPolicy, LocalRouteDecision, LocalRouteKind,
    };
    use desktop_runtime_core::PhaseStepType;
    use mcp_runtime::route::{RouteEvidence, TaskProfile};

    fn policy(route: LocalRouteKind, initial_phase_step: PhaseStepType) -> LocalExecutionPolicy {
        LocalExecutionPolicy {
            route,
            initial_phase_step,
            allowed_tool_names: vec![],
            inject_execution_protocol: false,
            allow_worker_delegation: false,
            prefer_workflow_runtime: false,
            capability_snapshot: None,
        }
    }

    fn route_decision(route: LocalRouteKind) -> LocalRouteDecision {
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
                wants_artifact_generation: false,
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

    fn delegated_execution(
        status: &str,
        selected_profile_id: &str,
    ) -> TaskLearningDelegatedExecution {
        TaskLearningDelegatedExecution {
            kind: "workflow".to_string(),
            status: status.to_string(),
            selected_profile_id: Some(selected_profile_id.to_string()),
            worker_ref: Some(format!("user_worker_profile:{selected_profile_id}")),
            packet_hash: Some("packet-1".to_string()),
            task_kind: Some("analysis".to_string()),
            deliverable_kind: Some("structured_findings".to_string()),
        }
    }

    #[test]
    fn evaluate_task_learning_marks_discovery_skip_as_learning_signal() {
        let evaluation = evaluate_task_learning(
            &build_task_fingerprint("Investigate the current local runtime capabilities"),
            Some(&route_decision(LocalRouteKind::Direct)),
            &policy(LocalRouteKind::Direct, PhaseStepType::DirectChat),
            "The runtime failed.",
            true,
            "error",
            2_000,
            &[],
            None,
        );

        assert_eq!(evaluation.outcome.discovery_judgment, "skipped_when_needed");
        assert!(evaluation.learning_eligible);
        assert_eq!(
            evaluation.attribution.primary_stage.as_deref(),
            Some("discovery")
        );
    }

    #[test]
    fn evaluate_task_learning_strengthens_execute_code_plan_after_success() {
        let evaluation = evaluate_task_learning(
            &build_task_fingerprint("Create a local JSON artifact"),
            Some(&route_decision(LocalRouteKind::Worker)),
            &policy(LocalRouteKind::Worker, PhaseStepType::DelegatedWorker),
            "Finished and wrote the artifact.",
            false,
            "stop",
            8_000,
            &[serde_json::json!({
                "type": "tool_result",
                "toolName": "execute_code_plan",
                "status": "success",
                "result": {
                    "success": true
                }
            })],
            None,
        );

        assert_eq!(evaluation.outcome.execution_judgment, "justified");
        assert_eq!(
            evaluation.attribution.primary_stage.as_deref(),
            Some("execution")
        );
        assert_eq!(
            evaluation
                .policy_delta
                .as_ref()
                .map(|delta| delta.action_key.as_str()),
            Some("execute_code_plan")
        );
    }

    #[test]
    fn evaluate_task_learning_strengthens_selected_worker_after_delegated_success() {
        let evaluation = evaluate_task_learning(
            &build_task_fingerprint("analyze the desktop worker route"),
            Some(&route_decision(LocalRouteKind::Worker)),
            &policy(LocalRouteKind::Worker, PhaseStepType::DelegatedWorker),
            "Research worker completed the analysis.",
            false,
            "stop",
            6_000,
            &[serde_json::json!({
                "type": "tool_result",
                "toolName": "delegated_execution",
                "status": "success",
            })],
            Some(delegated_execution("succeeded", "research.worker")),
        );

        assert_eq!(
            evaluation.outcome.worker_selection_judgment.as_deref(),
            Some("success")
        );
        assert_eq!(
            evaluation.attribution.primary_stage.as_deref(),
            Some("worker_selection")
        );
        assert_eq!(
            evaluation.policy_delta.as_ref().map(|delta| (
                delta.decision_point.as_str(),
                delta.action_key.as_str(),
                delta.direction.as_str()
            )),
            Some(("worker_selection", "research.worker", "strengthen"))
        );
    }

    #[test]
    fn evaluate_task_learning_weakens_selected_worker_after_delegated_failure() {
        let evaluation = evaluate_task_learning(
            &build_task_fingerprint("diagnose the workflow delegation path"),
            Some(&route_decision(LocalRouteKind::Worker)),
            &policy(LocalRouteKind::Worker, PhaseStepType::DelegatedWorker),
            "",
            true,
            "error",
            4_000,
            &[serde_json::json!({
                "type": "tool_result",
                "toolName": "delegated_execution",
                "status": "error",
                "result": { "error_code": "DELEGATED_FAILED" }
            })],
            Some(delegated_execution("failed", "ops.worker")),
        );

        assert_eq!(
            evaluation.outcome.worker_selection_judgment.as_deref(),
            Some("failed")
        );
        assert_eq!(
            evaluation.attribution.primary_stage.as_deref(),
            Some("worker_selection")
        );
        assert_eq!(
            evaluation.policy_delta.as_ref().map(|delta| (
                delta.decision_point.as_str(),
                delta.action_key.as_str(),
                delta.direction.as_str()
            )),
            Some(("worker_selection", "ops.worker", "weaken"))
        );
    }
}
