use tauri::{AppHandle, State};

use crate::state::AppState;

use super::service;
use super::types::{ApprovalActionResult, TextChatReply};

#[tauri::command]
pub async fn execute_local_text_conversation(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<Option<TextChatReply>, String> {
    service::execute_text_chat(state.inner(), &app_handle, &text, &session_id).await
}

#[tauri::command]
pub async fn approve_local_text_conversation_tool(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    approval_token: String,
    tool_name: String,
    call_id: Option<String>,
) -> Result<ApprovalActionResult, String> {
    service::approve_tool(
        &app_handle,
        state.inner(),
        &approval_token,
        call_id.as_deref(),
        &tool_name,
    )
    .await
}

#[tauri::command]
pub async fn reject_local_text_conversation_tool(
    state: State<'_, AppState>,
    approval_token: String,
    tool_name: String,
) -> Result<ApprovalActionResult, String> {
    service::reject_tool(state.inner(), &approval_token, &tool_name).await
}
