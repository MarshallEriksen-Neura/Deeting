use super::super::{
    common_impl::{to_string, LocalModelConnection},
    support::*,
};
use super::{
    append_streamable_local_tool_result_blocks, build_auto_code_mode_tool_feedback,
    build_local_code_mode_entry_tools, build_local_consult_expert_network_result,
    build_local_sdk_search_result, build_local_tool_call_install_gate_error_meta,
    build_local_tool_trace_blocks, extract_chat_tool_calls,
    install_local_skill_from_onboarding_request, merge_wrapped_tool_payload,
    request_provider_chat_completion, resolve_local_assistant_activation_state,
    LocalAssistantActivationState, LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
    LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
};

pub(crate) async fn run_local_chat_complete_with_auto_code_mode(
    app: &AppHandle,
    app_state: &AppState,
    model_connection: &LocalModelConnection,
    messages: Vec<LocalChatInputMessage>,
    chat_ctx: &LocalConversationChatContext,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    event_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    trace_id: Option<&str>,
    request_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    const DEFAULT_MAX_AGENTIC_ROUNDS: usize = 10;
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
    let session_id = chat_ctx.session_id.clone();
    let provider_model_id = &model_connection.provider_model_id;
    let model_id = &model_connection.model_id;
    let mut orchestrated_messages = messages;
    if !orchestrated_messages
        .first()
        .map(|m| m.role == "system")
        .unwrap_or(false)
    {
        orchestrated_messages.insert(0, LocalChatInputMessage {
            role: "system".to_string(),
            content: concat!(
                "You are running inside Deeting, an AI agent platform.\n",
                "When the user asks to install, create, or manage skills:\n",
                "- Deeting skills use deeting.json (NOT SKILL.md), llm-tool.yaml, and main.py.\n",
                "- Use the install_skill_from_repo tool or sys_submit_onboarding_request to install skills.\n",
                "- User skills directory: $APP_DATA_DIR/skills/<skill_id>/.\n",
                "- Do NOT use opencode, codex, openclaw, or any other platform's skill paths or manifest format.\n",
            ).to_string(),
        });
    }

    let mut round = 0usize;
    let mut all_tool_call_meta = Vec::<serde_json::Value>::new();
    let mut last_response: Option<serde_json::Value> = None;
    let mut active_assistant: Option<LocalAssistantActivationState> = None;
    let mut realtime_emitter =
        LocalRealtimeToolTraceEmitter::new(event_tx, Some(trace_id.as_str()), request_id);

    loop {
        round = round.saturating_add(1);
        if round > max_rounds {
            log::warn!(
                "agentic loop exceeded {} rounds, returning last response",
                max_rounds
            );
            let mut fallback = last_response.unwrap_or_else(|| serde_json::json!({"content": "Tool execution reached the maximum number of rounds."}));
            if !all_tool_call_meta.is_empty() {
                fallback["tool_trace_blocks"] =
                    serde_json::Value::Array(build_local_tool_trace_blocks(&all_tool_call_meta));
            }
            if realtime_emitter.emitted_any {
                fallback["tool_trace_streamed"] = serde_json::json!(true);
            }
            return Ok(fallback);
        }

        let mut tools = build_local_code_mode_entry_tools();
        if let Some(active) = &active_assistant {
            tools = merge_wrapped_tool_payload(&tools, &active.skill_tools);
        }
        let response = request_provider_chat_completion(
            app_state,
            provider_model_id,
            model_id,
            orchestrated_messages.clone(),
            Some(tools),
            temperature,
            max_tokens,
            Some(trace_id.as_str()),
            Some(session_id.as_str()),
        )
        .await
        .map_err(to_string)?;

        if extract_chat_tool_calls(&response).is_empty() {
            let mut enriched = response;
            if !all_tool_call_meta.is_empty() {
                enriched["tool_trace_blocks"] =
                    serde_json::Value::Array(build_local_tool_trace_blocks(&all_tool_call_meta));
            }
            if realtime_emitter.emitted_any {
                enriched["tool_trace_streamed"] = serde_json::json!(true);
            }
            return Ok(enriched);
        }

        last_response = Some(response.clone());
        let (synthesized, tool_call_meta, results, assistant_update) =
            maybe_handle_local_code_mode_tool_calls(
                app,
                app_state,
                &response,
                chat_ctx,
                active_assistant.as_ref(),
                &mut realtime_emitter,
            )
            .await;
        if !synthesized {
            return Ok(response);
        }
        all_tool_call_meta.extend(tool_call_meta.iter().cloned());

        if let Some(update) = assistant_update {
            match update {
                LocalAssistantActivationUpdate::Activate(next_active) => {
                    let assistant_name = next_active.assistant_name.clone();
                    let system_prompt = next_active.system_prompt.clone();
                    active_assistant = Some(next_active);
                    orchestrated_messages.push(LocalChatInputMessage {
                        role: "system".to_string(),
                        content: format!(
                            "[Assistant Activated: {}]\n\nReplace any previously activated request-scoped assistant instructions with the following prompt.\n\n{}",
                            assistant_name, system_prompt,
                        ),
                    });
                }
                LocalAssistantActivationUpdate::Deactivate {
                    _assistant_id: _,
                    assistant_name,
                } => {
                    active_assistant = None;
                    let label = assistant_name.unwrap_or_else(|| "assistant".to_string());
                    orchestrated_messages.push(LocalChatInputMessage {
                        role: "system".to_string(),
                        content: format!(
                            "[Assistant Deactivated: {}]\n\nReturn to the default base assistant context for this request. Ignore any previous request-scoped assistant activation instructions.",
                            label,
                        ),
                    });
                }
            }
        }

        let tool_feedback = build_auto_code_mode_tool_feedback(round, &tool_call_meta, &results);
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
}

#[derive(Debug, Clone)]
enum LocalAssistantActivationUpdate {
    Activate(LocalAssistantActivationState),
    Deactivate {
        _assistant_id: Option<String>,
        assistant_name: Option<String>,
    },
}

struct LocalRealtimeToolTraceEmitter {
    tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    trace_id: Option<String>,
    request_id: Option<String>,
    emitted_execution_section: bool,
    emitted_any: bool,
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
        }
    }

    fn emit_execution_section_once(&mut self) {
        if self.emitted_execution_section {
            return;
        }
        self.emitted_execution_section = true;
        self.emit_blocks(vec![
            serde_json::json!({ "type": "execution_section", "title": "Local Tool Actions" }),
        ]);
    }

    fn emit_blocks(&mut self, blocks: Vec<serde_json::Value>) {
        if blocks.is_empty() {
            return;
        }
        let Some(tx) = &self.tx else {
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
    active_assistant: Option<&LocalAssistantActivationState>,
    realtime_emitter: &mut LocalRealtimeToolTraceEmitter,
) -> (
    bool,
    Vec<serde_json::Value>,
    Vec<String>,
    Option<LocalAssistantActivationUpdate>,
) {
    let tool_calls = extract_chat_tool_calls(chat_response);
    if tool_calls.is_empty() {
        return (false, Vec::new(), Vec::new(), None);
    }
    let mut tool_call_meta = Vec::new();
    let mut results = Vec::new();
    let mut synthesized = false;
    let mut assistant_update = None;

    for call in tool_calls {
        let tool_name = call.name.trim().to_lowercase();
        let call_id = call.id.clone().unwrap_or_default();
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
            if !dry_run {
                synthesized = true;
                let error = "execute_code_plan requires explicit user-confirmed execution; auto-run is blocked";
                tool_call_meta.push(serde_json::json!({"id":call.id,"name":tool_name,"status":"error","error_code":"CODE_MODE_APPROVAL_REQUIRED","error":error}));
                realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-result", call_id),"type":"tool_result","callId":call.id,"toolName":tool_name,"status":"error","result":{"error":error,"error_code":"CODE_MODE_APPROVAL_REQUIRED"}})]);
                results.push(format!(
                    "Code Execution Blocked [CODE_MODE_APPROVAL_REQUIRED]: {}",
                    error
                ));
                continue;
            }
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
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
            let query = call
                .arguments
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let search_res = build_local_sdk_search_result(app_state, query).await;
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
            realtime_emitter.emit_execution_section_once();
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
                active_assistant.map(|v| v.assistant_id.as_str()),
            )
            .await;
            synthesized = true;
            let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"success","result":consult_res});
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push(format!(
                "Assistant Consult Result for '{}':\n{}",
                intent_query,
                serde_json::to_string_pretty(&consult_res).unwrap()
            ));
        } else if tool_name == "activate_assistant" {
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
            let assistant_id = call
                .arguments
                .get("assistant_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let reason = call
                .arguments
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("Explicit assistant activation requested by the model.");
            match resolve_local_assistant_activation_state(app_state, assistant_id).await {
                Ok(state) => {
                    let activated_assistant_id = state.assistant_id.clone();
                    let result = serde_json::json!({
                        "action":"activated","scope":"request","format_version":LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
                        "activation_mode":"replace","assistant_id":activated_assistant_id,"assistant_name":state.assistant_name.clone(),
                        "system_prompt":state.system_prompt.clone(),"skill_tools":state.skill_tools.clone(),"reason":reason,
                        "assistant_transition":{"action":"activated","assistant_id":assistant_id,"assistant_name":state.assistant_name.clone(),"reason":reason}
                    });
                    synthesized = true;
                    let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"success","result":result});
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Assistant '{}' activated for the current request.",
                        state.assistant_name
                    ));
                    assistant_update = Some(LocalAssistantActivationUpdate::Activate(state));
                    let bandit_store = app_state.providers.store.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = bandit_store
                            .record_feedback_simple(
                                "router:assistant",
                                &activated_assistant_id,
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
                    let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"error","error_code":"ASSISTANT_ACTIVATION_FAILED","error":err});
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!("Assistant activation failed: {}", err));
                    synthesized = true;
                    let bandit_store = app_state.providers.store.clone();
                    let bandit_assistant_id = assistant_id.to_string();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = bandit_store
                            .record_feedback_simple(
                                "router:assistant",
                                &bandit_assistant_id,
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
        } else if tool_name == "deactivate_assistant" {
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
            let reason = call
                .arguments
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("Explicit assistant deactivation requested by the model.");
            let result = serde_json::json!({
                "action":"deactivated","scope":"request","format_version":LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
                "assistant_id":active_assistant.map(|v| v.assistant_id.clone()),"assistant_name":active_assistant.map(|v| v.assistant_name.clone()),"reason":reason,
                "assistant_transition":{"action":"deactivated","assistant_id":active_assistant.map(|v| v.assistant_id.clone()),"assistant_name":active_assistant.map(|v| v.assistant_name.clone()),"reason":reason}
            });
            synthesized = true;
            let meta = serde_json::json!({"id":call.id,"name":tool_name,"status":"success","result":result});
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push("Assistant deactivated for the current request.".to_string());
            assistant_update = Some(LocalAssistantActivationUpdate::Deactivate {
                _assistant_id: active_assistant.map(|v| v.assistant_id.clone()),
                assistant_name: active_assistant.map(|v| v.assistant_name.clone()),
            });
        } else if tool_name == "sys_submit_onboarding_request" {
            realtime_emitter.emit_execution_section_once();
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
            let error = format!(
                "tool '{}' is not installed or enabled in local desktop runtime",
                tool_name
            );
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({"id":format!("{}-tool-call", call_id),"type":"tool_call","callId":call.id,"toolName":tool_name,"status":"running"})]);
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
    (synthesized, tool_call_meta, results, assistant_update)
}
