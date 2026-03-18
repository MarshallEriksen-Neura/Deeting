use crate::state::AppState;
use mcp_core::types::McpTool;
use std::collections::HashSet;

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
    index_mcp_tool_asset(app_state, tool, "mcp", tool.source_id.clone()).await;
    Ok(())
}

pub(crate) async fn delete_mcp_tool_assets(
    app_state: &AppState,
    tool_id: &str,
    source_id: Option<&str>,
    remove_source_assets: bool,
) -> Result<(), String> {
    if remove_source_assets {
        if let Some(source_id) = source_id {
            app_state
                .memory
                .service
                .delete_assets_by_package(source_id)
                .await
                .map_err(|err| err.to_string())?;
            return Ok(());
        }
    }

    app_state
        .memory
        .service
        .delete_assets_by_ids(&[tool_id.to_string()])
        .await
        .map_err(|err| err.to_string())
}

pub(crate) async fn list_indexed_mcp_tool_ids(
    app_state: &AppState,
) -> Result<HashSet<String>, String> {
    let assets = app_state
        .memory
        .service
        .list_assets_catalog()
        .await
        .map_err(|err| err.to_string())?;

    Ok(assets
        .into_iter()
        .filter(|asset| asset.get("asset_type").and_then(serde_json::Value::as_str) == Some("tool"))
        .filter_map(|asset| {
            asset
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .collect())
}
