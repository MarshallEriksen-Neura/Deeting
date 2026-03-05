#[tauri::command]
pub async fn update_assistant_message(
    _state: State<'_, AppState>,
    _id: String,
    _content: String,
) -> Result<LocalAssistantMessage, String> {
    Err("update assistant message is not supported in local store".to_string())
}

#[tauri::command]
pub async fn delete_assistant_message(
    _state: State<'_, AppState>,
    _id: String,
) -> Result<(), String> {
    Err("delete assistant message by message id is not supported in local store".to_string())
}

#[tauri::command]
pub async fn list_local_conversation_sessions(
    state: State<'_, AppState>,
    query: LocalConversationSessionsQuery,
) -> Result<LocalConversationSessionPage, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_conversations(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_conversation_window(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationWindowResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_conversation_window(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_conversation_session(
    state: State<'_, AppState>,
    payload: LocalConversationCreateRequest,
) -> Result<LocalConversationCreateResponse, String> {
    let state = &state.mcp;
    state
        .store
        .create_local_conversation(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn rename_local_conversation_session(
    state: State<'_, AppState>,
    session_id: String,
    payload: LocalConversationRenameRequest,
) -> Result<LocalConversationRenameResponse, String> {
    let state = &state.mcp;
    state
        .store
        .rename_local_conversation(&session_id, payload.title)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_conversation_session(
    _state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationDeleteResponse, String> {
    Err(format!(
        "delete conversation session is not supported, use close/archive instead: {}",
        session_id
    ))
}

#[tauri::command]
pub async fn archive_local_conversation_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    let state = &state.mcp;
    state
        .store
        .update_local_conversation_status(&session_id, LocalConversationStatus::Archived)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn clear_local_conversation_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationClearResponse, String> {
    let state = &state.mcp;
    state
        .store
        .clear_local_conversation(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversation_history(
    state: State<'_, AppState>,
    query: LocalConversationHistoryQuery,
) -> Result<LocalConversationHistoryResponse, String> {
    let state = &state.mcp;
    let session_id = query
        .session_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "session_id is required".to_string())?;
    state
        .store
        .get_local_conversation_history(&session_id, query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn send_local_conversation_message(
    app: AppHandle,
    app_state: State<'_, AppState>,
    payload: LocalConversationSendRequest,
) -> Result<LocalConversationSendResponse, String> {
    let state = &app_state.mcp;
    let trace_id = Uuid::new_v4().to_string();
    let request_id = payload
        .request_id
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    emit_local_chat_stream_status(
        &app,
        request_id.as_deref(),
        &trace_id,
        "listen",
        "template.rendered",
        Some(serde_json::json!({
            "engine": "desktop_local",
            "session_id": payload.session_id,
        })),
    );

    let execution = if let Some(request_id_value) = request_id.clone() {
        let app_clone = app.clone();
        let app_state_clone = app_state.inner().clone();
        let payload_clone = payload.clone();
        let trace_id_clone = trace_id.clone();
        let request_id_clone = request_id_value.clone();
        let task = tokio::spawn(async move {
            send_local_conversation_message_inner(
                &app_clone,
                &app_state_clone,
                &payload_clone,
                &trace_id_clone,
                Some(request_id_clone.as_str()),
            )
            .await
        });
        register_local_chat_task_abort_handle(
            state.local_chat_tasks.as_ref(),
            &request_id_value,
            task.abort_handle(),
        )
        .await;

        let join_result = task.await;
        clear_local_chat_task_abort_handle(state.local_chat_tasks.as_ref(), &request_id_value)
            .await;
        match join_result {
            Ok(result) => result,
            Err(err) if err.is_cancelled() => {
                Err("local conversation request cancelled by user".to_string())
            }
            Err(err) => Err(format!("local conversation task join error: {}", err)),
        }
    } else {
        send_local_conversation_message_inner(&app, app_state.inner(), &payload, &trace_id, None)
            .await
    };

    match execution {
        Ok(response) => {
            emit_local_chat_stream_done(&app, request_id.as_deref(), &trace_id);
            Ok(response)
        }
        Err(err) => {
            emit_local_chat_stream_error(&app, request_id.as_deref(), &trace_id, &err);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn regenerate_local_conversation_reply(
    app: AppHandle,
    app_state: State<'_, AppState>,
    payload: LocalConversationRegenerateRequest,
) -> Result<LocalConversationRegenerateResponse, String> {
    let state = &app_state.mcp;
    let trace_id = Uuid::new_v4().to_string();
    let request_id = payload
        .request_id
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    emit_local_chat_stream_status(
        &app,
        request_id.as_deref(),
        &trace_id,
        "listen",
        "template.rendered",
        Some(serde_json::json!({
            "engine": "desktop_local",
            "session_id": payload.session_id,
        })),
    );

    let execution = if let Some(request_id_value) = request_id.clone() {
        let app_clone = app.clone();
        let app_state_clone = app_state.inner().clone();
        let payload_clone = payload.clone();
        let trace_id_clone = trace_id.clone();
        let request_id_clone = request_id_value.clone();
        let task = tokio::spawn(async move {
            regenerate_local_conversation_reply_inner(
                &app_clone,
                &app_state_clone,
                &payload_clone,
                &trace_id_clone,
                Some(request_id_clone.as_str()),
            )
            .await
        });
        register_local_chat_task_abort_handle(
            state.local_chat_tasks.as_ref(),
            &request_id_value,
            task.abort_handle(),
        )
        .await;

        let join_result = task.await;
        clear_local_chat_task_abort_handle(state.local_chat_tasks.as_ref(), &request_id_value)
            .await;
        match join_result {
            Ok(result) => result,
            Err(err) if err.is_cancelled() => {
                Err("local conversation request cancelled by user".to_string())
            }
            Err(err) => Err(format!("local conversation task join error: {}", err)),
        }
    } else {
        regenerate_local_conversation_reply_inner(
            &app,
            app_state.inner(),
            &payload,
            &trace_id,
            None,
        )
        .await
    };

    match execution {
        Ok(response) => {
            emit_local_chat_stream_done(&app, request_id.as_deref(), &trace_id);
            Ok(response)
        }
        Err(err) => {
            emit_local_chat_stream_error(&app, request_id.as_deref(), &trace_id, &err);
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn cancel_local_conversation_request(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<LocalConversationCancelResponse, String> {
    let normalized_request_id = request_id.trim().to_string();
    if normalized_request_id.is_empty() {
        return Err("request_id is required".to_string());
    }

    let canceled = abort_local_chat_task_by_request_id(
        state.mcp.local_chat_tasks.as_ref(),
        &normalized_request_id,
    )
    .await;

    Ok(LocalConversationCancelResponse {
        request_id: normalized_request_id,
        status: if canceled {
            "cancelled".to_string()
        } else {
            "not_found".to_string()
        },
    })
}

async fn send_local_conversation_message_inner(
    app: &AppHandle,
    app_state: &AppState,
    payload: &LocalConversationSendRequest,
    trace_id: &str,
    request_id: Option<&str>,
) -> Result<LocalConversationSendResponse, String> {
    let provider_request_started_at = std::time::Instant::now();

    crate::modules::providers::model_guard::ensure_required_local_models_configured(app_state)
        .await?;

    let conversation_repo = &app_state.mcp.store;
    let session_id = payload.session_id.clone();
    let user_message = conversation_repo
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: session_id.clone(),
            role: "user".to_string(),
            content: payload.content.clone(),
            name: None,
            meta_info: None,
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map_err(to_string)?;
    let chat_ctx = conversation_repo
        .get_local_conversation_chat_context(&session_id)
        .await
        .map_err(to_string)?;

    emit_local_chat_stream_status(
        app,
        request_id,
        trace_id,
        "remember",
        "context.loaded",
        Some(serde_json::json!({
            "count": chat_ctx.messages.len(),
            "has_summary": false,
            "assistant_id": chat_ctx.assistant_id,
            "provider_model_id": payload.provider_model_id,
        })),
    );

    let model_connection = resolve_local_model_connection(
        app_state,
        &payload.model,
        payload.provider_model_id.as_deref(),
    )
    .await
    .map_err(to_string)?;

    emit_local_chat_stream_status(
        app,
        request_id,
        trace_id,
        "remember",
        "routing.selected",
        Some(serde_json::json!({
            "candidates": 1,
            "provider": model_connection.model_id,
            "provider_model_id": model_connection.provider_model_id,
            "model_id": model_connection.model_id,
        })),
    );
    emit_local_chat_stream_status(
        app,
        request_id,
        trace_id,
        "evolve",
        "upstream.request.batch",
        None,
    );

    let response_json = run_local_chat_complete_with_auto_code_mode(
        app,
        app_state,
        &model_connection,
        chat_ctx.messages.clone(),
        &chat_ctx,
    )
    .await?;

    let response_text = response_json["content"].as_str().unwrap_or("").to_string();

    emit_local_chat_stream_status(
        app,
        request_id,
        trace_id,
        "render",
        "upstream.streaming",
        None,
    );
    let assistant_blocks =
        emit_and_collect_local_assistant_blocks(app, request_id, trace_id, &response_json, &response_text);
    emit_local_chat_stream_status(
        app,
        request_id,
        trace_id,
        "render",
        "upstream.response",
        Some(serde_json::json!({
            "latency_ms": provider_request_started_at.elapsed().as_millis() as i64,
        })),
    );

    let assistant_message = conversation_repo
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: session_id.clone(),
            role: "assistant".to_string(),
            content: response_text.clone(),
            name: None,
            meta_info: if assistant_blocks.is_empty() {
                None
            } else {
                Some(serde_json::json!({
                    "blocks": assistant_blocks
                }))
            },
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map_err(to_string)?;

    let _ = conversation_repo
        .touch_local_conversation_summary_idle_task(&session_id)
        .await;

    Ok(LocalConversationSendResponse {
        session_id,
        user_message,
        assistant_message,
    })
}

async fn regenerate_local_conversation_reply_inner(
    app: &AppHandle,
    app_state: &AppState,
    payload: &LocalConversationRegenerateRequest,
    trace_id: &str,
    request_id: Option<&str>,
) -> Result<LocalConversationRegenerateResponse, String> {
    let provider_request_started_at = std::time::Instant::now();

    crate::modules::providers::model_guard::ensure_required_local_models_configured(app_state)
        .await?;

    let conversation_repo = &app_state.mcp.store;
    let regenerate_ctx = conversation_repo
        .prepare_local_conversation_regenerate(&payload.session_id)
        .await
        .map_err(to_string)?;

    let model_connection = resolve_local_model_connection(
        app_state,
        &payload.model,
        payload.provider_model_id.as_deref(),
    )
    .await
    .map_err(to_string)?;
    let chat_ctx = LocalConversationChatContext {
        session_id: regenerate_ctx.session_id.clone(),
        assistant_id: regenerate_ctx.assistant_id.clone(),
        messages: regenerate_ctx.messages.clone(),
    };
    emit_local_chat_stream_status(
        app,
        request_id,
        trace_id,
        "remember",
        "context.loaded",
        Some(serde_json::json!({
            "count": chat_ctx.messages.len(),
            "has_summary": false,
            "assistant_id": chat_ctx.assistant_id,
        })),
    );

    emit_local_chat_stream_status(
        app,
        request_id,
        trace_id,
        "remember",
        "routing.selected",
        Some(serde_json::json!({
            "candidates": 1,
            "provider": model_connection.model_id,
            "provider_model_id": model_connection.provider_model_id,
            "model_id": model_connection.model_id,
        })),
    );
    emit_local_chat_stream_status(
        app,
        request_id,
        trace_id,
        "evolve",
        "upstream.request.batch",
        None,
    );

    let response_json = run_local_chat_complete_with_auto_code_mode(
        app,
        app_state,
        &model_connection,
        regenerate_ctx.messages,
        &chat_ctx,
    )
    .await?;

    let response_text = response_json["content"].as_str().unwrap_or("").to_string();

    emit_local_chat_stream_status(
        app,
        request_id,
        trace_id,
        "render",
        "upstream.streaming",
        None,
    );
    let assistant_blocks =
        emit_and_collect_local_assistant_blocks(app, request_id, trace_id, &response_json, &response_text);
    emit_local_chat_stream_status(
        app,
        request_id,
        trace_id,
        "render",
        "upstream.response",
        Some(serde_json::json!({
            "latency_ms": provider_request_started_at.elapsed().as_millis() as i64,
        })),
    );

    let assistant_message = conversation_repo
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: payload.session_id.clone(),
            role: "assistant".to_string(),
            content: response_text,
            name: None,
            meta_info: if assistant_blocks.is_empty() {
                None
            } else {
                Some(serde_json::json!({
                    "blocks": assistant_blocks
                }))
            },
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map_err(to_string)?;
    let _ = conversation_repo
        .touch_local_conversation_summary_idle_task(&payload.session_id)
        .await;

    Ok(LocalConversationRegenerateResponse {
        session_id: payload.session_id.clone(),
        deleted_turn_index: regenerate_ctx.deleted_turn_index,
        message: assistant_message,
    })
}

fn emit_and_collect_local_assistant_blocks(
    app: &AppHandle,
    request_id: Option<&str>,
    trace_id: &str,
    response_json: &serde_json::Value,
    response_text: &str,
) -> Vec<serde_json::Value> {
    let mut blocks = Vec::new();

    if let Some(tool_trace_blocks) = response_json
        .get("tool_trace_blocks")
        .and_then(|value| value.as_array())
        .filter(|arr| !arr.is_empty())
    {
        let trace_blocks = tool_trace_blocks.to_vec();
        emit_local_chat_stream_blocks(
            app,
            request_id,
            trace_id,
            serde_json::Value::Array(trace_blocks.clone()),
        );
        blocks.extend(trace_blocks);
    }

    emit_local_chat_stream_delta_chunks(app, request_id, trace_id, response_text);
    if !response_text.trim().is_empty() {
        let text_block = serde_json::json!({
            "type": "text",
            "content": response_text
        });
        emit_local_chat_stream_blocks(
            app,
            request_id,
            trace_id,
            serde_json::Value::Array(vec![text_block.clone()]),
        );
        blocks.push(text_block);
    }

    blocks
}

async fn register_local_chat_task_abort_handle(
    local_chat_tasks: &tokio::sync::RwLock<HashMap<String, tokio::task::AbortHandle>>,
    request_id: &str,
    abort_handle: tokio::task::AbortHandle,
) {
    local_chat_tasks
        .write()
        .await
        .insert(request_id.to_string(), abort_handle);
}

async fn clear_local_chat_task_abort_handle(
    local_chat_tasks: &tokio::sync::RwLock<HashMap<String, tokio::task::AbortHandle>>,
    request_id: &str,
) {
    local_chat_tasks.write().await.remove(request_id);
}

async fn abort_local_chat_task_by_request_id(
    local_chat_tasks: &tokio::sync::RwLock<HashMap<String, tokio::task::AbortHandle>>,
    request_id: &str,
) -> bool {
    let removed = local_chat_tasks.write().await.remove(request_id);
    if let Some(abort_handle) = removed {
        abort_handle.abort();
        true
    } else {
        false
    }
}

#[tauri::command]
pub async fn import_mcp_config(
    app_state: State<'_, AppState>,
    payload: ImportConfigRequest,
) -> Result<Vec<McpTool>, String> {
    let state = &app_state.mcp;
    let source = if let Some(source_id) = payload.source_id {
        state
            .store
            .get_source(&source_id)
            .await
            .map_err(to_string)?
            .ok_or_else(|| to_string(McpError::NotFound(format!("source {source_id} not found"))))?
    } else {
        state.store.ensure_local_source().await.map_err(to_string)?
    };

    let tools = apply_config_payload(&state, &source, payload.config)
        .await
        .map_err(to_string)?;

    // Background indexing for semantic search
    let app_state_clone = app_state.inner().clone();
    let tools_clone = tools.clone();
    tauri::async_runtime::spawn(async move {
        let _ = index_mcp_tools(&app_state_clone, &tools_clone).await;
    });

    Ok(tools)
}

#[tauri::command]
pub async fn start_mcp_tool(
    _app: AppHandle,
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<Value, String> {
    let state = &state.mcp;
    let tool = state
        .store
        .get_tool(&tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", tool_id))?;

    if tool.command.is_none() {
        return Err("tool is not executable (no command)".to_string());
    }

    let risk = state.assess_tool_risk(&tool, &serde_json::json!({}));
    if risk.requires_approval {
        return Err(format!(
            "starting tool '{}' is blocked without explicit approval flow (risk={}): {}",
            tool.name,
            risk.risk_level,
            risk.reasons.join("; ")
        ));
    }

    state
        .process_manager
        .start_tool(tool, true)
        .await
        .map_err(to_string)?;

    Ok(serde_json::json!({
        "status": "STARTED",
        "tool_id": tool_id,
    }))
}

#[tauri::command]
pub async fn stop_mcp_tool(state: State<'_, AppState>, tool_id: String) -> Result<(), String> {
    let state = &state.mcp;
    state
        .process_manager
        .stop_tool(&tool_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn execute_mcp_tool_raw(
    _app: AppHandle,
    state: State<'_, AppState>,
    tool_name: String,
    arguments: Value,
    call_id: Option<String>,
    #[allow(non_snake_case)] callId: Option<String>,
    execution_token: Option<String>,
    #[allow(non_snake_case)] executionToken: Option<String>,
) -> Result<Value, String> {
    let normalized_tool_name = tool_name.trim().to_string();
    if normalized_tool_name.is_empty() {
        return Err("tool name is required".to_string());
    }

    let tool = state
        .mcp
        .store
        .get_tool_by_name(&normalized_tool_name)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", normalized_tool_name))?;

    let risk = state.mcp.assess_tool_risk(&tool, &arguments);
    let approval_context = state.mcp.build_approval_context(
        call_id.or(callId).as_deref(),
        execution_token.or(executionToken).as_deref(),
    );

    execute_or_queue_mcp_tool_call_with_context(
        &approval_context,
        Some(risk.risk_level),
        risk.reasons,
        Some(&state.mcp),
        state.mcp.store.as_ref(),
        state.mcp.pending_tool_calls.as_ref(),
        normalized_tool_name,
        arguments,
        risk.requires_approval,
    )
    .await
}

#[tauri::command]
pub async fn update_mcp_tool_env(
    state: State<'_, AppState>,
    tool_id: String,
    payload: UpdateToolConfigRequest,
) -> Result<(), String> {
    let state = &state.mcp;
    if payload.apply_pending {
        state
            .store
            .clear_pending_update(&tool_id)
            .await
            .map_err(to_string)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn apply_pending_config(
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .clear_pending_update(&tool_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn resolve_mcp_conflict(
    _state: State<'_, AppState>,
    _payload: ResolveConflictRequest,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn get_mcp_logs(
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<Vec<Value>, String> {
    let state = &state.mcp;
    let logs = state.process_manager.logs(&tool_id).await;
    Ok(logs.into_iter().map(|l| serde_json::json!(l)).collect())
}

#[tauri::command]
pub async fn clear_mcp_logs(state: State<'_, AppState>, tool_id: String) -> Result<(), String> {
    let state = &state.mcp;
    state.process_manager.clear_logs(&tool_id).await;
    Ok(())
}
