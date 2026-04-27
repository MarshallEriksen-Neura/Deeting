use serde_json::Value;
use tauri::State;

use crate::modules::desktop_runtime::runtime::{
    request_provider_chat_completion, resolve_local_model_connection,
};
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use mcp_session::assistant::{
    CreateAssistantMessageRequest, CreateLocalAssistantRequest, LocalAssistant,
    LocalAssistantEntity, LocalAssistantInstallCreateRequest, LocalAssistantInstallItem,
    LocalAssistantInstallPage, LocalAssistantInstallQuery, LocalAssistantInstallUpdateRequest,
    LocalAssistantMessage, LocalAssistantPreviewRequest, LocalAssistantRatingRequest,
    LocalAssistantRatingResponse, LocalAssistantRoutingFeedbackRequest,
    LocalAssistantRoutingReportQuery, LocalAssistantRoutingReportResponse,
    LocalAssistantRoutingState, LocalAssistantTag, LocalAssistantVersion,
    UpdateLocalAssistantRequest,
};

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn resolve_assistant_model_selection(
    model_config: Option<&serde_json::Value>,
) -> (String, Option<String>) {
    // `model_name` remains as a legacy compatibility key for older assistant configs.
    let provider_model_id = model_config
        .and_then(|value| value.get("provider_model_id"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let model = model_config
        .and_then(|value| value.get("model"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            model_config
                .and_then(|value| value.get("model_name"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "default".to_string());
    (model, provider_model_id)
}

pub(crate) async fn index_local_assistants(app_state: &AppState, assistants: &[LocalAssistant]) {
    let enabled_assistant_ids = app_state
        .mcp
        .store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_default();

    for assistant in assistants {
        if !enabled_assistant_ids.contains(assistant.id.as_str()) {
            continue;
        }
        let tags = if assistant.tags.is_empty() {
            String::new()
        } else {
            assistant.tags.join(", ")
        };
        let text = format!(
            "name: {}\ndescription: {}\ntags: {}",
            assistant.name,
            assistant.description.as_deref().unwrap_or(""),
            tags
        );
        if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            let _ = app_state
                .memory
                .store
                .upsert_asset(
                    assistant.id.clone(),
                    assistant.name.clone(),
                    assistant.description.clone().unwrap_or_default(),
                    "assistant".to_string(),
                    "local_assistant".to_string(),
                    None,
                    vector,
                    None,
                )
                .await;
        }
    }
}

#[tauri::command]
pub async fn list_local_assistants(
    state: State<'_, AppState>,
) -> Result<Vec<LocalAssistant>, String> {
    state
        .mcp
        .store
        .list_local_assistants()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_entities(
    state: State<'_, AppState>,
) -> Result<Vec<LocalAssistantEntity>, String> {
    state
        .mcp
        .store
        .list_local_assistant_entities()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_tags(
    state: State<'_, AppState>,
) -> Result<Vec<LocalAssistantTag>, String> {
    state
        .mcp
        .store
        .list_local_assistant_tags()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_assistant(
    app_state: State<'_, AppState>,
    payload: CreateLocalAssistantRequest,
) -> Result<String, String> {
    let assistant_id = app_state
        .mcp
        .store
        .create_local_assistant(payload)
        .await
        .map_err(to_string)?;

    if let Ok(Some(assistant)) = app_state.mcp.store.get_local_assistant(&assistant_id).await {
        let app_state_clone = app_state.inner().clone();
        tauri::async_runtime::spawn(async move {
            index_local_assistants(&app_state_clone, &[assistant]).await;
        });
    }
    Ok(assistant_id)
}

#[tauri::command]
pub async fn update_local_assistant(
    app_state: State<'_, AppState>,
    id: String,
    payload: UpdateLocalAssistantRequest,
) -> Result<LocalAssistant, String> {
    let assistant = app_state
        .mcp
        .store
        .update_local_assistant(&id, payload)
        .await
        .map_err(to_string)?;

    let app_state_clone = app_state.inner().clone();
    let assistant_clone = assistant.clone();
    tauri::async_runtime::spawn(async move {
        index_local_assistants(&app_state_clone, &[assistant_clone]).await;
    });

    Ok(assistant)
}

#[tauri::command]
pub async fn delete_local_assistant(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .mcp
        .store
        .delete_local_assistant(&id)
        .await
        .map_err(to_string)?;
    let _ = state
        .mcp
        .store
        .delete_local_capability_registry_entries(id.trim())
        .await;
    let _ = state
        .memory
        .service
        .delete_assets_by_ids(&[id.trim().to_string()])
        .await;
    Ok(())
}

#[tauri::command]
pub async fn list_assistant_messages(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<Vec<LocalAssistantMessage>, String> {
    state
        .mcp
        .store
        .list_assistant_messages(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_assistant_message(
    state: State<'_, AppState>,
    payload: CreateAssistantMessageRequest,
) -> Result<LocalAssistantMessage, String> {
    state
        .mcp
        .store
        .append_assistant_message(payload)
        .await
        .map_err(to_string)
}

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

async fn create_local_assistant_installation(
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
pub async fn install_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallCreateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    create_local_assistant_installation(state, assistant_id, payload).await
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
) -> Result<Value, String> {
    let assistant = state
        .mcp
        .store
        .get_local_assistant(&assistant_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "assistant not found".to_string())?;

    let (model_from_config, provider_model_id) =
        resolve_assistant_model_selection(assistant.model_config.as_ref());
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
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        },
        LocalChatInputMessage {
            role: "user".to_string(),
            content: payload.message,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
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
        crate::modules::ai_upstream::ReasoningRequestConfig::default(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolve_assistant_model_selection_prefers_provider_model_id() {
        let (model, provider_model_id) = resolve_assistant_model_selection(Some(&json!({
            "model": "gpt-4o-mini",
            "provider_model_id": "22222222-2222-4222-8222-222222222222"
        })));

        assert_eq!(model, "gpt-4o-mini");
        assert_eq!(
            provider_model_id.as_deref(),
            Some("22222222-2222-4222-8222-222222222222")
        );
    }

    #[test]
    fn resolve_assistant_model_selection_falls_back_to_legacy_model_name() {
        let (model, provider_model_id) = resolve_assistant_model_selection(Some(&json!({
            "model_name": "gpt-4.1"
        })));

        assert_eq!(model, "gpt-4.1");
        assert_eq!(provider_model_id, None);
    }
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
