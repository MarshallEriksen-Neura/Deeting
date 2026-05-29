use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeTransitionTraceScenario {
    AnswerOnly,
    ToolCall,
    CapabilityExposure,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct RuntimeTransitionTraceVerdict {
    pub(crate) scenario: RuntimeTransitionTraceScenario,
    pub(crate) passed: bool,
    pub(crate) missing: Vec<String>,
}

impl RuntimeTransitionTraceVerdict {
    fn pass(scenario: RuntimeTransitionTraceScenario) -> Self {
        Self {
            scenario,
            passed: true,
            missing: Vec::new(),
        }
    }

    fn from_missing(scenario: RuntimeTransitionTraceScenario, missing: Vec<String>) -> Self {
        Self {
            scenario,
            passed: missing.is_empty(),
            missing,
        }
    }
}

pub(crate) fn verify_runtime_transition_trace_contract(
    scenario: RuntimeTransitionTraceScenario,
    response: Option<&Value>,
    graph: Option<&Value>,
) -> RuntimeTransitionTraceVerdict {
    match scenario {
        RuntimeTransitionTraceScenario::AnswerOnly => verify_answer_only_trace(response, graph),
        RuntimeTransitionTraceScenario::ToolCall => verify_tool_call_trace(graph),
        RuntimeTransitionTraceScenario::CapabilityExposure => {
            verify_capability_exposure_trace(graph)
        }
    }
}

pub(crate) fn project_runtime_transition_trace_verdicts(
    response: Option<&Value>,
    graph: Option<&Value>,
) -> Vec<Value> {
    let mut verdicts = Vec::new();

    if response
        .and_then(|value| value.get("runtime_transition_events"))
        .and_then(Value::as_array)
        .map(|events| !events.is_empty())
        .unwrap_or(false)
    {
        verdicts.push(verdict_to_value(verify_runtime_transition_trace_contract(
            RuntimeTransitionTraceScenario::AnswerOnly,
            response,
            None,
        )));
    }

    if let Some(graph) = graph {
        let events = graph_events(graph).collect::<Vec<_>>();
        if events.iter().any(|event| {
            event.get("event_type").and_then(Value::as_str) == Some("runtime_transition.decision")
                && event
                    .get("payload")
                    .and_then(|payload| payload.get("required_artifact"))
                    .and_then(Value::as_str)
                    == Some("verification_plan")
        }) {
            verdicts.push(verdict_to_value(verify_runtime_transition_trace_contract(
                RuntimeTransitionTraceScenario::AnswerOnly,
                None,
                Some(graph),
            )));
        }

        if events.iter().any(|event| {
            event.get("event_type").and_then(Value::as_str) == Some("runtime_transition.decision")
                && event
                    .get("payload")
                    .and_then(|payload| payload.get("required_artifact"))
                    .and_then(Value::as_str)
                    == Some("world_model_frame_refresh")
        }) || events.iter().any(|event| {
            event.get("event_type").and_then(Value::as_str)
                == Some("runtime_transition.correlation")
        }) {
            verdicts.push(verdict_to_value(verify_runtime_transition_trace_contract(
                RuntimeTransitionTraceScenario::ToolCall,
                None,
                Some(graph),
            )));
        }

        if events.iter().any(|event| {
            event.get("event_type").and_then(Value::as_str) == Some("runtime_transition.decision")
                && event
                    .get("payload")
                    .and_then(|payload| payload.get("source"))
                    .and_then(Value::as_str)
                    == Some("capability_discovery")
        }) || events.iter().any(|event| {
            event.get("event_type").and_then(Value::as_str) == Some("runtime_transition.decision")
                && event
                    .get("payload")
                    .and_then(|payload| payload.get("proposed_action"))
                    .and_then(Value::as_str)
                    == Some("draft_plan")
        }) {
            verdicts.push(verdict_to_value(verify_runtime_transition_trace_contract(
                RuntimeTransitionTraceScenario::CapabilityExposure,
                None,
                Some(graph),
            )));
        }
    }

    verdicts
}

fn verdict_to_value(verdict: RuntimeTransitionTraceVerdict) -> Value {
    serde_json::to_value(verdict).unwrap_or(Value::Null)
}

pub(crate) fn runtime_transition_trace_verdict_response(
    execution_id: &str,
    execution_graph: &Value,
) -> Value {
    let metadata_verdicts = execution_graph
        .get("metadata")
        .and_then(|metadata| metadata.get("runtime_transition_trace_verdicts"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let recomputed_verdicts =
        project_runtime_transition_trace_verdicts(None, Some(execution_graph));
    let verdicts = if metadata_verdicts.is_empty() {
        recomputed_verdicts.clone()
    } else {
        metadata_verdicts.clone()
    };

    serde_json::json!({
        "execution_graph_execution_id": execution_id,
        "execution_id": execution_graph.get("execution_id").cloned().unwrap_or(Value::Null),
        "request_id": execution_graph.get("request_id").cloned().unwrap_or(Value::Null),
        "trace_id": execution_graph
            .get("metadata")
            .and_then(|metadata| metadata.get("trace_id"))
            .cloned()
            .unwrap_or(Value::Null),
        "runtime_transition_trace_verdicts": verdicts,
        "recomputed_runtime_transition_trace_verdicts": recomputed_verdicts,
        "verdict_source": if metadata_verdicts.is_empty() { "recomputed" } else { "graph_metadata" },
    })
}

fn verify_answer_only_trace(
    response: Option<&Value>,
    graph: Option<&Value>,
) -> RuntimeTransitionTraceVerdict {
    let scenario = RuntimeTransitionTraceScenario::AnswerOnly;
    if response.is_none() && graph.is_none() {
        return RuntimeTransitionTraceVerdict::from_missing(
            scenario,
            vec!["response payload or execution graph payload is required".to_string()],
        );
    }

    let mut missing = Vec::new();
    if response
        .and_then(|response| response.get("content"))
        .and_then(Value::as_str)
        .map(|content| content.contains("runtime_transition"))
        .unwrap_or(false)
    {
        missing.push("answer content must not expose runtime transition metadata".to_string());
    }
    let response_has_verification_plan = response
        .map(|response| {
            runtime_transition_events(response).any(|event| {
                event.get("required_artifact").and_then(Value::as_str) == Some("verification_plan")
                    && event.get("enforcement").and_then(Value::as_str) == Some("enforced")
            })
        })
        .unwrap_or(false);
    let graph_has_verification_plan = graph
        .map(|graph| {
            graph_events(graph).any(|event| {
                event.get("event_type").and_then(Value::as_str)
                    == Some("runtime_transition.decision")
                    && event
                        .get("payload")
                        .and_then(|payload| payload.get("required_artifact"))
                        .and_then(Value::as_str)
                        == Some("verification_plan")
                    && event
                        .get("payload")
                        .and_then(|payload| payload.get("enforcement"))
                        .and_then(Value::as_str)
                        == Some("enforced")
            })
        })
        .unwrap_or(false);
    if !response_has_verification_plan && !graph_has_verification_plan {
        missing.push(
            "answer-only trace must carry an enforced verification_plan runtime transition event"
                .to_string(),
        );
    }

    RuntimeTransitionTraceVerdict::from_missing(scenario, missing)
}

fn verify_tool_call_trace(graph: Option<&Value>) -> RuntimeTransitionTraceVerdict {
    let scenario = RuntimeTransitionTraceScenario::ToolCall;
    let Some(graph) = graph else {
        return RuntimeTransitionTraceVerdict::from_missing(
            scenario,
            vec!["execution graph payload is required".to_string()],
        );
    };

    let mut missing = Vec::new();
    if !graph_events(graph).any(|event| {
        event.get("event_type").and_then(Value::as_str) == Some("runtime_transition.decision")
            && event
                .get("payload")
                .and_then(|payload| payload.get("required_artifact"))
                .and_then(Value::as_str)
                == Some("world_model_frame_refresh")
            && event
                .get("payload")
                .and_then(|payload| payload.get("enforcement"))
                .and_then(Value::as_str)
                == Some("enforced")
    }) {
        missing.push(
            "tool-call graph must contain an enforced world_model_frame_refresh transition decision"
                .to_string(),
        );
    }
    if !graph_events(graph).any(|event| {
        event.get("event_type").and_then(Value::as_str) == Some("runtime_transition.correlation")
            && event
                .get("payload")
                .and_then(|payload| payload.get("outcome"))
                .and_then(Value::as_str)
                == Some("matched")
    }) {
        missing.push("tool-call graph must correlate the proposal to a matched result".to_string());
    }

    RuntimeTransitionTraceVerdict::from_missing(scenario, missing)
}

fn verify_capability_exposure_trace(graph: Option<&Value>) -> RuntimeTransitionTraceVerdict {
    let scenario = RuntimeTransitionTraceScenario::CapabilityExposure;
    let Some(graph) = graph else {
        return RuntimeTransitionTraceVerdict::from_missing(
            scenario,
            vec!["execution graph payload is required".to_string()],
        );
    };

    let mut missing = Vec::new();
    if !graph_events(graph).any(|event| {
        event.get("event_type").and_then(Value::as_str) == Some("runtime_transition.decision")
            && event
                .get("payload")
                .and_then(|payload| payload.get("source"))
                .and_then(Value::as_str)
                == Some("capability_discovery")
            && event
                .get("payload")
                .and_then(|payload| payload.get("required_artifact"))
                .and_then(Value::as_str)
                == Some("capability_lease")
    }) {
        missing.push(
            "capability graph must contain a capability_discovery capability_lease transition"
                .to_string(),
        );
    }
    if !graph_events(graph).any(|event| {
        event.get("event_type").and_then(Value::as_str) == Some("runtime_transition.decision")
            && event
                .get("payload")
                .and_then(|payload| payload.get("proposed_action"))
                .and_then(Value::as_str)
                == Some("draft_plan")
            && event
                .get("payload")
                .and_then(|payload| payload.get("required_artifact"))
                .and_then(Value::as_str)
                == Some("plan_draft")
    }) {
        missing.push(
            "capability graph must record an adaptive plan_draft transition for direct callable exposure"
                .to_string(),
        );
    }

    RuntimeTransitionTraceVerdict::from_missing(scenario, missing)
}

fn runtime_transition_events(response: &Value) -> impl Iterator<Item = &Value> {
    response
        .get("runtime_transition_events")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn graph_events(graph: &Value) -> impl Iterator<Item = &Value> {
    graph
        .get("events")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn answer_only_contract_requires_hidden_policy_guidance_verification_event() {
        let verdict = verify_runtime_transition_trace_contract(
            RuntimeTransitionTraceScenario::AnswerOnly,
            Some(&json!({
                "content": "Plain answer.",
                "runtime_transition_events": [{
                    "required_artifact": "verification_plan",
                    "enforcement": "enforced"
                }]
            })),
            None,
        );

        assert_eq!(
            verdict,
            RuntimeTransitionTraceVerdict::pass(RuntimeTransitionTraceScenario::AnswerOnly)
        );
    }

    #[test]
    fn answer_only_contract_can_be_recomputed_from_graph_events() {
        let verdict = verify_runtime_transition_trace_contract(
            RuntimeTransitionTraceScenario::AnswerOnly,
            None,
            Some(&json!({
                "events": [{
                    "event_type": "runtime_transition.decision",
                    "payload": {
                        "required_artifact": "verification_plan",
                        "enforcement": "enforced"
                    }
                }]
            })),
        );

        assert!(verdict.passed, "{:?}", verdict.missing);

        let verdicts = project_runtime_transition_trace_verdicts(
            None,
            Some(&json!({
                "events": [{
                    "event_type": "runtime_transition.decision",
                    "payload": {
                        "required_artifact": "verification_plan",
                        "enforcement": "enforced"
                    }
                }]
            })),
        );

        assert_eq!(verdicts.len(), 1);
        assert_eq!(verdicts[0]["scenario"], json!("answer_only"));
        assert_eq!(verdicts[0]["passed"], json!(true));
    }

    #[test]
    fn tool_call_contract_requires_decision_and_correlation_events() {
        let verdict = verify_runtime_transition_trace_contract(
            RuntimeTransitionTraceScenario::ToolCall,
            None,
            Some(&json!({
                "events": [
                    {
                        "event_type": "runtime_transition.decision",
                        "payload": {
                            "required_artifact": "world_model_frame_refresh",
                            "enforcement": "enforced"
                        }
                    },
                    {
                        "event_type": "runtime_transition.correlation",
                        "payload": {"outcome": "matched"}
                    }
                ]
            })),
        );

        assert!(verdict.passed, "{:?}", verdict.missing);
    }

    #[test]
    fn capability_contract_requires_lease_and_adaptive_plan_events() {
        let verdict = verify_runtime_transition_trace_contract(
            RuntimeTransitionTraceScenario::CapabilityExposure,
            None,
            Some(&json!({
                "events": [
                    {
                        "event_type": "runtime_transition.decision",
                        "payload": {
                            "source": "capability_discovery",
                            "required_artifact": "capability_lease"
                        }
                    },
                    {
                        "event_type": "runtime_transition.decision",
                        "payload": {
                            "proposed_action": "draft_plan",
                            "required_artifact": "plan_draft"
                        }
                    }
                ]
            })),
        );

        assert!(verdict.passed, "{:?}", verdict.missing);
    }

    #[test]
    fn missing_trace_evidence_returns_actionable_gaps() {
        let verdict = verify_runtime_transition_trace_contract(
            RuntimeTransitionTraceScenario::ToolCall,
            None,
            Some(&json!({"events": []})),
        );

        assert!(!verdict.passed);
        assert_eq!(verdict.missing.len(), 2);
    }
    #[test]
    fn projects_verdicts_for_available_response_and_graph_contracts() {
        let verdicts = project_runtime_transition_trace_verdicts(
            Some(&json!({
                "content": "Plain answer.",
                "runtime_transition_events": [{
                    "required_artifact": "verification_plan",
                    "enforcement": "enforced"
                }]
            })),
            Some(&json!({
                "events": [
                    {
                        "event_type": "runtime_transition.decision",
                        "payload": {
                            "required_artifact": "world_model_frame_refresh",
                            "enforcement": "enforced"
                        }
                    },
                    {
                        "event_type": "runtime_transition.correlation",
                        "payload": {"outcome": "matched"}
                    },
                    {
                        "event_type": "runtime_transition.decision",
                        "payload": {
                            "source": "capability_discovery",
                            "required_artifact": "capability_lease"
                        }
                    },
                    {
                        "event_type": "runtime_transition.decision",
                        "payload": {
                            "proposed_action": "draft_plan",
                            "required_artifact": "plan_draft"
                        }
                    }
                ]
            })),
        );

        assert_eq!(verdicts.len(), 3);
        assert!(verdicts
            .iter()
            .all(|verdict| verdict["passed"] == json!(true)));
    }
}
