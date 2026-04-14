use super::types::{
    EvaluatedOutcome, PolicyDelta, TaskAttribution, TaskFingerprint, TaskLearningEvaluation,
    TaskLearningSignals, ACTION_CAPABILITY_ATTACH, ACTION_DISCOVERY_SEARCH_EARLY,
    ACTION_EXECUTE_CODE_PLAN, ACTION_ROUTE_DIRECT, ACTION_ROUTE_WORKER,
    ACTION_VERIFICATION_STRONGER_CHECKS, DECISION_POINT_CAPABILITY_ATTACH,
    DECISION_POINT_DISCOVERY, DECISION_POINT_EXECUTION, DECISION_POINT_ROUTE,
    DECISION_POINT_VERIFICATION,
};
use crate::modules::desktop_runtime::runtime::{LocalExecutionPolicy, LocalRouteDecision};
use serde_json::Value;

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
    signals: &TaskLearningSignals,
    finish_reason: &str,
) -> Vec<String> {
    let mut evidence = Vec::new();
    evidence.push(format!("route:{}", execution_policy.route.as_str()));
    evidence.push(format!("plane:{}", execution_policy.plane.as_str()));
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
            direction: "strengthen".to_string(),
            magnitude,
            state,
            rationale: format!(
                "Verification judgment '{}' raised the completion-check prior.",
                outcome.verification_result
            ),
        }),
        _ => None,
    }
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
    had_delegated_execution: bool,
) -> TaskLearningEvaluation {
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
        route_judgment: route_judgment.clone(),
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
        observed_error_codes: signals.observed_error_codes.clone(),
    };

    let learning_eligible = outcome.confidence >= 0.45
        && outcome.final_status != "blocked"
        && outcome.error_profile != "environment_blocked";
    let primary_stage = if !learning_eligible {
        None
    } else if matches!(outcome.route_judgment.as_str(), "wrong" | "wasteful") {
        Some(DECISION_POINT_ROUTE.to_string())
    } else if matches!(
        outcome.discovery_judgment.as_str(),
        "skipped_when_needed" | "excessive"
    ) {
        Some(DECISION_POINT_DISCOVERY.to_string())
    } else if signals.attach_capability_errors > 0
        || (signals.used_attach_capability && final_status == "success")
    {
        Some(DECISION_POINT_CAPABILITY_ATTACH.to_string())
    } else if signals.used_execute_code_plan {
        Some(DECISION_POINT_EXECUTION.to_string())
    } else if matches!(outcome.verification_result.as_str(), "weak_pass" | "failed")
        || fingerprint.verification_demand == "strict"
    {
        Some(DECISION_POINT_VERIFICATION.to_string())
    } else {
        Some(DECISION_POINT_ROUTE.to_string())
    };
    let attribution = TaskAttribution {
        primary_stage,
        secondary_evidence: build_secondary_evidence(
            route_decision,
            execution_policy,
            &signals,
            finish_reason,
        ),
    };
    let policy_delta = if learning_eligible {
        compute_policy_delta(
            fingerprint,
            route_decision,
            &outcome,
            &attribution,
            &signals,
        )
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

#[cfg(test)]
mod tests {
    use super::evaluate_task_learning;
    use crate::modules::desktop_runtime::runtime::task_learning::fingerprint::build_task_fingerprint;
    use crate::modules::desktop_runtime::runtime::{
        LocalExecutionPolicy, LocalRouteDecision, LocalRouteKind,
    };
    use mcp_runtime::policy::LocalExecutionPlane;
    use mcp_runtime::route::{RouteEvidence, TaskProfile};

    fn policy(route: LocalRouteKind, plane: LocalExecutionPlane) -> LocalExecutionPolicy {
        LocalExecutionPolicy {
            route,
            plane,
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
    fn evaluate_task_learning_marks_discovery_skip_as_learning_signal() {
        let evaluation = evaluate_task_learning(
            &build_task_fingerprint("Investigate the current local runtime capabilities"),
            Some(&route_decision(LocalRouteKind::Direct)),
            &policy(LocalRouteKind::Direct, LocalExecutionPlane::ResponseOnly),
            "The runtime failed.",
            true,
            "error",
            2_000,
            &[],
            false,
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
            &policy(LocalRouteKind::Worker, LocalExecutionPlane::WorkerReasoning),
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
            false,
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
}
