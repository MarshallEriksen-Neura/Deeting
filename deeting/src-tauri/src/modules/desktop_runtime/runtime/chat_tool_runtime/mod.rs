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

mod inflight;
mod recovery;
mod replay;
mod suspended;
#[cfg(test)]
mod tests;
mod tool_meta;

#[cfg(test)]
use inflight::PersistedPendingApproval;
use inflight::{
    build_pending_approval_records, clear_execution_graph_runtime_context,
    load_suspended_chat_tool_execution_for_resume, now_unix_ms_i64,
    pending_tool_call_from_persisted_approval, persist_running_tool_execution_runtime,
    persist_suspended_execution_graph_runtime, persistable_inflight_context_from_value,
};
pub(crate) use inflight::{
    list_canonical_pending_local_approval_snapshots,
    materialize_pending_local_approval_from_runtime_context, serialize_inflight_runtime_context,
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
    recover_local_chat_execution_from_action, resume_suspended_chat_tool_execution_after_approval,
};
use replay::finalize_tool_round;
#[cfg(test)]
use replay::{build_structured_tool_replay_messages, serialize_tool_replay_content};
pub(crate) use suspended::SuspendedChatToolExecution;
pub(crate) use tool_meta::apply_rejected_tool_result_to_execution_graph_value;
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
