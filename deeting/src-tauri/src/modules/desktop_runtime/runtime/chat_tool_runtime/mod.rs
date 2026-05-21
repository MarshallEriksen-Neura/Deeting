use super::sovereign::{Advisory, DecisionLocus, Self_};
use super::{
    activate_skill_from_args, append_streamable_local_tool_result_blocks,
    build_delegated_result_feedback_messages, build_local_runtime_tools_with_allowlist,
    build_local_sdk_search_result_bundle_with_feedback_runtime, build_local_tool_trace_blocks,
    build_tool_loop_feedback, build_worker_task_packet, delete_execution_graph_runtime_context,
    execute_or_queue_mcp_tool_call_with_tool_ref, extract_chat_tool_calls,
    install_local_skill_from_onboarding_request, list_execution_graph_runtime_contexts,
    load_execution_graph_runtime_context, load_execution_graph_snapshot,
    persist_execution_graph_runtime_context, persist_execution_graph_snapshot,
    project_execution_graph_blocks_from_value, project_execution_graph_snapshot,
    read_skill_resource_from_args, request_provider_chat_completion,
    resolve_local_capability_activation_state, resolve_provider_tool_name_for_execution,
    resolve_tool_trace_call_id, search_feedback::search_feedback_context_from_tool_call_meta,
    ActiveSkillContextState, CapabilityExecutionContract, DelegatedExecutionKind,
    DelegatedExecutionPacketReceipt, DelegatedExecutionRecord, DelegatedExecutionSelection,
    DelegatedExecutionStatus, DelegatedExecutionTarget, GraphProjectionInput,
    LocalCapabilityActivationState, LocalExecutionPolicy, WorkerTaskPacketInput,
    LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
};
use crate::modules::ai_upstream::ReasoningRequestConfig;
use crate::modules::custom_task_agents::runtime::preview_custom_task_agent_with_parent_model;
use crate::modules::custom_task_agents::service::create_custom_task_agent_service;
use crate::modules::custom_task_agents::types::{
    CreateCustomTaskAgentRequest, CustomTaskAgentPreviewRequest,
};
use crate::modules::desktop_config::{parse_max_agentic_rounds, MAX_AGENTIC_ROUNDS_CONFIG_KEY};
use crate::modules::desktop_runtime::context_orchestrator::{
    execute_context_tool, is_context_tool,
};
use crate::modules::desktop_runtime::runtime::execution_plane::{
    DelegatedExecutionAction, DelegatedExecutionChildRecord,
};
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::mcp::commands::common_impl::LocalModelConnection;
use crate::modules::mcp::commands::support::*;
use crate::modules::sandbox::prepare_config::resolve_sandbox_prepare_config;
use mcp_session::conversation::CreateConversationMessageRequest;

mod approval_commands;
mod inflight;
mod recovery;
mod replay;
mod suspended;
mod terminal_context;
#[cfg(test)]
mod tests;
mod tool_meta;
mod workflow_context;

pub(crate) use approval_commands::{
    dispatch_local_chat_execution_run_command, ExecutionRunCommand,
};
#[cfg(test)]
use inflight::mark_delegated_wait_event_consumed;
use inflight::runtime_state_from_persisted_context;
#[cfg(test)]
use inflight::PersistedPendingApproval;
use inflight::{
    build_pending_approval_records_from_tool_call_meta, clear_execution_graph_runtime_context,
    now_unix_ms_i64, persist_running_tool_execution_runtime,
    persistable_inflight_context_from_value,
};
pub(crate) use inflight::{
    build_persisted_chat_runtime_context_from_execution_request,
    collect_waiting_approval_tokens_from_graph, derive_pending_approvals_from_graph,
    list_canonical_pending_local_approval_snapshots, load_suspended_chat_tool_execution_for_resume,
    materialize_pending_local_approval_from_runtime_context,
    persist_suspended_execution_graph_runtime, serialize_delegated_runtime_context,
    serialize_delegated_workflow_runtime_context, serialize_inflight_runtime_context,
    InFlightExecutionStage,
};
use recovery::extract_resume_response_text;
#[cfg(test)]
use recovery::{
    attach_execution_graph_to_response, build_local_chat_resume_continuation_blocks,
    build_persisted_resume_assistant_blocks, build_persisted_resume_assistant_meta,
};
pub(crate) use recovery::{
    project_local_chat_approval_state_payload, recover_inflight_local_execution_state,
    recover_local_chat_execution_from_action, resume_delegated_runtime_after_custom_task_agent_run,
    resume_suspended_chat_tool_execution_after_approval, wake_delegated_runtime_for_workflow_run,
};
use replay::finalize_tool_round;
#[cfg(test)]
use replay::{build_structured_tool_replay_messages, serialize_tool_replay_content};
pub(crate) use suspended::SuspendedChatToolExecution;
use terminal_context::{execute_terminal_context_tool, is_terminal_context_tool};
use tool_meta::{
    apply_approved_tool_result_to_execution_graph, attach_graph_metadata_to_pending_tool_meta,
    build_effective_tool_call_meta, build_state_effective_tool_call_meta,
    build_tool_call_meta_from_execution_graph, canonicalize_tool_call_meta_via_graph,
    canonicalize_tool_name_for_allowed_list, derive_pending_call_id_from_tool_call_meta,
    enrich_response_with_tool_trace, last_response_content_or_empty,
    push_local_tool_call_error_meta, record_query_affinity_from_tool_meta,
    resolve_local_tool_call_id, strip_stale_resume_response_metadata,
    summarize_tool_call_meta_results, tool_call_meta_matches_call_id,
    tool_call_meta_with_resolved_ids,
};
pub(crate) use tool_meta::{
    apply_rejected_tool_result_to_execution_graph_value, mark_approval_gate_approving,
};
use workflow_context::{execute_workflow_plan_tool, is_workflow_plan_tool};

const DITING_THINK_TOOL_NAME: &str = "diting_think";

fn inject_diting_think_tool(tools: Option<serde_json::Value>) -> Option<serde_json::Value> {
    let diting_think_entry = serde_json::json!({
        "type": "function",
        "function": {
            "name": DITING_THINK_TOOL_NAME,
            "description": "Structured deep-reasoning tool. Call this ONCE before executing any other tool when the task involves multi-step execution, ambiguous intent, or coordination across multiple capabilities. Analyze the user intent against the currently available tools and context, then output a concrete execution plan. Do NOT call this for trivial single-tool tasks. This tool is only available in the first round and disappears afterward.",
            "parameters": {
                "type": "object",
                "properties": {
                    "intent": {
                        "type": "string",
                        "description": "One-sentence summary of the user's core intent."
                    },
                    "context_assessment": {
                        "type": "string",
                        "description": "Relevant context already available: injected memories, prior conversation state, discovered capabilities. What do you already know that matters?"
                    },
                    "tool_plan": {
                        "type": "string",
                        "description": "Which tools to call, in what order, with what arguments. Be specific \u{2014} name exact tools and justify the sequence."
                    },
                    "constraints": {
                        "type": "string",
                        "description": "Key risks, edge cases, permission boundaries, or scope limits that could derail execution."
                    }
                },
                "required": ["intent", "tool_plan"]
            }
        }
    });
    match tools {
        Some(mut value) => {
            if let Some(arr) = value.get_mut("tools").and_then(|v| v.as_array_mut()) {
                arr.insert(0, diting_think_entry);
            }
            Some(value)
        }
        None => Some(serde_json::json!({ "tools": [diting_think_entry] })),
    }
}

fn format_diting_think_reasoning(arguments: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    if let Some(intent) = arguments
        .get("intent")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
    {
        parts.push(format!("[意图] {}", intent.trim()));
    }
    if let Some(context) = arguments
        .get("context_assessment")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
    {
        parts.push(format!("[上下文] {}", context.trim()));
    }
    if let Some(plan) = arguments
        .get("tool_plan")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
    {
        parts.push(format!("[执行计划] {}", plan.trim()));
    }
    if let Some(constraints) = arguments
        .get("constraints")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
    {
        parts.push(format!("[约束] {}", constraints.trim()));
    }
    parts.join("\n")
}

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
        skill_context_update: Option<ActiveSkillContextState>,
    },
    Interrupted {
        approval_tokens: Vec<String>,
        tool_call_meta: Vec<serde_json::Value>,
        results: Vec<String>,
        capability_update: Option<LocalCapabilityTransition>,
        skill_context_update: Option<ActiveSkillContextState>,
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
    task_query: Option<String>,
    session_id: String,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    reasoning_enabled: Option<bool>,
    reasoning_effort: Option<String>,
    active_capability: Option<LocalCapabilityActivationState>,
    active_skill_context: Option<ActiveSkillContextState>,
    diting_think_consumed: bool,
    captured_reasoning: Option<String>,
    runtime_metrics: RuntimeMetricsAccumulator,
    last_capability_snapshot: Option<serde_json::Value>,
    terminal_context: Option<serde_json::Value>,
    workflow_context: Option<serde_json::Value>,
    last_response: Option<serde_json::Value>,
    realtime_emitter: LocalRealtimeToolTraceEmitter,
    // Selected knowledge file IDs supplied by the workflow context manifest,
    // used as a fallback when the model calls `context_search` with
    // `scope: "selected"` but omits `filters.selected_file_ids`.
    selected_knowledge_file_ids: Vec<String>,
}

struct LocalChatToolRuntimeOutput {
    response: serde_json::Value,
    captured_reasoning: Option<String>,
}

fn backfill_captured_reasoning(response: &mut serde_json::Value, captured_reasoning: Option<&str>) {
    let reasoning = match captured_reasoning.map(str::trim).filter(|v| !v.is_empty()) {
        Some(r) => r,
        None => return,
    };
    let has_native = response
        .get("reasoning_content")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_some();
    if !has_native {
        if let Some(obj) = response.as_object_mut() {
            obj.insert(
                "reasoning_content".to_string(),
                serde_json::Value::String(reasoning.to_string()),
            );
        }
    }
}

fn extract_initial_task_query(messages: &[LocalChatInputMessage]) -> Option<String> {
    messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.content.trim().to_string())
        .filter(|value| !value.is_empty())
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
    reasoning_enabled: Option<bool>,
    reasoning_effort: Option<String>,
    terminal_context: Option<serde_json::Value>,
    workflow_context: Option<serde_json::Value>,
    event_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    trace_id: Option<&str>,
    request_id: Option<&str>,
    selected_knowledge_file_ids: Vec<String>,
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
    let task_query = extract_initial_task_query(&messages);
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
                "- Follow the base Agent Skills Progressive Disclosure contract for skill discovery, activation, resource reading, and execution boundaries.\n",
            ).to_string(),
            reasoning_content: None,
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
        task_query,
        session_id: chat_ctx.session_id.clone(),
        temperature,
        max_tokens,
        reasoning_enabled,
        reasoning_effort,
        active_capability: None,
        active_skill_context: None,
        diting_think_consumed: false,
        captured_reasoning: None,
        runtime_metrics: RuntimeMetricsAccumulator::default(),
        last_capability_snapshot: execution_policy.capability_snapshot.clone(),
        terminal_context,
        workflow_context,
        last_response: None,
        realtime_emitter: LocalRealtimeToolTraceEmitter::new(
            event_tx,
            Some(trace_id.as_str()),
            request_id,
        ),
        selected_knowledge_file_ids,
    };
    continue_local_chat_complete_with_tools(app, app_state, state)
        .await
        .map(|mut output| {
            backfill_captured_reasoning(&mut output.response, output.captured_reasoning.as_deref());
            output.response
        })
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
                captured_reasoning: state.captured_reasoning.clone(),
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
        let tools = if state.round == 1 && !state.diting_think_consumed {
            inject_diting_think_tool(tools)
        } else {
            tools
        };
        let response = request_provider_chat_completion(
            app_state,
            &provider_model_id,
            &model_id,
            state.orchestrated_messages.clone(),
            tools,
            state.temperature,
            state.max_tokens,
            ReasoningRequestConfig {
                enabled: state.reasoning_enabled,
                effort: state.reasoning_effort.clone(),
            },
            Some(state.trace_id.as_str()),
            Some(session_id.as_str()),
        )
        .await
        .map_err(to_string)?;
        state.runtime_metrics.observe_response(&response);

        if extract_chat_tool_calls(&response).is_empty() {
            let effective_tool_call_meta = build_state_effective_tool_call_meta(&state);
            return Ok(LocalChatToolRuntimeOutput {
                captured_reasoning: state.captured_reasoning.clone(),
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
            task_query: state.task_query.clone(),
            session_id: state.session_id.clone(),
            temperature: state.temperature,
            max_tokens: state.max_tokens,
            reasoning_enabled: state.reasoning_enabled,
            reasoning_effort: state.reasoning_effort.clone(),
            active_capability: state.active_capability.clone(),
            active_skill_context: state.active_skill_context.clone(),
            diting_think_consumed: state.diting_think_consumed,
            captured_reasoning: state.captured_reasoning.clone(),
            runtime_metrics: state.runtime_metrics.clone(),
            last_capability_snapshot: state.last_capability_snapshot.clone(),
            terminal_context: state.terminal_context.clone(),
            workflow_context: state.workflow_context.clone(),
            last_response: state.last_response.clone(),
            realtime_emitter: LocalRealtimeToolTraceEmitter::new(
                None,
                Some(state.trace_id.as_str()),
                state.request_id.as_deref(),
            ),
            selected_knowledge_file_ids: state.selected_knowledge_file_ids.clone(),
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
                skill_context_update,
            } => {
                if let Some(update) = skill_context_update {
                    state.active_skill_context = Some(update);
                }
                if let Some(reasoning) = tool_call_meta.iter().find_map(|item| {
                    if item.get("name").and_then(|v| v.as_str()) == Some(DITING_THINK_TOOL_NAME) {
                        item.get("reasoning")
                            .and_then(|v| v.as_str())
                            .map(str::to_string)
                    } else {
                        None
                    }
                }) {
                    state.diting_think_consumed = true;
                    state.captured_reasoning = Some(reasoning);
                }
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
                        captured_reasoning: state.captured_reasoning.clone(),
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
                approval_tokens: _approval_tokens,
                mut tool_call_meta,
                results,
                capability_update,
                skill_context_update,
            } => {
                if let Some(update) = skill_context_update {
                    state.active_skill_context = Some(update);
                }
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
                let persisted_pending_approvals =
                    build_pending_approval_records_from_tool_call_meta(
                        &tool_call_meta,
                        state.session_id.as_str(),
                    );
                if let Err(err) = persist_suspended_execution_graph_runtime(
                    app_state.mcp.store.as_ref(),
                    &suspended,
                    &persisted_pending_approvals,
                    "desktop_local_chat_waiting_approval",
                    "waiting_approval",
                    InFlightExecutionStage::WaitingApproval,
                    None,
                )
                .await
                {
                    log::warn!(
                        "persist_suspended_execution_graph_runtime failed session={} err={}",
                        state.session_id,
                        err
                    );
                }
                let mut current_tool_call_meta = build_state_effective_tool_call_meta(&state);
                // Use the graph-enriched pending meta we just prepared above so the
                // first approval card carries execution_graph identifiers.
                current_tool_call_meta.extend(tool_call_meta.clone());
                let interrupted = serde_json::json!({
                    "content": last_response_content_or_empty(state.last_response.as_ref()),
                });
                return Ok(LocalChatToolRuntimeOutput {
                    captured_reasoning: state.captured_reasoning.clone(),
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
        "本次任务已用完 {0}/{0} 轮 Agent 执行预算。当前进度已保留；如需更长的搜索、验证、委托或审批流程，请在设置中提高 `max_agentic_rounds` 后继续本任务。",
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

fn resolve_child_agent_max_rounds(arguments: &serde_json::Value, runtime_max_rounds: usize) -> u32 {
    let runtime_cap = runtime_max_rounds.max(1).min(u32::MAX as usize);
    arguments
        .get("max_rounds")
        .and_then(serde_json::Value::as_u64)
        .map(|value| value.min(u32::MAX as u64) as usize)
        .map(|value| value.max(1).min(runtime_cap))
        .unwrap_or(runtime_cap) as u32
}

fn classify_local_tool_execution_error_code(error: &str) -> &'static str {
    let normalized = error.trim();
    if normalized.starts_with("MCP tool '") && normalized.contains(" timed out after ") {
        "MCP_TOOL_TIMEOUT"
    } else {
        "LOCAL_TOOL_EXECUTION_FAILED"
    }
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

    fn emit_execution_section_once(&mut self, title: &str) {
        if self.emitted_execution_section {
            return;
        }
        self.emitted_execution_section = true;
        self.emit_blocks(vec![
            serde_json::json!({ "type": "execution_section", "title": title }),
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

async fn execute_delegate_task_tool(
    app: &AppHandle,
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    session_id: &str,
    call_id: &str,
    arguments: &serde_json::Value,
    effective_allowed_tool_names: &[String],
) -> Result<serde_json::Value, String> {
    let task = arguments
        .get("task")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "delegate_task requires a non-empty 'task' argument".to_string())?;
    let agent_id = arguments
        .get("agent_id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let selection = super::select_worker_custom_task_agent(app_state, agent_id, task)
        .await?
        .ok_or_else(|| "no enabled custom task agent matched delegate_task".to_string())?;
    let execution_id = uuid::Uuid::new_v4().to_string();
    let requires_bound_callable_surface = matches!(
        selection.profile.invocation_kind,
        crate::modules::custom_task_agents::types::CustomTaskAgentInvocationKind::Chat
    );
    if requires_bound_callable_surface
        && selection.profile.callable_mcp_tool_ids.is_empty()
        && selection.profile.callable_skill_action_refs.is_empty()
    {
        let started_at_ms = now_unix_ms_i64();
        let record = DelegatedExecutionRecord {
            execution_id: execution_id.clone(),
            kind: DelegatedExecutionKind::CustomTaskAgent,
            status: DelegatedExecutionStatus::Failed,
            target: DelegatedExecutionTarget {
                id: selection.profile.id.clone(),
                name: selection.profile.name.clone(),
                invocation_kind: Some(selection.profile.invocation_kind.as_str().to_string()),
                worker_ref: None,
                workflow_run_id: None,
            },
            selection: DelegatedExecutionSelection {
                explicit: agent_id.is_some(),
                score: Some(selection.score),
                reason_codes: selection.reason_codes.clone(),
                reason_text: Some(selection.reason.clone()).filter(|value| !value.trim().is_empty()),
                candidate_count: selection.candidate_count,
                selected_from_top_k: selection.selected_from_top_k,
                callable_coverage_score: Some(selection.callable_coverage_score),
                modality_fit_score: Some(selection.modality_fit_score),
                profile_prior_score: Some(selection.profile_prior_score),
            },
            packet_receipt: None,
            available_actions: vec![DelegatedExecutionAction {
                kind: "reconfigure_agent".to_string(),
            }],
            children: vec![DelegatedExecutionChildRecord {
                id: format!("{}:preflight", execution_id),
                phase_id: Some("preflight".to_string()),
                step_type: Some("capability_check".to_string()),
                title: "Validate delegated capability surface".to_string(),
                status: "blocked".to_string(),
                worker_ref: Some(format!("custom_task_agent:{}", selection.profile.id)),
                summary: Some("Delegation blocked before launch because the selected task agent has no executable tools or skill actions bound.".to_string()),
                error: Some("The selected task agent only has prompt or guidance context. Bind at least one executable MCP tool or callable skill action before using delegate_task.".to_string()),
                available_actions: vec![DelegatedExecutionAction {
                    kind: "reconfigure_agent".to_string(),
                }],
            }],
            summary: Some("Delegation blocked before launch".to_string()),
            primary_output: Some(serde_json::json!({
                "status": "blocked",
                "agent_id": selection.profile.id,
                "agent_name": selection.profile.name,
                "reason": "missing_executable_surface",
                "message": "The selected task agent has no executable MCP tools or callable skill actions bound.",
                "callable_mcp_tool_ids": [],
                "guidance_skill_ids": selection.profile.guidance_skill_ids,
                "callable_skill_action_refs": [],
                "session_id": session_id,
                "tool_call_id": call_id,
            })),
            error: Some("delegate_task blocked: selected task agent has no executable surface".to_string()),
            started_at_ms,
            completed_at_ms: Some(now_unix_ms_i64()),
        };
        return Ok(record.delegated_result());
    }
    let constraints = arguments
        .get("constraints")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let context_refs = arguments
        .get("context_refs")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let max_rounds = resolve_child_agent_max_rounds(arguments, state.max_rounds);
    let task_packet = build_worker_task_packet(
        &selection,
        WorkerTaskPacketInput {
            task_id: execution_id.clone(),
            route: state.execution_policy.route.as_str().to_string(),
            goal: task.to_string(),
            user_query: task.to_string(),
            raw_user_text: Some(task.to_string()),
            image_urls: Vec::new(),
            parent_allowed_tool_names: effective_allowed_tool_names.to_vec(),
            prefer_workflow_runtime: state.execution_policy.prefer_workflow_runtime,
            explicit_task_agent_id: agent_id.map(str::to_string),
            bound_asset_reference: None,
        },
    );
    let started_at_ms = now_unix_ms_i64();
    let response_result = preview_custom_task_agent_with_parent_model(
        app,
        app_state,
        &selection.profile,
        CustomTaskAgentPreviewRequest {
            message: task.to_string(),
            image_urls: Vec::new(),
            temperature: state.temperature,
            max_tokens: state.max_tokens,
            max_rounds: Some(max_rounds),
            worker_task_packet: Some(task_packet.as_value()),
        },
        Some(&state.model_connection),
    )
    .await;
    let selection_payload = DelegatedExecutionSelection {
        explicit: agent_id.is_some(),
        score: Some(selection.score),
        reason_codes: selection.reason_codes.clone(),
        reason_text: Some(selection.reason.clone()).filter(|value| !value.trim().is_empty()),
        candidate_count: selection.candidate_count,
        selected_from_top_k: selection.selected_from_top_k,
        callable_coverage_score: Some(selection.callable_coverage_score),
        modality_fit_score: Some(selection.modality_fit_score),
        profile_prior_score: Some(selection.profile_prior_score),
    };
    let packet_receipt = Some(DelegatedExecutionPacketReceipt {
        packet_hash: task_packet.packet_hash.clone(),
        task_kind: task_packet.task_kind.clone(),
        deliverable_kind: task_packet.deliverable_kind.clone(),
        selected_profile_id: selection.profile.id.clone(),
    });
    let mut base_children = vec![
        DelegatedExecutionChildRecord {
            id: format!("{}:selection", execution_id),
            phase_id: Some("selection".to_string()),
            step_type: Some("agent_selection".to_string()),
            title: "Select delegated agent".to_string(),
            status: "succeeded".to_string(),
            worker_ref: None,
            summary: Some(format!(
                "Selected '{}' with reason {}.",
                selection.profile.name, selection.reason
            )),
            error: None,
            available_actions: Vec::new(),
        },
        DelegatedExecutionChildRecord {
            id: format!("{}:packet", execution_id),
            phase_id: Some("packet".to_string()),
            step_type: Some("task_packet".to_string()),
            title: "Build delegated task packet".to_string(),
            status: "succeeded".to_string(),
            worker_ref: None,
            summary: Some(format!(
                "Task kind '{}', deliverable '{}', {} context refs, {} constraints.",
                task_packet.task_kind,
                task_packet.deliverable_kind,
                context_refs.len(),
                constraints.len()
            )),
            error: None,
            available_actions: Vec::new(),
        },
    ];
    let record = match response_result {
        Ok(response) => {
            let summary = response
                .content
                .trim()
                .lines()
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("Delegated task completed")
                .to_string();
            base_children.push(DelegatedExecutionChildRecord {
                id: format!("{}:execution", execution_id),
                phase_id: Some("execution".to_string()),
                step_type: Some("custom_task_agent".to_string()),
                title: "Run delegated custom task agent".to_string(),
                status: response.status.clone(),
                worker_ref: Some(format!("custom_task_agent:{}", selection.profile.id)),
                summary: Some(summary.clone()),
                error: None,
                available_actions: Vec::new(),
            });
            DelegatedExecutionRecord {
                execution_id: execution_id.clone(),
                kind: DelegatedExecutionKind::CustomTaskAgent,
                status: DelegatedExecutionStatus::Succeeded,
                target: DelegatedExecutionTarget {
                    id: selection.profile.id.clone(),
                    name: selection.profile.name.clone(),
                    invocation_kind: Some(response.invocation_kind.as_str().to_string()),
                    worker_ref: None,
                    workflow_run_id: None,
                },
                selection: selection_payload,
                packet_receipt,
                available_actions: Vec::new(),
                children: base_children,
                summary: Some(summary),
                primary_output: Some(serde_json::json!({
                    "status": response.status,
                    "agent_id": selection.profile.id,
                    "agent_name": selection.profile.name,
                    "invocation_kind": response.invocation_kind.as_str(),
                    "content": response.content,
                    "reasoning_content": response.reasoning_content,
                    "images": response.images,
                    "audios": response.audios,
                    "tool_trace": response.tool_trace,
                    "callable_mcp_tool_ids": response.callable_mcp_tool_ids,
                    "guidance_skill_ids": response.guidance_skill_ids,
                    "callable_skill_action_refs": response.callable_skill_action_refs,
                    "model_id": response.model_id,
                    "provider_model_id": response.provider_model_id,
                    "delegated_model_policy": "inherit_parent_unless_profile_overrides",
                    "context_refs": context_refs,
                    "constraints": constraints,
                    "expected_output": arguments.get("expected_output").cloned(),
                    "session_id": session_id,
                    "tool_call_id": call_id,
                })),
                error: None,
                started_at_ms,
                completed_at_ms: Some(now_unix_ms_i64()),
            }
        }
        Err(err) => {
            let error_text = err.to_string();
            base_children.push(DelegatedExecutionChildRecord {
                id: format!("{}:execution", execution_id),
                phase_id: Some("execution".to_string()),
                step_type: Some("custom_task_agent".to_string()),
                title: "Run delegated custom task agent".to_string(),
                status: "failed".to_string(),
                worker_ref: Some(format!("custom_task_agent:{}", selection.profile.id)),
                summary: None,
                error: Some(error_text.clone()),
                available_actions: vec![DelegatedExecutionAction {
                    kind: "retry".to_string(),
                }],
            });
            DelegatedExecutionRecord {
                execution_id: execution_id.clone(),
                kind: DelegatedExecutionKind::CustomTaskAgent,
                status: DelegatedExecutionStatus::Failed,
                target: DelegatedExecutionTarget {
                    id: selection.profile.id.clone(),
                    name: selection.profile.name.clone(),
                    invocation_kind: Some(selection.profile.invocation_kind.as_str().to_string()),
                    worker_ref: None,
                    workflow_run_id: None,
                },
                selection: selection_payload,
                packet_receipt,
                available_actions: vec![DelegatedExecutionAction {
                    kind: "retry".to_string(),
                }],
                children: base_children,
                summary: Some("Delegated task failed".to_string()),
                primary_output: Some(serde_json::json!({
                    "status": "failed",
                    "agent_id": selection.profile.id,
                    "agent_name": selection.profile.name,
                    "error": error_text,
                    "context_refs": context_refs,
                    "constraints": constraints,
                    "expected_output": arguments.get("expected_output").cloned(),
                    "session_id": session_id,
                    "tool_call_id": call_id,
                })),
                error: Some(error_text),
                started_at_ms,
                completed_at_ms: Some(now_unix_ms_i64()),
            }
        }
    };
    let delegated_execution_tree =
        record.status_meta_with_status(DelegatedExecutionStatus::Integrated);
    let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: session_id.to_string(),
        route: state.execution_policy.route.as_str().to_string(),
        plane: state.execution_policy.plane.as_str().to_string(),
        trace_id: Some(state.trace_id.clone()),
        request_id: state.request_id.clone(),
        root_execution_id: Some(execution_id.clone()),
        response_content: None,
        tool_trace_blocks: Vec::new(),
        delegated_execution_tree: Some(delegated_execution_tree),
    })
    .to_value();
    let _ = persist_execution_graph_snapshot(
        app_state.mcp.store.as_ref(),
        &execution_graph,
        session_id,
        "desktop_local_chat_delegate_task",
        state.request_id.as_deref(),
        Some("complete"),
    )
    .await;
    let _feedback = build_delegated_result_feedback_messages(&record);
    Ok(record.delegated_result())
}

async fn consult_task_policy_advisory(
    app_state: &AppState,
    task_query: Option<&str>,
    locus: DecisionLocus,
) -> Option<Advisory> {
    let query = task_query
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(Self_::consult(app_state.mcp.store.as_ref(), locus, query, 4).await)
}

async fn execute_code_mode_request(
    app_state: &AppState,
    request: ExecuteLocalCodemodeRequest,
    realtime_emitter: &LocalRealtimeToolTraceEmitter,
) -> Result<crate::modules::code_mode::types::ExecuteLocalCodemodeResponse, String> {
    Box::pin(
        crate::modules::code_mode::commands::execute_local_code_mode_inner(
            app_state,
            request,
            build_runtime_bridge_stream_target(realtime_emitter),
        ),
    )
    .await
    .map_err(|err| err.to_string())
}

/*
        .get(code)
        .and_then(|v| v.as_str())
        .unwrap_or(");
    let language = arguments
        .get(language)
        .and_then(|v| v.as_str())
        .unwrap_or(python);
    let execution_timeout = arguments
        .get(execution_timeout)
        .and_then(|v| v.as_u64())
        .map(|v| v.max(1));
    let dry_run = arguments
        .get(dry_run)
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
}

*/

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
            skill_context_update: None,
        };
    }
    let mut tool_call_meta = Vec::new();
    let mut results = Vec::new();
    let mut synthesized = false;
    let mut capability_update = None;
    let mut skill_context_update = None;
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

        if tool_name == DITING_THINK_TOOL_NAME {
            let reasoning = format_diting_think_reasoning(&call.arguments);
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            synthesized = true;
            let meta = serde_json::json!({
                "id": call_id.as_str(),
                "name": DITING_THINK_TOOL_NAME,
                "status": "success",
                "result": "Deep reasoning complete. Proceed with execution based on your plan.",
                "reasoning": reasoning,
            });
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push(
                "Deep reasoning acknowledged. Continue with your planned execution.".to_string(),
            );
            // Slice 2: emit deeting_think preflight signal. classification is
            // Unknown because deeting_think is a pre-flight hypothesis; it
            // becomes accepted/rejected only after comparison against the
            // observed execution outcome in a later slice.
            {
                use crate::modules::desktop_runtime::runtime::evolution::{
                    submit_evolution_signal, EvolutionSignalClassification, EvolutionSignalDraft,
                    EvolutionSignalSource,
                };
                let payload = serde_json::json!({
                    "intent": call.arguments.get("intent").cloned().unwrap_or(serde_json::Value::Null),
                    "context_assessment": call.arguments.get("context_assessment").cloned().unwrap_or(serde_json::Value::Null),
                    "tool_plan": call.arguments.get("tool_plan").cloned().unwrap_or(serde_json::Value::Null),
                    "constraints": call.arguments.get("constraints").cloned().unwrap_or(serde_json::Value::Null),
                    "task_query": state.task_query.clone(),
                    "trace_id": state.trace_id.clone(),
                    "session_id": state.session_id.clone(),
                    "request_id": state.request_id.clone(),
                });
                let draft = EvolutionSignalDraft {
                    source: EvolutionSignalSource::DeetingThink,
                    classification: EvolutionSignalClassification::Unknown,
                    session_id: Some(state.session_id.clone()),
                    trace_id: Some(state.trace_id.clone()),
                    run_id: None,
                    monitor_task_id: None,
                    monitor_log_id: None,
                    fingerprint_key: None,
                    confidence: 0.0,
                    payload_json: payload,
                    note: None,
                };
                if let Err(err) = submit_evolution_signal(app_state.mcp.store.as_ref(), draft).await
                {
                    log::warn!(
                        "deeting_think evolution signal submission failed trace_id={} err={}",
                        state.trace_id,
                        err
                    );
                }
            }
            continue;
        }

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
                diting_think_consumed: state.diting_think_consumed,
                captured_reasoning: state.captured_reasoning.clone(),
                selected_knowledge_file_ids: state.selected_knowledge_file_ids.clone(),
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

        if is_terminal_context_tool(&tool_name) {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            match execute_terminal_context_tool(
                app,
                state.terminal_context.as_ref(),
                &tool_name,
                &call.arguments,
            ) {
                Ok(result) => {
                    synthesized = true;
                    let meta = serde_json::json!({
                        "id": call_id.as_str(),
                        "name": tool_name,
                        "status": "success",
                        "result": result,
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Terminal context result:\n{}",
                        serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
                    ));
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "TERMINAL_CONTEXT_FAILED",
                        err,
                    );
                }
            }
        } else if is_workflow_plan_tool(&tool_name) {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            match execute_workflow_plan_tool(
                app,
                app_state,
                state.workflow_context.as_ref(),
                &tool_name,
                &call.arguments,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    let meta = serde_json::json!({
                        "id": call_id.as_str(),
                        "name": tool_name,
                        "status": "success",
                        "result": result,
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Workflow plan result:\n{}",
                        serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
                    ));
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "WORKFLOW_PLAN_FAILED",
                        err,
                    );
                }
            }
        } else if is_context_tool(&tool_name) {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            match execute_context_tool(
                app_state,
                &tool_name,
                &call.arguments,
                &state.selected_knowledge_file_ids,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    let meta = serde_json::json!({
                        "id": call_id.as_str(),
                        "name": tool_name,
                        "status": "success",
                        "result": result,
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Context tool result:\n{}",
                        serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
                    ));
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "CONTEXT_TOOL_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "execute_code_plan" {
            realtime_emitter.emit_execution_section_once("Code Execution");
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            let execution_gate_advisory = Box::pin(consult_task_policy_advisory(
                app_state,
                state.task_query.as_deref(),
                DecisionLocus::Execution,
            ))
            .await;
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
                        "task_policy_gate": execution_gate_advisory
                            .as_ref()
                            .map(|advisory| advisory.gate_meta("execute_code_plan")),
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

            let execution_request = ExecuteLocalCodemodeRequest {
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
            };
            let execution_res = Box::pin(execute_code_mode_request(
                app_state,
                execution_request,
                realtime_emitter,
            ))
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
                        "result":res,
                        "task_policy_gate": execution_gate_advisory
                            .as_ref()
                            .map(|advisory| advisory.gate_meta("execute_code_plan")),
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
                    let meta = serde_json::json!({
                        "id":call_id.as_str(),
                        "name":tool_name,
                        "status":"error",
                        "error":err.to_string(),
                        "task_policy_gate": execution_gate_advisory
                            .as_ref()
                            .map(|advisory| advisory.gate_meta("execute_code_plan")),
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!("Codemode Tool Failed: {}", err));
                }
            }
        } else if tool_name == "run_local_code_snippet" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            let code = call
                .arguments
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if code.trim().is_empty() {
                synthesized = true;
                push_local_tool_call_error_meta(
                    &mut tool_call_meta,
                    &mut results,
                    realtime_emitter,
                    Some(call_id.as_str()),
                    &tool_name,
                    "LOCAL_CODE_SNIPPET_EMPTY_CODE",
                    "run_local_code_snippet requires a non-empty 'code' argument",
                );
                continue;
            }

            let language = call
                .arguments
                .get("language")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let snippet_language = match language.trim().to_ascii_lowercase().as_str() {
                "python" => crate::modules::sandbox::types::SandboxSnippetLanguage::Python,
                "go" => crate::modules::sandbox::types::SandboxSnippetLanguage::Go,
                "rust" => crate::modules::sandbox::types::SandboxSnippetLanguage::Rust,
                "java" => crate::modules::sandbox::types::SandboxSnippetLanguage::Java,
                _ => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "LOCAL_CODE_SNIPPET_UNSUPPORTED_LANGUAGE",
                        format!(
                            "run_local_code_snippet only supports python, go, rust, and java; received '{}'",
                            language
                        ),
                    );
                    continue;
                }
            };

            let prepare_config = match resolve_sandbox_prepare_config(app_state).await {
                Ok(config) => config,
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "LOCAL_CODE_SNIPPET_PREPARE_CONFIG_ERROR",
                        err,
                    );
                    continue;
                }
            };

            let snippet_result = app_state
                .sandbox
                .manager
                .run_local_code_snippet_with_prepare_config(
                    session_id,
                    snippet_language,
                    code,
                    call.arguments
                        .get("execution_timeout")
                        .and_then(|v| v.as_u64()),
                    Some(&prepare_config),
                )
                .await;
            synthesized = true;
            let meta_status = if snippet_result.success {
                "success"
            } else {
                "error"
            };
            let meta = serde_json::json!({
                "id":call_id.as_str(),
                "name":tool_name,
                "status":meta_status,
                "error_code":snippet_result.error_code,
                "error":snippet_result.error,
                "result":snippet_result,
            });
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            if tool_call_meta
                .last()
                .and_then(|item| item.get("status"))
                .and_then(serde_json::Value::as_str)
                == Some("success")
            {
                results.push("Local code snippet executed successfully.".to_string());
            } else {
                results.push("Local code snippet execution failed.".to_string());
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
        } else if tool_name == "activate_skill" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            match activate_skill_from_args(app_state, &call.arguments).await {
                Ok((active_skill, result)) => {
                    synthesized = true;
                    skill_context_update = Some(active_skill.clone());
                    let meta = serde_json::json!({
                        "id": call_id.as_str(),
                        "name": tool_name,
                        "status": "success",
                        "result": result
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Skill '{}' activated for this request. Use its SKILL.md instructions and read package resources only when needed.",
                        active_skill.skill_id
                    ));
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "SKILL_ACTIVATION_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "read_skill_resource" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            match read_skill_resource_from_args(
                app_state,
                &call.arguments,
                state.active_skill_context.as_ref(),
            )
            .await
            {
                Ok((active_skill, result)) => {
                    synthesized = true;
                    skill_context_update = Some(active_skill);
                    let path = result
                        .get("path")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("<unknown>")
                        .to_string();
                    let meta = serde_json::json!({
                        "id": call_id.as_str(),
                        "name": tool_name,
                        "status": "success",
                        "result": result
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Skill resource '{}' loaded as private context.",
                        path
                    ));
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "SKILL_RESOURCE_READ_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "delegate_task" {
            realtime_emitter.emit_execution_section_once("Delegate Task");
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            match execute_delegate_task_tool(
                app,
                app_state,
                state,
                session_id,
                call_id.as_str(),
                &call.arguments,
                effective_allowed_tool_names,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    let meta = serde_json::json!({
                        "id": call_id.as_str(),
                        "name": tool_name,
                        "status": "success",
                        "result": result,
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Delegated task result:\n{}",
                        serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
                    ));
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "DELEGATE_TASK_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "query_task_policy" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            let query = call
                .arguments
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let decision_point = call
                .arguments
                .get("decision_point")
                .and_then(|v| v.as_str())
                .unwrap_or("route");
            let limit = call
                .arguments
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
                .unwrap_or(4);
            let policy_hint =
                Self_::consult_named(app_state.mcp.store.as_ref(), decision_point, query, limit)
                    .await
                    .as_raw()
                    .clone();
            let policy_hint_value =
                serde_json::to_value(&policy_hint).unwrap_or_else(|_| serde_json::json!({}));
            synthesized = true;
            let meta = serde_json::json!({
                "id":call_id.as_str(),
                "name":tool_name,
                "status":"success",
                "result":policy_hint_value
            });
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push(format!(
                "Task policy hint for '{}' at '{}':\n{}",
                query,
                decision_point,
                serde_json::to_string_pretty(&policy_hint).unwrap_or_else(|_| "{}".to_string())
            ));
        } else if tool_name == "attach_capability" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call_id.as_str(),"toolName":tool_name,"status":"running"})]);
            let attach_gate_advisory = match state.task_query.as_deref() {
                Some(query) => Some(
                    Self_::consult(
                        app_state.mcp.store.as_ref(),
                        DecisionLocus::CapabilityAttach,
                        query,
                        4,
                    )
                    .await,
                ),
                None => None,
            };
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
                        "capability_transition":{"action":"activated","capability_id":capability_id,"capability_name":state.capability_name.clone(),"reason":reason},
                        "task_policy_gate": attach_gate_advisory
                            .as_ref()
                            .map(|advisory| advisory.gate_meta("attach_capability"))
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
                }
                Err(err) => {
                    let meta = serde_json::json!({
                        "id":call_id.as_str(),
                        "name":tool_name,
                        "status":"error",
                        "error_code":"CAPABILITY_ATTACH_FAILED",
                        "error":err,
                        "task_policy_gate": attach_gate_advisory
                            .as_ref()
                            .map(|advisory| advisory.gate_meta("attach_capability")),
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!("Expert capability attach failed: {}", err));
                    synthesized = true;
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
                            format!(
                                "custom task agent onboarding payload could not be parsed: {}",
                                err
                            ),
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
            match Box::pin(execute_or_queue_mcp_tool_call_with_tool_ref(
                &approval_context,
                Some(&app_state.mcp),
                app_state.mcp.store.as_ref(),
                app_state.mcp.approvals.pending_tool_calls.as_ref(),
                None,
                Some(tool_name.clone()),
                call.arguments.clone(),
            ))
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
                        classify_local_tool_execution_error_code(&error),
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
            skill_context_update,
        }
    } else {
        LocalToolCallProcessingOutcome::Interrupted {
            approval_tokens,
            tool_call_meta,
            results,
            capability_update,
            skill_context_update,
        }
    }
}
