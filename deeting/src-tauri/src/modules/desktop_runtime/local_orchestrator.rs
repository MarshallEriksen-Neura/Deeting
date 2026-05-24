use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::modules::ai_upstream::types::LocalModelConnection;
use crate::modules::conversations::summary_generation::generate_local_conversation_title_with_secretary_model;
#[cfg(test)]
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
};
#[cfg(test)]
use crate::modules::desktop_runtime::runtime::prompt_assets::PromptAssets;
#[cfg(test)]
use crate::modules::desktop_runtime::runtime::prompt_plan::{
    build_local_prelude_messages, parse_router_prompt_local_context,
    render_local_router_base_prompt, render_local_runtime_system_prompt,
    router_prompt_default_local_context, router_prompt_response_language_for_locale_pref,
};
#[cfg(test)]
use mcp_runtime::route::{select_local_route, LocalRouteKind};
use crate::modules::desktop_runtime::runtime::sovereign::{
    PosteriorSignalIngress, UserActionIngress,
};
use crate::modules::desktop_runtime::runtime::{
    apply_policy_delta, build_default_local_execution_policy, evaluate_task_learning_with_runtime,
    mark_local_assistant_postprocess_completed, persist_local_assistant_turn,
    project_execution_graph_blocks_from_value, resolve_local_model_pool_connection,
    resolve_posterior_signal_ingress, resolve_provider_model_connection,
    run_local_runtime_composition_entrypoint, LocalExecutionRequest,
};
#[cfg(test)]
use crate::modules::desktop_runtime::runtime::{
    build_local_control_plane_status_meta, build_local_execution_policy,
};
#[cfg(test)]
use crate::modules::memory::types::LocalMemoryItem;
use crate::modules::providers::model_guard::ensure_required_local_models_configured;
use crate::modules::render_runtime::resolve_response_rendering;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use mcp_session::conversation::{
    CreateConversationMessageRequest, LocalConversationHistoryMessage,
};
use mcp_transport::gateway::GeneratedArtifactContext;
#[cfg(test)]
use std::collections::HashMap;

mod message_utils;
mod model_selection;
mod retrieval;
mod workflow;

use message_utils::{
    build_assistant_meta, build_compare_only_messages, convert_history_message_to_chat_input,
    derive_local_finish_reason, extract_content_text, extract_response_runtime_metrics,
    extract_summary_text, fallback_prefers_chinese, latest_tool_error_summary, AssistantMetaMode,
};
#[cfg(test)]
use model_selection::LocalConversationModelBinding;
use model_selection::{
    extract_local_conversation_model_binding, pool_request_matches_model_connection,
    reusable_pinned_provider_model_id, LocalModelSelectionMode,
};
#[cfg(test)]
use retrieval::{
    build_global_memory_list_query, build_global_semantic_memory_search_query,
    build_scoped_memory_list_query, build_selected_document_overview,
    build_selected_knowledge_fallback_hits, fuse_selected_knowledge_hits, matches_recall_when,
    InjectedMemory, SelectedKnowledgeDocumentContext, CORE_MEMORY_LIST_LIMIT,
    SEMANTIC_MEMORY_SEARCH_LIMIT,
};
use workflow::{build_desktop_local_chat_engine, unix_seconds, LocalWorkflowContext};
#[cfg(test)]
use workflow::{
    extract_explicit_skill_mentions, render_skill_recipe_prompt, status_patch, ContextPatch,
    LocalStepResult,
};

pub use message_utils::extract_user_text_from_messages;
pub(crate) use workflow::{
    LocalOrchestrationEngine, LocalWorkflowStep, StepResult, StepResultContext,
};

pub struct LocalOrchestratorInput {
    pub model: String,
    pub model_selection_mode: Option<String>,
    pub provider_model_id: Option<String>,
    pub explicit_task_agent_id: Option<String>,
    pub root_execution_id: Option<String>,
    pub generated_artifact_context: Option<GeneratedArtifactContext>,
    pub session_id: String,
    pub capability_id: Option<String>,
    pub regenerate: bool,
    pub compare_only: bool,
    pub user_content: Option<String>,
    pub provided_messages: Option<Vec<LocalChatInputMessage>>,
    pub persist_runtime_artifacts: bool,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub reasoning_enabled: Option<bool>,
    pub reasoning_effort: Option<String>,
    pub terminal_context: Option<Value>,
    pub workflow_context: Option<Value>,
    pub request_id: Option<String>,
    pub stream: bool,
    pub status_stream: bool,
    pub selected_knowledge_file_ids: Vec<String>,
    pub locale: Option<String>,
}

fn extract_latest_assistant_trace_id(
    messages: &[LocalConversationHistoryMessage],
) -> Option<String> {
    messages.iter().rev().find_map(|message| {
        if !message.role.eq_ignore_ascii_case("assistant") {
            return None;
        }
        message
            .meta_info
            .as_ref()
            .and_then(|value| value.get("trace_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

pub async fn execute_local_orchestrated_chat(
    app_handle: &AppHandle,
    app_state: &AppState,
    input: LocalOrchestratorInput,
    trace_id: String,
    event_tx: Option<UnboundedSender<String>>,
) -> Result<Value, String> {
    let session_id = input.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("session_id is required for desktop local chat".to_string());
    }

    ensure_required_local_models_configured(app_state).await?;

    let store = &app_state.mcp.store;
    let (capability_id, summary_text, messages, conversation_model_binding) =
        if let Some(messages) = input.provided_messages.clone() {
            if messages.is_empty() {
                return Err("provided messages are required for external engine access".to_string());
            }
            (input.capability_id.clone(), None, messages, None)
        } else if input.compare_only {
            let runtime_window = store
                .load_local_conversation_runtime_window(&session_id)
                .await
                .map_err(|e| e.to_string())?;
            let capability_id = input
                .capability_id
                .clone()
                .or(runtime_window.assistant_id.clone());
            let summary_text = extract_summary_text(runtime_window.summary.as_ref());
            let messages = build_compare_only_messages(runtime_window.messages)?;
            (capability_id, summary_text, messages, None)
        } else if input.regenerate {
            let regenerate_ctx = store
                .prepare_local_conversation_regenerate(&session_id)
                .await
                .map_err(|e| e.to_string())?;
            let runtime_window = store
                .load_local_conversation_runtime_window(&session_id)
                .await
                .map_err(|e| e.to_string())?;
            let capability_id = input
                .capability_id
                .clone()
                .or(regenerate_ctx.assistant_id)
                .or(runtime_window.assistant_id.clone());
            let summary_text = extract_summary_text(runtime_window.summary.as_ref());
            let conversation_model_binding =
                extract_local_conversation_model_binding(runtime_window.meta.as_ref());
            let messages = runtime_window
                .messages
                .into_iter()
                .map(convert_history_message_to_chat_input)
                .collect();
            (
                capability_id,
                summary_text,
                messages,
                conversation_model_binding,
            )
        } else {
            let user_content = input
                .user_content
                .clone()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "missing user message content".to_string())?;

            store
                .ensure_local_conversation_for_session_id(&session_id)
                .await
                .map_err(|e| {
                    format!(
                        "chat step=ensure_conversation session={} err={}",
                        session_id, e
                    )
                })?;

            store
                .append_local_conversation_message(CreateConversationMessageRequest {
                    session_id: session_id.clone(),
                    role: "user".to_string(),
                    content: user_content.clone(),
                    name: None,
                    meta_info: None,
                    is_truncated: Some(false),
                    parent_message_id: None,
                })
                .await
                .map_err(|e| {
                    format!(
                        "chat step=append_user_message session={} err={}",
                        session_id, e
                    )
                })?;

            let runtime_window = store
                .load_local_conversation_runtime_window(&session_id)
                .await
                .map_err(|e| e.to_string())?;
            let previous_trace_id = extract_latest_assistant_trace_id(&runtime_window.messages);
            let user_action_ingress = UserActionIngress::new(
                Some(session_id.clone()),
                previous_trace_id.clone(),
                user_content.clone(),
            );
            let posterior_signal_ingress =
                PosteriorSignalIngress::new(user_action_ingress.posterior_signal_input());
            let posterior_signal = resolve_posterior_signal_ingress(&posterior_signal_ingress);
            let posterior_signal_input_json =
                serde_json::to_string(posterior_signal_ingress.input()).ok();
            if let Err(err) = store
                .record_posterior_signal_event(
                    None,
                    Some(session_id.as_str()),
                    previous_trace_id.as_deref(),
                    posterior_signal.source.as_str(),
                    posterior_signal.signal.as_str(),
                    posterior_signal.confidence,
                    posterior_signal_input_json.as_deref(),
                    Some("followup_user_message"),
                )
                .await
            {
                log::warn!(
                    "posterior signal event persist failed session={} err={}",
                    session_id,
                    err
                );
            }
            let capability_id = input
                .capability_id
                .clone()
                .or(runtime_window.assistant_id.clone());
            let summary_text = extract_summary_text(runtime_window.summary.as_ref());
            let conversation_model_binding =
                extract_local_conversation_model_binding(runtime_window.meta.as_ref());
            let messages = runtime_window
                .messages
                .into_iter()
                .map(convert_history_message_to_chat_input)
                .collect();
            (
                capability_id,
                summary_text,
                messages,
                conversation_model_binding,
            )
        };

    let mut ctx = LocalWorkflowContext::new(
        app_state.clone(),
        trace_id.clone(),
        input.request_id.clone(),
        &input,
        messages,
        summary_text.clone(),
        event_tx,
    );
    ctx.emit_status(
        "remember",
        Some("conversation_load"),
        "success",
        "context.loaded",
        Some(json!({
            "count": ctx.messages.len(),
            "capability_id": capability_id,
            "has_summary": summary_text.is_some(),
        })),
    );

    let selection_mode = LocalModelSelectionMode::from_input(
        input.model_selection_mode.as_deref(),
        input.compare_only,
    );
    let explicit_pool_provider_model_id = matches!(selection_mode, LocalModelSelectionMode::Pool)
        .then(|| input.provider_model_id.as_deref())
        .flatten()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let reused_pinned_provider_model_id = matches!(selection_mode, LocalModelSelectionMode::Pool)
        .then(|| {
            reusable_pinned_provider_model_id(conversation_model_binding.as_ref(), &input.model)
        })
        .flatten();
    let mut reused_existing_pool_binding = false;
    let model_connection = match selection_mode {
        LocalModelSelectionMode::ExactProvider => {
            resolve_provider_model_connection(
                app_state,
                input.provider_model_id.as_deref().ok_or_else(|| {
                    "provider_model_id is required for exact provider routing".to_string()
                })?,
            )
            .await?
        }
        LocalModelSelectionMode::Pool => {
            if let Some(explicit_provider_model_id) = explicit_pool_provider_model_id {
                let explicit_connection =
                    resolve_provider_model_connection(app_state, explicit_provider_model_id)
                        .await?;
                if pool_request_matches_model_connection(&input.model, &explicit_connection) {
                    explicit_connection
                } else if let Some(pinned_provider_model_id) = reused_pinned_provider_model_id {
                    if let Some(connection) = resolve_reusable_pinned_pool_connection(
                        app_state,
                        &input.model,
                        pinned_provider_model_id,
                    )
                    .await
                    {
                        reused_existing_pool_binding = true;
                        connection
                    } else {
                        resolve_local_model_pool_connection(app_state, &input.model).await?
                    }
                } else {
                    resolve_local_model_pool_connection(app_state, &input.model).await?
                }
            } else if let Some(pinned_provider_model_id) = reused_pinned_provider_model_id {
                if let Some(connection) = resolve_reusable_pinned_pool_connection(
                    app_state,
                    &input.model,
                    pinned_provider_model_id,
                )
                .await
                {
                    reused_existing_pool_binding = true;
                    connection
                } else {
                    resolve_local_model_pool_connection(app_state, &input.model).await?
                }
            } else {
                resolve_local_model_pool_connection(app_state, &input.model).await?
            }
        }
    };
    let provider_model_id = model_connection.provider_model_id.clone();
    let model_id = model_connection.model_id.clone();
    if !input.compare_only && input.persist_runtime_artifacts {
        if let Err(err) = store
            .update_local_conversation_model_context(
                &session_id,
                Some(model_id.as_str()),
                Some(provider_model_id.as_str()),
            )
            .await
        {
            log::warn!(
                "update_local_conversation_model_context failed session={} err={}",
                session_id,
                err
            );
        }
        if matches!(selection_mode, LocalModelSelectionMode::Pool)
            && (explicit_pool_provider_model_id.is_some() || !reused_existing_pool_binding)
        {
            let pinned_model_key = model_connection
                .logical_model_key
                .as_deref()
                .unwrap_or_else(|| input.model.as_str());
            if let Err(err) = store
                .update_local_conversation_model_binding(
                    &session_id,
                    Some(pinned_model_key),
                    Some(provider_model_id.as_str()),
                    Some(if explicit_pool_provider_model_id.is_some() {
                        "user_selected_pool_member"
                    } else {
                        "pool_selection"
                    }),
                )
                .await
            {
                log::warn!(
                    "update_local_conversation_model_binding failed session={} err={}",
                    session_id,
                    err
                );
            }
        }
    }
    ctx.emit_status(
        "remember",
        Some("routing"),
        "success",
        "routing.selected",
        Some(json!({
            "provider_model_id": provider_model_id,
            "model_id": model_id,
            "logical_model_key": model_connection.logical_model_key,
            "model_selection_mode": selection_mode.as_str(),
            "pinned_model_key": conversation_model_binding
                .as_ref()
                .and_then(|binding| binding.pinned_model_key.clone()),
            "sticky_reused": conversation_model_binding
                .as_ref()
                .and_then(|_| reused_pinned_provider_model_id)
                .map(|value| value == provider_model_id.as_str())
                .unwrap_or(false),
            "explicit_pool_member_requested": explicit_pool_provider_model_id.is_some(),
            "pinned_binding_source": conversation_model_binding
                .as_ref()
                .and_then(|binding| binding.pinned_binding_source.clone()),
            "candidates": 1,
        })),
    );

    let engine = build_desktop_local_chat_engine()?;
    engine.execute(&mut ctx).await?;

    let execution_policy = ctx
        .control_plane_result
        .as_ref()
        .map(|result| result.execution_policy.clone())
        .or_else(|| ctx.execution_policy.clone())
        .clone()
        .unwrap_or_else(build_default_local_execution_policy);
    let execution_outcome = run_local_runtime_composition_entrypoint(
        LocalExecutionRequest {
            app_handle: app_handle.clone(),
            app_state: app_state.clone(),
            model_connection: model_connection.clone(),
            session_id: session_id.clone(),
            capability_id: capability_id.clone(),
            explicit_task_agent_id: input.explicit_task_agent_id.clone(),
            root_execution_id: input.root_execution_id.clone(),
            messages: ctx.messages.clone(),
            execution_policy: execution_policy.clone(),
            temperature: input.temperature,
            max_tokens: input.max_tokens,
            reasoning_enabled: input.reasoning_enabled,
            reasoning_effort: input.reasoning_effort.clone(),
            terminal_context: input.terminal_context.clone(),
            workflow_context: input.workflow_context.clone(),
            event_tx: ctx.event_tx.clone(),
            trace_id: Some(trace_id.clone()),
            request_id: input.request_id.clone(),
            selected_knowledge_file_ids: ctx.selected_knowledge_file_ids.clone(),
        },
        |stage, step, state, code, meta| {
            ctx.emit_status(stage, step, state, code, meta);
        },
    )
    .await?;
    let delegated_execution = execution_outcome.delegated_execution;
    let execution_graph = execution_outcome.execution_graph;
    let response_json = execution_outcome.response_json;

    let mut response_text =
        extract_content_text(response_json.get("content").cloned().unwrap_or(Value::Null));
    let mut response_text_was_synthesized_from_error = false;
    let render_resolution =
        resolve_response_rendering(app_handle, app_state.mcp.store.as_ref(), &response_json).await;
    if render_resolution.consumed_content {
        response_text = render_resolution.summary_text.clone().unwrap_or_default();
    }
    if response_text.trim().is_empty() {
        if let Some(summary) = render_resolution.summary_text.as_deref() {
            response_text = summary.to_string();
        }
    }
    ctx.emit_status(
        "render",
        Some("upstream_call"),
        "streaming",
        "upstream.streaming",
        None,
    );

    let mut assistant_blocks = Vec::<Value>::new();
    let tool_trace_streamed = response_json
        .get("tool_trace_streamed")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if let Some(execution) = delegated_execution.as_ref() {
        if !execution.trace_blocks.is_empty() {
            ctx.emit_blocks(execution.trace_blocks.clone());
            assistant_blocks.extend(execution.trace_blocks.clone());
        }
        /* legacy execution.lifecycle block builder retained temporarily for diff safety
        let _execution_block = json!({
            "type": "ui",
            "viewType": "execution.lifecycle",
            "title": format!("Delegated Execution 路 {}", execution.record.target.name),
            "payload": {
                "execution_id": execution.record.execution_id,
                "execution_kind": execution.record.kind.as_str(),
                "execution_status": "integrated",
                "terminal_status": execution.record.status.as_str(),
                "target": {
                    "id": execution.record.target.id,
                    "name": execution.record.target.name,
                    "invocation_kind": execution.record.target.invocation_kind,
                    "worker_ref": execution.record.target.worker_ref,
                    "workflow_run_id": execution.record.target.workflow_run_id,
                },
                "selection": {
                    "explicit": execution.record.selection.explicit,
                    "score": execution.record.selection.score,
                    "reason_codes": execution.record.selection.reason_codes,
                    "reason_text": execution.record.selection.reason_text,
                    "candidate_count": execution.record.selection.candidate_count,
                    "selected_from_top_k": execution.record.selection.selected_from_top_k,
                    "callable_coverage_score": execution.record.selection.callable_coverage_score,
                    "modality_fit_score": execution.record.selection.modality_fit_score,
                    "profile_prior_score": execution.record.selection.profile_prior_score,
                },
                "packet_receipt": execution.record.packet_receipt.as_ref().map(|receipt| json!({
                    "packet_hash": receipt.packet_hash,
                    "task_kind": receipt.task_kind,
                    "deliverable_kind": receipt.deliverable_kind,
                    "selected_profile_id": receipt.selected_profile_id,
                })),
                "available_actions": execution
                    .record
                    .available_actions
                    .iter()
                    .map(|action| json!({ "kind": action.kind }))
                    .collect::<Vec<_>>(),
                "summary": execution.record.summary,
                "error": execution.record.error,
                "started_at_ms": execution.record.started_at_ms,
                "completed_at_ms": execution.record.completed_at_ms,
                "children": execution
                    .record
                    .children
                    .iter()
                    .map(|child| {
                        json!({
                            "id": child.id,
                            "phase_id": child.phase_id,
                            "step_type": child.step_type,
                            "title": child.title,
                            "status": child.status,
                            "worker_ref": child.worker_ref,
                            "summary": child.summary,
                            "error": child.error,
                            "available_actions": child
                                .available_actions
                                .iter()
                                .map(|action| json!({ "kind": action.kind }))
                                .collect::<Vec<_>>(),
                        })
                    })
                    .collect::<Vec<_>>(),
                "primary_output": execution.record.primary_output,
            },
            "metadata": {
                "execution_id": execution.record.execution_id,
                "execution_kind": execution.record.kind.as_str(),
                "workflow_run_id": execution.record.target.workflow_run_id,
                "worker_ref": execution.record.target.worker_ref,
            }
        });
        */
        let execution_block = execution.build_ui_block(
            crate::modules::desktop_runtime::runtime::execution_plane::DelegatedExecutionStatus::Integrated,
        );
        ctx.emit_blocks(vec![execution_block.clone()]);
        assistant_blocks.push(execution_block);
    }
    if let Some(tool_trace_blocks) = response_json
        .get("tool_trace_blocks")
        .and_then(|value| value.as_array())
        .filter(|value| !value.is_empty())
    {
        let trace_blocks = tool_trace_blocks.to_vec();
        if !tool_trace_streamed {
            ctx.emit_blocks(trace_blocks.clone());
        }
        assistant_blocks.extend(trace_blocks);
    } else if let Some(execution_graph) = response_json.get("execution_graph") {
        let trace_blocks = project_execution_graph_blocks_from_value(execution_graph);
        if !trace_blocks.is_empty() {
            ctx.emit_blocks(trace_blocks.clone());
            assistant_blocks.extend(trace_blocks);
        }
    }

    if response_text.trim().is_empty() {
        if let Some(summary) = latest_tool_error_summary(
            &assistant_blocks,
            fallback_prefers_chinese(ctx.control_plane_result.as_ref()),
        ) {
            response_text = summary;
            response_text_was_synthesized_from_error = true;
        }
    }

    ctx.emit_stream_delta_chunks(&response_text);
    if !response_text.trim().is_empty() {
        let text_block = json!({
            "type": "text",
            "content": response_text,
        });
        ctx.emit_blocks(vec![text_block.clone()]);
        assistant_blocks.push(text_block);
    }
    if !render_resolution.blocks.is_empty() {
        ctx.emit_blocks(render_resolution.blocks.clone());
        assistant_blocks.extend(render_resolution.blocks);
    }
    if let Some(execution) = delegated_execution.as_ref() {
        let status_for_meta = if execution.record.status
            == crate::modules::desktop_runtime::runtime::execution_plane::DelegatedExecutionStatus::Running
        {
            crate::modules::desktop_runtime::runtime::execution_plane::DelegatedExecutionStatus::Running
        } else {
            crate::modules::desktop_runtime::runtime::execution_plane::DelegatedExecutionStatus::Integrated
        };
        ctx.emit_status(
            "evolve",
            Some("worker_delegation"),
            "success",
            if status_for_meta
                == crate::modules::desktop_runtime::runtime::execution_plane::DelegatedExecutionStatus::Running
            {
                "delegation.running"
            } else {
                "delegation.integrated"
            },
            Some(
                execution.record.status_meta_with_status(status_for_meta),
            ),
        );
    }

    let total_latency_ms = ctx.started_at.elapsed().as_millis() as i64;
    let (upstream_latency_ms, ttft_ms, upstream_calls) =
        extract_response_runtime_metrics(&response_json);
    let orchestrator_latency_ms = upstream_latency_ms
        .map(|value| total_latency_ms.saturating_sub(value))
        .unwrap_or(total_latency_ms);
    let mut upstream_response_meta = serde_json::Map::new();
    upstream_response_meta.insert("latency_ms".to_string(), json!(total_latency_ms));
    upstream_response_meta.insert("total_latency_ms".to_string(), json!(total_latency_ms));
    upstream_response_meta.insert(
        "orchestrator_latency_ms".to_string(),
        json!(orchestrator_latency_ms),
    );
    if let Some(value) = upstream_latency_ms.filter(|value| *value > 0) {
        upstream_response_meta.insert("upstream_latency_ms".to_string(), json!(value));
    }
    if let Some(value) = ttft_ms.filter(|value| *value > 0) {
        upstream_response_meta.insert("ttft_ms".to_string(), json!(value));
    }
    if let Some(value) = upstream_calls.filter(|value| *value > 0) {
        upstream_response_meta.insert("upstream_calls".to_string(), json!(value));
    }
    let runtime_metrics_value = Value::Object(upstream_response_meta.clone());
    ctx.emit_status(
        "render",
        Some("upstream_call"),
        "success",
        "upstream.response",
        Some(runtime_metrics_value.clone()),
    );

    let assistant_meta = build_assistant_meta(
        assistant_blocks.clone(),
        &model_id,
        &provider_model_id,
        Some(runtime_metrics_value),
        Some(execution_graph.clone()),
        delegated_execution.as_ref().map(|execution| {
            execution.record.status_meta_with_status(
                if execution.record.status
                    == crate::modules::desktop_runtime::runtime::execution_plane::DelegatedExecutionStatus::Running
                {
                    crate::modules::desktop_runtime::runtime::execution_plane::DelegatedExecutionStatus::Running
                } else {
                    crate::modules::desktop_runtime::runtime::execution_plane::DelegatedExecutionStatus::Integrated
                },
            )
        }),
        if input.compare_only {
            AssistantMetaMode::CompareCandidate
        } else {
            AssistantMetaMode::Canonical
        },
    );
    let mut assistant_meta = assistant_meta;
    if !input.compare_only && input.persist_runtime_artifacts {
        let persistence = persist_local_assistant_turn(
            store.as_ref(),
            &session_id,
            assistant_meta.clone(),
            &execution_graph,
            input.request_id.as_deref(),
        )
        .await
        .map_err(|e| {
            format!(
                "chat step=persist_assistant_core session={} err={}",
                session_id, e
            )
        })?;
        let persisted_assistant_turn_index = persistence.turn_index;
        assistant_meta = persistence.assistant_meta;
        let title_app_state = app_state.clone();
        let title_session_id = session_id.clone();
        tauri::async_runtime::spawn(async move {
            let title_context = match title_app_state
                .mcp
                .store
                .get_local_conversation_title_context(&title_session_id)
                .await
            {
                Ok(value) => value,
                Err(err) => {
                    log::warn!(
                        "get_local_conversation_title_context failed session={} err={}",
                        title_session_id,
                        err
                    );
                    return;
                }
            };

            if title_context
                .title
                .as_deref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
            {
                return;
            }
            if title_context.message_count > 2 {
                return;
            }

            let Some(first_user_message) = title_context.first_user_message.as_deref() else {
                return;
            };

            match generate_local_conversation_title_with_secretary_model(
                &title_app_state,
                first_user_message,
                Some(title_session_id.as_str()),
            )
            .await
            {
                Ok(Some(title)) => {
                    if let Err(err) = title_app_state
                        .mcp
                        .store
                        .update_local_conversation_title_if_empty(&title_session_id, &title)
                        .await
                    {
                        log::warn!(
                            "update_local_conversation_title_if_empty failed session={} err={}",
                            title_session_id,
                            err
                        );
                    }
                }
                Ok(None) => {}
                Err(err) => {
                    log::warn!(
                        "generate_local_conversation_title_with_secretary_model failed session={} err={}",
                        title_session_id,
                        err
                    );
                }
            }
        });

        if let Some(variant) = ctx.selected_prompt_variant.clone() {
            let bandit_store = app_state.providers.store.clone();
            let prompt_success = !response_text.trim().is_empty();
            let prompt_latency = ctx.started_at.elapsed().as_millis() as f64;
            tauri::async_runtime::spawn(async move {
                if let Err(e) = bandit_store
                    .record_feedback_simple(
                        "router:prompt",
                        &variant,
                        prompt_success,
                        Some(prompt_latency),
                    )
                    .await
                {
                    log::warn!("bandit feedback failed for router:prompt: {}", e);
                }
            });
        }

        match mark_local_assistant_postprocess_completed(
            store.as_ref(),
            &session_id,
            persisted_assistant_turn_index,
            assistant_meta.clone(),
        )
        .await
        {
            Ok(updated_meta) => {
                assistant_meta = updated_meta;
            }
            Err(err) => {
                log::warn!(
                    "mark_local_assistant_postprocess_completed failed session={} turn={} err={}",
                    session_id,
                    persisted_assistant_turn_index,
                    err
                );
            }
        }
    }

    let delegated_execution_learning = delegated_execution.as_ref().map(|execution| {
        crate::modules::desktop_runtime::runtime::TaskLearningDelegatedExecution {
            kind: execution.record.kind.as_str().to_string(),
            status: execution.record.status.as_str().to_string(),
            selected_profile_id: execution
                .record
                .packet_receipt
                .as_ref()
                .map(|receipt| receipt.selected_profile_id.clone())
                .or_else(|| Some(execution.record.target.id.clone())),
            worker_ref: execution.record.target.worker_ref.clone(),
            packet_hash: execution
                .record
                .packet_receipt
                .as_ref()
                .map(|receipt| receipt.packet_hash.clone()),
            task_kind: execution
                .record
                .packet_receipt
                .as_ref()
                .map(|receipt| receipt.task_kind.clone()),
            deliverable_kind: execution
                .record
                .packet_receipt
                .as_ref()
                .map(|receipt| receipt.deliverable_kind.clone()),
        }
    });

    let created = unix_seconds();
    let mut message = json!({
        "role": "assistant",
        "content": response_text,
    });
    if let Some(meta_info) = assistant_meta {
        if let Some(object) = message.as_object_mut() {
            object.insert("meta_info".to_string(), meta_info);
        }
    }

    let finish_reason = derive_local_finish_reason(
        &response_json,
        response_text_was_synthesized_from_error,
        &assistant_blocks,
    );

    let mut response = json!({
        "id": format!("chatcmpl-local-{}", Uuid::new_v4()),
        "object": "chat.completion",
        "created": created,
        "model": model_connection.model_id.clone(),
        "session_id": session_id,
        "trace_id": trace_id,
        "choices": [{
            "index": 0,
            "finish_reason": finish_reason,
            "message": message,
        }],
    });
    ctx.enrich_payload(&mut response);

    if !input.compare_only && input.persist_runtime_artifacts {
        if let Some(task_fingerprint) = ctx.task_fingerprint.as_ref() {
            let evaluation = evaluate_task_learning_with_runtime(
                task_fingerprint,
                ctx.route_decision.as_ref(),
                &execution_policy,
                &response_text,
                response_text_was_synthesized_from_error,
                &finish_reason,
                total_latency_ms,
                &assistant_blocks,
                delegated_execution_learning,
                None,
            );
            let fingerprint_key = task_fingerprint.key();
            let task_fingerprint_json =
                serde_json::to_string(task_fingerprint).unwrap_or_else(|_| "{}".to_string());
            let route_decision_json = ctx
                .route_decision
                .as_ref()
                .and_then(|value| serde_json::to_string(value).ok());
            let execution_policy_json =
                serde_json::to_string(&execution_policy).unwrap_or_else(|_| "{}".to_string());
            let outcome_json =
                serde_json::to_string(&evaluation.outcome).unwrap_or_else(|_| "{}".to_string());
            let attribution_json =
                serde_json::to_string(&evaluation.attribution).unwrap_or_else(|_| "{}".to_string());
            let policy_delta_json = evaluation
                .policy_delta
                .as_ref()
                .and_then(|value| serde_json::to_string(value).ok());
            let task_learning_run_id = match store
                .record_task_learning_run(
                    &session_id,
                    input.request_id.as_deref(),
                    Some(&trace_id),
                    &fingerprint_key,
                    ctx.latest_user_query(),
                    &task_fingerprint_json,
                    route_decision_json.as_deref(),
                    &execution_policy_json,
                    &outcome_json,
                    &attribution_json,
                    policy_delta_json.as_deref(),
                    evaluation.learning_eligible,
                    &evaluation.delta_state,
                )
                .await
            {
                Ok(run_id) => Some(run_id),
                Err(err) => {
                    log::warn!(
                        "task learning run persist failed session={} err={}",
                        session_id,
                        err
                    );
                    None
                }
            };
            if let Some(delta) = evaluation.policy_delta.as_ref() {
                if let Err(err) = apply_policy_delta(
                    store.as_ref(),
                    &fingerprint_key,
                    delta,
                    task_learning_run_id
                        .as_deref()
                        .or(input.request_id.as_deref()),
                )
                .await
                {
                    log::warn!(
                        "task learning delta persist failed session={} err={}",
                        session_id,
                        err
                    );
                }
            }
            record_task_learning_bandit_feedback(
                app_state,
                ctx.route_decision.as_ref(),
                &evaluation.outcome,
                total_latency_ms,
                &session_id,
                None,
            )
            .await;
            ctx.emit_status(
                "remember",
                Some("task_learning"),
                "success",
                "task.learning.evaluated",
                Some(json!({
                    "fingerprint_key": fingerprint_key,
                    "run_id": task_learning_run_id,
                    "learning_eligible": evaluation.learning_eligible,
                    "delta_state": evaluation.delta_state,
                    "outcome": evaluation.outcome,
                    "attribution": evaluation.attribution,
                    "policy_delta": evaluation.policy_delta,
                })),
            );
        }
    }
    Ok(response)
}

async fn resolve_reusable_pinned_pool_connection(
    app_state: &AppState,
    requested_model: &str,
    pinned_provider_model_id: &str,
) -> Option<LocalModelConnection> {
    let connection =
        match resolve_provider_model_connection(app_state, pinned_provider_model_id).await {
            Ok(connection) => connection,
            Err(err) => {
                log::warn!(
                    "pinned pool provider is no longer reusable provider_model_id={} err={}",
                    pinned_provider_model_id,
                    err
                );
                return None;
            }
        };
    if !pool_request_matches_model_connection(requested_model, &connection) {
        return None;
    }
    if pinned_pool_arm_is_reusable(app_state, pinned_provider_model_id).await {
        Some(connection)
    } else {
        None
    }
}

async fn pinned_pool_arm_is_reusable(app_state: &AppState, provider_model_id: &str) -> bool {
    use crate::modules::providers::store::BANDIT_DEFAULT_SCENE;

    let now = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    match app_state
        .providers
        .store
        .get_bandit_arm_state(BANDIT_DEFAULT_SCENE, provider_model_id)
        .await
    {
        Ok(state) => bandit_arm_allows_pinned_reuse(state.as_ref(), now.as_str()),
        Err(err) => {
            log::warn!(
                "failed to inspect pinned pool bandit state provider_model_id={} err={}",
                provider_model_id,
                err
            );
            true
        }
    }
}

fn bandit_arm_allows_pinned_reuse(
    arm: Option<&crate::modules::providers::types::BanditArmState>,
    now_rfc3339: &str,
) -> bool {
    let Some(arm) = arm else {
        return true;
    };
    if arm
        .cooldown_until
        .as_deref()
        .map(|until| until > now_rfc3339)
        .unwrap_or(false)
    {
        return false;
    }
    !(arm.total_trials > 0 && arm.last_reward <= 0.0)
}

async fn record_task_learning_bandit_feedback(
    app_state: &AppState,
    route_decision: Option<&crate::modules::desktop_runtime::runtime::LocalRouteDecision>,
    outcome: &crate::modules::desktop_runtime::runtime::task_learning::EvaluatedOutcome,
    total_latency_ms: i64,
    session_id: &str,
    memory_explore_arm_id: Option<&str>,
) {
    use crate::modules::providers::store::{
        BANDIT_SCENE_MEMORY_RECALL, BANDIT_SCENE_TASK_ROUTE, BANDIT_SCENE_WORKER_SELECTION,
    };
    use crate::modules::providers::types::BanditFeedbackRequest;

    let latency_ms_f64 = Some(total_latency_ms as f64);

    if let Some(decision) = route_decision {
        let judgment = outcome.route_judgment.as_str();
        if let Some(success) = route_judgment_to_success(judgment) {
            let feedback = BanditFeedbackRequest {
                scene: Some(BANDIT_SCENE_TASK_ROUTE.to_string()),
                arm_id: decision.route.as_str().to_string(),
                success,
                latency_ms: latency_ms_f64,
                cost: None,
                reward: Some(if success { 1.0 } else { 0.0 }),
                routing_config: None,
                reward_metric_type: None,
            };
            if let Err(err) = app_state
                .providers
                .store
                .record_bandit_feedback(feedback)
                .await
            {
                log::warn!(
                    "task learning route bandit feedback failed session={} err={}",
                    session_id,
                    err
                );
            }
        }
    }

    if let (Some(delegated), Some(judgment)) = (
        outcome.delegated_execution.as_ref(),
        outcome.worker_selection_judgment.as_deref(),
    ) {
        if let Some(arm_id) = delegated
            .selected_profile_id
            .as_deref()
            .map(|value: &str| value.trim())
            .filter(|value: &&str| !value.is_empty())
        {
            if let Some(success) = worker_selection_judgment_to_success(judgment) {
                let feedback = BanditFeedbackRequest {
                    scene: Some(BANDIT_SCENE_WORKER_SELECTION.to_string()),
                    arm_id: arm_id.to_string(),
                    success,
                    latency_ms: latency_ms_f64,
                    cost: None,
                    reward: Some(if success { 1.0 } else { 0.0 }),
                    routing_config: None,
                    reward_metric_type: None,
                };
                if let Err(err) = app_state
                    .providers
                    .store
                    .record_bandit_feedback(feedback)
                    .await
                {
                    log::warn!(
                        "task learning worker bandit feedback failed session={} err={}",
                        session_id,
                        err
                    );
                }
            }
        }
    }

    if let Some(arm_id) = memory_explore_arm_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        if let Some(success) = discovery_judgment_to_success(outcome.discovery_judgment.as_str()) {
            let feedback = BanditFeedbackRequest {
                scene: Some(BANDIT_SCENE_MEMORY_RECALL.to_string()),
                arm_id: arm_id.to_string(),
                success,
                latency_ms: latency_ms_f64,
                cost: None,
                reward: Some(if success { 1.0 } else { 0.0 }),
                routing_config: None,
                reward_metric_type: None,
            };
            if let Err(err) = app_state
                .providers
                .store
                .record_bandit_feedback(feedback)
                .await
            {
                log::warn!(
                    "memory recall bandit feedback failed session={} err={}",
                    session_id,
                    err
                );
            }
        }
    }
}

fn route_judgment_to_success(judgment: &str) -> Option<bool> {
    match judgment {
        "good" | "acceptable" => Some(true),
        "wasteful" | "wrong" => Some(false),
        _ => None,
    }
}

fn worker_selection_judgment_to_success(judgment: &str) -> Option<bool> {
    match judgment {
        "success" | "partial" => Some(true),
        "blocked" | "unstable" | "failed" => Some(false),
        _ => None,
    }
}

fn discovery_judgment_to_success(judgment: &str) -> Option<bool> {
    match judgment {
        "sufficient" => Some(true),
        "shallow" | "skipped_when_needed" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
#[path = "local_orchestrator/tests.rs"]
mod tests;
