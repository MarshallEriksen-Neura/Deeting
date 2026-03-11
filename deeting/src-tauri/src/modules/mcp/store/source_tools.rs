use super::helpers::*;
use super::*;

fn is_skill_source_name(name: &str) -> bool {
    name.trim_start().starts_with("skill:")
}

fn is_internal_skill_source(source: &McpSource) -> bool {
    matches!(source.source_type, McpSourceType::Skill) || is_skill_source_name(&source.name)
}

impl McpStore {
    pub async fn upsert_local_skill_install(
        &self,
        skill_id: &str,
        installed_version: Option<&str>,
        runtime: Option<&str>,
        manifest_json: &str,
        install_path: &str,
    ) -> Result<(), McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }
        let normalized_manifest = manifest_json.trim().to_string();
        if normalized_manifest.is_empty() {
            return Err(McpError::validation("manifest_json is required"));
        }
        let normalized_path = install_path.trim().to_string();
        if normalized_path.is_empty() {
            return Err(McpError::validation("install_path is required"));
        }

        let normalized_version = installed_version
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .unwrap_or_else(|| "0.0.0".to_string());
        let normalized_runtime = runtime
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty());
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO local_skill_install (
              user_id, skill_id, installed_version, is_enabled, runtime,
              manifest_json, install_path, user_settings_json, installed_at, updated_at
            )
            VALUES (?, ?, ?, 1, ?, ?, ?, NULL, ?, ?)
            ON CONFLICT(user_id, skill_id) DO UPDATE SET
              installed_version = excluded.installed_version,
              runtime = excluded.runtime,
              manifest_json = excluded.manifest_json,
              install_path = excluded.install_path,
              updated_at = excluded.updated_at;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .bind(&normalized_version)
        .bind(normalized_runtime.as_deref())
        .bind(&normalized_manifest)
        .bind(&normalized_path)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn list_enabled_local_skill_ids(&self) -> Result<HashSet<String>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT skill_id
            FROM local_skill_install
            WHERE user_id = ? AND is_enabled = 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut ids = HashSet::with_capacity(rows.len());
        for row in rows {
            let skill_id = row.try_get::<String, _>("skill_id")?;
            let normalized = skill_id.trim().to_string();
            if !normalized.is_empty() {
                ids.insert(normalized);
            }
        }
        Ok(ids)
    }

    pub async fn list_local_skill_installs(
        &self,
    ) -> Result<Vec<LocalSkillInstallSnapshot>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT skill_id, installed_version, is_enabled, runtime, install_path
            FROM local_skill_install
            WHERE user_id = ?
            ORDER BY updated_at DESC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut installs = Vec::with_capacity(rows.len());
        for row in rows {
            let skill_id = row.try_get::<String, _>("skill_id")?.trim().to_string();
            let install_path = row.try_get::<String, _>("install_path")?.trim().to_string();
            if skill_id.is_empty() || install_path.is_empty() {
                continue;
            }
            installs.push(LocalSkillInstallSnapshot {
                skill_id,
                installed_version: row.try_get::<Option<String>, _>("installed_version")?,
                is_enabled: row.try_get::<i64, _>("is_enabled")? != 0,
                runtime: row.try_get::<Option<String>, _>("runtime")?,
                install_path,
            });
        }

        Ok(installs)
    }

    pub async fn get_enabled_local_skill_manifest_json(
        &self,
        skill_id: &str,
    ) -> Result<Option<String>, McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT manifest_json
            FROM local_skill_install
            WHERE user_id = ? AND skill_id = ? AND is_enabled = 1
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(row.and_then(|row| row.try_get::<String, _>("manifest_json").ok()))
    }

    pub async fn get_local_skill_install_path(
        &self,
        skill_id: &str,
    ) -> Result<Option<String>, McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT install_path
            FROM local_skill_install
            WHERE user_id = ? AND skill_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(row.and_then(|row| row.try_get::<String, _>("install_path").ok()))
    }

    pub async fn upsert_local_skill_install_state(
        &self,
        skill_id: &str,
        installed_version: Option<&str>,
        is_enabled: bool,
        runtime: Option<&str>,
        manifest_json: &str,
        install_path: &str,
        user_settings_json: Option<&serde_json::Value>,
    ) -> Result<(), McpError> {
        let normalized_skill_id = skill_id.trim().to_string();
        if normalized_skill_id.is_empty() {
            return Err(McpError::validation("skill_id is required"));
        }
        let normalized_manifest = manifest_json.trim().to_string();
        if normalized_manifest.is_empty() {
            return Err(McpError::validation("manifest_json is required"));
        }
        let normalized_path = install_path.trim().to_string();
        if normalized_path.is_empty() {
            return Err(McpError::validation("install_path is required"));
        }

        let normalized_version = installed_version
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .unwrap_or_else(|| "0.0.0".to_string());
        let normalized_runtime = runtime
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty());
        let normalized_settings = match user_settings_json {
            Some(value) => Some(
                serde_json::to_string(value).map_err(|err| McpError::Storage(err.to_string()))?,
            ),
            None => None,
        };
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO local_skill_install (
              user_id, skill_id, installed_version, is_enabled, runtime,
              manifest_json, install_path, user_settings_json, installed_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, skill_id) DO UPDATE SET
              installed_version = excluded.installed_version,
              is_enabled = excluded.is_enabled,
              runtime = excluded.runtime,
              manifest_json = excluded.manifest_json,
              install_path = excluded.install_path,
              user_settings_json = excluded.user_settings_json,
              updated_at = excluded.updated_at;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_skill_id)
        .bind(&normalized_version)
        .bind(if is_enabled { 1 } else { 0 })
        .bind(normalized_runtime.as_deref())
        .bind(&normalized_manifest)
        .bind(&normalized_path)
        .bind(normalized_settings.as_deref())
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn disable_missing_cloud_managed_local_skills(
        &self,
        installed_skill_ids: &[String],
    ) -> Result<i64, McpError> {
        let now = now_rfc3339()?;
        let cloud_marker = "%\"sync_source\":\"cloud_plugin_market\"%";

        let normalized_skill_ids: Vec<String> = installed_skill_ids
            .iter()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .collect();

        let mut sql = String::from(
            r#"
            UPDATE local_skill_install
            SET is_enabled = 0, updated_at = ?
            WHERE user_id = ?
              AND is_enabled = 1
              AND user_settings_json LIKE ?
            "#,
        );

        if !normalized_skill_ids.is_empty() {
            sql.push_str(" AND skill_id NOT IN (");
            for index in 0..normalized_skill_ids.len() {
                if index > 0 {
                    sql.push_str(", ");
                }
                sql.push('?');
            }
            sql.push(')');
        }

        let mut query = sqlx::query(&sql)
            .bind(&now)
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(cloud_marker);

        for skill_id in normalized_skill_ids {
            query = query.bind(skill_id);
        }

        let result = query
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected() as i64)
    }

    pub async fn disable_local_skills_by_ids(&self, skill_ids: &[String]) -> Result<i64, McpError> {
        let normalized_skill_ids: Vec<String> = skill_ids
            .iter()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .collect();
        if normalized_skill_ids.is_empty() {
            return Ok(0);
        }

        let now = now_rfc3339()?;
        let placeholders = vec!["?"; normalized_skill_ids.len()].join(", ");
        let sql = format!(
            "UPDATE local_skill_install\n             SET is_enabled = 0, updated_at = ?\n             WHERE user_id = ?\n               AND is_enabled = 1\n               AND skill_id IN ({placeholders});"
        );
        let mut query = sqlx::query(&sql).bind(&now).bind(LOCAL_DESKTOP_USER_ID);
        for skill_id in normalized_skill_ids {
            query = query.bind(skill_id);
        }
        let result = query
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected() as i64)
    }

    pub async fn enable_local_skills_by_ids(&self, skill_ids: &[String]) -> Result<i64, McpError> {
        let normalized_skill_ids: Vec<String> = skill_ids
            .iter()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .collect();
        if normalized_skill_ids.is_empty() {
            return Ok(0);
        }

        let now = now_rfc3339()?;
        let placeholders = vec!["?"; normalized_skill_ids.len()].join(", ");
        let sql = format!(
            "UPDATE local_skill_install\n             SET is_enabled = 1, updated_at = ?\n             WHERE user_id = ?\n               AND skill_id IN ({placeholders});"
        );
        let mut query = sqlx::query(&sql).bind(&now).bind(LOCAL_DESKTOP_USER_ID);
        for skill_id in normalized_skill_ids {
            query = query.bind(skill_id);
        }
        let result = query
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected() as i64)
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
            WHERE source_type != 'skill' AND name NOT LIKE 'skill:%'
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
            WHERE source_type = ?
              AND name NOT LIKE 'skill:%'
            LIMIT 1;
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

    // --- Pillar 3: Skill lifecycle methods ---

    pub async fn find_source_by_name(&self, name: &str) -> Result<Option<McpSource>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT id, name, source_type, path_or_url, trust_level, status,
                   last_synced_at, is_read_only, created_at, updated_at
            FROM mcp_sources
            WHERE name = ?
            LIMIT 1;
            "#,
        )
        .bind(name)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| row_to_source(&row)).transpose()
    }

    pub async fn purge_legacy_skill_mcp_rows(&self) -> Result<u64, McpError> {
        let deleted_tools = sqlx::query(
            r#"
            DELETE FROM mcp_tools
            WHERE identifier LIKE 'skill.%'
               OR source_id IN (
                    SELECT id
                    FROM mcp_sources
                    WHERE source_type = ? OR name LIKE 'skill:%'
               );
            "#,
        )
        .bind(McpSourceType::Skill.as_str())
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .rows_affected();

        let deleted_sources = sqlx::query(
            r#"
            DELETE FROM mcp_sources
            WHERE source_type = ? OR name LIKE 'skill:%';
            "#,
        )
        .bind(McpSourceType::Skill.as_str())
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .rows_affected();

        Ok(deleted_tools + deleted_sources)
    }

    pub fn is_internal_skill_source(&self, source: &McpSource) -> bool {
        is_internal_skill_source(source)
    }

    pub async fn delete_tools_by_source_id(&self, source_id: &str) -> Result<i64, McpError> {
        let result = sqlx::query("DELETE FROM mcp_tools WHERE source_id = ?;")
            .bind(source_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
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
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected() as i64)
    }

    pub async fn delete_source(&self, id: &str) -> Result<(), McpError> {
        sqlx::query("DELETE FROM mcp_sources WHERE id = ?;")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn delete_local_skill_install(&self, skill_id: &str) -> Result<(), McpError> {
        sqlx::query("DELETE FROM local_skill_install WHERE user_id = ? AND skill_id = ?;")
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(skill_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }
}
