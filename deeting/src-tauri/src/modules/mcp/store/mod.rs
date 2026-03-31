use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;

use crate::modules::admin::store_init::init_admin_tables;
use crate::modules::asset_registry::store::init_asset_registry_tables;
use crate::modules::assistants::store::init_assistant_tables;
use crate::modules::conversations::store::init_conversation_tables;
use crate::modules::desktop_config::store_init::init_desktop_config_table;
use crate::modules::mcp::commands::runtime::capability_registry_cache::CapabilityRegistryBaseCache;
use crate::modules::mcp::error::McpError;
use crate::modules::providers::store::secret_store::SecretStore;
use crate::modules::render_runtime::store::init_render_runtime_tables;
use crate::modules::skills::store_init::init_skill_tables;
use mcp_core::types::{
    McpConflictStatus, McpSource, McpSourceStatus, McpSourceType, McpTool, McpToolConfigPayload,
    McpToolStatus, McpTrustLevel,
};

const DEFAULT_LOCAL_SOURCE_PATH: &str = "~/.config/deeting/mcp.json";
const DEFAULT_CLOUD_SOURCE_NAME: &str = "Deeting Cloud";
const QUERY_AFFINITY_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const QUERY_AFFINITY_MAX_ROWS_PER_TARGET: i64 = 12;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolExecutionAffinityRow {
    pub tool_name: String,
    pub success_count: i64,
    pub last_used_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolQueryAffinityRow {
    pub query_text: String,
    pub tool_name: String,
    pub success_count: i64,
    pub last_matched_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssetExecutionAffinityRow {
    pub asset_id: String,
    pub success_count: i64,
    pub last_used_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssetQueryAffinityRow {
    pub query_text: String,
    pub asset_id: String,
    pub success_count: i64,
    pub last_matched_at_unix_ms: i64,
}

pub struct McpStore {
    pub(crate) pool: SqlitePool,
    /// Single-connection pool dedicated to write transactions.
    /// Serializes all transactional writes at the pool level, eliminating
    /// SQLite "database is locked" errors from concurrent write contention.
    pub(crate) write_pool: SqlitePool,
    pub(crate) secret_store: SecretStore,
    pub(crate) capability_registry_base_cache: CapabilityRegistryBaseCache,
}

pub use mcp_storage::types::{
    ExtractedToolFields, LocalConversationSummaryJob, LocalPeriodicTask, LocalSkillInstallDetail,
    LocalSkillInstallSnapshot, LocalSkillToolBindingSnapshot, LocalSkillToolBindingUpsert,
    NewSource, ToolUpsert,
};

mod helpers;
mod sources;
mod tool_registry;
mod tools;

#[cfg(test)]
mod tests;

impl McpStore {
    pub async fn new(database_url: &str) -> Result<Self, McpError> {
        let options = SqliteConnectOptions::from_str(database_url)
            .map_err(|err| McpError::Storage(err.to_string()))?
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options.clone())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let write_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let secret_store =
            SecretStore::new(database_url).map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(Self {
            pool,
            write_pool,
            secret_store,
            capability_registry_base_cache: CapabilityRegistryBaseCache::new(),
        })
    }

    pub fn with_pool(pool: SqlitePool) -> Self {
        let secret_store =
            SecretStore::new("sqlite::memory:").expect("init in-memory secret store for mcp");
        Self {
            write_pool: pool.clone(),
            pool,
            secret_store,
            capability_registry_base_cache: CapabilityRegistryBaseCache::new(),
        }
    }

    pub fn with_pool_and_write_pool(
        pool: SqlitePool,
        write_pool: SqlitePool,
        database_url: &str,
    ) -> Result<Self, McpError> {
        let secret_store =
            SecretStore::new(database_url).map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(Self {
            pool,
            write_pool,
            secret_store,
            capability_registry_base_cache: CapabilityRegistryBaseCache::new(),
        })
    }

    /// Begin a write transaction on the dedicated single-connection write pool.
    /// This serializes all transactional writes at the application level,
    /// preventing SQLite "database is locked" (SQLITE_BUSY) errors.
    pub(crate) async fn begin_write(
        &self,
    ) -> Result<sqlx::Transaction<'_, sqlx::Sqlite>, McpError> {
        self.write_pool
            .begin()
            .await
            .map_err(|err| McpError::Storage(err.to_string()))
    }

    pub async fn init(&self) -> Result<(), McpError> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS mcp_sources (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              source_type TEXT NOT NULL,
              path_or_url TEXT NOT NULL,
              trust_level TEXT NOT NULL,
              status TEXT NOT NULL,
              last_synced_at TEXT,
              is_read_only INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS mcp_tools (
              id TEXT PRIMARY KEY,
              source_id TEXT NOT NULL,
              identifier TEXT,
              name TEXT NOT NULL,
              source_type TEXT NOT NULL,
              status TEXT NOT NULL,
              ping_ms INTEGER,
              capabilities TEXT NOT NULL,
              description TEXT NOT NULL,
              error TEXT,
              command TEXT,
              args TEXT,
              env TEXT,
              config_json TEXT NOT NULL,
              config_hash TEXT NOT NULL,
              pending_config_json TEXT,
              pending_config_hash TEXT,
              conflict_status TEXT NOT NULL,
              is_read_only INTEGER NOT NULL,
              is_new INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (source_id) REFERENCES mcp_sources(id)
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        init_assistant_tables(self).await?;

        init_skill_tables(self).await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS gateway_log (
              id TEXT PRIMARY KEY,
              user_id TEXT,
              trace_id TEXT,
              api_key_id TEXT,
              preset_id TEXT,
              model TEXT NOT NULL,
              status_code INTEGER NOT NULL,
              duration_ms INTEGER NOT NULL,
              ttft_ms INTEGER,
              upstream_url TEXT,
              retry_count INTEGER NOT NULL DEFAULT 0,
              input_tokens INTEGER NOT NULL DEFAULT 0,
              output_tokens INTEGER NOT NULL DEFAULT 0,
              total_tokens INTEGER NOT NULL DEFAULT 0,
              cost_upstream REAL NOT NULL DEFAULT 0,
              cost_user REAL NOT NULL DEFAULT 0,
              is_cached INTEGER NOT NULL DEFAULT 0,
              error_code TEXT,
              meta TEXT,
              created_at TEXT NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_trace_id
            ON gateway_log(trace_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_user_id
            ON gateway_log(user_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_api_key_id
            ON gateway_log(api_key_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_preset_id
            ON gateway_log(preset_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_status_code
            ON gateway_log(status_code);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_model
            ON gateway_log(model);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_created_at
            ON gateway_log(created_at);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS tool_execution_history (
              id TEXT PRIMARY KEY,
              session_id TEXT,
              tool_name TEXT NOT NULL,
              success INTEGER NOT NULL,
              created_at_unix_ms INTEGER NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_tool_execution_history_tool_name_created_at
            ON tool_execution_history(tool_name, created_at_unix_ms DESC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_tool_execution_history_session_id_created_at
            ON tool_execution_history(session_id, created_at_unix_ms DESC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS tool_query_affinity (
              query_text TEXT NOT NULL,
              tool_name TEXT NOT NULL,
              success_count INTEGER NOT NULL DEFAULT 0,
              last_matched_at_unix_ms INTEGER NOT NULL,
              PRIMARY KEY (query_text, tool_name)
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_tool_query_affinity_last_matched
            ON tool_query_affinity(last_matched_at_unix_ms DESC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS asset_execution_history (
              id TEXT PRIMARY KEY,
              session_id TEXT,
              asset_id TEXT NOT NULL,
              success INTEGER NOT NULL,
              created_at_unix_ms INTEGER NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_asset_execution_history_asset_id_created_at
            ON asset_execution_history(asset_id, created_at_unix_ms DESC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_asset_execution_history_session_id_created_at
            ON asset_execution_history(session_id, created_at_unix_ms DESC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS asset_query_affinity (
              query_text TEXT NOT NULL,
              asset_id TEXT NOT NULL,
              success_count INTEGER NOT NULL DEFAULT 0,
              last_matched_at_unix_ms INTEGER NOT NULL,
              PRIMARY KEY (query_text, asset_id)
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_asset_query_affinity_last_matched
            ON asset_query_affinity(last_matched_at_unix_ms DESC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        init_admin_tables(self).await?;

        init_conversation_tables(self).await?;

        self.ensure_column(
            "mcp_tools",
            "identifier",
            "ALTER TABLE mcp_tools ADD COLUMN identifier TEXT;",
        )
        .await?;

        self.ensure_column(
            "mcp_tools",
            "pending_config_json",
            "ALTER TABLE mcp_tools ADD COLUMN pending_config_json TEXT;",
        )
        .await?;

        self.ensure_column(
            "mcp_tools",
            "pending_config_hash",
            "ALTER TABLE mcp_tools ADD COLUMN pending_config_hash TEXT;",
        )
        .await?;

        self.ensure_column(
            "mcp_tools",
            "is_new",
            "ALTER TABLE mcp_tools ADD COLUMN is_new INTEGER NOT NULL DEFAULT 0;",
        )
        .await?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_source_name
            ON mcp_tools(source_id, name);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_source_identifier
            ON mcp_tools(source_id, identifier);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        init_desktop_config_table(self).await?;
        init_render_runtime_tables(self).await?;
        init_asset_registry_tables(self).await?;

        self.purge_legacy_skill_mcp_rows().await?;
        Ok(())
    }

    pub async fn record_tool_execution(
        &self,
        session_id: Option<&str>,
        tool_name: &str,
        success: bool,
    ) -> Result<(), McpError> {
        let normalized_tool_name = tool_name.trim();
        if normalized_tool_name.is_empty() {
            return Ok(());
        }
        let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        sqlx::query(
            r#"
            INSERT INTO tool_execution_history (
              id, session_id, tool_name, success, created_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(session_id.map(str::trim).filter(|value| !value.is_empty()))
        .bind(normalized_tool_name)
        .bind(if success { 1_i64 } else { 0_i64 })
        .bind(now as i64)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn list_tool_execution_affinity_rows(
        &self,
        limit: usize,
    ) -> Result<Vec<ToolExecutionAffinityRow>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT
              tool_name,
              COUNT(*) as success_count,
              MAX(created_at_unix_ms) as last_used_at_unix_ms
            FROM tool_execution_history
            WHERE success = 1
            GROUP BY tool_name
            ORDER BY last_used_at_unix_ms DESC
            LIMIT ?
            "#,
        )
        .bind(limit.max(1) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(ToolExecutionAffinityRow {
                    tool_name: row
                        .try_get::<String, _>("tool_name")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    success_count: row
                        .try_get::<i64, _>("success_count")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    last_used_at_unix_ms: row
                        .try_get::<i64, _>("last_used_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                })
            })
            .collect()
    }

    pub async fn upsert_tool_query_affinity(
        &self,
        query_text: &str,
        tool_name: &str,
    ) -> Result<(), McpError> {
        let normalized_query_text = query_text.trim().to_lowercase();
        let normalized_tool_name = tool_name.trim().to_ascii_lowercase();
        if normalized_query_text.is_empty() || normalized_tool_name.is_empty() {
            return Ok(());
        }
        let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        sqlx::query(
            r#"
            INSERT INTO tool_query_affinity (
              query_text, tool_name, success_count, last_matched_at_unix_ms
            ) VALUES (?, ?, 1, ?)
            ON CONFLICT(query_text, tool_name) DO UPDATE SET
              success_count = success_count + 1,
              last_matched_at_unix_ms = excluded.last_matched_at_unix_ms
            "#,
        )
        .bind(normalized_query_text)
        .bind(normalized_tool_name.as_str())
        .bind(now as i64)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let retention_cutoff = now as i64 - QUERY_AFFINITY_RETENTION_MS;
        sqlx::query(
            r#"
            DELETE FROM tool_query_affinity
            WHERE last_matched_at_unix_ms < ?
            "#,
        )
        .bind(retention_cutoff)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM tool_query_affinity
            WHERE tool_name = ?
              AND query_text NOT IN (
                SELECT query_text
                FROM tool_query_affinity
                WHERE tool_name = ?
                ORDER BY last_matched_at_unix_ms DESC, success_count DESC, query_text ASC
                LIMIT ?
              )
            "#,
        )
        .bind(normalized_tool_name.as_str())
        .bind(normalized_tool_name.as_str())
        .bind(QUERY_AFFINITY_MAX_ROWS_PER_TARGET)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn list_tool_query_affinity_rows(
        &self,
        limit: usize,
    ) -> Result<Vec<ToolQueryAffinityRow>, McpError> {
        let retention_cutoff = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000
            - QUERY_AFFINITY_RETENTION_MS as i128;
        let rows = sqlx::query(
            r#"
            SELECT query_text, tool_name, success_count, last_matched_at_unix_ms
            FROM tool_query_affinity
            WHERE last_matched_at_unix_ms >= ?
            ORDER BY last_matched_at_unix_ms DESC, success_count DESC
            LIMIT ?
            "#,
        )
        .bind(retention_cutoff as i64)
        .bind(limit.max(1) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(ToolQueryAffinityRow {
                    query_text: row
                        .try_get::<String, _>("query_text")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    tool_name: row
                        .try_get::<String, _>("tool_name")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    success_count: row
                        .try_get::<i64, _>("success_count")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    last_matched_at_unix_ms: row
                        .try_get::<i64, _>("last_matched_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                })
            })
            .collect()
    }

    pub async fn record_asset_execution(
        &self,
        session_id: Option<&str>,
        asset_id: &str,
        success: bool,
    ) -> Result<(), McpError> {
        let normalized_asset_id = asset_id.trim();
        if normalized_asset_id.is_empty() {
            return Ok(());
        }
        let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        sqlx::query(
            r#"
            INSERT INTO asset_execution_history (
              id, session_id, asset_id, success, created_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(session_id.map(str::trim).filter(|value| !value.is_empty()))
        .bind(normalized_asset_id)
        .bind(if success { 1_i64 } else { 0_i64 })
        .bind(now as i64)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn list_asset_execution_affinity_rows(
        &self,
        limit: usize,
    ) -> Result<Vec<AssetExecutionAffinityRow>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT
              asset_id,
              COUNT(*) as success_count,
              MAX(created_at_unix_ms) as last_used_at_unix_ms
            FROM asset_execution_history
            WHERE success = 1
            GROUP BY asset_id
            ORDER BY last_used_at_unix_ms DESC
            LIMIT ?
            "#,
        )
        .bind(limit.max(1) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(AssetExecutionAffinityRow {
                    asset_id: row
                        .try_get::<String, _>("asset_id")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    success_count: row
                        .try_get::<i64, _>("success_count")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    last_used_at_unix_ms: row
                        .try_get::<i64, _>("last_used_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                })
            })
            .collect()
    }

    pub async fn list_recent_session_asset_ids(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<String>, McpError> {
        let normalized_session_id = session_id.trim();
        if normalized_session_id.is_empty() {
            return Ok(Vec::new());
        }

        let rows = sqlx::query(
            r#"
            SELECT asset_id, MAX(created_at_unix_ms) AS last_used_at_unix_ms
            FROM asset_execution_history
            WHERE session_id = ?
              AND success = 1
            GROUP BY asset_id
            ORDER BY last_used_at_unix_ms DESC
            LIMIT ?
            "#,
        )
        .bind(normalized_session_id)
        .bind(limit.max(1) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                row.try_get::<String, _>("asset_id")
                    .map_err(|err| McpError::Storage(err.to_string()))
            })
            .collect()
    }

    pub async fn upsert_asset_query_affinity(
        &self,
        query_text: &str,
        asset_id: &str,
    ) -> Result<(), McpError> {
        let normalized_query_text = query_text.trim().to_lowercase();
        let normalized_asset_id = asset_id.trim().to_ascii_lowercase();
        if normalized_query_text.is_empty() || normalized_asset_id.is_empty() {
            return Ok(());
        }
        let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        sqlx::query(
            r#"
            INSERT INTO asset_query_affinity (
              query_text, asset_id, success_count, last_matched_at_unix_ms
            ) VALUES (?, ?, 1, ?)
            ON CONFLICT(query_text, asset_id) DO UPDATE SET
              success_count = success_count + 1,
              last_matched_at_unix_ms = excluded.last_matched_at_unix_ms
            "#,
        )
        .bind(normalized_query_text)
        .bind(normalized_asset_id.as_str())
        .bind(now as i64)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let retention_cutoff = now as i64 - QUERY_AFFINITY_RETENTION_MS;
        sqlx::query(
            r#"
            DELETE FROM asset_query_affinity
            WHERE last_matched_at_unix_ms < ?
            "#,
        )
        .bind(retention_cutoff)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM asset_query_affinity
            WHERE asset_id = ?
              AND query_text NOT IN (
                SELECT query_text
                FROM asset_query_affinity
                WHERE asset_id = ?
                ORDER BY last_matched_at_unix_ms DESC, success_count DESC, query_text ASC
                LIMIT ?
              )
            "#,
        )
        .bind(normalized_asset_id.as_str())
        .bind(normalized_asset_id.as_str())
        .bind(QUERY_AFFINITY_MAX_ROWS_PER_TARGET)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn list_asset_query_affinity_rows(
        &self,
        limit: usize,
    ) -> Result<Vec<AssetQueryAffinityRow>, McpError> {
        let retention_cutoff = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000
            - QUERY_AFFINITY_RETENTION_MS as i128;
        let rows = sqlx::query(
            r#"
            SELECT query_text, asset_id, success_count, last_matched_at_unix_ms
            FROM asset_query_affinity
            WHERE last_matched_at_unix_ms >= ?
            ORDER BY last_matched_at_unix_ms DESC, success_count DESC
            LIMIT ?
            "#,
        )
        .bind(retention_cutoff as i64)
        .bind(limit.max(1) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(AssetQueryAffinityRow {
                    query_text: row
                        .try_get::<String, _>("query_text")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    asset_id: row
                        .try_get::<String, _>("asset_id")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    success_count: row
                        .try_get::<i64, _>("success_count")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    last_matched_at_unix_ms: row
                        .try_get::<i64, _>("last_matched_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                })
            })
            .collect()
    }
}
