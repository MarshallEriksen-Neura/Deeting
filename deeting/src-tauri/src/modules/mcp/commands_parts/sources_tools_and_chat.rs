use super::{
    assistants_knowledge_admin_impl::{index_mcp_tools, reindex_desktop_tool_asset},
    common_impl::to_string,
    runtime::{
        apply_config_payload, execute_or_queue_mcp_tool_call_with_tool_ref, now_rfc3339,
        resolve_callable_mcp_tool_by_ref,
    },
    support::*,
};

const FACT_EXTRACTION_NEW_CHAT_TRIGGER_KEY_PREFIX: &str = "fact_extraction.new_chat_triggered";
const FACT_EXTRACTION_MIN_MESSAGES: usize = 2;

fn build_fact_extraction_new_chat_marker_key(session_id: &str) -> String {
    format!(
        "{}.{}",
        FACT_EXTRACTION_NEW_CHAT_TRIGGER_KEY_PREFIX,
        session_id
    )
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn extract_last_model_pair(meta: Option<&Value>) -> Option<(String, String)> {
    let provider_model_id = normalize_optional_string(
        meta.and_then(|value| value.get("last_provider_model_id"))
            .and_then(|value| value.as_str()),
    )?;
    let model_id = normalize_optional_string(
        meta.and_then(|value| value.get("last_model_id"))
            .and_then(|value| value.as_str()),
    )?;
    Some((provider_model_id, model_id))
}

fn history_message_text(content: Option<&Value>) -> Option<String> {
    content
        .and_then(|value| {
            if let Some(text) = value.as_str() {
                Some(text.to_string())
            } else {
                serde_json::to_string(value).ok()
            }
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn extract_summary_text(summary: Option<&Value>) -> Option<String> {
    summary
        .and_then(|value| value.get("summary_text"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn build_fact_extraction_conversation_text(
    runtime_window: &crate::modules::mcp::store::LocalConversationRuntimeWindow,
) -> Option<String> {
    let mut sections = Vec::new();
    if let Some(summary_text) = extract_summary_text(runtime_window.summary.as_ref()) {
        sections.push(format!("Summary: {}", summary_text));
    }

    for message in &runtime_window.messages {
        let Some(content) = history_message_text(message.content.as_ref()) else {
            continue;
        };
        let role = match message.role.trim().to_ascii_lowercase().as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            "system" => "System",
            _ => "Message",
        };
        sections.push(format!("{}: {}", role, content));
    }

    let conversation = sections.join("\n").trim().to_string();
    if conversation.is_empty() {
        None
    } else {
        Some(conversation)
    }
}

async fn trigger_fact_extraction_once_on_new_chat(app_state: AppState, session_id: String) {
    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() {
        return;
    }

    let marker_key = build_fact_extraction_new_chat_marker_key(&normalized_session_id);
    match app_state.mcp.store.get_desktop_config(&marker_key).await {
        Ok(Some(value)) if value.trim() == "1" => return,
        Ok(_) => {}
        Err(err) => {
            warn!(
                "fact extraction new-chat marker read failed session={} err={}",
                normalized_session_id, err
            );
            return;
        }
    }

    let runtime_window = match app_state
        .mcp
        .store
        .load_local_conversation_runtime_window(&normalized_session_id)
        .await
    {
        Ok(value) => value,
        Err(err) => {
            warn!(
                "fact extraction new-chat load runtime window failed session={} err={}",
                normalized_session_id, err
            );
            return;
        }
    };

    if runtime_window.messages.len() < FACT_EXTRACTION_MIN_MESSAGES {
        return;
    }

    let Some((provider_model_id, model_id)) = extract_last_model_pair(runtime_window.meta.as_ref())
    else {
        return;
    };
    let Some(conversation_text) = build_fact_extraction_conversation_text(&runtime_window) else {
        return;
    };

    if let Err(err) = app_state.mcp.store.set_desktop_config(&marker_key, "1").await {
        warn!(
            "fact extraction new-chat marker write failed session={} err={}",
            normalized_session_id, err
        );
        return;
    }

    crate::modules::memory::fact_extractor::extract_and_store_facts(
        &app_state,
        app_state.memory.service.clone(),
        &provider_model_id,
        &model_id,
        &conversation_text,
        &normalized_session_id,
        runtime_window.assistant_id.as_deref(),
    )
    .await;
}

pub(crate) fn build_remote_transport_log_entries(tool: &McpTool) -> Vec<McpLogEntry> {
    vec![McpLogEntry {
        timestamp: now_rfc3339(),
        stream: McpLogStream::Event,
        message: format!(
            "Remote {} transport does not expose a local process log stream.",
            tool.transport_label()
        ),
    }]
}

pub(crate) async fn start_remote_transport_tool(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
) -> Result<Value, String> {
    store
        .set_tool_status(&tool.id, McpToolStatus::Healthy, None, None)
        .await
        .map_err(to_string)?;
    Ok(serde_json::json!({
        "status": "REMOTE_READY",
        "tool_id": tool.id,
        "transport": tool.transport_label(),
    }))
}

pub(crate) async fn stop_remote_transport_tool(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
) -> Result<(), String> {
    store
        .set_tool_status(&tool.id, McpToolStatus::Stopped, None, None)
        .await
        .map_err(to_string)
}

pub(crate) async fn start_mcp_tool_inner(
    state: &McpRuntimeState,
    tool_id: &str,
) -> Result<Value, String> {
    let tool = state
        .store
        .get_tool(tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", tool_id))?;

    if tool.is_remote_sse() {
        return start_remote_transport_tool(state.store.as_ref(), &tool).await;
    }

    if !tool.supports_local_process_lifecycle() {
        return Err(format!(
            "tool is not executable for transport '{}'",
            tool.transport_label()
        ));
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
        "transport": "stdio",
    }))
}

pub(crate) async fn stop_mcp_tool_inner(
    state: &McpRuntimeState,
    tool_id: &str,
) -> Result<(), String> {
    let tool = state
        .store
        .get_tool(tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", tool_id))?;

    if tool.is_remote_sse() {
        return stop_remote_transport_tool(state.store.as_ref(), &tool).await;
    }

    state
        .process_manager
        .stop_tool(&tool.id)
        .await
        .map_err(to_string)
}

pub(crate) async fn get_mcp_logs_inner(
    state: &McpRuntimeState,
    tool_id: &str,
) -> Result<Vec<Value>, String> {
    let tool = state
        .store
        .get_tool(tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", tool_id))?;

    let logs = if tool.is_remote_sse() {
        build_remote_transport_log_entries(&tool)
    } else {
        state.process_manager.logs(&tool.id).await
    };

    Ok(logs
        .into_iter()
        .map(|entry| serde_json::json!(entry))
        .collect())
}

pub(crate) async fn clear_mcp_logs_inner(
    state: &McpRuntimeState,
    tool_id: &str,
) -> Result<(), String> {
    let tool = state
        .store
        .get_tool(tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", tool_id))?;

    if tool.is_remote_sse() {
        return Ok(());
    }

    state.process_manager.clear_logs(&tool.id).await;
    Ok(())
}

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
    let app_state = state.inner().clone();
    let previous_session_id = app_state
        .mcp
        .store
        .find_latest_local_fact_extraction_candidate_session()
        .await
        .map_err(to_string)?;

    let created = app_state
        .mcp
        .store
        .create_local_conversation(payload)
        .await
        .map_err(to_string)?;

    if let Some(session_id) = previous_session_id {
        let fact_state = app_state.clone();
        tauri::async_runtime::spawn(async move {
            trigger_fact_extraction_once_on_new_chat(fact_state, session_id).await;
        });
    }

    Ok(created)
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
    let result = start_mcp_tool_inner(&state.mcp, &tool_id).await?;
    if let Some(tool) = state
        .mcp
        .store
        .get_tool(&tool_id)
        .await
        .map_err(to_string)?
    {
        let _ = reindex_desktop_tool_asset(state.inner(), &tool).await;
    }
    Ok(result)
}

#[tauri::command]
pub async fn stop_mcp_tool(state: State<'_, AppState>, tool_id: String) -> Result<(), String> {
    stop_mcp_tool_inner(&state.mcp, &tool_id).await
}

#[tauri::command]
pub async fn delete_local_mcp_tool(
    _app: AppHandle,
    state: State<'_, AppState>,
    tool_id: String,
) -> Result<(), String> {
    let tool = state
        .mcp
        .store
        .get_tool(&tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", tool_id))?;

    if tool.supports_local_process_lifecycle() {
        let _ = state.mcp.process_manager.stop_tool(&tool.id).await;
    }

    let source_id = tool.source_id.clone();
    let sibling_count = match source_id.as_deref() {
        Some(current_source_id) => state
            .mcp
            .store
            .list_tools()
            .await
            .map_err(to_string)?
            .into_iter()
            .filter(|item| item.source_id.as_deref() == Some(current_source_id))
            .count(),
        None => 0,
    };

    state
        .mcp
        .store
        .delete_tools_by_ids(&[tool.id.clone()])
        .await
        .map_err(to_string)?;

    if sibling_count <= 1 {
        if let Some(source_id) = source_id.as_deref() {
            state
                .mcp
                .store
                .delete_source(source_id)
                .await
                .map_err(to_string)?;
            state
                .memory
                .service
                .delete_assets_by_package(source_id)
                .await
                .map_err(to_string)?;
        } else {
            state
                .memory
                .service
                .delete_assets_by_ids(&[tool.id.clone()])
                .await
                .map_err(to_string)?;
        }
    } else {
        state
            .memory
            .service
            .delete_assets_by_ids(&[tool.id.clone()])
            .await
            .map_err(to_string)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn execute_mcp_tool_raw(
    _app: AppHandle,
    state: State<'_, AppState>,
    tool_id: Option<String>,
    #[allow(non_snake_case)] toolId: Option<String>,
    tool_name: Option<String>,
    #[allow(non_snake_case)] toolName: Option<String>,
    arguments: Value,
    call_id: Option<String>,
    #[allow(non_snake_case)] callId: Option<String>,
    execution_token: Option<String>,
    #[allow(non_snake_case)] executionToken: Option<String>,
) -> Result<Value, String> {
    let normalized_tool_id = tool_id
        .or(toolId)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let normalized_tool_name = tool_name
        .or(toolName)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let tool = resolve_callable_mcp_tool_by_ref(
        state.mcp.store.as_ref(),
        normalized_tool_id.as_deref(),
        normalized_tool_name.as_deref(),
    )
    .await
    .map_err(|err| err.to_string())?;

    let risk = state.mcp.assess_tool_risk(&tool, &arguments);
    let approval_context = state.mcp.build_approval_context(
        call_id.or(callId).as_deref(),
        execution_token.or(executionToken).as_deref(),
    );

    execute_or_queue_mcp_tool_call_with_tool_ref(
        &approval_context,
        Some(risk.risk_level),
        risk.reasons,
        Some(&state.mcp),
        state.mcp.store.as_ref(),
        state.mcp.pending_tool_calls.as_ref(),
        Some(tool.id),
        Some(tool.name),
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
    get_mcp_logs_inner(&state.mcp, &tool_id).await
}

#[tauri::command]
pub async fn clear_mcp_logs(state: State<'_, AppState>, tool_id: String) -> Result<(), String> {
    clear_mcp_logs_inner(&state.mcp, &tool_id).await
}

#[tauri::command]
pub async fn get_desktop_config_value(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    state
        .mcp
        .store
        .get_desktop_config(key.trim())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn set_desktop_config_value(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("desktop config key is required".to_string());
    }
    state
        .mcp
        .store
        .set_desktop_config(key, value.trim())
        .await
        .map_err(to_string)
}
