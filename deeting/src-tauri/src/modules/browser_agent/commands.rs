use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn get_local_browser_agent_bridge_status(
    state: State<'_, AppState>,
) -> Result<crate::modules::browser_agent::types::BrowserAgentBridgeStatus, String> {
    state
        .browser_agent
        .service
        .status_report(state.mcp.store.as_ref())
        .await
}

#[tauri::command]
pub async fn get_local_browser_agent_bridge_url(
    state: State<'_, AppState>,
) -> Result<String, String> {
    state
        .browser_agent
        .service
        .get_bridge_url(state.mcp.store.as_ref())
        .await
        .map(|(value, _source)| value)
}

#[tauri::command]
pub async fn set_local_browser_agent_bridge_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<String, String> {
    state
        .browser_agent
        .service
        .set_bridge_url(state.mcp.store.as_ref(), &url)
        .await
}

#[tauri::command]
pub async fn open_local_browser_agent_tab(
    state: State<'_, AppState>,
    url: String,
) -> Result<serde_json::Value, String> {
    state
        .browser_agent
        .service
        .open_tab(state.mcp.store.as_ref(), &url)
        .await
}

#[tauri::command]
pub async fn get_local_browser_agent_page_snapshot(
    state: State<'_, AppState>,
    tab_id: i64,
) -> Result<serde_json::Value, String> {
    state
        .browser_agent
        .service
        .get_page_snapshot(state.mcp.store.as_ref(), tab_id)
        .await
}

#[tauri::command]
pub async fn click_local_browser_agent_element(
    state: State<'_, AppState>,
    tab_id: i64,
    target: crate::modules::browser_agent::types::BrowserAgentElementLocator,
) -> Result<serde_json::Value, String> {
    state
        .browser_agent
        .service
        .click_element(state.mcp.store.as_ref(), tab_id, target)
        .await
}

#[tauri::command]
pub async fn type_local_browser_agent_element(
    state: State<'_, AppState>,
    tab_id: i64,
    target: crate::modules::browser_agent::types::BrowserAgentElementLocator,
    text: String,
) -> Result<serde_json::Value, String> {
    state
        .browser_agent
        .service
        .type_element(state.mcp.store.as_ref(), tab_id, target, &text)
        .await
}
