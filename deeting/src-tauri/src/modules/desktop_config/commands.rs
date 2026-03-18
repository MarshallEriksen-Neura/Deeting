use tauri::State;

use crate::modules::mcp::commands::support::resolve_effective_desktop_scout_base_url;
use crate::state::AppState;

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
pub async fn set_cloud_base_url(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let normalized = url.trim().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return Err("cloud base url is required".to_string());
    }
    *state.mcp.transport.cloud_base_url.write().await = normalized;
    Ok(())
}

#[tauri::command]
pub async fn get_desktop_config(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    state
        .mcp
        .store
        .get_desktop_config(key.trim())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_desktop_config_value(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    get_desktop_config(state, key).await
}

#[tauri::command]
pub async fn get_effective_desktop_scout_base_url(
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    resolve_effective_desktop_scout_base_url(state.mcp.store.as_ref())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn set_desktop_config(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("config key is required".to_string());
    }
    state
        .mcp
        .store
        .set_desktop_config(&key, value.trim())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn set_desktop_config_value(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    set_desktop_config(state, key, value).await
}

#[tauri::command]
pub async fn get_local_gateway_url(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let url = state
        .mcp
        .transport
        .local_gateway
        .base_url
        .read()
        .await
        .clone();
    Ok(url)
}
