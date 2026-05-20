use super::*;

pub(crate) fn build_persisted_chat_runtime_context_from_execution_request(
    request: &crate::modules::desktop_runtime::runtime::LocalExecutionRequest,
    task_query: Option<String>,
    trace_id: String,
    max_rounds: usize,
) -> PersistedChatToolRuntimeContext {
    PersistedChatToolRuntimeContext {
        max_rounds,
        round: 0,
        trace_id,
        request_id: request.request_id.clone(),
        execution_policy: request.execution_policy.clone(),
        model_connection: request.model_connection.clone(),
        orchestrated_messages: request.messages.clone(),
        task_query,
        session_id: request.session_id.clone(),
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        reasoning_enabled: request.reasoning_enabled,
        reasoning_effort: request.reasoning_effort.clone(),
        active_capability: None,
        active_skill_context: None,
        runtime_metrics: Default::default(),
        last_capability_snapshot: request.execution_policy.capability_snapshot.clone(),
        terminal_context: request.terminal_context.clone(),
        workflow_context: request.workflow_context.clone(),
        last_response: None,
        selected_knowledge_file_ids: request.selected_knowledge_file_ids.clone(),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PersistedChatToolRuntimeContext {
    pub(super) max_rounds: usize,
    pub(super) round: usize,
    pub(super) trace_id: String,
    pub(super) request_id: Option<String>,
    pub(super) execution_policy: LocalExecutionPolicy,
    pub(super) model_connection: LocalModelConnection,
    pub(super) orchestrated_messages: Vec<LocalChatInputMessage>,
    pub(super) task_query: Option<String>,
    pub(super) session_id: String,
    pub(super) temperature: Option<f32>,
    pub(super) max_tokens: Option<u32>,
    #[serde(default)]
    pub(super) reasoning_enabled: Option<bool>,
    #[serde(default)]
    pub(super) reasoning_effort: Option<String>,
    pub(super) active_capability: Option<LocalCapabilityActivationState>,
    #[serde(default)]
    pub(super) active_skill_context: Option<ActiveSkillContextState>,
    pub(super) runtime_metrics: RuntimeMetricsAccumulator,
    pub(super) last_capability_snapshot: Option<serde_json::Value>,
    #[serde(default)]
    pub(super) terminal_context: Option<serde_json::Value>,
    #[serde(default)]
    pub(super) workflow_context: Option<serde_json::Value>,
    pub(super) last_response: Option<serde_json::Value>,
    // Backwards-compat: older persisted contexts pre-date the context
    // orchestrator manifest, so deserialize as empty when missing.
    #[serde(default)]
    pub(super) selected_knowledge_file_ids: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InFlightExecutionStage {
    ToolRunning,
    WaitingApproval,
    ResumingAfterApproval,
    ResumeFailed,
    DelegatedWorkflowRunning,
    Interrupted,
}

fn default_delegation_resume_policy() -> String {
    "on_completed".to_string()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub(crate) struct PersistedDelegationWait {
    pub(super) kind: String,
    pub(super) delegated_run_id: String,
    #[serde(default)]
    pub(super) delegated_target_id: Option<String>,
    #[serde(default)]
    pub(super) delegated_target_name: Option<String>,
    #[serde(default = "default_delegation_resume_policy")]
    pub(super) resume_policy: String,
    #[serde(default)]
    pub(super) consumed_event_ids: Vec<String>,
    #[serde(default)]
    pub(super) last_status: Option<String>,
    #[serde(default)]
    pub(super) result_ref: Option<String>,
    #[serde(default)]
    pub(super) started_at_unix_ms: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PersistedPendingApproval {
    pub(super) approval_token: String,
    pub(super) tool_id: Option<String>,
    pub(super) tool_name: String,
    pub(super) arguments: serde_json::Value,
    pub(super) call_id: Option<String>,
    pub(super) execution_token: Option<String>,
    pub(super) session_id: Option<String>,
    pub(super) description: Option<String>,
    pub(super) risk_level: Option<String>,
    pub(super) risk_reasons: Vec<String>,
    pub(super) tool_fingerprint: String,
    pub(super) policy_rule_key: Option<String>,
    pub(super) approval_grant_key: Option<String>,
    pub(super) execution_graph_execution_id: Option<String>,
    pub(super) execution_graph_gate_node_id: Option<String>,
    pub(super) execution_graph_tool_node_id: Option<String>,
    pub(super) approval_status: Option<String>,
    pub(super) created_at_unix_ms: i128,
    pub(super) expires_at_unix_ms: i128,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PersistedInFlightExecutionContext {
    pub(super) schema_version: i64,
    pub(super) session_id: String,
    pub(super) trace_id: String,
    pub(super) request_id: Option<String>,
    pub(super) execution_graph_execution_id: Option<String>,
    pub(super) stage: InFlightExecutionStage,
    pub(super) current_node: Option<String>,
    pub(super) current_call_id: Option<String>,
    #[serde(default)]
    pub(super) delegation: Option<PersistedDelegationWait>,
    pub(super) started_at_unix_ms: i64,
    pub(super) last_heartbeat_at_unix_ms: i64,
    pub(super) recoverable: bool,
    pub(super) pending_approvals: Vec<PersistedPendingApproval>,
    pub(super) chat_runtime: Option<PersistedChatToolRuntimeContext>,
    pub(super) last_error: Option<String>,
    pub(super) recovery_notice_emitted_at_unix_ms: Option<i64>,
}

pub(super) fn runtime_state_from_persisted_context(
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
        task_query: context.task_query,
        session_id: context.session_id,
        temperature: context.temperature,
        max_tokens: context.max_tokens,
        reasoning_enabled: context.reasoning_enabled,
        reasoning_effort: context.reasoning_effort,
        active_capability: context.active_capability,
        active_skill_context: context.active_skill_context,
        runtime_metrics: context.runtime_metrics,
        last_capability_snapshot: context.last_capability_snapshot,
        terminal_context: context.terminal_context,
        workflow_context: context.workflow_context,
        last_response: context.last_response,
        diting_think_consumed: false,
        captured_reasoning: None,
        realtime_emitter: LocalRealtimeToolTraceEmitter::new(None, None, None),
        selected_knowledge_file_ids: context.selected_knowledge_file_ids,
    }
}

pub(super) fn now_unix_ms_i64() -> i64 {
    (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

fn as_trimmed_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn build_pending_approval_records_from_tool_call_meta(
    tool_call_meta: &[serde_json::Value],
    default_session_id: &str,
) -> Vec<PersistedPendingApproval> {
    let now = now_unix_ms_i64() as i128;
    tool_call_meta
        .iter()
        .filter(|item| {
            item.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| status.eq_ignore_ascii_case("requires_approval"))
        })
        .filter_map(|item| {
            let result = item.get("result")?.as_object()?;
            let approval_token = as_trimmed_string(result.get("approval_token"))?;
            let expires_at_unix_ms = result
                .get("expires_at_unix_ms")
                .and_then(serde_json::Value::as_i64)
                .map(|value| value as i128)
                .or_else(|| {
                    result
                        .get("expires_in_ms")
                        .and_then(serde_json::Value::as_i64)
                        .map(|value| now + value as i128)
                })
                .unwrap_or(now + 5 * 60 * 1000);

            Some(PersistedPendingApproval {
                approval_token,
                tool_id: as_trimmed_string(result.get("tool_id")),
                tool_name: as_trimmed_string(item.get("name"))
                    .or_else(|| as_trimmed_string(result.get("tool_name")))
                    .unwrap_or_else(|| "unknown_tool".to_string()),
                arguments: result
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({})),
                call_id: as_trimmed_string(item.get("id")),
                execution_token: as_trimmed_string(result.get("execution_token")),
                session_id: as_trimmed_string(result.get("session_id"))
                    .or_else(|| Some(default_session_id.to_string())),
                description: as_trimmed_string(result.get("description")),
                risk_level: as_trimmed_string(result.get("risk_level")),
                risk_reasons: result
                    .get("risk_reasons")
                    .and_then(serde_json::Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item.as_str().map(str::trim))
                            .filter(|value| !value.is_empty())
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default(),
                tool_fingerprint: as_trimmed_string(result.get("tool_fingerprint"))
                    .unwrap_or_else(|| "unknown-fingerprint".to_string()),
                policy_rule_key: as_trimmed_string(result.get("policy_rule_key")),
                approval_grant_key: as_trimmed_string(result.get("approval_grant_key")),
                execution_graph_execution_id: as_trimmed_string(
                    result.get("execution_graph_execution_id"),
                ),
                execution_graph_gate_node_id: as_trimmed_string(
                    result.get("execution_graph_gate_node_id"),
                ),
                execution_graph_tool_node_id: as_trimmed_string(
                    result.get("execution_graph_tool_node_id"),
                ),
                approval_status: as_trimmed_string(result.get("approval_status"))
                    .or_else(|| Some("waiting_approval".to_string())),
                created_at_unix_ms: result
                    .get("created_at_unix_ms")
                    .and_then(serde_json::Value::as_i64)
                    .map(|value| value as i128)
                    .unwrap_or(now),
                expires_at_unix_ms,
            })
        })
        .collect()
}

pub(super) fn persistable_inflight_context_from_value(
    value: &serde_json::Value,
) -> Option<PersistedInFlightExecutionContext> {
    serde_json::from_value::<PersistedInFlightExecutionContext>(value.clone()).ok()
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn mark_delegated_wait_event_consumed(
    persisted: &mut PersistedInFlightExecutionContext,
    delegated_run_id: &str,
    event_id: &str,
) -> Result<bool, String> {
    if persisted.stage != InFlightExecutionStage::DelegatedWorkflowRunning {
        let stage = serde_json::to_value(&persisted.stage)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_else(|| "unknown".to_string());
        return Err(format!(
            "expected delegated_workflow_running stage, got {stage}"
        ));
    }

    let normalized_run_id = delegated_run_id.trim();
    if normalized_run_id.is_empty() {
        return Err("delegated_run_id is required".to_string());
    }

    let normalized_event_id = event_id.trim();
    if normalized_event_id.is_empty() {
        return Err("event_id is required".to_string());
    }

    let expected_run_id = persisted
        .delegation
        .as_ref()
        .ok_or_else(|| "delegated runtime context is missing delegation".to_string())?
        .delegated_run_id
        .trim();
    let expected_run_id = (!expected_run_id.is_empty())
        .then_some(expected_run_id)
        .ok_or_else(|| "delegated runtime context is missing delegated_run_id".to_string())?;

    if expected_run_id != normalized_run_id {
        return Err(format!(
            "delegated_run_id mismatch: expected '{}', got '{}'",
            expected_run_id, normalized_run_id
        ));
    }

    let delegation = persisted
        .delegation
        .as_mut()
        .expect("delegation should exist after validation");

    if delegation
        .consumed_event_ids
        .iter()
        .any(|consumed| consumed.trim() == normalized_event_id)
    {
        return Ok(false);
    }

    delegation
        .consumed_event_ids
        .push(normalized_event_id.to_string());
    persisted.last_heartbeat_at_unix_ms = now_unix_ms_i64();
    Ok(true)
}

#[allow(dead_code)]
pub(crate) async fn consume_delegated_wait_event_marker(
    store: &crate::modules::mcp::store::McpStore,
    execution_id: &str,
    delegated_run_id: &str,
    event_id: &str,
) -> Result<serde_json::Value, String> {
    let normalized_execution_id = execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Err("execution_id is required".to_string());
    }

    let context = load_execution_graph_runtime_context(store, normalized_execution_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| {
            format!(
                "delegated runtime context not found for execution_id {normalized_execution_id}"
            )
        })?;
    let mut persisted = persistable_inflight_context_from_value(&context)
        .ok_or_else(|| "delegated runtime context could not be parsed".to_string())?;

    let consumed = mark_delegated_wait_event_consumed(&mut persisted, delegated_run_id, event_id)?;
    if consumed {
        persist_execution_graph_runtime_context(
            store,
            normalized_execution_id,
            &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
        )
        .await
        .map_err(|err| err.to_string())?;
    }

    Ok(serde_json::json!({
        "status": if consumed { "consumed" } else { "duplicate" },
        "execution_graph_execution_id": normalized_execution_id,
        "delegated_run_id": delegated_run_id.trim(),
        "event_id": event_id.trim(),
        "stage": persisted.stage,
    }))
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
    approval_token: Option<&str>,
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
    if let Some(expected_approval_token) = approval_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let has_matching_token = persisted
            .pending_approvals
            .iter()
            .any(|pending| pending.approval_token.trim() == expected_approval_token);
        if !has_matching_token {
            return None;
        }
    }
    Some(persisted)
}

async fn load_canonical_waiting_approval_context_by_execution_id(
    store: &crate::modules::mcp::store::McpStore,
    execution_id: &str,
    session_id: Option<&str>,
    approval_token: Option<&str>,
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
    Ok(canonical_waiting_approval_context(
        context,
        normalized_execution_id,
        session_id,
        approval_token,
    )
    .map(|persisted| (normalized_execution_id.to_string(), persisted)))
}

async fn list_canonical_waiting_approval_contexts(
    store: &crate::modules::mcp::store::McpStore,
    session_id: Option<&str>,
    approval_token: Option<&str>,
) -> Result<Vec<(String, PersistedInFlightExecutionContext)>, String> {
    let rows = list_execution_graph_runtime_contexts(store)
        .await
        .map_err(|err| err.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            canonical_waiting_approval_context(
                row.context,
                row.execution_id.as_str(),
                session_id,
                approval_token,
            )
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
        "approval_status": matched.pending.approval_status.clone().unwrap_or_else(|| "waiting_approval".to_string()),
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

    let Some(execution_id) = execution_graph_execution_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(
            "execution_graph_execution_id is required for canonical approval lookup".to_string(),
        );
    };

    let contexts = load_canonical_waiting_approval_context_by_execution_id(
        store,
        execution_id,
        None,
        Some(normalized_token),
    )
    .await?
    .into_iter()
    .collect::<Vec<_>>();

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
    let contexts = list_canonical_waiting_approval_contexts(store, session_id, None).await?;
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
        return Ok(None);
    };

    let graph_snapshot =
        load_execution_graph_snapshot(app_state.mcp.store.as_ref(), matched.execution_id.as_str())
            .await
            .map_err(|err| err.to_string())?;
    let graph_says_waiting = graph_snapshot
        .as_ref()
        .map(|graph| collect_waiting_approval_tokens_from_graph(graph).contains(normalized_token))
        .unwrap_or(false);
    if !graph_says_waiting {
        log::warn!(
            "materialize_skipped_graph_not_waiting approval_token={} execution_id={}",
            normalized_token,
            matched.execution_id,
        );
        return Ok(None);
    }

    let expires_at_unix_ms = (now_unix_ms_i64() as i128) + app_state.mcp.pending_tool_call_ttl_ms();
    Ok(Some(pending_tool_call_from_persisted_approval(
        &matched.pending,
        Some(matched.execution_id.as_str()),
        expires_at_unix_ms,
    )))
}

pub(crate) fn serialize_inflight_runtime_context(
    stage: InFlightExecutionStage,
    current_node: Option<String>,
    current_call_id: Option<String>,
    recoverable: bool,
    pending_approvals: Vec<PersistedPendingApproval>,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    session_id: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
    last_error: Option<&str>,
) -> serde_json::Value {
    serialize_inflight_runtime_context_with_delegation(
        stage,
        current_node,
        current_call_id,
        None,
        recoverable,
        pending_approvals,
        chat_runtime,
        session_id,
        trace_id,
        request_id,
        execution_graph_execution_id,
        last_error,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn serialize_delegated_runtime_context(
    current_node: Option<String>,
    current_call_id: Option<String>,
    delegated_kind: &str,
    delegated_run_id: String,
    target_id: Option<&str>,
    target_name: Option<&str>,
    last_status: Option<&str>,
    recoverable: bool,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    session_id: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
    last_error: Option<&str>,
) -> serde_json::Value {
    let normalized_delegated_run_id = delegated_run_id.trim().to_string();
    let delegation = (!normalized_delegated_run_id.is_empty()).then(|| PersistedDelegationWait {
        kind: delegated_kind.trim().to_string(),
        delegated_run_id: normalized_delegated_run_id,
        delegated_target_id: target_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        delegated_target_name: target_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        resume_policy: "on_completed".to_string(),
        consumed_event_ids: Vec::new(),
        last_status: last_status
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        result_ref: None,
        started_at_unix_ms: now_unix_ms_i64(),
    });

    serialize_inflight_runtime_context_with_delegation(
        InFlightExecutionStage::DelegatedWorkflowRunning,
        current_node,
        current_call_id,
        delegation,
        recoverable,
        Vec::new(),
        chat_runtime,
        session_id,
        trace_id,
        request_id,
        execution_graph_execution_id,
        last_error,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn serialize_delegated_workflow_runtime_context(
    current_node: Option<String>,
    current_call_id: Option<String>,
    workflow_run_id: String,
    target_id: Option<&str>,
    target_name: Option<&str>,
    last_status: Option<&str>,
    recoverable: bool,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    session_id: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
    last_error: Option<&str>,
) -> serde_json::Value {
    serialize_delegated_runtime_context(
        current_node,
        current_call_id,
        "workflow",
        workflow_run_id,
        target_id,
        target_name,
        last_status,
        recoverable,
        chat_runtime,
        session_id,
        trace_id,
        request_id,
        execution_graph_execution_id,
        last_error,
    )
}

#[allow(clippy::too_many_arguments)]
fn serialize_inflight_runtime_context_with_delegation(
    stage: InFlightExecutionStage,
    current_node: Option<String>,
    current_call_id: Option<String>,
    delegation: Option<PersistedDelegationWait>,
    recoverable: bool,
    pending_approvals: Vec<PersistedPendingApproval>,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    session_id: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
    last_error: Option<&str>,
) -> serde_json::Value {
    let schema_version = if delegation.is_some() { 2 } else { 1 };
    serde_json::to_value(PersistedInFlightExecutionContext {
        schema_version,
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
        delegation,
        started_at_unix_ms: now_unix_ms_i64(),
        last_heartbeat_at_unix_ms: now_unix_ms_i64(),
        recoverable,
        pending_approvals,
        chat_runtime,
        last_error: last_error
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        recovery_notice_emitted_at_unix_ms: None,
    })
    .unwrap_or_else(|_| serde_json::json!({}))
}

pub(super) async fn persist_running_tool_execution_runtime(
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
                task_query: state.task_query.clone(),
                session_id: state.session_id.clone(),
                temperature: state.temperature,
                max_tokens: state.max_tokens,
                reasoning_enabled: state.reasoning_enabled,
                reasoning_effort: state.reasoning_effort.clone(),
                active_capability: state.active_capability.clone(),
                active_skill_context: state.active_skill_context.clone(),
                runtime_metrics: state.runtime_metrics.clone(),
                last_capability_snapshot: state.last_capability_snapshot.clone(),
                terminal_context: state.terminal_context.clone(),
                workflow_context: state.workflow_context.clone(),
                last_response: state.last_response.clone(),
                selected_knowledge_file_ids: state.selected_knowledge_file_ids.clone(),
            }),
            state.session_id.as_str(),
            state.trace_id.as_str(),
            state.request_id.as_deref(),
            Some(execution_id),
            None,
        );
        persist_execution_graph_runtime_context(store, execution_id, &context)
            .await
            .map_err(|err| err.to_string())?;
    }

    Ok(execution_id)
}

/// Collects the set of approval tokens that the execution graph currently reports
/// as "still waiting for user approval".
///
/// The graph is the authoritative source of approval state. A token is considered
/// still-pending only when an `approval_gate` node carries it in
/// `metadata.approval_token` AND the node status is `waiting_approval` or
/// `approval_failed`.
///
/// `"approving"` is intentionally EXCLUDED: that status marks an approve that has
/// started consuming the token but has not finished advancing the runtime. Such a
/// token is not safe to resurrect as a fresh approval dialog — it must be
/// resolved through the recovery-notice path, not replayed.
pub(crate) fn collect_waiting_approval_tokens_from_graph(
    execution_graph: &serde_json::Value,
) -> std::collections::HashSet<String> {
    execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|node| {
            node.get("node_type").and_then(serde_json::Value::as_str) == Some("approval_gate")
        })
        .filter(|node| {
            node.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| matches!(status, "waiting_approval" | "approval_failed"))
        })
        .filter_map(|node| {
            node.get("metadata")
                .and_then(|value| value.get("approval_token"))
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}

/// Filters `pending_approvals` to retain only entries whose `approval_token` the
/// execution graph currently reports as waiting. Lower-level variant of
/// `derive_pending_approvals_from_graph` for code paths that hold the graph and
/// the list separately (e.g. after loading both from the persisted store).
pub(super) fn filter_pending_approvals_by_graph(
    execution_graph: &serde_json::Value,
    pending_approvals: &[PersistedPendingApproval],
) -> Vec<PersistedPendingApproval> {
    let waiting_tokens = collect_waiting_approval_tokens_from_graph(execution_graph);
    pending_approvals
        .iter()
        .filter(|pending| waiting_tokens.contains(pending.approval_token.trim()))
        .cloned()
        .collect()
}

/// Projects the authoritative `pending_approvals` list for `suspended` by keeping
/// only the entries whose `approval_token` the execution graph currently reports
/// as waiting. Anything the graph has moved past (completed / approving /
/// rejected) is dropped.
///
/// This is the function callers SHOULD use when persisting an inflight runtime
/// context — never pass `suspended.pending_approvals()` directly, because that
/// list can lag behind the graph during the approve critical section.
pub(crate) fn derive_pending_approvals_from_graph(
    suspended: &SuspendedChatToolExecution,
) -> Vec<PersistedPendingApproval> {
    filter_pending_approvals_by_graph(suspended.execution_graph(), suspended.pending_approvals())
}

/// Logs a warning when the persisted `pending_approvals` list disagrees with the
/// authoritative graph projection. Observation-only: does not alter behavior.
///
/// - `persisted_extra`: tokens present in `pending_approvals` but NOT reported as
///   waiting in the graph (likely zombies — already consumed or in-flight).
/// - `graph_missing`: tokens the graph reports as waiting but that are absent
///   from `pending_approvals` (list drifted behind the graph).
fn log_pending_approvals_drift(
    suspended: &SuspendedChatToolExecution,
    pending_approvals: &[PersistedPendingApproval],
    source_kind: &str,
    stage: &InFlightExecutionStage,
) {
    let graph_tokens = collect_waiting_approval_tokens_from_graph(suspended.execution_graph());
    let persisted_tokens: std::collections::HashSet<String> = pending_approvals
        .iter()
        .map(|pending| pending.approval_token.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();

    let persisted_extra: Vec<&String> = persisted_tokens.difference(&graph_tokens).collect();
    let graph_missing: Vec<&String> = graph_tokens.difference(&persisted_tokens).collect();

    if persisted_extra.is_empty() && graph_missing.is_empty() {
        return;
    }

    log::warn!(
        "pending_approvals_drift source_kind={} stage={:?} execution_id={:?} persisted_extra={:?} graph_missing={:?}",
        source_kind,
        stage,
        suspended.graph_execution_id(),
        persisted_extra,
        graph_missing,
    );
}

pub(crate) async fn persist_suspended_execution_graph_runtime(
    store: &crate::modules::mcp::store::McpStore,
    suspended: &SuspendedChatToolExecution,
    pending_approvals: &[PersistedPendingApproval],
    source_kind: &str,
    status: &str,
    stage: InFlightExecutionStage,
    last_error: Option<&str>,
) -> Result<(), String> {
    log_pending_approvals_drift(suspended, pending_approvals, source_kind, &stage);

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
            stage,
            Some(suspended.pending_gate_node_id().to_string()),
            Some(suspended.pending_call_id().to_string()),
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
                task_query: suspended.task_query.clone(),
                session_id: suspended.session_id.clone(),
                temperature: suspended.temperature,
                max_tokens: suspended.max_tokens,
                reasoning_enabled: suspended.reasoning_enabled,
                reasoning_effort: suspended.reasoning_effort.clone(),
                active_capability: suspended.active_capability.clone(),
                active_skill_context: suspended.active_skill_context.clone(),
                runtime_metrics: suspended.runtime_metrics.clone(),
                last_capability_snapshot: suspended.last_capability_snapshot.clone(),
                terminal_context: suspended.terminal_context.clone(),
                workflow_context: suspended.workflow_context.clone(),
                last_response: suspended.last_response.clone(),
                selected_knowledge_file_ids: suspended.selected_knowledge_file_ids.clone(),
            }),
            suspended.session_id.as_str(),
            suspended.trace_id.as_str(),
            suspended.request_id.as_deref(),
            Some(execution_id),
            last_error,
        );
        persist_execution_graph_runtime_context(store, execution_id, &context)
            .await
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

pub(super) async fn clear_execution_graph_runtime_context(
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

pub(crate) async fn load_suspended_chat_tool_execution_for_resume(
    app_state: &AppState,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
) -> Result<Option<SuspendedChatToolExecution>, String> {
    async fn suspended_from_persisted_execution(
        app_state: &AppState,
        execution_id: &str,
    ) -> Result<Option<SuspendedChatToolExecution>, String> {
        let Some(execution_graph) =
            load_execution_graph_snapshot(app_state.mcp.store.as_ref(), execution_id)
                .await
                .map_err(|err| err.to_string())?
        else {
            return Ok(None);
        };

        let Some(runtime_context) =
            load_execution_graph_runtime_context(app_state.mcp.store.as_ref(), execution_id)
                .await
                .map_err(|err| err.to_string())?
        else {
            return Ok(None);
        };

        let persisted_inflight = persistable_inflight_context_from_value(&runtime_context);
        let raw_pending_approvals = persisted_inflight
            .as_ref()
            .map(|context| context.pending_approvals.clone())
            .unwrap_or_default();
        let persisted_pending_approvals =
            filter_pending_approvals_by_graph(&execution_graph, &raw_pending_approvals);
        if raw_pending_approvals.len() != persisted_pending_approvals.len() {
            log::warn!(
                "pending_approvals_drift_on_load execution_id={} dropped={} kept={}",
                execution_id,
                raw_pending_approvals.len() - persisted_pending_approvals.len(),
                persisted_pending_approvals.len(),
            );
        }
        let persisted_context = persisted_inflight
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
                        task_query: None,
                        session_id: execution_graph
                            .get("session_id")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        temperature: None,
                        max_tokens: None,
                        reasoning_enabled: None,
                        reasoning_effort: None,
                        active_capability: None,
                        active_skill_context: None,
                        runtime_metrics: RuntimeMetricsAccumulator::default(),
                        last_capability_snapshot: None,
                        terminal_context: None,
                        workflow_context: None,
                        last_response: None,
                        selected_knowledge_file_ids: Vec::new(),
                    }
                })
            });
        let state = runtime_state_from_persisted_context(persisted_context);
        Ok(Some(SuspendedChatToolExecution {
            max_rounds: state.max_rounds,
            round: state.round,
            trace_id: state.trace_id.clone(),
            request_id: state.request_id.clone(),
            execution_policy: state.execution_policy.clone(),
            model_connection: state.model_connection.clone(),
            orchestrated_messages: state.orchestrated_messages.clone(),
            task_query: state.task_query.clone(),
            session_id: state.session_id.clone(),
            temperature: state.temperature,
            max_tokens: state.max_tokens,
            reasoning_enabled: state.reasoning_enabled,
            reasoning_effort: state.reasoning_effort.clone(),
            active_capability: state.active_capability.clone(),
            active_skill_context: state.active_skill_context.clone(),
            runtime_metrics: state.runtime_metrics.clone(),
            last_capability_snapshot: state.last_capability_snapshot.clone(),
            terminal_context: state.terminal_context.clone(),
            workflow_context: state.workflow_context.clone(),
            last_response: state.last_response.clone(),
            pending_approvals: persisted_pending_approvals,
            execution_graph,
            selected_knowledge_file_ids: state.selected_knowledge_file_ids.clone(),
        }))
    }

    if let Some(execution_id) = execution_graph_execution_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Some(suspended) = suspended_from_persisted_execution(app_state, execution_id).await?
        {
            return Ok(Some(suspended));
        }
    }

    let normalized_token = approval_token.trim();
    if !normalized_token.is_empty() {
        let contexts = list_canonical_waiting_approval_contexts(
            app_state.mcp.store.as_ref(),
            None,
            Some(normalized_token),
        )
        .await?;
        if let Some((execution_id, _)) = contexts.into_iter().next() {
            if let Some(suspended) =
                suspended_from_persisted_execution(app_state, execution_id.as_str()).await?
            {
                return Ok(Some(suspended));
            }
        }
    }

    Ok(None)
}

pub(super) fn pending_tool_call_from_persisted_approval(
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
        approval_status: pending.approval_status.clone(),
        created_at_unix_ms: pending.created_at_unix_ms,
        expires_at_unix_ms,
    }
}

#[cfg(test)]
mod graph_projection_tests {
    use super::collect_waiting_approval_tokens_from_graph;

    fn approval_gate_node(
        node_id: &str,
        status: &str,
        approval_token: Option<&str>,
    ) -> serde_json::Value {
        let metadata = match approval_token {
            Some(token) => serde_json::json!({ "approval_token": token }),
            None => serde_json::json!({}),
        };
        serde_json::json!({
            "node_id": node_id,
            "node_type": "approval_gate",
            "status": status,
            "metadata": metadata,
        })
    }

    fn graph_with_nodes(nodes: Vec<serde_json::Value>) -> serde_json::Value {
        serde_json::json!({ "nodes": nodes })
    }

    #[test]
    fn collects_tokens_only_from_waiting_approval_gates() {
        let graph = graph_with_nodes(vec![
            approval_gate_node("gate-1", "waiting_approval", Some("token-1")),
            approval_gate_node("gate-2", "completed", Some("token-2")),
            approval_gate_node("gate-3", "approving", Some("token-3")),
            approval_gate_node("gate-4", "approval_failed", Some("token-4")),
        ]);

        let tokens = collect_waiting_approval_tokens_from_graph(&graph);

        assert!(
            tokens.contains("token-1"),
            "waiting_approval must be collected"
        );
        assert!(
            tokens.contains("token-4"),
            "approval_failed must be collected"
        );
        assert!(
            !tokens.contains("token-3"),
            "approving MUST be excluded to prevent replay of an in-flight approve"
        );
        assert!(!tokens.contains("token-2"));
        assert_eq!(tokens.len(), 2);
    }

    #[test]
    fn ignores_non_approval_gate_nodes() {
        let graph = serde_json::json!({
            "nodes": [
                {
                    "node_id": "tool-1",
                    "node_type": "tool_call",
                    "status": "waiting_approval",
                    "metadata": { "approval_token": "ghost-token" }
                }
            ]
        });

        let tokens = collect_waiting_approval_tokens_from_graph(&graph);
        assert!(tokens.is_empty());
    }

    #[test]
    fn skips_gates_missing_or_empty_tokens() {
        let graph = graph_with_nodes(vec![
            approval_gate_node("gate-1", "waiting_approval", None),
            approval_gate_node("gate-2", "waiting_approval", Some("   ")),
            approval_gate_node("gate-3", "waiting_approval", Some("valid")),
        ]);

        let tokens = collect_waiting_approval_tokens_from_graph(&graph);
        assert_eq!(tokens.len(), 1);
        assert!(tokens.contains("valid"));
    }

    #[test]
    fn handles_missing_or_malformed_graph() {
        assert!(collect_waiting_approval_tokens_from_graph(&serde_json::json!({})).is_empty());
        assert!(collect_waiting_approval_tokens_from_graph(&serde_json::json!(null)).is_empty());
        assert!(collect_waiting_approval_tokens_from_graph(
            &serde_json::json!({ "nodes": "not-an-array" })
        )
        .is_empty());
    }
}
