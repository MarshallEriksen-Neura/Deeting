use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

pub(crate) async fn init_admin_tables(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS system_asset (
          asset_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          asset_kind TEXT NOT NULL,
          owner_scope TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          version TEXT NOT NULL,
          artifact_ref TEXT,
          checksum TEXT,
          metadata_json TEXT NOT NULL,
          visibility_scope TEXT NOT NULL,
          local_sync_policy TEXT NOT NULL,
          execution_policy TEXT NOT NULL,
          permission_grants_json TEXT NOT NULL,
          allowed_role_names_json TEXT NOT NULL,
          materialization_state TEXT NOT NULL,
          sync_source TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_system_asset_status_kind
        ON system_asset(status, asset_kind);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS maintenance_log (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          message TEXT NOT NULL,
          details TEXT,
          created_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_maintenance_log_kind
        ON maintenance_log(kind);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_maintenance_log_status
        ON maintenance_log(status);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_maintenance_log_created_at
        ON maintenance_log(created_at);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS trace_feedback (
          id TEXT PRIMARY KEY,
          trace_id TEXT NOT NULL,
          user_id TEXT,
          score REAL NOT NULL,
          comment TEXT,
          tags TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_trace_feedback_trace_id
        ON trace_feedback(trace_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS ix_trace_feedback_trace_user
        ON trace_feedback(trace_id, user_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(())
}
