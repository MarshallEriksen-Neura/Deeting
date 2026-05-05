use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

pub(crate) async fn init_external_source_tables(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS external_sources (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          connector_type TEXT NOT NULL,
          auth_mode TEXT NOT NULL,
          base_url TEXT,
          is_enabled INTEGER NOT NULL DEFAULT 0,
          sync_mode TEXT NOT NULL DEFAULT 'manual',
          sync_interval_minutes INTEGER NOT NULL DEFAULT 360,
          status TEXT NOT NULL DEFAULT 'draft',
          last_synced_at TEXT,
          last_error TEXT,
          trust_level TEXT NOT NULL DEFAULT 'community',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS external_source_credentials (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL UNIQUE REFERENCES external_sources(id) ON DELETE CASCADE,
          credential_kind TEXT NOT NULL,
          secret_ciphertext TEXT NOT NULL DEFAULT '',
          secret_key_version INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS external_raw_records (
          id TEXT PRIMARY KEY,
          record_key TEXT NOT NULL UNIQUE,
          source_id TEXT NOT NULL REFERENCES external_sources(id) ON DELETE CASCADE,
          source_asset_id TEXT NOT NULL,
          source_version TEXT,
          asset_family TEXT NOT NULL,
          observed_at_unix_ms INTEGER NOT NULL,
          freshness_hint REAL,
          content_hash TEXT NOT NULL,
          raw_payload_json TEXT NOT NULL,
          translation_status TEXT NOT NULL DEFAULT 'pending',
          translated_at_unix_ms INTEGER,
          translation_error TEXT
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_external_sources_status
        ON external_sources(is_enabled, sync_mode, status, updated_at DESC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_external_raw_records_source_observed
        ON external_raw_records(source_id, observed_at_unix_ms DESC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_external_raw_records_translation
        ON external_raw_records(translation_status, observed_at_unix_ms ASC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS external_experience_candidates (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES external_sources(id) ON DELETE CASCADE,
          raw_record_id TEXT NOT NULL UNIQUE REFERENCES external_raw_records(id) ON DELETE CASCADE,
          candidate_kind TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          canonical_payload_json TEXT NOT NULL,
          provenance_json TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0,
          validation_status TEXT NOT NULL DEFAULT 'provisional',
          review_status TEXT NOT NULL DEFAULT 'pending',
          rejected_reason TEXT,
          accepted_target TEXT,
          accepted_ref TEXT,
          adoption_status TEXT NOT NULL DEFAULT 'not_adopted',
          adopted_memory_id TEXT,
          adoption_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          accepted_at TEXT,
          adopted_at TEXT
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    for statement in [
        "ALTER TABLE external_experience_candidates ADD COLUMN adoption_status TEXT NOT NULL DEFAULT 'not_adopted';",
        "ALTER TABLE external_experience_candidates ADD COLUMN adopted_memory_id TEXT;",
        "ALTER TABLE external_experience_candidates ADD COLUMN adoption_error TEXT;",
        "ALTER TABLE external_experience_candidates ADD COLUMN adopted_at TEXT;",
    ] {
        match sqlx::query(statement).execute(&store.write_pool).await {
            Ok(_) => {}
            Err(err) if err.to_string().contains("duplicate column name") => {}
            Err(err) => return Err(McpError::Storage(err.to_string())),
        }
    }

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_external_experience_candidates_source_created
        ON external_experience_candidates(source_id, created_at DESC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_external_experience_candidates_review_validation
        ON external_experience_candidates(review_status, validation_status, updated_at DESC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(())
}
