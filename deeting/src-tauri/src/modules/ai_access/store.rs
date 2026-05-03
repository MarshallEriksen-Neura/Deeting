use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::modules::ai_access::types::{
    LocalAiAccessKeyCreated, LocalAiAccessKeyRecord, VerifiedLocalAiAccessKey,
};
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

pub const AI_ACCESS_GATEWAY_ENABLED_KEY: &str = "ai_access.compat_gateway.enabled";
pub const AI_ACCESS_GATEWAY_HOST_KEY: &str = "ai_access.compat_gateway.host";
pub const AI_ACCESS_GATEWAY_PORT_KEY: &str = "ai_access.compat_gateway.port";
pub const AI_ACCESS_DEFAULT_HOST: &str = "127.0.0.1";
pub const AI_ACCESS_DEFAULT_PORT: u16 = 17321;

fn now_rfc3339() -> Result<String, McpError> {
    mcp_storage::helpers::now_rfc3339()
}

fn key_hash(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

fn parse_scopes(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

fn scopes_json(scopes: &[String]) -> String {
    serde_json::to_string(scopes).unwrap_or_else(|_| "[]".to_string())
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let max_len = left.len().max(right.len());
    let mut diff = left.len() ^ right.len();
    for index in 0..max_len {
        let l = left.get(index).copied().unwrap_or(0);
        let r = right.get(index).copied().unwrap_or(0);
        diff |= (l ^ r) as usize;
    }
    diff == 0
}

fn generate_secret() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!(
        "dtk_local_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    )
}

pub(crate) async fn init_ai_access_tables(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS local_ai_access_keys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          key_prefix TEXT NOT NULL,
          key_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          scopes_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_used_at TEXT,
          revoked_at TEXT
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_local_ai_access_keys_prefix
        ON local_ai_access_keys(key_prefix);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(())
}

impl McpStore {
    pub async fn create_local_ai_access_key(
        &self,
        name: &str,
        scopes: Vec<String>,
    ) -> Result<LocalAiAccessKeyCreated, McpError> {
        let normalized_name = name.trim();
        if normalized_name.is_empty() {
            return Err(McpError::Storage("key name is required".to_string()));
        }
        let scopes = if scopes.is_empty() {
            vec!["engine:chat".to_string()]
        } else {
            scopes
                .into_iter()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        };
        let scopes = if scopes.is_empty() {
            vec!["engine:chat".to_string()]
        } else {
            scopes
        };
        let secret = generate_secret();
        let key_prefix = secret.chars().take(18).collect::<String>();
        let id = Uuid::new_v4().to_string();
        let created_at = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO local_ai_access_keys
              (id, name, key_prefix, key_hash, status, scopes_json, created_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?);
            "#,
        )
        .bind(&id)
        .bind(normalized_name)
        .bind(&key_prefix)
        .bind(key_hash(&secret))
        .bind(scopes_json(&scopes))
        .bind(&created_at)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalAiAccessKeyCreated {
            key: LocalAiAccessKeyRecord {
                id,
                name: normalized_name.to_string(),
                key_prefix,
                status: "active".to_string(),
                scopes,
                created_at,
                last_used_at: None,
                revoked_at: None,
            },
            secret,
        })
    }

    pub async fn list_local_ai_access_keys(&self) -> Result<Vec<LocalAiAccessKeyRecord>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, key_prefix, status, scopes_json, created_at, last_used_at, revoked_at
            FROM local_ai_access_keys
            ORDER BY created_at DESC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(LocalAiAccessKeyRecord {
                    id: row.try_get("id")?,
                    name: row.try_get("name")?,
                    key_prefix: row.try_get("key_prefix")?,
                    status: row.try_get("status")?,
                    scopes: parse_scopes(row.try_get::<String, _>("scopes_json")?.as_str()),
                    created_at: row.try_get("created_at")?,
                    last_used_at: row.try_get("last_used_at")?,
                    revoked_at: row.try_get("revoked_at")?,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()
            .map_err(|err| McpError::Storage(err.to_string()))
    }

    pub async fn revoke_local_ai_access_key(&self, id: &str) -> Result<bool, McpError> {
        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE local_ai_access_keys
            SET status = 'revoked', revoked_at = ?
            WHERE id = ? AND status != 'revoked';
            "#,
        )
        .bind(now)
        .bind(id.trim())
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn verify_local_ai_access_key(
        &self,
        secret: &str,
    ) -> Result<Option<VerifiedLocalAiAccessKey>, McpError> {
        let normalized = secret.trim();
        if normalized.is_empty() {
            return Ok(None);
        }
        let prefix = normalized.chars().take(18).collect::<String>();
        let rows = sqlx::query(
            r#"
            SELECT id, key_hash, scopes_json
            FROM local_ai_access_keys
            WHERE key_prefix = ? AND status = 'active'
            "#,
        )
        .bind(prefix)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let actual = key_hash(normalized);
        for row in rows {
            let expected: String = row
                .try_get("key_hash")
                .map_err(|err| McpError::Storage(err.to_string()))?;
            if !constant_time_eq(&expected, &actual) {
                continue;
            }
            let id: String = row
                .try_get("id")
                .map_err(|err| McpError::Storage(err.to_string()))?;
            let scopes_json: String = row
                .try_get("scopes_json")
                .map_err(|err| McpError::Storage(err.to_string()))?;
            let now = now_rfc3339()?;
            sqlx::query("UPDATE local_ai_access_keys SET last_used_at = ? WHERE id = ?")
                .bind(now)
                .bind(&id)
                .execute(&self.write_pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            return Ok(Some(VerifiedLocalAiAccessKey {
                id,
                scopes: parse_scopes(&scopes_json),
            }));
        }

        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::constant_time_eq;

    #[test]
    fn constant_time_eq_checks_length_and_bytes() {
        assert!(constant_time_eq("same", "same"));
        assert!(!constant_time_eq("same", "diff"));
        assert!(!constant_time_eq("same", "same-extra"));
    }
}
