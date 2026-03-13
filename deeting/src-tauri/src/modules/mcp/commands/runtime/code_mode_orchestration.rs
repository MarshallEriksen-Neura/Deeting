use super::super::{common_impl::to_string, support::*};
use super::{
    append_streamable_local_tool_result_blocks, build_auto_code_mode_tool_feedback,
    build_local_code_mode_entry_tools_with_allowlist, build_local_consult_expert_network_result,
    build_local_sdk_search_result_with_runtime, build_local_tool_call_install_gate_error_meta,
    build_local_tool_trace_blocks, execute_or_queue_mcp_tool_call_with_tool_ref,
    extract_chat_tool_calls, install_local_skill_from_onboarding_request,
    request_provider_chat_completion, resolve_callable_mcp_tool_by_ref,
    resolve_dynamic_direct_capability_tool_name, resolve_local_capability_activation_state,
    resolve_skill_binding_by_ref, LocalCapabilityActivationState, LocalExecutionPolicy,
    LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION, LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
};
use crate::modules::mcp::commands::common_impl::LocalModelConnection;

#[derive(Debug, Clone)]
struct CapabilityExecutionContract {
    allowed_tools: Vec<String>,
    capability_snapshot: serde_json::Value,
}

const DEFAULT_MAX_AGENTIC_ROUNDS: usize = 10;

#[derive(Debug, Clone, Default)]
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
        capability_update: Option<LocalCapabilityActivationUpdate>,
    },
}

struct LocalChatAutoCodeModeState {
    max_rounds: usize,
    round: usize,
    trace_id: String,
    execution_policy: LocalExecutionPolicy,
    model_connection: LocalModelConnection,
    orchestrated_messages: Vec<LocalChatInputMessage>,
    chat_ctx: LocalConversationChatContext,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    active_capability: Option<LocalCapabilityActivationState>,
    all_tool_call_meta: Vec<serde_json::Value>,
    runtime_metrics: RuntimeMetricsAccumulator,
    last_capability_snapshot: Option<serde_json::Value>,
    last_response: Option<serde_json::Value>,
    realtime_emitter: LocalRealtimeToolTraceEmitter,
}

struct LocalChatAutoCodeModeOutput {
    response: serde_json::Value,
}

pub(crate) async fn run_local_chat_complete_with_auto_code_mode(
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
    let max_rounds = match app_state
        .mcp
        .store
        .get_desktop_config("max_agentic_rounds")
        .await
    {
        Ok(Some(val)) => val.parse::<usize>().unwrap_or(DEFAULT_MAX_AGENTIC_ROUNDS),
        _ => DEFAULT_MAX_AGENTIC_ROUNDS,
    };
    let trace_id = trace_id
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut orchestrated_messages = messages;
    if execution_policy.inject_code_mode_protocol
        && !orchestrated_messages
            .first()
            .map(|m| m.role == "system")
            .unwrap_or(false)
    {
        orchestrated_messages.insert(0, LocalChatInputMessage {
            role: "system".to_string(),
            content: concat!(
                "## Desktop Code Mode Runtime\n",
                "- Environment: Deeting Desktop local runtime\n",
                "When the user asks to install, create, or manage skills:\n",
                "- Deeting skills are capability bundles centered on SKILL.md, deeting.json, and callable tool bindings derived from llm-tool.yaml when present.\n",
                "- Use the install_skill_from_repo tool or sys_submit_onboarding_request to install skills.\n",
                "- User skills directory: $APP_DATA_DIR/skills/<skill_id>/.\n",
                "- Do NOT use opencode, codex, openclaw, or any other platform's skill paths or manifest format.\n",
            ).to_string(),
        });
    }

    let state = LocalChatAutoCodeModeState {
        max_rounds,
        round: 0,
        trace_id: trace_id.clone(),
        execution_policy: execution_policy.clone(),
        model_connection: model_connection.clone(),
        orchestrated_messages,
        chat_ctx: chat_ctx.clone(),
        temperature,
        max_tokens,
        active_capability: None,
        all_tool_call_meta: Vec::new(),
        runtime_metrics: RuntimeMetricsAccumulator::default(),
        last_capability_snapshot: execution_policy.capability_snapshot.clone(),
        last_response: None,
        realtime_emitter: LocalRealtimeToolTraceEmitter::new(
            event_tx,
            Some(trace_id.as_str()),
            request_id,
        ),
    };
    continue_local_chat_complete_with_auto_code_mode(app, app_state, state)
        .await
        .map(|output| output.response)
}

#[derive(Debug, Clone)]
enum LocalCapabilityActivationUpdate {
    Activate(LocalCapabilityActivationState),
    Deactivate {
        _capability_id: Option<String>,
        capability_name: Option<String>,
    },
}

async fn continue_local_chat_complete_with_auto_code_mode(
    app: &AppHandle,
    app_state: &AppState,
    mut state: LocalChatAutoCodeModeState,
) -> Result<LocalChatAutoCodeModeOutput, String> {
    let session_id = state.chat_ctx.session_id.clone();
    let provider_model_id = state.model_connection.provider_model_id.clone();
    let model_id = state.model_connection.model_id.clone();

    loop {
        state.round = state.round.saturating_add(1);
        if state.round > state.max_rounds {
            log::warn!(
                "agentic loop exceeded {} rounds, returning last response",
                state.max_rounds
            );
            let mut fallback = state.last_response.unwrap_or_else(|| {
                serde_json::json!({"content": "Tool execution reached the maximum number of rounds."})
            });
            if !state.all_tool_call_meta.is_empty() {
                fallback["tool_trace_blocks"] = serde_json::Value::Array(
                    build_local_tool_trace_blocks(&state.all_tool_call_meta),
                );
            }
            if state.realtime_emitter.emitted_any {
                fallback["tool_trace_streamed"] = serde_json::json!(true);
            }
            state.runtime_metrics.inject_into_response(&mut fallback);
            return Ok(LocalChatAutoCodeModeOutput { response: fallback });
        }

        let effective_allowed_tool_names = state
            .execution_policy
            .effective_allowed_tool_names(state.last_capability_snapshot.as_ref());
        let tools = build_local_code_mode_entry_tools_with_allowlist(
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
            let mut enriched = response;
            if !state.all_tool_call_meta.is_empty() {
                enriched["tool_trace_blocks"] = serde_json::Value::Array(
                    build_local_tool_trace_blocks(&state.all_tool_call_meta),
                );
            }
            if state.realtime_emitter.emitted_any {
                enriched["tool_trace_streamed"] = serde_json::json!(true);
            }
            state.runtime_metrics.inject_into_response(&mut enriched);
            return Ok(LocalChatAutoCodeModeOutput { response: enriched });
        }

        state.last_response = Some(response.clone());
        match maybe_handle_local_code_mode_tool_calls(
            app,
            app_state,
            &response,
            &state.chat_ctx,
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
                capability_update,
            } => {
                if !synthesized {
                    return Ok(LocalChatAutoCodeModeOutput { response });
                }
                finalize_tool_round(
                    &mut state.orchestrated_messages,
                    &mut state.active_capability,
                    state.round,
                    &response,
                    &tool_call_meta,
                    &results,
                    capability_update,
                );
                state.all_tool_call_meta.extend(tool_call_meta);
            }
        }
    }
}

fn finalize_tool_round(
    orchestrated_messages: &mut Vec<LocalChatInputMessage>,
    active_capability: &mut Option<LocalCapabilityActivationState>,
    round: usize,
    response: &serde_json::Value,
    tool_call_meta: &[serde_json::Value],
    results: &[String],
    capability_update: Option<LocalCapabilityActivationUpdate>,
) {
    apply_capability_update(orchestrated_messages, active_capability, capability_update);

    let tool_feedback = build_auto_code_mode_tool_feedback(round, tool_call_meta, results);
    let assistant_content = response
        .get("content")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
    if !assistant_content.is_empty() {
        orchestrated_messages.push(LocalChatInputMessage {
            role: "assistant".to_string(),
            content: assistant_content,
        });
    }
    orchestrated_messages.push(LocalChatInputMessage {
        role: "user".to_string(),
        content: tool_feedback,
    });
}

fn apply_capability_update(
    orchestrated_messages: &mut Vec<LocalChatInputMessage>,
    active_capability: &mut Option<LocalCapabilityActivationState>,
    capability_update: Option<LocalCapabilityActivationUpdate>,
) {
    if let Some(update) = capability_update {
        match update {
            LocalCapabilityActivationUpdate::Activate(next_active) => {
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
                });
            }
            LocalCapabilityActivationUpdate::Deactivate {
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
                });
            }
        }
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

async fn maybe_handle_local_code_mode_tool_calls(
    app: &AppHandle,
    app_state: &AppState,
    chat_response: &serde_json::Value,
    chat_ctx: &LocalConversationChatContext,
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
            capability_update: None,
        };
    }
    let mut tool_call_meta = Vec::new();
    let mut results = Vec::new();
    let mut synthesized = false;
    let mut capability_update = None;

    for call in tool_calls {
        let requested_tool_name = call.name.trim().to_lowercase();
        let tool_name = resolve_dynamic_direct_capability_tool_name(
            &requested_tool_name,
            last_capability_snapshot.as_ref(),
        )
        .unwrap_or(requested_tool_name);
        let call_id = call.id.clone().unwrap_or_default();
        if !effective_allowed_tool_names
            .iter()
            .any(|item| item == &tool_name)
        {
            synthesized = true;
            let error = format!(
                "tool '{}' is not enabled for the current execution policy",
                tool_name
            );
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
            let meta = serde_json::json!({
                "id": call.id,
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

        if tool_name == "execute_code_plan" {
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
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
            let execution_contract = match build_execution_contract_from_search_result(
                last_capability_snapshot.as_ref(),
            ) {
                Ok(contract) => contract,
                Err(error) => {
                    synthesized = true;
                    let meta = serde_json::json!({
                        "id":call.id,
                        "name":tool_name,
                        "status":"error",
                        "error_code":"CODE_MODE_SEARCH_REQUIRED",
                        "error":error,
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Code Execution Blocked [CODE_MODE_SEARCH_REQUIRED]: {}",
                        error
                    ));
                    continue;
                }
            };
            if !code.is_empty() {
                let execution_res =
                    crate::modules::code_mode::commands::execute_local_code_mode_inner(
                        app_state,
                        ExecuteLocalCodeModeRequest {
                            code: code.to_string(),
                            session_id: Some(chat_ctx.session_id.clone()),
                            language: Some(language.to_string()),
                            execution_timeout,
                            dry_run: Some(dry_run),
                            context: None,
                            max_calls: None,
                            allowed_tools: Some(execution_contract.allowed_tools.clone()),
                            capability_snapshot: Some(
                                execution_contract.capability_snapshot.clone(),
                            ),
                        },
                        build_runtime_bridge_stream_target(realtime_emitter),
                    )
                    .await;
                match execution_res {
                    Ok(res) => {
                        synthesized = true;
                        let meta_status = if res.success { "success" } else { "error" };
                        let meta = serde_json::json!({
                            "id":call.id,
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
                            results
                                .push(format!("Code Execution Result:\n{}", res.result.join("\n")));
                        } else {
                            results.push(format!(
                                "Code Execution Blocked: {}",
                                res.error.unwrap_or_else(|| "sandbox not ready".to_string())
                            ));
                        }
                    }
                    Err(err) => {
                        let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"error","error":err.to_string()});
                        let mut streamed_blocks = Vec::new();
                        append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                        realtime_emitter.emit_blocks(streamed_blocks);
                        tool_call_meta.push(meta);
                        results.push(format!("Code Execution Failed: {}", err));
                    }
                }
            }
        } else if tool_name == "search_sdk" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
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
            let search_res = build_local_sdk_search_result_with_runtime(
                app_state.mcp.store.as_ref(),
                &app_state.providers.embedding,
                app_state.memory.service.as_ref(),
                query,
                limit,
            )
            .await;
            *last_capability_snapshot = Some(search_res.clone());
            synthesized = true;
            let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"success","result":search_res});
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push(format!(
                "SDK Search Result for '{}':\n{}",
                query,
                serde_json::to_string_pretty(&search_res).unwrap()
            ));
        } else if tool_name == "consult_expert_network" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
            let intent_query = call
                .arguments
                .get("intent_query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = call
                .arguments
                .get("k")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
                .unwrap_or(3);
            let consult_res = build_local_consult_expert_network_result(
                app_state,
                intent_query,
                limit,
                active_capability.map(|v| v.capability_id.as_str()),
            )
            .await;
            synthesized = true;
            let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"success","result":consult_res});
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push(format!(
                "Expert Capability Consult Result for '{}':\n{}",
                intent_query,
                serde_json::to_string_pretty(&consult_res).unwrap()
            ));
        } else if tool_name == "attach_capability" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
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
                    let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"success","result":result});
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Expert capability '{}' attached for the current request.",
                        state.capability_name
                    ));
                    capability_update = Some(LocalCapabilityActivationUpdate::Activate(state));
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
                    let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"error","error_code":"CAPABILITY_ATTACH_FAILED","error":err});
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
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
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
            let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"success","result":result});
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push("Assistant deactivated for the current request.".to_string());
            capability_update = Some(LocalCapabilityActivationUpdate::Deactivate {
                _capability_id: active_capability.map(|v| v.capability_id.clone()),
                capability_name: active_capability.map(|v| v.capability_name.clone()),
            });
        } else if tool_name == "sys_submit_onboarding_request" {
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
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
                let create_req: Result<crate::modules::mcp::types::CreateLocalAssistantRequest, _> =
                    serde_json::from_value(payload);
                if let Ok(req) = create_req {
                    match app_state.mcp.store.create_local_assistant(req).await {
                        Ok(id) => {
                            synthesized = true;
                            let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"success","result":{"action":"created","id":id}});
                            let mut streamed_blocks = Vec::new();
                            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                            realtime_emitter.emit_blocks(streamed_blocks);
                            tool_call_meta.push(meta);
                            results.push(format!("Assistant created successfully with ID: {}", id));
                        }
                        Err(err) => {
                            let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"error","error":err.to_string()});
                            let mut streamed_blocks = Vec::new();
                            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                            realtime_emitter.emit_blocks(streamed_blocks);
                            tool_call_meta.push(meta);
                        }
                    }
                }
            } else if asset_type == "skill" {
                match install_local_skill_from_onboarding_request(app, app_state, &payload).await {
                    Ok(result) => {
                        synthesized = true;
                        let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"success","result":result});
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
                        let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"error","error":err});
                        let mut streamed_blocks = Vec::new();
                        append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                        realtime_emitter.emit_blocks(streamed_blocks);
                        tool_call_meta.push(meta);
                        results.push(format!("Skill onboarding failed: {}", err));
                    }
                }
            }
        } else {
            synthesized = true;
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
            match resolve_callable_mcp_tool_by_ref(
                app_state.mcp.store.as_ref(),
                None,
                Some(&tool_name),
            )
            .await
            {
                Ok(tool) => {
                    let risk = app_state.mcp.assess_tool_risk(&tool, &call.arguments);
                    let approval_context = app_state
                        .mcp
                        .build_approval_context(call.id.as_deref(), None);
                    match execute_or_queue_mcp_tool_call_with_tool_ref(
                        &approval_context,
                        Some(risk.risk_level),
                        risk.reasons,
                        Some(&app_state.mcp),
                        app_state.mcp.store.as_ref(),
                        app_state.mcp.pending_tool_calls.as_ref(),
                        Some(tool.id.clone()),
                        Some(tool.name.clone()),
                        call.arguments.clone(),
                        risk.requires_approval,
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
                                "id": call.id,
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
                            } else {
                                results.push(format!(
                                    "Tool call '{}' executed successfully.",
                                    tool_name
                                ));
                            }
                        }
                        Err(err) => {
                            let meta = serde_json::json!({
                                "id": call.id,
                                "name": tool_name,
                                "status": "error",
                                "error_code": "LOCAL_TOOL_EXECUTION_FAILED",
                                "error": err,
                            });
                            let mut streamed_blocks = Vec::new();
                            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                            realtime_emitter.emit_blocks(streamed_blocks);
                            tool_call_meta.push(meta);
                            results.push(format!("Tool call '{}' failed: {}", tool_name, err));
                        }
                    }
                }
                Err(err) => {
                    if let Ok(Some(binding)) = resolve_skill_binding_by_ref(
                        app_state.mcp.store.as_ref(),
                        None,
                        Some(&tool_name),
                    )
                    .await
                    {
                        let risk = app_state
                            .mcp
                            .assess_skill_binding_risk(&binding, &call.arguments);
                        let approval_context = app_state
                            .mcp
                            .build_approval_context(call.id.as_deref(), None);
                        match execute_or_queue_mcp_tool_call_with_tool_ref(
                            &approval_context,
                            Some(risk.risk_level),
                            risk.reasons,
                            Some(&app_state.mcp),
                            app_state.mcp.store.as_ref(),
                            app_state.mcp.pending_tool_calls.as_ref(),
                            Some(binding.binding_id.clone()),
                            Some(binding.callable_name.clone()),
                            call.arguments.clone(),
                            risk.requires_approval,
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
                                    "id": call.id,
                                    "name": tool_name,
                                    "status": if requires_approval { "requires_approval" } else { "success" },
                                    "result": tool_result,
                                });
                                let mut streamed_blocks = Vec::new();
                                append_streamable_local_tool_result_blocks(
                                    &mut streamed_blocks,
                                    &meta,
                                );
                                realtime_emitter.emit_blocks(streamed_blocks);
                                tool_call_meta.push(meta);
                                if requires_approval {
                                    results.push(format!(
                                        "Tool call '{}' requires approval before execution.",
                                        tool_name
                                    ));
                                } else {
                                    results.push(format!(
                                        "Tool call '{}' executed successfully.",
                                        tool_name
                                    ));
                                }
                            }
                            Err(binding_err) => {
                                let meta = serde_json::json!({
                                    "id": call.id,
                                    "name": tool_name,
                                    "status": "error",
                                    "error_code": "LOCAL_TOOL_EXECUTION_FAILED",
                                    "error": binding_err,
                                });
                                let mut streamed_blocks = Vec::new();
                                append_streamable_local_tool_result_blocks(
                                    &mut streamed_blocks,
                                    &meta,
                                );
                                realtime_emitter.emit_blocks(streamed_blocks);
                                tool_call_meta.push(meta);
                                results.push(format!(
                                    "Tool call '{}' failed: {}",
                                    tool_name, binding_err
                                ));
                            }
                        }
                    } else {
                        let error = err.to_string();
                        let meta = build_local_tool_call_install_gate_error_meta(
                            call.id.as_deref(),
                            &tool_name,
                            &error,
                        );
                        let mut streamed_blocks = Vec::new();
                        append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                        realtime_emitter.emit_blocks(streamed_blocks);
                        tool_call_meta.push(meta);
                        results.push(format!(
                            "Tool call '{}' failed [{}]: {}",
                            tool_name, LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE, error
                        ));
                    }
                }
            }
        }
    }
    LocalToolCallProcessingOutcome::Completed {
        synthesized,
        tool_call_meta,
        results,
        capability_update,
    }
}

fn build_execution_contract_from_search_result(
    search_result: Option<&serde_json::Value>,
) -> Result<CapabilityExecutionContract, String> {
    let Some(search_result) = search_result else {
        return Err(
            "execute_code_plan requires a prior search_sdk result with callable direct capabilities"
                .to_string(),
        );
    };
    let allowed_tools =
        crate::modules::capability_control_plane::extract_direct_callable_capability_names(
            search_result,
        )?;
    Ok(CapabilityExecutionContract {
        allowed_tools,
        capability_snapshot: search_result.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcp::commands::runtime::build_local_tool_call_install_gate_error_meta;
    use crate::modules::mcp::commands::runtime::dynamic_capability_alias;
    use crate::modules::mcp::commands::runtime::LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE;

    #[test]
    fn build_execution_contract_from_search_result_requires_capabilities() {
        let err = build_execution_contract_from_search_result(Some(&serde_json::json!({
            "recipes": [{"name": "Weather Skill"}]
        })))
        .expect_err("should require callable results");
        assert!(err.contains("capabilities"));
    }

    #[test]
    fn build_execution_contract_from_search_result_extracts_allowed_tools() {
        let contract = build_execution_contract_from_search_result(Some(&serde_json::json!({
            "capabilities": [
                {"name": "search_web", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "fetch_page", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "search_web", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "disabled_tool", "invocation_mode": "direct", "status": {"callable": false}},
                {"name": "execute_code_plan", "invocation_mode": "code_mode", "status": {"callable": true}}
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
    fn resolves_direct_capability_alias_back_to_callable_name() {
        let alias = dynamic_capability_alias("skill.official.skills.weather.get_weather");
        let resolved = resolve_dynamic_direct_capability_tool_name(
            &alias,
            Some(&serde_json::json!({
                "capabilities": [
                    {
                        "name": "skill.official.skills.weather.get_weather",
                        "invocation_mode": "direct",
                        "status": {"callable": true}
                    }
                ]
            })),
        );

        assert_eq!(
            resolved.as_deref(),
            Some("skill.official.skills.weather.get_weather")
        );
    }
}
