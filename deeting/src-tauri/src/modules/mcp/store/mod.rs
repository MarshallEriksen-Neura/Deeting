use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};

use crate::modules::admin::store_init::init_admin_tables;
use crate::modules::assistants::store::init_assistant_tables;
use crate::modules::conversations::store::init_conversation_tables;
use crate::modules::desktop_config::store_init::init_desktop_config_table;
use crate::modules::mcp::commands::runtime::capability_registry_cache::CapabilityRegistryBaseCache;
use crate::modules::mcp::error::McpError;
use crate::modules::providers::store::secret_store::SecretStore;
use crate::modules::skills::store_init::init_skill_tables;
use mcp_core::types::{
    McpConflictStatus, McpSource, McpSourceStatus, McpSourceType, McpTool, McpToolConfigPayload,
    McpToolStatus, McpTrustLevel,
};

const DEFAULT_LOCAL_SOURCE_PATH: &str = "~/.config/deeting/mcp.json";
const DEFAULT_CLOUD_SOURCE_NAME: &str = "Deeting Cloud";

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
        .execute(&self.pool)
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

        self.purge_legacy_skill_mcp_rows().await?;
        Ok(())
    }
}
