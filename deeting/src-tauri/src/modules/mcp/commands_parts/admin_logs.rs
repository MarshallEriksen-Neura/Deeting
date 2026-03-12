use super::{common_impl::to_string, support::*};

#[tauri::command]
pub async fn create_local_trace_feedback(
    state: State<'_, AppState>,
    payload: LocalTraceFeedbackRequest,
) -> Result<LocalTraceFeedback, String> {
    state
        .mcp
        .store
        .create_local_trace_feedback(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_gateway_logs(
    state: State<'_, AppState>,
    query: LocalGatewayLogQuery,
) -> Result<LocalGatewayLogListResponse, String> {
    state
        .mcp
        .store
        .list_local_gateway_logs(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_gateway_log(
    state: State<'_, AppState>,
    payload: LocalGatewayLogItem,
) -> Result<(), String> {
    state
        .mcp
        .store
        .create_local_gateway_log(
            payload.trace_id.as_deref(),
            payload.user_id.as_deref(),
            payload.api_key_id.as_deref(),
            payload.preset_id.as_deref(),
            &payload.model,
            payload.status_code,
            payload.duration_ms,
            payload.ttft_ms,
            None,
            0,
            payload.input_tokens,
            payload.output_tokens,
            payload.total_tokens,
            payload.cost_upstream,
            payload.cost_user,
            payload.is_cached,
            payload.error_code.as_deref(),
            None,
        )
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_gateway_log_stats(
    state: State<'_, AppState>,
    query: Option<LocalGatewayLogQuery>,
) -> Result<LocalGatewayLogStatsResponse, String> {
    state
        .mcp
        .store
        .get_local_gateway_log_stats(query.unwrap_or_default())
        .await
        .map_err(to_string)
}
