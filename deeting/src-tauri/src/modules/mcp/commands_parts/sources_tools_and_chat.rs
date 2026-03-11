use super::{
    assistants_knowledge_admin_impl::{index_mcp_tools, reindex_desktop_tool_asset},
    common_impl::to_string,
    runtime::{
        apply_config_payload, execute_or_queue_mcp_tool_call_with_tool_ref, now_rfc3339,
        resolve_callable_mcp_tool_by_ref,
    },
    skill_registry_impl::uninstall_local_skill,
    support::*,
};

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

fn derive_backing_skill_id(raw: Option<&str>) -> Option<&str> {
    let normalized = raw?.trim();
    if !normalized.starts_with("skill.") {
        return None;
    }
    Some(normalized.split('/').next().unwrap_or(normalized))
}

#[tauri::command]
pub async fn delete_local_mcp_tool(
    app: AppHandle,
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

    if let Some(skill_id) = derive_backing_skill_id(tool.identifier.as_deref()) {
        return uninstall_local_skill(&app, state.inner(), skill_id).await;
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
