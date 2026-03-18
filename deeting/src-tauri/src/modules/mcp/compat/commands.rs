use tauri::{AppHandle, State};

use crate::modules::mcp::commands::cloud_subscriptions_impl::sync_cloud_subscriptions_inner;
use crate::state::AppState;

#[tauri::command]
pub async fn sync_cloud_subscriptions(
    _app: AppHandle,
    state: State<'_, AppState>,
    access_token: String,
) -> Result<Vec<mcp_core::types::McpTool>, String> {
    sync_cloud_subscriptions_inner(&state.mcp, access_token).await
}
