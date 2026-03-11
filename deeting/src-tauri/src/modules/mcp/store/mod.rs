use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::str::FromStr;

use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;
use uuid::Uuid;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::types::{
    CloudSystemAssetSyncItem, CloudSystemAssistantSnapshot, CreateAssistantMessageRequest,
    CreateConversationMessageRequest, CreateLocalAssistantRequest,
    CreateLocalKnowledgeFolderRequest, CreateLocalUserDocumentRequest, LocalAdminConversationItem,
    LocalAdminConversationListResponse, LocalAdminConversationMessageItem,
    LocalAdminConversationMessageListResponse, LocalAdminConversationMessageQuery,
    LocalAdminConversationQuery, LocalAdminConversationSummaryItem,
    LocalAdminConversationSummaryListResponse, LocalAssistant, LocalAssistantEntity,
    LocalAssistantInstallCreateRequest, LocalAssistantInstallItem, LocalAssistantInstallPage,
    LocalAssistantInstallQuery, LocalAssistantInstallUpdateRequest, LocalAssistantMessage,
    LocalAssistantRatingRequest, LocalAssistantRatingResponse,
    LocalAssistantRoutingFeedbackRequest, LocalAssistantRoutingReportItem,
    LocalAssistantRoutingReportQuery, LocalAssistantRoutingReportResponse,
    LocalAssistantRoutingReportSummary, LocalAssistantRoutingState, LocalAssistantSummary,
    LocalAssistantSummaryVersion, LocalAssistantTag, LocalAssistantVersion, LocalChatInputMessage,
    LocalConversationArchiveResponse, LocalConversationClearResponse,
    LocalConversationCompareFinalizeRequest, LocalConversationCompareFinalizeResponse,
    LocalConversationCreateRequest, LocalConversationCreateResponse,
    LocalConversationDeleteResponse, LocalConversationHistoryMessage,
    LocalConversationHistoryQuery, LocalConversationHistoryResponse,
    LocalConversationRenameResponse, LocalConversationSessionItem, LocalConversationSessionPage,
    LocalConversationSessionsQuery, LocalConversationStatus,
    LocalConversationSummaryBatchRetryRequest, LocalConversationSummaryBatchRetryResponse,
    LocalConversationSummaryEnqueueResponse, LocalConversationSummaryIdleTaskItem,
    LocalConversationSummaryIdleTaskListResponse, LocalConversationSummaryIdleTaskQuery,
    LocalConversationSummaryJobItem, LocalConversationSummaryJobListResponse,
    LocalConversationSummaryJobQuery, LocalConversationSummaryQueueStats,
    LocalConversationWindowResponse, LocalGatewayLogItem, LocalGatewayLogListResponse,
    LocalGatewayLogQuery, LocalGatewayLogStatsBucket, LocalGatewayLogStatsResponse,
    LocalKnowledgeBreadcrumbItem, LocalKnowledgeChunk, LocalKnowledgeChunkListResponse,
    LocalKnowledgeFile, LocalKnowledgeFolder, LocalKnowledgeSearchHit, LocalKnowledgeStatsResponse,
    LocalKnowledgeTreeQuery, LocalKnowledgeTreeResponse, LocalMaintenanceLogItem,
    LocalMaintenanceLogListResponse, LocalMaintenanceLogQuery, LocalTraceFeedback,
    LocalTraceFeedbackRequest, LocalUserDocumentChunkListQuery, LocalUserDocumentListQuery,
    McpConflictStatus, McpSource, McpSourceStatus, McpSourceType, McpTool, McpToolConfigPayload,
    McpToolStatus, McpTrustLevel, UpdateLocalAssistantRequest, UpdateLocalKnowledgeFolderRequest,
    UpdateLocalUserDocumentRequest,
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
const LOCAL_KNOWLEDGE_TOTAL_BYTES: i64 = 10 * 1024 * 1024 * 1024;
const LOCAL_KNOWLEDGE_CHUNK_MAX_CHARS: usize = 1200;
const LOCAL_KNOWLEDGE_CHUNK_OVERLAP_CHARS: usize = 120;

pub struct McpStore {
    pub(crate) pool: SqlitePool,
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

#[derive(Debug, Clone)]
pub struct LocalSkillInstallSnapshot {
    pub skill_id: String,
    pub installed_version: Option<String>,
    pub is_enabled: bool,
    pub runtime: Option<String>,
    pub install_path: String,
}

mod assistants;
mod conversations;
mod helpers;
mod knowledge;
mod source_tools;
mod system_assets;

#[cfg(test)]
mod tests;

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
            CREATE TABLE IF NOT EXISTS knowledge_folder (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              parent_id TEXT,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (parent_id) REFERENCES knowledge_folder(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_folder_user_parent_name
            ON knowledge_folder(user_id, parent_id, name);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_folder_user_root_name
            ON knowledge_folder(user_id, name)
            WHERE parent_id IS NULL;
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_folder_user_id
            ON knowledge_folder(user_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_folder_parent_id
            ON knowledge_folder(parent_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS user_document (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              media_asset_id TEXT NOT NULL,
              filename TEXT NOT NULL,
              folder_id TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              error_message TEXT,
              chunk_count INTEGER NOT NULL DEFAULT 0,
              embedding_model TEXT,
              meta_info TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (folder_id) REFERENCES knowledge_folder(id) ON DELETE SET NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_user_id
            ON user_document(user_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_status
            ON user_document(status);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_media_asset_id
            ON user_document(media_asset_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_folder_id
            ON user_document(folder_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS knowledge_chunk (
              id TEXT PRIMARY KEY,
              document_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              chunk_index INTEGER NOT NULL,
              text_content TEXT NOT NULL,
              token_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (document_id) REFERENCES user_document(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_chunk_document_index
            ON knowledge_chunk(document_id, chunk_index);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_document_id
            ON knowledge_chunk(document_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_user_id
            ON knowledge_chunk(user_id);
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
            CREATE TABLE IF NOT EXISTS local_skill_install (
              user_id TEXT NOT NULL,
              skill_id TEXT NOT NULL,
              installed_version TEXT NOT NULL,
              is_enabled INTEGER NOT NULL DEFAULT 1,
              runtime TEXT,
              manifest_json TEXT NOT NULL,
              install_path TEXT NOT NULL,
              user_settings_json TEXT,
              installed_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (user_id, skill_id)
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_local_skill_install_user_enabled
            ON local_skill_install(user_id, is_enabled);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

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
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_system_asset_status_kind
            ON system_asset(status, asset_kind);
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
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_maintenance_log_kind
            ON maintenance_log(kind);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_maintenance_log_status
            ON maintenance_log(status);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_maintenance_log_created_at
            ON maintenance_log(created_at);
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
              last_model_id TEXT,
              last_provider_model_id TEXT,
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
            "conversation_session",
            "last_model_id",
            "ALTER TABLE conversation_session ADD COLUMN last_model_id TEXT;",
        )
        .await?;

        self.ensure_column(
            "conversation_session",
            "last_provider_model_id",
            "ALTER TABLE conversation_session ADD COLUMN last_provider_model_id TEXT;",
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

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS desktop_config (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.purge_legacy_skill_mcp_rows().await?;
        self.migrate_assistant_version_drop_skill_refs().await?;
        self.migrate_assistant_versions_from_legacy().await?;
        self.migrate_assistant_installs_from_assistant().await?;

        Ok(())
    }

    pub async fn get_desktop_config(&self, key: &str) -> Result<Option<String>, McpError> {
        let row = sqlx::query("SELECT value FROM desktop_config WHERE key = ? LIMIT 1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(row.and_then(|r| r.try_get::<String, _>("value").ok()))
    }

    pub async fn set_desktop_config(&self, key: &str, value: &str) -> Result<(), McpError> {
        let now = crate::modules::mcp::store::helpers::now_rfc3339()?;
        sqlx::query(
            "INSERT INTO desktop_config (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }
}

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

#[derive(Clone)]
pub struct LocalConversationChatContext {
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub messages: Vec<LocalChatInputMessage>,
}

pub struct LocalConversationRuntimeWindow {
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub messages: Vec<LocalConversationHistoryMessage>,
    pub meta: Option<serde_json::Value>,
    pub summary: Option<serde_json::Value>,
}

pub struct LocalConversationTitleContext {
    pub session_id: String,
    pub title: Option<String>,
    pub message_count: i64,
    pub first_user_message: Option<String>,
}

pub fn expand_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    }
    PathBuf::from(path)
}
