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
    fail_custom_task_agent_run,
};
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentPreviewRequest, CustomTaskAgentProfile, CustomTaskAgentRunStatus,
};
use crate::modules::desktop_runtime::runtime::execution_plane::{
    build_custom_task_agent_delegated_execution_session, DelegatedExecutionKind,
    DelegatedExecutionPacketReceipt, DelegatedExecutionSelection, DelegatedExecutionSession,
    DelegatedExecutionStatus,
};
use crate::modules::desktop_runtime::runtime::persist_execution_graph_runtime_context;
use crate::modules::desktop_runtime::runtime::worker_dispatch::{
    build_worker_task_packet, custom_task_agent_return_channel, delegated_agent_task_input_source,
    select_explicit_worker_custom_task_agent, WorkerTargetSelection, WorkerTaskPacket,
    WorkerTaskPacketInput,
};
use crate::modules::mcp::commands::common_impl::LocalModelConnection;
use crate::state::AppState;
use desktop_runtime_core::ApprovalInheritance;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::AppHandle;
use uuid::Uuid;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct DelegateAgentsToolExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ChildRunStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl ChildRunStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone)]
struct ChildRunRecord {
    child_run_id: String,
    execution_id: String,
    agent_id: String,
    agent_type: Option<String>,
    agent_name: String,
    agent_source: String,
    task: String,
    status: ChildRunStatus,
    result: Option<Value>,
    started_at_ms: i64,
    completed_at_ms: Option<i64>,
}

struct StoredChildRun {
    record: ChildRunRecord,
    abort_handle: Option<tauri::async_runtime::JoinHandle<()>>,
}

struct DelegationBatch {
    batch_id: String,
    created_at_ms: i64,
    child_order: Vec<String>,
    children: HashMap<String, StoredChildRun>,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct DelegationBatchManager {
    batches: Mutex<HashMap<String, DelegationBatch>>,
    running_count: Arc<AtomicUsize>,
    max_concurrent: usize,
    batch_ttl_ms: i64,
}

impl DelegationBatchManager {
    fn new() -> Self {
        Self {
            batches: Mutex::new(HashMap::new()),
            running_count: Arc::new(AtomicUsize::new(0)),
            max_concurrent: 8, // 默认最多 8 个并发子 agent
            batch_ttl_ms: 3600_000, // 1 小时后清理已完成的 batch
        }
    }

    fn running_count(&self) -> usize {
        self.running_count.load(Ordering::Relaxed)
    }

    fn can_spawn_child(&self) -> bool {
        self.running_count() < self.max_concurrent
    }

    fn increment_running(&self) {
        self.running_count.fetch_add(1, Ordering::Relaxed);
    }

    fn decrement_running(&self) {
        self.running_count.fetch_sub(1, Ordering::Relaxed);
    }

    fn insert_batch(&self, batch_id: String, children: Vec<ChildRunRecord>) {
        let child_order = children
            .iter()
            .map(|child| child.child_run_id.clone())
            .collect::<Vec<_>>();
        let children = children
            .into_iter()
            .map(|record| {
                (
                    record.child_run_id.clone(),
                    StoredChildRun {
                        record,
                        abort_handle: None,
                    },
                )
            })
            .collect::<HashMap<_, _>>();
        self.batches
            .lock()
            .expect("delegation batch manager poisoned")
            .insert(
                batch_id.clone(),
                DelegationBatch {
                    batch_id,
                    created_at_ms: now_unix_ms_i64(),
                    child_order,
                    children,
                },
            );
    }

    fn cleanup_expired_batches(&self) {
        let mut batches = self
            .batches
            .lock()
            .expect("delegation batch manager poisoned");
        let now = now_unix_ms_i64();
        batches.retain(|_batch_id, batch| {
            let all_terminal = batch.children.values().all(|child| {
                matches!(
                    child.record.status,
                    ChildRunStatus::Completed | ChildRunStatus::Failed | ChildRunStatus::Cancelled
                )
            });
            if all_terminal {
                if let Some(latest_completed) = batch
                    .children
                    .values()
                    .filter_map(|c| c.record.completed_at_ms)
                    .max()
                {
                    return now - latest_completed < self.batch_ttl_ms;
                }
            }
            true
        });
    }

    fn attach_abort_handle(
        &self,
        batch_id: &str,
        child_run_id: &str,
        handle: tauri::async_runtime::JoinHandle<()>,
    ) {
        let mut batches = self
            .batches
            .lock()
            .expect("delegation batch manager poisoned");
        let Some(batch) = batches.get_mut(batch_id) else {
            return;
        };
        let Some(child) = batch.children.get_mut(child_run_id) else {
            return;
        };
        if child.record.status == ChildRunStatus::Running {
            child.abort_handle = Some(handle);
        }
    }

    fn complete_child(
        &self,
        batch_id: &str,
        child_run_id: &str,
        status: ChildRunStatus,
        result: Value,
    ) -> bool {
        let mut batches = self
            .batches
            .lock()
            .expect("delegation batch manager poisoned");
        let Some(batch) = batches.get_mut(batch_id) else {
            return false;
        };
        let Some(child) = batch.children.get_mut(child_run_id) else {
            return false;
        };
        if child.record.status == ChildRunStatus::Cancelled {
            return false;
        }
        child.record.status = status;
        child.record.result = Some(result);
        child.record.completed_at_ms = Some(now_unix_ms_i64());
        child.abort_handle = None;
        true
    }

    fn status_children(
        &self,
        batch_id: &str,
        child_run_ids: Option<&[String]>,
    ) -> Result<Vec<ChildRunRecord>, String> {
        let batches = self
            .batches
            .lock()
            .expect("delegation batch manager poisoned");
        let batch = batches
            .get(batch_id)
            .ok_or_else(|| format!("delegation batch '{batch_id}' not found"))?;
        let requested = child_run_ids.map(|ids| ids.iter().cloned().collect::<HashSet<_>>());
        let mut records = Vec::new();
        for child_run_id in &batch.child_order {
            if requested
                .as_ref()
                .is_some_and(|ids| !ids.contains(child_run_id))
            {
                continue;
            }
            if let Some(child) = batch.children.get(child_run_id) {
                records.push(child.record.clone());
            }
        }
        Ok(records)
    }

    fn stop_children(
        &self,
        batch_id: &str,
        child_run_ids: Option<&[String]>,
    ) -> Result<Vec<StoppedChild>, String> {
        let mut batches = self
            .batches
            .lock()
            .expect("delegation batch manager poisoned");
        let batch = batches
            .get_mut(batch_id)
            .ok_or_else(|| format!("delegation batch '{batch_id}' not found"))?;
        let requested = child_run_ids.map(|ids| ids.iter().cloned().collect::<HashSet<_>>());
        let mut stopped = Vec::new();
        for child_run_id in batch.child_order.clone() {
            if requested
                .as_ref()
                .is_some_and(|ids| !ids.contains(&child_run_id))
            {
                continue;
            }
            let Some(child) = batch.children.get_mut(&child_run_id) else {
                continue;
            };
            let was_running = child.record.status == ChildRunStatus::Running;
            if was_running {
                if let Some(handle) = child.abort_handle.take() {
                    handle.abort();
                }
                child.record.status = ChildRunStatus::Cancelled;
                child.record.completed_at_ms = Some(now_unix_ms_i64());
                child.record.result = Some(cancelled_delegated_result(&child.record));
            }
            stopped.push(StoppedChild {
                child_run_id: child.record.child_run_id.clone(),
                status: child.record.status,
                was_running,
            });
        }
        Ok(stopped)
    }
}

#[derive(Debug, Clone)]
struct StoppedChild {
    child_run_id: String,
    status: ChildRunStatus,
    was_running: bool,
}

fn delegation_batch_manager() -> &'static DelegationBatchManager {
    static MANAGER: OnceLock<DelegationBatchManager> = OnceLock::new();
    MANAGER.get_or_init(DelegationBatchManager::new)
}

struct PreparedChildRun {
    batch_id: String,
    child_run_id: String,
    execution_id: String,
    agent_type: Option<String>,
    agent_source: String,
    task: String,
    profile: CustomTaskAgentProfile,
    execution_selection: DelegatedExecutionSelection,
    packet_receipt: DelegatedExecutionPacketReceipt,
    task_packet: WorkerTaskPacket,
    task_input_source_payload: Value,
    run_in_background: bool,
    max_rounds: u32,
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

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_delegate_agents_start_tool(
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
        .ok_or_else(|| "delegate_agents_start requires a tasks array".to_string())?;
    if tasks.is_empty() {
        return Err("delegate_agents_start requires at least one task".to_string());
    }

    let batch_id = Uuid::new_v4().to_string();
    let mut prepared_children = Vec::with_capacity(tasks.len());
    for (index, item) in tasks.iter().enumerate() {
        prepared_children.push(
            prepare_child_run(
                app_state,
                state,
                batch_id.as_str(),
                index,
                item,
                effective_allowed_tool_names,
            )
            .await?,
        );
    }

    let initial_records = prepared_children
        .iter()
        .map(|prepared| ChildRunRecord {
            child_run_id: prepared.child_run_id.clone(),
            execution_id: prepared.execution_id.clone(),
            agent_id: prepared.profile.id.clone(),
            agent_type: prepared.agent_type.clone(),
            agent_name: prepared.profile.name.clone(),
            agent_source: prepared.agent_source.clone(),
            task: prepared.task.clone(),
            status: ChildRunStatus::Running,
            result: None,
            started_at_ms: now_unix_ms_i64(),
            completed_at_ms: None,
        })
        .collect::<Vec<_>>();
    delegation_batch_manager().insert_batch(batch_id.clone(), initial_records);

    let execution_config = ChildExecutionConfig {
        temperature: state.temperature,
        max_tokens: state.max_tokens,
        model_connection: state.model_connection.clone(),
    };
    let audit_context = AuditContext {
        session_id: session_id.to_string(),
        trace_id: state.trace_id.clone(),
        request_id: state.request_id.clone(),
        runtime_transition_blocks: state.runtime_transition_blocks.clone(),
    };
    let mut start_records = Vec::new();
    for prepared in prepared_children {
        if prepared.run_in_background {
            // 检查并发限制
            if !delegation_batch_manager().can_spawn_child() {
                log::warn!(
                    "max concurrent children reached, queuing child batch_id={} child_run_id={}",
                    batch_id,
                    prepared.child_run_id
                );
                // 标记为 failed，返回错误
                let error_result = json!({
                    "type": "delegated_result",
                    "status": "failed",
                    "error": format!(
                        "Max concurrent children ({}) reached. Current running: {}",
                        delegation_batch_manager().max_concurrent,
                        delegation_batch_manager().running_count()
                    ),
                    "primary_output": {
                        "status": "rejected",
                        "message": "Concurrency limit exceeded",
                    }
                });
                delegation_batch_manager().complete_child(
                    batch_id.as_str(),
                    prepared.child_run_id.as_str(),
                    ChildRunStatus::Failed,
                    error_result,
                );
                continue;
            }

            persist_background_resume_context(
                app_state,
                state,
                call_id,
                &prepared,
                prepared.max_rounds as usize,
            )
            .await?;
            create_run_record(app_state, &prepared, &execution_config).await;

            delegation_batch_manager().increment_running();
            let child_run_id = prepared.child_run_id.clone();
            let handle = spawn_background_child(
                app.clone(),
                app_state.clone(),
                execution_config.clone(),
                audit_context.clone(),
                prepared,
            );
            delegation_batch_manager().attach_abort_handle(
                batch_id.as_str(),
                child_run_id.as_str(),
                handle,
            );
        } else {
            create_run_record(app_state, &prepared, &execution_config).await;
            let child_run_id = prepared.child_run_id.clone();
            let batch_id_clone = batch_id.clone();

            // 前台模式：添加超时保护
            let timeout_ms = prepared.max_rounds as u64 * 120_000; // 每轮 2 分钟
            let timeout_duration = Duration::from_millis(timeout_ms.min(600_000)); // 最多 10 分钟

            let run_future = run_prepared_child(app, app_state, &execution_config, prepared);
            let session_result = tokio::time::timeout(timeout_duration, run_future).await;

            match session_result {
                Ok(session) => {
                    let status = child_status_from_session(&session);
                    let delegated_result = session.record.delegated_result();
                    let error = session.record.error.clone();

                    delegation_batch_manager().complete_child(
                        batch_id.as_str(),
                        child_run_id.as_str(),
                        status,
                        delegated_result.clone(),
                    );
                    persist_child_run_terminal_state(
                        app_state,
                        child_run_id.as_str(),
                        status,
                        &delegated_result,
                        error.as_deref(),
                    )
                    .await;
                    persist_delegated_execution_audit(app_state, &audit_context, &session).await;
                }
                Err(_) => {
                    // 超时
                    log::warn!(
                        "foreground child execution timeout batch_id={} child_run_id={} timeout_ms={}",
                        batch_id_clone,
                        child_run_id,
                        timeout_ms
                    );
                    let timeout_result = json!({
                        "type": "delegated_result",
                        "status": "failed",
                        "error": format!("Execution timeout after {}ms", timeout_ms),
                        "primary_output": {
                            "status": "timeout",
                            "message": format!("Child agent execution exceeded timeout of {}ms", timeout_ms),
                        }
                    });
                    delegation_batch_manager().complete_child(
                        batch_id.as_str(),
                        child_run_id.as_str(),
                        ChildRunStatus::Failed,
                        timeout_result.clone(),
                    );
                    persist_child_run_terminal_state(
                        app_state,
                        child_run_id.as_str(),
                        ChildRunStatus::Failed,
                        &timeout_result,
                        Some("execution timeout"),
                    )
                    .await;
                }
            }
        }
    }
    start_records.extend(
        delegation_batch_manager()
            .status_children(batch_id.as_str(), None)?
            .into_iter()
            .map(child_record_json),
    );

    let result = json!({
        "delegation_batch_id": batch_id,
        "children": start_records,
    });
    Ok(tool_success_result(
        call_id,
        tool_name,
        result,
        "Delegate agents start result",
    ))
}

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
        let session =
            run_prepared_child(&app_handle, &app_state, &execution_config, prepared).await;
        let status = child_status_from_session(&session);
        let delegated_result = session.record.delegated_result();
        let accepted = delegation_batch_manager().complete_child(
            batch_id.as_str(),
            child_run_id.as_str(),
            status,
            delegated_result.clone(),
        );

        // 递减运行计数
        delegation_batch_manager().decrement_running();

        if !accepted {
            log::info!(
                "delegate_agents_start late child result ignored batch_id={} child_run_id={}",
                batch_id,
                child_run_id
            );
            return;
        }
        persist_child_run_terminal_state(
            &app_state,
            child_run_id.as_str(),
            status,
            &delegated_result,
            session.record.error.as_deref(),
        )
        .await;
        persist_delegated_execution_audit(&app_state, &audit_context, &session).await;
        let execution_id = session.record.execution_id.clone();
        let event_id = format!("custom_task_agent:{}:{}", child_run_id, status.as_str());
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

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_delegate_agents_status_tool(
    call_id: &str,
    tool_name: &str,
    arguments: &Value,
) -> Result<DelegateAgentsToolExecutionResult, String> {
    // 定期清理过期 batch
    delegation_batch_manager().cleanup_expired_batches();

    let batch_id = required_non_empty_string(
        arguments,
        "delegation_batch_id",
        "delegate_agents_status requires delegation_batch_id",
    )?;
    let child_run_ids = optional_string_array(arguments, "child_run_ids")?;
    let records =
        delegation_batch_manager().status_children(batch_id.as_str(), child_run_ids.as_deref())?;
    let result = json!({
        "batch_id": batch_id,
        "children": records.into_iter().map(child_record_json).collect::<Vec<_>>(),
    });
    Ok(tool_success_result(
        call_id,
        tool_name,
        result,
        "Delegate agents status result",
    ))
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_delegate_agents_stop_tool(
    app_state: &AppState,
    call_id: &str,
    tool_name: &str,
    arguments: &Value,
) -> Result<DelegateAgentsToolExecutionResult, String> {
    let batch_id = required_non_empty_string(
        arguments,
        "delegation_batch_id",
        "delegate_agents_stop requires delegation_batch_id",
    )?;
    let child_run_ids = optional_string_array(arguments, "child_run_ids")?;
    let stopped =
        delegation_batch_manager().stop_children(batch_id.as_str(), child_run_ids.as_deref())?;
    for child in &stopped {
        if child.was_running {
            if let Err(err) = cancel_custom_task_agent_run(
                app_state.mcp.store.as_ref(),
                child.child_run_id.as_str(),
            )
            .await
            {
                log::warn!(
                    "cancel_custom_task_agent_run failed run_id={} err={}",
                    child.child_run_id,
                    err
                );
            }
        }
    }
    let result = json!({
        "batch_id": batch_id,
        "stopped_children": stopped
            .into_iter()
            .map(|child| json!({
                "child_run_id": child.child_run_id,
                "status": child.status.as_str(),
                "was_running": child.was_running,
            }))
            .collect::<Vec<_>>(),
    });
    Ok(tool_success_result(
        call_id,
        tool_name,
        result,
        "Delegate agents stop result",
    ))
}

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
        "delegate_agents_start task item requires a non-empty task",
    )?;
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
    let run_in_background = item
        .get("run_in_background")
        .and_then(Value::as_bool)
        .unwrap_or(false);
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
        (selection, None, "registered".to_string(), None)
    } else {
        let agent_type = agent_type.ok_or_else(|| {
            "delegate_agents_start task item requires agent_type or agent_id".to_string()
        })?;
        let spec = parse_ephemeral_agent_spec(item.get("agent_spec"))?;
        let ephemeral = build_ephemeral_agent_profile(agent_type.as_str(), spec, batch_id, index)?;
        let selection = ephemeral_selection(ephemeral.profile.clone(), agent_type.as_str());
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
        profile: selection.profile.clone(),
        execution_selection,
        packet_receipt,
        task_packet,
        task_input_source_payload,
        run_in_background,
        max_rounds,
    })
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

async fn create_run_record(
    app_state: &AppState,
    prepared: &PreparedChildRun,
    execution_config: &ChildExecutionConfig,
) {
    if let Err(err) = create_custom_task_agent_run(
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
    {
        log::warn!(
            "create_custom_task_agent_run failed run_id={} err={}",
            prepared.child_run_id,
            err
        );
    }
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

async fn persist_background_resume_context(
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    call_id: &str,
    prepared: &PreparedChildRun,
    max_rounds: usize,
) -> Result<(), String> {
    let context = serialize_delegated_runtime_context_with_task_input_source(
        Some(format!(
            "delegate_agents_start:{}:{}",
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
    );

    persist_execution_graph_runtime_context(
        app_state.mcp.store.as_ref(),
        prepared.execution_id.as_str(),
        &context,
    )
    .await
    .map_err(|err| err.to_string())
}

async fn persist_child_run_terminal_state(
    app_state: &AppState,
    child_run_id: &str,
    status: ChildRunStatus,
    delegated_result: &Value,
    error: Option<&str>,
) {
    let result = match status {
        ChildRunStatus::Completed => {
            complete_custom_task_agent_run(
                app_state.mcp.store.as_ref(),
                child_run_id,
                delegated_result,
            )
            .await
        }
        ChildRunStatus::Failed => {
            fail_custom_task_agent_run(
                app_state.mcp.store.as_ref(),
                child_run_id,
                error.unwrap_or("delegated child failed"),
            )
            .await
        }
        ChildRunStatus::Cancelled => {
            cancel_custom_task_agent_run(app_state.mcp.store.as_ref(), child_run_id).await
        }
        ChildRunStatus::Running => Ok(()),
    };
    if let Err(err) = result {
        log::warn!(
            "persist child run terminal state failed run_id={} status={} err={}",
            child_run_id,
            status.as_str(),
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
    audit::persist_delegate_task_execution_graph_snapshot(
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

fn child_status_from_session(session: &DelegatedExecutionSession) -> ChildRunStatus {
    match session.record.status {
        DelegatedExecutionStatus::Succeeded | DelegatedExecutionStatus::Integrated => {
            ChildRunStatus::Completed
        }
        DelegatedExecutionStatus::Cancelled => ChildRunStatus::Cancelled,
        DelegatedExecutionStatus::Failed => ChildRunStatus::Failed,
        _ => ChildRunStatus::Running,
    }
}

fn cap_child_max_rounds(value: u32, runtime_max_rounds: usize) -> u32 {
    let runtime_cap = runtime_max_rounds.max(1).min(u32::MAX as usize) as u32;
    value.max(1).min(runtime_cap)
}

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

fn child_record_json(record: ChildRunRecord) -> Value {
    json!({
        "child_run_id": record.child_run_id,
        "execution_id": record.execution_id,
        "agent_id": record.agent_id,
        "agent_type": record.agent_type,
        "agent_name": record.agent_name,
        "agent_source": record.agent_source,
        "task": record.task,
        "status": record.status.as_str(),
        "delegated_result": record.result,
        "started_at_ms": record.started_at_ms,
        "completed_at_ms": record.completed_at_ms,
    })
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

fn cancelled_delegated_result(record: &ChildRunRecord) -> Value {
    json!({
        "type": "delegated_result",
        "schema_version": 1,
        "kind": DelegatedExecutionKind::CustomTaskAgent.as_str(),
        "authoritative": false,
        "status": "cancelled",
        "execution_id": record.execution_id,
        "target": {
            "id": record.agent_id,
            "name": record.agent_name,
            "invocation_kind": "chat",
            "worker_ref": format!("custom_task_agent_run:{}", record.child_run_id),
            "workflow_run_id": null,
        },
        "selection": {
            "explicit": true,
            "score": null,
            "reason_codes": ["delegate_agents_stop"],
            "reason_text": "cancelled by delegate_agents_stop",
            "candidate_count": 1,
            "selected_from_top_k": 1,
            "callable_coverage_score": null,
            "modality_fit_score": null,
            "profile_prior_score": null,
        },
        "packet_receipt": null,
        "available_actions": [],
        "summary": "Delegated child cancelled",
        "steps": [],
        "primary_output": {
            "status": "cancelled",
            "agent_id": record.agent_id,
            "agent_name": record.agent_name,
            "run_id": record.child_run_id,
            "task": record.task,
        },
        "error": null,
        "started_at_ms": record.started_at_ms,
        "completed_at_ms": record.completed_at_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_status_preserves_start_order_and_stop_ignores_completed() {
        let manager = DelegationBatchManager::new();
        manager.insert_batch(
            "batch-1".to_string(),
            vec![
                test_record("run-1"),
                test_record("run-2"),
                test_record("run-3"),
            ],
        );
        assert!(manager.complete_child(
            "batch-1",
            "run-2",
            ChildRunStatus::Completed,
            json!({"status": "completed"})
        ));

        let stopped = manager
            .stop_children("batch-1", Some(&["run-1".to_string(), "run-2".to_string()]))
            .expect("stop should work");
        assert_eq!(stopped.len(), 2);
        assert_eq!(stopped[0].child_run_id, "run-1");
        assert_eq!(stopped[0].status, ChildRunStatus::Cancelled);
        assert!(stopped[0].was_running);
        assert_eq!(stopped[1].child_run_id, "run-2");
        assert_eq!(stopped[1].status, ChildRunStatus::Completed);
        assert!(!stopped[1].was_running);

        assert!(!manager.complete_child(
            "batch-1",
            "run-1",
            ChildRunStatus::Completed,
            json!({"status": "completed"})
        ));
        let records = manager.status_children("batch-1", None).expect("status");
        assert_eq!(
            records
                .iter()
                .map(|record| record.child_run_id.as_str())
                .collect::<Vec<_>>(),
            vec!["run-1", "run-2", "run-3"]
        );
        assert_eq!(records[0].status, ChildRunStatus::Cancelled);
    }

    #[test]
    fn concurrency_limit_enforced() {
        let manager = DelegationBatchManager::new();
        assert_eq!(manager.running_count(), 0);
        assert!(manager.can_spawn_child());

        // 模拟达到并发上限
        for _ in 0..manager.max_concurrent {
            manager.increment_running();
        }
        assert_eq!(manager.running_count(), manager.max_concurrent);
        assert!(!manager.can_spawn_child());

        // 递减后可以再次 spawn
        manager.decrement_running();
        assert!(manager.can_spawn_child());
        assert_eq!(manager.running_count(), manager.max_concurrent - 1);
    }

    #[test]
    fn cleanup_expired_batches_removes_old_completed() {
        let manager = DelegationBatchManager::new();
        let old_time = now_unix_ms_i64() - manager.batch_ttl_ms - 1000;

        // 插入一个旧的已完成 batch
        manager.insert_batch("batch-old".to_string(), vec![test_record("run-1")]);
        {
            let mut batches = manager.batches.lock().unwrap();
            if let Some(batch) = batches.get_mut("batch-old") {
                if let Some(child) = batch.children.get_mut("run-1") {
                    child.record.status = ChildRunStatus::Completed;
                    child.record.completed_at_ms = Some(old_time);
                }
            }
        }

        // 插入一个新的 batch
        manager.insert_batch("batch-new".to_string(), vec![test_record("run-2")]);

        // 清理前应该有 2 个 batch
        assert_eq!(manager.batches.lock().unwrap().len(), 2);

        // 清理
        manager.cleanup_expired_batches();

        // 清理后只剩新的 batch
        let batches = manager.batches.lock().unwrap();
        assert_eq!(batches.len(), 1);
        assert!(batches.contains_key("batch-new"));
        assert!(!batches.contains_key("batch-old"));
    }

    #[test]
    fn cleanup_keeps_running_batches() {
        let manager = DelegationBatchManager::new();
        manager.insert_batch("batch-running".to_string(), vec![test_record("run-1")]);

        // 清理不应该删除运行中的 batch
        manager.cleanup_expired_batches();
        assert_eq!(manager.batches.lock().unwrap().len(), 1);
    }

    fn test_record(child_run_id: &str) -> ChildRunRecord {
        ChildRunRecord {
            child_run_id: child_run_id.to_string(),
            execution_id: format!("exec-{child_run_id}"),
            agent_id: "agent.test".to_string(),
            agent_type: Some("explore".to_string()),
            agent_name: "Test Agent".to_string(),
            agent_source: "ephemeral".to_string(),
            task: "test".to_string(),
            status: ChildRunStatus::Running,
            result: None,
            started_at_ms: 1,
            completed_at_ms: None,
        }
    }
}
