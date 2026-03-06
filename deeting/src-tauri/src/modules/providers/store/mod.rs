pub mod bandit;
pub mod instances;
pub mod models;
pub mod presets;
pub mod secret_store;
pub mod secretary;
pub mod utils;
#[cfg(test)]
mod tests;

use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::secret_store::SecretStore;
use crate::modules::providers::store::utils::{normalize_secret, now_rfc3339};
use log::warn;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;
use std::str::FromStr;

#[derive(Debug, Clone)]
pub struct ProviderConnection {
    pub base_url: String,
    pub secret_key: Option<String>,
    pub protocol: Option<String>,
    pub auto_append_v1: Option<bool>,
    /// When Some("platform"), caller should use cloud credits proxy instead of direct upstream.
    pub credential_source: Option<String>,
}

pub struct ProviderStore {
    pub pool: SqlitePool,
    secret_store: SecretStore,
}

pub const PROVIDER_KEYCHAIN_SERVICE: &str = "deeting.provider";
pub const LOCAL_DESKTOP_USER_ID: &str = "00000000-0000-0000-0000-000000000000";
pub const BANDIT_DEFAULT_SCENE: &str = "router:llm";
pub const BANDIT_DEFAULT_STRATEGY: &str = "epsilon_greedy";
pub const CHAT_CAPABILITY: &str = "chat";
pub const IMAGE_GENERATION_CAPABILITY: &str = "image_generation";
pub const TEXT_TO_SPEECH_CAPABILITY: &str = "text_to_speech";
pub const SPEECH_TO_TEXT_CAPABILITY: &str = "speech_to_text";
pub const VIDEO_GENERATION_CAPABILITY: &str = "video_generation";
pub const EMBEDDING_CAPABILITY: &str = "embedding";
pub const CHAT_UPSTREAM_PATH: &str = "v1/chat/completions";
pub const IMAGE_GENERATION_UPSTREAM_PATH: &str = "v1/images/generations";
pub const TEXT_TO_SPEECH_UPSTREAM_PATH: &str = "v1/audio/speech";
pub const SPEECH_TO_TEXT_UPSTREAM_PATH: &str = "v1/audio/transcriptions";
pub const VIDEO_GENERATION_UPSTREAM_PATH: &str = "v1/video/generations";
pub const EMBEDDING_UPSTREAM_PATH: &str = "v1/embeddings";

impl ProviderStore {
    pub async fn new(database_url: &str) -> Result<Self, ProviderError> {
        let options = SqliteConnectOptions::from_str(database_url)
            .map_err(|err| ProviderError::Database(err.to_string()))?
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new().connect_with(options).await?;
        let secret_store = SecretStore::new(database_url)?;
        Ok(Self { pool, secret_store })
    }

    pub async fn init(&self) -> Result<(), ProviderError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS provider_presets (
                slug TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                base_url TEXT NOT NULL,
                icon TEXT,
                theme_color TEXT,
                category TEXT,
                url_template TEXT,
                template_engine TEXT,
                response_transform TEXT,
                auth_type TEXT NOT NULL DEFAULT 'api_key',
                auth_config TEXT NOT NULL DEFAULT '{}',
                default_headers TEXT NOT NULL DEFAULT '{}',
                default_params TEXT NOT NULL DEFAULT '{}',
                capability_configs TEXT NOT NULL DEFAULT '{}',
                version INTEGER NOT NULL DEFAULT 1,
                is_active BOOLEAN DEFAULT 1
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS provider_instances (
                id TEXT PRIMARY KEY,
                preset_slug TEXT NOT NULL,
                name TEXT NOT NULL,
                base_url TEXT NOT NULL,
                description TEXT,
                icon TEXT,
                priority INTEGER NOT NULL DEFAULT 0,
                meta TEXT NOT NULL DEFAULT '{}',
                is_enabled BOOLEAN NOT NULL DEFAULT 1,
                is_local BOOLEAN DEFAULT 0,
                credentials_ref TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        self.ensure_column(
            "provider_presets",
            "template_engine",
            "ALTER TABLE provider_presets ADD COLUMN template_engine TEXT",
        )
        .await?;
        self.ensure_column(
            "provider_presets",
            "response_transform",
            "ALTER TABLE provider_presets ADD COLUMN response_transform TEXT",
        )
        .await?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS provider_credentials (
                id TEXT PRIMARY KEY,
                instance_id TEXT NOT NULL REFERENCES provider_instances(id) ON DELETE CASCADE,
                alias TEXT NOT NULL,
                secret_key TEXT NOT NULL,
                secret_ciphertext TEXT NOT NULL DEFAULT '',
                secret_key_version INTEGER NOT NULL DEFAULT 0,
                weight INTEGER NOT NULL DEFAULT 0,
                priority INTEGER NOT NULL DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS provider_models (
                id TEXT PRIMARY KEY,
                instance_id TEXT NOT NULL REFERENCES provider_instances(id) ON DELETE CASCADE,
                capabilities TEXT NOT NULL DEFAULT '[]',
                model_id TEXT NOT NULL,
                unified_model_id TEXT,
                display_name TEXT,
                upstream_path TEXT NOT NULL DEFAULT 'v1/chat/completions',
                pricing_config TEXT NOT NULL DEFAULT '{}',
                limit_config TEXT NOT NULL DEFAULT '{}',
                tokenizer_config TEXT NOT NULL DEFAULT '{}',
                routing_config TEXT NOT NULL DEFAULT '{}',
                config_override TEXT NOT NULL DEFAULT '{}',
                source TEXT NOT NULL DEFAULT 'auto',
                extra_meta TEXT NOT NULL DEFAULT '{}',
                weight INTEGER NOT NULL DEFAULT 100,
                priority INTEGER NOT NULL DEFAULT 0,
                is_active BOOLEAN DEFAULT 1,
                synced_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS bandit_arm_state (
                id TEXT PRIMARY KEY,
                provider_model_id TEXT REFERENCES provider_models(id) ON DELETE CASCADE,
                scene TEXT NOT NULL DEFAULT 'router:llm',
                arm_id TEXT,
                reward_metric_type TEXT,
                strategy TEXT NOT NULL DEFAULT 'epsilon_greedy',
                epsilon REAL NOT NULL DEFAULT 0.1,
                alpha REAL NOT NULL DEFAULT 1.0,
                beta REAL NOT NULL DEFAULT 1.0,
                total_trials INTEGER NOT NULL DEFAULT 0,
                successes INTEGER NOT NULL DEFAULT 0,
                failures INTEGER NOT NULL DEFAULT 0,
                total_latency_ms INTEGER NOT NULL DEFAULT 0,
                latency_p95_ms REAL,
                total_cost REAL NOT NULL DEFAULT 0,
                last_reward REAL NOT NULL DEFAULT 0,
                cooldown_until TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS user_secretary (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                model_name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS user_embedding_config (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL UNIQUE,
                provider_model_id TEXT REFERENCES provider_models(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        self.ensure_column(
            "provider_instances",
            "is_enabled",
            "ALTER TABLE provider_instances ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT 1",
        )
        .await?;
        self.ensure_column(
            "provider_instances",
            "credential_source",
            "ALTER TABLE provider_instances ADD COLUMN credential_source TEXT NOT NULL DEFAULT 'local'",
        )
        .await?;
        self.ensure_column(
            "provider_instances",
            "updated_at",
            "ALTER TABLE provider_instances ADD COLUMN updated_at TEXT",
        )
        .await?;
        self.ensure_column(
            "provider_presets",
            "theme_color",
            "ALTER TABLE provider_presets ADD COLUMN theme_color TEXT",
        )
        .await?;
        self.ensure_column(
            "provider_presets",
            "category",
            "ALTER TABLE provider_presets ADD COLUMN category TEXT",
        )
        .await?;
        self.ensure_column(
            "provider_presets",
            "url_template",
            "ALTER TABLE provider_presets ADD COLUMN url_template TEXT",
        )
        .await?;
        self.ensure_column(
            "provider_presets",
            "auth_type",
            "ALTER TABLE provider_presets ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'api_key'",
        )
        .await?;
        self.ensure_column(
            "provider_presets",
            "auth_config",
            "ALTER TABLE provider_presets ADD COLUMN auth_config TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        self.ensure_column(
            "provider_presets",
            "default_headers",
            "ALTER TABLE provider_presets ADD COLUMN default_headers TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        self.ensure_column(
            "provider_presets",
            "default_params",
            "ALTER TABLE provider_presets ADD COLUMN default_params TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        self.ensure_column(
            "provider_presets",
            "capability_configs",
            "ALTER TABLE provider_presets ADD COLUMN capability_configs TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        self.ensure_column(
            "provider_presets",
            "version",
            "ALTER TABLE provider_presets ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
        )
        .await?;
        self.ensure_column(
            "provider_instances",
            "description",
            "ALTER TABLE provider_instances ADD COLUMN description TEXT",
        )
        .await?;
        self.ensure_column(
            "provider_instances",
            "icon",
            "ALTER TABLE provider_instances ADD COLUMN icon TEXT",
        )
        .await?;
        self.ensure_column(
            "provider_instances",
            "priority",
            "ALTER TABLE provider_instances ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
        )
        .await?;
        self.ensure_column(
            "provider_instances",
            "meta",
            "ALTER TABLE provider_instances ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        self.ensure_column(
            "provider_credentials",
            "weight",
            "ALTER TABLE provider_credentials ADD COLUMN weight INTEGER NOT NULL DEFAULT 0",
        )
        .await?;
        self.ensure_column(
            "provider_credentials",
            "priority",
            "ALTER TABLE provider_credentials ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
        )
        .await?;
        self.ensure_column(
            "provider_credentials",
            "is_active",
            "ALTER TABLE provider_credentials ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1",
        )
        .await?;
        self.ensure_column(
            "provider_credentials",
            "secret_ciphertext",
            "ALTER TABLE provider_credentials ADD COLUMN secret_ciphertext TEXT NOT NULL DEFAULT ''",
        )
        .await?;
        self.ensure_column(
            "provider_credentials",
            "secret_key_version",
            "ALTER TABLE provider_credentials ADD COLUMN secret_key_version INTEGER NOT NULL DEFAULT 0",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "capabilities",
            "ALTER TABLE provider_models ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]'",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "unified_model_id",
            "ALTER TABLE provider_models ADD COLUMN unified_model_id TEXT",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "upstream_path",
            "ALTER TABLE provider_models ADD COLUMN upstream_path TEXT NOT NULL DEFAULT 'v1/chat/completions'",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "pricing_config",
            "ALTER TABLE provider_models ADD COLUMN pricing_config TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "limit_config",
            "ALTER TABLE provider_models ADD COLUMN limit_config TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "tokenizer_config",
            "ALTER TABLE provider_models ADD COLUMN tokenizer_config TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "routing_config",
            "ALTER TABLE provider_models ADD COLUMN routing_config TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "config_override",
            "ALTER TABLE provider_models ADD COLUMN config_override TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "source",
            "ALTER TABLE provider_models ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "extra_meta",
            "ALTER TABLE provider_models ADD COLUMN extra_meta TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "weight",
            "ALTER TABLE provider_models ADD COLUMN weight INTEGER NOT NULL DEFAULT 100",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "priority",
            "ALTER TABLE provider_models ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "synced_at",
            "ALTER TABLE provider_models ADD COLUMN synced_at TEXT",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "created_at",
            "ALTER TABLE provider_models ADD COLUMN created_at TEXT",
        )
        .await?;
        self.ensure_column(
            "provider_models",
            "updated_at",
            "ALTER TABLE provider_models ADD COLUMN updated_at TEXT",
        )
        .await?;

        sqlx::query("DROP INDEX IF EXISTS idx_provider_models_instance_model")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_models_identity
             ON provider_models(instance_id, model_id, upstream_path)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_provider_models_instance_unified_model
             ON provider_models(instance_id, unified_model_id)",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_bandit_arm_scene
             ON bandit_arm_state(scene, arm_id)",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_bandit_arm_arm_id
             ON bandit_arm_state(arm_id)",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_bandit_arm_provider_model_id
             ON bandit_arm_state(provider_model_id)",
        )
        .execute(&self.pool)
        .await?;

        // Backfill updated_at for existing rows.
        let backfill_now = now_rfc3339()?;
        sqlx::query(
            "UPDATE provider_instances
             SET created_at = COALESCE(NULLIF(created_at, ''), ?),
                 updated_at = COALESCE(NULLIF(updated_at, ''), created_at),
                 priority = COALESCE(priority, 0),
                 meta = COALESCE(NULLIF(meta, ''), '{}')",
        )
        .bind(&backfill_now)
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "UPDATE provider_models
             SET created_at = COALESCE(NULLIF(created_at, ''), ?),
                 updated_at = COALESCE(NULLIF(updated_at, ''), created_at),
                 capabilities = COALESCE(NULLIF(capabilities, ''), '[]'),
                 upstream_path = COALESCE(NULLIF(upstream_path, ''), ?),
                 pricing_config = COALESCE(NULLIF(pricing_config, ''), '{}'),
                 limit_config = COALESCE(NULLIF(limit_config, ''), '{}'),
                 tokenizer_config = COALESCE(NULLIF(tokenizer_config, ''), '{}'),
                 routing_config = COALESCE(NULLIF(routing_config, ''), '{}'),
                 config_override = COALESCE(NULLIF(config_override, ''), '{}'),
                 source = COALESCE(NULLIF(source, ''), 'auto'),
                 extra_meta = COALESCE(NULLIF(extra_meta, ''), '{}'),
                 weight = COALESCE(weight, 100),
                 priority = COALESCE(priority, 0)",
        )
        .bind(&backfill_now)
        .bind(CHAT_UPSTREAM_PATH)
        .execute(&self.pool)
        .await?;

        self.normalize_model_capability_data().await?;
        self.migrate_legacy_secrets_to_keychain().await?;

        Ok(())
    }

    pub(crate) async fn ensure_column(
        &self,
        table: &str,
        column: &str,
        ddl: &str,
    ) -> Result<(), ProviderError> {
        let pragma = format!("PRAGMA table_info({table})");
        let rows = sqlx::query(&pragma).fetch_all(&self.pool).await?;
        let exists = rows.iter().any(|row| {
            row.try_get::<String, _>("name")
                .map(|name| name == column)
                .unwrap_or(false)
        });

        if !exists {
            sqlx::query(ddl).execute(&self.pool).await?;
        }
        Ok(())
    }

    pub(crate) fn keychain_entry(
        &self,
        credential_id: &str,
    ) -> Result<keyring::Entry, ProviderError> {
        keyring::Entry::new(PROVIDER_KEYCHAIN_SERVICE, credential_id)
            .map_err(|err| ProviderError::Database(format!("keychain entry init failed: {err}")))
    }

    pub(crate) fn set_secret_in_keychain(
        &self,
        credential_id: &str,
        secret_key: &str,
    ) -> Result<(), ProviderError> {
        let entry = self.keychain_entry(credential_id)?;
        entry
            .set_password(secret_key)
            .map_err(|err| ProviderError::Database(format!("keychain write failed: {err}")))
    }

    pub(crate) fn get_secret_from_keychain(
        &self,
        credential_id: &str,
    ) -> Result<Option<String>, ProviderError> {
        let entry = self.keychain_entry(credential_id)?;
        match entry.get_password() {
            Ok(secret) => Ok(normalize_secret(&secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(ProviderError::Database(format!(
                "keychain read failed: {err}"
            ))),
        }
    }

    pub(crate) fn delete_secret_in_keychain(
        &self,
        credential_id: &str,
    ) -> Result<(), ProviderError> {
        let entry = self.keychain_entry(credential_id)?;
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(ProviderError::Database(format!(
                "keychain delete failed: {err}"
            ))),
        }
    }

    pub(crate) fn resolve_secret_for_credential(
        &self,
        credential_id: &str,
        db_secret: Option<&str>,
        db_encrypted_secret: Option<&str>,
        db_key_version: i64,
    ) -> Result<Option<String>, ProviderError> {
        match self.get_secret_from_keychain(credential_id) {
            Ok(Some(secret)) => Ok(Some(secret)),
            Ok(None) => self.resolve_db_secret(
                credential_id,
                db_secret,
                db_encrypted_secret,
                db_key_version,
            ),
            Err(err) => {
                warn!(
                    "failed to read keychain secret for credential {}: {}",
                    credential_id, err
                );
                self.resolve_db_secret(
                    credential_id,
                    db_secret,
                    db_encrypted_secret,
                    db_key_version,
                )
            }
        }
    }

    fn resolve_db_secret(
        &self,
        credential_id: &str,
        db_secret: Option<&str>,
        db_encrypted_secret: Option<&str>,
        db_key_version: i64,
    ) -> Result<Option<String>, ProviderError> {
        let encrypted = db_encrypted_secret.unwrap_or_default();
        match self
            .secret_store
            .decrypt_from_db(credential_id, encrypted, db_key_version)
        {
            Ok(Some(secret)) => Ok(Some(secret)),
            Ok(None) => Ok(normalize_secret(db_secret.unwrap_or_default())),
            Err(err) => {
                warn!(
                    "failed to decrypt db fallback secret for credential {}: {}",
                    credential_id, err
                );
                Ok(normalize_secret(db_secret.unwrap_or_default()))
            }
        }
    }

    pub(crate) fn resolve_secret_from_row(
        &self,
        row: &SqliteRow,
    ) -> Result<Option<String>, ProviderError> {
        let credential_id: String = row.try_get("id")?;
        let legacy_secret: String = row.try_get("secret_key")?;
        let encrypted_secret: String = row
            .try_get("secret_ciphertext")
            .unwrap_or_else(|_| "".to_string());
        let key_version: i64 = row.try_get("secret_key_version").unwrap_or(0);
        self.resolve_secret_for_credential(
            &credential_id,
            Some(&legacy_secret),
            Some(&encrypted_secret),
            key_version,
        )
    }

    pub(crate) async fn persist_secret_for_credential(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        credential_id: &str,
        secret: &str,
    ) -> Result<(), ProviderError> {
        let keychain_ready = match self.set_secret_in_keychain(credential_id, secret) {
            Ok(_) => match self.get_secret_from_keychain(credential_id) {
                Ok(Some(saved)) if saved == secret => true,
                Ok(Some(_)) | Ok(None) => {
                    warn!(
                        "provider keychain write verification failed for credential {}, fallback to encrypted db secret",
                        credential_id
                    );
                    false
                }
                Err(err) => {
                    warn!(
                        "provider keychain verification read failed for credential {}, fallback to encrypted db secret: {}",
                        credential_id, err
                    );
                    false
                }
            },
            Err(err) => {
                warn!(
                    "failed to write keychain secret for credential {}: {}",
                    credential_id, err
                );
                false
            }
        };

        let (encrypted_secret, key_version) =
            self.secret_store.encrypt_for_db(credential_id, secret)?;
        sqlx::query(
            "UPDATE provider_credentials
             SET secret_key = '',
                 secret_ciphertext = ?,
                 secret_key_version = ?
             WHERE id = ?",
        )
        .bind(&encrypted_secret)
        .bind(key_version)
        .bind(credential_id)
        .execute(&mut **tx)
        .await?;

        if !keychain_ready {
            warn!(
                "credential {} saved to encrypted db fallback only; keychain unavailable",
                credential_id
            );
        }

        Ok(())
    }

    async fn migrate_legacy_secrets_to_keychain(&self) -> Result<(), ProviderError> {
        let rows = sqlx::query(
            "SELECT id, secret_key, secret_ciphertext, secret_key_version
             FROM provider_credentials
             WHERE TRIM(secret_key) <> '' OR TRIM(secret_ciphertext) <> ''",
        )
        .fetch_all(&self.pool)
        .await?;

        for row in rows {
            let credential_id: String = row.try_get("id")?;
            let secret_key: String = row.try_get("secret_key")?;
            let encrypted_secret: String = row
                .try_get("secret_ciphertext")
                .unwrap_or_else(|_| "".to_string());
            let key_version: i64 = row.try_get("secret_key_version").unwrap_or(0);

            let mut candidate_secret = self
                .secret_store
                .decrypt_from_db(&credential_id, &encrypted_secret, key_version)
                .unwrap_or(None);

            if candidate_secret.is_none() {
                candidate_secret = normalize_secret(&secret_key);
            }

            let Some(secret) = candidate_secret else {
                continue;
            };

            let (ciphertext, version) =
                self.secret_store.encrypt_for_db(&credential_id, &secret)?;
            if let Err(err) = sqlx::query(
                "UPDATE provider_credentials
                 SET secret_key = '',
                     secret_ciphertext = ?,
                     secret_key_version = ?
                 WHERE id = ?",
            )
            .bind(&ciphertext)
            .bind(version)
            .bind(&credential_id)
            .execute(&self.pool)
            .await
            {
                warn!(
                    "failed to persist encrypted fallback secret for credential {}: {}",
                    credential_id, err
                );
            }

            match self.set_secret_in_keychain(&credential_id, &secret) {
                Ok(_) => match self.get_secret_from_keychain(&credential_id) {
                    Ok(Some(saved)) if saved == secret => {}
                    Ok(Some(_)) | Ok(None) => {
                        warn!(
                            "keychain migration verification failed for credential {}, encrypted db fallback remains active",
                            credential_id
                        );
                    }
                    Err(err) => {
                        warn!(
                            "keychain migration verification read failed for credential {}, encrypted db fallback remains active: {}",
                            credential_id, err
                        );
                    }
                },
                Err(err) => {
                    warn!(
                        "failed to migrate credential {} into keychain, encrypted db fallback remains active: {}",
                        credential_id, err
                    );
                }
            }
        }

        Ok(())
    }
}
