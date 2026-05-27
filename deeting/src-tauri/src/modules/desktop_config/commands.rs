use tauri::{AppHandle, State};

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
pub async fn get_selection_assistant_shortcut(
    state: State<'_, AppState>,
) -> Result<String, String> {
    crate::modules::selection_assistant::shortcut::resolve_selection_assistant_shortcut(
        state.mcp.store.as_ref(),
    )
    .await
    .map_err(to_string)
}

#[tauri::command]
pub async fn set_selection_assistant_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    shortcut: String,
) -> Result<String, String> {
    let next_shortcut =
        crate::modules::selection_assistant::shortcut::normalize_selection_assistant_shortcut(
            shortcut.as_str(),
        )?;
    if next_shortcut.eq_ignore_ascii_case(crate::setup::MAIN_WINDOW_SHORTCUT) {
        return Err(
            "selection assistant shortcut conflicts with the main window shortcut".to_string(),
        );
    }

    let previous_shortcut =
        crate::modules::selection_assistant::shortcut::resolve_selection_assistant_shortcut(
            state.mcp.store.as_ref(),
        )
        .await
        .map_err(to_string)?;

    crate::modules::selection_assistant::shortcut::replace_selection_assistant_shortcut(
        &app,
        previous_shortcut.as_str(),
        next_shortcut.as_str(),
    )?;

    if let Err(err) = state
        .mcp
        .store
        .set_desktop_config(
            crate::modules::selection_assistant::shortcut::SELECTION_ASSISTANT_SHORTCUT_CONFIG_KEY,
            next_shortcut.as_str(),
        )
        .await
    {
        let _ = crate::modules::selection_assistant::shortcut::replace_selection_assistant_shortcut(
            &app,
            next_shortcut.as_str(),
            previous_shortcut.as_str(),
        );
        return Err(err.to_string());
    }

    Ok(next_shortcut)
}

#[tauri::command]
pub async fn get_island_toggle_shortcut(state: State<'_, AppState>) -> Result<String, String> {
    crate::modules::island_window::resolve_island_toggle_shortcut(state.mcp.store.as_ref())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn set_island_toggle_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    shortcut: String,
) -> Result<String, String> {
    let next_shortcut =
        crate::modules::island_window::normalize_island_toggle_shortcut(shortcut.as_str())?;
    if next_shortcut.eq_ignore_ascii_case(crate::setup::MAIN_WINDOW_SHORTCUT) {
        return Err("island toggle shortcut conflicts with the main window shortcut".to_string());
    }

    let selection_shortcut =
        crate::modules::selection_assistant::shortcut::resolve_selection_assistant_shortcut(
            state.mcp.store.as_ref(),
        )
        .await
        .map_err(to_string)?;
    if next_shortcut.eq_ignore_ascii_case(selection_shortcut.as_str()) {
        return Err(
            "island toggle shortcut conflicts with the selection assistant shortcut".to_string(),
        );
    }

    let previous_shortcut =
        crate::modules::island_window::resolve_island_toggle_shortcut(state.mcp.store.as_ref())
            .await
            .map_err(to_string)?;

    crate::modules::island_window::replace_island_toggle_shortcut(
        &app,
        previous_shortcut.as_str(),
        next_shortcut.as_str(),
    )?;

    if let Err(err) = state
        .mcp
        .store
        .set_desktop_config(
            crate::modules::island_window::ISLAND_TOGGLE_SHORTCUT_CONFIG_KEY,
            next_shortcut.as_str(),
        )
        .await
    {
        let _ = crate::modules::island_window::replace_island_toggle_shortcut(
            &app,
            next_shortcut.as_str(),
            previous_shortcut.as_str(),
        );
        return Err(err.to_string());
    }

    Ok(next_shortcut)
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
