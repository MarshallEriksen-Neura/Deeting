use std::str::FromStr;

use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;

use crate::modules::admin::store_init::init_admin_tables;
use crate::modules::asset_registry::store::init_asset_registry_tables;
use crate::modules::assistants::store::init_assistant_tables;
use crate::modules::conversations::store::init_conversation_tables;
use crate::modules::desktop_config::store_init::init_desktop_config_table;
use crate::modules::desktop_runtime::runtime::execution_graph_store::init_execution_graph_tables;
use crate::modules::llm_wiki::store::init_llm_wiki_tables;
use crate::modules::mcp::commands::runtime::capability_registry_cache::CapabilityRegistryBaseCache;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::policy::PersistedApprovalAction;
use crate::modules::mcp::risk::approval_classes_from_key;
use crate::modules::providers::store::secret_store::SecretStore;
use crate::modules::render_runtime::store::init_render_runtime_tables;
use crate::modules::skills::store_init::init_skill_tables;
use mcp_core::types::{
    McpConflictStatus, McpSource, McpSourceStatus, McpSourceType, McpTool, McpToolConfigPayload,
    McpToolStatus, McpTrustLevel,
};

const DEFAULT_LOCAL_SOURCE_PATH: &str = "~/.config/deeting/mcp.json";
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

#[derive(Clone, Debug, PartialEq)]
pub struct TaskPolicyPriorRow {
    pub fingerprint_key: String,
    pub decision_point: String,
    pub action_key: String,
    pub weight: f64,
    pub confidence: f64,
    pub evidence_count: i64,
    pub maturity: String,
    pub updated_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskLearningRunRow {
    pub run_id: String,
    pub session_id: String,
    pub request_id: Option<String>,
    pub trace_id: Option<String>,
    pub fingerprint_key: String,
    pub task_fingerprint_json: String,
    pub route_decision_json: Option<String>,
    pub execution_policy_json: String,
    pub outcome_json: String,
    pub attribution_json: String,
    pub policy_delta_json: Option<String>,
    pub learning_eligible: bool,
    pub delta_state: String,
    pub revision_count: i64,
    pub last_signal: Option<String>,
    pub created_at_unix_ms: i64,
    pub last_revision_at_unix_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskLearningRevisionRow {
    pub id: String,
    pub run_id: String,
    pub revision_index: i64,
    pub trigger_source: String,
    pub user_response_signal: String,
    pub note: Option<String>,
    pub outcome_json: String,
    pub attribution_json: String,
    pub policy_delta_json: Option<String>,
    pub delta_state: String,
    pub created_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolApprovalRuleRow {
    pub key: String,
    pub action: PersistedApprovalAction,
    pub tool_name: String,
    pub tool_fingerprint: String,
    pub risk_level: Option<String>,
    pub auto_promoted: bool,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
    pub expires_at_unix_ms: Option<i64>,
    pub approve_count: i64,
    pub reject_count: i64,
    pub last_approved_at_unix_ms: Option<i64>,
    pub last_rejected_at_unix_ms: Option<i64>,
    pub half_life_days: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolApprovalLearningSummaryRow {
    pub operation_class: String,
    pub target_class: String,
    pub boundary_class: String,
    pub observed_approvals: i64,
    pub observed_rejections: i64,
    pub auto_promoted_rules: i64,
    pub explicit_allow_rules: i64,
    pub explicit_deny_rules: i64,
    pub last_approved_at_unix_ms: Option<i64>,
    pub last_rejected_at_unix_ms: Option<i64>,
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
              service_key TEXT,
              service_display_name TEXT,
              service_description TEXT,
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_trace_id
            ON gateway_log(trace_id);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_user_id
            ON gateway_log(user_id);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_api_key_id
            ON gateway_log(api_key_id);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_preset_id
            ON gateway_log(preset_id);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_status_code
            ON gateway_log(status_code);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_model
            ON gateway_log(model);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_gateway_log_created_at
            ON gateway_log(created_at);
            "#,
        )
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS tool_approval_rules (
              key TEXT PRIMARY KEY,
              action TEXT NOT NULL,
              tool_name TEXT NOT NULL,
              tool_fingerprint TEXT NOT NULL,
              risk_level TEXT,
              auto_promoted INTEGER NOT NULL DEFAULT 0,
              created_at_unix_ms INTEGER NOT NULL,
              updated_at_unix_ms INTEGER NOT NULL,
              expires_at_unix_ms INTEGER,
              approve_count INTEGER NOT NULL DEFAULT 0,
              reject_count INTEGER NOT NULL DEFAULT 0,
              last_approved_at_unix_ms INTEGER,
              last_rejected_at_unix_ms INTEGER,
              half_life_days INTEGER NOT NULL DEFAULT 7
            );
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        for statement in [
            "ALTER TABLE tool_approval_rules ADD COLUMN auto_promoted INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE tool_approval_rules ADD COLUMN last_approved_at_unix_ms INTEGER",
            "ALTER TABLE tool_approval_rules ADD COLUMN last_rejected_at_unix_ms INTEGER",
            "ALTER TABLE tool_approval_rules ADD COLUMN half_life_days INTEGER NOT NULL DEFAULT 7",
        ] {
            if let Err(err) = sqlx::query(statement).execute(&self.write_pool).await {
                let text = err.to_string();
                if !text.contains("duplicate column name") {
                    return Err(McpError::Storage(text));
                }
            }
        }

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_tool_approval_rules_updated_at
            ON tool_approval_rules(updated_at_unix_ms DESC);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_tool_execution_history_tool_name_created_at
            ON tool_execution_history(tool_name, created_at_unix_ms DESC);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_tool_execution_history_session_id_created_at
            ON tool_execution_history(session_id, created_at_unix_ms DESC);
            "#,
        )
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_tool_query_affinity_last_matched
            ON tool_query_affinity(last_matched_at_unix_ms DESC);
            "#,
        )
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_asset_execution_history_asset_id_created_at
            ON asset_execution_history(asset_id, created_at_unix_ms DESC);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_asset_execution_history_session_id_created_at
            ON asset_execution_history(session_id, created_at_unix_ms DESC);
            "#,
        )
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS task_policy_priors (
              fingerprint_key TEXT NOT NULL,
              decision_point TEXT NOT NULL,
              action_key TEXT NOT NULL,
              weight REAL NOT NULL DEFAULT 0,
              confidence REAL NOT NULL DEFAULT 0,
              evidence_count INTEGER NOT NULL DEFAULT 0,
              maturity TEXT NOT NULL DEFAULT 'provisional',
              last_run_id TEXT,
              created_at_unix_ms INTEGER NOT NULL,
              updated_at_unix_ms INTEGER NOT NULL,
              PRIMARY KEY (fingerprint_key, decision_point, action_key)
            );
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_task_policy_priors_lookup
            ON task_policy_priors(fingerprint_key, decision_point, updated_at_unix_ms DESC);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS task_learning_runs (
              run_id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL,
              request_id TEXT,
              trace_id TEXT,
              fingerprint_key TEXT NOT NULL,
              task_fingerprint_json TEXT NOT NULL,
              route_decision_json TEXT,
              execution_policy_json TEXT NOT NULL,
              outcome_json TEXT NOT NULL,
              attribution_json TEXT NOT NULL,
              policy_delta_json TEXT,
              learning_eligible INTEGER NOT NULL DEFAULT 0,
              delta_state TEXT NOT NULL DEFAULT 'none',
              last_signal TEXT,
              revision_count INTEGER NOT NULL DEFAULT 0,
              last_revision_at_unix_ms INTEGER,
              created_at_unix_ms INTEGER NOT NULL
            );
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_task_learning_runs_session
            ON task_learning_runs(session_id, created_at_unix_ms DESC);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS task_learning_revisions (
              id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL,
              revision_index INTEGER NOT NULL,
              trigger_source TEXT NOT NULL,
              user_response_signal TEXT NOT NULL,
              note TEXT,
              outcome_json TEXT NOT NULL,
              attribution_json TEXT NOT NULL,
              policy_delta_json TEXT,
              delta_state TEXT NOT NULL DEFAULT 'none',
              created_at_unix_ms INTEGER NOT NULL
            );
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_task_learning_revisions_run
            ON task_learning_revisions(run_id, revision_index DESC, created_at_unix_ms DESC);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS posterior_signal_events (
              id TEXT PRIMARY KEY,
              run_id TEXT,
              session_id TEXT,
              trace_id TEXT,
              source TEXT NOT NULL,
              signal TEXT NOT NULL,
              confidence REAL NOT NULL DEFAULT 0,
              input_json TEXT,
              note TEXT,
              created_at_unix_ms INTEGER NOT NULL
            );
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_posterior_signal_events_trace
            ON posterior_signal_events(trace_id, created_at_unix_ms DESC);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_asset_query_affinity_last_matched
            ON asset_query_affinity(last_matched_at_unix_ms DESC);
            "#,
        )
        .execute(&self.write_pool)
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

        self.ensure_column(
            "mcp_tools",
            "service_key",
            "ALTER TABLE mcp_tools ADD COLUMN service_key TEXT;",
        )
        .await?;

        self.ensure_column(
            "mcp_tools",
            "service_display_name",
            "ALTER TABLE mcp_tools ADD COLUMN service_display_name TEXT;",
        )
        .await?;

        self.ensure_column(
            "task_learning_runs",
            "last_signal",
            "ALTER TABLE task_learning_runs ADD COLUMN last_signal TEXT;",
        )
        .await?;

        self.ensure_column(
            "task_learning_runs",
            "revision_count",
            "ALTER TABLE task_learning_runs ADD COLUMN revision_count INTEGER NOT NULL DEFAULT 0;",
        )
        .await?;

        self.ensure_column(
            "task_learning_runs",
            "last_revision_at_unix_ms",
            "ALTER TABLE task_learning_runs ADD COLUMN last_revision_at_unix_ms INTEGER;",
        )
        .await?;

        self.ensure_column(
            "mcp_tools",
            "service_description",
            "ALTER TABLE mcp_tools ADD COLUMN service_description TEXT;",
        )
        .await?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_source_name
            ON mcp_tools(source_id, name);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_source_identifier
            ON mcp_tools(source_id, identifier);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        init_desktop_config_table(self).await?;
        init_llm_wiki_tables(self).await?;
        init_execution_graph_tables(self).await?;
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

    pub async fn upsert_tool_approval_rule(
        &self,
        key: &str,
        action: PersistedApprovalAction,
        tool_name: &str,
        tool_fingerprint: &str,
        risk_level: Option<&str>,
    ) -> Result<(), McpError> {
        let normalized_key = key.trim();
        let normalized_tool_name = tool_name.trim();
        let normalized_tool_fingerprint = tool_fingerprint.trim();
        if normalized_key.is_empty()
            || normalized_tool_name.is_empty()
            || normalized_tool_fingerprint.is_empty()
        {
            return Ok(());
        }
        let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        let approve_delta = i64::from(matches!(
            action,
            PersistedApprovalAction::AllowOnce | PersistedApprovalAction::AllowAlways
        ));
        let reject_delta = i64::from(matches!(action, PersistedApprovalAction::DenyAlways));
        let last_approved_at_unix_ms = if approve_delta > 0 {
            Some(now as i64)
        } else {
            None
        };
        let last_rejected_at_unix_ms = if reject_delta > 0 {
            Some(now as i64)
        } else {
            None
        };
        let default_expiry_days = match action {
            PersistedApprovalAction::AllowOnce => 7_i64,
            PersistedApprovalAction::AllowAlways => 14_i64,
            PersistedApprovalAction::DenyAlways => 30_i64,
        };
        let expires_at_unix_ms = now as i64 + default_expiry_days * 24 * 60 * 60 * 1000;
        let auto_promoted = i64::from(matches!(action, PersistedApprovalAction::AllowAlways));
        sqlx::query(
            r#"
            INSERT INTO tool_approval_rules (
              key, action, tool_name, tool_fingerprint, risk_level,
              auto_promoted, created_at_unix_ms, updated_at_unix_ms, expires_at_unix_ms,
              approve_count, reject_count, last_approved_at_unix_ms, last_rejected_at_unix_ms,
              half_life_days
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 7)
            ON CONFLICT(key) DO UPDATE SET
              action = excluded.action,
              tool_name = excluded.tool_name,
              tool_fingerprint = excluded.tool_fingerprint,
              risk_level = excluded.risk_level,
              auto_promoted = excluded.auto_promoted,
              updated_at_unix_ms = excluded.updated_at_unix_ms,
              expires_at_unix_ms = excluded.expires_at_unix_ms,
              approve_count = tool_approval_rules.approve_count + excluded.approve_count,
              reject_count = tool_approval_rules.reject_count + excluded.reject_count,
              last_approved_at_unix_ms = COALESCE(excluded.last_approved_at_unix_ms, tool_approval_rules.last_approved_at_unix_ms),
              last_rejected_at_unix_ms = COALESCE(excluded.last_rejected_at_unix_ms, tool_approval_rules.last_rejected_at_unix_ms)
            "#,
        )
        .bind(normalized_key)
        .bind(action.as_str())
        .bind(normalized_tool_name)
        .bind(normalized_tool_fingerprint)
        .bind(risk_level.map(str::trim).filter(|value| !value.is_empty()))
        .bind(auto_promoted)
        .bind(now as i64)
        .bind(now as i64)
        .bind(expires_at_unix_ms)
        .bind(approve_delta)
        .bind(reject_delta)
        .bind(last_approved_at_unix_ms)
        .bind(last_rejected_at_unix_ms)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn promote_tool_approval_rule_to_allow_always(
        &self,
        key: &str,
        ttl_days: i64,
    ) -> Result<(), McpError> {
        let normalized_key = key.trim();
        if normalized_key.is_empty() {
            return Ok(());
        }
        let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        let ttl_ms = ttl_days.max(1) * 24 * 60 * 60 * 1000;
        sqlx::query(
            r#"
            UPDATE tool_approval_rules
            SET action = ?, auto_promoted = 1, updated_at_unix_ms = ?, expires_at_unix_ms = ?
            WHERE key = ?
            "#,
        )
        .bind(PersistedApprovalAction::AllowAlways.as_str())
        .bind(now as i64)
        .bind(now as i64 + ttl_ms)
        .bind(normalized_key)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn get_tool_approval_rule(
        &self,
        key: &str,
    ) -> Result<Option<ToolApprovalRuleRow>, McpError> {
        let normalized_key = key.trim();
        if normalized_key.is_empty() {
            return Ok(None);
        }
        let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        sqlx::query(
            r#"
            DELETE FROM tool_approval_rules
            WHERE expires_at_unix_ms IS NOT NULL
              AND expires_at_unix_ms <= ?
            "#,
        )
        .bind(now as i64)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let row = sqlx::query(
            r#"
            SELECT
              key, action, tool_name, tool_fingerprint, risk_level,
              auto_promoted, created_at_unix_ms, updated_at_unix_ms, expires_at_unix_ms,
              approve_count, reject_count, last_approved_at_unix_ms, last_rejected_at_unix_ms,
              half_life_days
            FROM tool_approval_rules
            WHERE key = ?
            LIMIT 1
            "#,
        )
        .bind(normalized_key)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| {
            let action_text = row
                .try_get::<String, _>("action")
                .map_err(|err| McpError::Storage(err.to_string()))?;
            let action = PersistedApprovalAction::from_str(&action_text).ok_or_else(|| {
                McpError::Storage(format!("unknown approval action: {action_text}"))
            })?;
            Ok(ToolApprovalRuleRow {
                key: row
                    .try_get::<String, _>("key")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                action,
                tool_name: row
                    .try_get::<String, _>("tool_name")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                tool_fingerprint: row
                    .try_get::<String, _>("tool_fingerprint")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                risk_level: row
                    .try_get::<Option<String>, _>("risk_level")
                    .ok()
                    .flatten(),
                auto_promoted: row
                    .try_get::<i64, _>("auto_promoted")
                    .map(|value| value != 0)
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                created_at_unix_ms: row
                    .try_get::<i64, _>("created_at_unix_ms")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                updated_at_unix_ms: row
                    .try_get::<i64, _>("updated_at_unix_ms")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                expires_at_unix_ms: row
                    .try_get::<Option<i64>, _>("expires_at_unix_ms")
                    .ok()
                    .flatten(),
                approve_count: row
                    .try_get::<i64, _>("approve_count")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                reject_count: row
                    .try_get::<i64, _>("reject_count")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                last_approved_at_unix_ms: row
                    .try_get::<Option<i64>, _>("last_approved_at_unix_ms")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                last_rejected_at_unix_ms: row
                    .try_get::<Option<i64>, _>("last_rejected_at_unix_ms")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                half_life_days: row
                    .try_get::<i64, _>("half_life_days")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
            })
        })
        .transpose()
    }

    pub async fn list_tool_approval_rules(&self) -> Result<Vec<ToolApprovalRuleRow>, McpError> {
        let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        sqlx::query(
            r#"
            DELETE FROM tool_approval_rules
            WHERE expires_at_unix_ms IS NOT NULL
              AND expires_at_unix_ms <= ?
            "#,
        )
        .bind(now as i64)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let rows = sqlx::query(
            r#"
            SELECT
              key, action, tool_name, tool_fingerprint, risk_level, auto_promoted,
              created_at_unix_ms, updated_at_unix_ms, expires_at_unix_ms,
              approve_count, reject_count, last_approved_at_unix_ms, last_rejected_at_unix_ms,
              half_life_days
            FROM tool_approval_rules
            ORDER BY updated_at_unix_ms DESC, key ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                let action_text = row
                    .try_get::<String, _>("action")
                    .map_err(|err| McpError::Storage(err.to_string()))?;
                let action = PersistedApprovalAction::from_str(&action_text).ok_or_else(|| {
                    McpError::Storage(format!("unknown approval action: {action_text}"))
                })?;
                Ok(ToolApprovalRuleRow {
                    key: row
                        .try_get("key")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    action,
                    tool_name: row
                        .try_get("tool_name")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    tool_fingerprint: row
                        .try_get("tool_fingerprint")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    risk_level: row
                        .try_get::<Option<String>, _>("risk_level")
                        .ok()
                        .flatten(),
                    auto_promoted: row
                        .try_get::<i64, _>("auto_promoted")
                        .map(|value| value != 0)
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    created_at_unix_ms: row
                        .try_get("created_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    updated_at_unix_ms: row
                        .try_get("updated_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    expires_at_unix_ms: row
                        .try_get("expires_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    approve_count: row
                        .try_get("approve_count")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    reject_count: row
                        .try_get("reject_count")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    last_approved_at_unix_ms: row
                        .try_get("last_approved_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    last_rejected_at_unix_ms: row
                        .try_get("last_rejected_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    half_life_days: row
                        .try_get("half_life_days")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                })
            })
            .collect()
    }

    pub async fn delete_tool_approval_rule(&self, key: &str) -> Result<bool, McpError> {
        let normalized_key = key.trim();
        if normalized_key.is_empty() {
            return Ok(false);
        }
        let result = sqlx::query("DELETE FROM tool_approval_rules WHERE key = ?")
            .bind(normalized_key)
            .execute(&self.write_pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn clear_tool_approval_rules(&self, mode: Option<&str>) -> Result<u64, McpError> {
        let normalized_mode = mode
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("all");
        let result = match normalized_mode {
            "allow" => {
                sqlx::query("DELETE FROM tool_approval_rules WHERE action IN (?, ?)")
                    .bind(PersistedApprovalAction::AllowOnce.as_str())
                    .bind(PersistedApprovalAction::AllowAlways.as_str())
                    .execute(&self.write_pool)
                    .await
            }
            _ => {
                sqlx::query("DELETE FROM tool_approval_rules")
                    .execute(&self.write_pool)
                    .await
            }
        }
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected())
    }

    pub async fn reset_tool_approval_learning(&self) -> Result<u64, McpError> {
        let result = sqlx::query(
            r#"
            DELETE FROM tool_approval_rules
            WHERE action = ?
               OR auto_promoted = 1
            "#,
        )
        .bind(PersistedApprovalAction::AllowOnce.as_str())
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected())
    }

    pub async fn get_tool_approval_learning_summary(
        &self,
    ) -> Result<Vec<ToolApprovalLearningSummaryRow>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT
              SUBSTR(key, INSTR(key, '|') + 1) AS suffix,
              SUM(CASE WHEN action = 'allow_once' THEN approve_count ELSE 0 END) AS observed_approvals,
              SUM(CASE WHEN action = 'deny_always' THEN reject_count ELSE 0 END) AS observed_rejections,
              SUM(CASE WHEN auto_promoted = 1 THEN 1 ELSE 0 END) AS auto_promoted_rules,
              SUM(CASE WHEN action = 'allow_always' AND auto_promoted = 0 THEN 1 ELSE 0 END) AS explicit_allow_rules,
              SUM(CASE WHEN action = 'deny_always' THEN 1 ELSE 0 END) AS explicit_deny_rules,
              MAX(last_approved_at_unix_ms) AS last_approved_at_unix_ms,
              MAX(last_rejected_at_unix_ms) AS last_rejected_at_unix_ms
            FROM tool_approval_rules
            GROUP BY suffix
            ORDER BY observed_approvals DESC, explicit_deny_rules DESC, suffix ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                let suffix = row
                    .try_get::<String, _>("suffix")
                    .map_err(|err| McpError::Storage(err.to_string()))?;
                let (operation_class, target_class, boundary_class) =
                    approval_classes_from_key(&suffix);
                Ok(ToolApprovalLearningSummaryRow {
                    operation_class,
                    target_class,
                    boundary_class,
                    observed_approvals: row
                        .try_get::<i64, _>("observed_approvals")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    observed_rejections: row
                        .try_get::<i64, _>("observed_rejections")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    auto_promoted_rules: row
                        .try_get::<i64, _>("auto_promoted_rules")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    explicit_allow_rules: row
                        .try_get::<i64, _>("explicit_allow_rules")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    explicit_deny_rules: row
                        .try_get::<i64, _>("explicit_deny_rules")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    last_approved_at_unix_ms: row
                        .try_get::<Option<i64>, _>("last_approved_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    last_rejected_at_unix_ms: row
                        .try_get::<Option<i64>, _>("last_rejected_at_unix_ms")
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

    pub async fn list_task_policy_prior_rows(
        &self,
        fingerprint_key: &str,
        decision_point: &str,
        limit: usize,
    ) -> Result<Vec<TaskPolicyPriorRow>, McpError> {
        let normalized_fingerprint_key = fingerprint_key.trim();
        let normalized_decision_point = decision_point.trim().to_ascii_lowercase();
        if normalized_fingerprint_key.is_empty() || normalized_decision_point.is_empty() {
            return Ok(Vec::new());
        }

        let rows = sqlx::query(
            r#"
            SELECT
              fingerprint_key,
              decision_point,
              action_key,
              weight,
              confidence,
              evidence_count,
              maturity,
              updated_at_unix_ms
            FROM task_policy_priors
            WHERE fingerprint_key = ?
              AND decision_point = ?
            ORDER BY updated_at_unix_ms DESC, ABS(weight) DESC, action_key ASC
            LIMIT ?
            "#,
        )
        .bind(normalized_fingerprint_key)
        .bind(normalized_decision_point.as_str())
        .bind(limit.max(1) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(TaskPolicyPriorRow {
                    fingerprint_key: row
                        .try_get::<String, _>("fingerprint_key")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    decision_point: row
                        .try_get::<String, _>("decision_point")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    action_key: row
                        .try_get::<String, _>("action_key")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    weight: row
                        .try_get::<f64, _>("weight")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    confidence: row
                        .try_get::<f64, _>("confidence")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    evidence_count: row
                        .try_get::<i64, _>("evidence_count")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    maturity: row
                        .try_get::<String, _>("maturity")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    updated_at_unix_ms: row
                        .try_get::<i64, _>("updated_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                })
            })
            .collect()
    }

    pub async fn count_task_policy_priors(
        &self,
        fingerprint_key: Option<&str>,
        decision_point: Option<&str>,
    ) -> Result<i64, McpError> {
        let normalized_fingerprint_key = fingerprint_key
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let normalized_decision_point = decision_point
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase());
        let row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM task_policy_priors
            WHERE (? IS NULL OR fingerprint_key = ?)
              AND (? IS NULL OR decision_point = ?)
            "#,
        )
        .bind(normalized_fingerprint_key)
        .bind(normalized_fingerprint_key)
        .bind(normalized_decision_point.as_deref())
        .bind(normalized_decision_point.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        row.try_get::<i64, _>("total")
            .map_err(|err| McpError::Storage(err.to_string()))
    }

    pub async fn list_task_policy_priors(
        &self,
        fingerprint_key: Option<&str>,
        decision_point: Option<&str>,
        skip: usize,
        limit: usize,
    ) -> Result<Vec<TaskPolicyPriorRow>, McpError> {
        let normalized_fingerprint_key = fingerprint_key
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let normalized_decision_point = decision_point
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase());
        let rows = sqlx::query(
            r#"
            SELECT
              fingerprint_key,
              decision_point,
              action_key,
              weight,
              confidence,
              evidence_count,
              maturity,
              updated_at_unix_ms
            FROM task_policy_priors
            WHERE (? IS NULL OR fingerprint_key = ?)
              AND (? IS NULL OR decision_point = ?)
            ORDER BY updated_at_unix_ms DESC, ABS(weight) DESC, action_key ASC
            LIMIT ?
            OFFSET ?
            "#,
        )
        .bind(normalized_fingerprint_key)
        .bind(normalized_fingerprint_key)
        .bind(normalized_decision_point.as_deref())
        .bind(normalized_decision_point.as_deref())
        .bind(limit.max(1) as i64)
        .bind(skip as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(TaskPolicyPriorRow {
                    fingerprint_key: row
                        .try_get::<String, _>("fingerprint_key")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    decision_point: row
                        .try_get::<String, _>("decision_point")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    action_key: row
                        .try_get::<String, _>("action_key")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    weight: row
                        .try_get::<f64, _>("weight")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    confidence: row
                        .try_get::<f64, _>("confidence")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    evidence_count: row
                        .try_get::<i64, _>("evidence_count")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    maturity: row
                        .try_get::<String, _>("maturity")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    updated_at_unix_ms: row
                        .try_get::<i64, _>("updated_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                })
            })
            .collect()
    }

    pub async fn adjust_task_policy_prior(
        &self,
        fingerprint_key: &str,
        decision_point: &str,
        action_key: &str,
        weight_delta: f64,
        maturity: &str,
        confidence: f64,
        last_run_id: Option<&str>,
        evidence_delta: i64,
    ) -> Result<(), McpError> {
        let normalized_fingerprint_key = fingerprint_key.trim();
        let normalized_decision_point = decision_point.trim().to_ascii_lowercase();
        let normalized_action_key = action_key.trim().to_ascii_lowercase();
        let normalized_maturity = maturity.trim().to_ascii_lowercase();
        if normalized_fingerprint_key.is_empty()
            || normalized_decision_point.is_empty()
            || normalized_action_key.is_empty()
        {
            return Ok(());
        }

        let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        sqlx::query(
            r#"
            INSERT INTO task_policy_priors (
              fingerprint_key,
              decision_point,
              action_key,
              weight,
              confidence,
              evidence_count,
              maturity,
              last_run_id,
              created_at_unix_ms,
              updated_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fingerprint_key, decision_point, action_key) DO UPDATE SET
              weight = task_policy_priors.weight + excluded.weight,
              confidence = MAX(task_policy_priors.confidence, excluded.confidence),
              evidence_count = MAX(0, task_policy_priors.evidence_count + excluded.evidence_count),
              maturity = excluded.maturity,
              last_run_id = excluded.last_run_id,
              updated_at_unix_ms = excluded.updated_at_unix_ms
            "#,
        )
        .bind(normalized_fingerprint_key)
        .bind(normalized_decision_point.as_str())
        .bind(normalized_action_key.as_str())
        .bind(weight_delta)
        .bind(confidence.clamp(0.0, 1.0))
        .bind(evidence_delta)
        .bind(if normalized_maturity.is_empty() {
            "provisional"
        } else {
            normalized_maturity.as_str()
        })
        .bind(last_run_id.map(str::trim).filter(|value| !value.is_empty()))
        .bind(now as i64)
        .bind(now as i64)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn apply_task_policy_delta(
        &self,
        fingerprint_key: &str,
        decision_point: &str,
        action_key: &str,
        weight_delta: f64,
        maturity: &str,
        confidence: f64,
        last_run_id: Option<&str>,
    ) -> Result<(), McpError> {
        let normalized_fingerprint_key = fingerprint_key.trim();
        let normalized_decision_point = decision_point.trim().to_ascii_lowercase();
        let normalized_action_key = action_key.trim().to_ascii_lowercase();
        let normalized_maturity = maturity.trim().to_ascii_lowercase();
        if normalized_fingerprint_key.is_empty()
            || normalized_decision_point.is_empty()
            || normalized_action_key.is_empty()
        {
            return Ok(());
        }

        self.adjust_task_policy_prior(
            normalized_fingerprint_key,
            normalized_decision_point.as_str(),
            normalized_action_key.as_str(),
            weight_delta,
            if normalized_maturity.is_empty() {
                "provisional"
            } else {
                normalized_maturity.as_str()
            },
            confidence,
            last_run_id,
            1,
        )
        .await
    }

    pub async fn record_task_learning_run(
        &self,
        session_id: &str,
        request_id: Option<&str>,
        trace_id: Option<&str>,
        fingerprint_key: &str,
        task_fingerprint_json: &str,
        route_decision_json: Option<&str>,
        execution_policy_json: &str,
        outcome_json: &str,
        attribution_json: &str,
        policy_delta_json: Option<&str>,
        learning_eligible: bool,
        delta_state: &str,
    ) -> Result<String, McpError> {
        let normalized_session_id = session_id.trim();
        let normalized_fingerprint_key = fingerprint_key.trim();
        let normalized_task_fingerprint_json = task_fingerprint_json.trim();
        let normalized_execution_policy_json = execution_policy_json.trim();
        let normalized_outcome_json = outcome_json.trim();
        let normalized_attribution_json = attribution_json.trim();
        let last_signal = serde_json::from_str::<Value>(normalized_outcome_json)
            .ok()
            .and_then(|value| {
                value
                    .get("user_response_signal")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            });
        if normalized_session_id.is_empty()
            || normalized_fingerprint_key.is_empty()
            || normalized_task_fingerprint_json.is_empty()
            || normalized_execution_policy_json.is_empty()
            || normalized_outcome_json.is_empty()
            || normalized_attribution_json.is_empty()
        {
            return Err(McpError::validation(
                "task learning run requires non-empty session_id, fingerprint, policy, outcome, and attribution payloads",
            ));
        }

        let run_id = uuid::Uuid::new_v4().to_string();
        let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        sqlx::query(
            r#"
            INSERT INTO task_learning_runs (
              run_id,
              session_id,
              request_id,
              trace_id,
              fingerprint_key,
              task_fingerprint_json,
              route_decision_json,
              execution_policy_json,
              outcome_json,
              attribution_json,
              policy_delta_json,
              learning_eligible,
              delta_state,
              last_signal,
              revision_count,
              last_revision_at_unix_ms,
              created_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
            "#,
        )
        .bind(run_id.as_str())
        .bind(normalized_session_id)
        .bind(request_id.map(str::trim).filter(|value| !value.is_empty()))
        .bind(trace_id.map(str::trim).filter(|value| !value.is_empty()))
        .bind(normalized_fingerprint_key)
        .bind(normalized_task_fingerprint_json)
        .bind(
            route_decision_json
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(normalized_execution_policy_json)
        .bind(normalized_outcome_json)
        .bind(normalized_attribution_json)
        .bind(
            policy_delta_json
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(if learning_eligible { 1_i64 } else { 0_i64 })
        .bind(delta_state.trim())
        .bind(last_signal.as_deref())
        .bind(now as i64)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(run_id)
    }

    pub async fn count_task_learning_runs(
        &self,
        session_id: Option<&str>,
        fingerprint_key: Option<&str>,
        decision_point: Option<&str>,
        user_response_signal: Option<&str>,
        learning_eligible: Option<bool>,
    ) -> Result<i64, McpError> {
        let normalized_session_id = session_id.map(str::trim).filter(|value| !value.is_empty());
        let normalized_fingerprint_key = fingerprint_key
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let normalized_decision_point = decision_point
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let normalized_user_response_signal = user_response_signal
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let learning_eligible_flag =
            learning_eligible.map(|value| if value { 1_i64 } else { 0_i64 });
        let row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM task_learning_runs
            WHERE (? IS NULL OR session_id = ?)
              AND (? IS NULL OR fingerprint_key = ?)
              AND (
                    ? IS NULL OR
                    COALESCE(
                      json_extract(policy_delta_json, '$.decision_point'),
                      json_extract(attribution_json, '$.primary_stage')
                    ) = ?
                  )
              AND (? IS NULL OR json_extract(outcome_json, '$.user_response_signal') = ?)
              AND (? IS NULL OR learning_eligible = ?)
            "#,
        )
        .bind(normalized_session_id)
        .bind(normalized_session_id)
        .bind(normalized_fingerprint_key)
        .bind(normalized_fingerprint_key)
        .bind(normalized_decision_point)
        .bind(normalized_decision_point)
        .bind(normalized_user_response_signal)
        .bind(normalized_user_response_signal)
        .bind(learning_eligible_flag)
        .bind(learning_eligible_flag)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        row.try_get::<i64, _>("total")
            .map_err(|err| McpError::Storage(err.to_string()))
    }

    pub async fn list_task_learning_runs(
        &self,
        session_id: Option<&str>,
        fingerprint_key: Option<&str>,
        decision_point: Option<&str>,
        user_response_signal: Option<&str>,
        learning_eligible: Option<bool>,
        skip: usize,
        limit: usize,
    ) -> Result<Vec<TaskLearningRunRow>, McpError> {
        let normalized_session_id = session_id.map(str::trim).filter(|value| !value.is_empty());
        let normalized_fingerprint_key = fingerprint_key
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let normalized_decision_point = decision_point
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let normalized_user_response_signal = user_response_signal
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let learning_eligible_flag =
            learning_eligible.map(|value| if value { 1_i64 } else { 0_i64 });

        let rows = sqlx::query(
            r#"
            SELECT
              run_id,
              session_id,
              request_id,
              trace_id,
              fingerprint_key,
              task_fingerprint_json,
              route_decision_json,
              execution_policy_json,
              outcome_json,
              attribution_json,
              policy_delta_json,
              learning_eligible,
              delta_state,
              revision_count,
              last_signal,
              created_at_unix_ms,
              last_revision_at_unix_ms
            FROM task_learning_runs
            WHERE (? IS NULL OR session_id = ?)
              AND (? IS NULL OR fingerprint_key = ?)
              AND (
                    ? IS NULL OR
                    COALESCE(
                      json_extract(policy_delta_json, '$.decision_point'),
                      json_extract(attribution_json, '$.primary_stage')
                    ) = ?
                  )
              AND (? IS NULL OR json_extract(outcome_json, '$.user_response_signal') = ?)
              AND (? IS NULL OR learning_eligible = ?)
            ORDER BY COALESCE(last_revision_at_unix_ms, created_at_unix_ms) DESC, created_at_unix_ms DESC
            LIMIT ?
            OFFSET ?
            "#,
        )
        .bind(normalized_session_id)
        .bind(normalized_session_id)
        .bind(normalized_fingerprint_key)
        .bind(normalized_fingerprint_key)
        .bind(normalized_decision_point)
        .bind(normalized_decision_point)
        .bind(normalized_user_response_signal)
        .bind(normalized_user_response_signal)
        .bind(learning_eligible_flag)
        .bind(learning_eligible_flag)
        .bind(limit.max(1) as i64)
        .bind(skip as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(TaskLearningRunRow {
                    run_id: row
                        .try_get::<String, _>("run_id")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    session_id: row
                        .try_get::<String, _>("session_id")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    request_id: row
                        .try_get::<Option<String>, _>("request_id")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    trace_id: row
                        .try_get::<Option<String>, _>("trace_id")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    fingerprint_key: row
                        .try_get::<String, _>("fingerprint_key")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    task_fingerprint_json: row
                        .try_get::<String, _>("task_fingerprint_json")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    route_decision_json: row
                        .try_get::<Option<String>, _>("route_decision_json")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    execution_policy_json: row
                        .try_get::<String, _>("execution_policy_json")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    outcome_json: row
                        .try_get::<String, _>("outcome_json")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    attribution_json: row
                        .try_get::<String, _>("attribution_json")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    policy_delta_json: row
                        .try_get::<Option<String>, _>("policy_delta_json")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    learning_eligible: row
                        .try_get::<i64, _>("learning_eligible")
                        .map_err(|err| McpError::Storage(err.to_string()))?
                        > 0,
                    delta_state: row
                        .try_get::<String, _>("delta_state")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    revision_count: row
                        .try_get::<i64, _>("revision_count")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    last_signal: row
                        .try_get::<Option<String>, _>("last_signal")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    created_at_unix_ms: row
                        .try_get::<i64, _>("created_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    last_revision_at_unix_ms: row
                        .try_get::<Option<i64>, _>("last_revision_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                })
            })
            .collect()
    }

    pub async fn get_task_learning_run(
        &self,
        run_id: &str,
    ) -> Result<Option<TaskLearningRunRow>, McpError> {
        let normalized_run_id = run_id.trim();
        if normalized_run_id.is_empty() {
            return Ok(None);
        }
        let row = sqlx::query(
            r#"
            SELECT
              run_id,
              session_id,
              request_id,
              trace_id,
              fingerprint_key,
              task_fingerprint_json,
              route_decision_json,
              execution_policy_json,
              outcome_json,
              attribution_json,
              policy_delta_json,
              learning_eligible,
              delta_state,
              revision_count,
              last_signal,
              created_at_unix_ms,
              last_revision_at_unix_ms
            FROM task_learning_runs
            WHERE run_id = ?
            LIMIT 1
            "#,
        )
        .bind(normalized_run_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| {
            Ok(TaskLearningRunRow {
                run_id: row
                    .try_get::<String, _>("run_id")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                session_id: row
                    .try_get::<String, _>("session_id")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                request_id: row
                    .try_get::<Option<String>, _>("request_id")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                trace_id: row
                    .try_get::<Option<String>, _>("trace_id")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                fingerprint_key: row
                    .try_get::<String, _>("fingerprint_key")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                task_fingerprint_json: row
                    .try_get::<String, _>("task_fingerprint_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                route_decision_json: row
                    .try_get::<Option<String>, _>("route_decision_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                execution_policy_json: row
                    .try_get::<String, _>("execution_policy_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                outcome_json: row
                    .try_get::<String, _>("outcome_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                attribution_json: row
                    .try_get::<String, _>("attribution_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                policy_delta_json: row
                    .try_get::<Option<String>, _>("policy_delta_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                learning_eligible: row
                    .try_get::<i64, _>("learning_eligible")
                    .map_err(|err| McpError::Storage(err.to_string()))?
                    > 0,
                delta_state: row
                    .try_get::<String, _>("delta_state")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                revision_count: row
                    .try_get::<i64, _>("revision_count")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                last_signal: row
                    .try_get::<Option<String>, _>("last_signal")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                created_at_unix_ms: row
                    .try_get::<i64, _>("created_at_unix_ms")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                last_revision_at_unix_ms: row
                    .try_get::<Option<i64>, _>("last_revision_at_unix_ms")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
            })
        })
        .transpose()
    }

    pub async fn get_latest_task_learning_run_by_trace_id(
        &self,
        trace_id: &str,
    ) -> Result<Option<TaskLearningRunRow>, McpError> {
        let normalized_trace_id = trace_id.trim();
        if normalized_trace_id.is_empty() {
            return Ok(None);
        }
        let row = sqlx::query(
            r#"
            SELECT
              run_id,
              session_id,
              request_id,
              trace_id,
              fingerprint_key,
              task_fingerprint_json,
              route_decision_json,
              execution_policy_json,
              outcome_json,
              attribution_json,
              policy_delta_json,
              learning_eligible,
              delta_state,
              revision_count,
              last_signal,
              created_at_unix_ms,
              last_revision_at_unix_ms
            FROM task_learning_runs
            WHERE trace_id = ?
            ORDER BY COALESCE(last_revision_at_unix_ms, created_at_unix_ms) DESC, created_at_unix_ms DESC
            LIMIT 1
            "#,
        )
        .bind(normalized_trace_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| {
            Ok(TaskLearningRunRow {
                run_id: row
                    .try_get::<String, _>("run_id")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                session_id: row
                    .try_get::<String, _>("session_id")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                request_id: row
                    .try_get::<Option<String>, _>("request_id")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                trace_id: row
                    .try_get::<Option<String>, _>("trace_id")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                fingerprint_key: row
                    .try_get::<String, _>("fingerprint_key")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                task_fingerprint_json: row
                    .try_get::<String, _>("task_fingerprint_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                route_decision_json: row
                    .try_get::<Option<String>, _>("route_decision_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                execution_policy_json: row
                    .try_get::<String, _>("execution_policy_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                outcome_json: row
                    .try_get::<String, _>("outcome_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                attribution_json: row
                    .try_get::<String, _>("attribution_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                policy_delta_json: row
                    .try_get::<Option<String>, _>("policy_delta_json")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                learning_eligible: row
                    .try_get::<i64, _>("learning_eligible")
                    .map_err(|err| McpError::Storage(err.to_string()))?
                    > 0,
                delta_state: row
                    .try_get::<String, _>("delta_state")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                revision_count: row
                    .try_get::<i64, _>("revision_count")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                last_signal: row
                    .try_get::<Option<String>, _>("last_signal")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                created_at_unix_ms: row
                    .try_get::<i64, _>("created_at_unix_ms")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
                last_revision_at_unix_ms: row
                    .try_get::<Option<i64>, _>("last_revision_at_unix_ms")
                    .map_err(|err| McpError::Storage(err.to_string()))?,
            })
        })
        .transpose()
    }

    pub async fn append_task_learning_revision(
        &self,
        run_id: &str,
        trigger_source: &str,
        user_response_signal: &str,
        note: Option<&str>,
        outcome_json: &str,
        attribution_json: &str,
        policy_delta_json: Option<&str>,
        delta_state: &str,
    ) -> Result<TaskLearningRevisionRow, McpError> {
        let normalized_run_id = run_id.trim();
        let normalized_trigger_source = trigger_source.trim();
        let normalized_user_response_signal = user_response_signal.trim().to_ascii_lowercase();
        let normalized_outcome_json = outcome_json.trim();
        let normalized_attribution_json = attribution_json.trim();
        if normalized_run_id.is_empty()
            || normalized_trigger_source.is_empty()
            || normalized_user_response_signal.is_empty()
            || normalized_outcome_json.is_empty()
            || normalized_attribution_json.is_empty()
        {
            return Err(McpError::validation(
                "task learning revision requires run_id, trigger_source, user_response_signal, outcome_json, and attribution_json",
            ));
        }

        let revision_index = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(MAX(revision_index), 0) + 1 FROM task_learning_revisions WHERE run_id = ?",
        )
        .bind(normalized_run_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let id = uuid::Uuid::new_v4().to_string();
        let created_at_unix_ms =
            (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;
        let normalized_note = note.map(str::trim).filter(|value| !value.is_empty());

        sqlx::query(
            r#"
            INSERT INTO task_learning_revisions (
              id,
              run_id,
              revision_index,
              trigger_source,
              user_response_signal,
              note,
              outcome_json,
              attribution_json,
              policy_delta_json,
              delta_state,
              created_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(id.as_str())
        .bind(normalized_run_id)
        .bind(revision_index)
        .bind(normalized_trigger_source)
        .bind(normalized_user_response_signal.as_str())
        .bind(normalized_note)
        .bind(normalized_outcome_json)
        .bind(normalized_attribution_json)
        .bind(
            policy_delta_json
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(delta_state.trim())
        .bind(created_at_unix_ms)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(TaskLearningRevisionRow {
            id,
            run_id: normalized_run_id.to_string(),
            revision_index,
            trigger_source: normalized_trigger_source.to_string(),
            user_response_signal: normalized_user_response_signal,
            note: normalized_note.map(str::to_string),
            outcome_json: normalized_outcome_json.to_string(),
            attribution_json: normalized_attribution_json.to_string(),
            policy_delta_json: policy_delta_json
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            delta_state: delta_state.trim().to_string(),
            created_at_unix_ms,
        })
    }

    pub async fn list_task_learning_revisions(
        &self,
        run_id: &str,
    ) -> Result<Vec<TaskLearningRevisionRow>, McpError> {
        let normalized_run_id = run_id.trim();
        if normalized_run_id.is_empty() {
            return Ok(Vec::new());
        }

        let rows = sqlx::query(
            r#"
            SELECT
              id,
              run_id,
              revision_index,
              trigger_source,
              user_response_signal,
              note,
              outcome_json,
              attribution_json,
              policy_delta_json,
              delta_state,
              created_at_unix_ms
            FROM task_learning_revisions
            WHERE run_id = ?
            ORDER BY revision_index DESC, created_at_unix_ms DESC
            "#,
        )
        .bind(normalized_run_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(TaskLearningRevisionRow {
                    id: row
                        .try_get::<String, _>("id")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    run_id: row
                        .try_get::<String, _>("run_id")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    revision_index: row
                        .try_get::<i64, _>("revision_index")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    trigger_source: row
                        .try_get::<String, _>("trigger_source")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    user_response_signal: row
                        .try_get::<String, _>("user_response_signal")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    note: row
                        .try_get::<Option<String>, _>("note")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    outcome_json: row
                        .try_get::<String, _>("outcome_json")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    attribution_json: row
                        .try_get::<String, _>("attribution_json")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    policy_delta_json: row
                        .try_get::<Option<String>, _>("policy_delta_json")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    delta_state: row
                        .try_get::<String, _>("delta_state")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                    created_at_unix_ms: row
                        .try_get::<i64, _>("created_at_unix_ms")
                        .map_err(|err| McpError::Storage(err.to_string()))?,
                })
            })
            .collect()
    }

    pub async fn update_task_learning_run_revision_state(
        &self,
        run_id: &str,
        outcome_json: &str,
        attribution_json: &str,
        policy_delta_json: Option<&str>,
        learning_eligible: bool,
        delta_state: &str,
        last_signal: Option<&str>,
        revision_count: i64,
        last_revision_at_unix_ms: i64,
    ) -> Result<(), McpError> {
        let normalized_run_id = run_id.trim();
        let normalized_outcome_json = outcome_json.trim();
        let normalized_attribution_json = attribution_json.trim();
        if normalized_run_id.is_empty()
            || normalized_outcome_json.is_empty()
            || normalized_attribution_json.is_empty()
        {
            return Err(McpError::validation(
                "task learning revision update requires run_id, outcome_json, and attribution_json",
            ));
        }

        sqlx::query(
            r#"
            UPDATE task_learning_runs
            SET outcome_json = ?,
                attribution_json = ?,
                policy_delta_json = ?,
                learning_eligible = ?,
                delta_state = ?,
                last_signal = ?,
                revision_count = ?,
                last_revision_at_unix_ms = ?
            WHERE run_id = ?
            "#,
        )
        .bind(normalized_outcome_json)
        .bind(normalized_attribution_json)
        .bind(
            policy_delta_json
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(if learning_eligible { 1_i64 } else { 0_i64 })
        .bind(delta_state.trim())
        .bind(last_signal.map(str::trim).filter(|value| !value.is_empty()))
        .bind(revision_count.max(0))
        .bind(last_revision_at_unix_ms)
        .bind(normalized_run_id)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn record_posterior_signal_event(
        &self,
        run_id: Option<&str>,
        session_id: Option<&str>,
        trace_id: Option<&str>,
        source: &str,
        signal: &str,
        confidence: f64,
        input_json: Option<&str>,
        note: Option<&str>,
    ) -> Result<(), McpError> {
        let normalized_source = source.trim();
        let normalized_signal = signal.trim();
        if normalized_source.is_empty() || normalized_signal.is_empty() {
            return Ok(());
        }
        let now = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;
        sqlx::query(
            r#"
            INSERT INTO posterior_signal_events (
              id,
              run_id,
              session_id,
              trace_id,
              source,
              signal,
              confidence,
              input_json,
              note,
              created_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(run_id.map(str::trim).filter(|value| !value.is_empty()))
        .bind(session_id.map(str::trim).filter(|value| !value.is_empty()))
        .bind(trace_id.map(str::trim).filter(|value| !value.is_empty()))
        .bind(normalized_source)
        .bind(normalized_signal)
        .bind(confidence.clamp(0.0, 1.0))
        .bind(input_json.map(str::trim).filter(|value| !value.is_empty()))
        .bind(note.map(str::trim).filter(|value| !value.is_empty()))
        .bind(now)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
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
