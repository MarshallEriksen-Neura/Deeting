// Phase 8: Stateless delegation batch operations
// All state lives in persisted MultiAgentSnapshot; no runtime-local HashMap.

use super::super::audit;
use super::super::lifecycle::{
    now_unix_ms_i64, persisted_chat_runtime_context_from_state,
    resume_delegated_runtime_after_custom_task_agent_run,
    serialize_delegated_runtime_context_with_task_input_source,
};
use super::super::runtime_state::LocalChatToolRuntimeState;
use crate::modules::custom_task_agents::agent_types::{
    build_ephemeral_agent_profile, parse_ephemeral_agent_spec,
};
use crate::modules::custom_task_agents::runtime::preview_custom_task_agent_with_parent_model;
use crate::modules::custom_task_agents::store::{
    cancel_custom_task_agent_run, complete_custom_task_agent_run, create_custom_task_agent_run,
    fail_custom_task_agent_run, get_custom_task_agent_run,
};
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentPreviewRequest, CustomTaskAgentProfile, CustomTaskAgentRunStatus,
};
use crate::modules::desktop_runtime::runtime::execution_plane::{
    build_custom_task_agent_delegated_execution_session, DelegatedExecutionKind,
    DelegatedExecutionPacketReceipt, DelegatedExecutionSelection, DelegatedExecutionSession,
    DelegatedExecutionStatus,
};
use crate::modules::desktop_runtime::runtime::worker_dispatch::{
    build_worker_task_packet, custom_task_agent_return_channel, delegated_agent_task_input_source,
    select_explicit_worker_custom_task_agent, WorkerTargetSelection, WorkerTaskPacket,
    WorkerTaskPacketInput,
};
use crate::modules::desktop_runtime::runtime::{
    ensure_execution_graph_run_row, load_execution_graph_runtime_context,
    persist_execution_graph_runtime_context,
};
use crate::modules::mcp::commands::common_impl::LocalModelConnection;
use crate::state::AppState;
use desktop_runtime_core::ApprovalInheritance;
use multi_agent_core::{
    AgentTaskSpec, ChildSnapshot, ChildState, JoinOutcome, JoinPolicy, JoinSelection,
    MultiAgentCommand, MultiAgentEvent, MultiAgentPlan, MultiAgentSnapshot, WriteScope,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct DelegateAgentsToolExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
}

const MULTI_AGENT_BATCH_CONTEXT_KIND: &str = "multi_agent_batch";

fn multi_agent_batch_execution_id(batch_id: &str) -> String {
    format!("multi_agent_batch:{batch_id}")
}

// Phase 8: Projection from MultiAgentSnapshot to JSON without runtime-local records.
fn child_json_from_snapshot(child: &ChildSnapshot, recovery_meta: Option<&Value>) -> Value {
    let status_str = match child.state {
        ChildState::Queued => "queued",
        ChildState::Running => "running",
        ChildState::Completed => "completed",
        ChildState::Failed => "failed",
        ChildState::Cancelled => "cancelled",
        ChildState::Blocked => "failed",
        ChildState::LostAfterRestart => "failed",
    };
    let write_scope_str = match &child.spec.write_scope {
        WriteScope::ReadOnly => "read_only",
        WriteScope::WorkspaceWrite { .. } => "workspace_write",
        WriteScope::GlobalState => "global_state",
    };
    let world_model_delta_candidate = child
        .result
        .as_ref()
        .and_then(world_model_delta_candidate_from_result);

    let execution_id = recovery_meta
        .and_then(|m| m.get("execution_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| child.task_id.clone());
    let agent_id = recovery_meta
        .and_then(|m| m.get("agent_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| child.spec.agent_id.clone())
        .unwrap_or_default();
    let agent_name = recovery_meta
        .and_then(|m| m.get("agent_name"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| child.spec.agent_id.clone())
        .or_else(|| child.spec.agent_type.clone())
        .unwrap_or_else(|| "Delegated agent".to_string());
    let agent_source = recovery_meta
        .and_then(|m| m.get("agent_source"))
        .and_then(Value::as_str)
        .unwrap_or("persisted_snapshot");
    let started_at_ms = recovery_meta
        .and_then(|m| m.get("started_at_ms"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let completed_at_ms = recovery_meta
        .and_then(|m| m.get("completed_at_ms"))
        .and_then(Value::as_i64);
    let failure = child_failure_diagnostics(child, recovery_meta);

    let mut record = json!({
        "child_run_id": child.child_id,
        "execution_id": execution_id,
        "agent_id": agent_id,
        "agent_type": child.spec.agent_type,
        "agent_name": agent_name,
        "agent_source": agent_source,
        "task": child.spec.task,
        "write_scope": write_scope_str,
        "status": status_str,
        "delegated_result": child.result,
        "world_model_delta_candidate": world_model_delta_candidate,
        "started_at_ms": started_at_ms,
        "completed_at_ms": completed_at_ms,
    });
    if let Some(failure) = failure {
        if let Some(object) = record.as_object_mut() {
            object.insert(
                "error".to_string(),
                failure
                    .get("error")
                    .cloned()
                    .unwrap_or_else(|| Value::String("delegated child failed".to_string())),
            );
            object.insert(
                "error_code".to_string(),
                failure
                    .get("error_code")
                    .cloned()
                    .unwrap_or_else(|| Value::String("CHILD_FAILED".to_string())),
            );
            object.insert(
                "failure_stage".to_string(),
                failure
                    .get("failure_stage")
                    .cloned()
                    .unwrap_or_else(|| Value::String("runtime".to_string())),
            );
            object.insert(
                "failure_reason".to_string(),
                failure
                    .get("failure_reason")
                    .cloned()
                    .unwrap_or_else(|| Value::String("delegated child failed".to_string())),
            );
            object.insert("diagnostics".to_string(), failure);
        }
    }
    record
}

fn child_failure_diagnostics(child: &ChildSnapshot, recovery_meta: Option<&Value>) -> Option<Value> {
    if !matches!(
        child.state,
        ChildState::Failed | ChildState::Blocked | ChildState::LostAfterRestart | ChildState::Cancelled
    ) {
        return None;
    }
    let raw_error = child
        .error
        .as_deref()
        .or_else(|| child.result.as_ref().and_then(|value| value.get("error")).and_then(Value::as_str))
        .or_else(|| {
            child
                .result
                .as_ref()
                .and_then(|value| value.pointer("/primary_output/message"))
                .and_then(Value::as_str)
        })
        .unwrap_or("delegated child failed")
        .trim();
    let error = if raw_error.is_empty() {
        "delegated child failed"
    } else {
        raw_error
    };
    let error_code = classify_child_failure_code(error, child, recovery_meta);
    let failure_stage = classify_child_failure_stage(error, child, recovery_meta);
    Some(json!({
        "error": error,
        "error_code": error_code,
        "failure_stage": failure_stage,
        "failure_reason": error,
        "agent_source": recovery_meta
            .and_then(|m| m.get("agent_source"))
            .and_then(Value::as_str)
            .unwrap_or("persisted_snapshot"),
        "agent_id": recovery_meta
            .and_then(|m| m.get("agent_id"))
            .and_then(Value::as_str)
            .or_else(|| child.spec.agent_id.as_deref())
            .unwrap_or(""),
        "agent_type": child.spec.agent_type.clone(),
        "selection_reason": recovery_meta
            .and_then(|m| m.get("selection_reason"))
            .and_then(Value::as_str),
        "selection_reason_codes": recovery_meta
            .and_then(|m| m.get("selection_reason_codes"))
            .cloned()
            .unwrap_or_else(|| json!([])),
        "callable_coverage_score": recovery_meta
            .and_then(|m| m.get("callable_coverage_score"))
            .cloned()
            .unwrap_or(Value::Null),
    }))
}

fn classify_child_failure_code(
    error: &str,
    child: &ChildSnapshot,
    recovery_meta: Option<&Value>,
) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("not enabled for the current execution policy")
        || lower.contains("local_tool_policy_blocked")
        || lower.contains("policy blocked")
    {
        "TOOL_POLICY_BLOCKED"
    } else if lower.contains("capability") || lower.contains("callable") || lower.contains("tool") {
        "CAPABILITY_MISMATCH"
    } else if lower.contains("upstream") || lower.contains("provider") || lower.contains("model") {
        "UPSTREAM_FAILED"
    } else if lower.contains("timeout") || lower.contains("timed out") {
        "CHILD_TIMEOUT"
    } else if lower.contains("cancel") {
        "CHILD_CANCELLED"
    } else if recovery_meta
        .and_then(|m| m.get("agent_source"))
        .and_then(Value::as_str)
        == Some("ephemeral")
        && child.spec.agent_type.as_deref() == Some("explore")
    {
        "EPHEMERAL_AGENT_FAILED"
    } else {
        "CHILD_FAILED"
    }
}

fn classify_child_failure_stage(
    error: &str,
    _child: &ChildSnapshot,
    _recovery_meta: Option<&Value>,
) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("background resume context") || lower.contains("persist") {
        "launch"
    } else if lower.contains("not enabled for the current execution policy")
        || lower.contains("local_tool_policy_blocked")
    {
        "tool_policy"
    } else if lower.contains("capability") || lower.contains("callable") || lower.contains("tool") {
        "capability_resolution"
    } else if lower.contains("upstream") || lower.contains("provider") || lower.contains("model") {
        "upstream"
    } else if lower.contains("timeout") || lower.contains("timed out") {
        "timeout"
    } else {
        "runtime"
    }
}

fn world_model_delta_candidate_from_result(result: &Value) -> Option<Value> {
    result
        .get("world_model_delta_candidate")
        .or_else(|| result.pointer("/primary_output/world_model_delta_candidate"))
        .cloned()
}

fn parent_world_model_merge_candidate_from_snapshot(
    snapshot: &MultiAgentSnapshot,
    recovery_index: Option<&Vec<Value>>,
) -> Option<Value> {
    let mut sources = Vec::new();
    let mut facts = Vec::new();
    let mut assumptions = Vec::new();
    let mut resolved_unknowns = Vec::new();
    let mut new_unknowns = Vec::new();
    let mut verification_targets = Vec::new();
    let mut risks = Vec::new();

    for child_id in &snapshot.child_order {
        let Some(child) = snapshot.children.get(child_id) else {
            continue;
        };
        let Some(candidate) = child
            .result
            .as_ref()
            .and_then(world_model_delta_candidate_from_result)
        else {
            continue;
        };
        let recovery_meta = recovery_index.and_then(|idx| find_recovery_meta(idx, child_id));
        let status_str = match child.state {
            ChildState::Completed => "completed",
            ChildState::Failed | ChildState::Blocked | ChildState::LostAfterRestart => "failed",
            ChildState::Cancelled => "cancelled",
            ChildState::Running => "running",
            ChildState::Queued => "queued",
        };
        let execution_id = recovery_meta
            .and_then(|m| m.get("execution_id"))
            .and_then(Value::as_str)
            .unwrap_or(child.task_id.as_str());
        let agent_id = recovery_meta
            .and_then(|m| m.get("agent_id"))
            .and_then(Value::as_str)
            .or_else(|| child.spec.agent_id.as_deref())
            .unwrap_or("");

        sources.push(json!({
            "child_run_id": child.child_id,
            "execution_id": execution_id,
            "agent_id": agent_id,
            "agent_type": child.spec.agent_type,
            "status": status_str,
        }));
        extend_string_field(&mut facts, &candidate, "facts");
        extend_string_field(&mut assumptions, &candidate, "assumptions");
        extend_string_field(&mut resolved_unknowns, &candidate, "resolved_unknowns");
        extend_string_field(&mut new_unknowns, &candidate, "new_unknowns");
        extend_string_field(
            &mut verification_targets,
            &candidate,
            "verification_targets",
        );
        extend_string_field(&mut risks, &candidate, "risks");
    }

    if sources.is_empty() {
        return None;
    }

    Some(json!({
        "type": "parent_world_model_merge_candidate",
        "authoritative": false,
        "parent_must_submit_world_model_update": true,
        "source": "wait_delegations",
        "source_children": sources,
        "facts": facts,
        "assumptions": assumptions,
        "resolved_unknowns": resolved_unknowns,
        "new_unknowns": new_unknowns,
        "verification_targets": verification_targets,
        "risks": risks,
    }))
}

fn extend_string_field(target: &mut Vec<String>, object: &Value, field: &str) {
    let Some(value) = object.get(field) else {
        return;
    };
    if let Some(items) = value.as_array() {
        for item in items {
            push_unique_string(target, item);
        }
    } else {
        push_unique_string(target, value);
    }
}

fn push_unique_string(target: &mut Vec<String>, value: &Value) {
    let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    else {
        return;
    };
    if !target.iter().any(|existing| existing == text) {
        target.push(text.to_string());
    }
}

fn find_recovery_meta<'a>(recovery_index: &'a [Value], child_run_id: &str) -> Option<&'a Value> {
    recovery_index.iter().find(|item| {
        item.get("child_run_id")
            .and_then(Value::as_str)
            .is_some_and(|value| value == child_run_id)
    })
}

// Phase 8: Stateless batch context operations
async fn load_batch_context(
    app_state: &AppState,
    batch_id: &str,
) -> Result<Option<BatchContext>, String> {
    let context = load_execution_graph_runtime_context(
        app_state.mcp.store.as_ref(),
        multi_agent_batch_execution_id(batch_id).as_str(),
    )
    .await
    .map_err(|err| err.to_string())?;
    let Some(context) = context else {
        return Ok(None);
    };
    if context.get("kind").and_then(Value::as_str) != Some(MULTI_AGENT_BATCH_CONTEXT_KIND) {
        return Ok(None);
    }
    let snapshot = context
        .get("core_snapshot")
        .cloned()
        .ok_or_else(|| format!("batch '{batch_id}' missing core_snapshot"))?;
    let snapshot = serde_json::from_value::<MultiAgentSnapshot>(snapshot)
        .map_err(|err| format!("batch '{batch_id}' invalid snapshot: {err}"))?;
    let recovery_index = context
        .get("recovery_index")
        .and_then(Value::as_array)
        .cloned();
    let launch_index = context
        .get("launch_index")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let launch_index = serde_json::from_value::<Vec<PreparedChildRunLaunchSnapshot>>(launch_index)
        .map_err(|err| format!("batch '{batch_id}' invalid launch_index: {err}"))?;
    Ok(Some(BatchContext {
        snapshot,
        recovery_index,
        launch_index,
    }))
}

struct BatchContext {
    snapshot: MultiAgentSnapshot,
    recovery_index: Option<Vec<Value>>,
    launch_index: Vec<PreparedChildRunLaunchSnapshot>,
}

async fn persist_batch_context(
    app_state: &AppState,
    batch_id: &str,
    snapshot: &MultiAgentSnapshot,
    recovery_index: &[Value],
    launch_index: &[PreparedChildRunLaunchSnapshot],
    session_id: Option<&str>,
    call_id: Option<&str>,
) -> Result<(), String> {
    let children_json = snapshot
        .child_order
        .iter()
        .filter_map(|child_id| snapshot.children.get(child_id))
        .map(|child| {
            let recovery_meta = find_recovery_meta(recovery_index, child.child_id.as_str());
            child_json_from_snapshot(child, recovery_meta)
        })
        .collect::<Vec<_>>();
    let progress_events = build_status_progress_events(batch_id, &children_json);
    let context = json!({
        "schema_version": 1,
        "kind": MULTI_AGENT_BATCH_CONTEXT_KIND,
        "batch_id": batch_id,
        "session_id": session_id,
        "last_call_id": call_id,
        "updated_at_unix_ms": now_unix_ms_i64(),
        "core_snapshot": snapshot,
        "recovery_index": recovery_index,
        "launch_index": launch_index,
        "progress_events": progress_events,
        "children": children_json,
    });
    let execution_id = multi_agent_batch_execution_id(batch_id);
    // Ensure a parent row exists in local_execution_graph_run before inserting into
    // local_execution_graph_runtime_context, which has a FOREIGN KEY constraint.
    ensure_execution_graph_run_row(
        app_state.mcp.store.as_ref(),
        execution_id.as_str(),
        session_id.unwrap_or(""),
        "delegation_batch",
        "delegation",
        "active",
        "delegation_batch",
    )
    .await
    .map_err(|err| err.to_string())?;
    persist_execution_graph_runtime_context(
        app_state.mcp.store.as_ref(),
        execution_id.as_str(),
        &context,
    )
    .await
    .map_err(|err| err.to_string())
}

// Phase 8: Concurrency control (global semaphore, no per-batch state)
struct ConcurrencyControl {
    semaphore: Arc<Semaphore>,
    notify: Arc<Notify>,
}

impl ConcurrencyControl {
    fn new(max_concurrent: usize) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
            notify: Arc::new(Notify::new()),
        }
    }

    async fn acquire_slot(&self) -> Result<OwnedSemaphorePermit, String> {
        self.semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| "delegation scheduler is closed".to_string())
    }

    fn notify_waiters(&self) {
        self.notify.notify_waiters();
    }

    async fn wait_notified(&self, timeout: Duration) -> bool {
        tokio::time::timeout(timeout, self.notify.notified())
            .await
            .is_ok()
    }
}

fn global_concurrency_control() -> &'static ConcurrencyControl {
    static CONTROL: std::sync::OnceLock<ConcurrencyControl> = std::sync::OnceLock::new();
    CONTROL.get_or_init(|| ConcurrencyControl::new(8))
}

// Phase 8: PreparedChildRun launch payloads are persisted so core-unlocked queued
// children can be spawned after the original start call returns.
struct PreparedChildRun {
    batch_id: String,
    child_run_id: String,
    execution_id: String,
    agent_type: Option<String>,
    agent_source: String,
    task: String,
    write_scope: String,
    profile: CustomTaskAgentProfile,
    execution_selection: DelegatedExecutionSelection,
    packet_receipt: DelegatedExecutionPacketReceipt,
    task_packet: WorkerTaskPacket,
    task_input_source_payload: Value,
    background_resume_context: Option<Value>,
    max_rounds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PreparedChildRunLaunchSnapshot {
    batch_id: String,
    child_run_id: String,
    execution_id: String,
    agent_type: Option<String>,
    agent_source: String,
    task: String,
    write_scope: String,
    profile: CustomTaskAgentProfile,
    execution_selection: PersistedDelegatedExecutionSelection,
    packet_receipt: DelegatedExecutionPacketReceipt,
    task_packet: WorkerTaskPacket,
    task_input_source_payload: Value,
    background_resume_context: Value,
    max_rounds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedDelegatedExecutionSelection {
    explicit: bool,
    score: Option<i32>,
    reason_codes: Vec<String>,
    reason_text: Option<String>,
    candidate_count: usize,
    selected_from_top_k: usize,
    callable_coverage_score: Option<f32>,
    modality_fit_score: Option<f32>,
    profile_prior_score: Option<f32>,
}

impl PreparedChildRun {
    fn launch_snapshot(&self) -> Result<PreparedChildRunLaunchSnapshot, String> {
        let background_resume_context = self
            .background_resume_context
            .clone()
            .ok_or_else(|| "prepared child run missing background resume context".to_string())?;
        Ok(PreparedChildRunLaunchSnapshot {
            batch_id: self.batch_id.clone(),
            child_run_id: self.child_run_id.clone(),
            execution_id: self.execution_id.clone(),
            agent_type: self.agent_type.clone(),
            agent_source: self.agent_source.clone(),
            task: self.task.clone(),
            write_scope: self.write_scope.clone(),
            profile: self.profile.clone(),
            execution_selection: PersistedDelegatedExecutionSelection::from(
                &self.execution_selection,
            ),
            packet_receipt: self.packet_receipt.clone(),
            task_packet: self.task_packet.clone(),
            task_input_source_payload: self.task_input_source_payload.clone(),
            background_resume_context,
            max_rounds: self.max_rounds,
        })
    }

    fn from_launch_snapshot(snapshot: PreparedChildRunLaunchSnapshot) -> Self {
        Self {
            batch_id: snapshot.batch_id,
            child_run_id: snapshot.child_run_id,
            execution_id: snapshot.execution_id,
            agent_type: snapshot.agent_type,
            agent_source: snapshot.agent_source,
            task: snapshot.task,
            write_scope: snapshot.write_scope,
            profile: snapshot.profile,
            execution_selection: DelegatedExecutionSelection::from(snapshot.execution_selection),
            packet_receipt: snapshot.packet_receipt,
            task_packet: snapshot.task_packet,
            task_input_source_payload: snapshot.task_input_source_payload,
            background_resume_context: Some(snapshot.background_resume_context),
            max_rounds: snapshot.max_rounds,
        }
    }
}

impl From<&DelegatedExecutionSelection> for PersistedDelegatedExecutionSelection {
    fn from(selection: &DelegatedExecutionSelection) -> Self {
        Self {
            explicit: selection.explicit,
            score: selection.score,
            reason_codes: selection.reason_codes.clone(),
            reason_text: selection.reason_text.clone(),
            candidate_count: selection.candidate_count,
            selected_from_top_k: selection.selected_from_top_k,
            callable_coverage_score: selection.callable_coverage_score,
            modality_fit_score: selection.modality_fit_score,
            profile_prior_score: selection.profile_prior_score,
        }
    }
}

impl From<PersistedDelegatedExecutionSelection> for DelegatedExecutionSelection {
    fn from(selection: PersistedDelegatedExecutionSelection) -> Self {
        Self {
            explicit: selection.explicit,
            score: selection.score,
            reason_codes: selection.reason_codes,
            reason_text: selection.reason_text,
            candidate_count: selection.candidate_count,
            selected_from_top_k: selection.selected_from_top_k,
            callable_coverage_score: selection.callable_coverage_score,
            modality_fit_score: selection.modality_fit_score,
            profile_prior_score: selection.profile_prior_score,
        }
    }
}

#[derive(Clone)]
struct ChildExecutionConfig {
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    model_connection: LocalModelConnection,
}

#[derive(Clone)]
struct AuditContext {
    session_id: String,
    trace_id: String,
    request_id: Option<String>,
    runtime_transition_blocks: Vec<Value>,
}

fn child_execution_config_from_state(state: &LocalChatToolRuntimeState) -> ChildExecutionConfig {
    ChildExecutionConfig {
        temperature: state.temperature,
        max_tokens: state.max_tokens,
        model_connection: state.model_connection.clone(),
    }
}

fn audit_context_from_state(session_id: &str, state: &LocalChatToolRuntimeState) -> AuditContext {
    AuditContext {
        session_id: session_id.to_string(),
        trace_id: state.trace_id.clone(),
        request_id: state.request_id.clone(),
        runtime_transition_blocks: state.runtime_transition_blocks.clone(),
    }
}

// Phase 8: Recovery metadata builder
fn build_recovery_index(
    snapshot: &MultiAgentSnapshot,
    recovery_index: Option<&Vec<Value>>,
) -> Vec<Value> {
    snapshot
        .child_order
        .iter()
        .filter_map(|child_id| {
            let child = snapshot.children.get(child_id)?;
            let existing_meta = recovery_index.and_then(|idx| find_recovery_meta(idx, child_id));
            Some(json!({
                "child_run_id": child.child_id,
                "execution_id": existing_meta
                    .and_then(|m| m.get("execution_id"))
                    .and_then(Value::as_str)
                    .unwrap_or(child.task_id.as_str()),
                "agent_id": existing_meta
                    .and_then(|m| m.get("agent_id"))
                    .and_then(Value::as_str)
                    .or_else(|| child.spec.agent_id.as_deref())
                    .unwrap_or(""),
                "agent_name": existing_meta
                    .and_then(|m| m.get("agent_name"))
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                "agent_source": existing_meta
                    .and_then(|m| m.get("agent_source"))
                    .and_then(Value::as_str)
                    .unwrap_or("persisted_snapshot"),
                "selection_reason": existing_meta
                    .and_then(|m| m.get("selection_reason"))
                    .cloned(),
                "selection_reason_codes": existing_meta
                    .and_then(|m| m.get("selection_reason_codes"))
                    .cloned(),
                "callable_coverage_score": existing_meta
                    .and_then(|m| m.get("callable_coverage_score"))
                    .cloned(),
                "modality_fit_score": existing_meta
                    .and_then(|m| m.get("modality_fit_score"))
                    .cloned(),
                "profile_prior_score": existing_meta
                    .and_then(|m| m.get("profile_prior_score"))
                    .cloned(),
                "max_rounds": existing_meta
                    .and_then(|m| m.get("max_rounds"))
                    .and_then(Value::as_u64),
                "status": match child.state {
                    ChildState::Queued => "queued",
                    ChildState::Running => "running",
                    ChildState::Completed => "completed",
                    ChildState::Failed | ChildState::Blocked | ChildState::LostAfterRestart => "failed",
                    ChildState::Cancelled => "cancelled",
                },
                "started_at_ms": existing_meta
                    .and_then(|m| m.get("started_at_ms"))
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
                "completed_at_ms": existing_meta
                    .and_then(|m| m.get("completed_at_ms"))
                    .and_then(Value::as_i64),
            }))
        })
        .collect()
}

struct PersistedCoreCommandBatch {
    commands: Vec<MultiAgentCommand>,
    scheduled_runs: Vec<PreparedChildRun>,
}

struct ReconcileSnapshotResult {
    changed: bool,
    commands: Vec<MultiAgentCommand>,
}

// Phase 8: Core reducer wrapper
async fn apply_event_and_persist(
    app_state: &AppState,
    batch_id: &str,
    event: MultiAgentEvent,
) -> Result<PersistedCoreCommandBatch, String> {
    let mut ctx = load_batch_context(app_state, batch_id)
        .await?
        .ok_or_else(|| format!("batch '{batch_id}' not found"))?;
    let (new_snapshot, commands) = multi_agent_core::apply_event(ctx.snapshot, event);
    ctx.snapshot = new_snapshot;
    let scheduled_runs = scheduled_runs_from_commands(&commands, &ctx.launch_index);
    let recovery_index = build_recovery_index(&ctx.snapshot, ctx.recovery_index.as_ref());
    persist_batch_context(
        app_state,
        batch_id,
        &ctx.snapshot,
        &recovery_index,
        &ctx.launch_index,
        None,
        None,
    )
    .await?;
    global_concurrency_control().notify_waiters();
    Ok(PersistedCoreCommandBatch {
        commands,
        scheduled_runs,
    })
}

async fn apply_events_and_persist(
    app_state: &AppState,
    batch_id: &str,
    events: Vec<MultiAgentEvent>,
) -> Result<PersistedCoreCommandBatch, String> {
    let mut ctx = load_batch_context(app_state, batch_id)
        .await?
        .ok_or_else(|| format!("batch '{batch_id}' not found"))?;
    let mut all_commands = Vec::new();
    for event in events {
        let (new_snapshot, commands) = multi_agent_core::apply_event(ctx.snapshot, event);
        ctx.snapshot = new_snapshot;
        all_commands.extend(commands);
    }
    let scheduled_runs = scheduled_runs_from_commands(&all_commands, &ctx.launch_index);
    let recovery_index = build_recovery_index(&ctx.snapshot, ctx.recovery_index.as_ref());
    persist_batch_context(
        app_state,
        batch_id,
        &ctx.snapshot,
        &recovery_index,
        &ctx.launch_index,
        None,
        None,
    )
    .await?;
    global_concurrency_control().notify_waiters();
    Ok(PersistedCoreCommandBatch {
        commands: all_commands,
        scheduled_runs,
    })
}

fn scheduled_runs_from_commands(
    commands: &[MultiAgentCommand],
    launch_index: &[PreparedChildRunLaunchSnapshot],
) -> Vec<PreparedChildRun> {
    commands
        .iter()
        .filter_map(|command| match command {
            MultiAgentCommand::SpawnChild { child_id, .. } => Some(child_id.as_str()),
            _ => None,
        })
        .filter_map(|child_id| {
            launch_index
                .iter()
                .find(|snapshot| snapshot.child_run_id == child_id)
                .cloned()
                .map(PreparedChildRun::from_launch_snapshot)
                .or_else(|| {
                    log::warn!(
                        "multi-agent core scheduled child without persisted launch payload child_id={}",
                        child_id
                    );
                    None
                })
        })
        .collect()
}

// Phase 8: Reconcile non-terminal children from durable run store
async fn reconcile_snapshot_from_durable_runs(
    app_state: &AppState,
    ctx: &mut BatchContext,
) -> Result<ReconcileSnapshotResult, String> {
    let mut changed = false;
    let mut events = Vec::new();
    for child_id in ctx.snapshot.child_order.clone() {
        let Some(child) = ctx.snapshot.children.get(&child_id) else {
            continue;
        };
        if child.state.is_terminal() {
            continue;
        }
        let Some(run) = get_custom_task_agent_run(app_state.mcp.store.as_ref(), child_id.as_str())
            .await
            .map_err(|err| err.to_string())?
        else {
            continue;
        };
        let durable_state = child_state_from_custom_task_agent_run_status(&run.status);
        if durable_state == child.state && child.result == run.result_json {
            continue;
        }
        changed = true;
        let event = match durable_state {
            ChildState::Completed => MultiAgentEvent::ChildCompleted {
                child_id: child_id.clone(),
                result: run.result_json.unwrap_or(Value::Null),
            },
            ChildState::Failed => MultiAgentEvent::ChildFailed {
                child_id: child_id.clone(),
                error: run
                    .error
                    .unwrap_or_else(|| "delegated child failed".to_string()),
            },
            ChildState::Cancelled => MultiAgentEvent::ChildCancelled {
                child_id: child_id.clone(),
                reason: Some("reconciled from durable run".to_string()),
            },
            ChildState::Running => MultiAgentEvent::ChildStarted {
                child_id: child_id.clone(),
                host_run_id: Some(child_id.clone()),
            },
            ChildState::Queued | ChildState::Blocked | ChildState::LostAfterRestart => {
                continue;
            }
        };
        events.push(event);
    }
    if !events.is_empty() {
        let mut commands = Vec::new();
        for event in events {
            let (new_snapshot, event_commands) =
                multi_agent_core::apply_event(ctx.snapshot.clone(), event);
            ctx.snapshot = new_snapshot;
            commands.extend(event_commands);
        }
        return Ok(ReconcileSnapshotResult { changed, commands });
    }
    Ok(ReconcileSnapshotResult {
        changed,
        commands: Vec::new(),
    })
}

fn child_state_from_custom_task_agent_run_status(status: &CustomTaskAgentRunStatus) -> ChildState {
    match status {
        CustomTaskAgentRunStatus::Running => ChildState::Running,
        CustomTaskAgentRunStatus::Completed => ChildState::Completed,
        CustomTaskAgentRunStatus::Failed => ChildState::Failed,
        CustomTaskAgentRunStatus::Cancelled => ChildState::Cancelled,
    }
}

// Phase 8: Tool execution functions (stateless, load-modify-persist pattern)

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_start_delegate_agent_tool(
    app: &AppHandle,
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    session_id: &str,
    call_id: &str,
    tool_name: &str,
    arguments: &Value,
    effective_allowed_tool_names: &[String],
) -> Result<DelegateAgentsToolExecutionResult, String> {
    let wrapped = json!({ "tasks": [arguments.clone()] });
    execute_start_delegations_tool(
        app,
        app_state,
        state,
        session_id,
        call_id,
        tool_name,
        &wrapped,
        effective_allowed_tool_names,
    )
    .await
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_start_delegate_many_tool(
    app: &AppHandle,
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    session_id: &str,
    call_id: &str,
    tool_name: &str,
    arguments: &Value,
    effective_allowed_tool_names: &[String],
) -> Result<DelegateAgentsToolExecutionResult, String> {
    execute_start_delegations_tool(
        app,
        app_state,
        state,
        session_id,
        call_id,
        tool_name,
        arguments,
        effective_allowed_tool_names,
    )
    .await
}

async fn execute_start_delegations_tool(
    app: &AppHandle,
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    session_id: &str,
    call_id: &str,
    tool_name: &str,
    arguments: &Value,
    effective_allowed_tool_names: &[String],
) -> Result<DelegateAgentsToolExecutionResult, String> {
    let tasks = arguments
        .get("tasks")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{tool_name} requires a tasks array"))?;
    if tasks.is_empty() {
        return Err(format!("{tool_name} requires at least one task"));
    }

    let batch_id = Uuid::new_v4().to_string();
    let mut prepared_children = Vec::with_capacity(tasks.len());
    let mut recovery_index = Vec::with_capacity(tasks.len());
    let mut launch_index = Vec::with_capacity(tasks.len());

    for (index, item) in tasks.iter().enumerate() {
        let mut prepared = prepare_child_run(
            app_state,
            state,
            batch_id.as_str(),
            index,
            item,
            effective_allowed_tool_names,
        )
        .await?;
        prepared.background_resume_context = Some(build_background_resume_context(
            state,
            call_id,
            &prepared,
            prepared.max_rounds as usize,
        ));
        launch_index.push(prepared.launch_snapshot()?);
        recovery_index.push(json!({
            "child_run_id": prepared.child_run_id.clone(),
            "execution_id": prepared.execution_id.clone(),
            "agent_id": prepared.profile.id.clone(),
            "agent_name": prepared.profile.name.clone(),
            "agent_source": prepared.agent_source.clone(),
            "selection_reason": prepared.execution_selection.reason_text.clone(),
            "selection_reason_codes": prepared.execution_selection.reason_codes.clone(),
            "callable_coverage_score": prepared.execution_selection.callable_coverage_score,
            "modality_fit_score": prepared.execution_selection.modality_fit_score,
            "profile_prior_score": prepared.execution_selection.profile_prior_score,
            "max_rounds": prepared.max_rounds,
            "started_at_ms": now_unix_ms_i64(),
            "completed_at_ms": null,
        }));
        prepared_children.push(prepared);
    }

    let tasks_spec = prepared_children
        .iter()
        .map(|prepared| AgentTaskSpec {
            task_id: prepared.execution_id.clone(),
            child_id: prepared.child_run_id.clone(),
            task: prepared.task.clone(),
            agent_id: Some(prepared.profile.id.clone()),
            agent_type: prepared.agent_type.clone(),
            write_scope: core_write_scope_from_str(prepared.write_scope.as_str()),
        })
        .collect::<Vec<_>>();

    let plan = MultiAgentPlan::new(batch_id.as_str(), 8, tasks_spec);
    let (snapshot, commands) = multi_agent_core::start(plan);

    persist_batch_context(
        app_state,
        batch_id.as_str(),
        &snapshot,
        &recovery_index,
        &launch_index,
        Some(session_id),
        Some(call_id),
    )
    .await?;

    let scheduled_runs = extract_scheduled_runs(&commands, &prepared_children);

    let execution_config = child_execution_config_from_state(state);
    let audit_context = audit_context_from_state(session_id, state);

    spawn_scheduled_children(
        app,
        app_state,
        &execution_config,
        &audit_context,
        scheduled_runs,
    );

    let children_json = snapshot
        .child_order
        .iter()
        .filter_map(|child_id| snapshot.children.get(child_id))
        .map(|child| {
            let recovery_meta = find_recovery_meta(&recovery_index, child.child_id.as_str());
            child_json_from_snapshot(child, recovery_meta)
        })
        .collect::<Vec<_>>();

    let child_ids = children_json
        .iter()
        .filter_map(|record| record.get("child_run_id").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();
    let progress_events = build_start_progress_events(batch_id.as_str(), &children_json);
    let failure_summary = delegation_failure_summary(&children_json);
    let result = json!({
        "batch_id": batch_id,
        "child_ids": child_ids,
        "failure_summary": failure_summary,
        "progress_events": progress_events,
        "children": children_json,
    });
    Ok(tool_success_result(
        call_id,
        tool_name,
        result,
        "Start delegations result",
    ))
}

fn extract_scheduled_runs(
    commands: &[MultiAgentCommand],
    prepared_children: &[PreparedChildRun],
) -> Vec<PreparedChildRun> {
    let scheduled_ids = commands
        .iter()
        .filter_map(|command| match command {
            MultiAgentCommand::SpawnChild { child_id, .. } => Some(child_id.as_str()),
            _ => None,
        })
        .collect::<HashSet<_>>();
    prepared_children
        .iter()
        .filter(|prepared| scheduled_ids.contains(prepared.child_run_id.as_str()))
        .cloned()
        .collect()
}

impl Clone for PreparedChildRun {
    fn clone(&self) -> Self {
        Self {
            batch_id: self.batch_id.clone(),
            child_run_id: self.child_run_id.clone(),
            execution_id: self.execution_id.clone(),
            agent_type: self.agent_type.clone(),
            agent_source: self.agent_source.clone(),
            task: self.task.clone(),
            write_scope: self.write_scope.clone(),
            profile: self.profile.clone(),
            execution_selection: self.execution_selection.clone(),
            packet_receipt: self.packet_receipt.clone(),
            task_packet: self.task_packet.clone(),
            task_input_source_payload: self.task_input_source_payload.clone(),
            background_resume_context: self.background_resume_context.clone(),
            max_rounds: self.max_rounds,
        }
    }
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_delegations_status_tool(
    app: &AppHandle,
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    session_id: &str,
    call_id: &str,
    tool_name: &str,
    arguments: &Value,
) -> Result<DelegateAgentsToolExecutionResult, String> {
    let batch_id = required_batch_id(arguments, tool_name)?;
    let child_run_ids = optional_string_array(arguments, "child_run_ids")?;

    let mut ctx = load_batch_context(app_state, batch_id.as_str())
        .await?
        .ok_or_else(|| format!("batch '{batch_id}' not found"))?;

    let reconcile = reconcile_snapshot_from_durable_runs(app_state, &mut ctx).await?;
    if reconcile.changed {
        let recovery_index = build_recovery_index(&ctx.snapshot, ctx.recovery_index.as_ref());
        persist_batch_context(
            app_state,
            batch_id.as_str(),
            &ctx.snapshot,
            &recovery_index,
            &ctx.launch_index,
            None,
            Some(call_id),
        )
        .await?;
        let scheduled_runs = scheduled_runs_from_commands(&reconcile.commands, &ctx.launch_index);
        if !scheduled_runs.is_empty() {
            let execution_config = child_execution_config_from_state(state);
            let audit_context = audit_context_from_state(session_id, state);
            spawn_scheduled_children(
                app,
                app_state,
                &execution_config,
                &audit_context,
                scheduled_runs,
            );
        }
    }

    let children_json = project_children_json(&ctx, child_run_ids.as_deref());
    let failure_summary = delegation_failure_summary(&children_json);
    let progress_events = build_status_progress_events(batch_id.as_str(), &children_json);
    let result = json!({
        "batch_id": batch_id,
        "failure_summary": failure_summary,
        "progress_events": progress_events,
        "children": children_json,
    });
    Ok(tool_success_result(
        call_id,
        tool_name,
        result,
        "Delegations status result",
    ))
}

fn project_children_json(ctx: &BatchContext, child_run_ids: Option<&[String]>) -> Vec<Value> {
    let requested = child_run_ids.map(|ids| ids.iter().cloned().collect::<HashSet<_>>());
    ctx.snapshot
        .child_order
        .iter()
        .filter(|child_id| {
            requested
                .as_ref()
                .is_none_or(|ids| ids.contains(child_id.as_str()))
        })
        .filter_map(|child_id| ctx.snapshot.children.get(child_id))
        .map(|child| {
            let recovery_meta = ctx
                .recovery_index
                .as_ref()
                .and_then(|idx| find_recovery_meta(idx, child.child_id.as_str()));
            child_json_from_snapshot(child, recovery_meta)
        })
        .collect()
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_stop_delegations_tool(
    app: &AppHandle,
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    session_id: &str,
    call_id: &str,
    tool_name: &str,
    arguments: &Value,
) -> Result<DelegateAgentsToolExecutionResult, String> {
    let batch_id = required_batch_id(arguments, tool_name)?;
    let child_run_ids = optional_string_array(arguments, "child_run_ids")?;

    let ctx = load_batch_context(app_state, batch_id.as_str())
        .await?
        .ok_or_else(|| format!("batch '{batch_id}' not found"))?;

    let requested = child_run_ids
        .as_ref()
        .map(|ids| ids.iter().cloned().collect::<HashSet<_>>());
    let mut events = Vec::new();
    let mut stopped_children = Vec::new();

    for child_id in &ctx.snapshot.child_order {
        if requested
            .as_ref()
            .is_some_and(|ids| !ids.contains(child_id.as_str()))
        {
            continue;
        }
        let Some(child) = ctx.snapshot.children.get(child_id) else {
            continue;
        };
        let was_running = child.state == ChildState::Running;
        let was_queued = child.state == ChildState::Queued;
        if was_running || was_queued {
            events.push(MultiAgentEvent::ChildCancelled {
                child_id: child_id.clone(),
                reason: Some("stop_delegations".to_string()),
            });
            stopped_children.push(json!({
                "child_run_id": child_id,
                "status": "cancelled",
                "was_running": was_running,
                "was_queued": was_queued,
            }));
            if was_running {
                if let Err(err) =
                    cancel_custom_task_agent_run(app_state.mcp.store.as_ref(), child_id.as_str())
                        .await
                {
                    log::warn!(
                        "cancel_custom_task_agent_run failed run_id={} err={}",
                        child_id,
                        err
                    );
                }
            }
        } else {
            let status_str = match child.state {
                ChildState::Completed => "completed",
                ChildState::Failed | ChildState::Blocked | ChildState::LostAfterRestart => "failed",
                ChildState::Cancelled => "cancelled",
                ChildState::Running => "running",
                ChildState::Queued => "queued",
            };
            stopped_children.push(json!({
                "child_run_id": child_id,
                "status": status_str,
                "was_running": false,
                "was_queued": false,
            }));
        }
    }

    let command_batch = apply_events_and_persist(app_state, batch_id.as_str(), events).await?;
    let scheduled_child_ids = command_batch
        .commands
        .iter()
        .filter_map(|command| match command {
            MultiAgentCommand::SpawnChild { child_id, .. } => Some(child_id.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();

    if !command_batch.scheduled_runs.is_empty() {
        let execution_config = child_execution_config_from_state(state);
        let audit_context = audit_context_from_state(session_id, state);
        spawn_scheduled_children(
            app,
            app_state,
            &execution_config,
            &audit_context,
            command_batch.scheduled_runs,
        );
    }

    let result = json!({
        "batch_id": batch_id,
        "scheduled_child_ids": scheduled_child_ids,
        "progress_events": build_stop_progress_events(batch_id.as_str(), &stopped_children),
        "stopped_children": stopped_children,
    });
    Ok(tool_success_result(
        call_id,
        tool_name,
        result,
        "Stop delegations result",
    ))
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_wait_delegations_tool(
    app: &AppHandle,
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    session_id: &str,
    call_id: &str,
    tool_name: &str,
    arguments: &Value,
) -> Result<DelegateAgentsToolExecutionResult, String> {
    let batch_id = required_batch_id(arguments, tool_name)?;
    let child_run_ids = optional_string_array(arguments, "child_run_ids")?;
    let join_policy = join_policy_from_arguments(arguments)?;
    let timeout = wait_timeout_from_arguments(arguments)?;

    let waited = wait_children_with_reconcile(
        app,
        app_state,
        state,
        session_id,
        batch_id.as_str(),
        child_run_ids.as_deref(),
        join_policy,
        timeout,
    )
    .await?;

    let ctx = load_batch_context(app_state, batch_id.as_str())
        .await?
        .ok_or_else(|| format!("batch '{batch_id}' not found"))?;

    let children_json = project_children_json(&ctx, child_run_ids.as_deref());
    let parent_world_model_merge_candidate = parent_world_model_merge_candidate_from_snapshot(
        &ctx.snapshot,
        ctx.recovery_index.as_ref(),
    );
    let failure_summary = delegation_failure_summary(&children_json);

    let result = json!({
        "batch_id": batch_id,
        "satisfied": waited.satisfied,
        "timed_out": waited.timed_out,
        "join": waited.join,
        "failure_summary": failure_summary,
        "progress_events": build_wait_progress_events(batch_id.as_str(), waited.satisfied, waited.timed_out, &children_json),
        "parent_world_model_merge_candidate": parent_world_model_merge_candidate,
        "children": children_json,
    });
    Ok(tool_success_result(
        call_id,
        tool_name,
        result,
        "Wait delegations result",
    ))
}

struct WaitDelegationsResult {
    satisfied: bool,
    timed_out: bool,
    join: Option<JoinOutcome>,
}

async fn wait_children_with_reconcile(
    app: &AppHandle,
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    session_id: &str,
    batch_id: &str,
    child_run_ids: Option<&[String]>,
    policy: JoinPolicy,
    timeout: Duration,
) -> Result<WaitDelegationsResult, String> {
    let started = std::time::Instant::now();
    let control = global_concurrency_control();

    loop {
        let mut ctx = load_batch_context(app_state, batch_id)
            .await?
            .ok_or_else(|| format!("batch '{batch_id}' not found"))?;

        let reconcile = reconcile_snapshot_from_durable_runs(app_state, &mut ctx).await?;
        if reconcile.changed {
            let recovery_index = build_recovery_index(&ctx.snapshot, ctx.recovery_index.as_ref());
            persist_batch_context(
                app_state,
                batch_id,
                &ctx.snapshot,
                &recovery_index,
                &ctx.launch_index,
                None,
                None,
            )
            .await?;
            let scheduled_runs =
                scheduled_runs_from_commands(&reconcile.commands, &ctx.launch_index);
            if !scheduled_runs.is_empty() {
                let execution_config = child_execution_config_from_state(state);
                let audit_context = audit_context_from_state(session_id, state);
                spawn_scheduled_children(
                    app,
                    app_state,
                    &execution_config,
                    &audit_context,
                    scheduled_runs,
                );
            }
        }

        ensure_requested_children_exist(child_run_ids, &ctx.snapshot)?;

        let selection = JoinSelection {
            child_ids: child_run_ids.map(|ids| ids.to_vec()),
        };
        if let Some(join) = multi_agent_core::try_join(&ctx.snapshot, &selection, policy.clone()) {
            return Ok(WaitDelegationsResult {
                satisfied: true,
                timed_out: false,
                join: Some(join),
            });
        }

        let elapsed = started.elapsed();
        if elapsed >= timeout {
            return Ok(WaitDelegationsResult {
                satisfied: false,
                timed_out: true,
                join: None,
            });
        }

        let remaining = timeout.saturating_sub(elapsed);
        if !control.wait_notified(remaining).await {
            return Ok(WaitDelegationsResult {
                satisfied: false,
                timed_out: true,
                join: None,
            });
        }
    }
}

fn ensure_requested_children_exist(
    requested: Option<&[String]>,
    snapshot: &MultiAgentSnapshot,
) -> Result<(), String> {
    let Some(requested) = requested else {
        return Ok(());
    };
    let existing = snapshot
        .children
        .keys()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let missing = requested
        .iter()
        .filter(|child_run_id| !existing.contains(child_run_id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "wait_delegations child_run_ids not found: {}",
            missing.join(", ")
        ))
    }
}

// Phase 8: Child execution (background spawn, completion callback)

fn spawn_background_child(
    app_handle: AppHandle,
    app_state: AppState,
    execution_config: ChildExecutionConfig,
    audit_context: AuditContext,
    prepared: PreparedChildRun,
) -> tauri::async_runtime::JoinHandle<()> {
    let batch_id = prepared.batch_id.clone();
    let child_run_id = prepared.child_run_id.clone();
    tauri::async_runtime::spawn(async move {
        let permit = match global_concurrency_control().acquire_slot().await {
            Ok(permit) => permit,
            Err(err) => {
                let failed_result = queued_child_failed_result(&prepared, err.as_str());
                let _ = complete_child_and_schedule_next(
                    &app_handle,
                    &app_state,
                    &execution_config,
                    &audit_context,
                    batch_id.as_str(),
                    child_run_id.as_str(),
                    ChildState::Failed,
                    failed_result,
                    Some(err.as_str()),
                )
                .await;
                return;
            }
        };

        if let Err(err) = ensure_child_execution_graph_run_row(
            &app_state,
            &audit_context,
            &prepared,
        )
        .await
        {
            let failed_result = queued_child_failed_result(&prepared, err.as_str());
            drop(permit);
            let _ = complete_child_and_schedule_next(
                &app_handle,
                &app_state,
                &execution_config,
                &audit_context,
                batch_id.as_str(),
                child_run_id.as_str(),
                ChildState::Failed,
                failed_result,
                Some(err.as_str()),
            )
            .await;
            return;
        }

        if let Err(err) = create_run_record(&app_state, &prepared, &execution_config).await {
            let failed_result = queued_child_failed_result(&prepared, err.as_str());
            drop(permit);
            let _ = complete_child_and_schedule_next(
                &app_handle,
                &app_state,
                &execution_config,
                &audit_context,
                batch_id.as_str(),
                child_run_id.as_str(),
                ChildState::Failed,
                failed_result,
                Some(err.as_str()),
            )
            .await;
            return;
        }
        if let Err(err) = persist_background_resume_context(&app_state, &prepared).await {
            let failed_result = queued_child_failed_result(&prepared, err.as_str());
            drop(permit);
            let _ = complete_child_and_schedule_next(
                &app_handle,
                &app_state,
                &execution_config,
                &audit_context,
                batch_id.as_str(),
                child_run_id.as_str(),
                ChildState::Failed,
                failed_result,
                Some(err.as_str()),
            )
            .await;
            return;
        }

        let session =
            run_prepared_child(&app_handle, &app_state, &execution_config, prepared).await;
        let status = child_state_from_session(&session);
        let delegated_result = session.record.delegated_result();
        drop(permit);

        let _ = complete_child_and_schedule_next(
            &app_handle,
            &app_state,
            &execution_config,
            &audit_context,
            batch_id.as_str(),
            child_run_id.as_str(),
            status,
            delegated_result,
            session.record.error.as_deref(),
        )
        .await;

        persist_delegated_execution_audit(&app_state, &audit_context, &session).await;
        let execution_id = session.record.execution_id.clone();
        let event_id = format!("custom_task_agent:{}:{}", child_run_id, status_str(status));
        let _ = resume_delegated_runtime_after_custom_task_agent_run(
            &app_handle,
            &app_state,
            execution_id.as_str(),
            child_run_id.as_str(),
            event_id.as_str(),
            session,
        )
        .await;
    })
}

async fn complete_child_and_schedule_next(
    app: &AppHandle,
    app_state: &AppState,
    execution_config: &ChildExecutionConfig,
    audit_context: &AuditContext,
    batch_id: &str,
    child_run_id: &str,
    status: ChildState,
    delegated_result: Value,
    error: Option<&str>,
) -> Result<(), String> {
    let event = match status {
        ChildState::Completed => MultiAgentEvent::ChildCompleted {
            child_id: child_run_id.to_string(),
            result: delegated_result.clone(),
        },
        ChildState::Failed => MultiAgentEvent::ChildFailed {
            child_id: child_run_id.to_string(),
            error: error.unwrap_or("delegated child failed").to_string(),
        },
        ChildState::Cancelled => MultiAgentEvent::ChildCancelled {
            child_id: child_run_id.to_string(),
            reason: Some("child cancelled".to_string()),
        },
        _ => {
            return Ok(());
        }
    };

    let command_batch = apply_event_and_persist(app_state, batch_id, event).await?;

    persist_child_run_terminal_state(app_state, child_run_id, status, &delegated_result, error)
        .await;

    if !command_batch.scheduled_runs.is_empty() {
        spawn_scheduled_children(
            app,
            app_state,
            execution_config,
            audit_context,
            command_batch.scheduled_runs,
        );
    }

    Ok(())
}

fn spawn_scheduled_children(
    app: &AppHandle,
    app_state: &AppState,
    execution_config: &ChildExecutionConfig,
    audit_context: &AuditContext,
    prepared_runs: Vec<PreparedChildRun>,
) {
    for prepared in prepared_runs {
        let _handle = spawn_background_child(
            app.clone(),
            app_state.clone(),
            execution_config.clone(),
            audit_context.clone(),
            prepared,
        );
        // Phase 8: no abort handle tracking (stop_delegations cancels via durable run store)
    }
}

async fn ensure_child_execution_graph_run_row(
    app_state: &AppState,
    audit_context: &AuditContext,
    prepared: &PreparedChildRun,
) -> Result<(), String> {
    ensure_execution_graph_run_row(
        app_state.mcp.store.as_ref(),
        prepared.execution_id.as_str(),
        audit_context.session_id.as_str(),
        "delegation_child",
        "delegation",
        "running",
        "delegated_custom_task_agent",
    )
    .await
    .map_err(|err| err.to_string())
}

async fn create_run_record(
    app_state: &AppState,
    prepared: &PreparedChildRun,
    execution_config: &ChildExecutionConfig,
) -> Result<(), String> {
    create_custom_task_agent_run(
        app_state.mcp.store.as_ref(),
        prepared.child_run_id.as_str(),
        prepared.profile.id.as_str(),
        prepared.execution_id.as_str(),
        &json!({
            "batch_id": prepared.batch_id,
            "child_run_id": prepared.child_run_id,
            "agent_type": prepared.agent_type,
            "agent_source": prepared.agent_source,
            "task": prepared.task,
            "write_scope": prepared.write_scope,
            "message": prepared.task,
            "image_urls": [],
            "temperature": execution_config.temperature,
            "max_tokens": execution_config.max_tokens,
            "max_rounds": prepared.max_rounds,
            "worker_task_packet": prepared.task_packet.as_value(),
            "task_input_source": prepared.task_input_source_payload,
        }),
    )
    .await
    .map(|_| ())
    .map_err(|err| err.to_string())
}

async fn run_prepared_child(
    app: &AppHandle,
    app_state: &AppState,
    execution_config: &ChildExecutionConfig,
    prepared: PreparedChildRun,
) -> DelegatedExecutionSession {
    let response_result = preview_custom_task_agent_with_parent_model(
        app,
        app_state,
        &prepared.profile,
        CustomTaskAgentPreviewRequest {
            message: prepared.task.clone(),
            image_urls: Vec::new(),
            temperature: execution_config.temperature,
            max_tokens: execution_config.max_tokens,
            max_rounds: Some(prepared.max_rounds),
            worker_task_packet: Some(prepared.task_packet.as_value()),
        },
        Some(&execution_config.model_connection),
    )
    .await;

    build_custom_task_agent_delegated_execution_session(
        prepared.execution_id,
        prepared.profile,
        prepared.execution_selection,
        Some(prepared.packet_receipt),
        Some(prepared.task_input_source_payload),
        response_result,
        Vec::new(),
    )
}

fn child_state_from_session(session: &DelegatedExecutionSession) -> ChildState {
    match session.record.status {
        DelegatedExecutionStatus::Succeeded | DelegatedExecutionStatus::Integrated => {
            ChildState::Completed
        }
        DelegatedExecutionStatus::Cancelled => ChildState::Cancelled,
        DelegatedExecutionStatus::Failed => ChildState::Failed,
        _ => ChildState::Running,
    }
}

fn status_str(state: ChildState) -> &'static str {
    match state {
        ChildState::Queued => "queued",
        ChildState::Running => "running",
        ChildState::Completed => "completed",
        ChildState::Failed | ChildState::Blocked | ChildState::LostAfterRestart => "failed",
        ChildState::Cancelled => "cancelled",
    }
}

async fn persist_child_run_terminal_state(
    app_state: &AppState,
    child_run_id: &str,
    status: ChildState,
    delegated_result: &Value,
    error: Option<&str>,
) {
    let result = match status {
        ChildState::Completed => {
            complete_custom_task_agent_run(
                app_state.mcp.store.as_ref(),
                child_run_id,
                delegated_result,
            )
            .await
        }
        ChildState::Failed => {
            fail_custom_task_agent_run(
                app_state.mcp.store.as_ref(),
                child_run_id,
                error.unwrap_or("delegated child failed"),
            )
            .await
        }
        ChildState::Cancelled => {
            cancel_custom_task_agent_run(app_state.mcp.store.as_ref(), child_run_id).await
        }
        _ => Ok(()),
    };
    if let Err(err) = result {
        log::warn!(
            "persist child run terminal state failed run_id={} status={} err={}",
            child_run_id,
            status_str(status),
            err
        );
    }
}

async fn persist_delegated_execution_audit(
    app_state: &AppState,
    audit_context: &AuditContext,
    session: &DelegatedExecutionSession,
) {
    let delegated_execution_tree = session
        .record
        .status_meta_with_status(DelegatedExecutionStatus::Integrated);
    audit::persist_delegated_execution_graph_snapshot(
        app_state.mcp.store.as_ref(),
        audit_context.session_id.as_str(),
        audit_context.trace_id.as_str(),
        audit_context.request_id.as_deref(),
        session.record.execution_id.as_str(),
        &audit_context.runtime_transition_blocks,
        delegated_execution_tree,
    )
    .await;
}

// Phase 8: Child preparation and launch payload materialization

async fn prepare_child_run(
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    batch_id: &str,
    index: usize,
    item: &Value,
    effective_allowed_tool_names: &[String],
) -> Result<PreparedChildRun, String> {
    let task = required_non_empty_string(
        item,
        "task",
        "delegation task item requires a non-empty task",
    )?;
    let required_capabilities = required_capabilities_for_task(item, &task)?;
    let agent_id = item
        .get("agent_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let agent_type = item
        .get("agent_type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let write_scope = parse_child_write_scope(item)?;
    if write_scope != "read_only" {
        return Err("async delegation fan-out supports only write_scope='read_only'".to_string());
    }
    let child_run_id = Uuid::new_v4().to_string();
    let execution_id = Uuid::new_v4().to_string();

    let (selection, agent_type, agent_source, effective_spec_max_rounds): (
        WorkerTargetSelection,
        Option<String>,
        String,
        Option<u32>,
    ) = if let Some(agent_id) = agent_id.as_ref() {
        let selection = select_explicit_worker_custom_task_agent(app_state, Some(agent_id)).await?;
        let selection =
            selection.ok_or_else(|| format!("explicit task agent '{}' not found", agent_id))?;
        ensure_selection_satisfies_required_capabilities(
            item,
            &task,
            &required_capabilities,
            &selection,
            Some(agent_id.as_str()),
            None,
        )?;
        (selection, None, "registered".to_string(), None)
    } else {
        let agent_type = agent_type.ok_or_else(|| delegation_identity_missing_error(index, item))?;
        let spec = parse_ephemeral_agent_spec(item.get("agent_spec"))?;
        let ephemeral = build_ephemeral_agent_profile(agent_type.as_str(), spec, batch_id, index)?;
        let selection = ephemeral_selection(ephemeral.profile.clone(), agent_type.as_str());
        ensure_selection_satisfies_required_capabilities(
            item,
            &task,
            &required_capabilities,
            &selection,
            None,
            Some(agent_type.as_str()),
        )?;
        (
            selection,
            Some(agent_type),
            "ephemeral".to_string(),
            ephemeral.max_rounds,
        )
    };

    let max_rounds = item
        .get("max_rounds")
        .and_then(Value::as_u64)
        .map(|value| value.min(u32::MAX as u64) as u32)
        .or(effective_spec_max_rounds)
        .map(|value| cap_child_max_rounds(value, state.max_rounds))
        .unwrap_or_else(|| state.max_rounds.max(1).min(u32::MAX as usize) as u32);
    let task_packet = build_worker_task_packet(
        &selection,
        WorkerTaskPacketInput {
            task_id: execution_id.clone(),
            goal: task.clone(),
            user_query: task.clone(),
            raw_user_text: Some(task.clone()),
            image_urls: Vec::new(),
            parent_allowed_tool_names: effective_allowed_tool_names.to_vec(),
            prefer_workflow_runtime: state.execution_policy.prefer_workflow_runtime,
            explicit_task_agent_id: agent_id.clone(),
            bound_asset_reference: None,
        },
    );
    let execution_selection = DelegatedExecutionSelection {
        explicit: agent_id.is_some() || agent_type.is_some(),
        score: Some(selection.score),
        reason_codes: selection.reason_codes.clone(),
        reason_text: Some(selection.reason.clone()).filter(|value| !value.trim().is_empty()),
        candidate_count: selection.candidate_count,
        selected_from_top_k: selection.selected_from_top_k,
        callable_coverage_score: Some(selection.callable_coverage_score),
        modality_fit_score: Some(selection.modality_fit_score),
        profile_prior_score: Some(selection.profile_prior_score),
    };
    let packet_receipt = DelegatedExecutionPacketReceipt {
        packet_hash: task_packet.packet_hash.clone(),
        task_kind: task_packet.task_kind.clone(),
        deliverable_kind: task_packet.deliverable_kind.clone(),
        selected_profile_id: selection.profile.id.clone(),
    };
    let task_input_source_payload = serde_json::to_value(delegated_agent_task_input_source(
        &selection,
        &task_packet,
        None,
        Some(child_run_id.clone()),
        custom_task_agent_return_channel(&selection.profile.invocation_kind),
        ApprovalInheritance::ParentDecides,
    ))
    .unwrap_or(Value::Null);

    Ok(PreparedChildRun {
        batch_id: batch_id.to_string(),
        child_run_id,
        execution_id,
        agent_type,
        agent_source,
        task,
        write_scope,
        profile: selection.profile.clone(),
        execution_selection,
        packet_receipt,
        task_packet,
        task_input_source_payload,
        background_resume_context: None,
        max_rounds,
    })
}

fn delegation_identity_missing_error(index: usize, item: &Value) -> String {
    let received_keys = item
        .as_object()
        .map(|object| object.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    json!({
        "error_code": "DELEGATION_TASK_IDENTITY_MISSING",
        "message": "delegation task item requires agent_type or agent_id",
        "task_index": index,
        "received_keys": received_keys,
        "expected_one_of": ["agent_id", "agent_type"],
        "example": {
            "agent_id": "327b45df-05c7-46e6-be98-f7325f212b13",
            "task": "Review this bounded subtask and return findings, evidence, risks, and next_actions.",
            "write_scope": "read_only"
        }
    })
    .to_string()
}

fn required_capabilities_for_task(item: &Value, task: &str) -> Result<Vec<String>, String> {
    let mut capabilities = optional_string_array(item, "required_capabilities")?.unwrap_or_default();
    if task_implies_web_search(task) && !capabilities.iter().any(|item| item == "web_search") {
        capabilities.push("web_search".to_string());
    }
    capabilities.sort();
    capabilities.dedup();
    Ok(capabilities)
}

fn task_implies_web_search(task: &str) -> bool {
    let lower = task.to_ascii_lowercase();
    let web_terms = [
        "web search",
        "internet",
        "online",
        "reddit",
        "youtube",
        "bilibili",
        "notebookcheck",
        "techpowerup",
        "video cardz",
        "videocardz",
        "anandtech",
        "搜索",
        "网络",
        "网页",
        "贴吧",
        "论坛",
        "b站",
        "价格",
        "行情",
    ];
    web_terms.iter().any(|term| lower.contains(term))
}

fn ensure_selection_satisfies_required_capabilities(
    item: &Value,
    task: &str,
    required_capabilities: &[String],
    selection: &WorkerTargetSelection,
    agent_id: Option<&str>,
    agent_type: Option<&str>,
) -> Result<(), String> {
    if required_capabilities.is_empty() {
        return Ok(());
    }
    let has_web_search = child_has_web_search_capability(item, selection);
    let has_any_callable_binding = child_has_any_callable_binding(item, selection);
    if required_capabilities
        .iter()
        .any(|capability| capability == "web_search")
        && !has_web_search
        && !has_any_callable_binding
    {
        return Err(
            json!({
                "error_code": "CAPABILITY_MISMATCH",
                "message": "delegated task requires web_search but the selected child agent has no web-search callable",
                "failure_stage": "capability_resolution",
                "required_capabilities": required_capabilities,
                "agent_id": agent_id,
                "agent_type": agent_type,
                "agent_source": if agent_id.is_some() { "registered" } else { "ephemeral" },
                "selection_reason": selection.reason.clone(),
                "selection_reason_codes": selection.reason_codes.clone(),
                "callable_coverage_score": selection.callable_coverage_score,
                "task_preview": task.chars().take(160).collect::<String>(),
            })
            .to_string(),
        );
    }
    Ok(())
}

fn child_has_any_callable_binding(item: &Value, selection: &WorkerTargetSelection) -> bool {
    let explicit_tool_count = item
        .pointer("/agent_spec/callable_mcp_tool_ids")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).count())
        .unwrap_or(0);
    let explicit_skill_count = item
        .pointer("/agent_spec/guidance_skill_ids")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).count())
        .unwrap_or(0);
    explicit_tool_count > 0
        || explicit_skill_count > 0
        || !selection.profile.callable_mcp_tool_ids.is_empty()
        || !selection.profile.guidance_skill_ids.is_empty()
        || !selection.profile.callable_skill_action_refs.is_empty()
}

fn child_has_web_search_capability(item: &Value, selection: &WorkerTargetSelection) -> bool {
    let explicit_tool_ids = item
        .pointer("/agent_spec/callable_mcp_tool_ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str);
    let explicit_skill_ids = item
        .pointer("/agent_spec/guidance_skill_ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str);
    let bound_tool_ids = selection.profile.callable_mcp_tool_ids.iter().map(String::as_str);
    let skill_ids = selection.profile.guidance_skill_ids.iter().map(String::as_str);
    explicit_tool_ids
        .chain(explicit_skill_ids)
        .chain(bound_tool_ids)
        .chain(skill_ids)
        .any(is_web_search_capability_name)
}

fn is_web_search_capability_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("firecrawl")
        || lower.contains("tavily")
        || lower.contains("web_search")
        || lower.contains("web-search")
        || lower.contains("browser")
        || lower.contains("search")
        || lower.contains("crawl")
}

fn ephemeral_selection(profile: CustomTaskAgentProfile, agent_type: &str) -> WorkerTargetSelection {
    WorkerTargetSelection {
        profile,
        score: 10_000,
        reason: format!("ephemeral_agent_type:{agent_type}"),
        reason_codes: vec!["ephemeral_agent_type".to_string()],
        candidate_count: 1,
        selected_from_top_k: 1,
        callable_coverage_score: 1.0,
        modality_fit_score: 1.0,
        profile_prior_score: 0.0,
    }
}

fn build_background_resume_context(
    state: &LocalChatToolRuntimeState,
    call_id: &str,
    prepared: &PreparedChildRun,
    max_rounds: usize,
) -> Value {
    serialize_delegated_runtime_context_with_task_input_source(
        Some(format!(
            "start_delegate_many:{}:{}",
            prepared.batch_id, prepared.child_run_id
        )),
        Some(call_id.to_string()),
        DelegatedExecutionKind::CustomTaskAgent.as_str(),
        prepared.child_run_id.clone(),
        Some(prepared.profile.id.as_str()),
        Some(prepared.profile.name.as_str()),
        Some(CustomTaskAgentRunStatus::Running.as_str()),
        true,
        Some({
            let mut chat_runtime = persisted_chat_runtime_context_from_state(state);
            chat_runtime.max_rounds = max_rounds.max(1);
            chat_runtime
        }),
        state.session_id.as_str(),
        state.trace_id.as_str(),
        state.request_id.as_deref(),
        Some(prepared.execution_id.as_str()),
        None,
        Some(prepared.task_input_source_payload.clone()),
    )
}

async fn persist_background_resume_context(
    app_state: &AppState,
    prepared: &PreparedChildRun,
) -> Result<(), String> {
    let context = prepared
        .background_resume_context
        .as_ref()
        .ok_or_else(|| "background resume context was not prepared".to_string())?;
    persist_execution_graph_runtime_context(
        app_state.mcp.store.as_ref(),
        prepared.execution_id.as_str(),
        context,
    )
    .await
    .map_err(|err| err.to_string())
}

fn cap_child_max_rounds(value: u32, runtime_max_rounds: usize) -> u32 {
    let runtime_cap = runtime_max_rounds.max(1).min(u32::MAX as usize) as u32;
    value.max(1).min(runtime_cap)
}

fn queued_child_failed_result(prepared: &PreparedChildRun, error: &str) -> Value {
    json!({
        "type": "delegated_result",
        "status": "failed",
        "error": error,
        "primary_output": {
            "status": "failed",
            "message": error,
        },
        "execution_id": prepared.execution_id,
        "child_run_id": prepared.child_run_id,
    })
}

fn core_write_scope_from_str(write_scope: &str) -> WriteScope {
    match write_scope {
        "workspace_write" => WriteScope::WorkspaceWrite { paths: Vec::new() },
        "global_state" => WriteScope::GlobalState,
        _ => WriteScope::ReadOnly,
    }
}

// Phase 8: Argument parsing and validation

fn required_non_empty_string(
    arguments: &Value,
    field: &str,
    error: &str,
) -> Result<String, String> {
    arguments
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| error.to_string())
}

fn required_batch_id(arguments: &Value, tool_name: &str) -> Result<String, String> {
    arguments
        .get("batch_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{tool_name} requires batch_id"))
}

fn optional_string_array(arguments: &Value, field: &str) -> Result<Option<Vec<String>>, String> {
    let Some(value) = arguments.get(field) else {
        return Ok(None);
    };
    let items = value
        .as_array()
        .ok_or_else(|| format!("{field} must be an array of strings"))?;
    Ok(Some(
        items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
    ))
}

fn parse_child_write_scope(item: &Value) -> Result<String, String> {
    let write_scope = item
        .get("write_scope")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("read_only");
    match write_scope {
        "read_only" => Ok(write_scope.to_string()),
        other => Err(format!("unsupported delegation write_scope '{other}'")),
    }
}

fn wait_timeout_from_arguments(arguments: &Value) -> Result<Duration, String> {
    let timeout_ms = arguments
        .get("timeout_ms")
        .and_then(Value::as_u64)
        .unwrap_or(30_000)
        .min(600_000);
    Ok(Duration::from_millis(timeout_ms))
}

fn join_policy_from_arguments(arguments: &Value) -> Result<JoinPolicy, String> {
    let wait_for = arguments
        .get("wait_for")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("all");
    match wait_for {
        "all" | "all_terminal" => Ok(JoinPolicy::AllTerminal),
        "all_success" => Ok(JoinPolicy::AllSuccess),
        "any" | "any_success" => Ok(JoinPolicy::AnySuccess),
        "any_terminal" => Ok(JoinPolicy::AnyTerminal),
        "first_failure" => Ok(JoinPolicy::FirstFailure),
        "quorum" => {
            let min_success = arguments
                .get("min_success")
                .and_then(Value::as_u64)
                .ok_or_else(|| "wait_delegations quorum requires min_success".to_string())?;
            Ok(JoinPolicy::Quorum {
                min_success: min_success.max(1).min(usize::MAX as u64) as usize,
            })
        }
        other => Err(format!("unsupported wait_delegations wait_for '{other}'")),
    }
}

fn tool_success_result(
    call_id: &str,
    tool_name: &str,
    result: Value,
    label: &str,
) -> DelegateAgentsToolExecutionResult {
    DelegateAgentsToolExecutionResult {
        meta: json!({
            "id": call_id,
            "name": tool_name,
            "status": "success",
            "result": result.clone(),
        }),
        result_message: format!(
            "{label}:\n{}",
            serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
        ),
    }
}

// Phase 8: Progress event builders

fn build_start_progress_events(batch_id: &str, records: &[Value]) -> Vec<Value> {
    let counts = delegation_status_counts_from_json(records);
    let mut events = vec![json!({
        "type": "delegation_progress",
        "event": "batch_started",
        "batch_id": batch_id,
        "child_count": records.len(),
        "counts": counts,
    })];
    events.extend(records.iter().filter_map(|record| {
        let child_run_id = record.get("child_run_id")?.as_str()?;
        let status = record.get("status")?.as_str()?;
        Some(json!({
            "type": "delegation_progress",
            "event": match status {
                "running" => "child_started",
                "queued" => "child_queued",
                "completed" => "child_completed",
                "failed" => "child_failed",
                "cancelled" => "child_cancelled",
                _ => "child_status",
            },
            "batch_id": batch_id,
            "child_run_id": child_run_id,
            "status": status,
        }))
    }));
    events
}

fn build_wait_progress_events(
    batch_id: &str,
    satisfied: bool,
    timed_out: bool,
    records: &[Value],
) -> Vec<Value> {
    vec![json!({
        "type": "delegation_progress",
        "event": "join_completed",
        "batch_id": batch_id,
        "satisfied": satisfied,
        "timed_out": timed_out,
        "counts": delegation_status_counts_from_json(records),
        "failure_summary": delegation_failure_summary(records),
    })]
}

fn build_status_progress_events(batch_id: &str, records: &[Value]) -> Vec<Value> {
    vec![json!({
        "type": "delegation_progress",
        "event": "batch_status",
        "batch_id": batch_id,
        "counts": delegation_status_counts_from_json(records),
        "failure_summary": delegation_failure_summary(records),
    })]
}

fn delegation_failure_summary(records: &[Value]) -> Value {
    let mut failures = Vec::new();
    let mut error_codes: BTreeMap<String, usize> = BTreeMap::new();
    for record in records {
        if record.get("status").and_then(Value::as_str) != Some("failed") {
            continue;
        }
        let error_code = record
            .get("error_code")
            .and_then(Value::as_str)
            .unwrap_or("CHILD_FAILED")
            .to_string();
        *error_codes.entry(error_code.clone()).or_insert(0) += 1;
        failures.push(json!({
            "child_run_id": record.get("child_run_id").and_then(Value::as_str),
            "execution_id": record.get("execution_id").and_then(Value::as_str),
            "agent_id": record.get("agent_id").and_then(Value::as_str),
            "agent_type": record.get("agent_type").and_then(Value::as_str),
            "agent_name": record.get("agent_name").and_then(Value::as_str),
            "agent_source": record.get("agent_source").and_then(Value::as_str),
            "error_code": error_code,
            "failure_stage": record.get("failure_stage").and_then(Value::as_str),
            "failure_reason": record.get("failure_reason").and_then(Value::as_str)
                .or_else(|| record.get("error").and_then(Value::as_str)),
        }));
    }
    json!({
        "failure_count": failures.len(),
        "error_codes": error_codes,
        "failures": failures.into_iter().take(5).collect::<Vec<_>>(),
    })
}

fn build_stop_progress_events(batch_id: &str, stopped_children: &[Value]) -> Vec<Value> {
    let counts = delegation_status_counts_from_json(stopped_children);
    vec![json!({
        "type": "delegation_progress",
        "event": "batch_stop_requested",
        "batch_id": batch_id,
        "stopped_count": stopped_children.len(),
        "counts": counts,
    })]
}

fn delegation_status_counts_from_json(records: &[Value]) -> Value {
    let statuses = records
        .iter()
        .filter_map(|record| record.get("status").and_then(Value::as_str))
        .collect::<Vec<_>>();
    delegation_status_counts(statuses)
}

fn delegation_status_counts(statuses: Vec<&str>) -> Value {
    let mut queued = 0usize;
    let mut running = 0usize;
    let mut completed = 0usize;
    let mut failed = 0usize;
    let mut cancelled = 0usize;
    for status in statuses {
        match status {
            "queued" => queued += 1,
            "running" => running += 1,
            "completed" => completed += 1,
            "failed" => failed += 1,
            "cancelled" => cancelled += 1,
            _ => {}
        }
    }
    json!({
        "queued": queued,
        "running": running,
        "completed": completed,
        "failed": failed,
        "cancelled": cancelled,
        "terminal": completed + failed + cancelled,
        "total": queued + running + completed + failed + cancelled,
    })
}
