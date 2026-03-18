use super::{common_impl::to_string, support::*};

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CloudSubscriptionTool {
    pub(crate) identifier: String,
    pub(crate) name: String,
    pub(crate) source_url: Option<String>,
    pub(crate) capabilities: Vec<String>,
    pub(crate) description: String,
    pub(crate) config_json: String,
    pub(crate) config_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CloudSubscriptionItem {
    pub(crate) tool: CloudSubscriptionTool,
}

#[tauri::command]
pub async fn sync_cloud_subscriptions_v2(
    _app: AppHandle,
    state: State<'_, AppState>,
    access_token: String,
) -> Result<Vec<McpTool>, String> {
    sync_cloud_subscriptions_inner(&state.mcp, access_token).await
}

pub(crate) async fn sync_cloud_subscriptions_inner(
    state: &McpRuntimeState,
    access_token: String,
) -> Result<Vec<McpTool>, String> {
    let base_url = state.transport.cloud_base_url.read().await.clone();
    let url = format!(
        "{}/api/v1/mcp/subscriptions",
        base_url.trim_end_matches('/')
    );
    let response = state
        .transport
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(to_string)?;

    if !response.status().is_success() {
        return Err(format!(
            "failed to sync subscriptions: {}",
            response.status()
        ));
    }

    let subscriptions: Vec<CloudSubscriptionItem> = response.json().await.map_err(to_string)?;
    let mut synced_tools = Vec::new();

    for sub in subscriptions {
        let source_url = sub
            .tool
            .source_url
            .clone()
            .unwrap_or_else(|| base_url.clone());
        let cloud_source = state
            .store
            .ensure_cloud_source(&source_url)
            .await
            .map_err(to_string)?;

        let tool = sub.tool;
        let upsert = ToolUpsert {
            id: None,
            source_id: cloud_source.id.clone(),
            identifier: Some(tool.identifier.clone()),
            name: tool.name.clone(),
            source_type: McpSourceType::Cloud,
            status: McpToolStatus::Healthy,
            ping_ms: None,
            capabilities: tool.capabilities.clone(),
            description: tool.description.clone(),
            error: None,
            command: None,
            args: None,
            env: None,
            config_json: tool.config_json.clone(),
            config_hash: tool.config_hash.clone(),
            pending_config_json: None,
            pending_config_hash: None,
            conflict_status: McpConflictStatus::None,
            is_read_only: false,
            is_new: false,
        };

        if let Ok(synced) = state.store.upsert_tool(upsert).await {
            synced_tools.push(synced);
        }
    }

    Ok(synced_tools)
}
