use super::{
    bootstrap_and_registry_impl::{create_assistant_message, to_string},
    runtime::{request_provider_chat_completion, resolve_local_model_connection},
    support::*,
};

#[tauri::command]
pub async fn get_local_assistant_routing_report(
    state: State<'_, AppState>,
    query: LocalAssistantRoutingReportQuery,
) -> Result<LocalAssistantRoutingReportResponse, String> {
    state
        .mcp
        .store
        .get_local_assistant_routing_report(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn record_local_assistant_routing_feedback(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantRoutingFeedbackRequest,
) -> Result<(), String> {
    state
        .mcp
        .store
        .record_local_assistant_routing_feedback(&assistant_id, payload)
        .await
        .map_err(to_string)?;
    Ok(())
}

#[tauri::command]
pub async fn get_local_assistant_preview(
    state: State<'_, AppState>,
    assistant_id: String,
    _payload: LocalAssistantPreviewRequest,
) -> Result<LocalAssistant, String> {
    state
        .mcp
        .store
        .get_local_assistant(&assistant_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "assistant not found".to_string())
}

#[tauri::command]
pub async fn record_local_assistant_rating(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantRatingRequest,
) -> Result<LocalAssistantRatingResponse, String> {
    state
        .mcp
        .store
        .rate_local_assistant(&assistant_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_installations(
    state: State<'_, AppState>,
    query: LocalAssistantInstallQuery,
) -> Result<LocalAssistantInstallPage, String> {
    state
        .mcp
        .store
        .list_local_assistant_installs(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_assistant_installation(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallCreateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    state
        .mcp
        .store
        .install_local_assistant(&assistant_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_local_assistant_installation(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallUpdateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    state
        .mcp
        .store
        .update_local_assistant_install(&assistant_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_assistant_installation(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<(), String> {
    state
        .mcp
        .store
        .uninstall_local_assistant(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_versions(
    state: State<'_, AppState>,
    assistant_id: Option<String>,
) -> Result<Vec<LocalAssistantVersion>, String> {
    state
        .mcp
        .store
        .list_local_assistant_versions(assistant_id.as_deref())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_installs(
    state: State<'_, AppState>,
    query: LocalAssistantInstallQuery,
) -> Result<LocalAssistantInstallPage, String> {
    list_local_assistant_installations(state, query).await
}

#[tauri::command]
pub async fn install_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallCreateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    create_local_assistant_installation(state, assistant_id, payload).await
}

#[tauri::command]
pub async fn update_local_assistant_install(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallUpdateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    update_local_assistant_installation(state, assistant_id, payload).await
}

#[tauri::command]
pub async fn uninstall_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<(), String> {
    delete_local_assistant_installation(state, assistant_id).await
}

#[tauri::command]
pub async fn rate_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantRatingRequest,
) -> Result<LocalAssistantRatingResponse, String> {
    record_local_assistant_rating(state, assistant_id, payload).await
}

#[tauri::command]
pub async fn record_local_assistant_routing_trial(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<LocalAssistantRoutingState, String> {
    state
        .mcp
        .store
        .record_local_assistant_routing_trial(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn append_assistant_message(
    state: State<'_, AppState>,
    payload: CreateAssistantMessageRequest,
) -> Result<LocalAssistantMessage, String> {
    create_assistant_message(state, payload).await
}

#[tauri::command]
pub async fn preview_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantPreviewRequest,
) -> Result<serde_json::Value, String> {
    let assistant = state
        .mcp
        .store
        .get_local_assistant(&assistant_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "assistant not found".to_string())?;

    let model_from_config = assistant
        .model_config
        .as_ref()
        .and_then(|value| value.get("model"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "default".to_string());
    let provider_model_id = assistant
        .model_config
        .as_ref()
        .and_then(|value| value.get("provider_model_id"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let model_connection = resolve_local_model_connection(
        state.inner(),
        &model_from_config,
        provider_model_id.as_deref(),
    )
    .await?;

    let messages = vec![
        LocalChatInputMessage {
            role: "system".to_string(),
            content: assistant.system_prompt,
        },
        LocalChatInputMessage {
            role: "user".to_string(),
            content: payload.message,
        },
    ];
    let response = request_provider_chat_completion(
        state.inner(),
        &model_connection.provider_model_id,
        &model_connection.model_id,
        messages,
        None,
        payload.temperature,
        payload.max_tokens,
        None,
        None,
    )
    .await?;
    let content = response
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    Ok(serde_json::json!({ "content": content }))
}

#[tauri::command]
pub async fn delete_assistant_messages(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<(), String> {
    state
        .mcp
        .store
        .delete_assistant_messages(&assistant_id)
        .await
        .map_err(to_string)
}

