use super::lifecycle::SuspendedChatToolExecution;
use super::runtime_metrics::RuntimeMetricsAccumulator;
use super::runtime_state::LocalChatToolRuntimeState;
use super::streaming::LocalRealtimeToolTraceEmitter;
use crate::modules::desktop_runtime::runtime::{
    append_streamable_local_tool_result_blocks, build_local_tool_trace_blocks,
    project_execution_graph_blocks_from_value, project_execution_graph_snapshot,
    resolve_tool_trace_call_id, GraphProjectionInput, LocalExecutionPolicy,
};

pub(super) fn enrich_response_with_tool_trace(
    mut response: serde_json::Value,
    tool_call_meta: &[serde_json::Value],
    tool_trace_streamed: bool,
    runtime_metrics: &RuntimeMetricsAccumulator,
    captured_blocks: Option<&[serde_json::Value]>,
) -> serde_json::Value {
    let mut trace_blocks = if let Some(blocks) = captured_blocks.filter(|b| !b.is_empty()) {
        // Use the chronological stream of blocks emitted during the agentic loop
        // (thought -> text -> tool_call -> tool_result, per round). This preserves
        // intermediate narrative (thought/text from middle rounds) that would
        // otherwise be lost on reload, since tool_call_meta only covers tool calls.
        blocks.to_vec()
    } else if !tool_call_meta.is_empty() {
        build_local_tool_trace_blocks(tool_call_meta)
    } else {
        response
            .get("tool_trace_blocks")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_else(|| {
                if let Some(execution_graph) = response.get("execution_graph") {
                    project_execution_graph_blocks_from_value(execution_graph)
                } else {
                    Vec::new()
                }
            })
    };

    if let Some(reasoning) = response
        .get("reasoning_content")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        let has_thought_block = trace_blocks
            .iter()
            .any(|block| block.get("type").and_then(|v| v.as_str()) == Some("thought"));
        if !has_thought_block {
            // Append the final round's reasoning AFTER the accumulated tool chain
            // rather than hoisting it to the front. This `reasoning_content` is the
            // final round's thinking, which chronologically happens *after* every
            // tool call already in `trace_blocks`. These blocks are the reload
            // source (meta_info.blocks) and are canonicalized on history reload
            // WITHOUT the live append-time thought-hoist, so a front insert would
            // pin the final thought above all tools on reload — the wrong order.
            // When there are no tool blocks (plain Q&A) push == front insert, so
            // the no-tools path is unchanged.
            trace_blocks.push(serde_json::json!({
                "type": "thought",
                "content": reasoning,
            }));
        }
    }

    if !trace_blocks.is_empty() {
        response["tool_trace_blocks"] = serde_json::Value::Array(trace_blocks);
    }

    if tool_trace_streamed {
        response["tool_trace_streamed"] = serde_json::json!(true);
    }
    runtime_metrics.inject_into_response(&mut response);
    response
}

pub(super) fn strip_stale_resume_response_metadata(
    mut response: serde_json::Value,
) -> serde_json::Value {
    let Some(object) = response.as_object_mut() else {
        return response;
    };
    object.remove("execution_graph");
    object.remove("tool_trace_blocks");
    object.remove("tool_trace_streamed");
    response
}

pub(super) async fn record_query_affinity_from_tool_meta(
    store: &crate::modules::mcp::store::McpStore,
    last_capability_snapshot: Option<&serde_json::Value>,
    tool_meta: &[serde_json::Value],
) {
    let search_query = last_capability_snapshot
        .and_then(|snapshot| snapshot.get("query"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let Some(search_query) = search_query else {
        return;
    };

    for item in tool_meta {
        let status = item
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if !status.eq_ignore_ascii_case("success") {
            continue;
        }
        let tool_name = item
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let Some(tool_name) = tool_name else {
            continue;
        };
        if matches!(
            tool_name,
            "search_sdk"
                | "get_tool_schema"
                | "execute_code_plan"
                | "run_local_code_snippet"
        ) {
            continue;
        }
        let _ = store
            .upsert_tool_query_affinity(&search_query, tool_name)
            .await;
    }
}

pub(super) fn unwrap_nested_tool_result_envelope(value: &serde_json::Value) -> serde_json::Value {
    let mut current = value;
    for _ in 0..6 {
        let Some(object) = current.as_object() else {
            break;
        };
        let looks_like_tool_result_envelope =
            object.get("type").and_then(serde_json::Value::as_str) == Some("tool_result")
                || object.contains_key("callId")
                || object.contains_key("toolName");
        if !looks_like_tool_result_envelope {
            break;
        }
        let Some(next) = object.get("result").filter(|value| !value.is_null()) else {
            break;
        };
        current = next;
    }
    current.clone()
}

pub(super) fn tool_call_meta_matches_call_id(item: &serde_json::Value, call_id: &str) -> bool {
    let expected = call_id.trim();
    if expected.is_empty() {
        return false;
    }

    item.get("id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .is_some_and(|value| value == expected)
}

fn sanitize_tool_call_id_segment(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else if ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let sanitized = sanitized.trim_matches('_');
    if sanitized.is_empty() {
        "tool".to_string()
    } else {
        sanitized.to_string()
    }
}

pub(super) fn resolve_local_tool_call_id(
    raw_call_id: Option<&str>,
    tool_name: &str,
    round: usize,
    call_index: usize,
) -> String {
    raw_call_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "local-missing-call:r{round}:i{call_index}:{}",
                sanitize_tool_call_id_segment(tool_name)
            )
        })
}

pub(super) fn tool_call_meta_with_resolved_ids(
    tool_call_meta: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    tool_call_meta
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let resolved_call_id = resolve_tool_trace_call_id(item, index);
            let mut cloned = item.clone();
            if let Some(object) = cloned.as_object_mut() {
                object.insert("id".to_string(), serde_json::json!(resolved_call_id));
            }
            cloned
        })
        .collect()
}

pub(super) fn build_tool_call_meta_from_execution_graph(
    execution_graph: &serde_json::Value,
) -> Vec<serde_json::Value> {
    let Some(nodes) = execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
    else {
        return Vec::new();
    };

    let mut items = Vec::new();
    for node in nodes {
        let is_tool_call = node
            .get("node_type")
            .and_then(serde_json::Value::as_str)
            .map(|value| value == "tool_call")
            .unwrap_or(false);
        if !is_tool_call {
            continue;
        }

        let call_id = node
            .get("metadata")
            .and_then(|value| value.get("call_id"))
            .and_then(serde_json::Value::as_str)
            .or_else(|| {
                node.get("node_id")
                    .and_then(serde_json::Value::as_str)
                    .and_then(|value| value.strip_prefix("tool_call:"))
            })
            .unwrap_or_default()
            .trim()
            .to_string();
        if call_id.is_empty() {
            continue;
        }

        let tool_name = node
            .get("metadata")
            .and_then(|value| value.get("tool_name"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown_tool")
            .to_string();
        let status = match node
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("success")
        {
            "waiting_approval" => "requires_approval",
            "cancelled" => "error",
            other => other,
        };

        let mut object = serde_json::Map::new();
        object.insert("id".to_string(), serde_json::json!(call_id));
        object.insert("name".to_string(), serde_json::json!(tool_name));
        object.insert("status".to_string(), serde_json::json!(status));

        if let Some(output_payload) = node.get("output_payload") {
            let normalized_output_payload = unwrap_nested_tool_result_envelope(output_payload);
            if status == "error" {
                if let Some(error) = normalized_output_payload.get("error").cloned() {
                    object.insert("error".to_string(), error);
                }
                if let Some(error_code) = normalized_output_payload.get("error_code").cloned() {
                    object.insert("error_code".to_string(), error_code);
                }
            }
            object.insert("result".to_string(), normalized_output_payload);
        }

        items.push(serde_json::Value::Object(object));
    }

    items
}

pub(super) fn build_effective_tool_call_meta(
    response: &serde_json::Value,
    tool_call_meta: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    let graph_tool_call_meta = response
        .get("execution_graph")
        .map(build_tool_call_meta_from_execution_graph)
        .unwrap_or_default();
    let mut effective_tool_call_meta: Vec<serde_json::Value> = graph_tool_call_meta;
    for (index, item) in tool_call_meta.iter().enumerate() {
        let call_id = resolve_tool_trace_call_id(item, index);
        let already_present = effective_tool_call_meta
            .iter()
            .any(|existing| tool_call_meta_matches_call_id(existing, &call_id));
        if !already_present {
            let mut cloned = item.clone();
            if let Some(object) = cloned.as_object_mut() {
                object.insert("id".to_string(), serde_json::json!(call_id));
            }
            effective_tool_call_meta.push(cloned);
        }
    }
    effective_tool_call_meta
}

pub(super) fn build_state_effective_tool_call_meta(
    state: &LocalChatToolRuntimeState,
) -> Vec<serde_json::Value> {
    state
        .last_response
        .as_ref()
        .map(|response| build_effective_tool_call_meta(response, &[]))
        .unwrap_or_default()
}

pub(super) fn derive_pending_call_id_from_tool_call_meta(
    tool_call_meta: &[serde_json::Value],
) -> String {
    tool_call_meta
        .iter()
        .enumerate()
        .rev()
        .map(|(index, item)| resolve_tool_trace_call_id(item, index))
        .find(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "unknown-call".to_string())
}

pub(super) fn last_response_content_or_empty(
    response: Option<&serde_json::Value>,
) -> serde_json::Value {
    response
        .and_then(|value| value.get("content").cloned())
        .unwrap_or_else(|| serde_json::json!(""))
}

pub(super) fn canonicalize_tool_call_meta_via_graph(
    session_id: &str,
    _execution_policy: &LocalExecutionPolicy,
    response: &serde_json::Value,
    tool_call_meta: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    if tool_call_meta.is_empty() {
        return Vec::new();
    }
    let tool_trace_blocks = build_local_tool_trace_blocks(tool_call_meta);
    let graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: session_id.to_string(),
        trace_id: None,
        request_id: None,
        root_execution_id: None,
        response_content: response.get("content").cloned(),
        tool_trace_blocks,
        delegated_execution_tree: None,
    })
    .to_value();
    let canonical = build_tool_call_meta_from_execution_graph(&graph);
    if canonical.is_empty() {
        tool_call_meta.to_vec()
    } else {
        canonical
    }
}

pub(super) fn push_local_tool_call_error_meta(
    tool_call_meta: &mut Vec<serde_json::Value>,
    results: &mut Vec<String>,
    realtime_emitter: &mut LocalRealtimeToolTraceEmitter,
    call_id: Option<&str>,
    tool_name: &str,
    error_code: &str,
    error: impl Into<String>,
) {
    let error = error.into();
    let meta = serde_json::json!({
        "id": call_id
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        "name": tool_name,
        "status": "error",
        "error_code": error_code,
        "error": error,
    });
    let mut streamed_blocks = Vec::new();
    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
    realtime_emitter.emit_blocks(streamed_blocks);
    tool_call_meta.push(meta);
    results.push(format!(
        "Tool call '{}' failed [{}]: {}",
        tool_name, error_code, error
    ));
}

pub(super) fn attach_graph_metadata_to_pending_tool_meta(
    tool_call_meta: &mut [serde_json::Value],
    suspended: &SuspendedChatToolExecution,
) {
    for item in tool_call_meta {
        let Some(call_id) = item
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(object) = item.as_object_mut() else {
            continue;
        };
        let result = object
            .entry("result".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let Some(result_object) = result.as_object_mut() else {
            break;
        };
        if let Some(execution_id) = suspended.graph_execution_id() {
            result_object.insert(
                "execution_graph_execution_id".to_string(),
                serde_json::json!(execution_id),
            );
        }
        if let Some(gate_node_id) = suspended.approval_gate_node_id_for_call_id(&call_id) {
            result_object.insert(
                "execution_graph_gate_node_id".to_string(),
                serde_json::json!(gate_node_id),
            );
        }
        if let Some(tool_node_id) = suspended.tool_node_id_for_call_id(&call_id) {
            result_object.insert(
                "execution_graph_tool_node_id".to_string(),
                serde_json::json!(tool_node_id),
            );
        }
    }
}

fn append_execution_graph_event(
    execution_graph: &mut serde_json::Value,
    node_id: &str,
    event_type: &str,
    payload: serde_json::Value,
) {
    let Some(events) = execution_graph
        .get_mut("events")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return;
    };
    let next_index = events.len();
    events.push(serde_json::json!({
        "event_id": format!("event:resume:{next_index}"),
        "node_id": node_id,
        "event_type": event_type,
        "payload": payload,
    }));
}

fn update_execution_graph_node(
    execution_graph: &mut serde_json::Value,
    node_id: &str,
    status: &str,
    output_payload: Option<serde_json::Value>,
) {
    let Some(nodes) = execution_graph
        .get_mut("nodes")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return;
    };
    for node in nodes {
        let matches = node
            .get("node_id")
            .and_then(serde_json::Value::as_str)
            .map(|value| value == node_id)
            .unwrap_or(false);
        if !matches {
            continue;
        }
        let Some(object) = node.as_object_mut() else {
            break;
        };
        object.insert("status".to_string(), serde_json::json!(status));
        if let Some(output_payload) = output_payload {
            object.insert("output_payload".to_string(), output_payload);
        }
        break;
    }
}

fn update_finalize_node_status(execution_graph: &mut serde_json::Value, status: &str) {
    let Some(nodes) = execution_graph
        .get_mut("nodes")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return;
    };
    for node in nodes {
        let is_finalize = node
            .get("node_type")
            .and_then(serde_json::Value::as_str)
            .map(|value| value == "finalize")
            .unwrap_or(false);
        if !is_finalize {
            continue;
        }
        if let Some(object) = node.as_object_mut() {
            object.insert("status".to_string(), serde_json::json!(status));
        }
        break;
    }
}

fn tool_node_id_from_graph_value(
    execution_graph: &serde_json::Value,
    call_id: Option<&str>,
) -> String {
    let normalized_call_id = call_id.map(str::trim).filter(|value| !value.is_empty());
    execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .and_then(|nodes| {
            nodes.iter().find(|node| {
                if node.get("node_type").and_then(serde_json::Value::as_str) != Some("tool_call") {
                    return false;
                }
                match normalized_call_id {
                    Some(expected) => {
                        node.get("metadata")
                            .and_then(|value| value.get("call_id"))
                            .and_then(serde_json::Value::as_str)
                            .map(str::trim)
                            == Some(expected)
                    }
                    None => true,
                }
            })
        })
        .and_then(|node| node.get("node_id"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("tool_call:unknown")
        .to_string()
}

fn gate_node_id_from_graph_value(
    execution_graph: &serde_json::Value,
    call_id: Option<&str>,
) -> String {
    let normalized_call_id = call_id.map(str::trim).filter(|value| !value.is_empty());
    execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .and_then(|nodes| {
            nodes.iter().find(|node| {
                if node.get("node_type").and_then(serde_json::Value::as_str)
                    != Some("approval_gate")
                {
                    return false;
                }
                match normalized_call_id {
                    Some(expected) => {
                        node.get("metadata")
                            .and_then(|value| value.get("call_id"))
                            .and_then(serde_json::Value::as_str)
                            .map(str::trim)
                            == Some(expected)
                    }
                    None => true,
                }
            })
        })
        .and_then(|node| node.get("node_id"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("approval_gate:unknown")
        .to_string()
}

fn update_finalize_node_status_from_graph(execution_graph: &mut serde_json::Value) {
    let Some(nodes) = execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
    else {
        return;
    };

    let has_pending_approval = nodes.iter().any(|node| {
        node.get("node_type").and_then(serde_json::Value::as_str) == Some("approval_gate")
            && node
                .get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| {
                    matches!(status, "waiting_approval" | "approving" | "approval_failed")
                })
    });

    let next_status = if has_pending_approval {
        "pending"
    } else {
        "success"
    };
    update_finalize_node_status(execution_graph, next_status);
}

fn resolve_approval_graph_node_ids(
    suspended: &SuspendedChatToolExecution,
    approval_token: Option<&str>,
    call_id: Option<&str>,
) -> (String, String, String) {
    let resolved_call_id = call_id
        .unwrap_or(suspended.pending_call_id())
        .trim()
        .to_string();

    if let Some(pending) =
        approval_token.and_then(|token| suspended.pending_approval_by_token(token))
    {
        let gate_node_id = pending
            .execution_graph_gate_node_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                pending
                    .call_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .and_then(|pending_call_id| {
                        suspended.approval_gate_node_id_for_call_id(pending_call_id)
                    })
            })
            .unwrap_or_else(|| suspended.pending_gate_node_id().to_string());
        let tool_node_id = pending
            .execution_graph_tool_node_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                pending
                    .call_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .and_then(|pending_call_id| suspended.tool_node_id_for_call_id(pending_call_id))
            })
            .unwrap_or_else(|| suspended.pending_tool_node_id().to_string());
        let resolved_call_id = pending
            .call_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(resolved_call_id.as_str())
            .to_string();
        return (resolved_call_id, gate_node_id, tool_node_id);
    }

    let gate_node_id = suspended
        .approval_gate_node_id_for_call_id(resolved_call_id.as_str())
        .unwrap_or_else(|| suspended.pending_gate_node_id().to_string());
    let tool_node_id = suspended
        .tool_node_id_for_call_id(resolved_call_id.as_str())
        .unwrap_or_else(|| suspended.pending_tool_node_id().to_string());

    (resolved_call_id, gate_node_id, tool_node_id)
}

pub(crate) fn mark_approval_gate_approving(
    suspended: &mut SuspendedChatToolExecution,
    approval_token: Option<&str>,
    call_id: Option<&str>,
) -> (String, String) {
    let (resolved_call_id, gate_node_id, tool_node_id) =
        resolve_approval_graph_node_ids(suspended, approval_token, call_id);

    update_execution_graph_node(
        &mut suspended.execution_graph,
        gate_node_id.as_str(),
        "approving",
        None,
    );
    update_execution_graph_node(
        &mut suspended.execution_graph,
        tool_node_id.as_str(),
        "running",
        None,
    );
    update_finalize_node_status_from_graph(&mut suspended.execution_graph);
    append_execution_graph_event(
        &mut suspended.execution_graph,
        gate_node_id.as_str(),
        "approval_gate.approving",
        serde_json::json!({
            "call_id": resolved_call_id,
            "execution_graph_gate_node_id": gate_node_id,
            "execution_graph_tool_node_id": tool_node_id,
        }),
    );

    (gate_node_id, tool_node_id)
}

pub(super) fn apply_approved_tool_result_to_execution_graph(
    suspended: &mut SuspendedChatToolExecution,
    approval_token: Option<&str>,
    call_id: Option<&str>,
    tool_result: &serde_json::Value,
) {
    let normalized_tool_result = unwrap_nested_tool_result_envelope(tool_result);
    let (resolved_call_id, gate_node_id, tool_node_id) =
        resolve_approval_graph_node_ids(suspended, approval_token, call_id);

    // Determine if the tool result represents an error so the execution graph
    // accurately reflects the outcome instead of always marking "success".
    let has_error = normalized_tool_result.get("error").is_some()
        || normalized_tool_result
            .get("status")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|s| s.eq_ignore_ascii_case("error"));
    let tool_node_status = if has_error { "error" } else { "success" };
    let gate_node_status = if has_error {
        "approval_failed"
    } else {
        "approved"
    };

    update_execution_graph_node(
        &mut suspended.execution_graph,
        gate_node_id.as_str(),
        gate_node_status,
        Some(normalized_tool_result.clone()),
    );
    update_execution_graph_node(
        &mut suspended.execution_graph,
        tool_node_id.as_str(),
        tool_node_status,
        Some(normalized_tool_result.clone()),
    );
    update_finalize_node_status_from_graph(&mut suspended.execution_graph);
    append_execution_graph_event(
        &mut suspended.execution_graph,
        gate_node_id.as_str(),
        if has_error {
            "approval_gate.approval_failed"
        } else {
            "approval_gate.approved"
        },
        serde_json::json!({
            "call_id": resolved_call_id,
            "execution_graph_gate_node_id": gate_node_id,
            "execution_graph_tool_node_id": tool_node_id,
            "tool_result": normalized_tool_result,
        }),
    );
    append_execution_graph_event(
        &mut suspended.execution_graph,
        tool_node_id.as_str(),
        if has_error {
            "tool_call.approved_result_failed"
        } else {
            "tool_call.approved_result_applied"
        },
        normalized_tool_result,
    );
}

pub(crate) fn apply_rejected_tool_result_to_execution_graph_value(
    execution_graph: &mut serde_json::Value,
    execution_id: Option<&str>,
    call_id: Option<&str>,
    error_message: &str,
) {
    let gate_node_id = gate_node_id_from_graph_value(execution_graph, call_id);
    let tool_node_id = tool_node_id_from_graph_value(execution_graph, call_id);
    let rejection_payload = serde_json::json!({
        "error": error_message,
        "execution_graph_execution_id": execution_id,
        "execution_graph_gate_node_id": gate_node_id,
        "execution_graph_tool_node_id": tool_node_id,
    });
    update_execution_graph_node(
        execution_graph,
        gate_node_id.as_str(),
        "rejected",
        Some(rejection_payload.clone()),
    );
    update_execution_graph_node(
        execution_graph,
        tool_node_id.as_str(),
        "cancelled",
        Some(rejection_payload.clone()),
    );
    update_finalize_node_status(execution_graph, "success");
    append_execution_graph_event(
        execution_graph,
        gate_node_id.as_str(),
        "approval_gate.rejected",
        rejection_payload.clone(),
    );
    append_execution_graph_event(
        execution_graph,
        tool_node_id.as_str(),
        "tool_call.rejected",
        rejection_payload,
    );
}

pub(super) fn canonicalize_tool_name_for_allowed_list(
    tool_name: &str,
    allowed_tool_names: &[String],
) -> Option<String> {
    let normalized = tool_name.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    if allowed_tool_names.iter().any(|item| item == &normalized) {
        return Some(normalized);
    }

    let hyphenated = normalized.replace('_', "-");
    if allowed_tool_names.iter().any(|item| item == &hyphenated) {
        return Some(hyphenated);
    }

    let underscored = normalized.replace('-', "_");
    if allowed_tool_names.iter().any(|item| item == &underscored) {
        return Some(underscored);
    }

    None
}

pub(super) fn summarize_tool_call_meta_results(
    tool_call_meta: &[serde_json::Value],
) -> Vec<String> {
    tool_call_meta
        .iter()
        .map(|item| {
            let tool_name = item
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown_tool");
            let status = item
                .get("status")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown");
            if status.eq_ignore_ascii_case("requires_approval") {
                return format!(
                    "Tool call '{}' requires approval before execution.",
                    tool_name
                );
            }
            if status.eq_ignore_ascii_case("error") {
                let error_code = item
                    .get("error_code")
                    .or_else(|| item.get("errorCode"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("UNKNOWN");
                let error = item
                    .get("error")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        item.get("result")
                            .and_then(|value| value.get("error"))
                            .and_then(serde_json::Value::as_str)
                    })
                    .unwrap_or("tool call failed");
                return format!(
                    "Tool call '{}' failed [{}]: {}",
                    tool_name, error_code, error
                );
            }
            format!("Tool call '{}' executed successfully.", tool_name)
        })
        .collect()
}
