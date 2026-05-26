use super::types::{
    approval_gate_node_id, finalize_node_id, llm_round_node_id, tool_call_node_id,
    LocalExecutionGraphBackend, LocalExecutionGraphEvent, LocalExecutionGraphExecutionClass,
    LocalExecutionGraphNode, LocalExecutionGraphNodeStatus, LocalExecutionGraphNodeType,
    LocalExecutionGraphSnapshot, LocalExecutionGraphStateScope, EXECUTION_GRAPH_SCHEMA_VERSION,
};
use crate::modules::desktop_runtime::runtime::runtime_event_projection::projection::{
    RUNTIME_TRANSITION_CORRELATION_BLOCK_TYPE, RUNTIME_TRANSITION_CORRELATION_EVENT_TYPE,
    RUNTIME_TRANSITION_DECISION_BLOCK_TYPE, RUNTIME_TRANSITION_DECISION_EVENT_TYPE,
};
use crate::modules::desktop_runtime::runtime::runtime_event_projection::trace_contract::project_runtime_transition_trace_verdicts;
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub(crate) struct GraphProjectionInput {
    pub(crate) session_id: String,
    pub(crate) route: String,
    pub(crate) phase_step_type: String,
    pub(crate) trace_id: Option<String>,
    pub(crate) request_id: Option<String>,
    pub(crate) root_execution_id: Option<String>,
    pub(crate) response_content: Option<Value>,
    pub(crate) tool_trace_blocks: Vec<Value>,
    pub(crate) delegated_execution_tree: Option<Value>,
}

pub(crate) fn project_execution_graph_snapshot(
    input: GraphProjectionInput,
) -> LocalExecutionGraphSnapshot {
    let execution_id = resolve_execution_id(&input);
    let mut nodes = Vec::new();
    let mut events = Vec::new();
    let llm_round_node_id = llm_round_node_id(1);

    nodes.push(LocalExecutionGraphNode {
        node_id: llm_round_node_id.clone(),
        node_type: LocalExecutionGraphNodeType::LlmRound,
        status: LocalExecutionGraphNodeStatus::Success,
        dependency_ids: Vec::new(),
        metadata: json!({
            "round": 1,
            "route": input.route,
            "phase_step_type": input.phase_step_type,
        }),
        input_payload: None,
        output_payload: input.response_content.clone(),
    });

    if let Some(tree) = input.delegated_execution_tree.clone() {
        if let Some(frame_event) = world_model_frame_started_event(&tree, &llm_round_node_id) {
            events.push(frame_event);
        }
        events.push(LocalExecutionGraphEvent {
            event_id: "event:delegated_execution".to_string(),
            node_id: Some(llm_round_node_id.clone()),
            event_type: "delegated_execution.integrated".to_string(),
            payload: tree,
        });
    }

    let mut tool_node_index_by_call_id = HashMap::<String, usize>::new();
    let mut approval_gate_ids = Vec::<String>::new();

    for (index, block) in input.tool_trace_blocks.iter().enumerate() {
        let event_id = format!("event:tool_trace:{index}");
        let block_type = block
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match block_type {
            RUNTIME_TRANSITION_DECISION_BLOCK_TYPE => {
                events.push(LocalExecutionGraphEvent {
                    event_id: format!("event:runtime_transition:{index}"),
                    node_id: None,
                    event_type: RUNTIME_TRANSITION_DECISION_EVENT_TYPE.to_string(),
                    payload: block
                        .get("payload")
                        .cloned()
                        .unwrap_or_else(|| block.clone()),
                });
            }
            RUNTIME_TRANSITION_CORRELATION_BLOCK_TYPE => {
                events.push(LocalExecutionGraphEvent {
                    event_id: format!("event:runtime_transition_correlation:{index}"),
                    node_id: None,
                    event_type: RUNTIME_TRANSITION_CORRELATION_EVENT_TYPE.to_string(),
                    payload: block
                        .get("payload")
                        .cloned()
                        .unwrap_or_else(|| block.clone()),
                });
            }
            "tool_call" => {
                let call_id = block
                    .get("callId")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("unknown-call")
                    .to_string();
                let node_id = tool_call_node_id(&call_id);
                let status = map_tool_call_status(block.get("status").and_then(Value::as_str));
                let metadata = json!({
                    "call_id": call_id,
                    "tool_name": block.get("toolName").cloned().unwrap_or(Value::Null),
                    "execution_backend": LocalExecutionGraphBackend::Direct,
                    "execution_class": LocalExecutionGraphExecutionClass::SerialOnly,
                    "state_scope": LocalExecutionGraphStateScope::ReadOnly,
                });
                tool_node_index_by_call_id.insert(call_id.clone(), nodes.len());
                nodes.push(LocalExecutionGraphNode {
                    node_id: node_id.clone(),
                    node_type: LocalExecutionGraphNodeType::ToolCall,
                    status,
                    dependency_ids: vec![llm_round_node_id.clone()],
                    metadata,
                    input_payload: Some(block.clone()),
                    output_payload: None,
                });
                events.push(LocalExecutionGraphEvent {
                    event_id,
                    node_id: Some(node_id),
                    event_type: "tool_call.seen".to_string(),
                    payload: block.clone(),
                });
            }
            "tool_result" => {
                let call_id = block
                    .get("callId")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("unknown-call")
                    .to_string();
                let node_id = tool_call_node_id(&call_id);
                let result_status = block
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("success");

                if let Some(index) = tool_node_index_by_call_id.get(&call_id).copied() {
                    let status = map_tool_result_status(result_status);
                    nodes[index].status = status;
                    nodes[index].output_payload = Some(block.clone());
                } else {
                    tool_node_index_by_call_id.insert(call_id.clone(), nodes.len());
                    nodes.push(LocalExecutionGraphNode {
                        node_id: node_id.clone(),
                        node_type: LocalExecutionGraphNodeType::ToolCall,
                        status: map_tool_result_status(result_status),
                        dependency_ids: vec![llm_round_node_id.clone()],
                        metadata: json!({
                            "call_id": call_id,
                            "tool_name": block.get("toolName").cloned().unwrap_or(Value::Null),
                            "execution_backend": LocalExecutionGraphBackend::Direct,
                            "execution_class": LocalExecutionGraphExecutionClass::SerialOnly,
                            "state_scope": LocalExecutionGraphStateScope::ReadOnly,
                        }),
                        input_payload: None,
                        output_payload: Some(block.clone()),
                    });
                }

                if result_status.eq_ignore_ascii_case("requires_approval") {
                    let gate_id = approval_gate_node_id(&call_id);
                    approval_gate_ids.push(gate_id.clone());
                    nodes.push(LocalExecutionGraphNode {
                        node_id: gate_id.clone(),
                        node_type: LocalExecutionGraphNodeType::ApprovalGate,
                        status: LocalExecutionGraphNodeStatus::WaitingApproval,
                        dependency_ids: vec![node_id.clone()],
                        metadata: json!({
                            "call_id": call_id,
                            "tool_name": block.get("toolName").cloned().unwrap_or(Value::Null),
                            "approval_token": block
                                .get("result")
                                .and_then(|value| value.get("approval_token"))
                                .cloned()
                                .unwrap_or(Value::Null),
                        }),
                        input_payload: Some(block.clone()),
                        output_payload: None,
                    });
                    events.push(LocalExecutionGraphEvent {
                        event_id,
                        node_id: Some(gate_id),
                        event_type: "approval_gate.waiting".to_string(),
                        payload: block.clone(),
                    });
                } else {
                    events.push(LocalExecutionGraphEvent {
                        event_id,
                        node_id: Some(node_id),
                        event_type: "tool_result.seen".to_string(),
                        payload: block.clone(),
                    });
                }
            }
            _ => {
                events.push(LocalExecutionGraphEvent {
                    event_id,
                    node_id: None,
                    event_type: "projection.ignored_block".to_string(),
                    payload: block.clone(),
                });
            }
        }
    }

    let finalize_status = if approval_gate_ids.is_empty() {
        LocalExecutionGraphNodeStatus::Success
    } else {
        LocalExecutionGraphNodeStatus::Pending
    };
    let mut finalize_dependencies = vec![llm_round_node_id];
    finalize_dependencies.extend(
        nodes
            .iter()
            .filter(|node| matches!(node.node_type, LocalExecutionGraphNodeType::ToolCall))
            .map(|node| node.node_id.clone()),
    );
    finalize_dependencies.extend(approval_gate_ids.clone());
    nodes.push(LocalExecutionGraphNode {
        node_id: finalize_node_id(1),
        node_type: LocalExecutionGraphNodeType::Finalize,
        status: finalize_status,
        dependency_ids: finalize_dependencies,
        metadata: json!({
            "pending_approval_gate_ids": approval_gate_ids,
        }),
        input_payload: None,
        output_payload: input.response_content.clone(),
    });

    let graph_event_value = json!({ "events": events.clone() });
    let runtime_transition_trace_verdicts =
        project_runtime_transition_trace_verdicts(None, Some(&graph_event_value));

    LocalExecutionGraphSnapshot {
        schema_version: EXECUTION_GRAPH_SCHEMA_VERSION,
        execution_id,
        session_id: input.session_id,
        route: input.route,
        phase_step_type: input.phase_step_type,
        request_id: input.request_id,
        root_execution_id: input.root_execution_id,
        nodes,
        events,
        metadata: json!({
            "projection_version": 1,
            "trace_id": input.trace_id,
            "tool_trace_block_count": input.tool_trace_blocks.len(),
            "has_delegated_execution": input.delegated_execution_tree.is_some(),
            "runtime_transition_trace_verdicts": runtime_transition_trace_verdicts,
        }),
    }
}

pub(crate) fn project_execution_graph_blocks_from_value(execution_graph: &Value) -> Vec<Value> {
    let snapshot: LocalExecutionGraphSnapshot =
        match serde_json::from_value(execution_graph.clone()) {
            Ok(snapshot) => snapshot,
            Err(_) => return Vec::new(),
        };
    project_execution_graph_blocks(&snapshot)
}

fn project_execution_graph_blocks(snapshot: &LocalExecutionGraphSnapshot) -> Vec<Value> {
    let tool_nodes = snapshot
        .nodes
        .iter()
        .filter(|node| matches!(node.node_type, LocalExecutionGraphNodeType::ToolCall))
        .collect::<Vec<_>>();
    if tool_nodes.is_empty() {
        return Vec::new();
    }

    let has_code_execution = tool_nodes.iter().any(|node| {
        node.metadata
            .get("tool_name")
            .and_then(Value::as_str)
            .map(|name| name.eq_ignore_ascii_case("execute_code_plan"))
            .unwrap_or(false)
    });

    let mut blocks = Vec::with_capacity(tool_nodes.len() * 2 + 1);
    if has_code_execution {
        blocks.push(json!({
            "type": "execution_section",
            "title": "Code Execution",
        }));
    }

    for node in tool_nodes {
        let call_id = node
            .metadata
            .get("call_id")
            .and_then(Value::as_str)
            .or_else(|| node.node_id.strip_prefix("tool_call:"))
            .unwrap_or_default();
        let tool_name = node
            .metadata
            .get("tool_name")
            .and_then(Value::as_str)
            .unwrap_or("unknown_tool");

        blocks.push(json!({
            "type": "tool_call",
            "callId": call_id,
            "toolName": tool_name,
            "status": map_graph_tool_call_block_status(&node.status),
        }));

        if let Some(result_block) = build_graph_tool_result_block(node, call_id, tool_name) {
            blocks.push(result_block);
        }
    }

    blocks
}

fn map_graph_tool_call_block_status(status: &LocalExecutionGraphNodeStatus) -> &'static str {
    match status {
        LocalExecutionGraphNodeStatus::Pending | LocalExecutionGraphNodeStatus::Queued => "running",
        LocalExecutionGraphNodeStatus::Running => "running",
        LocalExecutionGraphNodeStatus::WaitingApproval
        | LocalExecutionGraphNodeStatus::Approving
        | LocalExecutionGraphNodeStatus::Approved
        | LocalExecutionGraphNodeStatus::Success => "success",
        LocalExecutionGraphNodeStatus::Rejected
        | LocalExecutionGraphNodeStatus::ApprovalFailed
        | LocalExecutionGraphNodeStatus::Error
        | LocalExecutionGraphNodeStatus::Cancelled => "error",
    }
}

fn build_graph_tool_result_block(
    node: &LocalExecutionGraphNode,
    call_id: &str,
    tool_name: &str,
) -> Option<Value> {
    match node.status {
        LocalExecutionGraphNodeStatus::Pending
        | LocalExecutionGraphNodeStatus::Queued
        | LocalExecutionGraphNodeStatus::Running => None,
        LocalExecutionGraphNodeStatus::WaitingApproval
        | LocalExecutionGraphNodeStatus::Approving => Some(json!({
            "type": "tool_result",
            "callId": call_id,
            "toolName": tool_name,
            "status": "requires_approval",
            "result": graph_tool_result_payload(node, json!({})),
        })),
        LocalExecutionGraphNodeStatus::Approved | LocalExecutionGraphNodeStatus::Success => {
            Some(json!({
                "type": "tool_result",
                "callId": call_id,
                "toolName": tool_name,
                "status": "success",
                "result": graph_tool_result_payload(node, json!({})),
            }))
        }
        LocalExecutionGraphNodeStatus::Rejected
        | LocalExecutionGraphNodeStatus::ApprovalFailed
        | LocalExecutionGraphNodeStatus::Error
        | LocalExecutionGraphNodeStatus::Cancelled => Some(json!({
            "type": "tool_result",
            "callId": call_id,
            "toolName": tool_name,
            "status": "error",
            "result": graph_tool_result_payload(node, json!({"error":"tool call failed"})),
        })),
    }
}

fn graph_tool_result_payload(node: &LocalExecutionGraphNode, fallback: Value) -> Value {
    node.output_payload
        .as_ref()
        .and_then(|payload| payload.get("result").cloned())
        .or_else(|| node.output_payload.clone())
        .unwrap_or(fallback)
}

fn world_model_frame_started_event(
    tree: &Value,
    llm_round_node_id: &str,
) -> Option<LocalExecutionGraphEvent> {
    let (task_input_source, task_input_source_ref) =
        if let Some(source) = tree.get("task_input_source") {
            (source, "delegated_execution_tree.task_input_source")
        } else if let Some(source) = tree.pointer("/primary_output/task_input_source") {
            (
                source,
                "delegated_execution_tree.primary_output.task_input_source",
            )
        } else {
            return None;
        };

    if let Some(source) = task_input_source.get("delegated_agent") {
        let frame_id = trimmed_json_str(source, "child_frame_id")?;
        return Some(LocalExecutionGraphEvent {
            event_id: format!("event:world_model_frame:{frame_id}"),
            node_id: Some(llm_round_node_id.to_string()),
            event_type: "world_model_frame.started".to_string(),
            payload: json!({
                "event_type": "world_model_frame.started",
                "frame_id": frame_id,
                "parent_frame_id": optional_trimmed_json_str(source, "parent_frame_id"),
                "source_kind": "delegated_agent",
                "run_id": optional_trimmed_json_str(source, "child_run_id"),
                "agent_id": optional_trimmed_json_str(source, "agent_id"),
                "invocation_kind": optional_trimmed_json_str(source, "invocation_kind"),
                "return_channel": optional_trimmed_json_str(source, "return_channel"),
                "task_input_source_ref": task_input_source_ref,
            }),
        });
    }

    if let Some(source) = task_input_source.get("cron_monitor") {
        let execution_frame_id = optional_trimmed_json_str(source, "execution_frame_id");
        let monitor_frame_id = optional_trimmed_json_str(source, "monitor_frame_id");
        let frame_id = execution_frame_id
            .clone()
            .or_else(|| monitor_frame_id.clone())?;
        let parent_frame_id = execution_frame_id.and(monitor_frame_id.clone());
        return Some(LocalExecutionGraphEvent {
            event_id: format!("event:world_model_frame:{frame_id}"),
            node_id: Some(llm_round_node_id.to_string()),
            event_type: "world_model_frame.started".to_string(),
            payload: json!({
                "event_type": "world_model_frame.started",
                "frame_id": frame_id,
                "parent_frame_id": parent_frame_id,
                "source_kind": "cron_monitor",
                "run_id": optional_trimmed_json_str(source, "execution_id"),
                "task_id": optional_trimmed_json_str(source, "task_id"),
                "schedule_id": optional_trimmed_json_str(source, "schedule_id"),
                "checkpoint_policy": optional_trimmed_json_str(source, "checkpoint_policy"),
                "task_input_source_ref": task_input_source_ref,
            }),
        });
    }

    None
}

fn trimmed_json_str(value: &Value, field: &str) -> Option<String> {
    optional_trimmed_json_str(value, field).filter(|value| !value.is_empty())
}

fn optional_trimmed_json_str(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}
fn resolve_execution_id(input: &GraphProjectionInput) -> String {
    input
        .root_execution_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            input
                .delegated_execution_tree
                .as_ref()
                .and_then(|value| value.get("execution_id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .or_else(|| {
            input
                .request_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!("local-request:{value}"))
        })
        .or_else(|| {
            input
                .trace_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!("local-trace:{value}"))
        })
        .unwrap_or_else(|| {
            format!(
                "local-session:{}:{}",
                input.session_id, input.phase_step_type
            )
        })
}

fn map_tool_call_status(status: Option<&str>) -> LocalExecutionGraphNodeStatus {
    match status
        .unwrap_or("running")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "queued" => LocalExecutionGraphNodeStatus::Queued,
        "success" => LocalExecutionGraphNodeStatus::Success,
        "error" => LocalExecutionGraphNodeStatus::Error,
        "cancelled" => LocalExecutionGraphNodeStatus::Cancelled,
        "requires_approval" => LocalExecutionGraphNodeStatus::WaitingApproval,
        "approving" => LocalExecutionGraphNodeStatus::Approving,
        "approved" => LocalExecutionGraphNodeStatus::Approved,
        "rejected" => LocalExecutionGraphNodeStatus::Rejected,
        "approval_failed" => LocalExecutionGraphNodeStatus::ApprovalFailed,
        _ => LocalExecutionGraphNodeStatus::Running,
    }
}

fn map_tool_result_status(status: &str) -> LocalExecutionGraphNodeStatus {
    match status.trim().to_ascii_lowercase().as_str() {
        "error" => LocalExecutionGraphNodeStatus::Error,
        "cancelled" => LocalExecutionGraphNodeStatus::Cancelled,
        "requires_approval" => LocalExecutionGraphNodeStatus::WaitingApproval,
        "approving" => LocalExecutionGraphNodeStatus::Approving,
        "approved" => LocalExecutionGraphNodeStatus::Approved,
        "rejected" => LocalExecutionGraphNodeStatus::Rejected,
        "approval_failed" => LocalExecutionGraphNodeStatus::ApprovalFailed,
        _ => LocalExecutionGraphNodeStatus::Success,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        project_execution_graph_blocks_from_value, project_execution_graph_snapshot,
        GraphProjectionInput, LocalExecutionGraphNodeStatus,
    };
    use serde_json::json;

    #[test]
    fn project_execution_graph_snapshot_keeps_tool_call_order_and_finalize_dependency() {
        let snapshot = project_execution_graph_snapshot(GraphProjectionInput {
            session_id: "session-1".to_string(),
            route: "direct".to_string(),
            phase_step_type: "direct_chat".to_string(),
            trace_id: Some("trace-1".to_string()),
            request_id: Some("req-1".to_string()),
            root_execution_id: None,
            response_content: Some(json!("done")),
            tool_trace_blocks: vec![
                json!({"type":"tool_call","callId":"call-1","toolName":"search_web","status":"running"}),
                json!({"type":"tool_result","callId":"call-1","toolName":"search_web","status":"success","result":{"ok":true}}),
                json!({"type":"tool_call","callId":"call-2","toolName":"read_file","status":"running"}),
                json!({"type":"tool_result","callId":"call-2","toolName":"read_file","status":"success","result":{"ok":true}}),
            ],
            delegated_execution_tree: None,
        });

        let tool_nodes = snapshot
            .nodes
            .iter()
            .filter(|node| node.node_id.starts_with("tool_call:"))
            .map(|node| node.node_id.clone())
            .collect::<Vec<_>>();
        assert_eq!(tool_nodes, vec!["tool_call:call-1", "tool_call:call-2"]);

        let finalize = snapshot
            .nodes
            .iter()
            .find(|node| node.node_id == "finalize:1")
            .expect("finalize node");
        assert_eq!(
            finalize
                .dependency_ids
                .iter()
                .filter(|item| item.starts_with("tool_call:"))
                .cloned()
                .collect::<Vec<_>>(),
            vec!["tool_call:call-1", "tool_call:call-2"]
        );
    }

    #[test]
    fn project_execution_graph_snapshot_creates_waiting_approval_gate() {
        let snapshot = project_execution_graph_snapshot(GraphProjectionInput {
            session_id: "session-1".to_string(),
            route: "direct".to_string(),
            phase_step_type: "direct_chat".to_string(),
            trace_id: Some("trace-approval".to_string()),
            request_id: None,
            root_execution_id: Some("root-1".to_string()),
            response_content: None,
            tool_trace_blocks: vec![
                json!({"type":"tool_call","callId":"call-approval","toolName":"browser_open_tab","status":"running"}),
                json!({
                    "type":"tool_result",
                    "callId":"call-approval",
                    "toolName":"browser_open_tab",
                    "status":"requires_approval",
                    "result":{"approval_token":"approval-1"}
                }),
            ],
            delegated_execution_tree: None,
        });

        let gate = snapshot
            .nodes
            .iter()
            .find(|node| node.node_id == "approval_gate:call-approval")
            .expect("approval gate node");
        assert_eq!(gate.status, LocalExecutionGraphNodeStatus::WaitingApproval);

        let finalize = snapshot
            .nodes
            .iter()
            .find(|node| node.node_id == "finalize:1")
            .expect("finalize node");
        assert_eq!(finalize.status, LocalExecutionGraphNodeStatus::Pending);
    }

    #[test]
    fn project_execution_graph_snapshot_records_runtime_transition_decision() {
        let snapshot = project_execution_graph_snapshot(GraphProjectionInput {
            session_id: "session-1".to_string(),
            route: "direct".to_string(),
            phase_step_type: "direct_chat".to_string(),
            trace_id: Some("trace-transition".to_string()),
            request_id: Some("request-transition".to_string()),
            root_execution_id: Some("root-1".to_string()),
            response_content: None,
            tool_trace_blocks: vec![json!({
                "type": "runtime_transition_decision",
                "payload": {
                    "event_type": "runtime_transition.decision",
                    "decision_id": "hook-decision:runtime-transition:call-1",
                    "transition_id": "runtime-transition:call-1",
                    "trace_id": "trace-transition",
                    "request_id": "request-transition",
                    "session_id": "session-1",
                    "source": "provider_response",
                    "required_artifact": "diting_think_preflight",
                    "enforcement": "enforced"
                }
            })],
            delegated_execution_tree: None,
        });

        let event = snapshot
            .events
            .iter()
            .find(|event| event.event_type == "runtime_transition.decision")
            .expect("runtime transition decision event");

        assert_eq!(event.node_id, None);
        assert_eq!(
            event.payload["transition_id"],
            json!("runtime-transition:call-1")
        );
        assert_eq!(event.payload["trace_id"], json!("trace-transition"));
        assert_eq!(event.payload["request_id"], json!("request-transition"));
        assert_eq!(
            event.payload["required_artifact"],
            json!("diting_think_preflight")
        );
        assert_eq!(event.payload["enforcement"], json!("enforced"));

        assert!(snapshot
            .events
            .iter()
            .all(|event| event.event_type != "projection.ignored_block"));
    }
    #[test]
    fn project_execution_graph_snapshot_records_runtime_transition_correlation() {
        let snapshot = project_execution_graph_snapshot(GraphProjectionInput {
            session_id: "session-1".to_string(),
            route: "direct".to_string(),
            phase_step_type: "direct_chat".to_string(),
            trace_id: Some("trace-transition".to_string()),
            request_id: Some("request-transition".to_string()),
            root_execution_id: Some("root-1".to_string()),
            response_content: None,
            tool_trace_blocks: vec![json!({
                "type": "runtime_transition_correlation",
                "payload": {
                    "event_type": "runtime_transition.correlation",
                    "transition_id": "runtime-transition:monitor-checkpoint:monitor-exec-1",
                    "outcome": "unverified",
                    "evidence_refs": ["monitor_policy_result:monitor-exec-1:0"]
                }
            })],
            delegated_execution_tree: None,
        });

        let event = snapshot
            .events
            .iter()
            .find(|event| event.event_type == "runtime_transition.correlation")
            .expect("runtime transition correlation event");

        assert_eq!(event.node_id, None);
        assert_eq!(
            event.payload["transition_id"],
            json!("runtime-transition:monitor-checkpoint:monitor-exec-1")
        );
        assert_eq!(event.payload["outcome"], json!("unverified"));
    }

    #[test]
    fn project_execution_graph_snapshot_records_delegated_world_model_frame_event() {
        let task_input_source = json!({
            "delegated_agent": {
                "parent_task_id": "parent-task-1",
                "parent_frame_id": "frame-parent-1",
                "child_run_id": "child-run-1",
                "child_frame_id": "frame-parent-1:delegation:child-run-1",
                "agent_id": "agent.research",
                "invocation_kind": "chat",
                "return_channel": "parent_frame_observation"
            }
        });
        let snapshot = project_execution_graph_snapshot(GraphProjectionInput {
            session_id: "session-1".to_string(),
            route: "direct".to_string(),
            phase_step_type: "direct_chat".to_string(),
            trace_id: Some("trace-frame".to_string()),
            request_id: Some("request-frame".to_string()),
            root_execution_id: Some("root-frame".to_string()),
            response_content: None,
            tool_trace_blocks: Vec::new(),
            delegated_execution_tree: Some(json!({
                "execution_id": "delegated-exec-1",
                "execution_kind": "custom_task_agent",
                "execution_status": "integrated",
                "task_input_source": task_input_source.clone()
            })),
        });

        let event = snapshot
            .events
            .iter()
            .find(|event| event.event_type == "world_model_frame.started")
            .expect("world model frame event");

        assert_eq!(event.node_id.as_deref(), Some("llm_round:1"));
        assert_eq!(
            event.event_id,
            "event:world_model_frame:frame-parent-1:delegation:child-run-1"
        );
        assert_eq!(
            event.payload["frame_id"],
            json!("frame-parent-1:delegation:child-run-1")
        );
        assert_eq!(event.payload["parent_frame_id"], json!("frame-parent-1"));
        assert_eq!(event.payload["source_kind"], json!("delegated_agent"));
        assert_eq!(event.payload["run_id"], json!("child-run-1"));
        assert_eq!(
            event.payload["task_input_source_ref"],
            json!("delegated_execution_tree.task_input_source")
        );
        assert!(event.payload.get("task_input_source").is_none());
    }

    #[test]
    fn project_execution_graph_snapshot_records_cron_world_model_frame_event() {
        let task_input_source = json!({
            "cron_monitor": {
                "task_id": "monitor-task-1",
                "schedule_id": "schedule-1",
                "cron_expr": "0 */6 * * *",
                "objective": "watch pricing changes",
                "monitor_frame_id": "monitor:monitor-task-1",
                "execution_id": "monitor-exec-1",
                "execution_frame_id": "monitor:monitor-task-1:execution:monitor-exec-1",
                "checkpoint_policy": "on_change_only"
            }
        });
        let snapshot = project_execution_graph_snapshot(GraphProjectionInput {
            session_id: "session-1".to_string(),
            route: "direct".to_string(),
            phase_step_type: "cron_monitor".to_string(),
            trace_id: Some("trace-cron-frame".to_string()),
            request_id: Some("request-cron-frame".to_string()),
            root_execution_id: Some("root-cron-frame".to_string()),
            response_content: None,
            tool_trace_blocks: Vec::new(),
            delegated_execution_tree: Some(json!({
                "execution_id": "monitor-exec-1",
                "execution_kind": "workflow",
                "execution_status": "running",
                "primary_output": {
                    "task_input_source": task_input_source.clone()
                }
            })),
        });

        let event = snapshot
            .events
            .iter()
            .find(|event| event.event_type == "world_model_frame.started")
            .expect("world model frame event");

        assert_eq!(
            event.payload["frame_id"],
            json!("monitor:monitor-task-1:execution:monitor-exec-1")
        );
        assert_eq!(
            event.payload["parent_frame_id"],
            json!("monitor:monitor-task-1")
        );
        assert_eq!(event.payload["source_kind"], json!("cron_monitor"));
        assert_eq!(event.payload["run_id"], json!("monitor-exec-1"));
        assert_eq!(event.payload["checkpoint_policy"], json!("on_change_only"));
        assert_eq!(
            event.payload["task_input_source_ref"],
            json!("delegated_execution_tree.primary_output.task_input_source")
        );
        assert!(event.payload.get("task_input_source").is_none());
    }

    #[test]
    fn project_execution_graph_blocks_from_value_emits_tool_blocks() {
        let snapshot = project_execution_graph_snapshot(GraphProjectionInput {
            session_id: "session-1".to_string(),
            route: "direct".to_string(),
            phase_step_type: "direct_chat".to_string(),
            trace_id: Some("trace-blocks".to_string()),
            request_id: None,
            root_execution_id: Some("root-1".to_string()),
            response_content: None,
            tool_trace_blocks: vec![
                json!({"type":"tool_call","callId":"call-1","toolName":"search_web","status":"running"}),
                json!({"type":"tool_result","callId":"call-1","toolName":"search_web","status":"success","result":{"ok":true}}),
            ],
            delegated_execution_tree: None,
        })
        .to_value();

        let blocks = project_execution_graph_blocks_from_value(&snapshot);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], json!("tool_call"));
        assert_eq!(blocks[1]["type"], json!("tool_result"));
        assert_eq!(blocks[1]["result"]["ok"], json!(true));
    }
}
