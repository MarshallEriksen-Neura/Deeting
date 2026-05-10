use tauri::State;

use crate::state::AppState;
use mcp_session::conversation::{
    CreateConversationMessageRequest, LocalConversationArchiveResponse,
    LocalConversationClearResponse, LocalConversationCreateRequest,
    LocalConversationCreateResponse, LocalConversationDeleteResponse,
    LocalConversationExecutionRoot, LocalConversationExecutionTreeResponse,
    LocalConversationHistoryMessage, LocalConversationHistoryQuery,
    LocalConversationHistoryResponse, LocalConversationRenameRequest,
    LocalConversationRenameResponse, LocalConversationSessionPage, LocalConversationSessionsQuery,
    LocalConversationStatus, LocalConversationWindowResponse,
};
use serde_json::Value;

const FACT_EXTRACTION_NEW_CHAT_TRIGGER_KEY_PREFIX: &str = "fact_extraction.new_chat_triggered";

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) fn build_fact_extraction_new_chat_marker_key(session_id: &str) -> String {
    format!(
        "{}.{}",
        FACT_EXTRACTION_NEW_CHAT_TRIGGER_KEY_PREFIX, session_id
    )
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
            log::warn!(
                "fact extraction new-chat marker read failed session={} err={}",
                normalized_session_id,
                err
            );
            return;
        }
    }

    let outcome =
        match crate::modules::conversations::fact_sync::refresh_session_auto_extracted_facts(
            app_state.clone(),
            &normalized_session_id,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(err) => {
                log::warn!(
                    "fact extraction new-chat refresh failed session={} err={}",
                    normalized_session_id,
                    err
                );
                return;
            }
        };

    if !outcome.should_mark_processed() {
        return;
    }

    if let Err(err) = app_state
        .mcp
        .store
        .set_desktop_config(&marker_key, "1")
        .await
    {
        log::warn!(
            "fact extraction new-chat marker write failed session={} err={}",
            normalized_session_id,
            err
        );
    }
}

#[tauri::command]
pub async fn list_local_conversations(
    state: State<'_, AppState>,
    query: LocalConversationSessionsQuery,
) -> Result<LocalConversationSessionPage, String> {
    state
        .mcp
        .store
        .list_local_conversations(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversation_sessions(
    state: State<'_, AppState>,
    query: LocalConversationSessionsQuery,
) -> Result<LocalConversationSessionPage, String> {
    list_local_conversations(state, query).await
}

#[tauri::command]
pub async fn get_local_conversation_window(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationWindowResponse, String> {
    state
        .mcp
        .store
        .get_local_conversation_window(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_conversation(
    state: State<'_, AppState>,
    payload: LocalConversationCreateRequest,
) -> Result<LocalConversationCreateResponse, String> {
    create_local_conversation_session(state, payload).await
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
pub async fn rename_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
    payload: LocalConversationRenameRequest,
) -> Result<LocalConversationRenameResponse, String> {
    rename_local_conversation_session(state, session_id, payload).await
}

#[tauri::command]
pub async fn rename_local_conversation_session(
    state: State<'_, AppState>,
    session_id: String,
    payload: LocalConversationRenameRequest,
) -> Result<LocalConversationRenameResponse, String> {
    state
        .mcp
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
pub async fn archive_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    archive_local_conversation_session(state, session_id).await
}

#[tauri::command]
pub async fn archive_local_conversation_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    let response = state
        .mcp
        .store
        .update_local_conversation_status(&session_id, LocalConversationStatus::Archived)
        .await
        .map_err(to_string)?;
    let app_state = state.inner().clone();
    let session_id_for_hook = session_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = crate::modules::llm_wiki::automation::handle_session_end(
            &app_state,
            &session_id_for_hook,
            "archived",
        )
        .await
        {
            log::warn!(
                "llm wiki session-end hook failed session={} status=archived err={}",
                session_id_for_hook,
                err
            );
        }
    });
    Ok(response)
}

#[tauri::command]
pub async fn close_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    let response = state
        .mcp
        .store
        .update_local_conversation_status(&session_id, LocalConversationStatus::Closed)
        .await
        .map_err(to_string)?;
    let app_state = state.inner().clone();
    let session_id_for_hook = session_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = crate::modules::llm_wiki::automation::handle_session_end(
            &app_state,
            &session_id_for_hook,
            "closed",
        )
        .await
        {
            log::warn!(
                "llm wiki session-end hook failed session={} status=closed err={}",
                session_id_for_hook,
                err
            );
        }
    });
    Ok(response)
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
pub async fn clear_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationClearResponse, String> {
    clear_local_conversation_session(state, session_id).await
}

#[tauri::command]
pub async fn clear_local_conversation_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationClearResponse, String> {
    let app_state = state.inner().clone();
    let session_id_for_hook = session_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = crate::modules::llm_wiki::automation::handle_session_end(
            &app_state,
            &session_id_for_hook,
            "cleared",
        )
        .await
        {
            log::warn!(
                "llm wiki session-end hook failed session={} status=cleared err={}",
                session_id_for_hook,
                err
            );
        }
    });

    state
        .mcp
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
    let session_id = query
        .session_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "session_id is required".to_string())?;
    state
        .mcp
        .store
        .get_local_conversation_history(&session_id, query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn append_local_conversation_message(
    state: State<'_, AppState>,
    payload: CreateConversationMessageRequest,
) -> Result<LocalConversationHistoryMessage, String> {
    let session_id = payload.session_id.clone();
    let role = payload.role.clone();
    let content = payload.content.clone();
    let meta_info = payload.meta_info.clone();
    let result = state
        .mcp
        .store
        .append_local_conversation_message(payload)
        .await
        .map_err(to_string)?;

    if role.eq_ignore_ascii_case("assistant") {
        let app_state = state.inner().clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = crate::modules::llm_wiki::automation::handle_valuable_answer(
                &app_state,
                &session_id,
                &content,
                meta_info.as_ref(),
            )
            .await
            {
                log::warn!(
                    "llm wiki valuable-answer hook failed session={} err={}",
                    session_id,
                    err
                );
            }
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_local_conversation_execution_tree(
    state: State<'_, AppState>,
    root_execution_id: String,
) -> Result<LocalConversationExecutionTreeResponse, String> {
    state
        .mcp
        .store
        .get_local_conversation_execution_tree(&root_execution_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "conversation execution tree not found".to_string())
}

#[tauri::command]
pub async fn list_local_conversation_execution_roots(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<LocalConversationExecutionRoot>, String> {
    state
        .mcp
        .store
        .list_local_conversation_execution_roots(&session_id)
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
pub async fn update_local_conversation_assistant_meta_info(
    state: State<'_, AppState>,
    session_id: String,
    turn_index: i64,
    meta_info: Option<Value>,
) -> Result<(), String> {
    state
        .mcp
        .store
        .update_local_conversation_assistant_meta_info(&session_id, turn_index, meta_info)
        .await
        .map_err(to_string)
}
