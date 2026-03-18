use super::{
    common_impl::to_string,
    runtime::{
        apply_config_payload, build_desktop_mcp_tool_views,
        execute_or_queue_mcp_tool_call_with_tool_ref, now_rfc3339,
        resolve_callable_mcp_tool_by_ref,
        DesktopMcpToolView,
    },
    support::*,
};
use crate::modules::knowledge::tool_index::{
    delete_mcp_tool_assets, index_mcp_tools, list_indexed_mcp_tool_ids,
    reindex_desktop_tool_asset,
};
use crate::modules::skill_runtime::resolve_skill_binding_by_ref;

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
pub async fn list_mcp_tools(state: State<'_, AppState>) -> Result<Vec<DesktopMcpToolView>, String> {
    let indexed_tool_ids = match list_indexed_mcp_tool_ids(state.inner()).await {
        Ok(ids) => Some(ids),
        Err(err) => {
            warn!("failed to read local MCP asset index status: {}", err);
            None
        }
    };

    build_desktop_mcp_tool_views(&state.mcp.store, indexed_tool_ids.as_ref()).await
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
        }
    }

    delete_mcp_tool_assets(state.inner(), &tool.id, source_id.as_deref(), sibling_count <= 1)
        .await?;

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

    let approval_context = state.mcp.build_approval_context(
        call_id.or(callId).as_deref(),
        execution_token.or(executionToken).as_deref(),
        None,
    );
    match resolve_callable_mcp_tool_by_ref(
        state.mcp.store.as_ref(),
        normalized_tool_id.as_deref(),
        normalized_tool_name.as_deref(),
    )
    .await
    {
        Ok(tool) => {
            let risk = state.mcp.assess_tool_risk(&tool, &arguments);
            execute_or_queue_mcp_tool_call_with_tool_ref(
                &approval_context,
                Some(&risk),
                Some(&state.mcp),
                state.mcp.store.as_ref(),
                state.mcp.approvals.pending_tool_calls.as_ref(),
                Some(tool.id),
                Some(tool.name),
                arguments,
                risk.requires_approval,
            )
            .await
        }
        Err(tool_err) => {
            let binding = resolve_skill_binding_by_ref(
                state.mcp.store.as_ref(),
                normalized_tool_id.as_deref(),
                normalized_tool_name.as_deref(),
            )
            .await
            .map_err(|err| err.to_string())?
            .ok_or_else(|| tool_err.to_string())?;
            let risk = state.mcp.assess_skill_binding_risk(&binding, &arguments);
            execute_or_queue_mcp_tool_call_with_tool_ref(
                &approval_context,
                Some(&risk),
                Some(&state.mcp),
                state.mcp.store.as_ref(),
                state.mcp.approvals.pending_tool_calls.as_ref(),
                Some(binding.binding_id),
                Some(binding.callable_name),
                arguments,
                risk.requires_approval,
            )
            .await
        }
    }
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

 
