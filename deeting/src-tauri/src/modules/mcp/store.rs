use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::str::FromStr;

use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;
use uuid::Uuid;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::types::{
    CreateAssistantMessageRequest, CreateConversationMessageRequest, CreateLocalAssistantRequest,
    LocalAdminConversationItem, LocalAdminConversationListResponse, LocalAdminConversationQuery,
    LocalAdminConversationSummaryItem, LocalAdminConversationSummaryListResponse, LocalAssistant,
    LocalAssistantEntity, LocalAssistantInstallCreateRequest, LocalAssistantInstallItem,
    LocalAssistantInstallPage, LocalAssistantInstallQuery, LocalAssistantInstallUpdateRequest,
    LocalAssistantMessage, LocalAssistantRatingRequest, LocalAssistantRatingResponse,
    LocalAssistantRoutingFeedbackRequest, LocalAssistantRoutingReportItem,
    LocalAssistantRoutingReportQuery, LocalAssistantRoutingReportResponse,
    LocalAssistantRoutingReportSummary, LocalAssistantRoutingState, LocalAssistantSummary,
    LocalAssistantSummaryVersion, LocalAssistantTag, LocalAssistantVersion, LocalChatInputMessage,
    LocalConversationArchiveResponse, LocalConversationClearResponse,
    LocalConversationCreateRequest, LocalConversationCreateResponse,
    LocalConversationDeleteResponse, LocalConversationHistoryMessage,
    LocalConversationHistoryQuery, LocalConversationHistoryResponse,
    LocalConversationRenameResponse, LocalConversationSessionItem,
    LocalConversationSessionPage, LocalConversationSessionsQuery, LocalConversationStatus,
    LocalConversationWindowResponse, LocalGatewayLogItem, LocalGatewayLogListResponse,
    LocalGatewayLogQuery, LocalGatewayLogStatsBucket, LocalGatewayLogStatsResponse,
    LocalTraceFeedback, LocalTraceFeedbackRequest,
    McpConflictStatus, McpSource, McpSourceStatus, McpSourceType, McpTool, McpToolConfigPayload,
    McpToolStatus, McpTrustLevel, UpdateLocalAssistantRequest,
};

const DEFAULT_LOCAL_SOURCE_PATH: &str = "~/.config/deeting/mcp.json";
const DEFAULT_CLOUD_SOURCE_NAME: &str = "Deeting Cloud";
const LOCAL_DESKTOP_USER_ID: &str = "00000000-0000-0000-0000-000000000000";
const CONVERSATION_SUMMARY_JOB_STATUS_PENDING: &str = "pending";
const CONVERSATION_SUMMARY_JOB_STATUS_RUNNING: &str = "running";
const CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED: &str = "completed";
const CONVERSATION_SUMMARY_JOB_STATUS_FAILED: &str = "failed";
const CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS: i64 = 5;
const LOCAL_CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL: i64 = 12;
const LOCAL_CONVERSATION_FLUSH_THRESHOLD_TOKENS: i64 = 6144;
const LOCAL_CONVERSATION_SUMMARY_MIN_INTERVAL_SECONDS: i64 = 120;
const LOCAL_CONVERSATION_SUMMARY_IDLE_SECONDS: i64 = 600;
const LOCAL_CONVERSATION_IDLE_CHECK_BATCH_SIZE: i64 = 50;
const LOCAL_PERIODIC_TASK_MAX_ERROR_CHARS: usize = 2000;

pub struct McpStore {
    pool: SqlitePool,
}

#[derive(Debug, Clone)]
pub struct LocalConversationSummaryJob {
    pub id: String,
    pub session_id: String,
    pub attempts: i64,
    pub max_attempts: i64,
}

#[derive(Debug, Clone)]
pub struct LocalPeriodicTask {
    pub task_name: String,
    pub interval_seconds: i64,
}

impl McpStore {
    pub async fn new(database_url: &str) -> Result<Self, McpError> {
        let options = SqliteConnectOptions::from_str(database_url)
            .map_err(|err| McpError::Storage(err.to_string()))?
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(Self { pool })
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

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS assistants (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT,
              avatar TEXT,
              system_prompt TEXT NOT NULL,
              model_config TEXT,
              tags TEXT,
              visibility TEXT NOT NULL,
              source TEXT NOT NULL,
              cloud_id TEXT,
              is_deleted INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        // 1:1 对齐后端 assistant 主表（先单表落地；版本/安装关系后续迁移）。
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS assistant (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT,
              visibility TEXT NOT NULL DEFAULT 'private',
              status TEXT NOT NULL DEFAULT 'draft',
              share_slug TEXT UNIQUE,
              summary TEXT,
              icon_id TEXT,
              install_count INTEGER NOT NULL DEFAULT 0,
              rating_avg REAL NOT NULL DEFAULT 0,
              rating_count INTEGER NOT NULL DEFAULT 0,
              current_version_id TEXT,
              published_at TEXT,
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
            CREATE INDEX IF NOT EXISTS idx_assistant_owner_user_id
            ON assistant(owner_user_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_visibility_status
            ON assistant(visibility, status);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_published_at
            ON assistant(published_at);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS assistant_version (
              id TEXT PRIMARY KEY,
              assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
              version TEXT NOT NULL,
              name TEXT NOT NULL,
              description TEXT,
              system_prompt TEXT NOT NULL,
              model_config TEXT,
              skill_refs TEXT,
              tags TEXT,
              changelog TEXT,
              published_at TEXT,
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
            CREATE TABLE IF NOT EXISTS assistant_install (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
              alias TEXT,
              icon_override TEXT,
              pinned_version_id TEXT REFERENCES assistant_version(id) ON DELETE SET NULL,
              follow_latest INTEGER NOT NULL DEFAULT 1,
              is_enabled INTEGER NOT NULL DEFAULT 1,
              sort_order INTEGER NOT NULL DEFAULT 0,
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
            CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_install_user_assistant
            ON assistant_install(user_id, assistant_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_install_user
            ON assistant_install(user_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_install_assistant
            ON assistant_install(assistant_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS assistant_rating (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
              rating REAL NOT NULL,
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
            CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_rating_user_assistant
            ON assistant_rating(user_id, assistant_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_rating_user
            ON assistant_rating(user_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_rating_assistant
            ON assistant_rating(assistant_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS assistant_routing_state (
              id TEXT PRIMARY KEY,
              assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
              total_trials INTEGER NOT NULL DEFAULT 0,
              positive_feedback INTEGER NOT NULL DEFAULT 0,
              negative_feedback INTEGER NOT NULL DEFAULT 0,
              last_used_at TEXT,
              last_feedback_at TEXT,
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
            CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_routing_state_assistant
            ON assistant_routing_state(assistant_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_routing_state_assistant_id
            ON assistant_routing_state(assistant_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

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
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_trace_feedback_trace_id
            ON trace_feedback(trace_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_trace_feedback_trace_user
            ON trace_feedback(trace_id, user_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS assistant_tag (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
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
            CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_tag_name
            ON assistant_tag(name);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_tag_name
            ON assistant_tag(name);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS assistant_tag_link (
              assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
              tag_id TEXT NOT NULL REFERENCES assistant_tag(id) ON DELETE CASCADE,
              PRIMARY KEY (assistant_id, tag_id)
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_tag_link_assistant
            ON assistant_tag_link(assistant_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_tag_link_tag
            ON assistant_tag_link(tag_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_version_semver
            ON assistant_version(assistant_id, version);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_version_assistant
            ON assistant_version(assistant_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        // 将旧本地 assistants 表数据回填到 assistant（仅缺失 id 时写入）。
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO assistant (
              id, owner_user_id, visibility, status, share_slug, summary, icon_id,
              install_count, rating_avg, rating_count, current_version_id, published_at, created_at, updated_at
            )
            SELECT
              a.id,
              NULL,
              COALESCE(NULLIF(a.visibility, ''), 'private'),
              CASE
                WHEN a.is_deleted = 1 THEN 'archived'
                ELSE 'published'
              END,
              NULL,
              a.description,
              a.avatar,
              0,
              0,
              0,
              NULL,
              CASE
                WHEN a.is_deleted = 1 THEN NULL
                ELSE a.created_at
              END,
              a.created_at,
              a.updated_at
            FROM assistants a;
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS conversation_session (
              id TEXT PRIMARY KEY,
              tenant_id TEXT,
              user_id TEXT,
              assistant_id TEXT,
              channel TEXT NOT NULL DEFAULT 'internal',
              status TEXT NOT NULL DEFAULT 'active',
              preset_id TEXT,
              title TEXT,
              message_count INTEGER NOT NULL DEFAULT 0,
              total_tokens INTEGER NOT NULL DEFAULT 0,
              last_summary_version INTEGER NOT NULL DEFAULT 0,
              summarizing INTEGER NOT NULL DEFAULT 0,
              summary_job_id TEXT,
              last_summary_generated_at TEXT,
              first_message_at TEXT,
              last_active_at TEXT NOT NULL,
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
            CREATE TABLE IF NOT EXISTS conversation_message (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL REFERENCES conversation_session(id) ON DELETE CASCADE,
              turn_index INTEGER NOT NULL,
              role TEXT NOT NULL,
              name TEXT,
              content TEXT,
              meta_info TEXT,
              used_persona_id TEXT,
              token_estimate INTEGER NOT NULL DEFAULT 0,
              is_truncated INTEGER NOT NULL DEFAULT 0,
              is_deleted INTEGER NOT NULL DEFAULT 0,
              parent_message_id TEXT,
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
            CREATE TABLE IF NOT EXISTS conversation_summary (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL REFERENCES conversation_session(id) ON DELETE CASCADE,
              version INTEGER NOT NULL,
              summary_text TEXT NOT NULL,
              covered_from_turn INTEGER NOT NULL,
              covered_to_turn INTEGER NOT NULL,
              previous_summary_id TEXT,
              start_message_id TEXT,
              end_message_id TEXT,
              token_estimate INTEGER NOT NULL DEFAULT 0,
              summarizer_model TEXT,
              summarizer_preset_id TEXT,
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
            CREATE TABLE IF NOT EXISTS conversation_summary_job (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL REFERENCES conversation_session(id) ON DELETE CASCADE,
              status TEXT NOT NULL,
              trigger_source TEXT,
              attempts INTEGER NOT NULL DEFAULT 0,
              max_attempts INTEGER NOT NULL DEFAULT 5,
              available_after_epoch INTEGER NOT NULL DEFAULT 0,
              last_error TEXT,
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
            CREATE TABLE IF NOT EXISTS conversation_summary_idle_task (
              session_id TEXT PRIMARY KEY REFERENCES conversation_session(id) ON DELETE CASCADE,
              last_active_epoch INTEGER NOT NULL,
              run_after_epoch INTEGER NOT NULL,
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
            CREATE TABLE IF NOT EXISTS local_periodic_task (
              task_name TEXT PRIMARY KEY,
              interval_seconds INTEGER NOT NULL,
              next_run_after_epoch INTEGER NOT NULL,
              is_enabled INTEGER NOT NULL DEFAULT 1,
              last_run_at TEXT,
              last_success_at TEXT,
              last_error TEXT,
              last_error_at TEXT,
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
            CREATE TABLE IF NOT EXISTS assistant_messages (
              id TEXT PRIMARY KEY,
              assistant_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              is_deleted INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (assistant_id) REFERENCES assistants(id)
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_conversation_session_assistant_id
            ON conversation_session(assistant_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_conversation_session_status_last_active
            ON conversation_session(status, last_active_at DESC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_message_turn
            ON conversation_message(session_id, turn_index);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_conversation_message_session_turn
            ON conversation_message(session_id, turn_index DESC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_summary_version
            ON conversation_summary(session_id, version);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_conversation_summary_job_status_available
            ON conversation_summary_job(status, available_after_epoch ASC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_conversation_summary_job_session_status
            ON conversation_summary_job(session_id, status);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_conversation_summary_idle_task_due
            ON conversation_summary_idle_task(run_after_epoch ASC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_local_periodic_task_enabled_due
            ON local_periodic_task(is_enabled, next_run_after_epoch ASC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_summary_job_pending_session
            ON conversation_summary_job(session_id)
            WHERE status = 'pending';
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_summary_job_running_session
            ON conversation_summary_job(session_id)
            WHERE status = 'running';
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_assistant_messages_assistant_id_created_at
            ON assistant_messages(assistant_id, created_at);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.ensure_column(
            "conversation_session",
            "total_tokens",
            "ALTER TABLE conversation_session ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;",
        )
        .await?;

        self.ensure_column(
            "conversation_session",
            "summarizing",
            "ALTER TABLE conversation_session ADD COLUMN summarizing INTEGER NOT NULL DEFAULT 0;",
        )
        .await?;

        self.ensure_column(
            "conversation_session",
            "summary_job_id",
            "ALTER TABLE conversation_session ADD COLUMN summary_job_id TEXT;",
        )
        .await?;

        self.ensure_column(
            "conversation_session",
            "last_summary_generated_at",
            "ALTER TABLE conversation_session ADD COLUMN last_summary_generated_at TEXT;",
        )
        .await?;

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

        self.migrate_assistant_versions_from_legacy().await?;
        self.migrate_assistant_installs_from_assistant().await?;

        Ok(())
    }

    pub async fn ensure_local_source(&self) -> Result<McpSource, McpError> {
        if let Some(source) = self.find_source_by_type(McpSourceType::Local).await? {
            return Ok(source);
        }

        let now = now_rfc3339()?;
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO mcp_sources
              (id, name, source_type, path_or_url, trust_level, status, last_synced_at, is_read_only, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind("Local Config")
        .bind(McpSourceType::Local.as_str())
        .bind(DEFAULT_LOCAL_SOURCE_PATH)
        .bind(McpTrustLevel::Private.as_str())
        .bind(McpSourceStatus::Active.as_str())
        .bind::<Option<String>>(None)
        .bind(0)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_source(&id)
            .await?
            .ok_or_else(|| McpError::NotFound("local source missing after insert".to_string()))
    }

    pub async fn ensure_cloud_source(&self, base_url: &str) -> Result<McpSource, McpError> {
        if let Some(source) = self.find_source_by_type(McpSourceType::Cloud).await? {
            return Ok(source);
        }

        let now = now_rfc3339()?;
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO mcp_sources
              (id, name, source_type, path_or_url, trust_level, status, last_synced_at, is_read_only, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(DEFAULT_CLOUD_SOURCE_NAME)
        .bind(McpSourceType::Cloud.as_str())
        .bind(base_url)
        .bind(McpTrustLevel::Official.as_str())
        .bind(McpSourceStatus::Active.as_str())
        .bind::<Option<String>>(None)
        .bind(1)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_source(&id)
            .await?
            .ok_or_else(|| McpError::NotFound("cloud source missing after insert".to_string()))
    }

    pub async fn list_sources(&self) -> Result<Vec<McpSource>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, source_type, path_or_url, trust_level, status,
                   last_synced_at, is_read_only, created_at, updated_at
            FROM mcp_sources
            ORDER BY created_at ASC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut sources = Vec::with_capacity(rows.len());
        for row in rows {
            sources.push(row_to_source(&row)?);
        }
        Ok(sources)
    }

    pub async fn get_source(&self, id: &str) -> Result<Option<McpSource>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT id, name, source_type, path_or_url, trust_level, status,
                   last_synced_at, is_read_only, created_at, updated_at
            FROM mcp_sources
            WHERE id = ?;
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| row_to_source(&row)).transpose()
    }

    pub async fn find_source_by_type(
        &self,
        source_type: McpSourceType,
    ) -> Result<Option<McpSource>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT id, name, source_type, path_or_url, trust_level, status,
                   last_synced_at, is_read_only, created_at, updated_at
            FROM mcp_sources
            WHERE source_type = ?;
            "#,
        )
        .bind(source_type.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| row_to_source(&row)).transpose()
    }

    pub async fn insert_source(&self, source: NewSource) -> Result<McpSource, McpError> {
        let now = now_rfc3339()?;
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO mcp_sources
              (id, name, source_type, path_or_url, trust_level, status, last_synced_at, is_read_only, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&source.name)
        .bind(source.source_type.as_str())
        .bind(&source.path_or_url)
        .bind(source.trust_level.as_str())
        .bind(source.status.as_str())
        .bind(source.last_synced_at)
        .bind(if source.is_read_only { 1 } else { 0 })
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_source(&id)
            .await?
            .ok_or_else(|| McpError::NotFound("source missing after insert".to_string()))
    }

    pub async fn update_source_status(
        &self,
        id: &str,
        status: McpSourceStatus,
        last_synced_at: Option<String>,
    ) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE mcp_sources
            SET status = ?, last_synced_at = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(status.as_str())
        .bind(last_synced_at)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn list_tools(&self) -> Result<Vec<McpTool>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, source_id, identifier, name, source_type, status, ping_ms, capabilities, description,
                   error, command, args, env, config_json, config_hash, pending_config_json,
                   pending_config_hash, conflict_status, is_read_only, is_new, created_at, updated_at
            FROM mcp_tools
            ORDER BY created_at ASC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut tools = Vec::with_capacity(rows.len());
        for row in rows {
            tools.push(row_to_tool(&row)?);
        }
        Ok(tools)
    }

    pub async fn get_tool(&self, id: &str) -> Result<Option<McpTool>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT id, source_id, identifier, name, source_type, status, ping_ms, capabilities, description,
                   error, command, args, env, config_json, config_hash, pending_config_json,
                   pending_config_hash, conflict_status, is_read_only, is_new, created_at, updated_at
            FROM mcp_tools
            WHERE id = ?;
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| row_to_tool(&row)).transpose()
    }

    pub async fn get_pending_config_json(&self, id: &str) -> Result<Option<String>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT pending_config_json
            FROM mcp_tools
            WHERE id = ?;
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(row.and_then(|r: SqliteRow| r.try_get::<String, _>("pending_config_json").ok()))
    }

    pub async fn get_tool_by_source_name(
        &self,
        source_id: &str,
        name: &str,
    ) -> Result<Option<McpTool>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT id, source_id, identifier, name, source_type, status, ping_ms, capabilities, description,
                   error, command, args, env, config_json, config_hash, pending_config_json,
                   pending_config_hash, conflict_status, is_read_only, is_new, created_at, updated_at
            FROM mcp_tools
            WHERE source_id = ? AND name = ?
            LIMIT 1;
            "#,
        )
        .bind(source_id)
        .bind(name)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| row_to_tool(&row)).transpose()
    }

    pub async fn get_tool_by_source_identifier(
        &self,
        source_id: &str,
        identifier: &str,
    ) -> Result<Option<McpTool>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT id, source_id, identifier, name, source_type, status, ping_ms, capabilities, description,
                   error, command, args, env, config_json, config_hash, pending_config_json,
                   pending_config_hash, conflict_status, is_read_only, is_new, created_at, updated_at
            FROM mcp_tools
            WHERE source_id = ? AND identifier = ?
            LIMIT 1;
            "#,
        )
        .bind(source_id)
        .bind(identifier)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| row_to_tool(&row)).transpose()
    }

    pub async fn has_name_conflict(&self, name: &str, source_id: &str) -> Result<bool, McpError> {
        let row = sqlx::query(
            r#"
            SELECT COUNT(*) as count
            FROM mcp_tools
            WHERE name = ? AND source_id != ? AND source_type = ?;
            "#,
        )
        .bind(name)
        .bind(source_id)
        .bind(McpSourceType::Local.as_str())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let count: i64 = row.try_get("count")?;
        Ok(count > 0)
    }

    pub async fn upsert_tool(&self, tool: ToolUpsert) -> Result<McpTool, McpError> {
        if let Some(existing_id) = self
            .find_tool_id_by_source_identifier(tool.source_id.as_str(), tool.identifier.as_deref())
            .await?
        {
            self.update_tool(&existing_id, tool.clone()).await?;
            let updated = self
                .get_tool(&existing_id)
                .await?
                .ok_or_else(|| McpError::NotFound("tool missing after update".to_string()))?;
            return Ok(updated);
        }

        self.insert_tool(tool.clone()).await?;
        let created = self
            .find_tool_id_by_source_identifier(tool.source_id.as_str(), tool.identifier.as_deref())
            .await?
            .ok_or_else(|| McpError::NotFound("tool missing after insert".to_string()))?;
        self.get_tool(&created)
            .await?
            .ok_or_else(|| McpError::NotFound("tool missing after insert".to_string()))
    }

    pub async fn set_tool_status(
        &self,
        id: &str,
        status: McpToolStatus,
        ping_ms: Option<i64>,
        error: Option<String>,
    ) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE mcp_tools
            SET status = ?, ping_ms = ?, error = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(status.as_str())
        .bind(ping_ms)
        .bind(error)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn update_tool_env(
        &self,
        id: &str,
        env: Option<HashMap<String, String>>,
    ) -> Result<McpTool, McpError> {
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE mcp_tools
            SET env = ?, is_new = 0, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(serialize_json(&env)?)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_tool(id)
            .await?
            .ok_or_else(|| McpError::NotFound("tool missing after env update".to_string()))
    }

    pub async fn set_tool_new_flag(&self, id: &str, is_new: bool) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE mcp_tools
            SET is_new = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(if is_new { 1 } else { 0 })
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn mark_tool_pending_update(
        &self,
        id: &str,
        pending_config_json: String,
        pending_config_hash: String,
        conflict_status: McpConflictStatus,
    ) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE mcp_tools
            SET pending_config_json = ?,
                pending_config_hash = ?,
                conflict_status = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(pending_config_json)
        .bind(pending_config_hash)
        .bind(conflict_status.as_str())
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn clear_pending_update(&self, id: &str) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE mcp_tools
            SET pending_config_json = NULL,
                pending_config_hash = NULL,
                conflict_status = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(McpConflictStatus::None.as_str())
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub fn extract_tool_fields(
        &self,
        name: &str,
        payload: &McpToolConfigPayload,
    ) -> ExtractedToolFields {
        ExtractedToolFields {
            name: name.to_string(),
            description: payload
                .description
                .clone()
                .unwrap_or_else(|| "MCP tool".to_string()),
            command: payload.command.clone(),
            args: payload.args.clone(),
            env: payload.env.clone(),
            capabilities: payload.capabilities.clone().unwrap_or_default(),
        }
    }

    pub fn build_config_json(
        &self,
        name: &str,
        payload: &McpToolConfigPayload,
    ) -> Result<serde_json::Value, McpError> {
        let mut map = serde_json::Map::new();
        map.insert(
            "name".to_string(),
            serde_json::Value::String(name.to_string()),
        );
        if let Some(command) = &payload.command {
            map.insert(
                "command".to_string(),
                serde_json::Value::String(command.clone()),
            );
        }
        if let Some(args) = &payload.args {
            map.insert(
                "args".to_string(),
                serde_json::Value::Array(
                    args.iter()
                        .cloned()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            );
        }
        if let Some(env) = &payload.env {
            let env_map = env
                .iter()
                .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
                .collect();
            map.insert("env".to_string(), serde_json::Value::Object(env_map));
        }
        if let Some(description) = &payload.description {
            map.insert(
                "description".to_string(),
                serde_json::Value::String(description.clone()),
            );
        }
        if let Some(capabilities) = &payload.capabilities {
            map.insert(
                "capabilities".to_string(),
                serde_json::Value::Array(
                    capabilities
                        .iter()
                        .cloned()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            );
        }
        for (key, value) in &payload.extra {
            map.insert(key.clone(), value.clone());
        }
        Ok(serde_json::Value::Object(map))
    }

    pub fn compute_config_hash(&self, value: &serde_json::Value) -> Result<String, McpError> {
        Ok(hash_json(value))
    }

    async fn find_tool_id_by_source_identifier(
        &self,
        source_id: &str,
        identifier: Option<&str>,
    ) -> Result<Option<String>, McpError> {
        let row = if let Some(identifier) = identifier {
            sqlx::query(
                r#"
                SELECT id
                FROM mcp_tools
                WHERE source_id = ? AND identifier = ?
                LIMIT 1;
                "#,
            )
            .bind(source_id)
            .bind(identifier)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        } else {
            sqlx::query(
                r#"
                SELECT id
                FROM mcp_tools
                WHERE source_id = ? AND identifier IS NULL
                LIMIT 1;
                "#,
            )
            .bind(source_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        };

        Ok(row.and_then(|r: SqliteRow| r.try_get::<String, _>("id").ok()))
    }

    async fn insert_tool(&self, tool: ToolUpsert) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        let id = tool.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        sqlx::query(
            r#"
            INSERT INTO mcp_tools
              (id, source_id, identifier, name, source_type, status, ping_ms, capabilities, description,
               error, command, args, env, config_json, config_hash, pending_config_json,
               pending_config_hash, conflict_status, is_read_only, is_new, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&tool.source_id)
        .bind(&tool.identifier)
        .bind(&tool.name)
        .bind(tool.source_type.as_str())
        .bind(tool.status.as_str())
        .bind(tool.ping_ms)
        .bind(serde_json::to_string(&tool.capabilities)?)
        .bind(&tool.description)
        .bind(tool.error)
        .bind(tool.command)
        .bind(serialize_json(&tool.args)?)
        .bind(serialize_json(&tool.env)?)
        .bind(tool.config_json)
        .bind(tool.config_hash)
        .bind(tool.pending_config_json)
        .bind(tool.pending_config_hash)
        .bind(tool.conflict_status.as_str())
        .bind(if tool.is_read_only { 1 } else { 0 })
        .bind(if tool.is_new { 1 } else { 0 })
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    async fn update_tool(&self, id: &str, tool: ToolUpsert) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE mcp_tools
            SET source_id = ?, identifier = ?, name = ?, source_type = ?, status = ?, ping_ms = ?,
                capabilities = ?, description = ?, error = ?, command = ?, args = ?, env = ?,
                config_json = ?, config_hash = ?, pending_config_json = ?, pending_config_hash = ?,
                conflict_status = ?, is_read_only = ?, is_new = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&tool.source_id)
        .bind(&tool.identifier)
        .bind(&tool.name)
        .bind(tool.source_type.as_str())
        .bind(tool.status.as_str())
        .bind(tool.ping_ms)
        .bind(serde_json::to_string(&tool.capabilities)?)
        .bind(&tool.description)
        .bind(tool.error)
        .bind(tool.command)
        .bind(serialize_json(&tool.args)?)
        .bind(serialize_json(&tool.env)?)
        .bind(tool.config_json)
        .bind(tool.config_hash)
        .bind(tool.pending_config_json)
        .bind(tool.pending_config_hash)
        .bind(tool.conflict_status.as_str())
        .bind(if tool.is_read_only { 1 } else { 0 })
        .bind(if tool.is_new { 1 } else { 0 })
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn list_local_assistants(&self) -> Result<Vec<LocalAssistant>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, description, avatar, system_prompt, model_config, tags,
                   visibility, source, cloud_id, is_deleted, created_at, updated_at
            FROM assistants
            WHERE is_deleted = 0
            ORDER BY updated_at DESC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut assistants = Vec::with_capacity(rows.len());
        for row in rows {
            assistants.push(row_to_assistant(&row)?);
        }
        Ok(assistants)
    }

    pub async fn list_local_assistant_entities(
        &self,
    ) -> Result<Vec<LocalAssistantEntity>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, owner_user_id, visibility, status, share_slug, summary, icon_id,
                   install_count, rating_avg, rating_count, current_version_id, published_at,
                   created_at, updated_at
            FROM assistant
            ORDER BY updated_at DESC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut assistants = Vec::with_capacity(rows.len());
        for row in rows {
            assistants.push(row_to_assistant_entity(&row)?);
        }
        Ok(assistants)
    }

    pub async fn list_local_assistant_versions(
        &self,
        assistant_id: Option<&str>,
    ) -> Result<Vec<LocalAssistantVersion>, McpError> {
        let rows = if let Some(assistant_id) = assistant_id {
            sqlx::query(
                r#"
                SELECT id, assistant_id, version, name, description, system_prompt,
                       model_config, skill_refs, tags, changelog, published_at,
                       created_at, updated_at
                FROM assistant_version
                WHERE assistant_id = ?
                ORDER BY created_at DESC, id DESC;
                "#,
            )
            .bind(assistant_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        } else {
            sqlx::query(
                r#"
                SELECT id, assistant_id, version, name, description, system_prompt,
                       model_config, skill_refs, tags, changelog, published_at,
                       created_at, updated_at
                FROM assistant_version
                ORDER BY updated_at DESC, id DESC;
                "#,
            )
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        };

        let mut versions = Vec::with_capacity(rows.len());
        for row in rows {
            versions.push(row_to_assistant_version(&row)?);
        }
        Ok(versions)
    }

    pub async fn list_local_assistant_tags(&self) -> Result<Vec<LocalAssistantTag>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, created_at, updated_at
            FROM assistant_tag
            ORDER BY name ASC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut tags = Vec::with_capacity(rows.len());
        for row in rows {
            tags.push(LocalAssistantTag {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }
        Ok(tags)
    }

    pub async fn list_local_assistant_installs(
        &self,
        query: LocalAssistantInstallQuery,
    ) -> Result<LocalAssistantInstallPage, McpError> {
        let size = query.size.unwrap_or(50).clamp(1, 200);
        let offset = query
            .cursor
            .as_deref()
            .unwrap_or("0")
            .trim()
            .parse::<i64>()
            .unwrap_or(0)
            .max(0);

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(1) AS total
            FROM assistant_install
            WHERE user_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              ai.id AS install_id,
              ai.assistant_id AS install_assistant_id,
              ai.alias AS install_alias,
              ai.icon_override AS install_icon_override,
              ai.pinned_version_id AS install_pinned_version_id,
              ai.follow_latest AS install_follow_latest,
              ai.is_enabled AS install_is_enabled,
              ai.sort_order AS install_sort_order,
              a.owner_user_id AS assistant_owner_user_id,
              a.icon_id AS assistant_icon_id,
              a.share_slug AS assistant_share_slug,
              a.summary AS assistant_summary,
              a.published_at AS assistant_published_at,
              a.current_version_id AS assistant_current_version_id,
              a.install_count AS assistant_install_count,
              a.rating_avg AS assistant_rating_avg,
              a.rating_count AS assistant_rating_count,
              cv.id AS current_version_id,
              cv.version AS current_version,
              cv.name AS current_name,
              cv.description AS current_description,
              cv.system_prompt AS current_system_prompt,
              cv.tags AS current_tags,
              cv.published_at AS current_published_at,
              pv.id AS pinned_id,
              pv.version AS pinned_version,
              pv.name AS pinned_name,
              pv.description AS pinned_description,
              pv.system_prompt AS pinned_system_prompt,
              pv.tags AS pinned_tags,
              pv.published_at AS pinned_published_at
            FROM assistant_install ai
            INNER JOIN assistant a ON a.id = ai.assistant_id
            LEFT JOIN assistant_version cv ON cv.id = a.current_version_id
            LEFT JOIN assistant_version pv ON pv.id = ai.pinned_version_id
            WHERE ai.user_id = ?
            ORDER BY ai.sort_order ASC, ai.created_at DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(size)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(row_to_assistant_install_item(&row)?);
        }

        let next_offset = offset + size;
        let next_page = if next_offset < total {
            Some(next_offset.to_string())
        } else {
            None
        };
        let previous_page = if offset > 0 {
            Some((offset - size).max(0).to_string())
        } else {
            None
        };

        Ok(LocalAssistantInstallPage {
            items,
            next_page,
            previous_page,
        })
    }

    pub async fn install_local_assistant(
        &self,
        assistant_id: &str,
        payload: LocalAssistantInstallCreateRequest,
    ) -> Result<LocalAssistantInstallItem, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let assistant_row = sqlx::query(
            r#"
            SELECT id, current_version_id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let assistant_row =
            assistant_row.ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?;
        let assistant_current_version_id: Option<String> =
            assistant_row.try_get("current_version_id")?;

        let existing_row = sqlx::query(
            r#"
            SELECT id
            FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if existing_row.is_some() {
            let now = now_rfc3339()?;
            self.refresh_assistant_install_count(&normalized_assistant_id, &now)
                .await?;
            return self
                .get_local_assistant_install_item(&normalized_assistant_id)
                .await?
                .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()));
        }

        let mut pinned_version_id = payload.pinned_version_id.and_then(|raw| {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        });
        let mut follow_latest = payload.follow_latest.unwrap_or(true);

        if let Some(pinned_id) = pinned_version_id.as_deref() {
            let version_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE id = ? AND assistant_id = ?
                LIMIT 1;
                "#,
            )
            .bind(pinned_id)
            .bind(&normalized_assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if version_row.is_none() {
                return Err(McpError::validation("pinned_version_id is invalid"));
            }
            follow_latest = false;
        }

        if !follow_latest && pinned_version_id.is_none() {
            pinned_version_id = assistant_current_version_id;
        }

        let max_row = sqlx::query(
            r#"
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort
            FROM assistant_install
            WHERE user_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let install_id = Uuid::new_v4().to_string();
        let sort_order = max_row.try_get::<i64, _>("next_sort").unwrap_or(0);
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO assistant_install (
              id, user_id, assistant_id, alias, icon_override, pinned_version_id,
              follow_latest, is_enabled, sort_order, created_at, updated_at
            )
            VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?, ?);
            "#,
        )
        .bind(&install_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .bind(pinned_version_id.as_deref())
        .bind(if follow_latest { 1 } else { 0 })
        .bind(sort_order)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.refresh_assistant_install_count(&normalized_assistant_id, &now)
            .await?;

        self.get_local_assistant_install_item(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()))
    }

    pub async fn update_local_assistant_install(
        &self,
        assistant_id: &str,
        payload: LocalAssistantInstallUpdateRequest,
    ) -> Result<LocalAssistantInstallItem, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let assistant_row = sqlx::query(
            r#"
            SELECT current_version_id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let assistant_current_version_id: Option<String> = assistant_row
            .ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?
            .try_get("current_version_id")?;

        let existing_row = sqlx::query(
            r#"
            SELECT id, alias, icon_override, pinned_version_id, follow_latest, is_enabled, sort_order
            FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()))?;

        let install_id: String = existing_row.try_get("id")?;
        let alias_existing: Option<String> = existing_row.try_get("alias")?;
        let icon_override_existing: Option<String> = existing_row.try_get("icon_override")?;
        let pinned_existing: Option<String> = existing_row.try_get("pinned_version_id")?;
        let follow_latest_existing =
            existing_row.try_get::<i64, _>("follow_latest").unwrap_or(1) != 0;
        let is_enabled_existing = existing_row.try_get::<i64, _>("is_enabled").unwrap_or(1) != 0;
        let sort_order_existing = existing_row.try_get::<i64, _>("sort_order").unwrap_or(0);

        let alias = payload
            .alias
            .map(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or(alias_existing);
        let icon_override = payload
            .icon_override
            .map(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or(icon_override_existing);

        let payload_follow_latest = payload.follow_latest;
        let payload_has_pinned_version = payload.pinned_version_id.is_some();
        let mut pinned_version_id = payload
            .pinned_version_id
            .map(|raw| {
                let trimmed = raw.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or(pinned_existing);

        let mut follow_latest = payload_follow_latest.unwrap_or(follow_latest_existing);
        if let Some(pinned_id) = pinned_version_id.as_deref() {
            let version_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE id = ? AND assistant_id = ?
                LIMIT 1;
                "#,
            )
            .bind(pinned_id)
            .bind(&normalized_assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if version_row.is_none() {
                return Err(McpError::validation("pinned_version_id is invalid"));
            }
            if payload_follow_latest.is_none() {
                follow_latest = false;
            }
        }

        if payload_follow_latest == Some(true) {
            pinned_version_id = None;
        } else if payload_follow_latest == Some(false) && !payload_has_pinned_version {
            pinned_version_id = assistant_current_version_id.clone();
        } else if !follow_latest && pinned_version_id.is_none() {
            pinned_version_id = assistant_current_version_id;
        }

        let is_enabled = payload.is_enabled.unwrap_or(is_enabled_existing);
        let sort_order = payload.sort_order.unwrap_or(sort_order_existing).max(0);
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            UPDATE assistant_install
            SET alias = ?, icon_override = ?, pinned_version_id = ?, follow_latest = ?, is_enabled = ?, sort_order = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(alias.as_deref())
        .bind(icon_override.as_deref())
        .bind(pinned_version_id.as_deref())
        .bind(if follow_latest { 1 } else { 0 })
        .bind(if is_enabled { 1 } else { 0 })
        .bind(sort_order)
        .bind(&now)
        .bind(&install_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_local_assistant_install_item(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()))
    }

    pub async fn uninstall_local_assistant(&self, assistant_id: &str) -> Result<(), McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            DELETE FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "assistant install not found".to_string(),
            ));
        }

        self.refresh_assistant_install_count(&normalized_assistant_id, &now)
            .await?;

        Ok(())
    }

    pub async fn rate_local_assistant(
        &self,
        assistant_id: &str,
        payload: LocalAssistantRatingRequest,
    ) -> Result<LocalAssistantRatingResponse, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        if payload.rating < 1.0 || payload.rating > 5.0 {
            return Err(McpError::validation("rating must be between 1 and 5"));
        }

        let assistant_row = sqlx::query(
            r#"
            SELECT id, rating_avg, rating_count
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?;

        let install_row = sqlx::query(
            r#"
            SELECT id
            FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if install_row.is_none() {
            return Err(McpError::validation("assistant is not installed"));
        }

        let existing_row = sqlx::query(
            r#"
            SELECT id, rating
            FROM assistant_rating
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut rating_avg = assistant_row.try_get::<f64, _>("rating_avg").unwrap_or(0.0);
        let mut rating_count = assistant_row.try_get::<i64, _>("rating_count").unwrap_or(0);
        let now = now_rfc3339()?;

        if let Some(row) = existing_row {
            let rating_id: String = row.try_get("id")?;
            let old_rating = row.try_get::<f64, _>("rating").unwrap_or(0.0);
            if old_rating == payload.rating {
                return Ok(LocalAssistantRatingResponse {
                    assistant_id: normalized_assistant_id,
                    rating_avg,
                    rating_count,
                });
            }

            sqlx::query(
                r#"
                UPDATE assistant_rating
                SET rating = ?, updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(payload.rating)
            .bind(&now)
            .bind(&rating_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if rating_count <= 0 {
                let refreshed = self
                    .refresh_assistant_rating(&normalized_assistant_id, &now)
                    .await?;
                rating_avg = refreshed.0;
                rating_count = refreshed.1;
            } else {
                let new_avg =
                    (rating_avg * rating_count as f64 - old_rating + payload.rating) / rating_count as f64;
                rating_avg = round_to_4(new_avg);
                sqlx::query(
                    r#"
                    UPDATE assistant
                    SET rating_avg = ?, updated_at = ?
                    WHERE id = ?;
                    "#,
                )
                .bind(rating_avg)
                .bind(&now)
                .bind(&normalized_assistant_id)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            }
        } else {
            let rating_id = Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO assistant_rating (
                  id, user_id, assistant_id, rating, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?);
                "#,
            )
            .bind(&rating_id)
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_assistant_id)
            .bind(payload.rating)
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            let new_count = rating_count + 1;
            let new_avg = (rating_avg * rating_count as f64 + payload.rating) / new_count as f64;
            rating_count = new_count;
            rating_avg = round_to_4(new_avg);
            sqlx::query(
                r#"
                UPDATE assistant
                SET rating_count = ?, rating_avg = ?, updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(rating_count)
            .bind(rating_avg)
            .bind(&now)
            .bind(&normalized_assistant_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        Ok(LocalAssistantRatingResponse {
            assistant_id: normalized_assistant_id,
            rating_avg,
            rating_count,
        })
    }

    pub async fn record_local_assistant_routing_trial(
        &self,
        assistant_id: &str,
    ) -> Result<LocalAssistantRoutingState, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let assistant_exists = sqlx::query(
            r#"
            SELECT id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if assistant_exists.is_none() {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }

        let now = now_rfc3339()?;
        let state_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO assistant_routing_state (
              id, assistant_id, total_trials, positive_feedback, negative_feedback,
              last_used_at, last_feedback_at, created_at, updated_at
            )
            VALUES (?, ?, 1, 0, 0, ?, NULL, ?, ?)
            ON CONFLICT(assistant_id) DO UPDATE
            SET total_trials = assistant_routing_state.total_trials + 1,
                last_used_at = excluded.last_used_at,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&state_id)
        .bind(&normalized_assistant_id)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_local_assistant_routing_state(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::Storage("assistant routing state not found".to_string()))
    }

    pub async fn record_local_assistant_routing_feedback(
        &self,
        assistant_id: &str,
        payload: LocalAssistantRoutingFeedbackRequest,
    ) -> Result<LocalAssistantRoutingState, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let is_positive = parse_assistant_routing_feedback_event(&payload.event)
            .ok_or_else(|| McpError::validation("unknown feedback event"))?;

        let assistant_exists = sqlx::query(
            r#"
            SELECT id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if assistant_exists.is_none() {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }

        let positive_inc = if is_positive { 1_i64 } else { 0_i64 };
        let negative_inc = if is_positive { 0_i64 } else { 1_i64 };
        let now = now_rfc3339()?;
        let state_id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO assistant_routing_state (
              id, assistant_id, total_trials, positive_feedback, negative_feedback,
              last_used_at, last_feedback_at, created_at, updated_at
            )
            VALUES (?, ?, 0, ?, ?, NULL, ?, ?, ?)
            ON CONFLICT(assistant_id) DO UPDATE
            SET positive_feedback = assistant_routing_state.positive_feedback + ?,
                negative_feedback = assistant_routing_state.negative_feedback + ?,
                last_feedback_at = excluded.last_feedback_at,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&state_id)
        .bind(&normalized_assistant_id)
        .bind(positive_inc)
        .bind(negative_inc)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .bind(positive_inc)
        .bind(negative_inc)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_local_assistant_routing_state(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::Storage("assistant routing state not found".to_string()))
    }

    pub async fn get_local_assistant_routing_report(
        &self,
        query: LocalAssistantRoutingReportQuery,
    ) -> Result<LocalAssistantRoutingReportResponse, McpError> {
        let limit = query.limit.unwrap_or(50).clamp(1, 500) as usize;
        let sort_key = query
            .sort
            .as_deref()
            .unwrap_or("score_desc")
            .trim()
            .to_ascii_lowercase();
        let allowed_sorts = ["score_desc", "routing_score_desc", "rating_desc", "trials_desc", "recent_desc"];
        if !allowed_sorts.contains(&sort_key.as_str()) {
            return Err(McpError::validation("invalid sort option"));
        }

        let rows = sqlx::query(
            r#"
            SELECT
              ars.assistant_id AS assistant_id,
              ars.total_trials AS total_trials,
              ars.positive_feedback AS positive_feedback,
              ars.negative_feedback AS negative_feedback,
              ars.last_used_at AS last_used_at,
              ars.last_feedback_at AS last_feedback_at,
              a.summary AS assistant_summary,
              av.name AS version_name
            FROM assistant_routing_state ars
            JOIN assistant a ON a.id = ars.assistant_id
            LEFT JOIN assistant_version av ON a.current_version_id = av.id;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let total_trials = row.try_get::<i64, _>("total_trials").unwrap_or(0);
            let positive_feedback = row.try_get::<i64, _>("positive_feedback").unwrap_or(0);
            let negative_feedback = row.try_get::<i64, _>("negative_feedback").unwrap_or(0);
            let rating_score =
                (positive_feedback as f64 + 1.0) / (positive_feedback as f64 + negative_feedback as f64 + 2.0);
            let mab_score = rating_score;
            let exploration_bonus = if total_trials < 10 { 0.2 } else { 0.0 };
            let routing_score = (rating_score * 0.75) + (exploration_bonus * 0.25);
            items.push(LocalAssistantRoutingReportItem {
                assistant_id: row.try_get::<String, _>("assistant_id")?,
                name: row.try_get::<Option<String>, _>("version_name").ok().flatten(),
                summary: row.try_get::<Option<String>, _>("assistant_summary").ok().flatten(),
                total_trials,
                positive_feedback,
                negative_feedback,
                rating_score,
                mab_score,
                routing_score,
                exploration_bonus,
                last_used_at: row.try_get::<Option<String>, _>("last_used_at").ok().flatten(),
                last_feedback_at: row
                    .try_get::<Option<String>, _>("last_feedback_at")
                    .ok()
                    .flatten(),
            });
        }

        if let Some(min_trials) = query.min_trials {
            items.retain(|item| item.total_trials >= min_trials.max(0));
        }
        if let Some(min_rating) = query.min_rating {
            items.retain(|item| item.rating_score >= min_rating.max(0.0));
        }

        match sort_key.as_str() {
            "rating_desc" => {
                items.sort_by(|a, b| b.rating_score.total_cmp(&a.rating_score));
            }
            "trials_desc" => {
                items.sort_by(|a, b| b.total_trials.cmp(&a.total_trials));
            }
            "recent_desc" => {
                items.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at));
            }
            _ => {
                items.sort_by(|a, b| b.routing_score.total_cmp(&a.routing_score));
            }
        }

        if items.len() > limit {
            items.truncate(limit);
        }

        let total_assistants = items.len() as i64;
        let total_trials: i64 = items.iter().map(|item| item.total_trials).sum();
        let total_positive: i64 = items.iter().map(|item| item.positive_feedback).sum();
        let total_negative: i64 = items.iter().map(|item| item.negative_feedback).sum();
        let overall_rating = if total_assistants > 0 {
            items.iter().map(|item| item.rating_score).sum::<f64>() / total_assistants as f64
        } else {
            0.0
        };

        Ok(LocalAssistantRoutingReportResponse {
            summary: LocalAssistantRoutingReportSummary {
                total_assistants,
                total_trials,
                total_positive,
                total_negative,
                overall_rating,
            },
            items,
        })
    }

    pub async fn get_local_assistant_routing_state(
        &self,
        assistant_id: &str,
    ) -> Result<Option<LocalAssistantRoutingState>, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT assistant_id, total_trials, positive_feedback, negative_feedback, last_used_at, last_feedback_at
            FROM assistant_routing_state
            WHERE assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| {
            Ok(LocalAssistantRoutingState {
                assistant_id: row.try_get("assistant_id")?,
                total_trials: row.try_get::<i64, _>("total_trials").unwrap_or(0),
                positive_feedback: row.try_get::<i64, _>("positive_feedback").unwrap_or(0),
                negative_feedback: row.try_get::<i64, _>("negative_feedback").unwrap_or(0),
                last_used_at: row.try_get::<Option<String>, _>("last_used_at").ok().flatten(),
                last_feedback_at: row
                    .try_get::<Option<String>, _>("last_feedback_at")
                    .ok()
                    .flatten(),
            })
        })
        .transpose()
    }

    pub async fn create_local_trace_feedback(
        &self,
        payload: LocalTraceFeedbackRequest,
    ) -> Result<LocalTraceFeedback, McpError> {
        let trace_id = payload.trace_id.trim().to_string();
        if trace_id.is_empty() {
            return Err(McpError::validation("trace_id is required"));
        }
        if trace_id.len() > 64 {
            return Err(McpError::validation("trace_id must be <= 64 characters"));
        }
        if !payload.score.is_finite() || payload.score < -1.0 || payload.score > 1.0 {
            return Err(McpError::validation("score must be between -1.0 and 1.0"));
        }

        let comment = payload.comment.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let tags = payload.tags.map(normalize_feedback_tags);
        let tags_json = serialize_json(&tags)?;
        let now = now_rfc3339()?;
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO trace_feedback (
              id, trace_id, user_id, score, comment, tags, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&trace_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(payload.score)
        .bind(comment.as_deref())
        .bind(tags_json.as_deref())
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalTraceFeedback {
            id,
            trace_id,
            user_id: Some(LOCAL_DESKTOP_USER_ID.to_string()),
            score: payload.score,
            comment,
            tags,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn create_local_gateway_log(
        &self,
        trace_id: Option<&str>,
        model: &str,
        status_code: i64,
        duration_ms: i64,
        ttft_ms: Option<i64>,
        upstream_url: Option<&str>,
        retry_count: i64,
        input_tokens: i64,
        output_tokens: i64,
        total_tokens: i64,
        cost_upstream: f64,
        cost_user: f64,
        is_cached: bool,
        error_code: Option<&str>,
        meta: Option<&serde_json::Value>,
    ) -> Result<(), McpError> {
        let normalized_model = model.trim().to_string();
        if normalized_model.is_empty() {
            return Err(McpError::validation("model is required"));
        }
        let normalized_trace_id = trace_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        if let Some(value) = normalized_trace_id.as_deref() {
            if value.len() > 64 {
                return Err(McpError::validation("trace_id must be <= 64 characters"));
            }
        }
        let normalized_error_code = error_code.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let normalized_upstream_url = upstream_url.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let meta_json = meta
            .map(serde_json::to_string)
            .transpose()
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let now = now_rfc3339()?;
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO gateway_log (
              id, user_id, trace_id, api_key_id, preset_id, model, status_code, duration_ms, ttft_ms,
              upstream_url, retry_count, input_tokens, output_tokens, total_tokens,
              cost_upstream, cost_user, is_cached, error_code, meta, created_at
            )
            VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(normalized_trace_id.as_deref())
        .bind(&normalized_model)
        .bind(status_code.max(0))
        .bind(duration_ms.max(0))
        .bind(ttft_ms.filter(|value| *value > 0))
        .bind(normalized_upstream_url.as_deref())
        .bind(retry_count.max(0))
        .bind(input_tokens.max(0))
        .bind(output_tokens.max(0))
        .bind(total_tokens.max(0))
        .bind(if cost_upstream.is_finite() {
            cost_upstream.max(0.0)
        } else {
            0.0
        })
        .bind(if cost_user.is_finite() {
            cost_user.max(0.0)
        } else {
            0.0
        })
        .bind(if is_cached { 1 } else { 0 })
        .bind(normalized_error_code.as_deref())
        .bind(meta_json.as_deref())
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn list_local_gateway_logs(
        &self,
        query: LocalGatewayLogQuery,
    ) -> Result<LocalGatewayLogListResponse, McpError> {
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(100).clamp(1, 1000);
        let model = query.model.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let status_code = query.status_code.map(|value| value.max(0));
        let is_cached = query.is_cached.map(|value| if value { 1_i64 } else { 0_i64 });

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?);
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              id, trace_id, user_id, api_key_id, model, status_code, duration_ms, ttft_ms,
              input_tokens, output_tokens, cost_user, is_cached, error_code, created_at
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalGatewayLogItem {
                id: row.try_get("id")?,
                trace_id: row.try_get("trace_id")?,
                user_id: row.try_get("user_id")?,
                api_key_id: row.try_get("api_key_id")?,
                model: row.try_get("model")?,
                status_code: row.try_get("status_code")?,
                duration_ms: row.try_get::<i64, _>("duration_ms")?.max(0),
                ttft_ms: row.try_get("ttft_ms")?,
                input_tokens: row.try_get::<i64, _>("input_tokens")?.max(0),
                output_tokens: row.try_get::<i64, _>("output_tokens")?.max(0),
                cost_user: row.try_get::<f64, _>("cost_user").unwrap_or(0.0),
                is_cached: row.try_get::<i64, _>("is_cached")? != 0,
                error_code: row.try_get("error_code")?,
                created_at: row.try_get("created_at")?,
            });
        }

        Ok(LocalGatewayLogListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn get_local_gateway_log_stats(
        &self,
        query: LocalGatewayLogQuery,
    ) -> Result<LocalGatewayLogStatsResponse, McpError> {
        let model = query.model.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let status_code = query.status_code.map(|value| value.max(0));
        let is_cached = query.is_cached.map(|value| if value { 1_i64 } else { 0_i64 });

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?);
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let success_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE status_code >= 200
              AND status_code < 400
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?);
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let success_count: i64 = success_row.try_get("total")?;

        let cached_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE is_cached = 1
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?);
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let cached_count: i64 = cached_row.try_get("total")?;

        let error_rows = sqlx::query(
            r#"
            SELECT COALESCE(error_code, CAST(status_code AS TEXT)) AS bucket, COUNT(*) AS count
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
            GROUP BY bucket
            ORDER BY COUNT(*) DESC
            LIMIT 20;
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let mut error_distribution = Vec::with_capacity(error_rows.len());
        for row in error_rows {
            error_distribution.push(LocalGatewayLogStatsBucket {
                key: row.try_get::<String, _>("bucket")?,
                count: row.try_get::<i64, _>("count")?,
            });
        }

        let model_rows = sqlx::query(
            r#"
            SELECT model AS bucket, COUNT(*) AS count
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
            GROUP BY model
            ORDER BY COUNT(*) DESC
            LIMIT 20;
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let mut model_ranking = Vec::with_capacity(model_rows.len());
        for row in model_rows {
            model_ranking.push(LocalGatewayLogStatsBucket {
                key: row.try_get::<String, _>("bucket")?,
                count: row.try_get::<i64, _>("count")?,
            });
        }

        let latency_rows = sqlx::query(
            r#"
            SELECT
              CASE
                WHEN duration_ms < 200 THEN 'lt_200ms'
                WHEN duration_ms < 500 THEN '200_500ms'
                WHEN duration_ms < 1000 THEN '500_1000ms'
                ELSE 'gte_1000ms'
              END AS bucket,
              COUNT(*) AS count
            FROM gateway_log
            WHERE (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
            GROUP BY bucket
            ORDER BY COUNT(*) DESC;
            "#,
        )
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let mut latency_histogram = Vec::with_capacity(latency_rows.len());
        for row in latency_rows {
            latency_histogram.push(LocalGatewayLogStatsBucket {
                key: row.try_get::<String, _>("bucket")?,
                count: row.try_get::<i64, _>("count")?,
            });
        }

        let success_rate = if total > 0 {
            ((success_count as f64 / total as f64) * 100.0 * 100.0).round() / 100.0
        } else {
            0.0
        };
        let cache_hit_rate = if total > 0 {
            ((cached_count as f64 / total as f64) * 100.0 * 100.0).round() / 100.0
        } else {
            0.0
        };

        Ok(LocalGatewayLogStatsResponse {
            total,
            success_rate,
            cache_hit_rate,
            error_distribution,
            model_ranking,
            latency_histogram,
        })
    }

    pub async fn list_local_admin_conversations(
        &self,
        query: LocalAdminConversationQuery,
    ) -> Result<LocalAdminConversationListResponse, McpError> {
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(100).clamp(1, 1000);
        let status = query.status.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let channel = query.channel.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM conversation_session
            WHERE (? IS NULL OR status = ?)
              AND (? IS NULL OR channel = ?);
            "#,
        )
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(channel.as_deref())
        .bind(channel.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              id, title, user_id, assistant_id, channel, status,
              message_count, last_active_at, last_summary_version
            FROM conversation_session
            WHERE (? IS NULL OR status = ?)
              AND (? IS NULL OR channel = ?)
            ORDER BY last_active_at DESC, id DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(channel.as_deref())
        .bind(channel.as_deref())
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalAdminConversationItem {
                id: row.try_get("id")?,
                title: row.try_get("title")?,
                user_id: row.try_get("user_id")?,
                assistant_id: row.try_get("assistant_id")?,
                channel: row.try_get::<String, _>("channel")?,
                status: row.try_get::<String, _>("status")?,
                message_count: row.try_get::<i64, _>("message_count").unwrap_or(0),
                last_active_at: row.try_get("last_active_at")?,
                last_summary_version: row.try_get::<i64, _>("last_summary_version").unwrap_or(0),
            });
        }

        Ok(LocalAdminConversationListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn list_local_admin_conversation_summaries(
        &self,
        session_id: &str,
    ) -> Result<LocalAdminConversationSummaryListResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_exists = sqlx::query(
            r#"
            SELECT id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        let rows = sqlx::query(
            r#"
            SELECT
              id, session_id, version, summary_text, covered_from_turn, covered_to_turn,
              token_estimate, summarizer_model, created_at, updated_at
            FROM conversation_summary
            WHERE session_id = ?
            ORDER BY version DESC;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalAdminConversationSummaryItem {
                id: row.try_get("id")?,
                session_id: row.try_get("session_id")?,
                version: row.try_get("version")?,
                summary_text: row.try_get("summary_text")?,
                covered_from_turn: row.try_get("covered_from_turn")?,
                covered_to_turn: row.try_get("covered_to_turn")?,
                token_estimate: row.try_get::<i64, _>("token_estimate").unwrap_or(0),
                summarizer_model: row.try_get("summarizer_model")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(LocalAdminConversationSummaryListResponse { items })
    }

    pub async fn get_local_trace_feedback_meta_by_trace_id(
        &self,
        trace_id: &str,
    ) -> Result<Option<serde_json::Value>, McpError> {
        let normalized_trace_id = trace_id.trim().to_string();
        if normalized_trace_id.is_empty() {
            return Err(McpError::validation("trace_id is required"));
        }

        let gateway_log_row = sqlx::query(
            r#"
            SELECT meta
            FROM gateway_log
            WHERE trace_id = ?
            ORDER BY created_at DESC
            LIMIT 1;
            "#,
        )
        .bind(&normalized_trace_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if let Some(value) = gateway_log_row {
            let meta_text: Option<String> = value.try_get("meta")?;
            if let Some(text) = meta_text {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    if let Ok(meta) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        return Ok(Some(meta));
                    }
                }
            }
        }

        let row = sqlx::query(
            r#"
            SELECT cm.meta_info
            FROM conversation_message cm
            WHERE cm.role = 'assistant'
              AND cm.meta_info IS NOT NULL
              AND json_extract(cm.meta_info, '$.trace_id') = ?
            ORDER BY cm.created_at DESC, cm.turn_index DESC
            LIMIT 1;
            "#,
        )
        .bind(&normalized_trace_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        match row {
            Some(value) => {
                let meta_info_text: Option<String> = value.try_get("meta_info")?;
                let meta_info = match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                };
                Ok(meta_info)
            }
            None => Ok(None),
        }
    }

    pub async fn get_local_assistant(&self, id: &str) -> Result<Option<LocalAssistant>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT id, name, description, avatar, system_prompt, model_config, tags,
                   visibility, source, cloud_id, is_deleted, created_at, updated_at
            FROM assistants
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        match row {
            Some(row) => Ok(Some(row_to_assistant(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn create_local_assistant(
        &self,
        payload: CreateLocalAssistantRequest,
    ) -> Result<String, McpError> {
        let name = payload.name.trim().to_string();
        if name.is_empty() {
            return Err(McpError::validation("assistant name is required"));
        }
        let system_prompt = payload.system_prompt.trim().to_string();
        if system_prompt.is_empty() {
            return Err(McpError::validation("system_prompt is required"));
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;
        let visibility = payload.visibility.unwrap_or_else(|| "private".to_string());
        let source = payload.source.unwrap_or_else(|| "local".to_string());
        let description = payload.description;
        let avatar = payload.avatar;
        let tags = payload.tags.unwrap_or_default();
        let tags_json = serialize_json(&Some(tags))?;
        let model_config_json = serialize_json(&payload.model_config)?;

        sqlx::query(
            r#"
            INSERT INTO assistants
              (id, name, description, avatar, system_prompt, model_config, tags, visibility, source,
               cloud_id, is_deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&name)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&system_prompt)
        .bind(model_config_json.as_deref())
        .bind(tags_json.as_deref())
        .bind(&visibility)
        .bind(&source)
        .bind(payload.cloud_id)
        .bind(0)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            INSERT OR REPLACE INTO assistant (
              id, owner_user_id, visibility, status, share_slug, summary, icon_id,
              install_count, rating_avg, rating_count, current_version_id, published_at, created_at, updated_at
            )
            VALUES (?, NULL, ?, 'published', NULL, ?, ?, 0, 0, 0, NULL, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&visibility)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.ensure_assistant_version_synced(
            &id,
            &name,
            description.as_deref(),
            &system_prompt,
            model_config_json.as_deref(),
            tags_json.as_deref(),
            Some(&now),
            &now,
            &now,
        )
        .await?;

        Ok(id)
    }

    pub async fn update_local_assistant(
        &self,
        id: &str,
        payload: UpdateLocalAssistantRequest,
    ) -> Result<LocalAssistant, McpError> {
        let existing = self
            .get_local_assistant(id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?;

        if existing.is_deleted {
            return Err(McpError::validation("assistant already deleted"));
        }

        let LocalAssistant {
            name: existing_name,
            description: existing_description,
            avatar: existing_avatar,
            system_prompt: existing_system_prompt,
            model_config: existing_model_config,
            tags: existing_tags,
            visibility: existing_visibility,
            source: existing_source,
            cloud_id: existing_cloud_id,
            created_at: existing_created_at,
            ..
        } = existing;

        let name = payload.name.unwrap_or(existing_name);
        if name.trim().is_empty() {
            return Err(McpError::validation("assistant name is required"));
        }
        let system_prompt = payload.system_prompt.unwrap_or(existing_system_prompt);
        if system_prompt.trim().is_empty() {
            return Err(McpError::validation("system_prompt is required"));
        }

        let description = payload.description.or(existing_description);
        let avatar = payload.avatar.or(existing_avatar);
        let model_config = payload.model_config.or(existing_model_config);
        let tags = payload.tags.unwrap_or(existing_tags);
        let visibility = payload.visibility.unwrap_or(existing_visibility);
        let source = payload.source.unwrap_or(existing_source);
        let cloud_id = payload.cloud_id.or(existing_cloud_id);
        let now = now_rfc3339()?;

        let tags_json = serialize_json(&Some(tags))?;
        let model_config_json = serialize_json(&model_config)?;

        sqlx::query(
            r#"
            UPDATE assistants
            SET name = ?, description = ?, avatar = ?, system_prompt = ?, model_config = ?,
                tags = ?, visibility = ?, source = ?, cloud_id = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&name)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&system_prompt)
        .bind(model_config_json.as_deref())
        .bind(tags_json.as_deref())
        .bind(&visibility)
        .bind(&source)
        .bind(cloud_id.as_deref())
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE assistant
            SET visibility = ?, summary = ?, icon_id = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&visibility)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.ensure_assistant_version_synced(
            id,
            &name,
            description.as_deref(),
            &system_prompt,
            model_config_json.as_deref(),
            tags_json.as_deref(),
            None,
            &existing_created_at,
            &now,
        )
        .await?;

        self.get_local_assistant(id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant missing after update".to_string()))
    }

    pub async fn delete_local_assistant(&self, id: &str) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE assistants
            SET is_deleted = 1, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE assistant
            SET status = 'archived', published_at = NULL, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }
        self.delete_assistant_messages(id).await?;
        Ok(())
    }

    pub async fn list_assistant_messages(
        &self,
        assistant_id: &str,
    ) -> Result<Vec<LocalAssistantMessage>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, assistant_id, role, content, is_deleted, created_at, updated_at
            FROM assistant_messages
            WHERE assistant_id = ? AND is_deleted = 0
            ORDER BY created_at ASC;
            "#,
        )
        .bind(assistant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut messages = Vec::with_capacity(rows.len());
        for row in rows {
            messages.push(row_to_assistant_message(&row)?);
        }
        Ok(messages)
    }

    pub async fn append_assistant_message(
        &self,
        payload: CreateAssistantMessageRequest,
    ) -> Result<LocalAssistantMessage, McpError> {
        let role = payload.role.trim();
        if role.is_empty() {
            return Err(McpError::validation("role is required"));
        }
        let content = payload.content.trim().to_string();
        if content.is_empty() {
            return Err(McpError::validation("content is required"));
        }
        if payload.assistant_id.trim().is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO assistant_messages
              (id, assistant_id, role, content, is_deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&payload.assistant_id)
        .bind(role)
        .bind(&content)
        .bind(0)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalAssistantMessage {
            id,
            assistant_id: payload.assistant_id,
            role: role.to_string(),
            content,
            is_deleted: false,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn delete_assistant_messages(&self, assistant_id: &str) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE assistant_messages
            SET is_deleted = 1, updated_at = ?
            WHERE assistant_id = ?;
            "#,
        )
        .bind(&now)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn list_local_conversations(
        &self,
        query: LocalConversationSessionsQuery,
    ) -> Result<LocalConversationSessionPage, McpError> {
        let size = query.size.unwrap_or(24).clamp(1, 100);
        let offset = query
            .cursor
            .as_deref()
            .unwrap_or("0")
            .trim()
            .parse::<i64>()
            .unwrap_or(0)
            .max(0);
        let status = query.status.unwrap_or(LocalConversationStatus::Active);
        let assistant_id = query.assistant_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        let total: i64 = if let Some(assistant_id) = assistant_id.as_deref() {
            let row = sqlx::query(
                r#"
                SELECT COUNT(1) AS total
                FROM conversation_session
                WHERE status = ? AND assistant_id = ?;
                "#,
            )
            .bind(status.as_str())
            .bind(assistant_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            row.try_get("total")?
        } else {
            let row = sqlx::query(
                r#"
                SELECT COUNT(1) AS total
                FROM conversation_session
                WHERE status = ?;
                "#,
            )
            .bind(status.as_str())
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            row.try_get("total")?
        };

        let rows = if let Some(assistant_id) = assistant_id.as_deref() {
            sqlx::query(
                r#"
                SELECT
                  cs.id AS id,
                  cs.title AS title,
                  cs.message_count AS message_count,
                  cs.first_message_at AS first_message_at,
                  cs.last_active_at AS last_active_at,
                  sm.summary_text AS summary_text
                FROM conversation_session cs
                LEFT JOIN conversation_summary sm
                  ON sm.session_id = cs.id
                 AND sm.version = cs.last_summary_version
                WHERE cs.status = ? AND cs.assistant_id = ?
                ORDER BY cs.last_active_at DESC, cs.id DESC
                LIMIT ? OFFSET ?;
                "#,
            )
            .bind(status.as_str())
            .bind(assistant_id)
            .bind(size)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        } else {
            sqlx::query(
                r#"
                SELECT
                  cs.id AS id,
                  cs.title AS title,
                  cs.message_count AS message_count,
                  cs.first_message_at AS first_message_at,
                  cs.last_active_at AS last_active_at,
                  sm.summary_text AS summary_text
                FROM conversation_session cs
                LEFT JOIN conversation_summary sm
                  ON sm.session_id = cs.id
                 AND sm.version = cs.last_summary_version
                WHERE cs.status = ?
                ORDER BY cs.last_active_at DESC, cs.id DESC
                LIMIT ? OFFSET ?;
                "#,
            )
            .bind(status.as_str())
            .bind(size)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        };

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalConversationSessionItem {
                session_id: row.try_get("id")?,
                title: row.try_get("title")?,
                summary_text: row.try_get("summary_text")?,
                message_count: row.try_get::<i64, _>("message_count").unwrap_or(0),
                first_message_at: row.try_get("first_message_at")?,
                last_active_at: row.try_get("last_active_at")?,
            });
        }

        let next_offset = offset + size;
        let next_page = if next_offset < total {
            Some(next_offset.to_string())
        } else {
            None
        };
        let previous_page = if offset > 0 {
            Some((offset - size).max(0).to_string())
        } else {
            None
        };

        Ok(LocalConversationSessionPage {
            items,
            next_page,
            previous_page,
        })
    }

    pub async fn create_local_conversation(
        &self,
        payload: LocalConversationCreateRequest,
    ) -> Result<LocalConversationCreateResponse, McpError> {
        let now = now_rfc3339()?;
        let session_id = Uuid::new_v4().to_string();
        let assistant_id = payload.assistant_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let title = payload.title.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        sqlx::query(
            r#"
            INSERT INTO conversation_session (
              id, tenant_id, user_id, assistant_id, channel, status, preset_id, title,
              message_count, last_summary_version, first_message_at, last_active_at, created_at, updated_at
            )
            VALUES (?, NULL, NULL, ?, 'internal', 'active', NULL, ?, 0, 0, NULL, ?, ?, ?);
            "#,
        )
        .bind(&session_id)
        .bind(&assistant_id)
        .bind(&title)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalConversationCreateResponse { session_id, title })
    }

    pub async fn update_local_conversation_status(
        &self,
        session_id: &str,
        status: LocalConversationStatus,
    ) -> Result<LocalConversationArchiveResponse, McpError> {
        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET status = ?, last_active_at = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(status.as_str())
        .bind(&now)
        .bind(&now)
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        Ok(LocalConversationArchiveResponse {
            session_id: session_id.to_string(),
            status,
        })
    }

    pub async fn rename_local_conversation(
        &self,
        session_id: &str,
        title: String,
    ) -> Result<LocalConversationRenameResponse, McpError> {
        let now = now_rfc3339()?;
        let normalized_title = {
            let trimmed = title.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        };
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET title = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&normalized_title)
        .bind(&now)
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        Ok(LocalConversationRenameResponse {
            session_id: session_id.to_string(),
            title: normalized_title,
        })
    }

    pub async fn delete_local_conversation_message(
        &self,
        session_id: &str,
        turn_index: i64,
    ) -> Result<LocalConversationDeleteResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        if turn_index <= 0 {
            return Err(McpError::validation("turn_index must be greater than 0"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        let session_exists = sqlx::query(
            r#"
            SELECT id FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        let result = sqlx::query(
            r#"
            UPDATE conversation_message
            SET is_deleted = 1, updated_at = ?
            WHERE session_id = ? AND turn_index = ? AND is_deleted = 0;
            "#,
        )
        .bind(&now)
        .bind(&normalized_session_id)
        .bind(turn_index)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let deleted = result.rows_affected() > 0;
        if deleted {
            sqlx::query(
                r#"
                DELETE FROM conversation_summary
                WHERE session_id = ?;
                "#,
            )
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                DELETE FROM conversation_summary_job
                WHERE session_id = ?;
                "#,
            )
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                DELETE FROM conversation_summary_idle_task
                WHERE session_id = ?;
                "#,
            )
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                UPDATE conversation_session
                SET message_count = CASE WHEN message_count > 0 THEN message_count - 1 ELSE 0 END,
                    total_tokens = COALESCE((
                        SELECT SUM(token_estimate)
                        FROM (
                            SELECT token_estimate
                            FROM conversation_message
                            WHERE session_id = ? AND is_deleted = 0
                            ORDER BY turn_index DESC
                            LIMIT ?
                        )
                    ), 0),
                    last_summary_version = 0,
                    summarizing = 0,
                    summary_job_id = '',
                    last_summary_generated_at = NULL,
                    last_active_at = ?,
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(&normalized_session_id)
            .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL)
            .bind(&now)
            .bind(&now)
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        tx.commit().await?;

        Ok(LocalConversationDeleteResponse {
            session_id: normalized_session_id,
            turn_index,
            deleted,
        })
    }

    pub async fn clear_local_conversation(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationClearResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        let session_exists = sqlx::query(
            r#"
            SELECT id FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        sqlx::query(
            r#"
            UPDATE conversation_message
            SET is_deleted = 1, updated_at = ?
            WHERE session_id = ? AND is_deleted = 0;
            "#,
        )
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM conversation_summary
            WHERE session_id = ?;
            "#,
        )
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM conversation_summary_job
            WHERE session_id = ?;
            "#,
        )
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM conversation_summary_idle_task
            WHERE session_id = ?;
            "#,
        )
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET message_count = 0,
                total_tokens = 0,
                last_summary_version = 0,
                summarizing = 0,
                summary_job_id = '',
                last_summary_generated_at = NULL,
                first_message_at = NULL,
                last_active_at = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&now)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;

        Ok(LocalConversationClearResponse {
            session_id: normalized_session_id,
            cleared: true,
        })
    }

    pub async fn prepare_local_conversation_regenerate(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationRegenerateContext, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        let session_row = sqlx::query(
            r#"
            SELECT assistant_id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let assistant_id: Option<String> = session_row.try_get("assistant_id")?;

        let rows = sqlx::query(
            r#"
            SELECT role, content, turn_index
            FROM conversation_message
            WHERE session_id = ? AND is_deleted = 0
            ORDER BY turn_index ASC;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if rows.is_empty() {
            return Err(McpError::validation("conversation has no messages"));
        }

        let mut timeline = Vec::with_capacity(rows.len());
        for row in rows {
            timeline.push((
                row.try_get::<i64, _>("turn_index")?,
                row.try_get::<String, _>("role")?,
                row.try_get::<Option<String>, _>("content")?,
            ));
        }

        let last_user_turn = timeline
            .iter()
            .rev()
            .find_map(|(turn, role, _)| if role == "user" { Some(*turn) } else { None })
            .ok_or_else(|| McpError::validation("no user message found"))?;

        let deleted_turn_index = timeline.iter().find_map(|(turn, role, _)| {
            if role == "assistant" && *turn > last_user_turn {
                Some(*turn)
            } else {
                None
            }
        });

        if let Some(turn) = deleted_turn_index {
            let delete_result = sqlx::query(
                r#"
                UPDATE conversation_message
                SET is_deleted = 1, updated_at = ?
                WHERE session_id = ? AND turn_index = ? AND is_deleted = 0;
                "#,
            )
            .bind(&now)
            .bind(&normalized_session_id)
            .bind(turn)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if delete_result.rows_affected() > 0 {
                sqlx::query(
                    r#"
                    DELETE FROM conversation_summary
                    WHERE session_id = ?;
                    "#,
                )
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                sqlx::query(
                    r#"
                    DELETE FROM conversation_summary_job
                    WHERE session_id = ?;
                    "#,
                )
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                sqlx::query(
                    r#"
                    DELETE FROM conversation_summary_idle_task
                    WHERE session_id = ?;
                    "#,
                )
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                sqlx::query(
                    r#"
                    UPDATE conversation_session
                    SET message_count = CASE WHEN message_count > 0 THEN message_count - 1 ELSE 0 END,
                        total_tokens = COALESCE((
                            SELECT SUM(token_estimate)
                            FROM (
                                SELECT token_estimate
                                FROM conversation_message
                                WHERE session_id = ? AND is_deleted = 0
                                ORDER BY turn_index DESC
                                LIMIT ?
                            )
                        ), 0),
                        last_summary_version = 0,
                        summarizing = 0,
                        summary_job_id = '',
                        last_summary_generated_at = NULL,
                        last_active_at = ?,
                        updated_at = ?
                    WHERE id = ?;
                    "#,
                )
                .bind(&normalized_session_id)
                .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL)
                .bind(&now)
                .bind(&now)
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            }
        }

        let messages: Vec<LocalChatInputMessage> = timeline
            .into_iter()
            .filter(|(turn, _, _)| deleted_turn_index != Some(*turn))
            .map(|(_, role, content)| LocalChatInputMessage {
                role,
                content: content.unwrap_or_default(),
            })
            .collect();

        if messages.is_empty() {
            return Err(McpError::validation("conversation has no messages"));
        }

        tx.commit().await?;

        Ok(LocalConversationRegenerateContext {
            session_id: normalized_session_id,
            assistant_id,
            deleted_turn_index,
            messages,
        })
    }

    pub async fn get_local_conversation_chat_context(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationChatContext, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT assistant_id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let assistant_id: Option<String> = session_row.try_get("assistant_id")?;

        let rows = sqlx::query(
            r#"
            SELECT role, content
            FROM (
              SELECT role, content, turn_index
              FROM conversation_message
              WHERE session_id = ? AND is_deleted = 0
              ORDER BY turn_index DESC
              LIMIT ?
            ) windowed
            ORDER BY turn_index ASC;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if rows.is_empty() {
            return Err(McpError::validation("conversation has no messages"));
        }

        let messages = rows
            .into_iter()
            .map(|row| LocalChatInputMessage {
                role: row
                    .try_get::<String, _>("role")
                    .unwrap_or_else(|_| "user".to_string()),
                content: row
                    .try_get::<Option<String>, _>("content")
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
            })
            .collect();

        Ok(LocalConversationChatContext {
            session_id: normalized_session_id,
            assistant_id,
            messages,
        })
    }

    pub async fn append_local_conversation_message(
        &self,
        payload: CreateConversationMessageRequest,
    ) -> Result<LocalConversationHistoryMessage, McpError> {
        let session_id = payload.session_id.trim().to_string();
        if session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        let role = payload.role.trim().to_string();
        if role.is_empty() {
            return Err(McpError::validation("role is required"));
        }

        let now = now_rfc3339()?;
        let content = if payload.content.trim().is_empty() {
            None
        } else {
            Some(payload.content)
        };
        let name = payload.name.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let parent_message_id = payload.parent_message_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let meta_json = payload
            .meta_info
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let is_truncated = payload.is_truncated.unwrap_or(false);
        let token_estimate = payload
            .meta_info
            .as_ref()
            .and_then(|value| value.get("token_estimate"))
            .and_then(|value| value.as_i64())
            .filter(|value| *value >= 0)
            .unwrap_or_else(|| estimate_token_count(content.as_deref().unwrap_or("")));

        let mut tx = self.pool.begin().await?;

        let exists = sqlx::query(
            r#"
            SELECT id FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        let turn_row = sqlx::query(
            r#"
            SELECT COALESCE(MAX(turn_index), 0) + 1 AS next_turn
            FROM conversation_message
            WHERE session_id = ?;
            "#,
        )
        .bind(&session_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let next_turn: i64 = turn_row.try_get("next_turn")?;
        let message_id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO conversation_message (
              id, session_id, turn_index, role, name, content, meta_info, used_persona_id,
              token_estimate, is_truncated, is_deleted, parent_message_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?);
            "#,
        )
        .bind(&message_id)
        .bind(&session_id)
        .bind(next_turn)
        .bind(&role)
        .bind(&name)
        .bind(&content)
        .bind(&meta_json)
        .bind(token_estimate)
        .bind(if is_truncated { 1 } else { 0 })
        .bind(&parent_message_id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let window_tokens_row = sqlx::query(
            r#"
            SELECT COALESCE(SUM(token_estimate), 0) AS total_tokens
            FROM (
              SELECT token_estimate
              FROM conversation_message
              WHERE session_id = ? AND is_deleted = 0
              ORDER BY turn_index DESC
              LIMIT ?
            );
            "#,
        )
        .bind(&session_id)
        .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL)
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let window_tokens = window_tokens_row.try_get::<i64, _>("total_tokens").unwrap_or(0);

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET message_count = message_count + 1,
                total_tokens = ?,
                first_message_at = COALESCE(first_message_at, ?),
                last_active_at = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(window_tokens)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .bind(&session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;

        Ok(LocalConversationHistoryMessage {
            role,
            content: content.map(serde_json::Value::String),
            turn_index: Some(next_turn),
            created_at: Some(now),
            is_truncated: Some(is_truncated),
            name,
            meta_info: payload.meta_info,
        })
    }

    pub async fn persist_local_conversation_summary(
        &self,
        session_id: &str,
        summary_text: &str,
        summarizer_model: Option<&str>,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let normalized_summary = summary_text.trim().to_string();
        if normalized_summary.is_empty() {
            return Err(McpError::validation("summary_text is required"));
        }

        let normalized_summarizer_model = summarizer_model.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        let session_row = sqlx::query(
            r#"
            SELECT id, last_summary_version
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let message_rows = sqlx::query(
            r#"
            SELECT id, turn_index, token_estimate
            FROM (
              SELECT id, turn_index, token_estimate
              FROM conversation_message
              WHERE session_id = ? AND is_deleted = 0
              ORDER BY turn_index DESC
              LIMIT ?
            ) windowed
            ORDER BY turn_index ASC;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL)
        .fetch_all(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if message_rows.is_empty() {
            return Err(McpError::validation("conversation has no messages"));
        }

        let first_row = message_rows
            .first()
            .ok_or_else(|| McpError::Storage("conversation summary missing first row".to_string()))?;
        let last_row = message_rows
            .last()
            .ok_or_else(|| McpError::Storage("conversation summary missing last row".to_string()))?;

        let start_message_id: String = first_row.try_get("id")?;
        let end_message_id: String = last_row.try_get("id")?;
        let covered_from_turn: i64 = first_row.try_get("turn_index")?;
        let covered_to_turn: i64 = last_row.try_get("turn_index")?;

        let token_estimate = message_rows.iter().fold(0_i64, |acc, row| {
            acc + row.try_get::<i64, _>("token_estimate").unwrap_or(0)
        });

        let current_version: i64 = session_row.try_get("last_summary_version").unwrap_or(0);
        let new_version = current_version.max(0) + 1;

        let previous_summary_id = if current_version > 0 {
            let row = sqlx::query(
                r#"
                SELECT id
                FROM conversation_summary
                WHERE session_id = ? AND version = ?
                LIMIT 1;
                "#,
            )
            .bind(&normalized_session_id)
            .bind(current_version)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            row.and_then(|item| item.try_get::<String, _>("id").ok())
        } else {
            None
        };

        let summary_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO conversation_summary (
              id, session_id, version, summary_text, covered_from_turn, covered_to_turn,
              previous_summary_id, start_message_id, end_message_id, token_estimate,
              summarizer_model, summarizer_preset_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?);
            "#,
        )
        .bind(&summary_id)
        .bind(&normalized_session_id)
        .bind(new_version)
        .bind(&normalized_summary)
        .bind(covered_from_turn)
        .bind(covered_to_turn)
        .bind(&previous_summary_id)
        .bind(&start_message_id)
        .bind(&end_message_id)
        .bind(token_estimate)
        .bind(&normalized_summarizer_model)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET last_summary_version = ?,
                total_tokens = ?,
                summarizing = 0,
                summary_job_id = '',
                last_summary_generated_at = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(new_version)
        .bind(token_estimate)
        .bind(&now)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn enqueue_local_conversation_summary_job(
        &self,
        session_id: &str,
        trigger_source: &str,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        let normalized_trigger_source = {
            let trimmed = trigger_source.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        };

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let mut tx = self.pool.begin().await?;

        let session_exists = sqlx::query(
            r#"
            SELECT id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        sqlx::query(
            r#"
            DELETE FROM conversation_summary_job
            WHERE session_id = ? AND status IN (?, ?);
            "#,
        )
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_FAILED)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let refreshed_pending = sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET trigger_source = COALESCE(?, trigger_source),
                available_after_epoch = ?,
                last_error = NULL,
                updated_at = ?
            WHERE session_id = ? AND status = ?;
            "#,
        )
        .bind(&normalized_trigger_source)
        .bind(now_epoch)
        .bind(&now)
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if refreshed_pending.rows_affected() > 0 {
            let pending_job_row = sqlx::query(
                r#"
                SELECT id
                FROM conversation_summary_job
                WHERE session_id = ? AND status = ?
                LIMIT 1;
                "#,
            )
            .bind(&normalized_session_id)
            .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let pending_job_id = pending_job_row
                .and_then(|row| row.try_get::<String, _>("id").ok())
                .unwrap_or_default();
            sqlx::query(
                r#"
                UPDATE conversation_session
                SET summarizing = 1,
                    summary_job_id = ?,
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(&pending_job_id)
            .bind(&now)
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            tx.commit().await?;
            return Ok(());
        }

        let running_exists = sqlx::query(
            r#"
            SELECT id
            FROM conversation_summary_job
            WHERE session_id = ? AND status = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if let Some(row) = running_exists {
            let running_job_id = row.try_get::<String, _>("id").unwrap_or_default();
            sqlx::query(
                r#"
                UPDATE conversation_session
                SET summarizing = 1,
                    summary_job_id = ?,
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(&running_job_id)
            .bind(&now)
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            tx.commit().await?;
            return Ok(());
        }

        let job_id = Uuid::new_v4().to_string();
        let insert_result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO conversation_summary_job (
              id, session_id, status, trigger_source, attempts, max_attempts,
              available_after_epoch, last_error, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?, ?);
            "#,
        )
        .bind(&job_id)
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .bind(&normalized_trigger_source)
        .bind(CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS)
        .bind(now_epoch)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if insert_result.rows_affected() == 0 {
            let _ = sqlx::query(
                r#"
                UPDATE conversation_summary_job
                SET trigger_source = COALESCE(?, trigger_source),
                    available_after_epoch = ?,
                    last_error = NULL,
                    updated_at = ?
                WHERE session_id = ? AND status = ?;
                "#,
            )
            .bind(&normalized_trigger_source)
            .bind(now_epoch)
            .bind(&now)
            .bind(&normalized_session_id)
            .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET summarizing = 1,
                summary_job_id = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&job_id)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn claim_next_local_conversation_summary_job(
        &self,
    ) -> Result<Option<LocalConversationSummaryJob>, McpError> {
        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let mut tx = self.pool.begin().await?;

        let next_row = sqlx::query(
            r#"
            SELECT id, session_id, attempts, max_attempts
            FROM conversation_summary_job
            WHERE status = ? AND available_after_epoch <= ?
            ORDER BY available_after_epoch ASC, created_at ASC
            LIMIT 1;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .bind(now_epoch)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let Some(row) = next_row else {
            tx.commit().await?;
            return Ok(None);
        };

        let id: String = row.try_get("id")?;
        let session_id: String = row.try_get("session_id")?;
        let previous_attempts: i64 = row.try_get("attempts").unwrap_or(0);
        let max_attempts: i64 = row
            .try_get::<i64, _>("max_attempts")
            .unwrap_or(CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS);
        let attempts = previous_attempts.saturating_add(1);

        let result = sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET status = ?,
                attempts = ?,
                last_error = NULL,
                updated_at = ?
            WHERE id = ? AND status = ?;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .bind(attempts)
        .bind(&now)
        .bind(&id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            tx.commit().await?;
            return Ok(None);
        }

        tx.commit().await?;
        Ok(Some(LocalConversationSummaryJob {
            id,
            session_id,
            attempts,
            max_attempts,
        }))
    }

    pub async fn complete_local_conversation_summary_job(&self, job_id: &str) -> Result<(), McpError> {
        let normalized_job_id = job_id.trim().to_string();
        if normalized_job_id.is_empty() {
            return Err(McpError::validation("job_id is required"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;
        let session_row = sqlx::query(
            r#"
            SELECT session_id
            FROM conversation_summary_job
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_job_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET status = ?,
                last_error = NULL,
                available_after_epoch = 0,
                updated_at = ?
            WHERE id = ? AND status = ?;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED)
        .bind(&now)
        .bind(&normalized_job_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if let Some(row) = session_row {
            let session_id: String = row.try_get("session_id")?;
            sqlx::query(
                r#"
                UPDATE conversation_session
                SET summarizing = 0,
                    summary_job_id = '',
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(&now)
            .bind(&session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        tx.commit().await?;

        Ok(())
    }

    pub async fn fail_local_conversation_summary_job(
        &self,
        job: &LocalConversationSummaryJob,
        error_message: &str,
        retry_delay_seconds: i64,
    ) -> Result<(), McpError> {
        let normalized_job_id = job.id.trim().to_string();
        if normalized_job_id.is_empty() {
            return Err(McpError::validation("job_id is required"));
        }

        let max_attempts = if job.max_attempts <= 0 {
            CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS
        } else {
            job.max_attempts
        };
        let should_retry = job.attempts < max_attempts;
        let next_status = if should_retry {
            CONVERSATION_SUMMARY_JOB_STATUS_PENDING
        } else {
            CONVERSATION_SUMMARY_JOB_STATUS_FAILED
        };

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let next_available_after = if should_retry {
            now_epoch.saturating_add(retry_delay_seconds.max(0))
        } else {
            now_epoch
        };
        let normalized_error = {
            let trimmed = error_message.trim();
            if trimmed.is_empty() {
                "conversation summary worker failed".to_string()
            } else {
                trimmed.chars().take(2000).collect()
            }
        };

        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET status = ?,
                available_after_epoch = ?,
                last_error = ?,
                updated_at = ?
            WHERE id = ? AND status = ?;
            "#,
        )
        .bind(next_status)
        .bind(next_available_after)
        .bind(&normalized_error)
        .bind(&now)
        .bind(&normalized_job_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET summarizing = ?,
                summary_job_id = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(if should_retry { 1 } else { 0 })
        .bind(if should_retry {
            normalized_job_id.as_str()
        } else {
            ""
        })
        .bind(&now)
        .bind(&job.session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;

        Ok(())
    }

    pub async fn touch_local_conversation_summary_idle_task(
        &self,
        session_id: &str,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let run_after_epoch = now_epoch.saturating_add(LOCAL_CONVERSATION_SUMMARY_IDLE_SECONDS);

        sqlx::query(
            r#"
            INSERT INTO conversation_summary_idle_task (
              session_id, last_active_epoch, run_after_epoch, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE
            SET last_active_epoch = excluded.last_active_epoch,
                run_after_epoch = conversation_summary_idle_task.run_after_epoch,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(now_epoch)
        .bind(run_after_epoch)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn try_trigger_local_conversation_summary_flush(
        &self,
        session_id: &str,
        trigger_source: &str,
    ) -> Result<bool, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT total_tokens, summarizing
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let total_tokens = session_row.try_get::<i64, _>("total_tokens").unwrap_or(0);
        let summarizing = session_row.try_get::<i64, _>("summarizing").unwrap_or(0) != 0;
        if total_tokens < LOCAL_CONVERSATION_FLUSH_THRESHOLD_TOKENS || summarizing {
            return Ok(false);
        }

        self.enqueue_local_conversation_summary_job(&normalized_session_id, trigger_source)
            .await?;
        Ok(true)
    }

    pub async fn dispatch_due_local_conversation_summary_idle_tasks(
        &self,
    ) -> Result<i64, McpError> {
        let now_epoch = now_unix_epoch()?;
        let due_rows = sqlx::query(
            r#"
            SELECT session_id, last_active_epoch
            FROM conversation_summary_idle_task
            WHERE run_after_epoch <= ?
            ORDER BY run_after_epoch ASC
            LIMIT ?;
            "#,
        )
        .bind(now_epoch)
        .bind(LOCAL_CONVERSATION_IDLE_CHECK_BATCH_SIZE)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut dispatched = 0_i64;
        for row in due_rows {
            let session_id: String = row.try_get("session_id")?;
            let last_active_epoch = row.try_get::<i64, _>("last_active_epoch").unwrap_or(0);

            let claim = sqlx::query(
                r#"
                DELETE FROM conversation_summary_idle_task
                WHERE session_id = ? AND run_after_epoch <= ?;
                "#,
            )
            .bind(&session_id)
            .bind(now_epoch)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if claim.rows_affected() == 0 {
                continue;
            }

            if now_epoch.saturating_sub(last_active_epoch) < LOCAL_CONVERSATION_SUMMARY_IDLE_SECONDS {
                continue;
            }

            let session_row = sqlx::query(
                r#"
                SELECT message_count, summarizing, last_summary_version, last_summary_generated_at
                FROM conversation_session
                WHERE id = ?
                LIMIT 1;
                "#,
            )
            .bind(&session_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let Some(session_row) = session_row else {
                continue;
            };

            let message_count = session_row.try_get::<i64, _>("message_count").unwrap_or(0);
            if message_count <= 0 {
                continue;
            }
            let summarizing = session_row.try_get::<i64, _>("summarizing").unwrap_or(0) != 0;
            if summarizing {
                continue;
            }

            let max_turn_row = sqlx::query(
                r#"
                SELECT COALESCE(MAX(turn_index), 0) AS max_turn
                FROM conversation_message
                WHERE session_id = ? AND is_deleted = 0;
                "#,
            )
            .bind(&session_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let last_turn = max_turn_row.try_get::<i64, _>("max_turn").unwrap_or(0);
            if last_turn <= 0 {
                continue;
            }

            let last_summary_version = session_row
                .try_get::<i64, _>("last_summary_version")
                .unwrap_or(0);
            if last_summary_version > 0 {
                let covered_row = sqlx::query(
                    r#"
                    SELECT covered_to_turn
                    FROM conversation_summary
                    WHERE session_id = ? AND version = ?
                    LIMIT 1;
                    "#,
                )
                .bind(&session_id)
                .bind(last_summary_version)
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
                if let Some(covered_row) = covered_row {
                    let covered_to_turn = covered_row.try_get::<i64, _>("covered_to_turn").unwrap_or(0);
                    if covered_to_turn >= last_turn {
                        continue;
                    }
                }
            }

            let last_summary_generated_at: Option<String> =
                session_row.try_get("last_summary_generated_at").ok().flatten();
            if let Some(last_summary_generated_at) = last_summary_generated_at {
                if let Some(last_summary_epoch) =
                    parse_rfc3339_to_unix_epoch(last_summary_generated_at.as_str())
                {
                    if now_epoch.saturating_sub(last_summary_epoch)
                        < LOCAL_CONVERSATION_SUMMARY_MIN_INTERVAL_SECONDS
                    {
                        continue;
                    }
                }
            }

            self.enqueue_local_conversation_summary_job(&session_id, "idle_check")
                .await?;
            dispatched = dispatched.saturating_add(1);
        }

        Ok(dispatched)
    }

    pub async fn upsert_local_periodic_task(
        &self,
        task_name: &str,
        interval_seconds: i64,
        initial_delay_seconds: i64,
    ) -> Result<(), McpError> {
        let normalized_task_name = task_name.trim().to_string();
        if normalized_task_name.is_empty() {
            return Err(McpError::validation("task_name is required"));
        }
        if interval_seconds <= 0 {
            return Err(McpError::validation("interval_seconds must be greater than 0"));
        }

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let next_run_after_epoch = now_epoch.saturating_add(initial_delay_seconds.max(0));

        sqlx::query(
            r#"
            INSERT INTO local_periodic_task (
              task_name, interval_seconds, next_run_after_epoch, is_enabled,
              last_run_at, last_success_at, last_error, last_error_at,
              created_at, updated_at
            )
            VALUES (?, ?, ?, 1, NULL, NULL, NULL, NULL, ?, ?)
            ON CONFLICT(task_name) DO UPDATE
            SET interval_seconds = excluded.interval_seconds,
                is_enabled = 1,
                next_run_after_epoch = CASE
                    WHEN local_periodic_task.next_run_after_epoch < excluded.next_run_after_epoch
                    THEN local_periodic_task.next_run_after_epoch
                    ELSE excluded.next_run_after_epoch
                END,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&normalized_task_name)
        .bind(interval_seconds)
        .bind(next_run_after_epoch)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn claim_next_local_periodic_task(
        &self,
    ) -> Result<Option<LocalPeriodicTask>, McpError> {
        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let mut tx = self.pool.begin().await?;

        let task_row = sqlx::query(
            r#"
            SELECT task_name, interval_seconds, next_run_after_epoch
            FROM local_periodic_task
            WHERE is_enabled = 1 AND next_run_after_epoch <= ?
            ORDER BY next_run_after_epoch ASC
            LIMIT 1;
            "#,
        )
        .bind(now_epoch)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let Some(row) = task_row else {
            tx.commit().await?;
            return Ok(None);
        };

        let task_name: String = row.try_get("task_name")?;
        let interval_seconds = row.try_get::<i64, _>("interval_seconds").unwrap_or(60).max(1);
        let next_run_after_epoch = now_epoch.saturating_add(interval_seconds);

        let result = sqlx::query(
            r#"
            UPDATE local_periodic_task
            SET next_run_after_epoch = ?,
                last_run_at = ?,
                updated_at = ?
            WHERE task_name = ? AND is_enabled = 1 AND next_run_after_epoch <= ?;
            "#,
        )
        .bind(next_run_after_epoch)
        .bind(&now)
        .bind(&now)
        .bind(&task_name)
        .bind(now_epoch)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            tx.commit().await?;
            return Ok(None);
        }

        tx.commit().await?;
        Ok(Some(LocalPeriodicTask {
            task_name,
            interval_seconds,
        }))
    }

    pub async fn mark_local_periodic_task_success(&self, task_name: &str) -> Result<(), McpError> {
        let normalized_task_name = task_name.trim().to_string();
        if normalized_task_name.is_empty() {
            return Err(McpError::validation("task_name is required"));
        }
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            UPDATE local_periodic_task
            SET last_success_at = ?,
                last_error = NULL,
                last_error_at = NULL,
                updated_at = ?
            WHERE task_name = ?;
            "#,
        )
        .bind(&now)
        .bind(&now)
        .bind(&normalized_task_name)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn mark_local_periodic_task_failure(
        &self,
        task_name: &str,
        error_message: &str,
    ) -> Result<(), McpError> {
        let normalized_task_name = task_name.trim().to_string();
        if normalized_task_name.is_empty() {
            return Err(McpError::validation("task_name is required"));
        }
        let now = now_rfc3339()?;
        let normalized_error = {
            let trimmed = error_message.trim();
            if trimmed.is_empty() {
                "periodic task failed".to_string()
            } else {
                trimmed
                    .chars()
                    .take(LOCAL_PERIODIC_TASK_MAX_ERROR_CHARS)
                    .collect()
            }
        };

        sqlx::query(
            r#"
            UPDATE local_periodic_task
            SET last_error = ?,
                last_error_at = ?,
                updated_at = ?
            WHERE task_name = ?;
            "#,
        )
        .bind(&normalized_error)
        .bind(&now)
        .bind(&now)
        .bind(&normalized_task_name)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn cleanup_old_local_conversation_summary_jobs(
        &self,
        older_than_seconds: i64,
    ) -> Result<i64, McpError> {
        if older_than_seconds <= 0 {
            return Err(McpError::validation(
                "older_than_seconds must be greater than 0",
            ));
        }
        let threshold_epoch = now_unix_epoch()?.saturating_sub(older_than_seconds);
        let result = sqlx::query(
            r#"
            DELETE FROM conversation_summary_job
            WHERE status IN (?, ?)
              AND COALESCE(CAST(strftime('%s', updated_at) AS INTEGER), 0) <= ?;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_FAILED)
        .bind(threshold_epoch)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(i64::try_from(result.rows_affected()).unwrap_or(i64::MAX))
    }

    pub async fn get_local_conversation_history(
        &self,
        session_id: &str,
        query: LocalConversationHistoryQuery,
    ) -> Result<LocalConversationHistoryResponse, McpError> {
        let limit = query.limit.unwrap_or(30).clamp(1, 200);
        let before_turn = query.cursor;

        let rows = if let Some(cursor) = before_turn {
            sqlx::query(
                r#"
                SELECT role, content, turn_index, created_at, is_truncated, name, meta_info
                FROM conversation_message
                WHERE session_id = ? AND is_deleted = 0 AND turn_index < ?
                ORDER BY turn_index DESC
                LIMIT ?;
                "#,
            )
            .bind(session_id)
            .bind(cursor)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        } else {
            sqlx::query(
                r#"
                SELECT role, content, turn_index, created_at, is_truncated, name, meta_info
                FROM conversation_message
                WHERE session_id = ? AND is_deleted = 0
                ORDER BY turn_index DESC
                LIMIT ?;
                "#,
            )
            .bind(session_id)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        };

        let mut messages_desc = Vec::with_capacity(rows.len());
        for row in rows {
            let content_text: Option<String> = row.try_get("content")?;
            let meta_info_text: Option<String> = row.try_get("meta_info")?;
            messages_desc.push(LocalConversationHistoryMessage {
                role: row.try_get("role")?,
                content: content_text.map(serde_json::Value::String),
                turn_index: row.try_get("turn_index")?,
                created_at: row.try_get("created_at")?,
                is_truncated: Some(row.try_get::<i64, _>("is_truncated")? != 0),
                name: row.try_get("name")?,
                meta_info: match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                },
            });
        }

        let oldest_turn = messages_desc
            .last()
            .and_then(|item| item.turn_index)
            .unwrap_or_default();
        let has_more = if messages_desc.is_empty() {
            false
        } else {
            let row = sqlx::query(
                r#"
                SELECT EXISTS(
                  SELECT 1
                  FROM conversation_message
                  WHERE session_id = ? AND is_deleted = 0 AND turn_index < ?
                ) AS has_more;
                "#,
            )
            .bind(session_id)
            .bind(oldest_turn)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            row.try_get::<i64, _>("has_more")? != 0
        };

        let mut messages = messages_desc;
        messages.reverse();

        Ok(LocalConversationHistoryResponse {
            session_id: session_id.to_string(),
            messages,
            next_cursor: if has_more { Some(oldest_turn) } else { None },
            has_more,
        })
    }

    pub async fn get_local_conversation_window(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationWindowResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT
              id, title, status, message_count, total_tokens, last_summary_version,
              summarizing, summary_job_id, last_summary_generated_at,
              first_message_at, last_active_at, created_at, updated_at
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let session_row = match session_row {
            Some(row) => row,
            None => {
                return Err(McpError::NotFound(
                    "conversation session not found".to_string(),
                ))
            }
        };

        let rows = sqlx::query(
            r#"
            SELECT role, content, turn_index, created_at, is_truncated, name, meta_info
            FROM conversation_message
            WHERE session_id = ? AND is_deleted = 0
            ORDER BY turn_index ASC;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut messages = Vec::with_capacity(rows.len());
        for row in rows {
            let content_text: Option<String> = row.try_get("content")?;
            let meta_info_text: Option<String> = row.try_get("meta_info")?;
            messages.push(LocalConversationHistoryMessage {
                role: row.try_get("role")?,
                content: content_text.map(serde_json::Value::String),
                turn_index: row.try_get("turn_index")?,
                created_at: row.try_get("created_at")?,
                is_truncated: Some(row.try_get::<i64, _>("is_truncated")? != 0),
                name: row.try_get("name")?,
                meta_info: match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                },
            });
        }

        let last_summary_version: i64 = session_row.try_get("last_summary_version").unwrap_or(0);
        let summary = if last_summary_version > 0 {
            let summary_row = sqlx::query(
                r#"
                SELECT
                  id, version, summary_text, covered_from_turn, covered_to_turn,
                  token_estimate, summarizer_model, created_at, updated_at
                FROM conversation_summary
                WHERE session_id = ? AND version = ?
                LIMIT 1;
                "#,
            )
            .bind(&normalized_session_id)
            .bind(last_summary_version)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            summary_row.map(|row| {
                serde_json::json!({
                    "id": row.try_get::<String, _>("id").ok(),
                    "version": row.try_get::<i64, _>("version").ok(),
                    "summary_text": row.try_get::<String, _>("summary_text").ok(),
                    "covered_from_turn": row.try_get::<i64, _>("covered_from_turn").ok(),
                    "covered_to_turn": row.try_get::<i64, _>("covered_to_turn").ok(),
                    "token_estimate": row.try_get::<i64, _>("token_estimate").ok().unwrap_or(0),
                    "summarizer_model": row.try_get::<Option<String>, _>("summarizer_model").ok().flatten(),
                    "created_at": row.try_get::<String, _>("created_at").ok(),
                    "updated_at": row.try_get::<String, _>("updated_at").ok(),
                })
            })
        } else {
            None
        };

        let meta = Some(serde_json::json!({
            "title": session_row.try_get::<Option<String>, _>("title").ok().flatten(),
            "status": session_row.try_get::<String, _>("status").ok(),
            "message_count": session_row.try_get::<i64, _>("message_count").ok().unwrap_or(0),
            "total_tokens": session_row.try_get::<i64, _>("total_tokens").ok().unwrap_or(0),
            "last_summary_version": last_summary_version,
            "summarizing": session_row.try_get::<i64, _>("summarizing").ok().unwrap_or(0) != 0,
            "summary_job_id": session_row.try_get::<Option<String>, _>("summary_job_id").ok().flatten(),
            "last_summary_generated_at": session_row.try_get::<Option<String>, _>("last_summary_generated_at").ok().flatten(),
            "first_message_at": session_row.try_get::<Option<String>, _>("first_message_at").ok().flatten(),
            "last_active_at": session_row.try_get::<Option<String>, _>("last_active_at").ok().flatten(),
            "created_at": session_row.try_get::<Option<String>, _>("created_at").ok().flatten(),
            "updated_at": session_row.try_get::<Option<String>, _>("updated_at").ok().flatten(),
        }));

        Ok(LocalConversationWindowResponse {
            session_id: normalized_session_id,
            messages,
            meta,
            summary,
        })
    }

    async fn migrate_assistant_versions_from_legacy(&self) -> Result<(), McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, description, system_prompt, model_config, tags, is_deleted, created_at, updated_at
            FROM assistants;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        for row in rows {
            let assistant_id: String = row.try_get("id")?;
            let name: String = row.try_get("name")?;
            let description: Option<String> = row.try_get("description")?;
            let system_prompt: String = row.try_get("system_prompt")?;
            let model_config: Option<String> = row.try_get("model_config")?;
            let tags: Option<String> = row.try_get("tags")?;
            let is_deleted = row.try_get::<i64, _>("is_deleted").unwrap_or(0) != 0;
            let created_at: String = row.try_get("created_at")?;
            let updated_at: String = row.try_get("updated_at")?;
            let published_at = if is_deleted {
                None
            } else {
                Some(created_at.as_str())
            };

            self.ensure_assistant_version_synced(
                &assistant_id,
                &name,
                description.as_deref(),
                &system_prompt,
                model_config.as_deref(),
                tags.as_deref(),
                published_at,
                &created_at,
                &updated_at,
            )
            .await?;
        }

        Ok(())
    }

    async fn migrate_assistant_installs_from_assistant(&self) -> Result<(), McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, status, created_at
            FROM assistant
            ORDER BY created_at ASC, id ASC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut sort_order = 0_i64;
        for row in rows {
            let assistant_id: String = row.try_get("id")?;
            let status: String = row.try_get("status")?;
            let created_at: String = row.try_get("created_at")?;
            if status == "archived" {
                continue;
            }

            let existing = sqlx::query(
                r#"
                SELECT id
                FROM assistant_install
                WHERE user_id = ? AND assistant_id = ?
                LIMIT 1;
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if existing.is_none() {
                let install_id = Uuid::new_v4().to_string();
                sqlx::query(
                    r#"
                    INSERT INTO assistant_install (
                      id, user_id, assistant_id, alias, icon_override, pinned_version_id,
                      follow_latest, is_enabled, sort_order, created_at, updated_at
                    )
                    VALUES (?, ?, ?, NULL, NULL, NULL, 1, 1, ?, ?, ?);
                    "#,
                )
                .bind(&install_id)
                .bind(LOCAL_DESKTOP_USER_ID)
                .bind(&assistant_id)
                .bind(sort_order)
                .bind(&created_at)
                .bind(&created_at)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            }

            self.refresh_assistant_install_count(&assistant_id, &created_at)
                .await?;
            sort_order += 1;
        }

        Ok(())
    }

    async fn refresh_assistant_install_count(
        &self,
        assistant_id: &str,
        updated_at: &str,
    ) -> Result<(), McpError> {
        sqlx::query(
            r#"
            UPDATE assistant
            SET install_count = (
                SELECT COUNT(1)
                FROM assistant_install
                WHERE assistant_id = ?
            ),
            updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(assistant_id)
        .bind(updated_at)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    async fn sync_local_assistant_tags(
        &self,
        assistant_id: &str,
        tags_json: Option<&str>,
        updated_at: &str,
    ) -> Result<(), McpError> {
        let raw_tags: Vec<String> = match tags_json {
            Some(value) if !value.trim().is_empty() => serde_json::from_str(value).unwrap_or_default(),
            _ => Vec::new(),
        };
        let normalized = normalize_assistant_tag_names(raw_tags);

        let existing_rows = sqlx::query(
            r#"
            SELECT t.id AS tag_id, t.name AS tag_name
            FROM assistant_tag_link l
            INNER JOIN assistant_tag t ON t.id = l.tag_id
            WHERE l.assistant_id = ?;
            "#,
        )
        .bind(assistant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut existing_by_name: HashMap<String, String> = HashMap::new();
        let mut current_ids: HashSet<String> = HashSet::new();
        for row in existing_rows {
            let tag_id: String = row.try_get("tag_id")?;
            let tag_name: String = row.try_get("tag_name")?;
            current_ids.insert(tag_id.clone());
            existing_by_name.insert(tag_name, tag_id);
        }

        let mut desired_ids: HashSet<String> = HashSet::new();
        for name in normalized {
            if let Some(existing_id) = existing_by_name.get(&name) {
                desired_ids.insert(existing_id.clone());
                continue;
            }

            let existing_tag_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_tag
                WHERE name = ?
                LIMIT 1;
                "#,
            )
            .bind(&name)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let tag_id = if let Some(row) = existing_tag_row {
                row.try_get::<String, _>("id")?
            } else {
                let new_id = Uuid::new_v4().to_string();
                sqlx::query(
                    r#"
                    INSERT INTO assistant_tag (id, name, created_at, updated_at)
                    VALUES (?, ?, ?, ?);
                    "#,
                )
                .bind(&new_id)
                .bind(&name)
                .bind(updated_at)
                .bind(updated_at)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
                new_id
            };

            existing_by_name.insert(name, tag_id.clone());
            desired_ids.insert(tag_id);
        }

        for tag_id in current_ids.difference(&desired_ids) {
            sqlx::query(
                r#"
                DELETE FROM assistant_tag_link
                WHERE assistant_id = ? AND tag_id = ?;
                "#,
            )
            .bind(assistant_id)
            .bind(tag_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        for tag_id in desired_ids.difference(&current_ids) {
            sqlx::query(
                r#"
                INSERT OR IGNORE INTO assistant_tag_link (assistant_id, tag_id)
                VALUES (?, ?);
                "#,
            )
            .bind(assistant_id)
            .bind(tag_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        Ok(())
    }

    async fn refresh_assistant_rating(
        &self,
        assistant_id: &str,
        updated_at: &str,
    ) -> Result<(f64, i64), McpError> {
        let row = sqlx::query(
            r#"
            SELECT
              COALESCE(AVG(rating), 0.0) AS avg_rating,
              COUNT(1) AS total_count
            FROM assistant_rating
            WHERE assistant_id = ?;
            "#,
        )
        .bind(assistant_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let avg_rating = round_to_4(row.try_get::<f64, _>("avg_rating").unwrap_or(0.0));
        let total_count = row.try_get::<i64, _>("total_count").unwrap_or(0);

        sqlx::query(
            r#"
            UPDATE assistant
            SET rating_avg = ?, rating_count = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(avg_rating)
        .bind(total_count)
        .bind(updated_at)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok((avg_rating, total_count))
    }

    async fn get_local_assistant_install_item(
        &self,
        assistant_id: &str,
    ) -> Result<Option<LocalAssistantInstallItem>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT
              ai.id AS install_id,
              ai.assistant_id AS install_assistant_id,
              ai.alias AS install_alias,
              ai.icon_override AS install_icon_override,
              ai.pinned_version_id AS install_pinned_version_id,
              ai.follow_latest AS install_follow_latest,
              ai.is_enabled AS install_is_enabled,
              ai.sort_order AS install_sort_order,
              a.owner_user_id AS assistant_owner_user_id,
              a.icon_id AS assistant_icon_id,
              a.share_slug AS assistant_share_slug,
              a.summary AS assistant_summary,
              a.published_at AS assistant_published_at,
              a.current_version_id AS assistant_current_version_id,
              a.install_count AS assistant_install_count,
              a.rating_avg AS assistant_rating_avg,
              a.rating_count AS assistant_rating_count,
              cv.id AS current_version_id,
              cv.version AS current_version,
              cv.name AS current_name,
              cv.description AS current_description,
              cv.system_prompt AS current_system_prompt,
              cv.tags AS current_tags,
              cv.published_at AS current_published_at,
              pv.id AS pinned_id,
              pv.version AS pinned_version,
              pv.name AS pinned_name,
              pv.description AS pinned_description,
              pv.system_prompt AS pinned_system_prompt,
              pv.tags AS pinned_tags,
              pv.published_at AS pinned_published_at
            FROM assistant_install ai
            INNER JOIN assistant a ON a.id = ai.assistant_id
            LEFT JOIN assistant_version cv ON cv.id = a.current_version_id
            LEFT JOIN assistant_version pv ON pv.id = ai.pinned_version_id
            WHERE ai.user_id = ? AND ai.assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        match row {
            Some(row) => Ok(Some(row_to_assistant_install_item(&row)?)),
            None => Ok(None),
        }
    }

    async fn ensure_assistant_version_synced(
        &self,
        assistant_id: &str,
        name: &str,
        description: Option<&str>,
        system_prompt: &str,
        model_config_json: Option<&str>,
        tags_json: Option<&str>,
        published_at: Option<&str>,
        created_at: &str,
        updated_at: &str,
    ) -> Result<String, McpError> {
        let current_version_row = sqlx::query(
            r#"
            SELECT current_version_id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if current_version_row.is_none() {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }

        let current_version_id: Option<String> =
            current_version_row.unwrap().try_get("current_version_id")?;

        let selected_version_id = if let Some(version_id) = current_version_id {
            let row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE id = ?
                LIMIT 1;
                "#,
            )
            .bind(&version_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if row.is_some() {
                version_id
            } else {
                let fallback_row = sqlx::query(
                    r#"
                    SELECT id
                    FROM assistant_version
                    WHERE assistant_id = ?
                    ORDER BY created_at DESC, id DESC
                    LIMIT 1;
                    "#,
                )
                .bind(assistant_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                if let Some(row) = fallback_row {
                    row.try_get("id")?
                } else {
                    let new_version_id = Uuid::new_v4().to_string();
                    sqlx::query(
                        r#"
                        INSERT INTO assistant_version (
                          id, assistant_id, version, name, description, system_prompt, model_config,
                          skill_refs, tags, changelog, published_at, created_at, updated_at
                        )
                        VALUES (?, ?, '1.0.0', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?);
                        "#,
                    )
                    .bind(&new_version_id)
                    .bind(assistant_id)
                    .bind(name)
                    .bind(description)
                    .bind(system_prompt)
                    .bind(model_config_json)
                    .bind(Some("[]"))
                    .bind(tags_json)
                    .bind(published_at)
                    .bind(created_at)
                    .bind(updated_at)
                    .execute(&self.pool)
                    .await
                    .map_err(|err| McpError::Storage(err.to_string()))?;
                    new_version_id
                }
            }
        } else {
            let existing_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE assistant_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT 1;
                "#,
            )
            .bind(assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if let Some(row) = existing_row {
                row.try_get("id")?
            } else {
                let new_version_id = Uuid::new_v4().to_string();
                sqlx::query(
                    r#"
                    INSERT INTO assistant_version (
                      id, assistant_id, version, name, description, system_prompt, model_config,
                      skill_refs, tags, changelog, published_at, created_at, updated_at
                    )
                    VALUES (?, ?, '1.0.0', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?);
                    "#,
                )
                .bind(&new_version_id)
                .bind(assistant_id)
                .bind(name)
                .bind(description)
                .bind(system_prompt)
                .bind(model_config_json)
                .bind(Some("[]"))
                .bind(tags_json)
                .bind(published_at)
                .bind(created_at)
                .bind(updated_at)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
                new_version_id
            }
        };

        sqlx::query(
            r#"
            UPDATE assistant_version
            SET name = ?, description = ?, system_prompt = ?, model_config = ?,
                tags = ?, updated_at = ?, published_at = COALESCE(?, published_at)
            WHERE id = ?;
            "#,
        )
        .bind(name)
        .bind(description)
        .bind(system_prompt)
        .bind(model_config_json)
        .bind(tags_json)
        .bind(updated_at)
        .bind(published_at)
        .bind(&selected_version_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE assistant
            SET current_version_id = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&selected_version_id)
        .bind(updated_at)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.sync_local_assistant_tags(assistant_id, tags_json, updated_at)
            .await?;

        Ok(selected_version_id)
    }

    async fn ensure_column(&self, table: &str, column: &str, ddl: &str) -> Result<(), McpError> {
        let sql = format!("PRAGMA table_info({})", table);
        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let exists = rows.iter().any(|row: &SqliteRow| {
            row.try_get::<String, _>("name")
                .map(|name| name == column)
                .unwrap_or(false)
        });
        if !exists {
            sqlx::query(ddl)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct NewSource {
    pub name: String,
    pub source_type: McpSourceType,
    pub path_or_url: String,
    pub trust_level: McpTrustLevel,
    pub status: McpSourceStatus,
    pub last_synced_at: Option<String>,
    pub is_read_only: bool,
}

#[derive(Clone)]
pub struct ToolUpsert {
    pub id: Option<String>,
    pub source_id: String,
    pub identifier: Option<String>,
    pub name: String,
    pub source_type: McpSourceType,
    pub status: McpToolStatus,
    pub ping_ms: Option<i64>,
    pub capabilities: Vec<String>,
    pub description: String,
    pub error: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub config_json: String,
    pub config_hash: String,
    pub pending_config_json: Option<String>,
    pub pending_config_hash: Option<String>,
    pub conflict_status: McpConflictStatus,
    pub is_read_only: bool,
    pub is_new: bool,
}

pub struct ExtractedToolFields {
    pub name: String,
    pub description: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub capabilities: Vec<String>,
}

pub struct LocalConversationRegenerateContext {
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub deleted_turn_index: Option<i64>,
    pub messages: Vec<LocalChatInputMessage>,
}

pub struct LocalConversationChatContext {
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub messages: Vec<LocalChatInputMessage>,
}

fn row_to_source(row: &SqliteRow) -> Result<McpSource, McpError> {
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

fn row_to_tool(row: &SqliteRow) -> Result<McpTool, McpError> {
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

fn row_to_assistant(row: &SqliteRow) -> Result<LocalAssistant, McpError> {
    let tags: Option<Vec<String>> = deserialize_json(row.try_get("tags")?)?;
    let model_config: Option<serde_json::Value> = deserialize_json(row.try_get("model_config")?)?;
    Ok(LocalAssistant {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        avatar: row.try_get("avatar")?,
        system_prompt: row.try_get("system_prompt")?,
        model_config,
        tags: tags.unwrap_or_default(),
        visibility: row.try_get("visibility")?,
        source: row.try_get("source")?,
        cloud_id: row.try_get("cloud_id")?,
        is_deleted: row.try_get::<i64, _>("is_deleted")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_assistant_entity(row: &SqliteRow) -> Result<LocalAssistantEntity, McpError> {
    Ok(LocalAssistantEntity {
        id: row.try_get("id")?,
        owner_user_id: row.try_get("owner_user_id")?,
        visibility: row.try_get("visibility")?,
        status: row.try_get("status")?,
        share_slug: row.try_get("share_slug")?,
        summary: row.try_get("summary")?,
        icon_id: row.try_get("icon_id")?,
        install_count: row.try_get("install_count")?,
        rating_avg: row.try_get("rating_avg")?,
        rating_count: row.try_get("rating_count")?,
        current_version_id: row.try_get("current_version_id")?,
        published_at: row.try_get("published_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_assistant_version(row: &SqliteRow) -> Result<LocalAssistantVersion, McpError> {
    let model_config: Option<serde_json::Value> = deserialize_json(row.try_get("model_config")?)?;
    let skill_refs: Option<Vec<serde_json::Value>> = deserialize_json(row.try_get("skill_refs")?)?;
    let tags: Option<Vec<String>> = deserialize_json(row.try_get("tags")?)?;
    Ok(LocalAssistantVersion {
        id: row.try_get("id")?,
        assistant_id: row.try_get("assistant_id")?,
        version: row.try_get("version")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        system_prompt: row.try_get("system_prompt")?,
        model_config,
        skill_refs: skill_refs.unwrap_or_default(),
        tags: tags.unwrap_or_default(),
        changelog: row.try_get("changelog")?,
        published_at: row.try_get("published_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_assistant_install_item(row: &SqliteRow) -> Result<LocalAssistantInstallItem, McpError> {
    let follow_latest = row.try_get::<i64, _>("install_follow_latest").unwrap_or(1) != 0;
    let pinned_version_id: Option<String> = row.try_get("install_pinned_version_id")?;
    let use_pinned = !follow_latest
        && pinned_version_id.is_some()
        && row.try_get::<Option<String>, _>("pinned_id")?.is_some();

    let version_id = if use_pinned {
        row.try_get::<Option<String>, _>("pinned_id")?
    } else {
        row.try_get::<Option<String>, _>("current_version_id")?
    }
    .ok_or_else(|| McpError::validation("assistant version missing"))?;

    let version = LocalAssistantSummaryVersion {
        id: version_id,
        version: if use_pinned {
            row.try_get::<Option<String>, _>("pinned_version")?
        } else {
            row.try_get::<Option<String>, _>("current_version")?
        }
        .unwrap_or_else(|| "1.0.0".to_string()),
        name: if use_pinned {
            row.try_get::<Option<String>, _>("pinned_name")?
        } else {
            row.try_get::<Option<String>, _>("current_name")?
        }
        .unwrap_or_else(|| "Assistant".to_string()),
        description: if use_pinned {
            row.try_get("pinned_description")?
        } else {
            row.try_get("current_description")?
        },
        system_prompt: if use_pinned {
            row.try_get("pinned_system_prompt")?
        } else {
            row.try_get("current_system_prompt")?
        },
        tags: if use_pinned {
            deserialize_json(row.try_get("pinned_tags")?)?.unwrap_or_default()
        } else {
            deserialize_json(row.try_get("current_tags")?)?.unwrap_or_default()
        },
        published_at: if use_pinned {
            row.try_get("pinned_published_at")?
        } else {
            row.try_get("current_published_at")?
        },
    };

    let assistant = LocalAssistantSummary {
        assistant_id: row.try_get("install_assistant_id")?,
        owner_user_id: row.try_get("assistant_owner_user_id")?,
        icon_id: row.try_get("assistant_icon_id")?,
        share_slug: row.try_get("assistant_share_slug")?,
        summary: row.try_get("assistant_summary")?,
        published_at: row.try_get("assistant_published_at")?,
        current_version_id: row.try_get("assistant_current_version_id")?,
        install_count: row.try_get("assistant_install_count").unwrap_or(0),
        rating_avg: row.try_get("assistant_rating_avg").unwrap_or(0.0),
        rating_count: row.try_get("assistant_rating_count").unwrap_or(0),
        tags: version.tags.clone(),
        version,
    };

    Ok(LocalAssistantInstallItem {
        id: row.try_get("install_id")?,
        assistant_id: assistant.assistant_id.clone(),
        alias: row.try_get("install_alias")?,
        icon_override: row.try_get("install_icon_override")?,
        pinned_version_id,
        follow_latest,
        is_enabled: row.try_get::<i64, _>("install_is_enabled").unwrap_or(1) != 0,
        sort_order: row.try_get("install_sort_order").unwrap_or(0),
        assistant,
    })
}

fn row_to_assistant_message(row: &SqliteRow) -> Result<LocalAssistantMessage, McpError> {
    Ok(LocalAssistantMessage {
        id: row.try_get("id")?,
        assistant_id: row.try_get("assistant_id")?,
        role: row.try_get("role")?,
        content: row.try_get("content")?,
        is_deleted: row.try_get::<i64, _>("is_deleted")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn deserialize_json<T>(value: Option<String>) -> Result<Option<T>, McpError>
where
    T: serde::de::DeserializeOwned,
{
    match value {
        Some(text) => Ok(Some(serde_json::from_str(&text)?)),
        None => Ok(None),
    }
}

fn serialize_json<T>(value: &Option<T>) -> Result<Option<String>, McpError>
where
    T: serde::Serialize,
{
    match value {
        Some(data) => Ok(Some(serde_json::to_string(data)?)),
        None => Ok(None),
    }
}

fn normalize_assistant_tag_names(tags: Vec<String>) -> Vec<String> {
    let mut cleaned = Vec::new();
    let mut seen = HashSet::new();
    for raw in tags {
        let mut name = raw.trim().to_string();
        if name.is_empty() {
            continue;
        }
        if !name.starts_with('#') {
            name = format!("#{name}");
        }
        if seen.insert(name.clone()) {
            cleaned.push(name);
        }
    }
    cleaned
}

fn normalize_feedback_tags(tags: Vec<String>) -> Vec<String> {
    let mut cleaned = Vec::new();
    let mut seen = HashSet::new();
    for raw in tags {
        let name = raw.trim().to_string();
        if name.is_empty() {
            continue;
        }
        if seen.insert(name.clone()) {
            cleaned.push(name);
        }
    }
    cleaned
}

fn round_to_4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn now_rfc3339() -> Result<String, McpError> {
    Ok(time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| McpError::Storage(err.to_string()))?)
}

fn now_unix_epoch() -> Result<i64, McpError> {
    Ok(time::OffsetDateTime::now_utc().unix_timestamp())
}

fn parse_rfc3339_to_unix_epoch(value: &str) -> Option<i64> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(|dt| dt.unix_timestamp())
}

fn estimate_token_count(text: &str) -> i64 {
    if text.trim().is_empty() {
        return 0;
    }
    let chars = text.chars().count() as i64;
    (chars / 4).max(1)
}

fn parse_assistant_routing_feedback_event(event: &str) -> Option<bool> {
    let normalized = event.trim().to_ascii_lowercase();
    if ["thumbs_up", "like", "up", "positive"].contains(&normalized.as_str()) {
        return Some(true);
    }
    if ["thumbs_down", "dislike", "down", "negative", "regenerate"].contains(&normalized.as_str()) {
        return Some(false);
    }
    None
}

fn hash_json(value: &serde_json::Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn expand_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    }
    PathBuf::from(path)
}
