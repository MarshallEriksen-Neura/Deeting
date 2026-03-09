use super::{common_impl::to_string, support::*};

#[tauri::command]
pub async fn list_local_admin_conversations(
    state: State<'_, AppState>,
    query: LocalAdminConversationQuery,
) -> Result<LocalAdminConversationListResponse, String> {
    state
        .mcp
        .store
        .list_local_admin_conversations(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_admin_conversation_messages(
    state: State<'_, AppState>,
    session_id: String,
    query: LocalAdminConversationMessageQuery,
) -> Result<LocalAdminConversationMessageListResponse, String> {
    state
        .mcp
        .store
        .list_local_admin_conversation_messages(&session_id, query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_admin_conversation_summaries(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalAdminConversationSummaryListResponse, String> {
    state
        .mcp
        .store
        .list_local_admin_conversation_summaries(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_admin_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalAdminConversationItem, String> {
    state
        .mcp
        .store
        .get_local_admin_conversation(&session_id)
        .await
        .map_err(to_string)
}
