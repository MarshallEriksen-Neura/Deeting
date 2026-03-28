use sqlx::sqlite::{SqlitePool, SqliteRow};
use sqlx::Row;

use crate::modules::providers::store::secret_store::SecretStore;
use crate::utils::now_rfc3339;

use super::types::{StoredWechatAccount, WECHAT_DEFAULT_ACCOUNT_KEY};

pub struct WechatAccountStore {
    pool: SqlitePool,
    secret_store: SecretStore,
}

impl WechatAccountStore {
    pub fn new(pool: SqlitePool, database_url: &str) -> Result<Self, String> {
        let secret_store = SecretStore::new(database_url).map_err(|err| err.to_string())?;
        Ok(Self { pool, secret_store })
    }

    pub async fn init(&self) -> Result<(), String> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS local_wechat_accounts (
                account_key TEXT PRIMARY KEY,
                account_label TEXT NOT NULL DEFAULT '',
                connected_at TEXT,
                secret_ciphertext TEXT NOT NULL DEFAULT '',
                secret_key_version INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS local_wechat_allowlist (
                contact_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS local_wechat_pending_pairings (
                pairing_code TEXT PRIMARY KEY,
                contact_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub async fn save_account(&self, account: &StoredWechatAccount) -> Result<String, String> {
        let now = now_rfc3339();
        let serialized = serde_json::to_string(account).map_err(|err| err.to_string())?;
        let label = account
            .user_id
            .as_deref()
            .or(account.account_id.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("wechat-account")
            .to_string();
        let (ciphertext, key_version) = self
            .secret_store
            .encrypt_for_db(WECHAT_DEFAULT_ACCOUNT_KEY, serialized.as_str())
            .map_err(|err| err.to_string())?;

        sqlx::query(
            "INSERT INTO local_wechat_accounts (
                account_key, account_label, connected_at, secret_ciphertext, secret_key_version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_key) DO UPDATE SET
                account_label = excluded.account_label,
                connected_at = excluded.connected_at,
                secret_ciphertext = excluded.secret_ciphertext,
                secret_key_version = excluded.secret_key_version,
                updated_at = excluded.updated_at",
        )
        .bind(WECHAT_DEFAULT_ACCOUNT_KEY)
        .bind(label.as_str())
        .bind(account.saved_at.as_str())
        .bind(ciphertext)
        .bind(key_version)
        .bind(now.as_str())
        .bind(now.as_str())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        Ok(label)
    }

    pub async fn load_account(
        &self,
    ) -> Result<Option<(String, String, StoredWechatAccount)>, String> {
        let row = sqlx::query(
            "SELECT account_label, connected_at, secret_ciphertext, secret_key_version
             FROM local_wechat_accounts
             WHERE account_key = ?",
        )
        .bind(WECHAT_DEFAULT_ACCOUNT_KEY)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        let Some(row) = row else {
            return Ok(None);
        };
        row_to_account(&self.secret_store, &row).map(Some)
    }

    pub async fn update_cursor(&self, cursor: &str) -> Result<(), String> {
        let Some((_, _, mut account)) = self.load_account().await? else {
            return Ok(());
        };
        account.cursor = cursor.trim().to_string();
        self.save_account(&account).await?;
        Ok(())
    }

    pub async fn update_context_token(
        &self,
        contact_id: &str,
        context_token: &str,
    ) -> Result<(), String> {
        let contact_id = contact_id.trim();
        let context_token = context_token.trim();
        if contact_id.is_empty() || context_token.is_empty() {
            return Ok(());
        }

        let Some((_, _, mut account)) = self.load_account().await? else {
            return Ok(());
        };
        account
            .context_tokens_by_contact
            .insert(contact_id.to_string(), context_token.to_string());
        self.save_account(&account).await?;
        Ok(())
    }

    pub async fn context_token_for_contact(
        &self,
        contact_id: &str,
    ) -> Result<Option<String>, String> {
        let Some((_, _, account)) = self.load_account().await? else {
            return Ok(None);
        };
        Ok(account
            .context_tokens_by_contact
            .get(contact_id.trim())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()))
    }

    pub async fn list_context_contacts(&self) -> Result<Vec<String>, String> {
        let Some((_, _, account)) = self.load_account().await? else {
            return Ok(Vec::new());
        };
        let mut contacts = account
            .context_tokens_by_contact
            .keys()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        contacts.sort();
        contacts.dedup();
        Ok(contacts)
    }

    pub async fn clear_account(&self) -> Result<(), String> {
        sqlx::query("DELETE FROM local_wechat_accounts WHERE account_key = ?")
            .bind(WECHAT_DEFAULT_ACCOUNT_KEY)
            .execute(&self.pool)
            .await
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn add_allowed_contact(&self, contact_id: &str) -> Result<(), String> {
        let contact_id = contact_id.trim();
        if contact_id.is_empty() {
            return Ok(());
        }
        sqlx::query(
            "INSERT INTO local_wechat_allowlist (contact_id, created_at)
             VALUES (?, ?)
             ON CONFLICT(contact_id) DO NOTHING",
        )
        .bind(contact_id)
        .bind(now_rfc3339())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn is_allowed_contact(&self, contact_id: &str) -> Result<bool, String> {
        let row = sqlx::query("SELECT 1 FROM local_wechat_allowlist WHERE contact_id = ? LIMIT 1")
            .bind(contact_id.trim())
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| err.to_string())?;
        Ok(row.is_some())
    }

    pub async fn count_allowlist(&self) -> Result<i64, String> {
        let row = sqlx::query("SELECT COUNT(*) AS total FROM local_wechat_allowlist")
            .fetch_one(&self.pool)
            .await
            .map_err(|err| err.to_string())?;
        row.try_get::<i64, _>("total")
            .map_err(|err| err.to_string())
    }

    pub async fn list_allowlist_contacts(&self) -> Result<Vec<String>, String> {
        let rows =
            sqlx::query("SELECT contact_id FROM local_wechat_allowlist ORDER BY contact_id ASC")
                .fetch_all(&self.pool)
                .await
                .map_err(|err| err.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            let contact_id: String = row.try_get("contact_id").map_err(|err| err.to_string())?;
            let normalized = contact_id.trim().to_string();
            if !normalized.is_empty() {
                result.push(normalized);
            }
        }
        Ok(result)
    }

    pub async fn create_or_reuse_pending_pairing(
        &self,
        contact_id: &str,
    ) -> Result<String, String> {
        self.cleanup_expired_pending_pairings().await?;
        let contact_id = contact_id.trim();
        if contact_id.is_empty() {
            return Err("wechat contact id is required".to_string());
        }

        let existing = sqlx::query(
            "SELECT pairing_code FROM local_wechat_pending_pairings
             WHERE contact_id = ?
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .bind(contact_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        if let Some(row) = existing {
            let code: String = row.try_get("pairing_code").map_err(|err| err.to_string())?;
            return Ok(code);
        }

        let code = format!("{:06}", rand::random::<u32>() % 1_000_000);
        let created_at = now_rfc3339();
        let expires_at = (time::OffsetDateTime::now_utc() + time::Duration::minutes(10))
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|err| err.to_string())?;
        sqlx::query(
            "INSERT INTO local_wechat_pending_pairings (pairing_code, contact_id, created_at, expires_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind(code.as_str())
        .bind(contact_id)
        .bind(created_at.as_str())
        .bind(expires_at.as_str())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(code)
    }

    pub async fn approve_pairing_code(&self, pairing_code: &str) -> Result<Option<String>, String> {
        self.cleanup_expired_pending_pairings().await?;
        let row = sqlx::query(
            "SELECT contact_id FROM local_wechat_pending_pairings WHERE pairing_code = ?",
        )
        .bind(pairing_code.trim())
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        let Some(row) = row else {
            return Ok(None);
        };
        let contact_id: String = row.try_get("contact_id").map_err(|err| err.to_string())?;
        self.add_allowed_contact(contact_id.as_str()).await?;
        self.delete_pending_pairing(pairing_code).await?;
        Ok(Some(contact_id))
    }

    pub async fn reject_pairing_code(&self, pairing_code: &str) -> Result<(), String> {
        self.delete_pending_pairing(pairing_code).await
    }

    pub async fn count_pending_pairings(&self) -> Result<i64, String> {
        self.cleanup_expired_pending_pairings().await?;
        let row = sqlx::query("SELECT COUNT(*) AS total FROM local_wechat_pending_pairings")
            .fetch_one(&self.pool)
            .await
            .map_err(|err| err.to_string())?;
        row.try_get::<i64, _>("total")
            .map_err(|err| err.to_string())
    }

    async fn delete_pending_pairing(&self, pairing_code: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM local_wechat_pending_pairings WHERE pairing_code = ?")
            .bind(pairing_code.trim())
            .execute(&self.pool)
            .await
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    async fn cleanup_expired_pending_pairings(&self) -> Result<(), String> {
        sqlx::query(
            "DELETE FROM local_wechat_pending_pairings
             WHERE datetime(expires_at) <= datetime('now')",
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }
}

fn row_to_account(
    secret_store: &SecretStore,
    row: &SqliteRow,
) -> Result<(String, String, StoredWechatAccount), String> {
    let account_label: String = row
        .try_get("account_label")
        .map_err(|err| err.to_string())?;
    let connected_at: String = row
        .try_get::<String, _>("connected_at")
        .unwrap_or_else(|_| String::new());
    let ciphertext: String = row
        .try_get("secret_ciphertext")
        .map_err(|err| err.to_string())?;
    let key_version: i64 = row
        .try_get("secret_key_version")
        .map_err(|err| err.to_string())?;
    let decrypted = secret_store
        .decrypt_from_db(WECHAT_DEFAULT_ACCOUNT_KEY, ciphertext.as_str(), key_version)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "wechat account secret is unavailable".to_string())?;
    let account = serde_json::from_str::<StoredWechatAccount>(decrypted.as_str())
        .map_err(|err| err.to_string())?;
    Ok((account_label, connected_at, account))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn account_store_round_trips_encrypted_account() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory sqlite");
        let store = WechatAccountStore::new(pool, "sqlite::memory:").expect("store");
        store.init().await.expect("init");

        store
            .save_account(&StoredWechatAccount {
                token: "token-1".to_string(),
                base_url: "https://ilinkai.weixin.qq.com".to_string(),
                user_id: Some("wx-user-1".to_string()),
                account_id: Some("bot-1".to_string()),
                cursor: "cursor-1".to_string(),
                saved_at: "2026-03-26T00:00:00Z".to_string(),
                context_tokens_by_contact: std::collections::HashMap::new(),
            })
            .await
            .expect("save");

        let loaded = store.load_account().await.expect("load").expect("account");
        assert_eq!(loaded.0, "wx-user-1");
        assert_eq!(loaded.2.token, "token-1");
        assert_eq!(loaded.2.cursor, "cursor-1");

        store.clear_account().await.expect("clear");
        assert!(store.load_account().await.expect("reload").is_none());
    }

    #[tokio::test]
    async fn account_store_persists_context_tokens_by_contact() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory sqlite");
        let store = WechatAccountStore::new(pool, "sqlite::memory:").expect("store");
        store.init().await.expect("init");

        store
            .save_account(&StoredWechatAccount {
                token: "token-1".to_string(),
                base_url: "https://ilinkai.weixin.qq.com".to_string(),
                user_id: Some("wx-user-1".to_string()),
                account_id: Some("bot-1".to_string()),
                cursor: "cursor-1".to_string(),
                saved_at: "2026-03-26T00:00:00Z".to_string(),
                context_tokens_by_contact: std::collections::HashMap::new(),
            })
            .await
            .expect("save");

        store
            .update_context_token("contact-1", "ctx-1")
            .await
            .expect("update context");

        let token = store
            .context_token_for_contact("contact-1")
            .await
            .expect("load context");
        assert_eq!(token.as_deref(), Some("ctx-1"));

        let contacts = store
            .list_context_contacts()
            .await
            .expect("context contacts");
        assert_eq!(contacts, vec!["contact-1".to_string()]);
    }

    #[tokio::test]
    async fn account_store_lists_allowlist_contacts() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory sqlite");
        let store = WechatAccountStore::new(pool, "sqlite::memory:").expect("store");
        store.init().await.expect("init");

        store
            .add_allowed_contact("contact-b")
            .await
            .expect("contact b");
        store
            .add_allowed_contact("contact-a")
            .await
            .expect("contact a");

        let contacts = store
            .list_allowlist_contacts()
            .await
            .expect("allowlist contacts");
        assert_eq!(
            contacts,
            vec!["contact-a".to_string(), "contact-b".to_string()]
        );
    }
}
