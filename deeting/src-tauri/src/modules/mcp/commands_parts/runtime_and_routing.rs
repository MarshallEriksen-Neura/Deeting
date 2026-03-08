use super::{
    bootstrap_and_registry_impl::{to_string, LocalModelConnection},
    runtime::{
        append_streamable_local_tool_result_blocks, apply_config_payload,
        build_auto_code_mode_tool_feedback, build_local_consult_expert_network_result,
        build_local_summary_from_window, build_local_tool_call_install_gate_error_meta,
        build_local_tool_trace_blocks, extract_chat_tool_calls,
        generate_local_conversation_summary_with_model, install_local_skill_from_onboarding_request,
        lexical_rank_asset_hits, merge_wrapped_tool_payload, read_local_mcp_config,
        request_provider_chat_completion, resolve_local_assistant_activation_state,
        LocalAssistantActivationState,
        LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
        LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
        LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
    },
    support::*,
};

const LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT: &str = "local-embedding-rebuild-progress";

#[derive(Debug, Clone, Serialize)]
pub struct LocalEmbeddingRebuildProgress {
    pub phase: String,
    pub progress: i64,
    pub total: i64,
    pub processed: i64,
    pub indexed: i64,
    pub failed: i64,
    pub current: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalEmbeddingRebuildResponse {
    pub vector_dimension: i64,
    pub total: i64,
    pub indexed: i64,
    pub failed: i64,
    pub memory_total: i64,
    pub memory_indexed: i64,
    pub memory_failed: i64,
    pub asset_total: i64,
    pub asset_indexed: i64,
    pub asset_failed: i64,
}

fn emit_local_embedding_rebuild_progress(
    app: &AppHandle,
    phase: &str,
    total: usize,
    processed: usize,
    indexed: usize,
    failed: usize,
    current: Option<String>,
) {
    let progress = if total == 0 {
        100
    } else {
        ((processed.saturating_mul(100)) / total) as i64
    };
    let payload = LocalEmbeddingRebuildProgress {
        phase: phase.to_string(),
        progress,
        total: total as i64,
        processed: processed as i64,
        indexed: indexed as i64,
        failed: failed as i64,
        current,
    };
    let _ = app.emit(LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT, payload);
}

pub(crate) async fn rebuild_local_knowledge_vector_index(app_state: &AppState) -> Result<usize, String> {
    let files = app_state
        .mcp
        .store
        .list_local_user_documents(LocalUserDocumentListQuery {
            folder_id: None,
            status: None,
            q: None,
        })
        .await
        .map_err(to_string)?;
    let mut indexed = 0usize;
    for file in files {
        let text = format!(
            "name: {}\nstatus: {}\nsize: {}\nchunks: {}",
            file.name,
            file.status,
            file.size,
            file.chunks.unwrap_or(0)
        );
        if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            let _ = app_state
                .memory
                .service
                .upsert_asset(
                    file.id,
                    file.name,
                    format!("local knowledge file ({})", file.file_type),
                    "knowledge_file".to_string(),
                    "local_knowledge".to_string(),
                    None,
                    vector,
                    None,
                )
                .await;
            indexed = indexed.saturating_add(1);
        }
    }
    Ok(indexed)
}

#[tauri::command]
pub async fn rebuild_local_embedding_assets(
    app: AppHandle,
    app_state: State<'_, AppState>,
) -> Result<LocalEmbeddingRebuildResponse, String> {
    emit_local_embedding_rebuild_progress(&app, "prepare", 0, 0, 0, 0, None);

    let probe_vector = app_state
        .providers
        .embedding
        .embed_text("local_embedding_rebuild_probe")
        .await
        .map_err(to_string)?;
    let vector_dimension = probe_vector.len();
    if vector_dimension == 0 {
        return Err("embedding model returned empty vector".to_string());
    }

    let memories = app_state
        .memory
        .store
        .list_all_memories()
        .await
        .map_err(to_string)?;

    app_state
        .memory
        .service
        .recreate_local_asset_table(vector_dimension as i32)
        .await
        .map_err(to_string)?;

    let tools = app_state.mcp.store.list_tools().await.map_err(to_string)?;
    let assistants = app_state
        .mcp
        .store
        .list_local_assistants()
        .await
        .map_err(to_string)?;
    let enabled_assistant_ids = app_state
        .mcp
        .store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let local_knowledge_files = app_state
        .mcp
        .store
        .list_local_user_documents(LocalUserDocumentListQuery {
            folder_id: None,
            status: None,
            q: None,
        })
        .await
        .map_err(to_string)?;

    let assistant_candidates = assistants
        .into_iter()
        .filter(|assistant| enabled_assistant_ids.contains(assistant.id.as_str()))
        .collect::<Vec<_>>();
    let memory_total = memories.len();
    let asset_total = tools.len() + assistant_candidates.len() + local_knowledge_files.len();
    let total = memory_total + asset_total;
    let mut processed = 0usize;
    let mut indexed = 0usize;
    let mut failed = 0usize;
    let mut memory_indexed = 0usize;
    let mut memory_failed = 0usize;
    let mut asset_indexed = 0usize;
    let mut asset_failed = 0usize;

    let mut rebuilt_memories = Vec::with_capacity(memories.len());
    for memory in memories {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_memories",
            total,
            processed,
            indexed,
            failed,
            Some(memory.content.chars().take(48).collect()),
        );

        let embedding = match app_state.providers.embedding.embed_text(&memory.content).await {
            Ok(vector) => {
                indexed = indexed.saturating_add(1);
                memory_indexed = memory_indexed.saturating_add(1);
                Some(vector)
            }
            Err(error) => {
                log::warn!("memory rebuild embedding failed for {}: {}", memory.id, error);
                failed = failed.saturating_add(1);
                memory_failed = memory_failed.saturating_add(1);
                None
            }
        };

        processed = processed.saturating_add(1);
        rebuilt_memories.push((memory, embedding));
    }

    app_state
        .memory
        .store
        .recreate_local_memory_table(vector_dimension as i32)
        .await
        .map_err(to_string)?;

    for (memory, embedding) in rebuilt_memories {
        let embedding_model = if embedding.is_some() {
            Some("rebuild".to_string())
        } else {
            None
        };

        app_state
            .memory
            .store
            .insert_memory_record(&memory, embedding, embedding_model)
            .await
            .map_err(to_string)?;
    }

    for tool in tools {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_tools",
            total,
            processed,
            indexed,
            failed,
            Some(tool.name.clone()),
        );
        let text = format!("name: {}\ndescription: {}", tool.name, tool.description);
        let upserted = if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            app_state
                .memory
                .service
                .upsert_asset(
                    tool.id,
                    tool.name,
                    tool.description,
                    "tool".to_string(),
                    "mcp".to_string(),
                    tool.identifier,
                    vector,
                    None,
                )
                .await
                .is_ok()
        } else {
            false
        };
        processed = processed.saturating_add(1);
        if upserted {
            indexed = indexed.saturating_add(1);
            asset_indexed = asset_indexed.saturating_add(1);
        } else {
            failed = failed.saturating_add(1);
            asset_failed = asset_failed.saturating_add(1);
        }
    }

    for assistant in assistant_candidates {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_assistants",
            total,
            processed,
            indexed,
            failed,
            Some(assistant.name.clone()),
        );
        let tags = if assistant.tags.is_empty() {
            String::new()
        } else {
            assistant.tags.join(", ")
        };
        let text = format!(
            "name: {}\ndescription: {}\ntags: {}",
            assistant.name,
            assistant.description.as_deref().unwrap_or(""),
            tags
        );
        let upserted = if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            app_state
                .memory
                .service
                .upsert_asset(
                    assistant.id,
                    assistant.name,
                    assistant.description.unwrap_or_default(),
                    "assistant".to_string(),
                    "local_assistant".to_string(),
                    None,
                    vector,
                    None,
                )
                .await
                .is_ok()
        } else {
            false
        };
        processed = processed.saturating_add(1);
        if upserted {
            indexed = indexed.saturating_add(1);
            asset_indexed = asset_indexed.saturating_add(1);
        } else {
            failed = failed.saturating_add(1);
            asset_failed = asset_failed.saturating_add(1);
        }
    }

    for file in local_knowledge_files {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_knowledge",
            total,
            processed,
            indexed,
            failed,
            Some(file.name.clone()),
        );
        let text = format!(
            "name: {}\nstatus: {}\nsize: {}\nchunks: {}",
            file.name,
            file.status,
            file.size,
            file.chunks.unwrap_or(0)
        );
        let upserted = if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            app_state
                .memory
                .store
                .upsert_asset(
                    file.id,
                    file.name,
                    format!("local knowledge file ({})", file.file_type),
                    "knowledge_file".to_string(),
                    "local_knowledge".to_string(),
                    None,
                    vector,
                    None,
                )
                .await
                .is_ok()
        } else {
            false
        };
        processed = processed.saturating_add(1);
        if upserted {
            indexed = indexed.saturating_add(1);
            asset_indexed = asset_indexed.saturating_add(1);
        } else {
            failed = failed.saturating_add(1);
            asset_failed = asset_failed.saturating_add(1);
        }
    }

    emit_local_embedding_rebuild_progress(
        &app,
        "completed",
        total,
        processed,
        indexed,
        failed,
        None,
    );

    Ok(LocalEmbeddingRebuildResponse {
        vector_dimension: vector_dimension as i64,
        total: total as i64,
        indexed: indexed as i64,
        failed: failed as i64,
        memory_total: memory_total as i64,
        memory_indexed: memory_indexed as i64,
        memory_failed: memory_failed as i64,
        asset_total: asset_total as i64,
        asset_indexed: asset_indexed as i64,
        asset_failed: asset_failed as i64,
    })
}

pub(crate) async fn sync_source_inner(
    state: &McpRuntimeState,
    source: McpSource,
    auth_token: Option<String>,
) -> Result<Vec<McpTool>, McpError> {
    let tools = match source.source_type {
        McpSourceType::Local => {
            let path = expand_path(&source.path_or_url);
            let config_json = read_local_mcp_config(&path)?;
            let config: McpConfigPayload = serde_json::from_str(&config_json)
                .map_err(|err| McpError::Storage(err.to_string()))?;
            apply_config_payload(state, &source, config).await?
        }
        McpSourceType::Cloud | McpSourceType::Modelscope | McpSourceType::Github | McpSourceType::Url => {
            let mut request = state.client.get(&source.path_or_url);
            if let Some(token) = auth_token {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
            let response = request
                .send()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;

            if !response.status().is_success() {
                return Err(McpError::Network(format!(
                    "failed to fetch cloud config: {}",
                    response.status()
                )));
            }

            let config: McpConfigPayload = response
                .json()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;
            apply_config_payload(state, &source, config).await?
        }
    };

    Ok(tools)
}

pub(crate) async fn start_local_conversation_summary_worker(app_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(
        LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
    ));
    loop {
        interval.tick().await;
        if let Err(err) = process_next_local_conversation_summary_job(&app_state).await {
            warn!("conversation summary worker error: {}", err);
        }
    }
}

pub(crate) async fn start_local_periodic_worker(state: McpRuntimeState) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        if let Err(err) = state.store.dispatch_due_local_conversation_summary_idle_tasks().await {
            warn!("periodic worker dispatch idle task error: {}", err);
        }
        if let Err(err) = state
            .store
            .cleanup_old_local_conversation_summary_jobs(7 * 24 * 60 * 60)
            .await
        {
            warn!("periodic worker cleanup old jobs error: {}", err);
        }
    }
}

async fn process_next_local_conversation_summary_job(app_state: &AppState) -> Result<(), McpError> {
    process_next_local_conversation_summary_job_inner(Some(app_state), app_state.mcp.store.as_ref()).await
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn process_next_local_conversation_summary_job_with_store(
    store: &crate::modules::mcp::store::McpStore,
) -> Result<(), McpError> {
    process_next_local_conversation_summary_job_inner(None, store).await
}

async fn process_next_local_conversation_summary_job_inner(
    app_state: Option<&AppState>,
    store: &crate::modules::mcp::store::McpStore,
) -> Result<(), McpError> {
    let Some(job) = store.claim_next_local_conversation_summary_job().await? else {
        return Ok(());
    };

    let processing = async {
        let window = store
            .load_local_conversation_runtime_window(&job.session_id)
            .await?;
        let model_summary = if let Some(app_state) = app_state {
            let meta = window.meta.as_ref();
            let model_id = meta
                .and_then(|value| value.get("last_model_id"))
                .and_then(|value| value.as_str())
                .map(|value| value.trim())
                .filter(|value| !value.is_empty());
            let provider_model_id = meta
                .and_then(|value| value.get("last_provider_model_id"))
                .and_then(|value| value.as_str())
                .map(|value| value.trim())
                .filter(|value| !value.is_empty());

            if let (Some(model_id), Some(provider_model_id)) = (model_id, provider_model_id) {
                match generate_local_conversation_summary_with_model(
                    app_state,
                    provider_model_id,
                    model_id,
                    &window.messages,
                    Some(job.session_id.as_str()),
                )
                .await
                {
                    Ok(Some(summary)) if !summary.trim().is_empty() => Some((summary, model_id.to_string())),
                    Ok(_) => None,
                    Err(err) => {
                        log::warn!(
                            "local conversation model summary failed session={} err={}",
                            job.session_id,
                            err
                        );
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        };

        let (summary, summarizer_model) = model_summary.unwrap_or_else(|| {
            (
                build_local_summary_from_window(&window.messages),
                "local-worker".to_string(),
            )
        });
        if summary.trim().is_empty() {
            return Err(McpError::validation("conversation summary content is empty"));
        }
        store
            .persist_local_conversation_summary(
                &job.session_id,
                &summary,
                Some(summarizer_model.as_str()),
            )
            .await?;
        Ok::<(), McpError>(())
    }
    .await;

    match processing {
        Ok(()) => store.complete_local_conversation_summary_job(&job.id).await,
        Err(err) => {
            let message = err.to_string();
            let _ = store
                .fail_local_conversation_summary_job(&job, &message, 30)
                .await;
            Err(err)
        }
    }
}

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
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let session_id = chat_ctx.session_id.clone();

    let provider_model_id = &model_connection.provider_model_id;
    let model_id = &model_connection.model_id;
    let mut orchestrated_messages = messages;

    // Inject Deeting platform identity as leading system message
    let has_system = orchestrated_messages
        .first()
        .map(|m| m.role == "system")
        .unwrap_or(false);
    if !has_system {
        orchestrated_messages.insert(
            0,
            LocalChatInputMessage {
                role: "system".to_string(),
                content: concat!(
                    "You are running inside Deeting, an AI agent platform.\n",
                    "When the user asks to install, create, or manage skills:\n",
                    "- Deeting skills use deeting.json (NOT SKILL.md), llm-tool.yaml, and main.py.\n",
                    "- Use the install_skill_from_repo tool or sys_submit_onboarding_request to install skills.\n",
                    "- User skills directory: $APP_DATA_DIR/skills/<skill_id>/.\n",
                    "- Do NOT use opencode, codex, openclaw, or any other platform's skill paths or manifest format.\n",
                ).to_string(),
            },
        );
    }

    let mut round: usize = 0;
    let mut all_tool_call_meta: Vec<serde_json::Value> = Vec::new();
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
            let mut fallback = last_response.unwrap_or_else(|| serde_json::json!({
                "content": "Tool execution reached the maximum number of rounds."
            }));
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

        let tool_calls = extract_chat_tool_calls(&response);
        if tool_calls.is_empty() {
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
                            assistant_name,
                            system_prompt,
                        ),
                    });
                }
                LocalAssistantActivationUpdate::Deactivate {
                    assistant_id: _,
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
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
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
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
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
                tool_call_meta.push(serde_json::json!({
                    "id": call.id,
                    "name": tool_name,
                    "status": "error",
                    "error_code": "CODE_MODE_APPROVAL_REQUIRED",
                    "error": error,
                }));
                realtime_emitter.emit_blocks(vec![serde_json::json!({
                    "id": format!("{}-tool-result", call_id),
                    "type": "tool_result",
                    "callId": call.id,
                    "toolName": tool_name,
                    "status": "error",
                    "result": {
                        "error": error,
                        "error_code": "CODE_MODE_APPROVAL_REQUIRED",
                    },
                })]);
                results.push(format!("Code Execution Blocked [CODE_MODE_APPROVAL_REQUIRED]: {}", error));
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
                        let meta = serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "success",
                            "result": res,
                        });
                        let mut streamed_blocks = Vec::new();
                        append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                        realtime_emitter.emit_blocks(streamed_blocks);
                        tool_call_meta.push(meta);
                        results.push(format!(
                            "Code Execution Result:\n{}",
                            res.result.join("\n")
                        ));
                    }
                    Err(err) => {
                        let meta = serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "error",
                            "error": err.to_string(),
                        });
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
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
            let query = call
                .arguments
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let search_res = build_local_sdk_search_result(app_state, query).await;
            synthesized = true;
            let meta = serde_json::json!({
                "id": call.id,
                "name": tool_name,
                "status": "success",
                "result": search_res,
            });
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
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
            let intent_query = call
                .arguments
                .get("intent_query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = call
                .arguments
                .get("k")
                .and_then(|v| v.as_u64())
                .map(|value| value as usize)
                .unwrap_or(3);
            let consult_res = build_local_consult_expert_network_result(
                app_state,
                intent_query,
                limit,
                active_assistant.map(|value| value.assistant_id.as_str()),
            )
            .await;
            synthesized = true;
            let meta = serde_json::json!({
                "id": call.id,
                "name": tool_name,
                "status": "success",
                "result": consult_res,
            });
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
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
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
                    let activated_assistant_name = state.assistant_name.clone();
                    let activated_system_prompt = state.system_prompt.clone();
                    let activated_skill_tools = state.skill_tools.clone();
                    let result = serde_json::json!({
                        "action": "activated",
                        "scope": "request",
                        "format_version": LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
                        "activation_mode": "replace",
                        "assistant_id": activated_assistant_id,
                        "assistant_name": activated_assistant_name,
                        "system_prompt": activated_system_prompt,
                        "skill_tools": activated_skill_tools,
                        "reason": reason,
                        "assistant_transition": {
                            "action": "activated",
                            "assistant_id": assistant_id,
                            "assistant_name": state.assistant_name.clone(),
                            "reason": reason,
                        },
                    });
                    synthesized = true;
                    let meta = serde_json::json!({
                        "id": call.id,
                        "name": tool_name,
                        "status": "success",
                        "result": result,
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Assistant '{}' activated for the current request.",
                        state.assistant_name
                    ));
                    assistant_update = Some(LocalAssistantActivationUpdate::Activate(state));

                    // Fire-and-forget: record bandit feedback for assistant activation
                    let bandit_store = app_state.providers.store.clone();
                    let bandit_assistant_id = activated_assistant_id.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = bandit_store
                            .record_feedback_simple(
                                "router:assistant",
                                &bandit_assistant_id,
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
                    let meta = serde_json::json!({
                        "id": call.id,
                        "name": tool_name,
                        "status": "error",
                        "error_code": "ASSISTANT_ACTIVATION_FAILED",
                        "error": err,
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!("Assistant activation failed: {}", err));
                    synthesized = true;

                    // Fire-and-forget: record bandit failure for assistant activation
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
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
            let reason = call
                .arguments
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("Explicit assistant deactivation requested by the model.");
            let result = serde_json::json!({
                "action": "deactivated",
                "scope": "request",
                "format_version": LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
                "assistant_id": active_assistant.map(|value| value.assistant_id.clone()),
                "assistant_name": active_assistant.map(|value| value.assistant_name.clone()),
                "reason": reason,
                "assistant_transition": {
                    "action": "deactivated",
                    "assistant_id": active_assistant.map(|value| value.assistant_id.clone()),
                    "assistant_name": active_assistant.map(|value| value.assistant_name.clone()),
                    "reason": reason,
                },
            });
            synthesized = true;
            let meta = serde_json::json!({
                "id": call.id,
                "name": tool_name,
                "status": "success",
                "result": result,
            });
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push("Assistant deactivated for the current request.".to_string());
            assistant_update = Some(LocalAssistantActivationUpdate::Deactivate {
                assistant_id: active_assistant.map(|value| value.assistant_id.clone()),
                assistant_name: active_assistant.map(|value| value.assistant_name.clone()),
            });
        } else if tool_name == "sys_submit_onboarding_request" {
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
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
                            let meta = serde_json::json!({
                                "id": call.id,
                                "name": tool_name,
                                "status": "success",
                                "result": {"action": "created", "id": id},
                            });
                            let mut streamed_blocks = Vec::new();
                            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                            realtime_emitter.emit_blocks(streamed_blocks);
                            tool_call_meta.push(meta);
                            results.push(format!("Assistant created successfully with ID: {}", id));
                        }
                        Err(err) => {
                            let meta = serde_json::json!({
                                "id": call.id,
                                "name": tool_name,
                                "status": "error",
                                "error": err.to_string(),
                            });
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
                        let meta = serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "success",
                            "result": result,
                        });
                        let mut streamed_blocks = Vec::new();
                        append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                        realtime_emitter.emit_blocks(streamed_blocks);
                        tool_call_meta.push(meta);
                        results.push(format!(
                            "Skill onboarding request executed:\n{}",
                            serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
                        ));
                    }
                    Err(err) => {
                        synthesized = true;
                        let meta = serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "error",
                            "error": err,
                        });
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
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
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

pub(crate) fn build_local_code_mode_entry_tools() -> serde_json::Value {
    serde_json::json!({
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "search_sdk",
                    "description": "Search Deeting SDK capabilities by intent and return typed signatures, parameter docs, and python stubs. Use before execute_code_plan. Prefer calling tools by generated stubs or `deeting.call_tool(name, **kwargs)`.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Natural language intent to search tools."
                            },
                            "limit": {
                                "type": "integer",
                                "description": "Max items to return (1-20).",
                                "default": 8
                            },
                            "include_schema": {
                                "type": "boolean",
                                "description": "Whether to include full JSON schema.",
                                "default": false
                            }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "consult_expert_network",
                    "description": "Search expert assistants by intent query and return top candidates. This tool only searches and does not switch persona context by itself.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "intent_query": {
                                "type": "string",
                                "description": "The intent or task description to search for expert assistants."
                            },
                            "k": {
                                "type": "integer",
                                "description": "Number of candidates to return.",
                                "default": 3
                            },
                            "confidence": {
                                "type": "number",
                                "description": "Model confidence in the routing decision (0-1).",
                                "default": 0
                            }
                        },
                        "required": ["intent_query", "confidence"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "activate_assistant",
                    "description": "Activate an assistant explicitly for the current request-scoped agent loop. This switches persona context only after an explicit activation call.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "assistant_id": {
                                "type": "string",
                                "description": "Assistant id returned by consult_expert_network."
                            },
                            "reason": {
                                "type": "string",
                                "description": "Optional reason for the activation decision."
                            }
                        },
                        "required": ["assistant_id"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "deactivate_assistant",
                    "description": "Deactivate the current request-scoped assistant and return to the default base assistant context.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "reason": {
                                "type": "string",
                                "description": "Optional reason for the deactivation."
                            }
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "execute_code_plan",
                    "description": "Execute a Python code plan in sandbox. Runtime exposes `deeting.log()`, `deeting.section()`, and `deeting.call_tool()`. SDK tool stubs are auto-injected based on your code: use `from deeting_sdk import <tool_name>` directly without calling search_sdk first (search_sdk is optional for discovery). Important: call tools with keyword args (`deeting.call_tool('tool-name', query='...')`), not positional dict args. Generate one coherent script, and always emit final structured output via `deeting.log(json.dumps(result, ensure_ascii=False))` instead of relying on top-level `return`.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "code": {
                                "type": "string",
                                "description": "Python code to execute."
                            },
                            "session_id": {
                                "type": "string",
                                "description": "Optional explicit session ID."
                            },
                            "language": {
                                "type": "string",
                                "description": "Execution language. Only python is supported.",
                                "default": "python"
                            },
                            "execution_timeout": {
                                "type": "integer",
                                "description": "Execution timeout hint in seconds.",
                                "default": 30
                            },
                            "dry_run": {
                                "type": "boolean",
                                "description": "Only validate code and return plan metadata without executing.",
                                "default": false
                            }
                        },
                        "required": ["code"]
                    }
                }
            }
        ]
    })
}

#[derive(Debug, Clone)]
enum LocalAssistantActivationUpdate {
    Activate(LocalAssistantActivationState),
    Deactivate {
        assistant_id: Option<String>,
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
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            request_id: request_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            emitted_execution_section: false,
            emitted_any: false,
        }
    }

    fn emit_execution_section_once(&mut self) {
        if self.emitted_execution_section {
            return;
        }
        self.emitted_execution_section = true;
        self.emit_blocks(vec![serde_json::json!({
            "type": "execution_section",
            "title": "Local Tool Actions"
        })]);
    }

    fn emit_blocks(&mut self, blocks: Vec<serde_json::Value>) {
        if blocks.is_empty() {
            return;
        }
        let Some(tx) = &self.tx else {
            return;
        };
        let mut payload = serde_json::json!({
            "type": "blocks",
            "blocks": blocks,
        });
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
    Some(crate::modules::code_mode::bridge::RuntimeBridgeStreamTarget {
        tx,
        trace_id: realtime_emitter.trace_id.clone(),
        request_id: realtime_emitter.request_id.clone(),
    })
}

async fn build_local_sdk_search_result(app_state: &AppState, query: &str) -> serde_json::Value {
    build_local_sdk_search_result_with_runtime(
        app_state.mcp.store.as_ref(),
        &app_state.providers.embedding,
        app_state.memory.service.as_ref(),
        query,
    )
    .await
}

pub(crate) async fn build_local_sdk_search_result_with_runtime(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query: &str,
) -> serde_json::Value {
    let normalized = query.trim().to_lowercase();
    let enabled_assistant_ids = mcp_store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let enabled_skill_ids = mcp_store
        .list_enabled_local_skill_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let mut install_hints = Vec::new();
    let mut assistant_install_filtered_count = 0usize;
    let mut skill_install_filtered_count = 0usize;

    let mut catalog = vec![
        serde_json::json!({
            "name": "execute_code_plan",
            "description": "Execute python code in local sandbox and bridge (auto mode requires dry_run=true for safety)",
            "source": "code_mode_core",
            "parameters": {
                "code": "string(required)",
                "language": "string(optional, default=python)",
                "execution_timeout": "number(optional)",
                "dry_run": "boolean(optional)",
            }
        }),
        serde_json::json!({
            "name": "search_sdk",
            "description": "Search tool signatures in local desktop runtime",
            "source": "code_mode_core",
            "parameters": {
                "query": "string(optional)",
            }
        }),
        serde_json::json!({
            "name": "sys_submit_onboarding_request",
            "description": "Deeting platform: install skills or assistants. For skill installation use asset_type='skill' and payload {repo_url, skill_name}. Skills are cloned to $APP_DATA_DIR/skills/<skill_id>/ and must contain deeting.json + llm-tool.yaml + main.py (NOT SKILL.md). Do NOT use opencode, codex, or openclaw paths.",
            "source": "code_mode_core",
            "parameters": {
                "asset_type": "string(required, oneof=assistant|skill)",
                "payload": "object(required)",
            }
        }),
    ];

    // Single Path Local Discovery via Unified Assets
    if !normalized.is_empty() {
        let mut asset_hits = Vec::new();
        if let Ok(vector) = embedding_service.embed_text(&normalized).await {
            if let Ok(hits) = memory_store.search_assets(vector, 15, None).await {
                asset_hits = hits;
            }
        }
        if asset_hits.is_empty() {
            if let Ok(all_assets) = memory_store.list_assets_catalog().await {
                asset_hits = lexical_rank_asset_hits(&normalized, all_assets, 15);
            }
        }

        for hit in asset_hits {
            let source_type = hit
                .get("source_type")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let asset_type = hit
                .get("asset_type")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let name = hit["name"].as_str().unwrap_or("").to_string();
            let desc = hit["description"].as_str().unwrap_or("").to_string();
            let pkg_name = hit.get("pkg_name").and_then(|v| v.as_str());
            let asset_id = hit["id"].as_str().unwrap_or("").trim();
            let is_enabled_installed = if asset_type == "assistant" {
                !asset_id.is_empty() && enabled_assistant_ids.contains(asset_id)
            } else if asset_type == "tool" {
                pkg_name
                    .map(|pkg| enabled_skill_ids.contains(pkg.trim()))
                    .unwrap_or(true)
            } else {
                true
            };

            let item = serde_json::json!({
                "name": name,
                "description": desc,
                "source": format!("local_{}", source_type),
                "pkg_name": pkg_name,
                "score": hit.get("_distance"),
                "needs_provisioning": source_type == "cloud_mirror",
                "asset_type": hit.get("asset_type"),
                "callable": source_type != "cloud_mirror" && is_enabled_installed,
                "assistant_id": if asset_type == "assistant" { Some(asset_id) } else { None::<&str> },
            });

            if source_type == "cloud_mirror" {
                install_hints.push(item);
                continue;
            }

            if !is_enabled_installed {
                if asset_type == "assistant" {
                    assistant_install_filtered_count += 1;
                } else if asset_type == "tool" {
                    skill_install_filtered_count += 1;
                }
                continue;
            }

            catalog.push(item);
        }
    }

    // Keep memory core tools always visible
    catalog.push(serde_json::json!({
        "name": "list_user_memories",
        "description": "List local memories for current desktop session",
        "source": "code_mode_bridge",
    }));

    let matches = catalog
        .into_iter()
        .filter(|item| {
            if normalized.is_empty() {
                return true;
            }
            let name_hit = item
                .get("name")
                .and_then(|v| v.as_str())
                .map(|n| n.to_lowercase().contains(&normalized))
                .unwrap_or(false);
            let desc_hit = item
                .get("description")
                .and_then(|v| v.as_str())
                .map(|d| d.to_lowercase().contains(&normalized))
                .unwrap_or(false);
            name_hit || desc_hit || item.get("score").is_some()
        })
        .collect::<Vec<_>>();

    let usage_hint = "先根据参数文档和 python_stub 规划步骤，再调用 execute_code_plan 一次性执行。脚本内优先 `from deeting_sdk import tool_name` 或 `deeting.call_tool(name, **kwargs)`；不要写 `deeting.call_tool(name, { ... })`。最后请用 `deeting.log(json.dumps(result, ensure_ascii=False))` 输出结构化结果。";

    serde_json::json!({
        "format_version": "sdk_toolcard.v2",
        "runtime_protocol_version": crate::modules::code_mode::contract::RUNTIME_PROTOCOL_VERSION,
        "query": query,
        "mode": "code_mode",
        "count": matches.len(),
        "tools": matches.clone(),
        "items": matches,
        "usage_hint": usage_hint,
        "install_hints": install_hints,
        "assistant_install_gate": {
            "enabled_installed_count": enabled_assistant_ids.len(),
            "filtered_out_count": assistant_install_filtered_count,
        },
        "skill_install_gate": {
            "enabled_installed_count": enabled_skill_ids.len(),
            "filtered_out_count": skill_install_filtered_count,
        }
    })
}

#[tauri::command]
pub async fn get_local_gateway_url(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let url = state.mcp.local_gateway.base_url.read().await.clone();
    Ok(url)
}
