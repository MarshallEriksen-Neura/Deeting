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
pub async fn get_local_browser_agent_active_page(
    state: State<'_, AppState>,
) -> Result<Option<crate::modules::browser_agent::types::BrowserAgentPageContext>, String> {
    state
        .browser_agent
        .service
        .get_active_page(state.mcp.store.as_ref())
        .await
}

#[tauri::command]
pub async fn wait_for_local_browser_agent_element(
    state: State<'_, AppState>,
    tab_id: i64,
    target: crate::modules::browser_agent::types::BrowserAgentElementLocator,
    timeout_ms: i64,
    poll_interval_ms: i64,
) -> Result<serde_json::Value, String> {
    state
        .browser_agent
        .service
        .wait_for_element(
            state.mcp.store.as_ref(),
            tab_id,
            target,
            timeout_ms,
            poll_interval_ms,
        )
        .await
}

#[tauri::command]
pub async fn wait_for_local_browser_agent_navigation(
    state: State<'_, AppState>,
    tab_id: i64,
    timeout_ms: i64,
    expected_url_contains: Option<String>,
    expected_title_contains: Option<String>,
    wait_for_ready_state: Option<String>,
) -> Result<serde_json::Value, String> {
    state
        .browser_agent
        .service
        .wait_for_navigation(
            state.mcp.store.as_ref(),
            tab_id,
            timeout_ms,
            expected_url_contains.as_deref(),
            expected_title_contains.as_deref(),
            wait_for_ready_state.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn scroll_local_browser_agent_element_into_view(
    state: State<'_, AppState>,
    tab_id: i64,
    target: crate::modules::browser_agent::types::BrowserAgentElementLocator,
    align: Option<String>,
) -> Result<serde_json::Value, String> {
    state
        .browser_agent
        .service
        .scroll_into_view(state.mcp.store.as_ref(), tab_id, target, align.as_deref())
        .await
}

#[tauri::command]
pub async fn scroll_local_browser_agent_page(
    state: State<'_, AppState>,
    tab_id: i64,
    direction: String,
    amount: Option<i64>,
) -> Result<serde_json::Value, String> {
    state
        .browser_agent
        .service
        .scroll_page(state.mcp.store.as_ref(), tab_id, &direction, amount)
        .await
}

#[tauri::command]
pub async fn retry_local_browser_agent_with_relocate(
    state: State<'_, AppState>,
    tab_id: i64,
    action_kind: String,
    target: crate::modules::browser_agent::types::BrowserAgentElementLocator,
    text: Option<String>,
    max_attempts: i64,
    timeout_ms: i64,
    poll_interval_ms: i64,
) -> Result<serde_json::Value, String> {
    state
        .browser_agent
        .service
        .retry_with_relocate(
            state.mcp.store.as_ref(),
            tab_id,
            &action_kind,
            target,
            text.as_deref(),
            max_attempts,
            timeout_ms,
            poll_interval_ms,
        )
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
