use uuid::Uuid;

use super::helpers::*;
use super::*;

fn is_skill_source_name(name: &str) -> bool {
    name.trim_start().starts_with("skill:")
}

fn is_internal_skill_source(source: &McpSource) -> bool {
    matches!(source.source_type, McpSourceType::Skill) || is_skill_source_name(&source.name)
}

impl McpStore {
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_source(&id)
            .await?
            .ok_or_else(|| McpError::NotFound("local source missing after insert".to_string()))
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .rows_affected();

        Ok(deleted_tools + deleted_sources)
    }

    pub fn is_internal_skill_source(&self, source: &McpSource) -> bool {
        is_internal_skill_source(source)
    }

    pub async fn delete_source(&self, id: &str) -> Result<(), McpError> {
        sqlx::query("DELETE FROM mcp_sources WHERE id = ?;")
            .bind(id)
            .execute(&self.write_pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }
}
