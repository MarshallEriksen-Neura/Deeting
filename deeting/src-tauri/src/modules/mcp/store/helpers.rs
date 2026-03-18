use super::*;
use sqlx::sqlite::SqliteRow;
use sqlx::Row;
pub(super) use mcp_storage::helpers::{deserialize_json, hash_json, now_rfc3339, serialize_json};

pub(super) fn row_to_source(row: &SqliteRow) -> Result<McpSource, McpError> {
    let source_type: String = row.try_get("source_type")?;
    let trust_level: String = row.try_get("trust_level")?;
    let status: String = row.try_get("status")?;
    Ok(McpSource {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        source_type: source_type.parse().map_err(McpError::validation)?,
        path_or_url: row.try_get("path_or_url")?,
        trust_level: trust_level.parse().map_err(McpError::validation)?,
        status: status.parse().map_err(McpError::validation)?,
        last_synced_at: row.try_get("last_synced_at")?,
        is_read_only: row.try_get::<i64, _>("is_read_only")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(super) fn row_to_tool(row: &SqliteRow) -> Result<McpTool, McpError> {
    let source_type: String = row.try_get("source_type")?;
    let status: String = row.try_get("status")?;
    let conflict_status: String = row.try_get("conflict_status")?;
    let capabilities: String = row.try_get("capabilities")?;
    let args: Option<String> = row.try_get("args")?;
    let env: Option<String> = row.try_get("env")?;
    Ok(McpTool {
        id: row.try_get("id")?,
        identifier: row.try_get("identifier")?,
        name: row.try_get("name")?,
        source_type: source_type.parse().map_err(McpError::validation)?,
        source_id: row.try_get("source_id")?,
        status: status.parse().map_err(McpError::validation)?,
        ping_ms: row.try_get("ping_ms")?,
        capabilities: serde_json::from_str(&capabilities)?,
        description: row.try_get("description")?,
        error: row.try_get("error")?,
        command: row.try_get("command")?,
        args: deserialize_json(args)?,
        env: deserialize_json(env)?,
        config_json: row.try_get("config_json")?,
        pending_config_json: row.try_get("pending_config_json")?,
        config_hash: row.try_get("config_hash")?,
        pending_config_hash: row.try_get("pending_config_hash")?,
        conflict_status: conflict_status.parse().map_err(McpError::validation)?,
        is_read_only: row.try_get::<i64, _>("is_read_only")? != 0,
        is_new: row.try_get::<i64, _>("is_new")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
