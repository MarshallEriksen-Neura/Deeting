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
    apply_world_model_update_to_frame, extract_world_model_update_from_response,
    ProposedPhase, WorldModelUpdate, WORLD_MODEL_UPDATE_END_TAG, WORLD_MODEL_UPDATE_START_TAG,
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
    build_max_rounds_exceeded_response, clone_runtime_state_for_tool_execution, extract_initial_task_query,
    resolve_child_agent_max_rounds, rewind_round_for_post_approval_continuation,
    LocalChatCompleteWithToolsOutput, LocalChatToolRuntimeOutput, LocalChatToolRuntimeState,
    LocalToolCallProcessingOutcome,
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

fn append_world_observations_from_tool_meta(
    frame: Option<&mut desktop_runtime_core::WorldModelFrame>,
    tool_call_meta: &[serde_json::Value],
) {
    let Some(frame) = frame else {
        return;
    };
    for item in tool_call_meta {
        if item
            .get("status")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|status| !status.eq_ignore_ascii_case("success"))
        {
            continue;
        }
        let tool_call_id = item
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("unknown-call")
            .to_string();
        let tool_name = item
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("unknown_tool")
            .to_string();
        let Some(entries) = item
            .get("observation_patch")
            .and_then(serde_json::Value::as_array)
        else {
            continue;
        };
        for entry in entries {
            let Some(text) = entry
                .get("text")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            let structured = entry
                .get("structured")
                .cloned()
                .filter(|value| !value.is_null());
            let supersedes = entry
                .get("supersedes")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if let Err(err) = frame.append_observation(
                text.to_string(),
                structured,
                desktop_runtime_core::ObservationSource {
                    tool_call_id: tool_call_id.clone(),
                    tool_name: tool_name.clone(),
                },
                supersedes,
            ) {
                log::warn!(
                    "failed to append world observation from tool patch: tool_name={} call_id={} error={}",
                    tool_name,
                    tool_call_id,
                    err
                );
            }
        }
    }
}

fn append_committed_actions_from_tool_meta(
    frame: Option<&mut desktop_runtime_core::WorldModelFrame>,
    tool_call_meta: &[serde_json::Value],
) {
    let Some(frame) = frame else {
        return;
    };
    for item in tool_call_meta {
        if !tool_meta_succeeded(item) {
            continue;
        }
        let tool_name = tool_meta_name(item);
        if !resolve_is_irreversible(item, &tool_name) {
            continue;
        }
        let tool_call_id = tool_meta_call_id(item);
        frame.append_committed_action(
            build_committed_action_text(item, &tool_name),
            tool_call_id,
            tool_name,
        );
    }
}

fn tool_meta_succeeded(item: &serde_json::Value) -> bool {
    item.get("status")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|status| status.eq_ignore_ascii_case("success"))
}

fn tool_meta_call_id(item: &serde_json::Value) -> String {
    item.get("id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown-call")
        .to_string()
}

fn tool_meta_name(item: &serde_json::Value) -> String {
    item.get("name")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown_tool")
        .to_string()
}

fn resolve_is_irreversible(item: &serde_json::Value, tool_name: &str) -> bool {
    item.get("is_irreversible")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or_else(|| irreversible_tool_name_default(tool_name))
}

fn irreversible_tool_name_default(tool_name: &str) -> bool {
    const IRREVERSIBLE_PATTERNS: &[&str] = &[
        "write_",
        "create_",
        "update_",
        "delete_",
        "remove_",
        "send_",
        "exec_",
        "run_",
        "commit_",
        "push_",
        "publish_",
        "shell.",
        "fs.write",
        "fs.create",
        "fs.delete",
    ];
    let lower = tool_name.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }
    IRREVERSIBLE_PATTERNS
        .iter()
        .any(|pattern| lower.starts_with(pattern) || lower.contains(pattern))
}

fn build_committed_action_text(item: &serde_json::Value, tool_name: &str) -> String {
    let summary = item
        .get("result")
        .and_then(short_result_summary)
        .unwrap_or_else(|| "success".to_string());
    format!("{tool_name} -> {summary}")
}

fn short_result_summary(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(truncate_action_summary(text.trim())),
        serde_json::Value::Object(object) => {
            for key in ["message", "summary", "status", "id", "path"] {
                if let Some(text) = object
                    .get(key)
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Some(truncate_action_summary(text));
                }
            }
            Some("success".to_string())
        }
        _ => None,
    }
}

fn truncate_action_summary(value: &str) -> String {
    const MAX_LEN: usize = 160;
    let mut output = String::new();
    for ch in value.chars() {
        if output.len() + ch.len_utf8() > MAX_LEN {
            output.push_str("...");
            return output;
        }
        output.push(ch);
    }
    if output.is_empty() {
        "success".to_string()
    } else {
        output
    }
}

fn attach_runtime_transition_events(
    response: serde_json::Value,
    runtime_transition_blocks: &[serde_json::Value],
) -> serde_json::Value {
    attach_runtime_transition_blocks_to_response(response, runtime_transition_blocks)
}

fn messages_with_world_model_snapshot(
    messages: &[LocalChatInputMessage],
    frame: Option<&desktop_runtime_core::WorldModelFrame>,
    execution_policy: &LocalExecutionPolicy,
) -> Vec<LocalChatInputMessage> {
    let Some(frame) = frame else {
        return messages.to_vec();
    };
    let config = desktop_runtime_core::frame::snapshot_render::SnapshotRenderConfig::default();
    let snapshot =
        desktop_runtime_core::frame::snapshot_render::render_world_model_snapshot(frame, &config);
    let runtime_context = render_world_model_runtime_context(frame, execution_policy);
    let prefix = format!("{snapshot}\n\n{runtime_context}");
    let mut output = messages.to_vec();
    if let Some(message) = output
        .iter_mut()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
    {
        message.content = format!("{prefix}\n\n{}", message.content);
    } else {
        output.insert(
            0,
            LocalChatInputMessage {
                role: "user".to_string(),
                content: prefix,
                reasoning_content: None,
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            },
        );
    }
    output
}

fn render_world_model_runtime_context(
    frame: &desktop_runtime_core::WorldModelFrame,
    execution_policy: &LocalExecutionPolicy,
) -> String {
    let mut obligations = vec![
        "runtime_owner: world_model_runtime_owner".to_string(),
        "historical_runtime_evidence: observation_only".to_string(),
        "phase_dispatch_owner: committed_or_proposed_phase_step".to_string(),
    ];
    let mode_hint = if execution_policy.require_world_model_update {
        "full"
    } else if frame.max_sequence() > frame.last_seen_by_model {
        "delta"
    } else {
        "delta"
    };
    obligations.push(format!(
        "world_model_update: every assistant response must end with {start} JSON {end}; mode={mode_hint}; include facts, assumptions, resolved_unknowns, new_unknowns, verification_targets, rules, execution_strategy only when revised, and proposed_next_phase only when ready.",
        start = WORLD_MODEL_UPDATE_START_TAG,
        end = WORLD_MODEL_UPDATE_END_TAG,
    ));

    format!("[RUNTIME CONTEXT]\n{}", obligations.join("\n"))
}

pub(crate) async fn run_local_chat_complete_with_tools(
    app: &AppHandle,
    app_state: &AppState,
    model_connection: &LocalModelConnection,
    messages: Vec<LocalChatInputMessage>,
    world_model_frame: Option<desktop_runtime_core::WorldModelFrame>,
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
) -> Result<LocalChatCompleteWithToolsOutput, String> {
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
        world_model_frame,
        task_query,
        session_id: chat_ctx.session_id.clone(),
        temperature,
        max_tokens,
        reasoning_enabled,
        reasoning_effort,
        active_capability: None,
        active_skill_context: None,
        captured_world_model_update: None,
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
        .map(|output| LocalChatCompleteWithToolsOutput {
            response_json: output.response,
            world_model_frame: output.world_model_frame,
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
                captured_world_model_update: state.captured_world_model_update.clone(),
                world_model_frame: state.world_model_frame.clone(),
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
            messages_with_world_model_snapshot(
                &state.orchestrated_messages,
                state.world_model_frame.as_ref(),
                &state.execution_policy,
            ),
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
        let (response, world_model_update) = extract_world_model_update_from_response(response);
        let world_model_update_applied = world_model_update.is_some();
        if let Some(update) = world_model_update {
            if let Some(frame) = state.world_model_frame.take() {
                state.world_model_frame =
                    Some(apply_world_model_update_to_frame(frame, Some(&update)));
            }
            state.runtime_transition_blocks.push(
                project_world_model_frame_decision_block(WorldModelFrameProjectionInput {
                    trace_id: state.trace_id.as_str(),
                    request_id: state.request_id.as_deref(),
                    session_id: state.session_id.as_str(),
                    frame_kind: WorldModelFrameKind::Refresh,
                    intent: update.intent.as_deref(),
                    fact_count: update.facts.len(),
                    assumption_count: update.assumptions.len(),
                    verification_target_count: update.verification_targets.len(),
                    rule_count: update.rules.len(),
                }),
            );
            state.captured_world_model_update = Some(update);
        }
        if let Some(frame) = state.world_model_frame.as_mut() {
            frame.mark_seen();
            if world_model_update_applied {
                frame.mark_world_model_update_seen();
            }
        }
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
                captured_world_model_update: state.captured_world_model_update.clone(),
                world_model_frame: state.world_model_frame.clone(),
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
                captured_world_model_update,
            } => {
                state
                    .runtime_transition_blocks
                    .extend(runtime_transition_blocks);
                if captured_world_model_update.is_some() {
                    state.captured_world_model_update = captured_world_model_update;
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
                append_world_observations_from_tool_meta(
                    state.world_model_frame.as_mut(),
                    &canonical_tool_call_meta,
                );
                append_committed_actions_from_tool_meta(
                    state.world_model_frame.as_mut(),
                    &canonical_tool_call_meta,
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
                        captured_world_model_update: state.captured_world_model_update.clone(),
                        world_model_frame: state.world_model_frame.clone(),
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
                captured_world_model_update,
            } => {
                state
                    .runtime_transition_blocks
                    .extend(runtime_transition_blocks);
                if captured_world_model_update.is_some() {
                    state.captured_world_model_update = captured_world_model_update;
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
                append_world_observations_from_tool_meta(
                    state.world_model_frame.as_mut(),
                    &canonical_tool_call_meta,
                );
                append_committed_actions_from_tool_meta(
                    state.world_model_frame.as_mut(),
                    &canonical_tool_call_meta,
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
                    captured_world_model_update: state.captured_world_model_update.clone(),
                    world_model_frame: state.world_model_frame.clone(),
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
