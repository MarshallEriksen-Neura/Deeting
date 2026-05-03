use tauri::State;

use crate::modules::ai_access::compatible_gateway::current_base_url;
use crate::modules::ai_access::store::{
    AI_ACCESS_DEFAULT_HOST, AI_ACCESS_DEFAULT_PORT, AI_ACCESS_GATEWAY_ENABLED_KEY,
    AI_ACCESS_GATEWAY_HOST_KEY, AI_ACCESS_GATEWAY_PORT_KEY,
};
use crate::modules::ai_access::types::{
    CreateLocalAiAccessKeyRequest, LocalAiAccessGatewayConfig, LocalAiAccessKeyCreated,
    LocalAiAccessKeyRecord, UpdateLocalAiAccessGatewayConfigRequest,
};
use crate::state::AppState;

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn parse_enabled(value: Option<String>) -> bool {
    matches!(
        value
            .as_deref()
            .map(str::trim)
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

pub(crate) async fn resolve_gateway_config(
    state: &AppState,
) -> Result<LocalAiAccessGatewayConfig, String> {
    let enabled = parse_enabled(
        state
            .mcp
            .store
            .get_desktop_config(AI_ACCESS_GATEWAY_ENABLED_KEY)
            .await
            .map_err(to_string)?,
    );
    let host = state
        .mcp
        .store
        .get_desktop_config(AI_ACCESS_GATEWAY_HOST_KEY)
        .await
        .map_err(to_string)?
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| AI_ACCESS_DEFAULT_HOST.to_string());
    let port = state
        .mcp
        .store
        .get_desktop_config(AI_ACCESS_GATEWAY_PORT_KEY)
        .await
        .map_err(to_string)?
        .and_then(|value| value.trim().parse::<u16>().ok())
        .unwrap_or(AI_ACCESS_DEFAULT_PORT);
    Ok(LocalAiAccessGatewayConfig {
        enabled,
        host,
        port,
        base_url: current_base_url(),
    })
}

#[tauri::command]
pub async fn create_local_ai_access_key(
    state: State<'_, AppState>,
    payload: CreateLocalAiAccessKeyRequest,
) -> Result<LocalAiAccessKeyCreated, String> {
    state
        .mcp
        .store
        .create_local_ai_access_key(&payload.name, payload.scopes)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_ai_access_keys(
    state: State<'_, AppState>,
) -> Result<Vec<LocalAiAccessKeyRecord>, String> {
    state
        .mcp
        .store
        .list_local_ai_access_keys()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn revoke_local_ai_access_key(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    state
        .mcp
        .store
        .revoke_local_ai_access_key(&id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_ai_access_gateway_config(
    state: State<'_, AppState>,
) -> Result<LocalAiAccessGatewayConfig, String> {
    resolve_gateway_config(state.inner()).await
}

#[tauri::command]
pub async fn set_local_ai_access_gateway_config(
    state: State<'_, AppState>,
    payload: UpdateLocalAiAccessGatewayConfigRequest,
) -> Result<LocalAiAccessGatewayConfig, String> {
    let host = payload
        .host
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| AI_ACCESS_DEFAULT_HOST.to_string());
    if host != "127.0.0.1" && host != "localhost" {
        return Err("local AI access gateway only supports localhost binding".to_string());
    }
    let port = payload.port.unwrap_or(AI_ACCESS_DEFAULT_PORT);
    state
        .mcp
        .store
        .set_desktop_config(
            AI_ACCESS_GATEWAY_ENABLED_KEY,
            if payload.enabled { "true" } else { "false" },
        )
        .await
        .map_err(to_string)?;
    state
        .mcp
        .store
        .set_desktop_config(AI_ACCESS_GATEWAY_HOST_KEY, &host)
        .await
        .map_err(to_string)?;
    state
        .mcp
        .store
        .set_desktop_config(AI_ACCESS_GATEWAY_PORT_KEY, &port.to_string())
        .await
        .map_err(to_string)?;
    if !payload.enabled {
        crate::modules::ai_access::compatible_gateway::stop_gateway();
    }

    resolve_gateway_config(state.inner()).await
}

#[tauri::command]
pub async fn start_local_ai_access_gateway(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<LocalAiAccessGatewayConfig, String> {
    crate::modules::ai_access::compatible_gateway::start_enabled_gateway(
        state.inner().clone(),
        app_handle,
    )
    .await?;
    resolve_gateway_config(state.inner()).await
}
