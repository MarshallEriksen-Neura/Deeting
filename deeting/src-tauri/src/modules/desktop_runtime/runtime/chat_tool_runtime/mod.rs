use super::{
    build_local_runtime_tools_with_allowlist, extract_chat_tool_calls, LocalExecutionPolicy,
};
use crate::modules::ai_upstream::{
    request_provider_chat_completion_streaming_with_pool_failover, ReasoningRequestConfig,
};
use crate::modules::desktop_config::{parse_max_agentic_rounds, MAX_AGENTIC_ROUNDS_CONFIG_KEY};
use crate::modules::desktop_runtime::runtime::prompt_definitions::{
    compact_replayed_system_prompt_content, render_desktop_execution_tools_injection_prompt,
    render_world_model_system_context, WorldModelUpdatePromptMode,
};
use crate::modules::desktop_runtime::runtime::runtime_event_projection::projection::{
    attach_runtime_transition_blocks_to_response, project_execution_observation_decision_blocks,
    project_final_answer_decision_blocks, project_tool_call_proposal_decision_blocks,
    project_tool_execution_correlation_blocks, project_world_model_frame_decision_block,
    ExecutionObservationProjectionInput, FinalAnswerProjectionInput,
    ToolCallProposalProjectionInput, WorldModelFrameKind, WorldModelFrameProjectionInput,
};
use crate::modules::desktop_runtime::runtime::tool_catalog::WORLD_MODEL_UPDATE_TOOL_NAME;
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
    apply_world_model_update_to_frame, build_world_model_snapshot_extract,
    extract_world_model_update_from_response, ProposedPhase, WorldModelUpdate,
};
use lifecycle::finalize_tool_round;
#[cfg(test)]
use lifecycle::mark_delegated_wait_event_consumed;
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
    list_canonical_pending_local_approval_snapshots,
    serialize_delegated_runtime_context_with_task_input_source,
    serialize_delegated_workflow_runtime_context_with_task_input_source,
};
#[cfg(test)]
use lifecycle::{build_structured_tool_replay_messages, serialize_tool_replay_content};
pub(crate) use lifecycle::{
    recover_inflight_local_execution_state, resume_delegated_runtime_after_custom_task_agent_run,
    wake_delegated_runtime_for_workflow_run,
};
#[cfg(test)]
pub(crate) use lifecycle::{
    serialize_delegated_runtime_context, serialize_delegated_workflow_runtime_context,
};
#[cfg(test)]
pub(crate) use lifecycle::{serialize_inflight_runtime_context, InFlightExecutionStage};
use runtime_metrics::RuntimeMetricsAccumulator;
#[cfg(test)]
use runtime_state::classify_local_tool_execution_error_code;
#[cfg(test)]
use runtime_state::resolve_child_agent_max_rounds;
#[cfg(test)]
use runtime_state::rewind_round_for_post_approval_continuation;
use runtime_state::{
    build_max_rounds_exceeded_response, extract_initial_task_query,
    LocalChatCompleteWithToolsOutput, LocalChatToolRuntimeOutput, LocalChatToolRuntimeState,
    LocalToolCallProcessingOutcome,
};
use streaming::LocalRealtimeToolTraceEmitter;
use tool_execution::process_chat_tool_calls;
#[cfg(test)]
use tool_meta::{
    apply_approved_tool_result_to_execution_graph,
    apply_rejected_tool_result_to_execution_graph_value, canonicalize_tool_name_for_allowed_list,
    mark_approval_gate_approving, resolve_local_tool_call_id, strip_stale_resume_response_metadata,
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

fn is_world_model_update_tool_name(name: &str) -> bool {
    name.trim()
        .eq_ignore_ascii_case(WORLD_MODEL_UPDATE_TOOL_NAME)
}

fn tool_calls_are_only_world_model_update(
    tool_calls: &[mcp_core::types::LocalChatToolCall],
) -> bool {
    !tool_calls.is_empty()
        && tool_calls
            .iter()
            .all(|call| is_world_model_update_tool_name(&call.name))
}

fn json_tool_call_name(tool_call: &Value) -> Option<&str> {
    tool_call.get("name").and_then(Value::as_str).or_else(|| {
        tool_call
            .get("function")
            .and_then(|function| function.get("name"))
            .and_then(Value::as_str)
    })
}

fn strip_world_model_update_tool_calls_from_object(object: &mut serde_json::Map<String, Value>) {
    let remove_tool_calls = object
        .get_mut("tool_calls")
        .and_then(Value::as_array_mut)
        .map(|tool_calls| {
            tool_calls.retain(|tool_call| {
                !json_tool_call_name(tool_call).is_some_and(is_world_model_update_tool_name)
            });
            tool_calls.is_empty()
        })
        .unwrap_or(false);
    if remove_tool_calls {
        object.remove("tool_calls");
    }
}

fn strip_world_model_update_tool_calls(mut response: Value) -> Value {
    if let Some(object) = response.as_object_mut() {
        strip_world_model_update_tool_calls_from_object(object);
    }

    if let Some(choices) = response.get_mut("choices").and_then(Value::as_array_mut) {
        for choice in choices {
            if let Some(message) = choice.get_mut("message").and_then(Value::as_object_mut) {
                strip_world_model_update_tool_calls_from_object(message);
            }
        }
    }

    response
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
    prompt_mode: WorldModelUpdatePromptMode,
) -> Vec<LocalChatInputMessage> {
    let Some(frame) = frame else {
        return messages.to_vec();
    };
    let config = if matches!(prompt_mode, WorldModelUpdatePromptMode::RequiredFull) {
        desktop_runtime_core::frame::snapshot_render::SnapshotRenderConfig::full()
    } else {
        desktop_runtime_core::frame::snapshot_render::SnapshotRenderConfig::default()
    };
    let snapshot =
        desktop_runtime_core::frame::snapshot_render::render_world_model_snapshot(frame, &config);
    let system_content = render_world_model_system_context(&snapshot, prompt_mode);
    let mut output = messages.to_vec();
    output.insert(
        0,
        LocalChatInputMessage {
            role: "system".to_string(),
            content: system_content,
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
    );
    output
}

fn world_model_update_prompt_mode(
    state: &LocalChatToolRuntimeState,
    effective_tool_call_meta: &[serde_json::Value],
) -> WorldModelUpdatePromptMode {
    let Some(frame) = state.world_model_frame.as_ref() else {
        return WorldModelUpdatePromptMode::Off;
    };
    if state.execution_policy.require_world_model_update
        || frame.needs_refresh()
        || frame.needs_revision()
    {
        return WorldModelUpdatePromptMode::RequiredFull;
    }
    if !effective_tool_call_meta.is_empty()
        || has_pending_tool_result_messages(&state.orchestrated_messages)
    {
        return WorldModelUpdatePromptMode::RequiredDelta;
    }
    let highwater = frame.last_seen_by_model;
    let has_new_directive = frame
        .user_directed
        .iter()
        .any(|directive| directive.appended_at > highwater);
    let has_new_runtime_change = frame
        .world_observed
        .iter()
        .any(|observation| observation.appended_at > highwater)
        || frame
            .agent_committed
            .iter()
            .any(|commit| commit.committed_at > highwater);

    if has_new_directive || has_new_runtime_change {
        WorldModelUpdatePromptMode::RequiredDelta
    } else if frame.turns_since_last_world_model_update() >= 10 {
        WorldModelUpdatePromptMode::AllowedDelta
    } else {
        WorldModelUpdatePromptMode::Off
    }
}

fn is_synthetic_tool_feedback_message(message: &LocalChatInputMessage) -> bool {
    message.role.eq_ignore_ascii_case("user")
        && message
            .content
            .trim_start()
            .starts_with("Tool execution round ")
}

fn has_pending_tool_result_messages(messages: &[LocalChatInputMessage]) -> bool {
    for message in messages.iter().rev() {
        if message.role.eq_ignore_ascii_case("tool") || is_synthetic_tool_feedback_message(message)
        {
            return true;
        }
        if message.role.eq_ignore_ascii_case("user") {
            return false;
        }
    }
    false
}

fn messages_for_provider_round(
    messages: &[LocalChatInputMessage],
    round: usize,
) -> Vec<LocalChatInputMessage> {
    if round <= 1 {
        return messages.to_vec();
    }
    let mut protocol_ref_inserted = false;
    messages
        .iter()
        .filter_map(|message| {
            let mut message = message.clone();
            if message.role.eq_ignore_ascii_case("system") {
                if let Some(compacted) = compact_replayed_system_prompt_content(&message.content) {
                    if protocol_ref_inserted {
                        return None;
                    }
                    message.content = compacted;
                    protocol_ref_inserted = true;
                }
            }
            Some(message)
        })
        .collect()
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
        orchestrated_messages.insert(
            0,
            LocalChatInputMessage {
                role: "system".to_string(),
                content: render_desktop_execution_tools_injection_prompt(),
                reasoning_content: None,
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            },
        );
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
        session_discovered_tools: std::collections::HashSet::new(),
    };
    continue_local_chat_complete_with_tools(app, app_state, state)
        .await
        .map(|output| LocalChatCompleteWithToolsOutput {
            response_json: output.response,
            captured_world_model_update: output.captured_world_model_update,
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
                    Some(state.realtime_emitter.captured_render_blocks()),
                ),
            });
        }

        let effective_allowed_tool_names = state
            .execution_policy
            .effective_allowed_tool_names(state.last_capability_snapshot.as_ref());
        let include_bootstrap_tools = state.round == 1;
        let tools = build_local_runtime_tools_with_allowlist(
            &effective_allowed_tool_names,
            state.last_capability_snapshot.as_ref(),
            include_bootstrap_tools,
        );
        let effective_tool_call_meta = build_state_effective_tool_call_meta(&state);
        let provider_messages =
            messages_for_provider_round(&state.orchestrated_messages, state.round);
        let stream_model_id = model_id.clone();
        let response = request_provider_chat_completion_streaming_with_pool_failover(
            app_state,
            &provider_model_id,
            &model_id,
            messages_with_world_model_snapshot(
                &provider_messages,
                state.world_model_frame.as_ref(),
                world_model_update_prompt_mode(&state, &effective_tool_call_meta),
            ),
            tools,
            state.temperature,
            state.max_tokens,
            ReasoningRequestConfig {
                enabled: state.reasoning_enabled,
                effort: state.reasoning_effort.clone(),
            },
            state.model_connection.failover_pool_key.as_deref(),
            Some(state.trace_id.as_str()),
            Some(session_id.as_str()),
            |event| {
                state
                    .realtime_emitter
                    .emit_provider_stream_event(event, &stream_model_id);
                Ok(())
            },
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
            state
                .runtime_transition_blocks
                .push(project_world_model_frame_decision_block(
                    WorldModelFrameProjectionInput {
                        trace_id: state.trace_id.as_str(),
                        request_id: state.request_id.as_deref(),
                        session_id: state.session_id.as_str(),
                        frame_kind: WorldModelFrameKind::Refresh,
                        intent: update.intent.as_deref(),
                        fact_count: update.facts.len(),
                        assumption_count: update.assumptions.len(),
                        verification_target_count: update.verification_targets.len(),
                        rule_count: update.rules.len(),
                    },
                ));
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
        let world_model_only_tool_calls = tool_calls_are_only_world_model_update(&tool_calls);
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
                Some(state.realtime_emitter.captured_render_blocks()),
            );
            // Inject world model snapshot into the final response
            let response = if let Some(frame) = state.world_model_frame.as_ref() {
                let snapshot = build_world_model_snapshot_extract(frame);
                if let Some(obj) = response.as_object().cloned() {
                    let mut obj = obj;
                    obj.insert("world_model_snapshot".to_string(), snapshot);
                    Value::Object(obj)
                } else {
                    response
                }
            } else {
                response
            };
            return Ok(LocalChatToolRuntimeOutput {
                captured_world_model_update: state.captured_world_model_update.clone(),
                world_model_frame: state.world_model_frame.clone(),
                response: attach_runtime_transition_events(
                    response,
                    &state.runtime_transition_blocks,
                ),
            });
        }

        if !world_model_only_tool_calls {
            // Stream reasoning content as a thought block immediately,
            // so the user sees thinking during intermediate tool-call rounds.
            if let Some(reasoning) = response
                .get("reasoning_content")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                state.realtime_emitter.emit_thought(reasoning);
            }

            // Stream the assistant's visible content for this intermediate round as a
            // text block, emitted after the thought and before the tool-call blocks so
            // the UI renders thought -> text -> tool_call in chronological order.
            // Final-round content is handled by the orchestrator's terminal text block,
            // so this only covers content that shares a turn with tool calls.
            if let Some(content) = response
                .get("content")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                if response
                    .get("provider_streamed")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
                {
                    state.realtime_emitter.capture_text(content);
                } else {
                    state.realtime_emitter.emit_text(content);
                }
            }
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

        // Extract values before mutable borrow to avoid borrow checker conflicts
        let session_id_str = state.session_id.clone();
        let active_capability_ref = state.active_capability.clone();

        match process_chat_tool_calls(
            app,
            app_state,
            &mut state,
            &response,
            &prior_tool_call_meta,
            session_id_str.as_str(),
            &effective_allowed_tool_names,
            active_capability_ref.as_ref(),
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
                let response_without_internal_tool_calls =
                    strip_world_model_update_tool_calls(response.clone());
                if !synthesized {
                    let mut current_tool_call_meta = build_state_effective_tool_call_meta(&state);
                    current_tool_call_meta.extend(canonical_tool_call_meta.clone());
                    return Ok(LocalChatToolRuntimeOutput {
                        captured_world_model_update: state.captured_world_model_update.clone(),
                        world_model_frame: state.world_model_frame.clone(),
                        response: attach_runtime_transition_events(
                            enrich_response_with_tool_trace(
                                response_without_internal_tool_calls,
                                &current_tool_call_meta,
                                state.realtime_emitter.emitted_any,
                                &state.runtime_metrics,
                                Some(state.realtime_emitter.captured_render_blocks()),
                            ),
                            &state.runtime_transition_blocks,
                        ),
                    });
                }
                finalize_tool_round(
                    &mut state.orchestrated_messages,
                    &state.model_connection.protocol_family,
                    state.round,
                    &response_without_internal_tool_calls,
                    &canonical_tool_call_meta,
                    &results,
                );
                state.last_response = Some(attach_runtime_transition_events(
                    enrich_response_with_tool_trace(
                        response_without_internal_tool_calls,
                        &canonical_tool_call_meta,
                        state.realtime_emitter.emitted_any,
                        &state.runtime_metrics,
                        None,
                    ),
                    &state.runtime_transition_blocks,
                ));
            }
            LocalToolCallProcessingOutcome::Interrupted {
                approval_tokens: _approval_tokens,
                mut tool_call_meta,
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
                            Some(state.realtime_emitter.captured_render_blocks()),
                        ),
                        &state.runtime_transition_blocks,
                    ),
                });
            }
        }
    }
}
