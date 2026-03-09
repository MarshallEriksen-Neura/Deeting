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
            &payload.model,
            payload.status_code,
            payload.duration_ms,
            payload.ttft_ms,
            None,
            0,
            payload.input_tokens,
            payload.output_tokens,
            payload.input_tokens.saturating_add(payload.output_tokens),
            payload.cost_user,
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
) -> Result<LocalGatewayLogStatsResponse, String> {
    state
        .mcp
        .store
        .get_local_gateway_log_stats(LocalGatewayLogQuery {
            skip: None,
            limit: None,
            model: None,
            status_code: None,
            is_cached: None,
        })
        .await
        .map_err(to_string)
}
