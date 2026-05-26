use super::{
    build_local_runtime_tools_with_allowlist, extract_chat_tool_calls,
    request_provider_chat_completion, LocalExecutionPolicy,
};
use crate::modules::ai_upstream::ReasoningRequestConfig;
use crate::modules::desktop_config::{parse_max_agentic_rounds, MAX_AGENTIC_ROUNDS_CONFIG_KEY};
use crate::modules::desktop_runtime::runtime::runtime_event_projection::projection::{
    attach_runtime_transition_blocks_to_response, project_execution_observation_decision_blocks,
    project_final_answer_decision_blocks, project_tool_call_proposal_decision_blocks,
    project_tool_execution_correlation_blocks, project_world_model_frame_decision_block,
    ExecutionObservationProjectionInput, FinalAnswerProjectionInput,
    ToolCallProposalProjectionInput, WorldModelFrameKind, WorldModelFrameProjectionInput,
};
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::mcp::commands::common_impl::LocalModelConnection;
use crate::modules::mcp::commands::support::*;

mod approval_commands;
mod audit;
mod context_tools;
mod frame_tools;
mod lifecycle;
mod runtime_metrics;
mod runtime_state;
mod streaming;
#[cfg(test)]
mod tests;
mod tool_execution;
mod tool_meta;

pub(crate) use approval_commands::{
    dispatch_local_chat_execution_run_command, ExecutionRunCommand,
};
pub(crate) use frame_tools::{
    inject_diting_think_tool, parse_diting_think_arguments, DitingThinkExtract,
    DITING_THINK_TOOL_NAME,
};
use lifecycle::finalize_tool_round;
#[cfg(test)]
use lifecycle::mark_delegated_wait_event_consumed;
use lifecycle::runtime_state_from_persisted_context;
#[cfg(test)]
use lifecycle::PersistedPendingApproval;
pub(crate) use lifecycle::SuspendedChatToolExecution;
#[cfg(test)]
use lifecycle::{
    attach_execution_graph_to_response, build_local_chat_resume_continuation_blocks,
    build_persisted_resume_assistant_blocks, build_persisted_resume_assistant_meta,
};
pub(crate) use lifecycle::{
    build_persisted_chat_runtime_context_from_execution_request,
    collect_waiting_approval_tokens_from_graph, derive_pending_approvals_from_graph,
    list_canonical_pending_local_approval_snapshots, load_suspended_chat_tool_execution_for_resume,
    materialize_pending_local_approval_from_runtime_context,
    persist_suspended_execution_graph_runtime, serialize_delegated_runtime_context,
    serialize_delegated_runtime_context_with_task_input_source,
    serialize_delegated_workflow_runtime_context,
    serialize_delegated_workflow_runtime_context_with_task_input_source,
};
#[cfg(test)]
use lifecycle::{build_structured_tool_replay_messages, serialize_tool_replay_content};
pub(crate) use lifecycle::{
    project_local_chat_approval_state_payload, recover_inflight_local_execution_state,
    recover_local_chat_execution_from_action, resume_delegated_runtime_after_custom_task_agent_run,
    resume_suspended_chat_tool_execution_after_approval, wake_delegated_runtime_for_workflow_run,
};
pub(crate) use lifecycle::{serialize_inflight_runtime_context, InFlightExecutionStage};
use runtime_metrics::RuntimeMetricsAccumulator;
#[cfg(test)]
use runtime_state::classify_local_tool_execution_error_code;
use runtime_state::{
    backfill_captured_reasoning, build_max_rounds_exceeded_response,
    clone_runtime_state_for_tool_execution, extract_initial_task_query,
    resolve_child_agent_max_rounds, rewind_round_for_post_approval_continuation,
    LocalChatToolRuntimeOutput, LocalChatToolRuntimeState, LocalToolCallProcessingOutcome,
};
use streaming::LocalRealtimeToolTraceEmitter;
use tool_execution::process_chat_tool_calls;
#[cfg(test)]
use tool_meta::{
    apply_approved_tool_result_to_execution_graph, canonicalize_tool_name_for_allowed_list,
    resolve_local_tool_call_id, strip_stale_resume_response_metadata,
};
pub(crate) use tool_meta::{
    apply_rejected_tool_result_to_execution_graph_value, mark_approval_gate_approving,
};
use tool_meta::{
    build_state_effective_tool_call_meta, canonicalize_tool_call_meta_via_graph,
    derive_pending_call_id_from_tool_call_meta, enrich_response_with_tool_trace,
    last_response_content_or_empty, record_query_affinity_from_tool_meta,
    tool_call_meta_with_resolved_ids,
};

fn attach_runtime_transition_events(
    response: serde_json::Value,
    runtime_transition_blocks: &[serde_json::Value],
) -> serde_json::Value {
    attach_runtime_transition_blocks_to_response(response, runtime_transition_blocks)
}

fn attach_diting_think_frame_extract(
    mut response: serde_json::Value,
    extract: Option<&DitingThinkExtract>,
) -> serde_json::Value {
    let Some(extract) = extract else {
        return response;
    };
    if let Some(object) = response.as_object_mut() {
        object.insert(
            "diting_think_frame_extract".to_string(),
            serde_json::to_value(extract).unwrap_or(serde_json::Value::Null),
        );
    }
    response
}

fn should_inject_diting_think_tool(
    round: usize,
    diting_think_consumed: bool,
    execution_policy: &LocalExecutionPolicy,
) -> bool {
    round == 1 && !diting_think_consumed && execution_policy.require_diting_think_preflight
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
        captured_frame_extract: None,
        runtime_metrics: RuntimeMetricsAccumulator::default(),
        last_capability_snapshot: execution_policy.capability_snapshot.clone(),
        terminal_context,
        workflow_context,
        last_response: None,
        runtime_transition_blocks: Vec::new(),
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
            attach_diting_think_frame_extract(
                output.response,
                output.captured_frame_extract.as_ref(),
            )
        })
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
                captured_frame_extract: state.captured_frame_extract.clone(),
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
        let tools = if should_inject_diting_think_tool(
            state.round,
            state.diting_think_consumed,
            &state.execution_policy,
        ) {
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

        let tool_calls = extract_chat_tool_calls(&response);
        if tool_calls.is_empty() {
            let effective_tool_call_meta = build_state_effective_tool_call_meta(&state);
            state
                .runtime_transition_blocks
                .extend(project_final_answer_decision_blocks(
                    FinalAnswerProjectionInput {
                        trace_id: state.trace_id.as_str(),
                        request_id: state.request_id.as_deref(),
                        session_id: state.session_id.as_str(),
                        response_has_verification_evidence: !effective_tool_call_meta.is_empty(),
                    },
                ));
            let response = enrich_response_with_tool_trace(
                response,
                &effective_tool_call_meta,
                state.realtime_emitter.emitted_any,
                &state.runtime_metrics,
            );
            return Ok(LocalChatToolRuntimeOutput {
                captured_reasoning: state.captured_reasoning.clone(),
                captured_frame_extract: state.captured_frame_extract.clone(),
                response: attach_runtime_transition_events(
                    response,
                    &state.runtime_transition_blocks,
                ),
            });
        }

        state
            .runtime_transition_blocks
            .extend(project_tool_call_proposal_decision_blocks(
                ToolCallProposalProjectionInput {
                    trace_id: state.trace_id.as_str(),
                    request_id: state.request_id.as_deref(),
                    session_id: state.session_id.as_str(),
                    round: state.round,
                    tool_calls: &tool_calls,
                },
            ));
        let prior_tool_call_meta = build_state_effective_tool_call_meta(&state);
        state.last_response = Some(response.clone());
        let state_snapshot = clone_runtime_state_for_tool_execution(&state, None);
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
                runtime_transition_blocks,
                captured_frame_extract,
            } => {
                state
                    .runtime_transition_blocks
                    .extend(runtime_transition_blocks);
                if captured_frame_extract.is_some() {
                    state.captured_frame_extract = captured_frame_extract;
                }
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
                    if let Some(extract) = state.captured_frame_extract.as_ref() {
                        state.runtime_transition_blocks.push(
                            project_world_model_frame_decision_block(
                                WorldModelFrameProjectionInput {
                                    trace_id: state.trace_id.as_str(),
                                    request_id: state.request_id.as_deref(),
                                    session_id: state.session_id.as_str(),
                                    frame_kind: WorldModelFrameKind::Refresh,
                                    intent: extract.intent.as_deref(),
                                    fact_count: extract.facts.len(),
                                    assumption_count: extract.assumptions.len(),
                                    verification_target_count: extract.verification_targets.len(),
                                    rule_count: extract.rules.len(),
                                },
                            ),
                        );
                    }
                }
                let canonical_tool_call_meta = canonicalize_tool_call_meta_via_graph(
                    &session_id,
                    &state.execution_policy,
                    &response,
                    &tool_call_meta,
                );
                state
                    .runtime_transition_blocks
                    .extend(project_tool_execution_correlation_blocks(
                        &state.runtime_transition_blocks,
                        &canonical_tool_call_meta,
                    ));
                state.runtime_transition_blocks.extend(
                    project_execution_observation_decision_blocks(
                        ExecutionObservationProjectionInput {
                            trace_id: state.trace_id.as_str(),
                            request_id: state.request_id.as_deref(),
                            session_id: state.session_id.as_str(),
                            tool_call_meta: &canonical_tool_call_meta,
                            result_count: results.len(),
                        },
                    ),
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
                        captured_frame_extract: state.captured_frame_extract.clone(),
                        response: attach_runtime_transition_events(
                            enrich_response_with_tool_trace(
                                response,
                                &current_tool_call_meta,
                                state.realtime_emitter.emitted_any,
                                &state.runtime_metrics,
                            ),
                            &state.runtime_transition_blocks,
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
                state.last_response = Some(attach_runtime_transition_events(
                    enrich_response_with_tool_trace(
                        response,
                        &canonical_tool_call_meta,
                        state.realtime_emitter.emitted_any,
                        &state.runtime_metrics,
                    ),
                    &state.runtime_transition_blocks,
                ));
            }
            LocalToolCallProcessingOutcome::Interrupted {
                approval_tokens: _approval_tokens,
                mut tool_call_meta,
                results,
                capability_update,
                skill_context_update,
                runtime_transition_blocks,
                captured_frame_extract,
            } => {
                state
                    .runtime_transition_blocks
                    .extend(runtime_transition_blocks);
                if captured_frame_extract.is_some() {
                    state.captured_frame_extract = captured_frame_extract;
                }
                if let Some(update) = skill_context_update {
                    state.active_skill_context = Some(update);
                }
                let canonical_tool_call_meta = canonicalize_tool_call_meta_via_graph(
                    &session_id,
                    &state.execution_policy,
                    &response,
                    &tool_call_meta,
                );
                state
                    .runtime_transition_blocks
                    .extend(project_tool_execution_correlation_blocks(
                        &state.runtime_transition_blocks,
                        &canonical_tool_call_meta,
                    ));
                state.runtime_transition_blocks.extend(
                    project_execution_observation_decision_blocks(
                        ExecutionObservationProjectionInput {
                            trace_id: state.trace_id.as_str(),
                            request_id: state.request_id.as_deref(),
                            session_id: state.session_id.as_str(),
                            tool_call_meta: &canonical_tool_call_meta,
                            result_count: results.len(),
                        },
                    ),
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
                audit::persist_waiting_approval_execution_graph(
                    app_state.mcp.store.as_ref(),
                    &suspended,
                    &mut tool_call_meta,
                    state.session_id.as_str(),
                )
                .await;
                let mut current_tool_call_meta = build_state_effective_tool_call_meta(&state);
                // Use the graph-enriched pending meta we just prepared above so the
                // first approval card carries execution_graph identifiers.
                current_tool_call_meta.extend(tool_call_meta.clone());
                let interrupted = serde_json::json!({
                    "content": last_response_content_or_empty(state.last_response.as_ref()),
                });
                return Ok(LocalChatToolRuntimeOutput {
                    captured_reasoning: state.captured_reasoning.clone(),
                    captured_frame_extract: state.captured_frame_extract.clone(),
                    response: attach_runtime_transition_events(
                        enrich_response_with_tool_trace(
                            interrupted,
                            &current_tool_call_meta,
                            state.realtime_emitter.emitted_any,
                            &state.runtime_metrics,
                        ),
                        &state.runtime_transition_blocks,
                    ),
                });
            }
        }
    }
}
