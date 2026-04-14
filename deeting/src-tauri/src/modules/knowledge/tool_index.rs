use crate::state::{global_app_handle, AppState};
use mcp_core::types::McpTool;
use serde::Serialize;
use std::collections::HashSet;
use tauri::Emitter;

const MCP_TOOL_INDEX_PROGRESS_EVENT: &str = "mcp-tool-index-progress";

#[derive(Debug, Clone, Serialize)]
struct McpToolIndexProgress {
    phase: String,
    total: i64,
    processed: i64,
    indexed: i64,
    failed: i64,
    current: Option<String>,
}

fn emit_mcp_tool_index_progress(
    phase: &str,
    total: usize,
    processed: usize,
    indexed: usize,
    failed: usize,
    current: Option<String>,
) {
    let Some(app_handle) = global_app_handle() else {
        return;
    };
    let _ = app_handle.emit(
        MCP_TOOL_INDEX_PROGRESS_EVENT,
        McpToolIndexProgress {
            phase: phase.to_string(),
            total: total as i64,
            processed: processed as i64,
            indexed: indexed as i64,
            failed: failed as i64,
            current,
        },
    );
}

pub(crate) async fn index_mcp_tool_asset(
    app_state: &AppState,
    tool: &McpTool,
    source_type: &str,
    pkg_name: Option<String>,
) -> bool {
    let text = format!("name: {}\ndescription: {}", tool.name, tool.description);
    if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
        return app_state
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
            .await
            .is_ok();
    }

    false
}

pub(crate) async fn index_mcp_tools(app_state: &AppState, tools: &[McpTool]) {
    let total = tools.len();
    let mut processed = 0usize;
    let mut indexed = 0usize;
    let mut failed = 0usize;
    emit_mcp_tool_index_progress("prepare", total, processed, indexed, failed, None);

    for tool in tools {
        let success = index_mcp_tool_asset(app_state, tool, "mcp", tool.source_id.clone()).await;
        processed += 1;
        if success {
            indexed += 1;
        } else {
            failed += 1;
        }
        emit_mcp_tool_index_progress(
            "running",
            total,
            processed,
            indexed,
            failed,
            Some(tool.name.clone()),
        );
    }

    emit_mcp_tool_index_progress("completed", total, processed, indexed, failed, None);
}

pub(crate) async fn reindex_desktop_tool_asset(
    app_state: &AppState,
    tool: &McpTool,
) -> Result<(), String> {
    emit_mcp_tool_index_progress("prepare", 1, 0, 0, 0, Some(tool.name.clone()));
    let success = index_mcp_tool_asset(app_state, tool, "mcp", tool.source_id.clone()).await;
    emit_mcp_tool_index_progress(
        "completed",
        1,
        1,
        if success { 1 } else { 0 },
        if success { 0 } else { 1 },
        Some(tool.name.clone()),
    );
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
