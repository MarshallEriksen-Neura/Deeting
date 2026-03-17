pub use mcp_transport::bridge::McpBridgeState;

use crate::state::AppState;

#[tauri::command]
pub async fn set_mcp_backend_url(
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<(), String> {
    state.mcp.transport.bridge.set_base_url(url).await;
    Ok(())
}

#[tauri::command]
pub async fn start_mcp_log_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    tool_id: String,
) -> Result<(), String> {
    state.mcp.transport.bridge.start_stream(tool_id, app).await
}

#[tauri::command]
pub async fn stop_mcp_log_stream(
    state: tauri::State<'_, AppState>,
    tool_id: String,
) -> Result<(), String> {
    state.mcp.transport.bridge.stop_stream(&tool_id).await;
    Ok(())
}
