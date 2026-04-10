use super::{
    append_streamable_local_tool_result_blocks, build_local_runtime_tools_with_allowlist,
    build_local_sdk_search_result_bundle_with_feedback_runtime, build_local_tool_trace_blocks,
    build_tool_loop_feedback, delete_execution_graph_runtime_context,
    execute_or_queue_mcp_tool_call_with_tool_ref, extract_chat_tool_calls,
    install_local_skill_from_onboarding_request, list_execution_graph_runtime_contexts,
    load_execution_graph_runtime_context, load_execution_graph_snapshot,
    persist_execution_graph_runtime_context, persist_execution_graph_snapshot,
    project_execution_graph_blocks_from_value, project_execution_graph_snapshot,
    request_provider_chat_completion, resolve_local_capability_activation_state,
    resolve_provider_tool_name_for_execution, resolve_tool_trace_call_id,
    search_feedback::search_feedback_context_from_tool_call_meta, CapabilityExecutionContract,
    GraphProjectionInput, LocalCapabilityActivationState, LocalExecutionPolicy,
    LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
};
use crate::modules::custom_task_agents::service::create_custom_task_agent_service;
use crate::modules::custom_task_agents::types::CreateCustomTaskAgentRequest;
use crate::modules::desktop_config::{parse_max_agentic_rounds, MAX_AGENTIC_ROUNDS_CONFIG_KEY};
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::mcp::commands::common_impl::LocalModelConnection;
use crate::modules::mcp::commands::support::*;
use mcp_session::conversation::CreateConversationMessageRequest;

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
struct RuntimeMetricsAccumulator {
    upstream_latency_ms: i64,
    upstream_calls: i64,
    ttft_ms: Option<i64>,
}

impl RuntimeMetricsAccumulator {
    fn observe_response(&mut self, response: &serde_json::Value) {
        let metrics = response
            .get("runtime_metrics")
            .and_then(|value| value.as_object());
        let latency = metrics
            .and_then(|value| value.get("upstream_latency_ms"))
            .and_then(|value| value.as_i64())
            .filter(|value| *value > 0)
            .unwrap_or(0);
        let calls = metrics
            .and_then(|value| value.get("upstream_calls"))
            .and_then(|value| value.as_i64())
            .filter(|value| *value > 0)
            .unwrap_or(if latency > 0 { 1 } else { 0 });
        if latency > 0 {
            self.upstream_latency_ms = self.upstream_latency_ms.saturating_add(latency);
            self.upstream_calls = self.upstream_calls.saturating_add(calls.max(1));
        }
        if self.ttft_ms.is_none() {
            self.ttft_ms = metrics
                .and_then(|value| value.get("ttft_ms"))
                .and_then(|value| value.as_i64())
                .filter(|value| *value > 0);
        }
    }

    fn inject_into_response(&self, response: &mut serde_json::Value) {
        if self.upstream_latency_ms <= 0 && self.ttft_ms.is_none() {
            return;
        }
        let Some(object) = response.as_object_mut() else {
            return;
        };
        let mut metrics = object
            .get("runtime_metrics")
            .and_then(|value| value.as_object())
            .cloned()
            .unwrap_or_default();
        if self.upstream_latency_ms > 0 {
            metrics.insert(
                "upstream_latency_ms".to_string(),
                serde_json::json!(self.upstream_latency_ms),
            );
        }
        if self.upstream_calls > 0 {
            metrics.insert(
                "upstream_calls".to_string(),
                serde_json::json!(self.upstream_calls),
            );
        }
        if let Some(ttft_ms) = self.ttft_ms.filter(|value| *value > 0) {
            metrics.insert("ttft_ms".to_string(), serde_json::json!(ttft_ms));
        }
        if !metrics.is_empty() {
            object.insert(
                "runtime_metrics".to_string(),
                serde_json::Value::Object(metrics),
            );
        }
    }
}

enum LocalToolCallProcessingOutcome {
    Completed {
        synthesized: bool,
        tool_call_meta: Vec<serde_json::Value>,
        results: Vec<String>,
    },
    Interrupted {
        approval_tokens: Vec<String>,
        tool_call_meta: Vec<serde_json::Value>,
        results: Vec<String>,
        capability_update: Option<LocalCapabilityTransition>,
    },
}

struct LocalChatToolRuntimeState {
    max_rounds: usize,
    round: usize,
    trace_id: String,
    request_id: Option<String>,
    execution_policy: LocalExecutionPolicy,
    model_connection: LocalModelConnection,
    orchestrated_messages: Vec<LocalChatInputMessage>,
    session_id: String,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    active_capability: Option<LocalCapabilityActivationState>,
    runtime_metrics: RuntimeMetricsAccumulator,
    last_capability_snapshot: Option<serde_json::Value>,
    last_response: Option<serde_json::Value>,
    realtime_emitter: LocalRealtimeToolTraceEmitter,
}

struct LocalChatToolRuntimeOutput {
    response: serde_json::Value,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PersistedChatToolRuntimeContext {
    max_rounds: usize,
    round: usize,
    trace_id: String,
    request_id: Option<String>,
    execution_policy: LocalExecutionPolicy,
    model_connection: LocalModelConnection,
    orchestrated_messages: Vec<LocalChatInputMessage>,
    session_id: String,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    active_capability: Option<LocalCapabilityActivationState>,
    runtime_metrics: RuntimeMetricsAccumulator,
    last_capability_snapshot: Option<serde_json::Value>,
    last_response: Option<serde_json::Value>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InFlightExecutionStage {
    ToolRunning,
    WaitingApproval,
    DelegatedWorkflowRunning,
    Interrupted,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PersistedPendingApproval {
    approval_token: String,
    tool_id: Option<String>,
    tool_name: String,
    arguments: serde_json::Value,
    call_id: Option<String>,
    execution_token: Option<String>,
    session_id: Option<String>,
    description: Option<String>,
    risk_level: Option<String>,
    risk_reasons: Vec<String>,
    tool_fingerprint: String,
    policy_rule_key: Option<String>,
    approval_grant_key: Option<String>,
    execution_graph_execution_id: Option<String>,
    execution_graph_gate_node_id: Option<String>,
    execution_graph_tool_node_id: Option<String>,
    created_at_unix_ms: i128,
    expires_at_unix_ms: i128,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PersistedInFlightExecutionContext {
    schema_version: i64,
    session_id: String,
    trace_id: String,
    request_id: Option<String>,
    execution_graph_execution_id: Option<String>,
    stage: InFlightExecutionStage,
    current_node: Option<String>,
    current_call_id: Option<String>,
    workflow_run_id: Option<String>,
    started_at_unix_ms: i64,
    last_heartbeat_at_unix_ms: i64,
    recoverable: bool,
    pending_approvals: Vec<PersistedPendingApproval>,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    recovery_notice_emitted_at_unix_ms: Option<i64>,
}

fn runtime_state_from_persisted_context(
    context: PersistedChatToolRuntimeContext,
) -> LocalChatToolRuntimeState {
    LocalChatToolRuntimeState {
        max_rounds: context.max_rounds,
        round: context.round,
        trace_id: context.trace_id,
        request_id: context.request_id,
        execution_policy: context.execution_policy,
        model_connection: context.model_connection,
        orchestrated_messages: context.orchestrated_messages,
        session_id: context.session_id,
        temperature: context.temperature,
        max_tokens: context.max_tokens,
        active_capability: context.active_capability,
        runtime_metrics: context.runtime_metrics,
        last_capability_snapshot: context.last_capability_snapshot,
        last_response: context.last_response,
        realtime_emitter: LocalRealtimeToolTraceEmitter::new(None, None, None),
    }
}

fn now_unix_ms_i64() -> i64 {
    (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

fn build_pending_approval_records(
    pending_tool_calls: &std::collections::HashMap<String, crate::modules::mcp::PendingToolCall>,
    approval_tokens: &[String],
) -> Vec<PersistedPendingApproval> {
    approval_tokens
        .iter()
        .filter_map(|approval_token| {
            let pending = pending_tool_calls.get(approval_token)?;
            Some(PersistedPendingApproval {
                approval_token: approval_token.clone(),
                tool_id: pending.tool_id.clone(),
                tool_name: pending.tool_name.clone(),
                arguments: pending.arguments.clone(),
                call_id: pending.call_id.clone(),
                execution_token: pending.execution_token.clone(),
                session_id: pending.session_id.clone(),
                description: pending.description.clone(),
                risk_level: pending.risk_level.clone(),
                risk_reasons: pending.risk_reasons.clone(),
                tool_fingerprint: pending.tool_fingerprint.clone(),
                policy_rule_key: pending.policy_rule_key.clone(),
                approval_grant_key: pending.approval_grant_key.clone(),
                execution_graph_execution_id: pending.execution_graph_execution_id.clone(),
                execution_graph_gate_node_id: pending.execution_graph_gate_node_id.clone(),
                execution_graph_tool_node_id: pending.execution_graph_tool_node_id.clone(),
                created_at_unix_ms: pending.created_at_unix_ms,
                expires_at_unix_ms: pending.expires_at_unix_ms,
            })
        })
        .collect()
}

fn persistable_inflight_context_from_value(
    value: &serde_json::Value,
) -> Option<PersistedInFlightExecutionContext> {
    serde_json::from_value::<PersistedInFlightExecutionContext>(value.clone()).ok()
}

#[derive(Debug, Clone)]
struct CanonicalPendingLocalApprovalMatch {
    execution_id: String,
    pending: PersistedPendingApproval,
}

fn canonical_waiting_approval_context(
    context: serde_json::Value,
    execution_id: &str,
    session_id: Option<&str>,
) -> Option<PersistedInFlightExecutionContext> {
    let persisted = persistable_inflight_context_from_value(&context)?;
    if persisted.stage != InFlightExecutionStage::WaitingApproval {
        return None;
    }
    if let Some(expected_session_id) = session_id {
        if persisted.session_id.trim() != expected_session_id {
            return None;
        }
    }
    let normalized_execution_id = execution_id.trim();
    if normalized_execution_id.is_empty() {
        return None;
    }
    Some(persisted)
}

async fn load_canonical_waiting_approval_context_by_execution_id(
    store: &crate::modules::mcp::store::McpStore,
    execution_id: &str,
    session_id: Option<&str>,
) -> Result<Option<(String, PersistedInFlightExecutionContext)>, String> {
    let normalized_execution_id = execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Ok(None);
    }
    let Some(context) = load_execution_graph_runtime_context(store, normalized_execution_id)
        .await
        .map_err(|err| err.to_string())?
    else {
        return Ok(None);
    };
    Ok(
        canonical_waiting_approval_context(context, normalized_execution_id, session_id)
            .map(|persisted| (normalized_execution_id.to_string(), persisted)),
    )
}

async fn list_canonical_waiting_approval_contexts(
    store: &crate::modules::mcp::store::McpStore,
    session_id: Option<&str>,
) -> Result<Vec<(String, PersistedInFlightExecutionContext)>, String> {
    let rows = list_execution_graph_runtime_contexts(store)
        .await
        .map_err(|err| err.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            canonical_waiting_approval_context(row.context, row.execution_id.as_str(), session_id)
                .map(|persisted| (row.execution_id, persisted))
        })
        .collect())
}

fn pending_approval_snapshot_from_canonical_match(
    matched: &CanonicalPendingLocalApprovalMatch,
    now_unix_ms: i128,
) -> serde_json::Value {
    serde_json::json!({
        "status": "REQUIRES_APPROVAL",
        "approval_token": matched.pending.approval_token.clone(),
        "tool_id": matched.pending.tool_id.clone(),
        "tool_name": matched.pending.tool_name.clone(),
        "arguments": matched.pending.arguments.clone(),
        "description": matched.pending.description.clone(),
        "risk_level": matched.pending.risk_level.clone().unwrap_or_else(|| "HIGH".to_string()),
        "risk_reasons": matched.pending.risk_reasons.clone(),
        "call_id": matched.pending.call_id.clone(),
        "execution_token": matched.pending.execution_token.clone(),
        "session_id": matched.pending.session_id.clone(),
        "created_at_unix_ms": matched.pending.created_at_unix_ms,
        "expires_at_unix_ms": matched.pending.expires_at_unix_ms,
        "expires_in_ms": matched.pending.expires_at_unix_ms.saturating_sub(now_unix_ms),
        "execution_graph_execution_id": matched
            .pending
            .execution_graph_execution_id
            .clone()
            .or_else(|| Some(matched.execution_id.clone())),
        "execution_graph_gate_node_id": matched.pending.execution_graph_gate_node_id.clone(),
        "execution_graph_tool_node_id": matched.pending.execution_graph_tool_node_id.clone(),
    })
}

async fn find_canonical_pending_local_approval_match(
    store: &crate::modules::mcp::store::McpStore,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
) -> Result<Option<CanonicalPendingLocalApprovalMatch>, String> {
    let normalized_token = approval_token.trim();
    if normalized_token.is_empty() {
        return Ok(None);
    }

    let contexts = if let Some(execution_id) = execution_graph_execution_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        load_canonical_waiting_approval_context_by_execution_id(store, execution_id, None)
            .await?
            .into_iter()
            .collect::<Vec<_>>()
    } else {
        list_canonical_waiting_approval_contexts(store, None).await?
    };

    for (execution_id, context) in contexts {
        for pending in &context.pending_approvals {
            if pending.approval_token.trim() != normalized_token {
                continue;
            }
            return Ok(Some(CanonicalPendingLocalApprovalMatch {
                execution_id,
                pending: pending.clone(),
            }));
        }
    }

    Ok(None)
}

pub(crate) async fn list_canonical_pending_local_approval_snapshots(
    store: &crate::modules::mcp::store::McpStore,
    session_id: Option<&str>,
) -> Result<Vec<serde_json::Value>, String> {
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let contexts = list_canonical_waiting_approval_contexts(store, session_id).await?;
    let mut snapshots = Vec::new();

    for (execution_id, context) in contexts {
        for pending in &context.pending_approvals {
            if pending.expires_at_unix_ms <= now as i128 {
                continue;
            }
            snapshots.push(pending_approval_snapshot_from_canonical_match(
                &CanonicalPendingLocalApprovalMatch {
                    execution_id: execution_id.clone(),
                    pending: pending.clone(),
                },
                now as i128,
            ));
        }
    }

    snapshots.sort_by(|left, right| {
        let left_created = left
            .get("created_at_unix_ms")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or_default();
        let right_created = right
            .get("created_at_unix_ms")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or_default();
        right_created.cmp(&left_created)
    });

    Ok(snapshots)
}

pub(crate) async fn materialize_pending_local_approval_from_runtime_context(
    app_state: &AppState,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
) -> Result<Option<crate::modules::mcp::PendingToolCall>, String> {
    let normalized_token = approval_token.trim();
    if normalized_token.is_empty() {
        return Ok(None);
    }

    let Some(matched) = find_canonical_pending_local_approval_match(
        app_state.mcp.store.as_ref(),
        normalized_token,
        execution_graph_execution_id,
    )
    .await?
    else {
        return Ok(app_state
            .mcp
            .approvals
            .pending_tool_calls
            .read()
            .await
            .get(normalized_token)
            .cloned());
    };

    let expires_at_unix_ms = (now_unix_ms_i64() as i128) + app_state.mcp.pending_tool_call_ttl_ms();
    let materialized = pending_tool_call_from_persisted_approval(
        &matched.pending,
        Some(matched.execution_id.as_str()),
        expires_at_unix_ms,
    );

    let mut pending_tool_calls = app_state.mcp.approvals.pending_tool_calls.write().await;
    let entry = pending_tool_calls
        .entry(normalized_token.to_string())
        .or_insert_with(|| materialized.clone());
    *entry = materialized;
    Ok(Some(entry.clone()))
}

fn enrich_response_with_tool_trace(
    mut response: serde_json::Value,
    tool_call_meta: &[serde_json::Value],
    tool_trace_streamed: bool,
    runtime_metrics: &RuntimeMetricsAccumulator,
) -> serde_json::Value {
    if !tool_call_meta.is_empty() {
        response["tool_trace_blocks"] =
            serde_json::Value::Array(build_local_tool_trace_blocks(tool_call_meta));
    } else if response.get("tool_trace_blocks").is_none() {
        if let Some(execution_graph) = response.get("execution_graph") {
            let graph_blocks = project_execution_graph_blocks_from_value(execution_graph);
            if !graph_blocks.is_empty() {
                response["tool_trace_blocks"] = serde_json::Value::Array(graph_blocks);
            }
        }
    }
    if tool_trace_streamed {
        response["tool_trace_streamed"] = serde_json::json!(true);
    }
    runtime_metrics.inject_into_response(&mut response);
    response
}

fn strip_stale_resume_response_metadata(mut response: serde_json::Value) -> serde_json::Value {
    let Some(object) = response.as_object_mut() else {
        return response;
    };
    object.remove("execution_graph");
    object.remove("tool_trace_blocks");
    object.remove("tool_trace_streamed");
    response
}

async fn record_query_affinity_from_tool_meta(
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
                | "attach_capability"
                | "detach_capability"
        ) {
            continue;
        }
        let _ = store
            .upsert_tool_query_affinity(&search_query, tool_name)
            .await;
    }
}

fn tool_call_meta_matches_call_id(item: &serde_json::Value, call_id: &str) -> bool {
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

fn resolve_local_tool_call_id(
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

fn tool_call_meta_with_resolved_ids(
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

fn build_tool_call_meta_from_execution_graph(
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

        if let Some(output_payload) = node.get("output_payload").cloned() {
            if status == "error" {
                if let Some(error) = output_payload.get("error").cloned() {
                    object.insert("error".to_string(), error);
                }
                if let Some(error_code) = output_payload.get("error_code").cloned() {
                    object.insert("error_code".to_string(), error_code);
                }
            }
            object.insert("result".to_string(), output_payload);
        }

        items.push(serde_json::Value::Object(object));
    }

    items
}

fn build_effective_tool_call_meta(
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

fn build_state_effective_tool_call_meta(
    state: &LocalChatToolRuntimeState,
) -> Vec<serde_json::Value> {
    state
        .last_response
        .as_ref()
        .map(|response| build_effective_tool_call_meta(response, &[]))
        .unwrap_or_default()
}

fn derive_pending_call_id_from_tool_call_meta(tool_call_meta: &[serde_json::Value]) -> String {
    tool_call_meta
        .iter()
        .enumerate()
        .rev()
        .map(|(index, item)| resolve_tool_trace_call_id(item, index))
        .find(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "unknown-call".to_string())
}

fn last_response_content_or_empty(response: Option<&serde_json::Value>) -> serde_json::Value {
    response
        .and_then(|value| value.get("content").cloned())
        .unwrap_or_else(|| serde_json::json!(""))
}

fn canonicalize_tool_call_meta_via_graph(
    session_id: &str,
    execution_policy: &LocalExecutionPolicy,
    response: &serde_json::Value,
    tool_call_meta: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    if tool_call_meta.is_empty() {
        return Vec::new();
    }
    let tool_trace_blocks = build_local_tool_trace_blocks(tool_call_meta);
    let graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: session_id.to_string(),
        route: execution_policy.route.as_str().to_string(),
        plane: execution_policy.plane.as_str().to_string(),
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

fn push_local_tool_call_error_meta(
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

fn attach_graph_metadata_to_pending_tool_meta(
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

fn apply_approved_tool_result_to_execution_graph(
    suspended: &mut SuspendedChatToolExecution,
    call_id: Option<&str>,
    tool_result: &serde_json::Value,
) {
    let gate_node_id = suspended
        .approval_gate_node_id_for_call_id(call_id.unwrap_or(suspended.pending_call_id()))
        .unwrap_or_else(|| suspended.pending_gate_node_id().to_string());
    let tool_node_id = suspended
        .tool_node_id_for_call_id(call_id.unwrap_or(suspended.pending_call_id()))
        .unwrap_or_else(|| suspended.pending_tool_node_id().to_string());
    update_execution_graph_node(
        &mut suspended.execution_graph,
        gate_node_id.as_str(),
        "success",
        Some(tool_result.clone()),
    );
    update_execution_graph_node(
        &mut suspended.execution_graph,
        tool_node_id.as_str(),
        "success",
        Some(tool_result.clone()),
    );
    update_finalize_node_status(&mut suspended.execution_graph, "pending");
    append_execution_graph_event(
        &mut suspended.execution_graph,
        gate_node_id.as_str(),
        "approval_gate.approved",
        tool_result.clone(),
    );
    append_execution_graph_event(
        &mut suspended.execution_graph,
        tool_node_id.as_str(),
        "tool_call.approved_result_applied",
        tool_result.clone(),
    );
}

pub(crate) fn apply_rejected_tool_result_to_execution_graph(
    suspended: &mut SuspendedChatToolExecution,
    call_id: Option<&str>,
    error_message: &str,
) {
    let execution_id = suspended.graph_execution_id().map(str::to_string);
    apply_rejected_tool_result_to_execution_graph_value(
        &mut suspended.execution_graph,
        execution_id.as_deref(),
        call_id,
        error_message,
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
        "cancelled",
        Some(rejection_payload.clone()),
    );
    update_execution_graph_node(
        execution_graph,
        tool_node_id.as_str(),
        "cancelled",
        Some(rejection_payload.clone()),
    );
    update_finalize_node_status(execution_graph, "cancelled");
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

pub(crate) fn serialize_inflight_runtime_context(
    stage: InFlightExecutionStage,
    current_node: Option<String>,
    current_call_id: Option<String>,
    workflow_run_id: Option<String>,
    recoverable: bool,
    pending_approvals: Vec<PersistedPendingApproval>,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    session_id: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
) -> serde_json::Value {
    serde_json::to_value(PersistedInFlightExecutionContext {
        schema_version: 1,
        session_id: session_id.to_string(),
        trace_id: trace_id.to_string(),
        request_id: request_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        execution_graph_execution_id: execution_graph_execution_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        stage,
        current_node,
        current_call_id,
        workflow_run_id,
        started_at_unix_ms: now_unix_ms_i64(),
        last_heartbeat_at_unix_ms: now_unix_ms_i64(),
        recoverable,
        pending_approvals,
        chat_runtime,
        recovery_notice_emitted_at_unix_ms: None,
    })
    .unwrap_or_else(|_| serde_json::json!({}))
}

async fn persist_running_tool_execution_runtime(
    store: &crate::modules::mcp::store::McpStore,
    state: &LocalChatToolRuntimeState,
    call_id: &str,
    tool_name: &str,
    tool_args: &serde_json::Value,
) -> Result<Option<String>, String> {
    let normalized_call_id = call_id.trim();
    if normalized_call_id.is_empty() {
        return Ok(None);
    }

    let mut tool_trace_blocks =
        build_local_tool_trace_blocks(&build_state_effective_tool_call_meta(state));
    tool_trace_blocks.push(serde_json::json!({
        "type": "tool_call",
        "callId": normalized_call_id,
        "toolName": tool_name,
        "toolArgs": tool_args,
        "status": "running",
    }));

    let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: state.session_id.clone(),
        route: state.execution_policy.route.as_str().to_string(),
        plane: state.execution_policy.plane.as_str().to_string(),
        trace_id: Some(state.trace_id.clone()),
        request_id: state.request_id.clone(),
        root_execution_id: None,
        response_content: state
            .last_response
            .as_ref()
            .and_then(|response| response.get("content").cloned()),
        tool_trace_blocks,
        delegated_execution_tree: None,
    })
    .to_value();
    let execution_id = execution_graph
        .get("execution_id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    persist_execution_graph_snapshot(
        store,
        &execution_graph,
        state.session_id.as_str(),
        "desktop_local_chat_tool_running",
        state.request_id.as_deref(),
        Some("active"),
    )
    .await
    .map_err(|err| err.to_string())?;

    if let Some(execution_id) = execution_id.as_deref() {
        let context = serialize_inflight_runtime_context(
            InFlightExecutionStage::ToolRunning,
            Some(format!("tool_call:{normalized_call_id}")),
            Some(normalized_call_id.to_string()),
            None,
            true,
            Vec::new(),
            Some(PersistedChatToolRuntimeContext {
                max_rounds: state.max_rounds,
                round: state.round,
                trace_id: state.trace_id.clone(),
                request_id: state.request_id.clone(),
                execution_policy: state.execution_policy.clone(),
                model_connection: state.model_connection.clone(),
                orchestrated_messages: state.orchestrated_messages.clone(),
                session_id: state.session_id.clone(),
                temperature: state.temperature,
                max_tokens: state.max_tokens,
                active_capability: state.active_capability.clone(),
                runtime_metrics: state.runtime_metrics.clone(),
                last_capability_snapshot: state.last_capability_snapshot.clone(),
                last_response: state.last_response.clone(),
            }),
            state.session_id.as_str(),
            state.trace_id.as_str(),
            state.request_id.as_deref(),
            Some(execution_id),
        );
        persist_execution_graph_runtime_context(store, execution_id, &context)
            .await
            .map_err(|err| err.to_string())?;
    }

    Ok(execution_id)
}

async fn persist_suspended_execution_graph_runtime(
    store: &crate::modules::mcp::store::McpStore,
    suspended: &SuspendedChatToolExecution,
    pending_approvals: &[PersistedPendingApproval],
    source_kind: &str,
    status: &str,
) -> Result<(), String> {
    persist_execution_graph_snapshot(
        store,
        suspended.execution_graph(),
        suspended.session_id.as_str(),
        source_kind,
        suspended.request_id.as_deref(),
        Some(status),
    )
    .await
    .map_err(|err| err.to_string())?;

    if let Some(execution_id) = suspended.graph_execution_id() {
        let context = serialize_inflight_runtime_context(
            InFlightExecutionStage::WaitingApproval,
            Some(suspended.pending_gate_node_id().to_string()),
            Some(suspended.pending_call_id().to_string()),
            None,
            true,
            pending_approvals.to_vec(),
            Some(PersistedChatToolRuntimeContext {
                max_rounds: suspended.max_rounds,
                round: suspended.round,
                trace_id: suspended.trace_id.clone(),
                request_id: suspended.request_id.clone(),
                execution_policy: suspended.execution_policy.clone(),
                model_connection: suspended.model_connection.clone(),
                orchestrated_messages: suspended.orchestrated_messages.clone(),
                session_id: suspended.session_id.clone(),
                temperature: suspended.temperature,
                max_tokens: suspended.max_tokens,
                active_capability: suspended.active_capability.clone(),
                runtime_metrics: suspended.runtime_metrics.clone(),
                last_capability_snapshot: suspended.last_capability_snapshot.clone(),
                last_response: suspended.last_response.clone(),
            }),
            suspended.session_id.as_str(),
            suspended.trace_id.as_str(),
            suspended.request_id.as_deref(),
            Some(execution_id),
        );
        persist_execution_graph_runtime_context(store, execution_id, &context)
            .await
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

async fn clear_execution_graph_runtime_context(
    store: &crate::modules::mcp::store::McpStore,
    execution_id: Option<&str>,
) {
    let Some(execution_id) = execution_id else {
        return;
    };
    if let Err(err) = delete_execution_graph_runtime_context(store, execution_id).await {
        log::warn!(
            "delete_execution_graph_runtime_context failed execution_id={} err={}",
            execution_id,
            err
        );
    }
}

#[derive(Clone)]
pub(crate) struct SuspendedChatToolExecution {
    max_rounds: usize,
    round: usize,
    trace_id: String,
    request_id: Option<String>,
    execution_policy: LocalExecutionPolicy,
    model_connection: LocalModelConnection,
    orchestrated_messages: Vec<LocalChatInputMessage>,
    session_id: String,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    active_capability: Option<LocalCapabilityActivationState>,
    runtime_metrics: RuntimeMetricsAccumulator,
    last_capability_snapshot: Option<serde_json::Value>,
    last_response: Option<serde_json::Value>,
    execution_graph: serde_json::Value,
}

impl SuspendedChatToolExecution {
    fn from_state(
        state: &LocalChatToolRuntimeState,
        pending_tool_call_meta: &[serde_json::Value],
        _pending_results: &[String],
        _pending_capability_update: Option<LocalCapabilityTransition>,
        _pending_call_id: String,
        _pending_tool_name: String,
    ) -> Self {
        let tool_trace_blocks = build_local_tool_trace_blocks(pending_tool_call_meta);
        let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
            session_id: state.session_id.clone(),
            route: state.execution_policy.route.as_str().to_string(),
            plane: state.execution_policy.plane.as_str().to_string(),
            trace_id: Some(state.trace_id.clone()),
            request_id: state.request_id.clone(),
            root_execution_id: None,
            response_content: state
                .last_response
                .as_ref()
                .and_then(|response| response.get("content").cloned()),
            tool_trace_blocks,
            delegated_execution_tree: None,
        })
        .to_value();
        Self {
            max_rounds: state.max_rounds,
            round: state.round,
            trace_id: state.trace_id.clone(),
            request_id: state.request_id.clone(),
            execution_policy: state.execution_policy.clone(),
            model_connection: state.model_connection.clone(),
            orchestrated_messages: state.orchestrated_messages.clone(),
            session_id: state.session_id.clone(),
            temperature: state.temperature,
            max_tokens: state.max_tokens,
            active_capability: state.active_capability.clone(),
            runtime_metrics: state.runtime_metrics.clone(),
            last_capability_snapshot: state.last_capability_snapshot.clone(),
            last_response: state.last_response.clone(),
            execution_graph,
        }
    }

    fn into_runtime_state(self) -> LocalChatToolRuntimeState {
        LocalChatToolRuntimeState {
            max_rounds: self.max_rounds,
            round: self.round,
            trace_id: self.trace_id.clone(),
            request_id: self.request_id.clone(),
            execution_policy: self.execution_policy,
            model_connection: self.model_connection,
            orchestrated_messages: self.orchestrated_messages,
            session_id: self.session_id,
            temperature: self.temperature,
            max_tokens: self.max_tokens,
            active_capability: self.active_capability,
            runtime_metrics: self.runtime_metrics,
            last_capability_snapshot: self.last_capability_snapshot,
            last_response: self.last_response,
            realtime_emitter: LocalRealtimeToolTraceEmitter::new(
                None,
                Some(self.trace_id.as_str()),
                self.request_id.as_deref(),
            ),
        }
    }

    pub(crate) fn graph_execution_id(&self) -> Option<&str> {
        self.execution_graph
            .get("execution_id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    pub(crate) fn pending_tool_node_id(&self) -> &str {
        self.execution_graph
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .and_then(|nodes| {
                nodes.iter().find(|node| {
                    node.get("node_type").and_then(serde_json::Value::as_str) == Some("tool_call")
                })
            })
            .and_then(|node| node.get("node_id"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("tool_call:unknown")
    }

    pub(crate) fn tool_node_id_for_call_id(&self, call_id: &str) -> Option<String> {
        let normalized_call_id = call_id.trim();
        if normalized_call_id.is_empty() {
            return None;
        }
        self.execution_graph
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .and_then(|nodes| {
                nodes.iter().find(|node| {
                    node.get("node_type").and_then(serde_json::Value::as_str) == Some("tool_call")
                        && node
                            .get("metadata")
                            .and_then(|value| value.get("call_id"))
                            .and_then(serde_json::Value::as_str)
                            .map(str::trim)
                            == Some(normalized_call_id)
                })
            })
            .and_then(|node| node.get("node_id"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    }

    pub(crate) fn pending_gate_node_id(&self) -> &str {
        self.execution_graph
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .and_then(|nodes| {
                nodes.iter().find(|node| {
                    node.get("node_type").and_then(serde_json::Value::as_str)
                        == Some("approval_gate")
                })
            })
            .and_then(|node| node.get("node_id"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("approval_gate:unknown")
    }

    pub(crate) fn approval_gate_node_id_for_call_id(&self, call_id: &str) -> Option<String> {
        let normalized_call_id = call_id.trim();
        if normalized_call_id.is_empty() {
            return None;
        }
        self.execution_graph
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .and_then(|nodes| {
                nodes.iter().find(|node| {
                    node.get("node_type").and_then(serde_json::Value::as_str)
                        == Some("approval_gate")
                        && node
                            .get("metadata")
                            .and_then(|value| value.get("call_id"))
                            .and_then(serde_json::Value::as_str)
                            .map(str::trim)
                            == Some(normalized_call_id)
                })
            })
            .and_then(|node| node.get("node_id"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    }

    fn pending_call_id(&self) -> &str {
        self.pending_tool_node_id()
            .strip_prefix("tool_call:")
            .unwrap_or(self.pending_tool_node_id())
    }

    pub(crate) fn execution_graph(&self) -> &serde_json::Value {
        &self.execution_graph
    }

    fn pending_tool_call_meta(&self) -> Vec<serde_json::Value> {
        build_tool_call_meta_from_execution_graph(&self.execution_graph)
    }

    fn pending_requires_approval_call_ids(&self) -> Vec<String> {
        self.pending_tool_call_meta()
            .into_iter()
            .filter(|item| {
                item.get("status")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|status| status.eq_ignore_ascii_case("requires_approval"))
            })
            .filter_map(|item| {
                item.get("id")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .collect()
    }
}

pub(crate) async fn run_local_chat_complete_with_tools(
    app: &AppHandle,
    app_state: &AppState,
    model_connection: &LocalModelConnection,
    messages: Vec<LocalChatInputMessage>,
    chat_ctx: &LocalConversationChatContext,
    execution_policy: &LocalExecutionPolicy,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    event_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    trace_id: Option<&str>,
    request_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let configured_max_rounds = app_state
        .mcp
        .store
        .get_desktop_config(MAX_AGENTIC_ROUNDS_CONFIG_KEY)
        .await
        .ok()
        .flatten();
    let max_rounds = parse_max_agentic_rounds(configured_max_rounds.as_deref());
    let trace_id = trace_id
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut orchestrated_messages = messages;
    if execution_policy.inject_execution_protocol
        && !orchestrated_messages
            .first()
            .map(|m| m.role == "system")
            .unwrap_or(false)
    {
        orchestrated_messages.insert(0, LocalChatInputMessage {
            role: "system".to_string(),
            content: concat!(
                "## Desktop Execution Tools\n",
                "- Environment: Deeting Desktop local runtime\n",
                "When the user asks to install, create, or manage skills:\n",
                "- Deeting skills are capability bundles centered on SKILL.md, deeting.json, and callable tool bindings derived from llm-tool.yaml when present.\n",
                "- Use the install_skill_from_repo tool or sys_submit_onboarding_request to install skills.\n",
                "- After external or manual skill installs, use refresh_skill_index to rescan shared and managed skill directories.\n",
                "- User skills directory: $APP_DATA_DIR/skills/<skill_id>/.\n",
                "- Shared agent skills directory: ~/.agents/skills/.\n",
            ).to_string(),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        });
    }

    let state = LocalChatToolRuntimeState {
        max_rounds,
        round: 0,
        trace_id: trace_id.clone(),
        request_id: request_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        execution_policy: execution_policy.clone(),
        model_connection: model_connection.clone(),
        orchestrated_messages,
        session_id: chat_ctx.session_id.clone(),
        temperature,
        max_tokens,
        active_capability: None,
        runtime_metrics: RuntimeMetricsAccumulator::default(),
        last_capability_snapshot: execution_policy.capability_snapshot.clone(),
        last_response: None,
        realtime_emitter: LocalRealtimeToolTraceEmitter::new(
            event_tx,
            Some(trace_id.as_str()),
            request_id,
        ),
    };
    continue_local_chat_complete_with_tools(app, app_state, state)
        .await
        .map(|output| output.response)
}

#[derive(Debug, Clone)]
enum LocalCapabilityTransition {
    Activate(LocalCapabilityActivationState),
    Deactivate {
        _capability_id: Option<String>,
        capability_name: Option<String>,
    },
}

async fn continue_local_chat_complete_with_tools(
    app: &AppHandle,
    app_state: &AppState,
    mut state: LocalChatToolRuntimeState,
) -> Result<LocalChatToolRuntimeOutput, String> {
    let session_id = state.session_id.clone();
    let provider_model_id = state.model_connection.provider_model_id.clone();
    let model_id = state.model_connection.model_id.clone();

    loop {
        state.round = state.round.saturating_add(1);
        if state.round > state.max_rounds {
            log::warn!(
                "agentic loop exceeded {} rounds, returning explicit stop response",
                state.max_rounds
            );
            let effective_tool_call_meta = build_state_effective_tool_call_meta(&state);
            let fallback = build_max_rounds_exceeded_response(&state);
            return Ok(LocalChatToolRuntimeOutput {
                response: enrich_response_with_tool_trace(
                    fallback,
                    &effective_tool_call_meta,
                    state.realtime_emitter.emitted_any,
                    &state.runtime_metrics,
                ),
            });
        }

        let effective_allowed_tool_names = state
            .execution_policy
            .effective_allowed_tool_names(state.last_capability_snapshot.as_ref());
        let tools = build_local_runtime_tools_with_allowlist(
            &effective_allowed_tool_names,
            state.last_capability_snapshot.as_ref(),
        );
        let response = request_provider_chat_completion(
            app_state,
            &provider_model_id,
            &model_id,
            state.orchestrated_messages.clone(),
            tools,
            state.temperature,
            state.max_tokens,
            Some(state.trace_id.as_str()),
            Some(session_id.as_str()),
        )
        .await
        .map_err(to_string)?;
        state.runtime_metrics.observe_response(&response);

        if extract_chat_tool_calls(&response).is_empty() {
            let effective_tool_call_meta = build_state_effective_tool_call_meta(&state);
            return Ok(LocalChatToolRuntimeOutput {
                response: enrich_response_with_tool_trace(
                    response,
                    &effective_tool_call_meta,
                    state.realtime_emitter.emitted_any,
                    &state.runtime_metrics,
                ),
            });
        }

        let prior_tool_call_meta = build_state_effective_tool_call_meta(&state);
        state.last_response = Some(response.clone());
        let state_snapshot = LocalChatToolRuntimeState {
            max_rounds: state.max_rounds,
            round: state.round,
            trace_id: state.trace_id.clone(),
            request_id: state.request_id.clone(),
            execution_policy: state.execution_policy.clone(),
            model_connection: state.model_connection.clone(),
            orchestrated_messages: state.orchestrated_messages.clone(),
            session_id: state.session_id.clone(),
            temperature: state.temperature,
            max_tokens: state.max_tokens,
            active_capability: state.active_capability.clone(),
            runtime_metrics: state.runtime_metrics.clone(),
            last_capability_snapshot: state.last_capability_snapshot.clone(),
            last_response: state.last_response.clone(),
            realtime_emitter: LocalRealtimeToolTraceEmitter::new(
                None,
                Some(state.trace_id.as_str()),
                state.request_id.as_deref(),
            ),
        };
        match process_chat_tool_calls(
            app,
            app_state,
            &state_snapshot,
            &response,
            &prior_tool_call_meta,
            state.session_id.as_str(),
            &effective_allowed_tool_names,
            state.active_capability.as_ref(),
            &mut state.last_capability_snapshot,
            &mut state.realtime_emitter,
        )
        .await
        {
            LocalToolCallProcessingOutcome::Completed {
                synthesized,
                tool_call_meta,
                results,
            } => {
                let canonical_tool_call_meta = canonicalize_tool_call_meta_via_graph(
                    &session_id,
                    &state.execution_policy,
                    &response,
                    &tool_call_meta,
                );
                record_query_affinity_from_tool_meta(
                    app_state.mcp.store.as_ref(),
                    state.last_capability_snapshot.as_ref(),
                    &canonical_tool_call_meta,
                )
                .await;
                if !synthesized {
                    let mut current_tool_call_meta = build_state_effective_tool_call_meta(&state);
                    current_tool_call_meta.extend(canonical_tool_call_meta.clone());
                    return Ok(LocalChatToolRuntimeOutput {
                        response: enrich_response_with_tool_trace(
                            response,
                            &current_tool_call_meta,
                            state.realtime_emitter.emitted_any,
                            &state.runtime_metrics,
                        ),
                    });
                }
                finalize_tool_round(
                    &mut state.orchestrated_messages,
                    &mut state.active_capability,
                    &state.model_connection.protocol_family,
                    state.round,
                    &response,
                    &canonical_tool_call_meta,
                    &results,
                );
                state.last_response = Some(enrich_response_with_tool_trace(
                    response,
                    &canonical_tool_call_meta,
                    state.realtime_emitter.emitted_any,
                    &state.runtime_metrics,
                ));
            }
            LocalToolCallProcessingOutcome::Interrupted {
                approval_tokens,
                mut tool_call_meta,
                results,
                capability_update,
            } => {
                let canonical_tool_call_meta = canonicalize_tool_call_meta_via_graph(
                    &session_id,
                    &state.execution_policy,
                    &response,
                    &tool_call_meta,
                );
                let resolved_tool_call_meta =
                    tool_call_meta_with_resolved_ids(&canonical_tool_call_meta);
                record_query_affinity_from_tool_meta(
                    app_state.mcp.store.as_ref(),
                    state.last_capability_snapshot.as_ref(),
                    &resolved_tool_call_meta,
                )
                .await;
                let suspended = SuspendedChatToolExecution::from_state(
                    &state,
                    &resolved_tool_call_meta,
                    &results,
                    capability_update,
                    derive_pending_call_id_from_tool_call_meta(&resolved_tool_call_meta),
                    String::new(),
                );
                tool_call_meta = resolved_tool_call_meta;
                attach_graph_metadata_to_pending_tool_meta(&mut tool_call_meta, &suspended);
                {
                    let mut pending_tool_calls =
                        app_state.mcp.approvals.pending_tool_calls.write().await;
                    for approval_token in &approval_tokens {
                        let Some(pending) = pending_tool_calls.get_mut(approval_token) else {
                            continue;
                        };
                        pending.execution_graph_execution_id =
                            suspended.graph_execution_id().map(str::to_string);
                        if let Some(call_id) = pending.call_id.as_deref() {
                            pending.execution_graph_gate_node_id =
                                suspended.approval_gate_node_id_for_call_id(call_id);
                            pending.execution_graph_tool_node_id =
                                suspended.tool_node_id_for_call_id(call_id);
                        } else {
                            pending.execution_graph_gate_node_id =
                                Some(suspended.pending_gate_node_id().to_string());
                            pending.execution_graph_tool_node_id =
                                Some(suspended.pending_tool_node_id().to_string());
                        }
                    }
                }
                let persisted_pending_approvals = {
                    let pending_tool_calls =
                        app_state.mcp.approvals.pending_tool_calls.read().await;
                    build_pending_approval_records(&pending_tool_calls, &approval_tokens)
                };
                let mut persisted_graph_runtime = true;
                if let Err(err) = persist_suspended_execution_graph_runtime(
                    app_state.mcp.store.as_ref(),
                    &suspended,
                    &persisted_pending_approvals,
                    "desktop_local_chat_waiting_approval",
                    "waiting_approval",
                )
                .await
                {
                    log::warn!(
                        "persist_suspended_execution_graph_runtime failed session={} err={}",
                        state.session_id,
                        err
                    );
                    persisted_graph_runtime = false;
                }
                if !persisted_graph_runtime {
                    let mut suspended_local_chat_executions = app_state
                        .mcp
                        .approvals
                        .suspended_local_chat_executions
                        .write()
                        .await;
                    for approval_token in &approval_tokens {
                        suspended_local_chat_executions
                            .insert(approval_token.clone(), suspended.clone());
                    }
                }

                let mut current_tool_call_meta = build_state_effective_tool_call_meta(&state);
                current_tool_call_meta.extend(suspended.pending_tool_call_meta());
                let interrupted = serde_json::json!({
                    "content": last_response_content_or_empty(state.last_response.as_ref()),
                });
                return Ok(LocalChatToolRuntimeOutput {
                    response: enrich_response_with_tool_trace(
                        interrupted,
                        &current_tool_call_meta,
                        state.realtime_emitter.emitted_any,
                        &state.runtime_metrics,
                    ),
                });
            }
        }
    }
}

fn build_max_rounds_exceeded_response(state: &LocalChatToolRuntimeState) -> serde_json::Value {
    let notice = format!(
        "Stopped because the local desktop runtime reached the agentic round limit ({}). Increase `max_agentic_rounds` to let longer approval-heavy runs continue.",
        state.max_rounds
    );
    let mut fallback = state
        .last_response
        .clone()
        .unwrap_or_else(|| serde_json::json!({ "content": "" }));
    let existing_content =
        extract_resume_response_text(fallback.get("content").unwrap_or(&serde_json::Value::Null));
    let next_content = if existing_content.trim().is_empty() {
        notice.clone()
    } else if existing_content.contains(&notice) {
        existing_content
    } else {
        format!("{existing_content}\n\n{notice}")
    };
    if let Some(object) = fallback.as_object_mut() {
        object.insert(
            "content".to_string(),
            serde_json::Value::String(next_content),
        );
        object.insert(
            "error_code".to_string(),
            serde_json::Value::String("LOCAL_CHAT_MAX_ROUNDS_EXCEEDED".to_string()),
        );
        object.insert(
            "stop_reason".to_string(),
            serde_json::Value::String("max_agentic_rounds_exceeded".to_string()),
        );
    }
    fallback
}

fn rewind_round_for_post_approval_continuation(state: &mut LocalChatToolRuntimeState) {
    state.round = state.round.saturating_sub(1);
}

fn suspended_execution_matches_requested_execution_id(
    suspended: &SuspendedChatToolExecution,
    execution_graph_execution_id: Option<&str>,
) -> bool {
    let Some(expected_execution_id) = execution_graph_execution_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return true;
    };

    suspended.graph_execution_id() == Some(expected_execution_id)
}

async fn take_suspended_local_chat_execution_fallback(
    suspended_local_chat_executions: &tokio::sync::RwLock<
        HashMap<String, SuspendedChatToolExecution>,
    >,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
) -> Option<SuspendedChatToolExecution> {
    let normalized_token = approval_token.trim();
    if normalized_token.is_empty() {
        return None;
    }

    let mut suspended_local_chat_executions = suspended_local_chat_executions.write().await;
    let suspended = suspended_local_chat_executions.remove(normalized_token)?;
    if suspended_execution_matches_requested_execution_id(&suspended, execution_graph_execution_id)
    {
        return Some(suspended);
    }

    suspended_local_chat_executions.insert(normalized_token.to_string(), suspended);
    None
}

async fn load_suspended_chat_tool_execution_for_resume(
    app_state: &AppState,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
) -> Result<Option<SuspendedChatToolExecution>, String> {
    let persisted_execution_graph = if let Some(execution_id) = execution_graph_execution_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        load_execution_graph_snapshot(app_state.mcp.store.as_ref(), execution_id)
            .await
            .map_err(|err| err.to_string())?
    } else {
        None
    };

    if let Some(execution_graph) = persisted_execution_graph {
        if let Some(execution_id) = execution_graph
            .get("execution_id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if let Some(runtime_context) =
                load_execution_graph_runtime_context(app_state.mcp.store.as_ref(), execution_id)
                    .await
                    .map_err(|err| err.to_string())?
            {
                let persisted_context = persistable_inflight_context_from_value(&runtime_context)
                    .and_then(|context| context.chat_runtime)
                    .unwrap_or_else(|| {
                        serde_json::from_value(runtime_context).unwrap_or_else(|_| {
                            PersistedChatToolRuntimeContext {
                                max_rounds: 4,
                                round: 0,
                                trace_id: execution_id.to_string(),
                                request_id: None,
                                execution_policy:
                                    crate::modules::desktop_runtime::runtime::build_default_local_execution_policy(),
                                model_connection: LocalModelConnection {
                                    model_id: "deeting-os".to_string(),
                                    provider_model_id: "deeting-os".to_string(),
                                    logical_model_key: None,
                                    protocol_family: "openai_chat".to_string(),
                                },
                                orchestrated_messages: Vec::new(),
                                session_id: execution_graph
                                    .get("session_id")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default()
                                    .to_string(),
                                temperature: None,
                                max_tokens: None,
                                active_capability: None,
                                runtime_metrics: RuntimeMetricsAccumulator::default(),
                                last_capability_snapshot: None,
                                last_response: None,
                            }
                        })
                    });
                let state = runtime_state_from_persisted_context(persisted_context);
                return Ok(Some(SuspendedChatToolExecution {
                    max_rounds: state.max_rounds,
                    round: state.round,
                    trace_id: state.trace_id.clone(),
                    request_id: state.request_id.clone(),
                    execution_policy: state.execution_policy.clone(),
                    model_connection: state.model_connection.clone(),
                    orchestrated_messages: state.orchestrated_messages.clone(),
                    session_id: state.session_id.clone(),
                    temperature: state.temperature,
                    max_tokens: state.max_tokens,
                    active_capability: state.active_capability.clone(),
                    runtime_metrics: state.runtime_metrics.clone(),
                    last_capability_snapshot: state.last_capability_snapshot.clone(),
                    last_response: state.last_response.clone(),
                    execution_graph,
                }));
            }
        }
    }

    Ok(take_suspended_local_chat_execution_fallback(
        app_state
            .mcp
            .approvals
            .suspended_local_chat_executions
            .as_ref(),
        approval_token,
        execution_graph_execution_id,
    )
    .await)
}

fn finalize_tool_round(
    orchestrated_messages: &mut Vec<LocalChatInputMessage>,
    active_capability: &mut Option<LocalCapabilityActivationState>,
    protocol_family: &str,
    round: usize,
    response: &serde_json::Value,
    tool_call_meta: &[serde_json::Value],
    results: &[String],
) {
    apply_capability_update(
        orchestrated_messages,
        active_capability,
        derive_capability_update_from_tool_call_meta(tool_call_meta),
    );

    if let Some(replay_messages) =
        build_structured_tool_replay_messages(protocol_family, response, tool_call_meta)
    {
        orchestrated_messages.extend(replay_messages);
        return;
    }

    let effective_tool_call_meta = build_effective_tool_call_meta(response, tool_call_meta);
    let tool_feedback = build_tool_loop_feedback(round, &effective_tool_call_meta, results);
    let assistant_content = response
        .get("content")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
    if !assistant_content.is_empty() {
        orchestrated_messages.push(LocalChatInputMessage {
            role: "assistant".to_string(),
            content: assistant_content,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        });
    }
    orchestrated_messages.push(LocalChatInputMessage {
        role: "user".to_string(),
        content: tool_feedback,
        tool_calls: vec![],
        tool_call_id: None,
        name: None,
    });
}

fn build_structured_tool_replay_messages(
    protocol_family: &str,
    response: &serde_json::Value,
    tool_call_meta: &[serde_json::Value],
) -> Option<Vec<LocalChatInputMessage>> {
    if protocol_family != "openai_chat"
        && protocol_family != "openai_responses"
        && protocol_family != "anthropic_messages"
        && protocol_family != "google_gemini"
    {
        return None;
    }

    let tool_calls = extract_chat_tool_calls(response);
    if tool_calls.is_empty() {
        return None;
    }
    let effective_tool_call_meta = build_effective_tool_call_meta(response, tool_call_meta);
    if effective_tool_call_meta.is_empty() {
        return None;
    }

    let mut ordered_tool_meta = Vec::with_capacity(tool_calls.len());
    for tool_call in &tool_calls {
        let Some(call_id) = tool_call
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            log::warn!("structured tool replay skipped because a tool call is missing call_id");
            return None;
        };

        let Some(meta) = effective_tool_call_meta
            .iter()
            .find(|item| tool_call_meta_matches_call_id(item, call_id))
        else {
            log::warn!(
                "structured tool replay skipped because tool output is missing for call_id={}",
                call_id
            );
            return None;
        };

        ordered_tool_meta.push((call_id.to_string(), meta));
    }

    let assistant_content = response
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let mut messages = Vec::with_capacity(1 + ordered_tool_meta.len());
    messages.push(LocalChatInputMessage {
        role: "assistant".to_string(),
        content: assistant_content,
        tool_calls,
        tool_call_id: None,
        name: None,
    });

    for (call_id, item) in ordered_tool_meta {
        messages.push(LocalChatInputMessage {
            role: "tool".to_string(),
            content: serialize_tool_replay_content(item),
            tool_calls: vec![],
            tool_call_id: Some(call_id),
            name: item
                .get("name")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string()),
        });
    }

    Some(messages)
}

fn serialize_tool_replay_content(item: &serde_json::Value) -> String {
    if let Some(result) = item.get("result") {
        if let Some(text) = result.as_str() {
            return text.to_string();
        }
        if result
            .get("structuredContent")
            .filter(|value| !value.is_null())
            .is_some()
        {
            return serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string());
        }
        if let Some(extracted) = extract_mcp_result_text_content(result) {
            return extracted;
        }
        return serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string());
    }

    serde_json::to_string(&serde_json::json!({
        "status": item.get("status").cloned().unwrap_or(serde_json::json!("unknown")),
        "error": item.get("error").cloned().unwrap_or(serde_json::json!(null)),
        "error_code": item.get("error_code").cloned().unwrap_or(serde_json::json!(null)),
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

fn extract_mcp_result_text_content(result: &serde_json::Value) -> Option<String> {
    let object = result.as_object()?;
    let content = object.get("content")?.as_array()?;
    let mut parts = Vec::new();

    for item in content {
        let Some(block) = item.as_object() else {
            continue;
        };
        let block_type = block
            .get("type")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or_default();

        match block_type {
            "text" => {
                let text = block
                    .get("text")
                    .or_else(|| block.get("content"))
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                if let Some(text) = text {
                    parts.push(text.to_string());
                }
            }
            "image" => parts.push("[Image Content]".to_string()),
            _ => {}
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn apply_capability_update(
    orchestrated_messages: &mut Vec<LocalChatInputMessage>,
    active_capability: &mut Option<LocalCapabilityActivationState>,
    capability_update: Option<LocalCapabilityTransition>,
) {
    if let Some(update) = capability_update {
        match update {
            LocalCapabilityTransition::Activate(next_active) => {
                let capability_name = next_active.capability_name.clone();
                let capability_summary = next_active.capability_summary.clone();
                *active_capability = Some(next_active);
                orchestrated_messages.push(LocalChatInputMessage {
                    role: "system".to_string(),
                    content: format!(
                        "[Expert Capability Attached: {}]\n\nAttach this as domain capability guidance only. Keep the fixed desktop persona, tone, and reply style unchanged.\n\n{}",
                        capability_name,
                        if capability_summary.trim().is_empty() {
                            "Use the attached expert capability only to improve domain depth and tool choice.".to_string()
                        } else {
                            format!("Relevant capability focus: {}", capability_summary.trim())
                        },
                    ),
                    tool_calls: vec![],
                    tool_call_id: None,
                    name: None,
                });
            }
            LocalCapabilityTransition::Deactivate {
                _capability_id: _,
                capability_name,
            } => {
                *active_capability = None;
                let label = capability_name.unwrap_or_else(|| "expert capability".to_string());
                orchestrated_messages.push(LocalChatInputMessage {
                    role: "system".to_string(),
                    content: format!(
                        "[Expert Capability Detached: {}]\n\nReturn to the default capability-neutral state for this request while keeping the fixed desktop persona unchanged.",
                        label,
                    ),
                    tool_calls: vec![],
                    tool_call_id: None,
                    name: None,
                });
            }
        }
    }
}

fn derive_capability_update_from_tool_call_meta(
    tool_call_meta: &[serde_json::Value],
) -> Option<LocalCapabilityTransition> {
    for item in tool_call_meta.iter().rev() {
        let result = item.get("result")?.as_object()?;
        let transition = result.get("capability_transition")?.as_object()?;
        let action = transition
            .get("action")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())?;

        match action {
            "activated" => {
                let capability_id = result
                    .get("capability_id")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        transition
                            .get("capability_id")
                            .and_then(serde_json::Value::as_str)
                    })
                    .map(str::trim)
                    .filter(|value| !value.is_empty())?
                    .to_string();
                let capability_name = result
                    .get("capability_name")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        transition
                            .get("capability_name")
                            .and_then(serde_json::Value::as_str)
                    })
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("expert capability")
                    .to_string();
                let capability_summary = result
                    .get("capability_summary")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default()
                    .to_string();
                return Some(LocalCapabilityTransition::Activate(
                    LocalCapabilityActivationState {
                        capability_id,
                        capability_name,
                        capability_summary,
                    },
                ));
            }
            "deactivated" => {
                let capability_name = result
                    .get("capability_name")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        transition
                            .get("capability_name")
                            .and_then(serde_json::Value::as_str)
                    })
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                let capability_id = result
                    .get("capability_id")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        transition
                            .get("capability_id")
                            .and_then(serde_json::Value::as_str)
                    })
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                return Some(LocalCapabilityTransition::Deactivate {
                    _capability_id: capability_id,
                    capability_name,
                });
            }
            _ => {}
        }
    }
    None
}

struct LocalRealtimeToolTraceEmitter {
    tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    trace_id: Option<String>,
    request_id: Option<String>,
    emitted_execution_section: bool,
    emitted_any: bool,
    captured_blocks: Vec<serde_json::Value>,
}

impl LocalRealtimeToolTraceEmitter {
    fn new(
        tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
        trace_id: Option<&str>,
        request_id: Option<&str>,
    ) -> Self {
        Self {
            tx,
            trace_id: trace_id
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            request_id: request_id
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            emitted_execution_section: false,
            emitted_any: false,
            captured_blocks: Vec::new(),
        }
    }

    fn emit_execution_section_once(&mut self) {
        if self.emitted_execution_section {
            return;
        }
        self.emitted_execution_section = true;
        self.emit_blocks(vec![
            serde_json::json!({ "type": "execution_section", "title": "Code Execution" }),
        ]);
    }

    fn emit_blocks(&mut self, blocks: Vec<serde_json::Value>) {
        if blocks.is_empty() {
            return;
        }
        self.captured_blocks.extend(blocks.iter().cloned());
        let Some(tx) = &self.tx else {
            self.emitted_any = true;
            return;
        };
        let mut payload = serde_json::json!({ "type": "blocks", "blocks": blocks });
        if let Some(object) = payload.as_object_mut() {
            if let Some(trace_id) = self.trace_id.as_ref() {
                object.insert("trace_id".to_string(), serde_json::json!(trace_id));
            }
            if let Some(request_id) = self.request_id.as_ref() {
                object.insert("request_id".to_string(), serde_json::json!(request_id));
            }
        }
        if let Ok(serialized) = serde_json::to_string(&payload) {
            let _ = tx.send(serialized);
            self.emitted_any = true;
        }
    }
}

fn build_runtime_bridge_stream_target(
    realtime_emitter: &LocalRealtimeToolTraceEmitter,
) -> Option<crate::modules::code_mode::bridge::RuntimeBridgeStreamTarget> {
    let tx = realtime_emitter.tx.as_ref()?.clone();
    Some(
        crate::modules::code_mode::bridge::RuntimeBridgeStreamTarget {
            tx,
            trace_id: realtime_emitter.trace_id.clone(),
            request_id: realtime_emitter.request_id.clone(),
        },
    )
}

async fn process_chat_tool_calls(
    app: &AppHandle,
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    chat_response: &serde_json::Value,
    prior_tool_call_meta: &[serde_json::Value],
    session_id: &str,
    effective_allowed_tool_names: &[String],
    active_capability: Option<&LocalCapabilityActivationState>,
    last_capability_snapshot: &mut Option<serde_json::Value>,
    realtime_emitter: &mut LocalRealtimeToolTraceEmitter,
) -> LocalToolCallProcessingOutcome {
    let tool_calls = extract_chat_tool_calls(chat_response);
    if tool_calls.is_empty() {
        return LocalToolCallProcessingOutcome::Completed {
            synthesized: false,
            tool_call_meta: Vec::new(),
            results: Vec::new(),
        };
    }
    let mut tool_call_meta = Vec::new();
    let mut results = Vec::new();
    let mut synthesized = false;
    let mut capability_update = None;
    let mut approval_tokens = Vec::new();

    for (call_index, call) in tool_calls.into_iter().enumerate() {
        let requested_tool_name = call.name.trim().to_lowercase();
        let tool_name = resolve_provider_tool_name_for_execution(
            &requested_tool_name,
            effective_allowed_tool_names,
            last_capability_snapshot.as_ref(),
        )
        .unwrap_or(requested_tool_name);
        let tool_name =
            canonicalize_tool_name_for_allowed_list(&tool_name, effective_allowed_tool_names)
                .unwrap_or(tool_name);
        let call_id =
            resolve_local_tool_call_id(call.id.as_deref(), &tool_name, state.round, call_index);
        let meta_len_before = tool_call_meta.len();
        let approval_count_before = approval_tokens.len();
        if !effective_allowed_tool_names
            .iter()
            .any(|item| item == &tool_name)
        {
            synthesized = true;
            let error = format!(
                "tool '{}' is not enabled for the current execution policy",
                tool_name
            );
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            let meta = serde_json::json!({
                "id": call_id.as_str(),
                "name": tool_name,
                "status": "error",
                "error_code": "LOCAL_TOOL_POLICY_BLOCKED",
                "error": error,
            });
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push(format!(
                "Tool call '{}' blocked [LOCAL_TOOL_POLICY_BLOCKED]: {}",
                tool_name, error
            ));
            continue;
        }

        let running_execution_id = persist_running_tool_execution_runtime(
            app_state.mcp.store.as_ref(),
            &LocalChatToolRuntimeState {
                max_rounds: state.max_rounds,
                round: state.round,
                trace_id: state.trace_id.clone(),
                request_id: state.request_id.clone(),
                execution_policy: state.execution_policy.clone(),
                model_connection: state.model_connection.clone(),
                orchestrated_messages: state.orchestrated_messages.clone(),
                session_id: state.session_id.clone(),
                temperature: state.temperature,
                max_tokens: state.max_tokens,
                active_capability: state.active_capability.clone(),
                runtime_metrics: state.runtime_metrics.clone(),
                last_capability_snapshot: state.last_capability_snapshot.clone(),
                last_response: state.last_response.clone(),
                realtime_emitter: LocalRealtimeToolTraceEmitter::new(
                    None,
                    Some(state.trace_id.as_str()),
                    state.request_id.as_deref(),
                ),
            },
            call_id.as_str(),
            &tool_name,
            &call.arguments,
        )
        .await
        .ok()
        .flatten();

        if tool_name == "execute_code_plan" {
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            let code = call
                .arguments
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let language = call
                .arguments
                .get("language")
                .and_then(|v| v.as_str())
                .unwrap_or("python");
            let execution_timeout = call
                .arguments
                .get("execution_timeout")
                .and_then(|v| v.as_u64())
                .map(|v| v.max(1));
            let dry_run = call
                .arguments
                .get("dry_run")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let execution_contract = match CapabilityExecutionContract::from_search_result(
                last_capability_snapshot.as_ref(),
            ) {
                Ok(contract) => contract,
                Err(error) => {
                    synthesized = true;
                    let meta = serde_json::json!({
                        "id":call_id.as_str(),
                        "name":tool_name,
                        "status":"error",
                        "error_code":"CODEMODE_SEARCH_REQUIRED",
                        "error":error,
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Codemode Tool Blocked [CODEMODE_SEARCH_REQUIRED]: {}",
                        error
                    ));
                    continue;
                }
            };
            if code.trim().is_empty() {
                synthesized = true;
                push_local_tool_call_error_meta(
                    &mut tool_call_meta,
                    &mut results,
                    realtime_emitter,
                    Some(call_id.as_str()),
                    &tool_name,
                    "CODEMODE_EMPTY_CODE",
                    "execute_code_plan requires a non-empty 'code' argument",
                );
                continue;
            }

            let execution_res = crate::modules::code_mode::commands::execute_local_code_mode_inner(
                app_state,
                ExecuteLocalCodemodeRequest {
                    code: code.to_string(),
                    task: call
                        .arguments
                        .get("task")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    scope: call.arguments.get("scope").cloned(),
                    constraints: call.arguments.get("constraints").cloned(),
                    session_id: Some(session_id.to_string()),
                    language: Some(language.to_string()),
                    execution_timeout,
                    dry_run: Some(dry_run),
                    context: None,
                    max_calls: None,
                    allowed_tools: Some(execution_contract.allowed_tools.clone()),
                    capability_snapshot: Some(execution_contract.capability_snapshot.clone()),
                },
                build_runtime_bridge_stream_target(realtime_emitter),
            )
            .await;
            match execution_res {
                Ok(res) => {
                    synthesized = true;
                    let meta_status = if res.success { "success" } else { "error" };
                    let meta = serde_json::json!({
                        "id":call_id.as_str(),
                        "name":tool_name,
                        "status":meta_status,
                        "errorCode":res.error_code,
                        "result":res
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    if res.success {
                        results.push(format!("Codemode Tool Result:\n{}", res.result.join("\n")));
                    } else {
                        results.push(format!(
                            "Codemode Tool Blocked: {}",
                            res.error.unwrap_or_else(|| "sandbox not ready".to_string())
                        ));
                    }
                }
                Err(err) => {
                    let meta = serde_json::json!({"id":call_id.as_str(),"name":tool_name,"status":"error","error":err.to_string()});
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!("Codemode Tool Failed: {}", err));
                }
            }
        } else if tool_name == "search_sdk" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            let query = call
                .arguments
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = call
                .arguments
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
                .unwrap_or(8);
            let mut feedback_meta = prior_tool_call_meta.to_vec();
            feedback_meta.extend(tool_call_meta.iter().cloned());
            let feedback_context = search_feedback_context_from_tool_call_meta(&feedback_meta);
            let search_bundle = build_local_sdk_search_result_bundle_with_feedback_runtime(
                app_state.mcp.store.as_ref(),
                &app_state.providers.embedding,
                app_state.memory.service.as_ref(),
                query,
                limit,
                &feedback_context,
            )
            .await;
            let search_res = search_bundle.summary_payload;
            *last_capability_snapshot = Some(search_bundle.full_payload);
            synthesized = true;
            let meta = serde_json::json!({"id":call_id.as_str(),"name":tool_name,"status":"success","result":search_res});
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push(format!(
                "SDK Search Result for '{}':\n{}",
                query,
                serde_json::to_string_pretty(&search_res).unwrap()
            ));
        } else if tool_name == "attach_capability" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            let capability_id = call
                .arguments
                .get("capability_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let reason = call
                .arguments
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("Explicit expert capability attach requested by the model.");
            match resolve_local_capability_activation_state(app_state, capability_id).await {
                Ok(state) => {
                    let activated_capability_id = state.capability_id.clone();
                    let result = serde_json::json!({
                        "action":"activated","scope":"request","format_version":LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
                        "activation_mode":"attach_capability","capability_id":activated_capability_id,"capability_name":state.capability_name.clone(),
                        "capability_summary":state.capability_summary.clone(),"reason":reason,
                        "capability_transition":{"action":"activated","capability_id":capability_id,"capability_name":state.capability_name.clone(),"reason":reason}
                    });
                    synthesized = true;
                    let meta = serde_json::json!({"id":call_id.as_str(),"name":tool_name,"status":"success","result":result});
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Expert capability '{}' attached for the current request.",
                        state.capability_name
                    ));
                    capability_update = Some(LocalCapabilityTransition::Activate(state));
                    let bandit_store = app_state.providers.store.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = bandit_store
                            .record_feedback_simple(
                                "router:assistant",
                                &activated_capability_id,
                                true,
                                None,
                            )
                            .await
                        {
                            log::warn!("bandit feedback failed for router:assistant: {}", e);
                        }
                    });
                }
                Err(err) => {
                    let meta = serde_json::json!({"id":call_id.as_str(),"name":tool_name,"status":"error","error_code":"CAPABILITY_ATTACH_FAILED","error":err});
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!("Expert capability attach failed: {}", err));
                    synthesized = true;
                    let bandit_store = app_state.providers.store.clone();
                    let bandit_capability_id = capability_id.to_string();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = bandit_store
                            .record_feedback_simple(
                                "router:assistant",
                                &bandit_capability_id,
                                false,
                                None,
                            )
                            .await
                        {
                            log::warn!("bandit feedback failed for router:assistant: {}", e);
                        }
                    });
                }
            }
        } else if tool_name == "detach_capability" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            let reason = call
                .arguments
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("Explicit expert capability detach requested by the model.");
            let result = serde_json::json!({
                "action":"deactivated","scope":"request","format_version":LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
                "capability_id":active_capability.map(|v| v.capability_id.clone()),"capability_name":active_capability.map(|v| v.capability_name.clone()),"reason":reason,
                "capability_transition":{"action":"deactivated","capability_id":active_capability.map(|v| v.capability_id.clone()),"capability_name":active_capability.map(|v| v.capability_name.clone()),"reason":reason}
            });
            synthesized = true;
            let meta = serde_json::json!({"id":call_id.as_str(),"name":tool_name,"status":"success","result":result});
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push("Assistant deactivated for the current request.".to_string());
            capability_update = Some(LocalCapabilityTransition::Deactivate {
                _capability_id: active_capability.map(|v| v.capability_id.clone()),
                capability_name: active_capability.map(|v| v.capability_name.clone()),
            });
        } else if tool_name == "sys_submit_onboarding_request" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            let asset_type = call
                .arguments
                .get("asset_type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let payload = call
                .arguments
                .get("payload")
                .cloned()
                .unwrap_or(serde_json::json!({}));
            if asset_type == "assistant" {
                let create_req: Result<mcp_session::assistant::CreateLocalAssistantRequest, _> =
                    serde_json::from_value(payload);
                match create_req {
                    Ok(req) => match app_state.mcp.store.create_local_assistant(req).await {
                        Ok(id) => {
                            synthesized = true;
                            let meta = serde_json::json!({"id":call_id.as_str(),"name":tool_name,"status":"success","result":{"action":"created","id":id}});
                            let mut streamed_blocks = Vec::new();
                            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                            realtime_emitter.emit_blocks(streamed_blocks);
                            tool_call_meta.push(meta);
                            results.push(format!("Assistant created successfully with ID: {}", id));
                        }
                        Err(err) => {
                            synthesized = true;
                            push_local_tool_call_error_meta(
                                &mut tool_call_meta,
                                &mut results,
                                realtime_emitter,
                                Some(call_id.as_str()),
                                &tool_name,
                                "LOCAL_ASSISTANT_CREATE_FAILED",
                                format!("assistant creation failed: {}", err),
                            );
                        }
                    },
                    Err(err) => {
                        synthesized = true;
                        push_local_tool_call_error_meta(
                            &mut tool_call_meta,
                            &mut results,
                            realtime_emitter,
                            Some(call_id.as_str()),
                            &tool_name,
                            "INVALID_ONBOARDING_ASSISTANT_PAYLOAD",
                            format!("assistant onboarding payload could not be parsed: {}", err),
                        );
                    }
                }
            } else if asset_type == "skill" {
                match install_local_skill_from_onboarding_request(app, app_state, &payload).await {
                    Ok(result) => {
                        synthesized = true;
                        let meta = serde_json::json!({"id":call_id.as_str(),"name":tool_name,"status":"success","result":result});
                        let mut streamed_blocks = Vec::new();
                        append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                        realtime_emitter.emit_blocks(streamed_blocks);
                        tool_call_meta.push(meta);
                        results.push(format!(
                            "Skill onboarding request executed:\n{}",
                            serde_json::to_string_pretty(&result)
                                .unwrap_or_else(|_| "{}".to_string())
                        ));
                    }
                    Err(err) => {
                        synthesized = true;
                        let meta = serde_json::json!({"id":call_id.as_str(),"name":tool_name,"status":"error","error":err});
                        let mut streamed_blocks = Vec::new();
                        append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                        realtime_emitter.emit_blocks(streamed_blocks);
                        tool_call_meta.push(meta);
                        results.push(format!("Skill onboarding failed: {}", err));
                    }
                }
            } else if asset_type == "custom_task_agent" {
                let create_req: Result<CreateCustomTaskAgentRequest, _> =
                    serde_json::from_value(payload);
                match create_req {
                    Ok(req) => match create_custom_task_agent_service(app_state, req).await {
                        Ok(profile) => {
                            synthesized = true;
                            let result = serde_json::json!({
                                "action": "created",
                                "id": profile.id,
                                "status": "success",
                                "result": profile,
                            });
                            let meta = serde_json::json!({"id":call_id.as_str(),"name":tool_name,"status":"success","result":result});
                            let mut streamed_blocks = Vec::new();
                            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                            realtime_emitter.emit_blocks(streamed_blocks);
                            tool_call_meta.push(meta);
                            results.push("Custom task agent created successfully.".to_string());
                        }
                        Err(err) => {
                            synthesized = true;
                            push_local_tool_call_error_meta(
                                &mut tool_call_meta,
                                &mut results,
                                realtime_emitter,
                                Some(call_id.as_str()),
                                &tool_name,
                                "LOCAL_CUSTOM_TASK_AGENT_CREATE_FAILED",
                                format!("custom task agent creation failed: {}", err),
                            );
                        }
                    },
                    Err(err) => {
                        synthesized = true;
                        push_local_tool_call_error_meta(
                            &mut tool_call_meta,
                            &mut results,
                            realtime_emitter,
                            Some(call_id.as_str()),
                            &tool_name,
                            "INVALID_ONBOARDING_CUSTOM_TASK_AGENT_PAYLOAD",
                            format!("custom task agent onboarding payload could not be parsed: {}", err),
                        );
                    }
                }
            } else {
                synthesized = true;
                let asset_type_label = if asset_type.trim().is_empty() {
                    "<empty>"
                } else {
                    asset_type
                };
                push_local_tool_call_error_meta(
                    &mut tool_call_meta,
                    &mut results,
                    realtime_emitter,
                    Some(call_id.as_str()),
                    &tool_name,
                    "UNSUPPORTED_ONBOARDING_ASSET_TYPE",
                    format!(
                        "unsupported onboarding asset_type '{}'; expected 'assistant', 'skill', or 'custom_task_agent'",
                        asset_type_label
                    ),
                );
            }
        } else if tool_name == "refresh_skill_index" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            match crate::modules::skills::commands::register_local_skills_inner(
                app.clone(),
                app_state,
            )
            .await
            {
                Ok(registered) => {
                    synthesized = true;
                    let result = serde_json::json!({
                        "status": "ok",
                        "registered": registered,
                    });
                    let meta = serde_json::json!({"id":call_id.as_str(),"name":tool_name,"status":"success","result":result});
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Skill index refreshed successfully. Registered {} local skills.",
                        registered
                    ));
                }
                Err(err) => {
                    synthesized = true;
                    let meta = serde_json::json!({"id":call_id.as_str(),"name":tool_name,"status":"error","error":err.to_string()});
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!("Skill index refresh failed: {}", err));
                }
            }
        } else {
            synthesized = true;
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            let approval_context = app_state.mcp.build_approval_context(
                Some(call_id.as_str()),
                None,
                Some(session_id),
            );
            match execute_or_queue_mcp_tool_call_with_tool_ref(
                &approval_context,
                Some(&app_state.mcp),
                app_state.mcp.store.as_ref(),
                app_state.mcp.approvals.pending_tool_calls.as_ref(),
                None,
                Some(tool_name.clone()),
                call.arguments.clone(),
            )
            .await
            {
                Ok(tool_result) => {
                    let requires_approval = tool_result
                        .get("status")
                        .and_then(serde_json::Value::as_str)
                        .map(|status| status == "REQUIRES_APPROVAL")
                        .unwrap_or(false);
                    let meta = serde_json::json!({
                        "id": call_id.as_str(),
                        "name": tool_name,
                        "status": if requires_approval { "requires_approval" } else { "success" },
                        "result": tool_result,
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    if requires_approval {
                        results.push(format!(
                            "Tool call '{}' requires approval before execution.",
                            tool_name
                        ));
                        if let Some(approval_token) = tool_result
                            .get("approval_token")
                            .and_then(serde_json::Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                        {
                            approval_tokens.push(approval_token.to_string());
                        }
                    } else {
                        results.push(format!("Tool call '{}' executed successfully.", tool_name));
                    }
                }
                Err(err) => {
                    let error = err.to_string();
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "LOCAL_TOOL_EXECUTION_FAILED",
                        error,
                    );
                }
            }
        }

        if tool_call_meta.len() == meta_len_before {
            synthesized = true;
            let error = format!(
                "tool call '{}' completed without recording a result; synthesized a fallback error output to keep replay stable",
                tool_name
            );
            log::warn!(
                "local chat tool call missing output meta: tool_name={} call_id={}",
                tool_name,
                call_id
            );
            push_local_tool_call_error_meta(
                &mut tool_call_meta,
                &mut results,
                realtime_emitter,
                Some(call_id.as_str()),
                &tool_name,
                "LOCAL_TOOL_RESULT_MISSING",
                error,
            );
        }
        if approval_tokens.len() == approval_count_before {
            clear_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                running_execution_id.as_deref(),
            )
            .await;
        }
    }
    if approval_tokens.is_empty() {
        LocalToolCallProcessingOutcome::Completed {
            synthesized,
            tool_call_meta,
            results,
        }
    } else {
        LocalToolCallProcessingOutcome::Interrupted {
            approval_tokens,
            tool_call_meta,
            results,
            capability_update,
        }
    }
}

fn apply_approved_tool_result_to_suspended_round(
    suspended: &mut SuspendedChatToolExecution,
    call_id: Option<&str>,
    tool_result: &serde_json::Value,
) {
    apply_approved_tool_result_to_execution_graph(suspended, call_id, tool_result);
}

fn build_local_chat_resume_continuation_blocks(
    resumed_response: &serde_json::Value,
    continuation_meta: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    let mut blocks = if continuation_meta.is_empty() {
        resumed_response
            .get("execution_graph")
            .map(project_execution_graph_blocks_from_value)
            .unwrap_or_default()
    } else {
        build_local_tool_trace_blocks(continuation_meta)
    };
    let response_text = extract_resume_response_text(
        resumed_response
            .get("content")
            .unwrap_or(&serde_json::Value::Null),
    );
    if !response_text.trim().is_empty() {
        blocks.push(serde_json::json!({
            "type": "text",
            "content": response_text,
        }));
    }
    blocks
}

fn extract_resume_response_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(items) => {
            let mut out = Vec::new();
            for item in items {
                let Some(object) = item.as_object() else {
                    continue;
                };
                let text = object
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| object.get("content").and_then(serde_json::Value::as_str))
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                if let Some(text) = text {
                    out.push(text.to_string());
                }
            }
            out.join("\n")
        }
        serde_json::Value::Object(object) => object
            .get("text")
            .and_then(serde_json::Value::as_str)
            .or_else(|| object.get("content").and_then(serde_json::Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| {
                serde_json::to_string(&serde_json::Value::Object(object.clone()))
                    .unwrap_or_default()
            }),
        serde_json::Value::Null => String::new(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn build_persisted_resume_assistant_blocks(
    resumed_response: &serde_json::Value,
) -> Vec<serde_json::Value> {
    let mut blocks = resumed_response
        .get("tool_trace_blocks")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            resumed_response
                .get("execution_graph")
                .map(project_execution_graph_blocks_from_value)
                .unwrap_or_default()
        });

    let response_text = extract_resume_response_text(
        resumed_response
            .get("content")
            .unwrap_or(&serde_json::Value::Null),
    );
    if !response_text.trim().is_empty() {
        blocks.push(serde_json::json!({
            "type": "text",
            "content": response_text,
        }));
    }

    blocks
}

fn build_persisted_resume_assistant_meta(
    resumed_response: &serde_json::Value,
    model_connection: &LocalModelConnection,
) -> serde_json::Value {
    let mut meta = serde_json::Map::new();
    let blocks = build_persisted_resume_assistant_blocks(resumed_response);
    if !blocks.is_empty() {
        meta.insert("blocks".to_string(), serde_json::Value::Array(blocks));
    }
    meta.insert(
        "model_id".to_string(),
        serde_json::Value::String(model_connection.model_id.clone()),
    );
    meta.insert(
        "provider_model_id".to_string(),
        serde_json::Value::String(model_connection.provider_model_id.clone()),
    );
    if let Some(runtime_metrics) = resumed_response.get("runtime_metrics").cloned() {
        meta.insert("runtime_metrics".to_string(), runtime_metrics);
    }
    if let Some(execution_graph) = resumed_response.get("execution_graph").cloned() {
        meta.insert("execution_graph".to_string(), execution_graph);
    }
    serde_json::Value::Object(meta)
}

fn attach_execution_graph_to_response(
    response: &mut serde_json::Value,
    session_id: &str,
    execution_policy: &LocalExecutionPolicy,
    root_execution_id: Option<&str>,
    force_rebuild: bool,
) {
    if !force_rebuild && response.get("execution_graph").is_some() {
        return;
    }
    if force_rebuild {
        if let Some(object) = response.as_object_mut() {
            object.remove("execution_graph");
        }
    }
    let tool_trace_blocks = response
        .get("tool_trace_blocks")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: session_id.to_string(),
        route: execution_policy.route.as_str().to_string(),
        plane: execution_policy.plane.as_str().to_string(),
        trace_id: None,
        request_id: None,
        root_execution_id: root_execution_id.map(str::to_string),
        response_content: response.get("content").cloned(),
        tool_trace_blocks,
        delegated_execution_tree: None,
    })
    .to_value();
    if let Some(object) = response.as_object_mut() {
        object.insert("execution_graph".to_string(), execution_graph);
    }
}

async fn persist_resumed_local_chat_assistant_message(
    app_state: &AppState,
    session_id: &str,
    model_connection: &LocalModelConnection,
    resumed_response: &serde_json::Value,
) -> Result<(), String> {
    let assistant_meta = build_persisted_resume_assistant_meta(resumed_response, model_connection);

    app_state
        .mcp
        .store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: session_id.to_string(),
            role: "assistant".to_string(),
            content: String::new(),
            name: None,
            meta_info: Some(assistant_meta),
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map(|_| ())
        .map_err(|err| {
            format!(
                "chat step=append_resumed_assistant_message session={} err={}",
                session_id, err
            )
        })?;

    if let Some(execution_graph) = resumed_response.get("execution_graph") {
        if let Err(err) = persist_execution_graph_snapshot(
            app_state.mcp.store.as_ref(),
            execution_graph,
            session_id,
            "desktop_local_chat_resume",
            None,
            Some("completed"),
        )
        .await
        {
            log::warn!(
                "persist_execution_graph_snapshot failed session={} err={}",
                session_id,
                err
            );
        }
    }

    Ok(())
}

pub(crate) async fn resume_suspended_chat_tool_execution_after_approval(
    app: &AppHandle,
    app_state: &AppState,
    approval_token: &str,
    tool_result: &serde_json::Value,
    call_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
) -> Result<Option<serde_json::Value>, String> {
    let mut suspended = if let Some(suspended) = load_suspended_chat_tool_execution_for_resume(
        app_state,
        approval_token,
        execution_graph_execution_id,
    )
    .await?
    {
        suspended
    } else {
        return Ok(None);
    };

    apply_approved_tool_result_to_suspended_round(&mut suspended, call_id, tool_result);

    let pending_response = suspended
        .last_response
        .clone()
        .unwrap_or_else(|| serde_json::json!({ "content": "" }));
    let pending_response = strip_stale_resume_response_metadata(pending_response);
    let graph_pending_tool_call_meta = suspended.pending_tool_call_meta();
    let pending_results = summarize_tool_call_meta_results(&graph_pending_tool_call_meta);
    let root_execution_id = suspended
        .execution_graph
        .get("execution_id")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let post_approval_graph = suspended.execution_graph.clone();

    if let Err(err) = persist_suspended_execution_graph_runtime(
        app_state.mcp.store.as_ref(),
        &suspended,
        &[],
        "desktop_local_chat_approval_applied",
        "active",
    )
    .await
    {
        log::warn!(
            "persist approved execution graph failed approval_token={} err={}",
            approval_token,
            err
        );
    }

    let remaining_pending_call_ids = suspended.pending_requires_approval_call_ids();
    if !remaining_pending_call_ids.is_empty() {
        return Ok(Some(serde_json::json!({
            "status": "LOCAL_CHAT_WAITING_APPROVAL",
            "approved_tool_result": tool_result,
            "continuation_blocks": build_local_chat_resume_continuation_blocks(
                &serde_json::json!({
                    "execution_graph": suspended.execution_graph().clone(),
                    "content": "",
                }),
                &suspended.pending_tool_call_meta(),
            ),
            "execution_graph": suspended.execution_graph().clone(),
            "execution_graph_execution_id": root_execution_id,
            "pending_call_ids": remaining_pending_call_ids,
        })));
    }

    let mut state = suspended.into_runtime_state();
    let session_id = state.session_id.clone();
    let model_connection = state.model_connection.clone();
    let execution_policy = state.execution_policy.clone();
    finalize_tool_round(
        &mut state.orchestrated_messages,
        &mut state.active_capability,
        &state.model_connection.protocol_family,
        state.round,
        &pending_response,
        &graph_pending_tool_call_meta,
        &pending_results,
    );
    state.last_response = Some(enrich_response_with_tool_trace(
        pending_response,
        &graph_pending_tool_call_meta,
        false,
        &state.runtime_metrics,
    ));
    rewind_round_for_post_approval_continuation(&mut state);

    match continue_local_chat_complete_with_tools(app, app_state, state).await {
        Ok(mut output) => {
            attach_execution_graph_to_response(
                &mut output.response,
                &session_id,
                &execution_policy,
                root_execution_id.as_deref(),
                true,
            );
            if let Err(err) = persist_resumed_local_chat_assistant_message(
                app_state,
                &session_id,
                &model_connection,
                &output.response,
            )
            .await
            {
                log::warn!("{err}");
            }
            clear_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                root_execution_id.as_deref(),
            )
            .await;
            let continuation_meta = build_effective_tool_call_meta(&output.response, &[]);
            Ok(Some(serde_json::json!({
                "status": "LOCAL_CHAT_RESUMED",
                "approved_tool_result": tool_result,
                "continuation_blocks": build_local_chat_resume_continuation_blocks(&output.response, &continuation_meta),
                "execution_graph": output.response.get("execution_graph").cloned(),
                "execution_graph_execution_id": output
                    .response
                    .get("execution_graph")
                    .and_then(|value| value.get("execution_id"))
                    .cloned(),
                "response": output.response,
            })))
        }
        Err(err) => {
            if let Err(persist_err) = persist_execution_graph_snapshot(
                app_state.mcp.store.as_ref(),
                &post_approval_graph,
                &session_id,
                "desktop_local_chat_resume_failed",
                None,
                Some("failed"),
            )
            .await
            {
                log::warn!(
                    "persist_execution_graph_snapshot failed session={} err={}",
                    session_id,
                    persist_err
                );
            }
            clear_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                root_execution_id.as_deref(),
            )
            .await;
            Ok(Some(serde_json::json!({
                "status": "LOCAL_CHAT_RESUME_FAILED",
                "approved_tool_result": tool_result,
                "continuation_blocks": [],
                "execution_graph": post_approval_graph,
                "execution_graph_execution_id": root_execution_id,
                "error": err,
            })))
        }
    }
}

fn pending_tool_call_from_persisted_approval(
    pending: &PersistedPendingApproval,
    default_execution_id: Option<&str>,
    expires_at_unix_ms: i128,
) -> crate::modules::mcp::PendingToolCall {
    crate::modules::mcp::PendingToolCall {
        tool_id: pending.tool_id.clone(),
        tool_name: pending.tool_name.clone(),
        arguments: pending.arguments.clone(),
        call_id: pending.call_id.clone(),
        execution_token: pending.execution_token.clone(),
        session_id: pending.session_id.clone(),
        description: pending.description.clone(),
        risk_level: pending.risk_level.clone(),
        risk_reasons: pending.risk_reasons.clone(),
        tool_fingerprint: pending.tool_fingerprint.clone(),
        policy_rule_key: pending.policy_rule_key.clone(),
        approval_grant_key: pending.approval_grant_key.clone(),
        execution_graph_execution_id: pending
            .execution_graph_execution_id
            .clone()
            .or_else(|| default_execution_id.map(str::to_string)),
        execution_graph_gate_node_id: pending.execution_graph_gate_node_id.clone(),
        execution_graph_tool_node_id: pending.execution_graph_tool_node_id.clone(),
        created_at_unix_ms: pending.created_at_unix_ms,
        expires_at_unix_ms,
    }
}

fn recovery_assistant_meta(
    execution_graph: &serde_json::Value,
    execution_id: &str,
    stage: &str,
    available_actions: &[&str],
) -> Option<serde_json::Value> {
    crate::modules::desktop_runtime::runtime::assistant_persistence::with_assistant_persistence_state(
        Some(serde_json::json!({
            "execution_graph": execution_graph,
            "recovery": {
                "execution_id": execution_id,
                "stage": stage,
                "available_actions": available_actions,
            }
        })),
        crate::modules::desktop_runtime::runtime::assistant_persistence::AssistantPersistenceState {
            assistant_message_persisted: true,
            execution_graph_persisted: true,
            postprocess_completed: true,
        },
    )
}

async fn recovery_message_exists(
    store: &crate::modules::mcp::store::McpStore,
    session_id: &str,
    execution_id: &str,
) -> Result<bool, String> {
    let count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM conversation_message
        WHERE session_id = ?
          AND role = 'assistant'
          AND is_deleted = 0
          AND (
            json_extract(meta_info, '$.recovery.execution_id') = ?
            OR json_extract(meta_info, '$.execution_graph.execution_id') = ?
          )
        "#,
    )
    .bind(session_id)
    .bind(execution_id)
    .bind(execution_id)
    .fetch_one(&store.pool)
    .await
    .map_err(|err| err.to_string())?;
    Ok(count > 0)
}

async fn append_recovery_assistant_message_if_missing(
    store: &crate::modules::mcp::store::McpStore,
    session_id: &str,
    execution_graph: &serde_json::Value,
    execution_id: &str,
    stage: &str,
    content: &str,
    available_actions: &[&str],
) -> Result<(), String> {
    if recovery_message_exists(store, session_id, execution_id).await? {
        return Ok(());
    }
    store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: session_id.to_string(),
            role: "assistant".to_string(),
            content: content.to_string(),
            name: None,
            meta_info: recovery_assistant_meta(
                execution_graph,
                execution_id,
                stage,
                available_actions,
            ),
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn mark_inflight_execution_interrupted(
    execution_graph: &mut serde_json::Value,
    current_call_id: Option<&str>,
    message: &str,
) {
    let execution_id = execution_graph
        .get("execution_id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    apply_rejected_tool_result_to_execution_graph_value(
        execution_graph,
        execution_id.as_deref(),
        current_call_id,
        message,
    );
    if let Some(metadata) = execution_graph
        .get_mut("metadata")
        .and_then(serde_json::Value::as_object_mut)
    {
        metadata.insert("status".to_string(), serde_json::json!("interrupted"));
        metadata.insert("interrupted_reason".to_string(), serde_json::json!(message));
    }
}

pub(crate) async fn recover_inflight_local_execution_state(
    _app: &AppHandle,
    app_state: &AppState,
) -> Result<(), String> {
    let store = app_state.mcp.store.as_ref();
    let rows = list_execution_graph_runtime_contexts(store)
        .await
        .map_err(|err| err.to_string())?;

    for row in rows {
        let Some(mut persisted) = persistable_inflight_context_from_value(&row.context) else {
            continue;
        };
        let Some(execution_id) = persisted
            .execution_graph_execution_id
            .clone()
            .or_else(|| Some(row.execution_id.clone()))
        else {
            continue;
        };

        match persisted.stage {
            InFlightExecutionStage::WaitingApproval => {
                let extended_expiry =
                    now_unix_ms_i64() as i128 + app_state.mcp.pending_tool_call_ttl_ms();
                let mut pending_tool_calls =
                    app_state.mcp.approvals.pending_tool_calls.write().await;
                for pending in &persisted.pending_approvals {
                    pending_tool_calls
                        .entry(pending.approval_token.clone())
                        .or_insert_with(|| {
                            pending_tool_call_from_persisted_approval(
                                pending,
                                Some(execution_id.as_str()),
                                extended_expiry,
                            )
                        });
                }
                drop(pending_tool_calls);
                if let Some(execution_graph) =
                    load_execution_graph_snapshot(store, execution_id.as_str())
                        .await
                        .map_err(|err| err.to_string())?
                {
                    append_recovery_assistant_message_if_missing(
                        store,
                        persisted.session_id.as_str(),
                        &execution_graph,
                        execution_id.as_str(),
                        "waiting_approval",
                        "上次执行停在工具审批节点，当前待审批状态已恢复。",
                        &["approve", "reject"],
                    )
                    .await?;
                }
            }
            InFlightExecutionStage::ToolRunning => {
                if persisted.recovery_notice_emitted_at_unix_ms.is_some() {
                    continue;
                }
                let Some(mut execution_graph) =
                    load_execution_graph_snapshot(store, execution_id.as_str())
                        .await
                        .map_err(|err| err.to_string())?
                else {
                    continue;
                };
                let message = "上次执行在工具运行中断开，系统未自动重放；该工具可能已经执行，请确认后继续、重试或放弃。";
                mark_inflight_execution_interrupted(
                    &mut execution_graph,
                    persisted.current_call_id.as_deref(),
                    message,
                );
                persist_execution_graph_snapshot(
                    store,
                    &execution_graph,
                    persisted.session_id.as_str(),
                    "desktop_local_chat_recovered_interrupt",
                    persisted.request_id.as_deref(),
                    Some("interrupted"),
                )
                .await
                .map_err(|err| err.to_string())?;
                append_recovery_assistant_message_if_missing(
                    store,
                    persisted.session_id.as_str(),
                    &execution_graph,
                    execution_id.as_str(),
                    "tool_running_interrupted",
                    message,
                    &["continue", "retry", "abandon"],
                )
                .await?;
                persisted.stage = InFlightExecutionStage::Interrupted;
                persisted.recovery_notice_emitted_at_unix_ms = Some(now_unix_ms_i64());
                persist_execution_graph_runtime_context(
                    store,
                    execution_id.as_str(),
                    &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
                )
                .await
                .map_err(|err| err.to_string())?;
            }
            InFlightExecutionStage::DelegatedWorkflowRunning => {
                if persisted.recovery_notice_emitted_at_unix_ms.is_some() {
                    continue;
                }
                let Some(workflow_run_id) = persisted.workflow_run_id.as_deref() else {
                    persisted.stage = InFlightExecutionStage::Interrupted;
                    persisted.recovery_notice_emitted_at_unix_ms = Some(now_unix_ms_i64());
                    persist_execution_graph_runtime_context(
                        store,
                        execution_id.as_str(),
                        &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
                    )
                    .await
                    .map_err(|err| err.to_string())?;
                    continue;
                };
                let detail = crate::modules::workflow::service::get_workflow_run_status(
                    app_state,
                    workflow_run_id,
                )
                .await?;
                let workflow_text = match detail.run.status {
                    crate::modules::workflow::types::WorkflowRunStatus::Completed => {
                        crate::modules::workflow::service::extract_primary_content(&detail)
                            .unwrap_or_else(|| {
                                format!(
                                    "上次委派的 workflow `{}` 已完成，结果已补回会话。",
                                    workflow_run_id
                                )
                            })
                    }
                    crate::modules::workflow::types::WorkflowRunStatus::WaitingApproval => {
                        format!(
                            "上次委派的 workflow `{}` 目前停在审批节点，当前状态已恢复。",
                            workflow_run_id
                        )
                    }
                    crate::modules::workflow::types::WorkflowRunStatus::Running => {
                        format!(
                            "上次委派的 workflow `{}` 在应用中断前仍处于运行中，系统未自动重放，请确认后重试或放弃。",
                            workflow_run_id
                        )
                    }
                    _ => format!(
                        "上次委派的 workflow `{}` 当前状态为 `{}`。",
                        workflow_run_id,
                        detail.run.status.as_str()
                    ),
                };
                append_recovery_assistant_message_if_missing(
                    store,
                    persisted.session_id.as_str(),
                    &serde_json::json!({
                        "execution_id": execution_id,
                        "metadata": {
                            "status": detail.run.status.as_str(),
                            "workflow_run_id": workflow_run_id,
                        },
                        "nodes": [],
                        "events": [],
                    }),
                    execution_id.as_str(),
                    "delegated_workflow_running",
                    workflow_text.as_str(),
                    &["retry", "abandon"],
                )
                .await?;
                persisted.recovery_notice_emitted_at_unix_ms = Some(now_unix_ms_i64());
                if detail.run.status == crate::modules::workflow::types::WorkflowRunStatus::Running
                {
                    persisted.stage = InFlightExecutionStage::Interrupted;
                    persist_execution_graph_runtime_context(
                        store,
                        execution_id.as_str(),
                        &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
                    )
                    .await
                    .map_err(|err| err.to_string())?;
                } else {
                    clear_execution_graph_runtime_context(store, Some(execution_id.as_str())).await;
                }
            }
            InFlightExecutionStage::Interrupted => {}
        }
    }

    Ok(())
}

fn canonicalize_tool_name_for_allowed_list(
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

fn summarize_tool_call_meta_results(tool_call_meta: &[serde_json::Value]) -> Vec<String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::desktop_runtime::runtime::build_local_tool_call_install_gate_error_meta;
    use crate::modules::desktop_runtime::runtime::tool_catalog::dynamic_capability_alias;
    use crate::modules::desktop_runtime::runtime::LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE;

    #[test]
    fn build_execution_contract_from_search_result_requires_capabilities() {
        let err = CapabilityExecutionContract::from_search_result(Some(&serde_json::json!({
            "recipes": [{"name": "Weather Skill"}]
        })))
        .expect_err("should require callable results");
        assert!(err.contains("capabilities"));
    }

    #[test]
    fn last_response_content_or_empty_preserves_existing_assistant_text() {
        let content = last_response_content_or_empty(Some(&serde_json::json!({
            "content": "我来尝试读取一些笔记。"
        })));

        assert_eq!(content, serde_json::json!("我来尝试读取一些笔记。"));
    }

    #[test]
    fn build_execution_contract_from_search_result_extracts_allowed_tools() {
        let contract = CapabilityExecutionContract::from_search_result(Some(&serde_json::json!({
            "capabilities": [
                {"name": "search_web", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "fetch_page", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "search_web", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "disabled_tool", "invocation_mode": "direct", "status": {"callable": false}},
                {"name": "execute_code_plan", "invocation_mode": "direct", "status": {"callable": true}}
            ]
        })))
        .expect("contract");
        assert_eq!(
            contract.allowed_tools,
            vec!["fetch_page".to_string(), "search_web".to_string()]
        );
    }

    #[test]
    fn install_gate_error_meta_uses_stable_not_installed_code() {
        let meta = build_local_tool_call_install_gate_error_meta(
            Some("call-123"),
            "stock_quotes",
            "tool 'stock_quotes' is not installed or enabled in local desktop runtime",
        );
        assert_eq!(
            meta["error_code"],
            serde_json::json!(LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE)
        );
        assert_eq!(meta["status"], serde_json::json!("error"));
        assert_eq!(meta["name"], serde_json::json!("stock_quotes"));
    }


    #[test]
    fn canonicalize_tool_name_for_allowed_list_accepts_underscore_variant() {
        let canonical = canonicalize_tool_name_for_allowed_list(
            "tavily_search",
            &["search_sdk".to_string(), "tavily-search".to_string()],
        );

        assert_eq!(canonical.as_deref(), Some("tavily-search"));
    }

    #[test]
    fn structured_tool_replay_messages_use_family_gates_for_supported_protocols() {
        let response = serde_json::json!({
            "content": "",
            "tool_calls": [
                {
                    "id": "call_123",
                    "name": "search_sdk",
                    "arguments": { "query": "tool replay" }
                }
            ]
        });
        let meta = vec![serde_json::json!({
            "id": "call_123",
            "name": "search_sdk",
            "status": "success",
            "result": { "ok": true }
        })];

        let openai_replay = build_structured_tool_replay_messages("openai_chat", &response, &meta)
            .expect("openai replay");
        assert_eq!(openai_replay.len(), 2);
        assert_eq!(openai_replay[0].role, "assistant");
        assert_eq!(openai_replay[0].tool_calls.len(), 1);
        assert_eq!(openai_replay[1].role, "tool");
        assert_eq!(openai_replay[1].tool_call_id.as_deref(), Some("call_123"));

        let anthropic_replay =
            build_structured_tool_replay_messages("anthropic_messages", &response, &meta)
                .expect("anthropic replay");
        assert_eq!(anthropic_replay.len(), 2);
        assert_eq!(anthropic_replay[1].role, "tool");

        let gemini_replay =
            build_structured_tool_replay_messages("google_gemini", &response, &meta)
                .expect("gemini replay");
        assert_eq!(gemini_replay.len(), 2);
        assert_eq!(gemini_replay[1].role, "tool");

        let responses_replay =
            build_structured_tool_replay_messages("openai_responses", &response, &meta)
                .expect("responses replay");
        assert_eq!(responses_replay.len(), 2);
        assert_eq!(responses_replay[0].role, "assistant");
        assert_eq!(
            responses_replay[1].tool_call_id.as_deref(),
            Some("call_123")
        );
    }

    #[test]
    fn structured_tool_replay_messages_require_output_for_every_call() {
        let response = serde_json::json!({
            "content": "",
            "tool_calls": [
                {
                    "id": "call_123",
                    "name": "search_sdk",
                    "arguments": { "query": "tool replay" }
                },
                {
                    "id": "call_456",
                    "name": "refresh_skill_index",
                    "arguments": {}
                }
            ]
        });
        let meta = vec![serde_json::json!({
            "id": "call_123",
            "name": "search_sdk",
            "status": "success",
            "result": { "ok": true }
        })];

        assert!(
            build_structured_tool_replay_messages("openai_responses", &response, &meta).is_none()
        );
    }

    #[test]
    fn structured_tool_replay_messages_fall_back_to_execution_graph_when_meta_missing() {
        let response = serde_json::json!({
            "content": "",
            "tool_calls": [
                {
                    "id": "call_123",
                    "name": "search_sdk",
                    "arguments": { "query": "tool replay" }
                }
            ],
            "execution_graph": {
                "schema_version": 1,
                "execution_id": "graph-exec-1",
                "session_id": "session-1",
                "route": "direct",
                "plane": "response_only",
                "request_id": null,
                "root_execution_id": null,
                "nodes": [
                    {
                        "node_id": "tool_call:call_123",
                        "node_type": "tool_call",
                        "status": "success",
                        "dependency_ids": [],
                        "metadata": {
                            "call_id": "call_123",
                            "tool_name": "search_sdk"
                        },
                        "input_payload": null,
                        "output_payload": {
                            "structuredContent": {
                                "ok": true
                            }
                        }
                    }
                ],
                "events": [],
                "metadata": {}
            }
        });

        let replay = build_structured_tool_replay_messages("openai_responses", &response, &[])
            .expect("graph replay");
        assert_eq!(replay.len(), 2);
        assert_eq!(replay[1].role, "tool");
        assert_eq!(replay[1].tool_call_id.as_deref(), Some("call_123"));
        assert!(replay[1].content.contains("\"structuredContent\""));
    }

    #[test]
    fn enrich_response_with_tool_trace_includes_error_result_blocks() {
        let response = serde_json::json!({
            "content": ""
        });
        let meta = vec![
            serde_json::json!({
                "id": "call_search",
                "name": "search_sdk",
                "status": "success",
                "result": { "ok": true }
            }),
            serde_json::json!({
                "id": "call_crawler",
                "name": "skill.official.skills.crawler.fetch_web_content",
                "status": "error",
                "error_code": "LOCAL_TOOL_EXECUTION_FAILED",
                "error": "crawler failed"
            }),
        ];
        let metrics = RuntimeMetricsAccumulator::default();

        let enriched = enrich_response_with_tool_trace(response, &meta, true, &metrics);
        let blocks = enriched
            .get("tool_trace_blocks")
            .and_then(serde_json::Value::as_array)
            .expect("tool trace blocks should be present");

        assert!(blocks.iter().any(|block| {
            block.get("type").and_then(|v| v.as_str()) == Some("tool_result")
                && block.get("status").and_then(|v| v.as_str()) == Some("error")
                && block.get("toolName").and_then(|v| v.as_str())
                    == Some("skill.official.skills.crawler.fetch_web_content")
                && block
                    .get("result")
                    .and_then(|v| v.get("error"))
                    .and_then(|v| v.as_str())
                    == Some("crawler failed")
        }));
        assert_eq!(
            enriched.get("tool_trace_streamed"),
            Some(&serde_json::json!(true))
        );
    }

    #[test]
    fn enrich_response_with_tool_trace_falls_back_to_execution_graph_blocks() {
        let response = serde_json::json!({
            "content": "",
            "execution_graph": {
                "schema_version": 1,
                "execution_id": "graph-exec-1",
                "session_id": "session-1",
                "route": "direct",
                "plane": "response_only",
                "request_id": null,
                "root_execution_id": null,
                "nodes": [
                    {
                        "node_id": "tool_call:call-1",
                        "node_type": "tool_call",
                        "status": "success",
                        "dependency_ids": [],
                        "metadata": {
                            "call_id": "call-1",
                            "tool_name": "search_sdk"
                        },
                        "input_payload": null,
                        "output_payload": {
                            "ok": true
                        }
                    }
                ],
                "events": [],
                "metadata": {}
            }
        });
        let metrics = RuntimeMetricsAccumulator::default();

        let enriched = enrich_response_with_tool_trace(response, &[], false, &metrics);
        let blocks = enriched
            .get("tool_trace_blocks")
            .and_then(serde_json::Value::as_array)
            .expect("tool trace blocks should be present");

        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], serde_json::json!("tool_call"));
        assert_eq!(blocks[1]["type"], serde_json::json!("tool_result"));
        assert_eq!(blocks[1]["result"]["ok"], serde_json::json!(true));
    }

    #[test]
    fn serialize_tool_replay_content_preserves_structured_content_payloads() {
        let item = serde_json::json!({
            "id": "call_tavily",
            "name": "tavily-search",
            "status": "success",
            "result": {
                "content": [
                    { "type": "text", "text": "Detailed Results:" },
                    { "type": "text", "text": "1. Example result body" }
                ],
                "structuredContent": {
                    "results": [
                        { "title": "Example", "url": "https://example.com" }
                    ]
                },
                "isError": false
            }
        });

        let serialized = serialize_tool_replay_content(&item);
        let reparsed: serde_json::Value =
            serde_json::from_str(&serialized).expect("structured tool replay should stay json");

        assert_eq!(reparsed, item["result"]);
    }

    #[test]
    fn serialize_tool_replay_content_extracts_standard_mcp_text_content_without_structured_data() {
        let item = serde_json::json!({
            "id": "call_tavily",
            "name": "tavily-search",
            "status": "success",
            "result": {
                "content": [
                    { "type": "text", "text": "Detailed Results:" },
                    { "type": "text", "text": "1. Example result body" }
                ],
                "isError": false
            }
        });

        assert_eq!(
            serialize_tool_replay_content(&item),
            "Detailed Results:\n1. Example result body"
        );
    }

    #[test]
    fn build_persisted_resume_assistant_blocks_keeps_tool_trace_and_final_text() {
        let response = serde_json::json!({
            "content": "Final answer after approval.",
            "tool_trace_blocks": [
                {
                    "type": "tool_call",
                    "callId": "call_123",
                    "toolName": "firecrawl_search",
                    "status": "success"
                },
                {
                    "type": "tool_result",
                    "callId": "call_123",
                    "toolName": "firecrawl_search",
                    "status": "success",
                    "result": {
                        "structuredContent": {
                            "results": [{ "title": "Tianjin Weather" }]
                        }
                    }
                }
            ]
        });

        let blocks = build_persisted_resume_assistant_blocks(&response);

        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0]["type"], serde_json::json!("tool_call"));
        assert_eq!(blocks[1]["type"], serde_json::json!("tool_result"));
        assert_eq!(blocks[2]["type"], serde_json::json!("text"));
        assert_eq!(
            blocks[2]["content"],
            serde_json::json!("Final answer after approval.")
        );
    }

    #[test]
    fn build_local_chat_resume_continuation_blocks_keeps_non_string_text_with_tool_trace() {
        let response = serde_json::json!({
            "content": [
                {
                    "type": "output_text",
                    "text": "Final answer after approval."
                }
            ],
            "tool_trace_blocks": [
                {
                    "type": "tool_call",
                    "callId": "call_123",
                    "toolName": "firecrawl_search",
                    "status": "success"
                },
                {
                    "type": "tool_result",
                    "callId": "call_123",
                    "toolName": "firecrawl_search",
                    "status": "success",
                    "result": {
                        "structuredContent": {
                            "results": [{ "title": "Tianjin Weather" }]
                        }
                    }
                }
            ]
        });

        let blocks = build_local_chat_resume_continuation_blocks(&response, &[]);

        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0]["type"], serde_json::json!("tool_call"));
        assert_eq!(blocks[1]["type"], serde_json::json!("tool_result"));
        assert_eq!(blocks[2]["type"], serde_json::json!("text"));
        assert_eq!(
            blocks[2]["content"],
            serde_json::json!("Final answer after approval.")
        );
    }

    #[test]
    fn build_persisted_resume_assistant_meta_carries_runtime_metadata() {
        let response = serde_json::json!({
            "content": "Resumed after approval.",
            "tool_trace_blocks": [],
            "execution_graph": {
                "execution_id": "graph-exec-1"
            },
            "runtime_metrics": {
                "upstream_latency_ms": 1200,
                "upstream_calls": 2
            }
        });
        let model_connection = LocalModelConnection {
            model_id: "deeting-os".to_string(),
            provider_model_id: "deepseek-v3.1".to_string(),
            logical_model_key: Some("deeting-os".to_string()),
            protocol_family: "openai_chat".to_string(),
        };

        let meta = build_persisted_resume_assistant_meta(&response, &model_connection);

        assert_eq!(meta["model_id"], serde_json::json!("deeting-os"));
        assert_eq!(
            meta["provider_model_id"],
            serde_json::json!("deepseek-v3.1")
        );
        assert_eq!(
            meta["runtime_metrics"]["upstream_latency_ms"],
            serde_json::json!(1200)
        );
        assert_eq!(
            meta["execution_graph"]["execution_id"],
            serde_json::json!("graph-exec-1")
        );
        assert_eq!(
            meta["blocks"][0]["content"],
            serde_json::json!("Resumed after approval.")
        );
    }

    #[test]
    fn build_persisted_resume_assistant_blocks_falls_back_to_execution_graph_blocks() {
        let response = serde_json::json!({
            "content": "",
            "execution_graph": {
                "schema_version": 1,
                "execution_id": "graph-exec-1",
                "session_id": "session-1",
                "route": "direct",
                "plane": "response_only",
                "request_id": null,
                "root_execution_id": null,
                "nodes": [
                    {
                        "node_id": "tool_call:call-1",
                        "node_type": "tool_call",
                        "status": "waiting_approval",
                        "dependency_ids": [],
                        "metadata": {
                            "call_id": "call-1",
                            "tool_name": "browser_open_tab"
                        },
                        "input_payload": null,
                        "output_payload": {
                            "status": "REQUIRES_APPROVAL",
                            "approval_token": "approval-1"
                        }
                    }
                ],
                "events": [],
                "metadata": {}
            }
        });

        let blocks = build_persisted_resume_assistant_blocks(&response);

        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], serde_json::json!("tool_call"));
        assert_eq!(blocks[1]["type"], serde_json::json!("tool_result"));
        assert_eq!(
            blocks[1]["result"]["approval_token"],
            serde_json::json!("approval-1")
        );
    }

    #[test]
    fn canonicalize_tool_call_meta_via_graph_assigns_stable_ids_when_missing() {
        let execution_policy = mcp_runtime::policy::build_default_local_execution_policy();
        let response = serde_json::json!({
            "content": "pending approval"
        });
        let tool_call_meta = vec![
            serde_json::json!({
                "name": "search_notes",
                "status": "requires_approval",
                "result": {
                    "status": "REQUIRES_APPROVAL",
                    "approval_token": "approval-a"
                }
            }),
            serde_json::json!({
                "name": "search_notes",
                "status": "requires_approval",
                "result": {
                    "status": "REQUIRES_APPROVAL",
                    "approval_token": "approval-b"
                }
            }),
        ];

        let canonical = canonicalize_tool_call_meta_via_graph(
            "session-canonical-missing-id",
            &execution_policy,
            &response,
            &tool_call_meta,
        );

        assert_eq!(canonical.len(), 2);
        assert_eq!(
            canonical[0]["id"],
            serde_json::json!("approval-token:approval-a")
        );
        assert_eq!(
            canonical[1]["id"],
            serde_json::json!("approval-token:approval-b")
        );
        assert_eq!(
            derive_pending_call_id_from_tool_call_meta(&canonical),
            "approval-token:approval-b"
        );
    }

    #[test]
    fn strip_stale_resume_response_metadata_removes_old_graph_and_trace_blocks() {
        let response = serde_json::json!({
            "content": "pending",
            "execution_graph": { "execution_id": "graph-old" },
            "tool_trace_blocks": [{ "type": "text", "content": "old" }],
            "tool_trace_streamed": true,
        });

        let stripped = strip_stale_resume_response_metadata(response);

        assert_eq!(stripped.get("content"), Some(&serde_json::json!("pending")));
        assert!(stripped.get("execution_graph").is_none());
        assert!(stripped.get("tool_trace_blocks").is_none());
        assert!(stripped.get("tool_trace_streamed").is_none());
    }

    #[test]
    fn attach_execution_graph_to_response_force_rebuild_replaces_stale_graph() {
        let execution_policy = mcp_runtime::policy::build_default_local_execution_policy();
        let mut response = serde_json::json!({
            "content": "final answer",
            "execution_graph": {
                "execution_id": "graph-stale",
                "nodes": [
                    { "node_id": "approval_gate:call-1", "node_type": "approval_gate", "status": "waiting_approval" }
                ]
            },
            "tool_trace_blocks": [
                { "type": "text", "content": "final answer" }
            ]
        });

        attach_execution_graph_to_response(
            &mut response,
            "session-1",
            &execution_policy,
            Some("root-1"),
            true,
        );

        assert_ne!(
            response
                .get("execution_graph")
                .and_then(|value| value.get("execution_id"))
                .and_then(serde_json::Value::as_str),
            Some("graph-stale")
        );
    }

    #[test]
    fn build_max_rounds_exceeded_response_appends_visible_notice() {
        let state = LocalChatToolRuntimeState {
            max_rounds: 10,
            round: 10,
            trace_id: "trace-max-rounds-1".to_string(),
            request_id: None,
            execution_policy: mcp_runtime::policy::build_default_local_execution_policy(),
            model_connection: LocalModelConnection {
                model_id: "deeting-os".to_string(),
                provider_model_id: "deepseek-v3.1".to_string(),
                logical_model_key: Some("deeting-os".to_string()),
                protocol_family: "openai_chat".to_string(),
            },
            orchestrated_messages: Vec::new(),
            session_id: "session-max-rounds-1".to_string(),
            temperature: None,
            max_tokens: None,
            active_capability: None,
            runtime_metrics: RuntimeMetricsAccumulator::default(),
            last_capability_snapshot: None,
            last_response: Some(serde_json::json!({
                "content": "Shell step finished.",
                "tool_calls": [
                    {
                        "id": "call-shell-1",
                        "name": "shell_execute",
                        "arguments": {"command": "pwd"}
                    }
                ]
            })),
            realtime_emitter: LocalRealtimeToolTraceEmitter::new(
                None,
                Some("trace-max-rounds-1"),
                None,
            ),
        };

        let response = build_max_rounds_exceeded_response(&state);
        let content = response
            .get("content")
            .and_then(serde_json::Value::as_str)
            .expect("content");

        assert!(content.contains("Shell step finished."));
        assert!(content.contains("agentic round limit (10)"));
        assert_eq!(
            response
                .get("error_code")
                .and_then(serde_json::Value::as_str),
            Some("LOCAL_CHAT_MAX_ROUNDS_EXCEEDED")
        );
        assert_eq!(
            response
                .get("stop_reason")
                .and_then(serde_json::Value::as_str),
            Some("max_agentic_rounds_exceeded")
        );
    }

    #[test]
    fn rewind_round_for_post_approval_continuation_does_not_consume_user_round_budget() {
        let mut state = LocalChatToolRuntimeState {
            max_rounds: 10,
            round: 4,
            trace_id: "trace-approval-round-1".to_string(),
            request_id: None,
            execution_policy: mcp_runtime::policy::build_default_local_execution_policy(),
            model_connection: LocalModelConnection {
                model_id: "deeting-os".to_string(),
                provider_model_id: "deepseek-v3.1".to_string(),
                logical_model_key: Some("deeting-os".to_string()),
                protocol_family: "openai_chat".to_string(),
            },
            orchestrated_messages: Vec::new(),
            session_id: "session-approval-round-1".to_string(),
            temperature: None,
            max_tokens: None,
            active_capability: None,
            runtime_metrics: RuntimeMetricsAccumulator::default(),
            last_capability_snapshot: None,
            last_response: None,
            realtime_emitter: LocalRealtimeToolTraceEmitter::new(
                None,
                Some("trace-approval-round-1"),
                None,
            ),
        };

        rewind_round_for_post_approval_continuation(&mut state);
        assert_eq!(state.round, 3);

        rewind_round_for_post_approval_continuation(&mut state);
        rewind_round_for_post_approval_continuation(&mut state);
        rewind_round_for_post_approval_continuation(&mut state);
        assert_eq!(state.round, 0);
    }

    #[test]
    fn resolve_local_tool_call_id_synthesizes_stable_missing_id() {
        assert_eq!(
            resolve_local_tool_call_id(None, "search_notes", 2, 1),
            "local-missing-call:r2:i1:search_notes"
        );
        assert_eq!(
            resolve_local_tool_call_id(Some(" call-explicit-1 "), "search_notes", 2, 1),
            "call-explicit-1"
        );
    }

    #[test]
    fn apply_rejected_tool_result_updates_graph_without_runtime_shell() {
        let mut execution_graph = serde_json::json!({
            "execution_id": "graph-reject-1",
            "nodes": [
                {
                    "node_id": "approval_gate:call-1",
                    "node_type": "approval_gate",
                    "status": "waiting_approval",
                    "dependency_ids": [],
                    "metadata": { "approval_token": "approval-1" },
                    "input_payload": null,
                    "output_payload": null
                },
                {
                    "node_id": "tool_call:call-1",
                    "node_type": "tool_call",
                    "status": "waiting_approval",
                    "dependency_ids": [],
                    "metadata": { "call_id": "call-1" },
                    "input_payload": null,
                    "output_payload": null
                },
                {
                    "node_id": "finalize:call-1",
                    "node_type": "finalize",
                    "status": "pending",
                    "dependency_ids": [],
                    "metadata": {},
                    "input_payload": null,
                    "output_payload": null
                }
            ],
            "events": []
        });

        apply_rejected_tool_result_to_execution_graph_value(
            &mut execution_graph,
            Some("graph-reject-1"),
            None,
            "User rejected tool execution",
        );

        let nodes = execution_graph
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .expect("nodes");
        assert_eq!(
            nodes[0].get("status").and_then(serde_json::Value::as_str),
            Some("cancelled")
        );
        assert_eq!(
            nodes[1].get("status").and_then(serde_json::Value::as_str),
            Some("cancelled")
        );
        assert_eq!(
            nodes[2].get("status").and_then(serde_json::Value::as_str),
            Some("cancelled")
        );
        let events = execution_graph
            .get("events")
            .and_then(serde_json::Value::as_array)
            .expect("events");
        assert!(events.iter().any(|event| {
            event.get("event_type").and_then(serde_json::Value::as_str)
                == Some("approval_gate.rejected")
        }));
        assert!(events.iter().any(|event| {
            event.get("event_type").and_then(serde_json::Value::as_str)
                == Some("tool_call.rejected")
        }));
    }

    #[test]
    fn serialize_inflight_runtime_context_round_trips_waiting_approval_state() {
        let value = serialize_inflight_runtime_context(
            InFlightExecutionStage::WaitingApproval,
            Some("approval_gate:call-1".to_string()),
            Some("call-1".to_string()),
            None,
            true,
            vec![PersistedPendingApproval {
                approval_token: "approval-1".to_string(),
                tool_id: Some("tool-1".to_string()),
                tool_name: "browser_open_tab".to_string(),
                arguments: serde_json::json!({ "url": "https://example.com" }),
                call_id: Some("call-1".to_string()),
                execution_token: Some("exec-1".to_string()),
                session_id: Some("session-1".to_string()),
                description: Some("open a tab".to_string()),
                risk_level: Some("MEDIUM".to_string()),
                risk_reasons: vec!["navigates public internet".to_string()],
                tool_fingerprint: "fingerprint-1".to_string(),
                policy_rule_key: Some("policy-1".to_string()),
                approval_grant_key: None,
                execution_graph_execution_id: Some("graph-1".to_string()),
                execution_graph_gate_node_id: Some("approval_gate:call-1".to_string()),
                execution_graph_tool_node_id: Some("tool_call:call-1".to_string()),
                created_at_unix_ms: 1,
                expires_at_unix_ms: 2,
            }],
            None,
            "session-1",
            "trace-1",
            Some("request-1"),
            Some("graph-1"),
        );

        let parsed =
            persistable_inflight_context_from_value(&value).expect("parse inflight context");
        assert_eq!(parsed.stage, InFlightExecutionStage::WaitingApproval);
        assert_eq!(
            parsed.execution_graph_execution_id.as_deref(),
            Some("graph-1")
        );
        assert_eq!(parsed.pending_approvals.len(), 1);
        assert_eq!(
            parsed.pending_approvals[0].approval_token.as_str(),
            "approval-1"
        );
    }
}
