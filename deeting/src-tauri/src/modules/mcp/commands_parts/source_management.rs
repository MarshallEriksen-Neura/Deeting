use super::{
    assistant_management_impl::index_local_assistants,
    assistants_knowledge_admin_impl::{index_mcp_tools, sync_cloud_subscriptions_inner},
    common_impl::to_string,
    runtime::{now_rfc3339, sync_source_inner},
    support::*,
};

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

#[derive(Debug, Clone, Deserialize)]
struct CloudAssistantMarketPage {
    items: Vec<CloudAssistantMarketItem>,
    next_page: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CloudAssistantMarketItem {
    assistant_id: String,
    owner_user_id: Option<String>,
    icon_id: Option<String>,
    share_slug: Option<String>,
    summary: Option<String>,
    published_at: Option<String>,
    install_count: Option<i64>,
    rating_avg: Option<f64>,
    rating_count: Option<i64>,
    version: CloudAssistantMarketVersion,
}

#[derive(Debug, Clone, Deserialize)]
struct CloudAssistantMarketVersion {
    id: String,
    version: String,
    name: String,
    description: Option<String>,
    system_prompt: Option<String>,
    tags: Option<Vec<String>>,
    published_at: Option<String>,
}

#[tauri::command]
pub async fn sync_cloud_subscriptions(
    _app: AppHandle,
    state: State<'_, AppState>,
    access_token: String,
) -> Result<Vec<McpTool>, String> {
    sync_cloud_subscriptions_inner(&state.mcp, access_token).await
}

#[tauri::command]
pub async fn sync_local_system_assistants(
    state: State<'_, AppState>,
    access_token: String,
    size: Option<i64>,
) -> Result<LocalSystemAssistantSyncResponse, String> {
    let normalized_token = access_token.trim().to_string();
    if normalized_token.is_empty() {
        return Err("access token is required".to_string());
    }

    let page_size = size.unwrap_or(100).clamp(1, 200);
    let mut cursor: Option<String> = None;
    let mut page_guard = 0_i32;
    let mut fetched_count = 0_i64;
    let mut system_items: Vec<CloudSystemAssistantSnapshot> = Vec::new();
    let mut dedupe_ids: HashSet<String> = HashSet::new();

    loop {
        page_guard += 1;
        if page_guard > 30 {
            break;
        }

        let base_url = state.mcp.cloud_base_url.read().await.clone();
        let url = format!(
            "{}/api/v1/assistants/market",
            base_url.trim_end_matches('/')
        );
        let mut request = state
            .mcp
            .client
            .get(&url)
            .bearer_auth(normalized_token.as_str())
            .query(&[("size", page_size.to_string())]);
        if let Some(cursor_value) = cursor.as_deref() {
            request = request.query(&[("cursor", cursor_value)]);
        }

        let response = request.send().await.map_err(to_string)?;
        if !response.status().is_success() {
            return Err(format!(
                "failed to sync system assistants: {}",
                response.status()
            ));
        }

        let page: CloudAssistantMarketPage = response.json().await.map_err(to_string)?;
        fetched_count += page.items.len() as i64;

        for item in page.items {
            if item.owner_user_id.is_some() || !dedupe_ids.insert(item.assistant_id.clone()) {
                continue;
            }
            system_items.push(CloudSystemAssistantSnapshot {
                assistant_id: item.assistant_id,
                icon_id: item.icon_id,
                share_slug: item.share_slug,
                summary: item.summary,
                published_at: item.published_at,
                install_count: item.install_count.unwrap_or(0),
                rating_avg: item.rating_avg.unwrap_or(0.0),
                rating_count: item.rating_count.unwrap_or(0),
                version: CloudSystemAssistantVersionSnapshot {
                    id: item.version.id,
                    version: item.version.version,
                    name: item.version.name,
                    description: item.version.description,
                    system_prompt: item.version.system_prompt,
                    tags: item.version.tags.unwrap_or_default(),
                    published_at: item.version.published_at,
                },
            });
        }

        cursor = page.next_page;
        if cursor.is_none() {
            break;
        }
    }

    let (synced_count, archived_count) = state
        .mcp
        .store
        .sync_cloud_system_assistants(&system_items)
        .await
        .map_err(to_string)?;

    if let Ok(assistants) = state.mcp.store.list_local_assistants().await {
        let app_state_clone = state.inner().clone();
        tauri::async_runtime::spawn(async move {
            index_local_assistants(&app_state_clone, &assistants).await;
        });
    }

    Ok(LocalSystemAssistantSyncResponse {
        fetched_count,
        synced_count,
        archived_count,
    })
}

#[tauri::command]
pub async fn list_mcp_sources(state: State<'_, AppState>) -> Result<Vec<McpSource>, String> {
    state.mcp.store.list_sources().await.map_err(to_string)
}

#[tauri::command]
pub async fn create_mcp_source(
    state: State<'_, AppState>,
    payload: CreateSourceRequest,
) -> Result<McpSource, String> {
    let source = NewSource {
        name: payload.name,
        source_type: payload.source_type,
        path_or_url: payload.path_or_url,
        trust_level: payload.trust_level,
        status: McpSourceStatus::Active,
        last_synced_at: None,
        is_read_only: payload.is_read_only.unwrap_or(false),
    };
    state
        .mcp
        .store
        .insert_source(source)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn sync_mcp_source(
    app_state: State<'_, AppState>,
    source_id: String,
    payload: SyncSourceRequest,
) -> Result<Vec<McpTool>, String> {
    let state = &app_state.mcp;
    let source = state
        .store
        .get_source(&source_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| to_string(McpError::NotFound(format!("source {source_id} not found"))))?;

    state
        .store
        .update_source_status(&source_id, McpSourceStatus::Syncing, None)
        .await
        .map_err(to_string)?;

    let result = sync_source_inner(state, source, payload.auth_token).await;
    match result {
        Ok(tools) => {
            state
                .store
                .update_source_status(&source_id, McpSourceStatus::Active, Some(now_rfc3339()))
                .await
                .map_err(to_string)?;
            let app_state_clone = app_state.inner().clone();
            let tools_clone = tools.clone();
            tauri::async_runtime::spawn(async move {
                let _ = index_mcp_tools(&app_state_clone, &tools_clone).await;
            });
            Ok(tools)
        }
        Err(err) => {
            state
                .store
                .update_source_status(&source_id, McpSourceStatus::Error, None)
                .await
                .map_err(to_string)?;
            Err(to_string(err))
        }
    }
}

#[tauri::command]
pub async fn list_mcp_tools(state: State<'_, AppState>) -> Result<Vec<McpTool>, String> {
    state.mcp.store.list_tools().await.map_err(to_string)
}
