use super::{
    common_impl::to_string,
    sources_tools_and_chat_impl::{
        archive_local_conversation_session, create_local_conversation_session,
        list_local_conversation_sessions, rename_local_conversation_session,
    },
    support::*,
};

#[tauri::command]
pub async fn list_local_conversations(
    state: State<'_, AppState>,
    query: LocalConversationSessionsQuery,
) -> Result<LocalConversationSessionPage, String> {
    list_local_conversation_sessions(state, query).await
}

#[tauri::command]
pub async fn create_local_conversation(
    state: State<'_, AppState>,
    payload: LocalConversationCreateRequest,
) -> Result<LocalConversationCreateResponse, String> {
    create_local_conversation_session(state, payload).await
}

#[tauri::command]
pub async fn archive_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    archive_local_conversation_session(state, session_id).await
}

#[tauri::command]
pub async fn close_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    state
        .mcp
        .store
        .update_local_conversation_status(&session_id, LocalConversationStatus::Closed)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn unarchive_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    state
        .mcp
        .store
        .update_local_conversation_status(&session_id, LocalConversationStatus::Active)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn rename_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
    payload: LocalConversationRenameRequest,
) -> Result<LocalConversationRenameResponse, String> {
    rename_local_conversation_session(state, session_id, payload).await
}

#[tauri::command]
pub async fn append_local_conversation_message(
    state: State<'_, AppState>,
    payload: CreateConversationMessageRequest,
) -> Result<LocalConversationHistoryMessage, String> {
    state
        .mcp
        .store
        .append_local_conversation_message(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_conversation_message(
    state: State<'_, AppState>,
    session_id: String,
    turn_index: i64,
) -> Result<LocalConversationDeleteResponse, String> {
    state
        .mcp
        .store
        .delete_local_conversation_message(&session_id, turn_index)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn clear_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationClearResponse, String> {
    state
        .mcp
        .store
        .clear_local_conversation(&session_id)
        .await
        .map_err(to_string)
}
