use super::{common_impl::to_string, support::*};

#[tauri::command]
pub async fn get_local_conversation_summary_queue_stats(
    state: State<'_, AppState>,
) -> Result<LocalConversationSummaryQueueStats, String> {
    state
        .mcp
        .store
        .get_local_conversation_summary_queue_stats()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversation_summary_jobs(
    state: State<'_, AppState>,
    query: LocalConversationSummaryJobQuery,
) -> Result<LocalConversationSummaryJobListResponse, String> {
    state
        .mcp
        .store
        .list_local_conversation_summary_jobs(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversation_summary_idle_tasks(
    state: State<'_, AppState>,
    query: LocalConversationSummaryIdleTaskQuery,
) -> Result<LocalConversationSummaryIdleTaskListResponse, String> {
    state
        .mcp
        .store
        .list_local_conversation_summary_idle_tasks(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn enqueue_local_conversation_summary(
    state: State<'_, AppState>,
    session_id: String,
    _assistant_id: String,
) -> Result<LocalConversationSummaryEnqueueResponse, String> {
    state
        .mcp
        .store
        .trigger_local_conversation_summary_job(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn retry_local_conversation_summary_batch(
    state: State<'_, AppState>,
    payload: LocalConversationSummaryBatchRetryRequest,
) -> Result<LocalConversationSummaryBatchRetryResponse, String> {
    state
        .mcp
        .store
        .retry_local_conversation_summary_jobs(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn trigger_local_conversation_summary_job(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationSummaryEnqueueResponse, String> {
    state
        .mcp
        .store
        .trigger_local_conversation_summary_job(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn retry_local_conversation_summary_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<LocalConversationSummaryEnqueueResponse, String> {
    state
        .mcp
        .store
        .retry_local_conversation_summary_job(&job_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn retry_local_conversation_summary_jobs(
    state: State<'_, AppState>,
    payload: LocalConversationSummaryBatchRetryRequest,
) -> Result<LocalConversationSummaryBatchRetryResponse, String> {
    state
        .mcp
        .store
        .retry_local_conversation_summary_jobs(payload)
        .await
        .map_err(to_string)
}
