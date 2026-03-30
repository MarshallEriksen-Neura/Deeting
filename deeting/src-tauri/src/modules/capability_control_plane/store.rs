use sqlx::sqlite::SqliteRow;
use sqlx::Row;

use crate::modules::mcp::commands::runtime::capability_registry_cache::invalidate_capability_registry_cache;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use mcp_registry::types::{LocalCapabilityRegistrySnapshot, LocalCapabilityRegistryUpsert};

const LOCAL_DESKTOP_USER_ID: &str = "00000000-0000-0000-0000-000000000000";
const LOCAL_CAPABILITY_REGISTRY_GENERATION_KEY: &str = "local_capability_registry_generation";

impl McpStore {
    pub async fn current_local_capability_registry_generation(&self) -> Result<i64, McpError> {
        let value = self
            .get_desktop_config(LOCAL_CAPABILITY_REGISTRY_GENERATION_KEY)
            .await?
            .unwrap_or_default();
        Ok(value.trim().parse::<i64>().unwrap_or(0))
    }

    pub async fn next_local_capability_registry_generation(&self) -> Result<i64, McpError> {
        let mut tx = self.begin_write().await?;
        let row = sqlx::query(
            r#"
            SELECT value
            FROM desktop_config
            WHERE key = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_CAPABILITY_REGISTRY_GENERATION_KEY)
        .fetch_optional(tx.as_mut())
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let current = row
            .and_then(|value| value.try_get::<String, _>("value").ok())
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        let next = current.saturating_add(1);
        let now = mcp_storage::helpers::now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO desktop_config (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at;
            "#,
        )
        .bind(LOCAL_CAPABILITY_REGISTRY_GENERATION_KEY)
        .bind(next.to_string())
        .bind(&now)
        .execute(tx.as_mut())
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit()
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(next)
    }

    pub async fn replace_local_capability_registry_entries(
        &self,
        package_id: &str,
        entries: &[LocalCapabilityRegistryUpsert],
    ) -> Result<i64, McpError> {
        let normalized_package_id = package_id.trim().to_string();
        if normalized_package_id.is_empty() {
            return Err(McpError::validation("package_id is required"));
        }

        for entry in entries {
            if entry.capability_id.trim().is_empty() {
                return Err(McpError::validation("capability_id is required"));
            }
            if entry.package_id.trim() != normalized_package_id {
                return Err(McpError::validation(
                    "all capability registry entries must share the same package_id",
                ));
            }
        }

        let mut tx = self.begin_write().await?;
        sqlx::query("DELETE FROM local_capability_registry WHERE user_id = ? AND package_id = ?;")
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_package_id)
            .execute(tx.as_mut())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        let now = mcp_storage::helpers::now_rfc3339()?;
        for entry in entries {
            sqlx::query(
                r#"
                INSERT INTO local_capability_registry (
                  user_id, capability_id, source_kind, asset_kind, package_id, package_version,
                  title, description, tool_name, callable_name, binding_kind,
                  execution_surface, runtime, entry_path, is_direct_callable,
                  activation_state, runtime_state, search_index_state, generation,
                  descriptor_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(entry.capability_id.trim())
            .bind(entry.source_kind.trim())
            .bind(entry.asset_kind.trim())
            .bind(&normalized_package_id)
            .bind(entry.package_version.as_deref())
            .bind(entry.title.trim())
            .bind(entry.description.trim())
            .bind(entry.tool_name.as_deref())
            .bind(entry.callable_name.as_deref())
            .bind(entry.binding_kind.as_deref())
            .bind(entry.execution_surface.trim())
            .bind(entry.runtime.as_deref())
            .bind(entry.entry_path.as_deref())
            .bind(if entry.is_direct_callable { 1 } else { 0 })
            .bind(entry.activation_state.trim())
            .bind(entry.runtime_state.trim())
            .bind(entry.search_index_state.trim())
            .bind(entry.generation)
            .bind(entry.descriptor_json.trim())
            .bind(&now)
            .bind(&now)
            .execute(tx.as_mut())
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        invalidate_capability_registry_cache(self, "replace_local_capability_registry_entries");
        Ok(entries.len() as i64)
    }

    pub async fn list_local_capability_registry_entries(
        &self,
    ) -> Result<Vec<LocalCapabilityRegistrySnapshot>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT capability_id, source_kind, asset_kind, package_id, package_version,
                   title, description, tool_name, callable_name, binding_kind,
                   execution_surface, runtime, entry_path, is_direct_callable,
                   activation_state, runtime_state, search_index_state, generation,
                   descriptor_json, updated_at
            FROM local_capability_registry
            WHERE user_id = ?
            ORDER BY package_id ASC, asset_kind ASC, title ASC, capability_id ASC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(local_capability_registry_from_row)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn list_local_capability_registry_entries_for_package(
        &self,
        package_id: &str,
    ) -> Result<Vec<LocalCapabilityRegistrySnapshot>, McpError> {
        let normalized_package_id = package_id.trim().to_string();
        if normalized_package_id.is_empty() {
            return Err(McpError::validation("package_id is required"));
        }

        let rows = sqlx::query(
            r#"
            SELECT capability_id, source_kind, asset_kind, package_id, package_version,
                   title, description, tool_name, callable_name, binding_kind,
                   execution_surface, runtime, entry_path, is_direct_callable,
                   activation_state, runtime_state, search_index_state, generation,
                   descriptor_json, updated_at
            FROM local_capability_registry
            WHERE user_id = ? AND package_id = ?
            ORDER BY asset_kind ASC, title ASC, capability_id ASC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_package_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(local_capability_registry_from_row)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn delete_local_capability_registry_entries(
        &self,
        package_id: &str,
    ) -> Result<i64, McpError> {
        let normalized_package_id = package_id.trim().to_string();
        if normalized_package_id.is_empty() {
            return Err(McpError::validation("package_id is required"));
        }

        let result = sqlx::query(
            "DELETE FROM local_capability_registry WHERE user_id = ? AND package_id = ?;",
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_package_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let rows_affected = result.rows_affected() as i64;
        if rows_affected > 0 {
            invalidate_capability_registry_cache(self, "delete_local_capability_registry_entries");
        }
        Ok(rows_affected)
    }

    pub async fn update_local_capability_registry_states(
        &self,
        package_id: &str,
        activation_state: Option<&str>,
        runtime_state: Option<&str>,
        search_index_state: Option<&str>,
    ) -> Result<i64, McpError> {
        let normalized_package_id = package_id.trim().to_string();
        if normalized_package_id.is_empty() {
            return Err(McpError::validation("package_id is required"));
        }
        if activation_state.is_none() && runtime_state.is_none() && search_index_state.is_none() {
            return Ok(0);
        }

        let now = mcp_storage::helpers::now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE local_capability_registry
            SET activation_state = COALESCE(?, activation_state),
                runtime_state = COALESCE(?, runtime_state),
                search_index_state = COALESCE(?, search_index_state),
                updated_at = ?
            WHERE user_id = ? AND package_id = ?;
            "#,
        )
        .bind(
            activation_state
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            runtime_state
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            search_index_state
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(&now)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_package_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let rows_affected = result.rows_affected() as i64;
        if rows_affected > 0 {
            invalidate_capability_registry_cache(self, "update_local_capability_registry_states");
        }
        Ok(rows_affected)
    }
}

fn local_capability_registry_from_row(
    row: SqliteRow,
) -> Result<LocalCapabilityRegistrySnapshot, McpError> {
    let descriptor_raw = row.try_get::<String, _>("descriptor_json")?;
    let descriptor_json = serde_json::from_str::<serde_json::Value>(&descriptor_raw)
        .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(LocalCapabilityRegistrySnapshot {
        capability_id: row.try_get::<String, _>("capability_id")?,
        source_kind: row.try_get::<String, _>("source_kind")?,
        asset_kind: row.try_get::<String, _>("asset_kind")?,
        package_id: row.try_get::<String, _>("package_id")?,
        package_version: row.try_get::<Option<String>, _>("package_version")?,
        title: row.try_get::<String, _>("title")?,
        description: row.try_get::<String, _>("description")?,
        tool_name: row.try_get::<Option<String>, _>("tool_name")?,
        callable_name: row.try_get::<Option<String>, _>("callable_name")?,
        binding_kind: row.try_get::<Option<String>, _>("binding_kind")?,
        execution_surface: row.try_get::<String, _>("execution_surface")?,
        runtime: row.try_get::<Option<String>, _>("runtime")?,
        entry_path: row.try_get::<Option<String>, _>("entry_path")?,
        is_direct_callable: row.try_get::<i64, _>("is_direct_callable")? != 0,
        activation_state: row.try_get::<String, _>("activation_state")?,
        runtime_state: row.try_get::<String, _>("runtime_state")?,
        search_index_state: row.try_get::<String, _>("search_index_state")?,
        generation: row.try_get::<i64, _>("generation")?,
        descriptor_json,
        updated_at: row.try_get::<String, _>("updated_at")?,
    })
}
