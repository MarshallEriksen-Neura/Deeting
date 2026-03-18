use sqlx::Row;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

impl McpStore {
    pub async fn get_desktop_config(&self, key: &str) -> Result<Option<String>, McpError> {
        let row = sqlx::query("SELECT value FROM desktop_config WHERE key = ? LIMIT 1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(row.and_then(|r| r.try_get::<String, _>("value").ok()))
    }

    pub async fn set_desktop_config(&self, key: &str, value: &str) -> Result<(), McpError> {
        let now = mcp_storage::helpers::now_rfc3339()?;
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
