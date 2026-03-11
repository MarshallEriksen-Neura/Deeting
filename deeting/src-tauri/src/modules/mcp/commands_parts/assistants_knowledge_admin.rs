use super::{
    common_impl::to_string,
    runtime::{approve_mcp_tool_inner_with_context, reject_mcp_tool_inner},
    skill_registry_impl::reindex_local_skill_bundle_asset,
    source_management_impl::CloudSubscriptionItem,
    support::*,
};

fn derive_backing_skill_id(raw: Option<&str>) -> Option<&str> {
    let normalized = raw?.trim();
    if !normalized.starts_with("skill.") {
        return None;
    }
    Some(normalized.split('/').next().unwrap_or(normalized))
}

pub(crate) async fn index_mcp_tool_asset(
    app_state: &AppState,
    tool: &McpTool,
    source_type: &str,
    pkg_name: Option<String>,
) {
    let text = format!("name: {}\ndescription: {}", tool.name, tool.description);
    if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
        let _ = app_state
            .memory
            .service
            .upsert_asset(
                tool.id.clone(),
                tool.name.clone(),
                tool.description.clone(),
                "tool".to_string(),
                source_type.to_string(),
                pkg_name,
                vector,
                None,
            )
            .await;
    }
}

pub(crate) async fn index_mcp_tools(app_state: &AppState, tools: &[McpTool]) {
    for tool in tools {
        index_mcp_tool_asset(app_state, tool, "mcp", tool.source_id.clone()).await;
    }
}

pub(crate) async fn reindex_desktop_tool_asset(
    app_state: &AppState,
    tool: &McpTool,
) -> Result<(), String> {
    if let Some(skill_id) = derive_backing_skill_id(tool.identifier.as_deref()) {
        let _ = app_state
            .memory
            .service
            .delete_assets_by_ids(&[tool.id.clone()])
            .await;
        return reindex_local_skill_bundle_asset(app_state, skill_id).await;
    }

    index_mcp_tool_asset(app_state, tool, "mcp", tool.source_id.clone()).await;
    Ok(())
}

/// Fire-and-forget: embed all chunks of a successfully indexed document into LanceDB.
///
/// Reads chunks from SQLite, embeds each via the embedding service, and upserts
/// into local_assets with `package_id = "knowledge:{document_id}"`.
pub(crate) fn spawn_embed_knowledge_chunks(app_state: &AppState, file: &LocalKnowledgeFile) {
    if file.status != "indexed" {
        return;
    }
    let document_id = file.id.clone();
    let document_name = file.name.clone();
    let store = app_state.mcp.store.clone();
    let providers = app_state.providers.clone();
    let memory_service = app_state.memory.service.clone();

    tokio::spawn(async move {
        let chunks_result = store
            .list_local_user_document_chunks(
                &document_id,
                crate::modules::mcp::types::LocalUserDocumentChunkListQuery {
                    offset: None,
                    limit: Some(500),
                },
            )
            .await;

        let chunks = match chunks_result {
            Ok(response) => response.items,
            Err(e) => {
                log::warn!(
                    "embed_knowledge_chunks: failed to list chunks for {}: {}",
                    document_id,
                    e
                );
                return;
            }
        };

        let pkg_name = format!("knowledge:{}", document_id);
        // Delete old embeddings for this document before re-inserting
        let _ = memory_service.delete_assets_by_package(&pkg_name).await;

        for chunk in &chunks {
            let embed_result = providers.embedding.embed_text(&chunk.content).await;
            let vector = match embed_result {
                Ok(v) => v,
                Err(e) => {
                    log::warn!(
                        "embed_knowledge_chunks: failed to embed chunk {} of {}: {}",
                        chunk.id,
                        document_id,
                        e
                    );
                    continue;
                }
            };

            let metadata = serde_json::json!({
                "chunk_index": chunk.index,
                "document_name": document_name,
                "document_id": document_id,
                "token_count": chunk.token_count,
            });

            if let Err(e) = memory_service
                .upsert_asset(
                    chunk.id.clone(),
                    document_name.clone(),
                    chunk.content.clone(),
                    "knowledge_chunk".to_string(),
                    "local_document".to_string(),
                    Some(pkg_name.clone()),
                    vector,
                    Some(metadata),
                )
                .await
            {
                log::warn!(
                    "embed_knowledge_chunks: failed to upsert chunk {} of {}: {}",
                    chunk.id,
                    document_id,
                    e
                );
            }
        }

        log::info!(
            "embed_knowledge_chunks: indexed {} chunks for document {}",
            chunks.len(),
            document_id
        );
    });
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
    let base_url = state.cloud_base_url.read().await.clone();
    let url = format!(
        "{}/api/v1/mcp/subscriptions",
        base_url.trim_end_matches('/')
    );
    let response = state
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

#[tauri::command]
pub async fn approve_mcp_tool(
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    call_id: Option<String>,
    #[allow(non_snake_case)] callId: Option<String>,
    execution_token: Option<String>,
    #[allow(non_snake_case)] executionToken: Option<String>,
) -> Result<Value, String> {
    let token = approval_token
        .or(approvalToken)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "approval token is required".to_string())?;
    let approval_context = state.mcp.build_approval_context(
        call_id.or(callId).as_deref(),
        execution_token.or(executionToken).as_deref(),
    );

    approve_mcp_tool_inner_with_context(
        &approval_context,
        Some(&state.mcp),
        state.mcp.store.as_ref(),
        state.mcp.pending_tool_calls.as_ref(),
        &token,
    )
    .await
}

#[tauri::command]
pub async fn reject_mcp_tool(
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
) -> Result<(), String> {
    let token = approval_token
        .or(approvalToken)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "approval token is required".to_string())?;
    reject_mcp_tool_inner(state.mcp.pending_tool_calls.as_ref(), &token).await;
    Ok(())
}
