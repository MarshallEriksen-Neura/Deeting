pub mod modules {
    pub mod desktop_runtime {
        pub mod runtime {
            pub use crate::runtime_event_projection;
        }
    }
}
pub mod execution_graph {
    pub mod types {
        include!("../src/modules/desktop_runtime/runtime/execution_graph/types.rs");
    }
    pub mod projector {
        include!("../src/modules/desktop_runtime/runtime/execution_graph/projector.rs");
    }
}

pub mod runtime_event_projection {
    pub mod artifact {
        include!("../src/modules/desktop_runtime/runtime/runtime_event_projection/artifact.rs");
    }
    pub mod types {
        include!("../src/modules/desktop_runtime/runtime/runtime_event_projection/types.rs");
    }
    pub mod projection {
        include!("../src/modules/desktop_runtime/runtime/runtime_event_projection/projection.rs");
    }
    pub mod trace_contract {
        include!(
            "../src/modules/desktop_runtime/runtime/runtime_event_projection/trace_contract.rs"
        );
    }
}

use execution_graph::projector::{project_execution_graph_snapshot, GraphProjectionInput};
use mcp_core::types::LocalChatToolCall;
use runtime_event_projection::projection::{
    attach_runtime_transition_blocks_to_response, project_capability_exposure_decision_blocks,
    project_final_answer_decision_blocks, project_tool_call_proposal_decision_blocks,
    project_tool_execution_correlation_blocks, CapabilityExposureProjectionInput,
    FinalAnswerProjectionInput, ToolCallProposalProjectionInput,
};
use runtime_event_projection::trace_contract::{
    runtime_transition_trace_verdict_response, verify_runtime_transition_trace_contract,
    RuntimeTransitionTraceScenario,
};
use serde_json::json;

#[test]
fn runtime_transition_smoke_links_tool_proposal_to_result() {
    let calls = vec![LocalChatToolCall {
        id: Some("call-1".to_string()),
        name: "shell_execute".to_string(),
        arguments: json!({"command":"pwd"}),
        extra_content: None,
    }];
    let decisions = project_tool_call_proposal_decision_blocks(ToolCallProposalProjectionInput {
        trace_id: "trace-1",
        request_id: Some("request-1"),
        session_id: "session-1",
        round: 1,
        tool_calls: &calls,
    });
    let correlations = project_tool_execution_correlation_blocks(
        &decisions,
        &[json!({"id":"call-1", "name":"shell_execute", "status":"success"})],
    );

    assert_eq!(
        decisions[0]["payload"]["required_artifact"],
        json!("world_model_frame_refresh")
    );
    assert_eq!(correlations[0]["payload"]["outcome"], json!("matched"));
}

#[test]
fn runtime_transition_smoke_keeps_answer_only_hook_metadata_non_visible() {
    let blocks = project_final_answer_decision_blocks(FinalAnswerProjectionInput {
        trace_id: "trace-answer-1",
        request_id: Some("request-answer-1"),
        session_id: "session-1",
        response_has_verification_evidence: false,
    });
    let response = attach_runtime_transition_blocks_to_response(
        json!({"role": "assistant", "content": "Plain answer only."}),
        &blocks,
    );

    assert_eq!(response["content"], json!("Plain answer only."));
    assert!(response["content"]
        .as_str()
        .expect("content text")
        .find("runtime_transition")
        .is_none());
    assert_eq!(
        response["runtime_transition_events"][0]["required_artifact"],
        json!("verification_plan")
    );
    assert_eq!(
        response["tool_trace_blocks"][0]["type"],
        json!("runtime_transition_decision")
    );
}

#[test]
fn runtime_transition_smoke_projects_tool_task_trace_to_graph_metadata() {
    let calls = vec![LocalChatToolCall {
        id: Some("call-graph-1".to_string()),
        name: "shell_execute".to_string(),
        arguments: json!({"command":"pwd"}),
        extra_content: None,
    }];
    let decisions = project_tool_call_proposal_decision_blocks(ToolCallProposalProjectionInput {
        trace_id: "trace-tool-1",
        request_id: Some("request-tool-1"),
        session_id: "session-1",
        round: 1,
        tool_calls: &calls,
    });
    let correlations = project_tool_execution_correlation_blocks(
        &decisions,
        &[json!({"id":"call-graph-1", "name":"shell_execute", "status":"success"})],
    );
    let mut blocks = vec![
        json!({"type":"tool_call", "callId":"call-graph-1", "toolName":"shell_execute", "status":"running"}),
        json!({"type":"tool_result", "callId":"call-graph-1", "toolName":"shell_execute", "status":"success"}),
    ];
    blocks.extend(decisions);
    blocks.extend(correlations);

    let graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: "session-1".to_string(),
        trace_id: Some("trace-tool-1".to_string()),
        request_id: Some("request-tool-1".to_string()),
        root_execution_id: None,
        response_content: None,
        tool_trace_blocks: blocks,
        delegated_execution_tree: None,
    });

    let decision = graph
        .events
        .iter()
        .find(|event| event.event_type == "runtime_transition.decision")
        .expect("runtime transition decision event");
    let correlation = graph
        .events
        .iter()
        .find(|event| event.event_type == "runtime_transition.correlation")
        .expect("runtime transition correlation event");

    assert_eq!(
        decision.payload["transition_id"],
        json!("runtime-transition:call-graph-1")
    );
    assert_eq!(
        decision.payload["required_artifact"],
        json!("world_model_frame_refresh")
    );
    assert_eq!(decision.payload["enforcement"], json!("enforced"));
    assert_eq!(
        correlation.payload["transition_id"],
        json!("runtime-transition:call-graph-1")
    );
    assert_eq!(correlation.payload["outcome"], json!("matched"));
}

#[test]
fn runtime_transition_smoke_records_search_sdk_capability_exposure_in_graph_metadata() {
    let blocks = project_capability_exposure_decision_blocks(CapabilityExposureProjectionInput {
        trace_id: "trace-capability-1",
        request_id: Some("request-capability-1"),
        session_id: "session-1",
        call_id: "search-call-1",
        query: "browser automation",
        full_payload: &json!({
            "detail_level": "full",
            "routing_hint": {"direct_callable_capability_count": 1},
            "capabilities": [{"name": "browser_open_tab"}]
        }),
    });

    let graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: "session-1".to_string(),
        trace_id: Some("trace-capability-1".to_string()),
        request_id: Some("request-capability-1".to_string()),
        root_execution_id: None,
        response_content: None,
        tool_trace_blocks: blocks,
        delegated_execution_tree: None,
    });
    let runtime_events = graph
        .events
        .iter()
        .filter(|event| event.event_type == "runtime_transition.decision")
        .collect::<Vec<_>>();

    assert_eq!(runtime_events.len(), 2);
    assert!(runtime_events.iter().any(|event| {
        event.payload["source"] == json!("capability_discovery")
            && event.payload["required_artifact"] == json!("capability_lease")
            && event.payload["tool_name"] == json!("search_sdk")
    }));
    assert!(runtime_events.iter().any(|event| {
        event.payload["proposed_action"] == json!("draft_plan")
            && event.payload["required_artifact"] == json!("plan_draft")
    }));
}

#[test]
fn runtime_transition_smoke_matches_manual_trace_acceptance_matrix() {
    let answer_blocks = project_final_answer_decision_blocks(FinalAnswerProjectionInput {
        trace_id: "trace-answer-manual",
        request_id: Some("request-answer-manual"),
        session_id: "session-1",
        response_has_verification_evidence: false,
    });
    let answer_response = attach_runtime_transition_blocks_to_response(
        json!({"role":"assistant", "content":"Plain answer only."}),
        &answer_blocks,
    );
    assert_eq!(answer_response["content"], json!("Plain answer only."));
    let answer_verdict = verify_runtime_transition_trace_contract(
        RuntimeTransitionTraceScenario::AnswerOnly,
        Some(&answer_response),
        None,
    );
    assert!(answer_verdict.passed, "{:?}", answer_verdict.missing);
    assert_eq!(
        answer_response["runtime_transition_trace_verdicts"][0]["passed"],
        json!(true)
    );

    let tool_calls = vec![LocalChatToolCall {
        id: Some("call-manual-1".to_string()),
        name: "shell_execute".to_string(),
        arguments: json!({"command":"pwd"}),
        extra_content: None,
    }];
    let mut tool_blocks =
        project_tool_call_proposal_decision_blocks(ToolCallProposalProjectionInput {
            trace_id: "trace-tool-manual",
            request_id: Some("request-tool-manual"),
            session_id: "session-1",
            round: 1,
            tool_calls: &tool_calls,
        });
    tool_blocks.extend(project_tool_execution_correlation_blocks(
        &tool_blocks.clone(),
        &[json!({"id":"call-manual-1", "name":"shell_execute", "status":"success"})],
    ));
    let tool_graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: "session-1".to_string(),
        trace_id: Some("trace-tool-manual".to_string()),
        request_id: Some("request-tool-manual".to_string()),
        root_execution_id: None,
        response_content: None,
        tool_trace_blocks: tool_blocks,
        delegated_execution_tree: None,
    });
    let tool_graph_value = tool_graph.to_value();
    let tool_verdict = verify_runtime_transition_trace_contract(
        RuntimeTransitionTraceScenario::ToolCall,
        None,
        Some(&tool_graph_value),
    );
    assert!(tool_verdict.passed, "{:?}", tool_verdict.missing);
    assert!(
        tool_graph_value["metadata"]["runtime_transition_trace_verdicts"]
            .as_array()
            .expect("graph trace verdicts")
            .iter()
            .any(|verdict| verdict["scenario"] == json!("tool_call")
                && verdict["passed"] == json!(true))
    );

    let capability_blocks =
        project_capability_exposure_decision_blocks(CapabilityExposureProjectionInput {
            trace_id: "trace-capability-manual",
            request_id: Some("request-capability-manual"),
            session_id: "session-1",
            call_id: "search-call-manual-1",
            query: "browser automation",
            full_payload: &json!({
                "detail_level": "full",
                "routing_hint": {"direct_callable_capability_count": 1},
                "capabilities": [{"name":"browser_open_tab"}]
            }),
        });
    let capability_graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: "session-1".to_string(),
        trace_id: Some("trace-capability-manual".to_string()),
        request_id: Some("request-capability-manual".to_string()),
        root_execution_id: None,
        response_content: None,
        tool_trace_blocks: capability_blocks,
        delegated_execution_tree: None,
    });
    let capability_graph_value = capability_graph.to_value();
    let capability_verdict = verify_runtime_transition_trace_contract(
        RuntimeTransitionTraceScenario::CapabilityExposure,
        None,
        Some(&capability_graph_value),
    );
    assert!(
        capability_verdict.passed,
        "{:?}",
        capability_verdict.missing
    );
}

#[test]
fn runtime_transition_smoke_projects_queryable_trace_verdict_response() {
    let graph = serde_json::json!({
        "execution_id": "graph-query-1",
        "request_id": "request-query-1",
        "metadata": {"trace_id": "trace-query-1"},
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
    });

    let response = runtime_transition_trace_verdict_response("graph-query-1", &graph);

    assert_eq!(
        response["execution_graph_execution_id"],
        json!("graph-query-1")
    );
    assert_eq!(response["verdict_source"], json!("recomputed"));
    assert_eq!(
        response["runtime_transition_trace_verdicts"][0]["scenario"],
        json!("tool_call")
    );
    assert_eq!(
        response["runtime_transition_trace_verdicts"][0]["passed"],
        json!(true)
    );
    assert_eq!(
        response["recomputed_runtime_transition_trace_verdicts"][0]["scenario"],
        json!("tool_call")
    );
}
