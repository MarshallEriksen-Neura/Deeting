use super::types::RenderCacheEntry;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use sqlx::Row;

const RENDER_CACHE_ENTRY_TABLE: &str = "render_cache_entry";
const RENDER_TEMPLATE_BINDING_TABLE: &str = "render_template_binding";

pub(crate) async fn init_render_runtime_tables(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {RENDER_CACHE_ENTRY_TABLE} (
          cache_key TEXT PRIMARY KEY,
          template_id TEXT NOT NULL,
          render_hint TEXT NOT NULL,
          schema_fingerprint TEXT NOT NULL,
          runtime_mode TEXT NOT NULL,
          artifact_path TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {RENDER_TEMPLATE_BINDING_TABLE} (
          binding_key TEXT PRIMARY KEY,
          template_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{RENDER_CACHE_ENTRY_TABLE}_hint_schema ON {RENDER_CACHE_ENTRY_TABLE}(render_hint, schema_fingerprint);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(())
}

impl McpStore {
    pub async fn get_render_cache_entry(
        &self,
        cache_key: &str,
    ) -> Result<Option<RenderCacheEntry>, McpError> {
        let row = sqlx::query(&format!(
            r#"
            SELECT cache_key, template_id, render_hint, schema_fingerprint, runtime_mode, artifact_path, source, created_at, updated_at
            FROM {RENDER_CACHE_ENTRY_TABLE}
            WHERE cache_key = ?
            LIMIT 1
            "#
        ))
        .bind(cache_key)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(row_to_render_cache_entry).transpose()
    }

    pub async fn upsert_render_cache_entry(
        &self,
        entry: &RenderCacheEntry,
    ) -> Result<(), McpError> {
        sqlx::query(&format!(
            r#"
            INSERT INTO {RENDER_CACHE_ENTRY_TABLE}
              (cache_key, template_id, render_hint, schema_fingerprint, runtime_mode, artifact_path, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
              template_id = excluded.template_id,
              render_hint = excluded.render_hint,
              schema_fingerprint = excluded.schema_fingerprint,
              runtime_mode = excluded.runtime_mode,
              artifact_path = excluded.artifact_path,
              source = excluded.source,
              updated_at = excluded.updated_at
            "#
        ))
        .bind(&entry.cache_key)
        .bind(&entry.template_id)
        .bind(&entry.render_hint)
        .bind(&entry.schema_fingerprint)
        .bind(&entry.runtime_mode)
        .bind(&entry.artifact_path)
        .bind(&entry.source)
        .bind(&entry.created_at)
        .bind(&entry.updated_at)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }
}

fn row_to_render_cache_entry(row: sqlx::sqlite::SqliteRow) -> Result<RenderCacheEntry, McpError> {
    Ok(RenderCacheEntry {
        cache_key: row
            .try_get("cache_key")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        template_id: row
            .try_get("template_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        render_hint: row
            .try_get("render_hint")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        schema_fingerprint: row
            .try_get("schema_fingerprint")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        runtime_mode: row
            .try_get("runtime_mode")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        artifact_path: row
            .try_get("artifact_path")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        source: row
            .try_get("source")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        created_at: row
            .try_get("created_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
    })
}
