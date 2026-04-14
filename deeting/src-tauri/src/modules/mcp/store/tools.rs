use std::collections::HashMap;

use sqlx::sqlite::SqliteRow;
use sqlx::Row;
use uuid::Uuid;

use super::helpers::*;
use super::*;

impl McpStore {
    pub async fn list_tools(&self) -> Result<Vec<McpTool>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, source_id, identifier, name, service_key, service_display_name, service_description, source_type, status, ping_ms, capabilities, description,
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
            SELECT id, source_id, identifier, name, service_key, service_display_name, service_description, source_type, status, ping_ms, capabilities, description,
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

    pub async fn get_tool_by_name(&self, name: &str) -> Result<Option<McpTool>, McpError> {
        let row = sqlx::query("SELECT * FROM mcp_tools WHERE name = ? LIMIT 1")
            .bind(name)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        match row {
            Some(r) => Ok(Some(row_to_tool(&r)?)),
            None => Ok(None),
        }
    }

    pub async fn get_tool_by_source_name(
        &self,
        source_id: &str,
        name: &str,
    ) -> Result<Option<McpTool>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT id, source_id, identifier, name, service_key, service_display_name, service_description, source_type, status, ping_ms, capabilities, description,
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
            SELECT id, source_id, identifier, name, service_key, service_display_name, service_description, source_type, status, ping_ms, capabilities, description,
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
            self.sync_mcp_tool_registry_entry(&updated).await?;
            return Ok(updated);
        }

        if let Some(existing_by_name) = self
            .get_tool_by_source_name(tool.source_id.as_str(), tool.name.as_str())
            .await?
        {
            self.update_tool(&existing_by_name.id, tool.clone()).await?;
            let updated = self.get_tool(&existing_by_name.id).await?.ok_or_else(|| {
                McpError::NotFound("tool missing after name-based update".to_string())
            })?;
            self.sync_mcp_tool_registry_entry(&updated).await?;
            return Ok(updated);
        }

        self.insert_tool(tool.clone()).await?;
        let created = self
            .find_tool_id_by_source_identifier(tool.source_id.as_str(), tool.identifier.as_deref())
            .await?
            .ok_or_else(|| McpError::NotFound("tool missing after insert".to_string()))?;
        let tool = self
            .get_tool(&created)
            .await?
            .ok_or_else(|| McpError::NotFound("tool missing after insert".to_string()))?;
        self.sync_mcp_tool_registry_entry(&tool).await?;
        Ok(tool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if let Some(tool) = self.get_tool(id).await? {
            self.sync_mcp_tool_registry_entry(&tool).await?;
        }
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
              (id, source_id, identifier, name, service_key, service_display_name, service_description, source_type, status, ping_ms, capabilities, description,
               error, command, args, env, config_json, config_hash, pending_config_json,
               pending_config_hash, conflict_status, is_read_only, is_new, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&tool.source_id)
        .bind(&tool.identifier)
        .bind(&tool.name)
        .bind(&tool.service_key)
        .bind(&tool.service_display_name)
        .bind(&tool.service_description)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    async fn update_tool(&self, id: &str, tool: ToolUpsert) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE mcp_tools
            SET source_id = ?, identifier = ?, name = ?, service_key = ?, service_display_name = ?, service_description = ?, source_type = ?, status = ?, ping_ms = ?,
                capabilities = ?, description = ?, error = ?, command = ?, args = ?, env = ?,
                config_json = ?, config_hash = ?, pending_config_json = ?, pending_config_hash = ?,
                conflict_status = ?, is_read_only = ?, is_new = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&tool.source_id)
        .bind(&tool.identifier)
        .bind(&tool.name)
        .bind(&tool.service_key)
        .bind(&tool.service_display_name)
        .bind(&tool.service_description)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn delete_tools_by_source_id(&self, source_id: &str) -> Result<i64, McpError> {
        let tool_ids = self
            .list_tools()
            .await?
            .into_iter()
            .filter(|tool| tool.source_id.as_deref() == Some(source_id))
            .map(|tool| tool.id)
            .collect::<Vec<_>>();
        let result = sqlx::query("DELETE FROM mcp_tools WHERE source_id = ?;")
            .bind(source_id)
            .execute(&self.write_pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        for tool_id in tool_ids {
            let _ = self
                .delete_local_capability_registry_entries(&tool_id)
                .await?;
        }
        Ok(result.rows_affected() as i64)
    }

    pub async fn delete_tools_by_ids(&self, tool_ids: &[String]) -> Result<i64, McpError> {
        if tool_ids.is_empty() {
            return Ok(0);
        }

        let mut query_builder =
            sqlx::QueryBuilder::<sqlx::Sqlite>::new("DELETE FROM mcp_tools WHERE id IN (");
        let mut separated = query_builder.separated(", ");
        for tool_id in tool_ids {
            separated.push_bind(tool_id);
        }
        separated.push_unseparated(")");

        let result = query_builder
            .build()
            .execute(&self.write_pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        for tool_id in tool_ids {
            let _ = self
                .delete_local_capability_registry_entries(tool_id)
                .await?;
        }
        Ok(result.rows_affected() as i64)
    }
}
