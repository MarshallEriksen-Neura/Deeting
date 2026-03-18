use mcp_session::context::LocalConversationRuntimeWindow;
use serde_json::Value;
use tauri::State;

use mcp_session::conversation::{
    CreateConversationMessageRequest, LocalConversationArchiveResponse,
    LocalConversationClearResponse, LocalConversationCreateRequest,
    LocalConversationCreateResponse, LocalConversationDeleteResponse,
    LocalConversationHistoryMessage, LocalConversationHistoryQuery,
    LocalConversationHistoryResponse, LocalConversationRenameRequest,
    LocalConversationRenameResponse, LocalConversationSessionPage, LocalConversationSessionsQuery,
    LocalConversationStatus, LocalConversationWindowResponse,
};
use crate::state::AppState;

const FACT_EXTRACTION_NEW_CHAT_TRIGGER_KEY_PREFIX: &str = "fact_extraction.new_chat_triggered";
const FACT_EXTRACTION_MIN_MESSAGES: usize = 2;

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn build_fact_extraction_new_chat_marker_key(session_id: &str) -> String {
    format!(
        "{}.{}",
        FACT_EXTRACTION_NEW_CHAT_TRIGGER_KEY_PREFIX, session_id
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
    runtime_window: &LocalConversationRuntimeWindow,
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
            log::warn!(
                "fact extraction new-chat marker read failed session={} err={}",
                normalized_session_id,
                err
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
            log::warn!(
                "fact extraction new-chat load runtime window failed session={} err={}",
                normalized_session_id,
                err
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
    state
        .mcp
        .store
        .update_local_conversation_status(&session_id, LocalConversationStatus::Archived)
        .await
        .map_err(to_string)
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
