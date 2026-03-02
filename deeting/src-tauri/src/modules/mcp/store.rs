use std::collections::HashMap;
use std::path::PathBuf;

use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;
use uuid::Uuid;

use crate::mcp::error::McpError;
use crate::mcp::types::{
    CreateAssistantMessageRequest, CreateLocalAssistantRequest, LocalAssistant, LocalAssistantMessage,
    McpConflictStatus, McpSource, McpSourceStatus, McpSourceType, McpTool, McpToolConfigPayload,
    McpToolStatus, McpTrustLevel, UpdateLocalAssistantRequest,
};

const DEFAULT_LOCAL_SOURCE_PATH: &str = "~/.config/deeting/mcp.json";
const DEFAULT_CLOUD_SOURCE_NAME: &str = "Deeting Cloud";

pub struct McpStore {
    pool: SqlitePool,
}

impl McpStore {
    pub async fn new(database_url: &str) -> Result<Self, McpError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(database_url)
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
            CREATE INDEX IF NOT EXISTS idx_assistant_messages_assistant_id_created_at
            ON assistant_messages(assistant_id, created_at);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

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

        Ok(row.and_then(|row| row.try_get::<String, _>("pending_config_json").ok()))
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

    pub async fn has_name_conflict(
        &self,
        name: &str,
        source_id: &str,
    ) -> Result<bool, McpError> {
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
        map.insert("name".to_string(), serde_json::Value::String(name.to_string()));
        if let Some(command) = &payload.command {
            map.insert("command".to_string(), serde_json::Value::String(command.clone()));
        }
        if let Some(args) = &payload.args {
            map.insert(
                "args".to_string(),
                serde_json::Value::Array(
                    args.iter().cloned().map(serde_json::Value::String).collect(),
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

        Ok(row.and_then(|row| row.try_get::<String, _>("id").ok()))
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

    pub async fn get_local_assistant(
        &self,
        id: &str,
    ) -> Result<Option<LocalAssistant>, McpError> {
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
        let visibility = payload
            .visibility
            .unwrap_or_else(|| "private".to_string());
        let source = payload.source.unwrap_or_else(|| "local".to_string());
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
        .bind(payload.description)
        .bind(payload.avatar)
        .bind(&system_prompt)
        .bind(model_config_json)
        .bind(tags_json)
        .bind(visibility)
        .bind(source)
        .bind(payload.cloud_id)
        .bind(0)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

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
        .bind(name)
        .bind(description)
        .bind(avatar)
        .bind(system_prompt)
        .bind(model_config_json)
        .bind(tags_json)
        .bind(visibility)
        .bind(source)
        .bind(cloud_id)
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

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

    async fn ensure_column(&self, table: &str, column: &str, ddl: &str) -> Result<(), McpError> {
        let sql = format!("PRAGMA table_info({})", table);
        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let exists = rows.iter().any(|row| {
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

fn now_rfc3339() -> Result<String, McpError> {
    Ok(time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| McpError::Storage(err.to_string()))?)
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
