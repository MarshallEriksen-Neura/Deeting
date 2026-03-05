use std::str::FromStr;

use log::warn;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;
use uuid::Uuid;

use crate::modules::providers::error::ProviderError;
use crate::modules::providers::types::{
    BanditArmState, BanditFeedbackRequest, CreateInstanceRequest, ProviderInstance, ProviderModel,
    ProviderModelUpdateRequest, ProviderPreset, UpdateInstanceRequest, UserEmbeddingConfig,
    UserEmbeddingConfigUpdateRequest, UserSecretary, UserSecretaryUpdateRequest,
};

#[derive(Debug, Clone)]
pub struct ProviderConnection {
    pub base_url: String,
    pub secret_key: Option<String>,
    pub protocol: Option<String>,
    pub auto_append_v1: Option<bool>,
}

pub struct ProviderStore {
    pool: SqlitePool,
}

const PROVIDER_KEYCHAIN_SERVICE: &str = "deeting.provider";
const LOCAL_DESKTOP_USER_ID: &str = "00000000-0000-0000-0000-000000000000";
const BANDIT_DEFAULT_SCENE: &str = "router:llm";
const BANDIT_DEFAULT_STRATEGY: &str = "epsilon_greedy";

impl ProviderStore {
    pub async fn new(database_url: &str) -> Result<Self, ProviderError> {
        let options = SqliteConnectOptions::from_str(database_url)
            .map_err(|err| ProviderError::Database(err.to_string()))?
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new().connect_with(options).await?;
        Ok(Self { pool })
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

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS provider_credentials (
                id TEXT PRIMARY KEY,
                instance_id TEXT NOT NULL REFERENCES provider_instances(id) ON DELETE CASCADE,
                alias TEXT NOT NULL,
                secret_key TEXT NOT NULL,
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
                 upstream_path = COALESCE(NULLIF(upstream_path, ''), 'v1/chat/completions'),
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
        .execute(&self.pool)
        .await?;

        self.migrate_legacy_secrets_to_keychain().await?;

        Ok(())
    }

    pub async fn list_presets(&self) -> Result<Vec<ProviderPreset>, ProviderError> {
        let rows = sqlx::query(
            "SELECT slug, name, provider, base_url, icon, theme_color, category, url_template, is_active
             FROM provider_presets
             ORDER BY name ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut presets = Vec::with_capacity(rows.len());
        for row in rows {
            presets.push(ProviderPreset {
                slug: row.try_get("slug")?,
                name: row.try_get("name")?,
                provider: row.try_get("provider")?,
                base_url: row.try_get("base_url")?,
                icon: row.try_get("icon")?,
                theme_color: row.try_get("theme_color")?,
                category: row.try_get("category")?,
                url_template: row.try_get("url_template")?,
                is_active: row.try_get::<i64, _>("is_active")? != 0,
            });
        }
        Ok(presets)
    }

    pub async fn get_or_create_user_secretary(&self) -> Result<UserSecretary, ProviderError> {
        if let Some(secretary) = self
            .get_user_secretary_by_user_id(LOCAL_DESKTOP_USER_ID)
            .await?
        {
            return Ok(secretary);
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;
        sqlx::query(
            "INSERT INTO user_secretary (id, user_id, name, model_name, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, ?)",
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind("deeting")
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        self.get_user_secretary_by_id(&id)
            .await?
            .ok_or_else(|| ProviderError::NotFound("secretary missing after create".to_string()))
    }

    pub async fn update_user_secretary(
        &self,
        payload: UserSecretaryUpdateRequest,
    ) -> Result<UserSecretary, ProviderError> {
        let existing = self.get_or_create_user_secretary().await?;
        let Some(next_model_name) = payload.model_name else {
            return Ok(existing);
        };

        let normalized_model_name = next_model_name.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });

        let now = now_rfc3339()?;
        sqlx::query(
            "UPDATE user_secretary
             SET model_name = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(normalized_model_name.as_deref())
        .bind(&now)
        .bind(&existing.id)
        .execute(&self.pool)
        .await?;

        self.get_user_secretary_by_id(&existing.id)
            .await?
            .ok_or_else(|| ProviderError::NotFound("secretary missing after update".to_string()))
    }

    pub async fn get_or_create_user_embedding_config(
        &self,
    ) -> Result<UserEmbeddingConfig, ProviderError> {
        if let Some(config) = self
            .get_user_embedding_config_by_user_id(LOCAL_DESKTOP_USER_ID)
            .await?
        {
            return Ok(config);
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;
        sqlx::query(
            "INSERT INTO user_embedding_config (id, user_id, provider_model_id, created_at, updated_at)
             VALUES (?, ?, NULL, ?, ?)",
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        self.get_user_embedding_config_by_id(&id)
            .await?
            .ok_or_else(|| {
                ProviderError::NotFound("embedding config missing after create".to_string())
            })
    }

    pub async fn update_user_embedding_config(
        &self,
        payload: UserEmbeddingConfigUpdateRequest,
    ) -> Result<UserEmbeddingConfig, ProviderError> {
        let existing = self.get_or_create_user_embedding_config().await?;
        let Some(next_provider_model_id) = payload.provider_model_id else {
            return Ok(existing);
        };

        let normalized_provider_model_id = next_provider_model_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        if let Some(provider_model_id) = normalized_provider_model_id.as_deref() {
            let provider_model_uuid = Uuid::parse_str(provider_model_id)
                .map_err(|_| ProviderError::Validation("invalid provider_model_id".to_string()))?;
            let model = self
                .get_model(&provider_model_uuid)
                .await?
                .ok_or_else(|| ProviderError::NotFound("provider model not found".to_string()))?;
            if !model.is_active {
                return Err(ProviderError::Validation(
                    "provider model is inactive".to_string(),
                ));
            }
            if !has_embedding_capability(&model.capabilities) {
                return Err(ProviderError::Validation(
                    "provider model does not support embedding".to_string(),
                ));
            }
        }

        let now = now_rfc3339()?;
        sqlx::query(
            "UPDATE user_embedding_config
             SET provider_model_id = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(normalized_provider_model_id.as_deref())
        .bind(&now)
        .bind(&existing.id)
        .execute(&self.pool)
        .await?;

        self.get_user_embedding_config_by_id(&existing.id)
            .await?
            .ok_or_else(|| {
                ProviderError::NotFound("embedding config missing after update".to_string())
            })
    }

    pub async fn replace_presets(
        &self,
        presets: Vec<ProviderPreset>,
    ) -> Result<usize, ProviderError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM provider_presets")
            .execute(&mut *tx)
            .await?;

        for preset in &presets {
            sqlx::query(
                "INSERT INTO provider_presets (
                    slug, name, provider, base_url, icon, theme_color, category, url_template,
                    auth_type, auth_config, default_headers, default_params, capability_configs,
                    version, is_active
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&preset.slug)
            .bind(&preset.name)
            .bind(&preset.provider)
            .bind(&preset.base_url)
            .bind(&preset.icon)
            .bind(&preset.theme_color)
            .bind(&preset.category)
            .bind(&preset.url_template)
            .bind("api_key")
            .bind("{}")
            .bind("{}")
            .bind("{}")
            .bind("{}")
            .bind(1_i64)
            .bind(if preset.is_active { 1 } else { 0 })
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(presets.len())
    }

    pub async fn list_instances(&self) -> Result<Vec<ProviderInstance>, ProviderError> {
        let rows = sqlx::query(
            "SELECT id, preset_slug, name, base_url, description, icon, priority, meta,
                    is_enabled, is_local, credentials_ref, created_at, updated_at
             FROM provider_instances
             ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut instances = Vec::with_capacity(rows.len());
        for row in rows {
            instances.push(row_to_instance(&row)?);
        }
        Ok(instances)
    }

    pub async fn create_instance(
        &self,
        payload: CreateInstanceRequest,
    ) -> Result<ProviderInstance, ProviderError> {
        let instance_id = Uuid::new_v4();
        let credential_id = Uuid::new_v4();
        let now = now_rfc3339()?;
        let credentials_ref = format!("db:{credential_id}");
        let is_local = payload.is_local.unwrap_or(false);
        let priority = payload.priority.unwrap_or(0);
        let meta = build_instance_meta_json(
            payload.protocol.as_deref(),
            payload.model_prefix.as_deref(),
            payload.auto_append_v1,
            payload.resource_name.as_deref(),
            payload.deployment_name.as_deref(),
            payload.api_version.as_deref(),
            payload.project_id.as_deref(),
            payload.region.as_deref(),
        );
        let meta_text =
            serde_json::to_string(&meta).map_err(|e| ProviderError::Database(e.to_string()))?;
        let secret_key = payload
            .secret_key
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO provider_instances (
                id, preset_slug, name, base_url, description, icon, priority, meta,
                is_enabled, is_local, credentials_ref, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(instance_id.to_string())
        .bind(&payload.preset_slug)
        .bind(&payload.name)
        .bind(&payload.base_url)
        .bind(payload.description.as_deref())
        .bind(payload.icon.as_deref())
        .bind(priority)
        .bind(&meta_text)
        .bind(1)
        .bind(if is_local { 1 } else { 0 })
        .bind(&credentials_ref)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO provider_credentials (id, instance_id, alias, secret_key, created_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(credential_id.to_string())
        .bind(instance_id.to_string())
        .bind("default")
        .bind("")
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        if let Some(value) = secret_key.as_deref() {
            let credential_key = credential_id.to_string();
            self.persist_secret_for_credential(&mut tx, &credential_key, value)
                .await?;
        }

        tx.commit().await?;

        self.get_instance(&instance_id.to_string())
            .await?
            .ok_or_else(|| ProviderError::NotFound("instance missing after create".to_string()))
    }

    pub async fn update_instance(
        &self,
        instance_id: &str,
        payload: UpdateInstanceRequest,
    ) -> Result<ProviderInstance, ProviderError> {
        let existing = self
            .get_instance(instance_id)
            .await?
            .ok_or_else(|| ProviderError::NotFound("instance not found".to_string()))?;

        let name = payload.name.unwrap_or(existing.name);
        let base_url = payload.base_url.unwrap_or(existing.base_url);
        let description = payload.description.or(existing.description);
        let icon = payload.icon.or(existing.icon);
        let priority = payload.priority.unwrap_or(existing.priority);
        let meta = merge_instance_meta_json(
            existing.meta,
            payload.protocol.as_deref(),
            payload.model_prefix.as_deref(),
            payload.auto_append_v1,
            payload.resource_name.as_deref(),
            payload.deployment_name.as_deref(),
            payload.api_version.as_deref(),
            payload.project_id.as_deref(),
            payload.region.as_deref(),
        );
        let meta_text =
            serde_json::to_string(&meta).map_err(|e| ProviderError::Database(e.to_string()))?;
        let is_enabled = payload.is_enabled.unwrap_or(existing.is_enabled);
        let now = now_rfc3339()?;

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "UPDATE provider_instances
             SET name = ?, base_url = ?, description = ?, icon = ?, priority = ?, meta = ?,
                 is_enabled = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(name)
        .bind(base_url)
        .bind(description.as_deref())
        .bind(icon.as_deref())
        .bind(priority)
        .bind(&meta_text)
        .bind(if is_enabled { 1 } else { 0 })
        .bind(&now)
        .bind(instance_id)
        .execute(&mut *tx)
        .await?;

        if let Some(secret_key) = payload.secret_key {
            let secret = secret_key.trim();
            if !secret.is_empty() {
                let credential_id = self
                    .ensure_default_credential_in_tx(&mut tx, instance_id, &now)
                    .await?;
                self.persist_secret_for_credential(&mut tx, &credential_id, secret)
                    .await?;
            }
        }

        tx.commit().await?;

        self.get_instance(instance_id)
            .await?
            .ok_or_else(|| ProviderError::NotFound("instance missing after update".to_string()))
    }

    pub async fn delete_instance(&self, instance_id: &str) -> Result<(), ProviderError> {
        let credential_rows = sqlx::query(
            "SELECT id
             FROM provider_credentials
             WHERE instance_id = ?",
        )
        .bind(instance_id)
        .fetch_all(&self.pool)
        .await?;

        let result = sqlx::query("DELETE FROM provider_instances WHERE id = ?")
            .bind(instance_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(ProviderError::NotFound("instance not found".to_string()));
        }

        for row in credential_rows {
            let credential_id: String = row.try_get("id")?;
            if let Err(err) = self.delete_secret_in_keychain(&credential_id) {
                warn!(
                    "failed to delete keychain secret for credential {}: {}",
                    credential_id, err
                );
            }
        }
        Ok(())
    }

    pub async fn list_models(
        &self,
        instance_id: &Uuid,
    ) -> Result<Vec<ProviderModel>, ProviderError> {
        let rows = sqlx::query(
            "SELECT id, instance_id, capabilities, model_id, unified_model_id, display_name,
                    upstream_path, pricing_config, limit_config, tokenizer_config, routing_config,
                    config_override, source, extra_meta, weight, priority, is_active, synced_at,
                    created_at, updated_at
             FROM provider_models
             WHERE instance_id = ?
             ORDER BY model_id ASC",
        )
        .bind(instance_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut models = Vec::with_capacity(rows.len());
        for row in rows {
            models.push(row_to_model(&row)?);
        }
        Ok(models)
    }

    pub async fn sync_models(
        &self,
        instance_id: &Uuid,
        models: Vec<ProviderModel>,
    ) -> Result<(), ProviderError> {
        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        sqlx::query("DELETE FROM provider_models WHERE instance_id = ?")
            .bind(instance_id.to_string())
            .execute(&mut *tx)
            .await?;

        for model in models {
            let caps =
                serde_json::to_string(&model.capabilities).unwrap_or_else(|_| "[]".to_string());
            let pricing_config = serde_json::to_string(&ensure_json_object(model.pricing_config))
                .map_err(|e| ProviderError::Database(e.to_string()))?;
            let limit_config = serde_json::to_string(&ensure_json_object(model.limit_config))
                .map_err(|e| ProviderError::Database(e.to_string()))?;
            let tokenizer_config =
                serde_json::to_string(&ensure_json_object(model.tokenizer_config))
                    .map_err(|e| ProviderError::Database(e.to_string()))?;
            let routing_config = serde_json::to_string(&ensure_json_object(model.routing_config))
                .map_err(|e| ProviderError::Database(e.to_string()))?;
            let config_override = serde_json::to_string(&ensure_json_object(model.config_override))
                .map_err(|e| ProviderError::Database(e.to_string()))?;
            let extra_meta = serde_json::to_string(&ensure_json_object(model.extra_meta))
                .map_err(|e| ProviderError::Database(e.to_string()))?;
            sqlx::query(
                "INSERT INTO provider_models (
                    id, instance_id, capabilities, model_id, unified_model_id, display_name,
                    upstream_path, pricing_config, limit_config, tokenizer_config, routing_config,
                    config_override, source, extra_meta, weight, priority, is_active, synced_at,
                    created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(model.id.to_string())
            .bind(instance_id.to_string())
            .bind(caps)
            .bind(model.model_id)
            .bind(model.unified_model_id)
            .bind(model.display_name)
            .bind(
                normalize_upstream_path(Some(model.upstream_path.as_str()))
                    .unwrap_or_else(|| "v1/chat/completions".to_string()),
            )
            .bind(pricing_config)
            .bind(limit_config)
            .bind(tokenizer_config)
            .bind(routing_config)
            .bind(config_override)
            .bind(normalize_source(Some(model.source.as_str())))
            .bind(extra_meta)
            .bind(model.weight)
            .bind(model.priority)
            .bind(if model.is_active { 1 } else { 0 })
            .bind(model.synced_at)
            .bind(model.created_at.unwrap_or_else(|| now.clone()))
            .bind(model.updated_at.unwrap_or_else(|| now.clone()))
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn quick_add_models(
        &self,
        instance_id: &Uuid,
        model_ids: Vec<String>,
        capability: Option<String>,
    ) -> Result<Vec<ProviderModel>, ProviderError> {
        let default_cap = capability
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "chat".to_string());
        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;
        let mut touched = Vec::new();
        let default_upstream_path = "v1/chat/completions";

        for raw in model_ids {
            let model_id = raw.trim().to_string();
            if model_id.is_empty() {
                continue;
            }

            let existing_row = sqlx::query(
                "SELECT id, instance_id, capabilities, model_id, unified_model_id, display_name,
                        upstream_path, pricing_config, limit_config, tokenizer_config, routing_config,
                        config_override, source, extra_meta, weight, priority, is_active, synced_at,
                        created_at, updated_at
                 FROM provider_models
                 WHERE instance_id = ? AND model_id = ? AND upstream_path = ?
                 LIMIT 1",
            )
            .bind(instance_id.to_string())
            .bind(&model_id)
            .bind(default_upstream_path)
            .fetch_optional(&mut *tx)
            .await?;

            if let Some(row) = existing_row {
                touched.push(row_to_model(&row)?);
                continue;
            }

            let new_id = Uuid::new_v4().to_string();
            let caps = serde_json::to_string(&vec![default_cap.clone()])
                .map_err(|e| ProviderError::Database(e.to_string()))?;

            sqlx::query(
                "INSERT INTO provider_models (
                    id, instance_id, capabilities, model_id, unified_model_id, display_name,
                    upstream_path, pricing_config, limit_config, tokenizer_config, routing_config,
                    config_override, source, extra_meta, weight, priority, is_active, synced_at,
                    created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&new_id)
            .bind(instance_id.to_string())
            .bind(caps)
            .bind(&model_id)
            .bind(&model_id)
            .bind(model_id.clone())
            .bind(default_upstream_path)
            .bind("{}")
            .bind("{}")
            .bind("{}")
            .bind("{}")
            .bind("{}")
            .bind("auto")
            .bind("{}")
            .bind(100_i64)
            .bind(0_i64)
            .bind(1)
            .bind::<Option<String>>(None)
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await?;

            let row = sqlx::query(
                "SELECT id, instance_id, capabilities, model_id, unified_model_id, display_name,
                        upstream_path, pricing_config, limit_config, tokenizer_config, routing_config,
                        config_override, source, extra_meta, weight, priority, is_active, synced_at,
                        created_at, updated_at
                 FROM provider_models
                 WHERE id = ?",
            )
            .bind(&new_id)
            .fetch_one(&mut *tx)
            .await?;
            touched.push(row_to_model(&row)?);
        }

        // Update parent instance updated_at if there are new changes.
        if !touched.is_empty() {
            sqlx::query(
                "UPDATE provider_instances
                 SET updated_at = ?
                 WHERE id = ?",
            )
            .bind(&now)
            .bind(instance_id.to_string())
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(touched)
    }

    pub async fn update_model(
        &self,
        model_id: &Uuid,
        payload: ProviderModelUpdateRequest,
    ) -> Result<ProviderModel, ProviderError> {
        let existing_row = sqlx::query(
            "SELECT id, instance_id, capabilities, model_id, unified_model_id, display_name,
                    upstream_path, pricing_config, limit_config, tokenizer_config, routing_config,
                    config_override, source, extra_meta, weight, priority, is_active, synced_at,
                    created_at, updated_at
             FROM provider_models
             WHERE id = ?
             LIMIT 1",
        )
        .bind(model_id.to_string())
        .fetch_optional(&self.pool)
        .await?;

        let Some(existing_row) = existing_row else {
            return Err(ProviderError::NotFound("model not found".to_string()));
        };
        let existing = row_to_model(&existing_row)?;

        let display_name = payload.display_name.clone().or(existing.display_name);
        let is_active = payload.is_active.unwrap_or(existing.is_active);
        let capabilities = resolve_capabilities(&payload, existing.capabilities);
        let unified_model_id = match payload.unified_model_id {
            Some(value) => value.and_then(|item| {
                let trimmed = item.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }),
            None => existing.unified_model_id,
        };
        let upstream_path = normalize_upstream_path(payload.upstream_path.as_deref())
            .or_else(|| normalize_upstream_path(Some(existing.upstream_path.as_str())))
            .unwrap_or_else(|| "v1/chat/completions".to_string());
        let weight = payload.weight.unwrap_or(existing.weight);
        let priority = payload.priority.unwrap_or(existing.priority);
        let pricing_config = payload.pricing_config.unwrap_or(existing.pricing_config);
        let limit_config = payload.limit_config.unwrap_or(existing.limit_config);
        let tokenizer_config = payload
            .tokenizer_config
            .unwrap_or(existing.tokenizer_config);
        let routing_config = payload.routing_config.unwrap_or(existing.routing_config);
        let config_override = payload.config_override.unwrap_or(existing.config_override);
        let source = payload
            .source
            .as_deref()
            .map(|value| normalize_source(Some(value)))
            .unwrap_or_else(|| existing.source.clone());
        let extra_meta = payload.extra_meta.unwrap_or(existing.extra_meta);
        let now = now_rfc3339()?;

        let caps = serde_json::to_string(&capabilities)
            .map_err(|e| ProviderError::Database(e.to_string()))?;
        let pricing_config_text = serde_json::to_string(&ensure_json_object(pricing_config))
            .map_err(|e| ProviderError::Database(e.to_string()))?;
        let limit_config_text = serde_json::to_string(&ensure_json_object(limit_config))
            .map_err(|e| ProviderError::Database(e.to_string()))?;
        let tokenizer_config_text = serde_json::to_string(&ensure_json_object(tokenizer_config))
            .map_err(|e| ProviderError::Database(e.to_string()))?;
        let routing_config_text = serde_json::to_string(&ensure_json_object(routing_config))
            .map_err(|e| ProviderError::Database(e.to_string()))?;
        let config_override_text = serde_json::to_string(&ensure_json_object(config_override))
            .map_err(|e| ProviderError::Database(e.to_string()))?;
        let extra_meta_text = serde_json::to_string(&ensure_json_object(extra_meta))
            .map_err(|e| ProviderError::Database(e.to_string()))?;
        sqlx::query(
            "UPDATE provider_models
             SET capabilities = ?, model_id = ?, unified_model_id = ?, display_name = ?,
                 upstream_path = ?, pricing_config = ?, limit_config = ?, tokenizer_config = ?,
                 routing_config = ?, config_override = ?, source = ?, extra_meta = ?,
                 weight = ?, priority = ?, is_active = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(caps)
        .bind(existing.model_id)
        .bind(unified_model_id)
        .bind(display_name)
        .bind(upstream_path)
        .bind(pricing_config_text)
        .bind(limit_config_text)
        .bind(tokenizer_config_text)
        .bind(routing_config_text)
        .bind(config_override_text)
        .bind(source)
        .bind(extra_meta_text)
        .bind(weight)
        .bind(priority)
        .bind(if is_active { 1 } else { 0 })
        .bind(now)
        .bind(model_id.to_string())
        .execute(&self.pool)
        .await?;

        let updated_row = sqlx::query(
            "SELECT id, instance_id, capabilities, model_id, unified_model_id, display_name,
                    upstream_path, pricing_config, limit_config, tokenizer_config, routing_config,
                    config_override, source, extra_meta, weight, priority, is_active, synced_at,
                    created_at, updated_at
             FROM provider_models
             WHERE id = ?
             LIMIT 1",
        )
        .bind(model_id.to_string())
        .fetch_one(&self.pool)
        .await?;

        row_to_model(&updated_row)
    }

    pub async fn get_model(&self, model_id: &Uuid) -> Result<Option<ProviderModel>, ProviderError> {
        let row = sqlx::query(
            "SELECT id, instance_id, capabilities, model_id, unified_model_id, display_name,
                    upstream_path, pricing_config, limit_config, tokenizer_config, routing_config,
                    config_override, source, extra_meta, weight, priority, is_active, synced_at,
                    created_at, updated_at
             FROM provider_models
             WHERE id = ?
             LIMIT 1",
        )
        .bind(model_id.to_string())
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(value) => Ok(Some(row_to_model(&value)?)),
            None => Ok(None),
        }
    }

    pub async fn get_bandit_arm_state(
        &self,
        scene: &str,
        arm_id: &str,
    ) -> Result<Option<BanditArmState>, ProviderError> {
        let normalized_scene = normalize_bandit_scene(Some(scene))?;
        let normalized_arm_id = arm_id.trim().to_string();
        if normalized_arm_id.is_empty() {
            return Err(ProviderError::Validation("arm_id is required".to_string()));
        }

        let row = sqlx::query(
            "SELECT
                id, provider_model_id, scene, arm_id, reward_metric_type,
                strategy, epsilon, alpha, beta,
                total_trials, successes, failures, total_latency_ms, latency_p95_ms,
                total_cost, last_reward, cooldown_until, version, created_at, updated_at
             FROM bandit_arm_state
             WHERE scene = ? AND arm_id = ?
             LIMIT 1",
        )
        .bind(&normalized_scene)
        .bind(&normalized_arm_id)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(value) => Ok(Some(row_to_bandit_arm_state(&value)?)),
            None => Ok(None),
        }
    }

    pub async fn list_bandit_arm_states(
        &self,
        scene: Option<&str>,
    ) -> Result<Vec<BanditArmState>, ProviderError> {
        let rows = if let Some(raw_scene) = scene {
            let normalized_scene = normalize_bandit_scene(Some(raw_scene))?;
            sqlx::query(
                "SELECT
                    id, provider_model_id, scene, arm_id, reward_metric_type,
                    strategy, epsilon, alpha, beta,
                    total_trials, successes, failures, total_latency_ms, latency_p95_ms,
                    total_cost, last_reward, cooldown_until, version, created_at, updated_at
                 FROM bandit_arm_state
                 WHERE scene = ?
                 ORDER BY total_trials DESC, updated_at DESC",
            )
            .bind(&normalized_scene)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                "SELECT
                    id, provider_model_id, scene, arm_id, reward_metric_type,
                    strategy, epsilon, alpha, beta,
                    total_trials, successes, failures, total_latency_ms, latency_p95_ms,
                    total_cost, last_reward, cooldown_until, version, created_at, updated_at
                 FROM bandit_arm_state
                 ORDER BY scene ASC, total_trials DESC, updated_at DESC",
            )
            .fetch_all(&self.pool)
            .await?
        };

        let mut states = Vec::with_capacity(rows.len());
        for row in rows {
            states.push(row_to_bandit_arm_state(&row)?);
        }
        Ok(states)
    }

    pub async fn record_bandit_feedback(
        &self,
        payload: BanditFeedbackRequest,
    ) -> Result<BanditArmState, ProviderError> {
        let scene = normalize_bandit_scene(payload.scene.as_deref())?;
        let arm_id = payload.arm_id.trim().to_string();
        if arm_id.is_empty() {
            return Err(ProviderError::Validation("arm_id is required".to_string()));
        }

        let strategy = extract_routing_string(payload.routing_config.as_ref(), "strategy")
            .unwrap_or_else(|| BANDIT_DEFAULT_STRATEGY.to_string());
        let epsilon =
            extract_routing_f64(payload.routing_config.as_ref(), "epsilon").unwrap_or(0.1);
        let alpha = extract_routing_f64(payload.routing_config.as_ref(), "alpha").unwrap_or(1.0);
        let beta = extract_routing_f64(payload.routing_config.as_ref(), "beta").unwrap_or(1.0);
        let failure_cooldown_threshold = extract_routing_i64(
            payload.routing_config.as_ref(),
            "failure_cooldown_threshold",
        )
        .unwrap_or(5)
        .max(1);
        let cooldown_seconds =
            extract_routing_i64(payload.routing_config.as_ref(), "cooldown_seconds")
                .unwrap_or(60)
                .max(1);

        let now = now_rfc3339()?;
        let provider_model_id = if scene == BANDIT_DEFAULT_SCENE {
            Uuid::parse_str(&arm_id).ok().map(|id| id.to_string())
        } else {
            None
        };
        let row_id = Uuid::new_v4().to_string();

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO bandit_arm_state (
                id, provider_model_id, scene, arm_id, reward_metric_type,
                strategy, epsilon, alpha, beta,
                total_trials, successes, failures, total_latency_ms, latency_p95_ms,
                total_cost, last_reward, cooldown_until, version, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, 0, 0, NULL, 1, ?, ?)
             ON CONFLICT(scene, arm_id) DO NOTHING",
        )
        .bind(&row_id)
        .bind(provider_model_id.as_deref())
        .bind(&scene)
        .bind(&arm_id)
        .bind(payload.reward_metric_type.as_deref())
        .bind(&strategy)
        .bind(epsilon)
        .bind(alpha)
        .bind(beta)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        let current_row = sqlx::query(
            "SELECT
                id, provider_model_id, scene, arm_id, reward_metric_type,
                strategy, epsilon, alpha, beta,
                total_trials, successes, failures, total_latency_ms, latency_p95_ms,
                total_cost, last_reward, cooldown_until, version, created_at, updated_at
             FROM bandit_arm_state
             WHERE scene = ? AND arm_id = ?
             LIMIT 1",
        )
        .bind(&scene)
        .bind(&arm_id)
        .fetch_one(&mut *tx)
        .await?;
        let current = row_to_bandit_arm_state(&current_row)?;

        let total_trials = current.total_trials + 1;
        let successes = if payload.success {
            current.successes + 1
        } else {
            current.successes
        };
        let failures = if payload.success {
            (current.failures - 1).max(0)
        } else {
            current.failures + 1
        };

        let total_latency_ms = if let Some(latency_ms) = payload.latency_ms {
            current.total_latency_ms + latency_ms as i64
        } else {
            current.total_latency_ms
        };
        let latency_p95_ms = payload.latency_ms.or(current.latency_p95_ms);
        let total_cost = current.total_cost + payload.cost.unwrap_or(0.0);
        let last_reward = payload.reward.unwrap_or(current.last_reward);
        let cooldown_until = if !payload.success && failures >= failure_cooldown_threshold {
            Some(now_plus_seconds_rfc3339(cooldown_seconds)?)
        } else if payload.success {
            None
        } else {
            current.cooldown_until
        };

        sqlx::query(
            "UPDATE bandit_arm_state
             SET total_trials = ?,
                 successes = ?,
                 failures = ?,
                 total_latency_ms = ?,
                 latency_p95_ms = ?,
                 total_cost = ?,
                 last_reward = ?,
                 cooldown_until = ?,
                 updated_at = ?
             WHERE scene = ? AND arm_id = ?",
        )
        .bind(total_trials)
        .bind(successes)
        .bind(failures)
        .bind(total_latency_ms)
        .bind(latency_p95_ms)
        .bind(total_cost)
        .bind(last_reward)
        .bind(cooldown_until.as_deref())
        .bind(&now)
        .bind(&scene)
        .bind(&arm_id)
        .execute(&mut *tx)
        .await?;

        let updated_row = sqlx::query(
            "SELECT
                id, provider_model_id, scene, arm_id, reward_metric_type,
                strategy, epsilon, alpha, beta,
                total_trials, successes, failures, total_latency_ms, latency_p95_ms,
                total_cost, last_reward, cooldown_until, version, created_at, updated_at
             FROM bandit_arm_state
             WHERE scene = ? AND arm_id = ?
             LIMIT 1",
        )
        .bind(&scene)
        .bind(&arm_id)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;
        row_to_bandit_arm_state(&updated_row)
    }

    pub async fn list_active_models(&self) -> Result<Vec<ProviderModel>, ProviderError> {
        let rows = sqlx::query(
            "SELECT id, instance_id, model_id, unified_model_id, display_name, capabilities,
                    upstream_path, pricing_config, limit_config, tokenizer_config,
                    routing_config, config_override, source, extra_meta, weight,
                    priority, is_active, synced_at, created_at, updated_at
             FROM provider_models
             WHERE is_active = 1",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut models = Vec::with_capacity(rows.len());
        for row in rows {
            models.push(row_to_model(&row)?);
        }
        Ok(models)
    }

    pub async fn get_instance_connection(
        &self,
        instance_id: &Uuid,
    ) -> Result<Option<ProviderConnection>, ProviderError> {
        let row = sqlx::query(
            "SELECT base_url, credentials_ref, meta
             FROM provider_instances
             WHERE id = ?
             LIMIT 1",
        )
        .bind(instance_id.to_string())
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let base_url: String = row.try_get("base_url")?;
        let credentials_ref: String = row.try_get("credentials_ref")?;
        let raw_meta: String = row.try_get("meta")?;
        let meta = parse_json_object_text(Some(raw_meta));
        let protocol = meta
            .get("protocol")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let auto_append_v1 = meta.get("auto_append_v1").and_then(|value| value.as_bool());

        let credential_row = if credentials_ref.starts_with("db:") {
            let credential_id = credentials_ref.trim_start_matches("db:").trim();
            sqlx::query("SELECT id, secret_key FROM provider_credentials WHERE id = ? LIMIT 1")
                .bind(credential_id)
                .fetch_optional(&self.pool)
                .await?
        } else {
            let alias = credentials_ref.trim();
            sqlx::query(
                "SELECT id, secret_key FROM provider_credentials
                 WHERE instance_id = ? AND alias = ?
                 LIMIT 1",
            )
            .bind(instance_id.to_string())
            .bind(alias)
            .fetch_optional(&self.pool)
            .await?
        };

        let mut selected_credential_id: Option<String> = None;
        let mut secret_key = None;
        if let Some(value) = credential_row {
            let credential_id: String = value.try_get("id")?;
            selected_credential_id = Some(credential_id);
            secret_key = self.resolve_secret_from_row(&value)?;
        }

        if secret_key.is_none() {
            let rows = sqlx::query(
                "SELECT id, secret_key
                 FROM provider_credentials
                 WHERE instance_id = ?
                 ORDER BY created_at DESC",
            )
            .bind(instance_id.to_string())
            .fetch_all(&self.pool)
            .await?;

            for row in rows {
                let credential_id: String = row.try_get("id")?;
                if selected_credential_id.as_deref() == Some(credential_id.as_str()) {
                    continue;
                }
                let candidate = self.resolve_secret_from_row(&row)?;
                if candidate.is_some() {
                    secret_key = candidate;
                    break;
                }
            }
        }

        Ok(Some(ProviderConnection {
            base_url,
            secret_key,
            protocol,
            auto_append_v1,
        }))
    }

    async fn get_user_secretary_by_id(
        &self,
        id: &str,
    ) -> Result<Option<UserSecretary>, ProviderError> {
        let row = sqlx::query(
            "SELECT id, user_id, name, model_name, created_at, updated_at
             FROM user_secretary
             WHERE id = ?
             LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(value) => Ok(Some(row_to_user_secretary(&value)?)),
            None => Ok(None),
        }
    }

    async fn get_user_secretary_by_user_id(
        &self,
        user_id: &str,
    ) -> Result<Option<UserSecretary>, ProviderError> {
        let row = sqlx::query(
            "SELECT id, user_id, name, model_name, created_at, updated_at
             FROM user_secretary
             WHERE user_id = ?
             LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(value) => Ok(Some(row_to_user_secretary(&value)?)),
            None => Ok(None),
        }
    }

    async fn get_user_embedding_config_by_id(
        &self,
        id: &str,
    ) -> Result<Option<UserEmbeddingConfig>, ProviderError> {
        let row = sqlx::query(
            "SELECT id, user_id, provider_model_id, created_at, updated_at
             FROM user_embedding_config
             WHERE id = ?
             LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(value) => Ok(Some(row_to_user_embedding_config(&value)?)),
            None => Ok(None),
        }
    }

    async fn get_user_embedding_config_by_user_id(
        &self,
        user_id: &str,
    ) -> Result<Option<UserEmbeddingConfig>, ProviderError> {
        let row = sqlx::query(
            "SELECT id, user_id, provider_model_id, created_at, updated_at
             FROM user_embedding_config
             WHERE user_id = ?
             LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(value) => Ok(Some(row_to_user_embedding_config(&value)?)),
            None => Ok(None),
        }
    }

    async fn get_instance(
        &self,
        instance_id: &str,
    ) -> Result<Option<ProviderInstance>, ProviderError> {
        let row = sqlx::query(
            "SELECT id, preset_slug, name, base_url, description, icon, priority, meta,
                    is_enabled, is_local, credentials_ref, created_at, updated_at
             FROM provider_instances
             WHERE id = ?
             LIMIT 1",
        )
        .bind(instance_id)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(value) => Ok(Some(row_to_instance(&value)?)),
            None => Ok(None),
        }
    }

    async fn ensure_default_credential_in_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        instance_id: &str,
        now: &str,
    ) -> Result<String, ProviderError> {
        let existing_credential = sqlx::query(
            "SELECT id FROM provider_credentials
             WHERE instance_id = ? AND alias = 'default'
             LIMIT 1",
        )
        .bind(instance_id)
        .fetch_optional(&mut **tx)
        .await?;

        if let Some(row) = existing_credential {
            let credential_id: String = row.try_get("id")?;
            sqlx::query(
                "UPDATE provider_instances
                 SET credentials_ref = ?, updated_at = ?
                 WHERE id = ?",
            )
            .bind(format!("db:{credential_id}"))
            .bind(now)
            .bind(instance_id)
            .execute(&mut **tx)
            .await?;
            return Ok(credential_id);
        }

        let credential_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO provider_credentials (id, instance_id, alias, secret_key, created_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&credential_id)
        .bind(instance_id)
        .bind("default")
        .bind("")
        .bind(now)
        .execute(&mut **tx)
        .await?;

        sqlx::query(
            "UPDATE provider_instances
             SET credentials_ref = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(format!("db:{credential_id}"))
        .bind(now)
        .bind(instance_id)
        .execute(&mut **tx)
        .await?;

        Ok(credential_id)
    }

    async fn migrate_legacy_secrets_to_keychain(&self) -> Result<(), ProviderError> {
        let rows = sqlx::query(
            "SELECT id, secret_key
             FROM provider_credentials
             WHERE TRIM(secret_key) <> ''",
        )
        .fetch_all(&self.pool)
        .await?;

        for row in rows {
            let credential_id: String = row.try_get("id")?;
            let secret_key: String = row.try_get("secret_key")?;
            let secret = secret_key.trim();
            if secret.is_empty() {
                continue;
            }

            match self.set_secret_in_keychain(&credential_id, secret) {
                Ok(_) => {
                    if let Err(err) = sqlx::query(
                        "UPDATE provider_credentials
                         SET secret_key = ''
                         WHERE id = ?",
                    )
                    .bind(&credential_id)
                    .execute(&self.pool)
                    .await
                    {
                        warn!(
                            "failed to clear legacy db secret after keychain migration for credential {}: {}",
                            credential_id, err
                        );
                    }
                }
                Err(err) => {
                    warn!(
                        "failed to migrate legacy db secret into keychain for credential {}: {}",
                        credential_id, err
                    );
                }
            }
        }

        Ok(())
    }

    fn keychain_entry(&self, credential_id: &str) -> Result<keyring::Entry, ProviderError> {
        keyring::Entry::new(PROVIDER_KEYCHAIN_SERVICE, credential_id)
            .map_err(|err| ProviderError::Database(format!("keychain entry init failed: {err}")))
    }

    fn resolve_secret_from_row(&self, row: &SqliteRow) -> Result<Option<String>, ProviderError> {
        let credential_id: String = row.try_get("id")?;
        match self.get_secret_from_keychain(&credential_id) {
            Ok(Some(secret)) => Ok(Some(secret)),
            Ok(None) => {
                let legacy_secret: String = row.try_get("secret_key")?;
                let trimmed = legacy_secret.trim();
                if trimmed.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(trimmed.to_string()))
                }
            }
            Err(err) => {
                warn!(
                    "failed to read keychain secret for credential {}: {}",
                    credential_id, err
                );
                let legacy_secret: String = row.try_get("secret_key")?;
                let trimmed = legacy_secret.trim();
                if trimmed.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(trimmed.to_string()))
                }
            }
        }
    }

    async fn persist_secret_for_credential(
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
                        "provider keychain write verification failed for credential {}, fallback to local db",
                        credential_id
                    );
                    false
                }
                Err(err) => {
                    warn!(
                        "provider keychain verification read failed for credential {}, fallback to local db: {}",
                        credential_id, err
                    );
                    false
                }
            },
            Err(err) => {
                warn!(
                    "failed to write provider credential into keychain ({}), fallback to local db: {}",
                    credential_id, err
                );
                false
            }
        };

        if keychain_ready {
            // Keep db plaintext empty when keychain is available.
            sqlx::query(
                "UPDATE provider_credentials
                 SET secret_key = ''
                 WHERE id = ?",
            )
            .bind(credential_id)
            .execute(&mut **tx)
            .await?;
            return Ok(());
        }

        sqlx::query(
            "UPDATE provider_credentials
             SET secret_key = ?
             WHERE id = ?",
        )
        .bind(secret)
        .bind(credential_id)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    fn set_secret_in_keychain(
        &self,
        credential_id: &str,
        secret_key: &str,
    ) -> Result<(), ProviderError> {
        let entry = self.keychain_entry(credential_id)?;
        entry
            .set_password(secret_key)
            .map_err(|err| ProviderError::Database(format!("keychain write failed: {err}")))
    }

    fn get_secret_from_keychain(
        &self,
        credential_id: &str,
    ) -> Result<Option<String>, ProviderError> {
        let entry = self.keychain_entry(credential_id)?;
        match entry.get_password() {
            Ok(secret) => {
                let trimmed = secret.trim();
                if trimmed.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(trimmed.to_string()))
                }
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(ProviderError::Database(format!(
                "keychain read failed: {err}"
            ))),
        }
    }

    fn delete_secret_in_keychain(&self, credential_id: &str) -> Result<(), ProviderError> {
        let entry = self.keychain_entry(credential_id)?;
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(ProviderError::Database(format!(
                "keychain delete failed: {err}"
            ))),
        }
    }

    async fn ensure_column(
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
}

fn resolve_capabilities(
    payload: &ProviderModelUpdateRequest,
    fallback: Vec<String>,
) -> Vec<String> {
    if let Some(caps) = payload.capabilities.clone() {
        let filtered: Vec<String> = caps
            .into_iter()
            .map(|cap| cap.trim().to_string())
            .filter(|cap| !cap.is_empty())
            .collect();
        if !filtered.is_empty() {
            return filtered;
        }
    }

    if let Some(routing_config) = payload.routing_config.clone() {
        if let Some(array) = routing_config
            .get("capabilities")
            .and_then(|value| value.as_array())
        {
            let caps: Vec<String> = array
                .iter()
                .filter_map(|item| item.as_str().map(|value| value.trim().to_string()))
                .filter(|value| !value.is_empty())
                .collect();
            if !caps.is_empty() {
                return caps;
            }
        }
    }

    fallback
}

fn ensure_json_object(value: serde_json::Value) -> serde_json::Value {
    if value.is_object() {
        value
    } else {
        serde_json::json!({})
    }
}

fn parse_json_object_text(text: Option<String>) -> serde_json::Value {
    match text {
        Some(value) if !value.trim().is_empty() => {
            serde_json::from_str::<serde_json::Value>(&value)
                .ok()
                .filter(|item| item.is_object())
                .unwrap_or_else(|| serde_json::json!({}))
        }
        _ => serde_json::json!({}),
    }
}

fn normalize_upstream_path(path: Option<&str>) -> Option<String> {
    path.map(|value| value.trim().trim_start_matches('/').to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_source(source: Option<&str>) -> String {
    source
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "auto".to_string())
}

fn insert_meta_if_non_empty(
    target: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<&str>,
) {
    if let Some(raw) = value {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            target.insert(
                key.to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
}

fn build_instance_meta_json(
    protocol: Option<&str>,
    model_prefix: Option<&str>,
    auto_append_v1: Option<bool>,
    resource_name: Option<&str>,
    deployment_name: Option<&str>,
    api_version: Option<&str>,
    project_id: Option<&str>,
    region: Option<&str>,
) -> serde_json::Value {
    let mut meta = serde_json::Map::new();
    insert_meta_if_non_empty(&mut meta, "protocol", protocol);
    insert_meta_if_non_empty(&mut meta, "model_prefix", model_prefix);
    if let Some(value) = auto_append_v1 {
        meta.insert("auto_append_v1".to_string(), serde_json::Value::Bool(value));
    }
    insert_meta_if_non_empty(&mut meta, "resource_name", resource_name);
    insert_meta_if_non_empty(&mut meta, "deployment_name", deployment_name);
    insert_meta_if_non_empty(&mut meta, "api_version", api_version);
    insert_meta_if_non_empty(&mut meta, "project_id", project_id);
    insert_meta_if_non_empty(&mut meta, "region", region);
    serde_json::Value::Object(meta)
}

fn merge_instance_meta_json(
    existing: serde_json::Value,
    protocol: Option<&str>,
    model_prefix: Option<&str>,
    auto_append_v1: Option<bool>,
    resource_name: Option<&str>,
    deployment_name: Option<&str>,
    api_version: Option<&str>,
    project_id: Option<&str>,
    region: Option<&str>,
) -> serde_json::Value {
    let mut next = ensure_json_object(existing);
    let Some(map) = next.as_object_mut() else {
        return serde_json::json!({});
    };

    if let Some(value) = protocol {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "protocol".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = model_prefix {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "model_prefix".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = auto_append_v1 {
        map.insert("auto_append_v1".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = resource_name {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "resource_name".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = deployment_name {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "deployment_name".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = api_version {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "api_version".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = project_id {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "project_id".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = region {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "region".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }

    serde_json::Value::Object(map.clone())
}

fn normalize_bandit_scene(scene: Option<&str>) -> Result<String, ProviderError> {
    let normalized = scene.unwrap_or(BANDIT_DEFAULT_SCENE).trim().to_string();
    if normalized.is_empty() {
        return Err(ProviderError::Validation("scene is required".to_string()));
    }
    Ok(normalized)
}

fn extract_routing_string(config: Option<&serde_json::Value>, key: &str) -> Option<String> {
    config
        .and_then(|value| value.get(key))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn extract_routing_f64(config: Option<&serde_json::Value>, key: &str) -> Option<f64> {
    let value = config.and_then(|item| item.get(key))?;
    if let Some(number) = value.as_f64() {
        return Some(number);
    }
    value
        .as_str()
        .and_then(|raw| raw.trim().parse::<f64>().ok())
}

fn extract_routing_i64(config: Option<&serde_json::Value>, key: &str) -> Option<i64> {
    let value = config.and_then(|item| item.get(key))?;
    if let Some(number) = value.as_i64() {
        return Some(number);
    }
    if let Some(number) = value.as_u64() {
        return i64::try_from(number).ok();
    }
    value
        .as_str()
        .and_then(|raw| raw.trim().parse::<i64>().ok())
}

fn now_plus_seconds_rfc3339(seconds: i64) -> Result<String, ProviderError> {
    time::OffsetDateTime::now_utc()
        .saturating_add(time::Duration::seconds(seconds.max(0)))
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| ProviderError::Database(e.to_string()))
}

fn row_to_bandit_arm_state(row: &SqliteRow) -> Result<BanditArmState, ProviderError> {
    Ok(BanditArmState {
        id: row.try_get("id")?,
        provider_model_id: row.try_get("provider_model_id")?,
        scene: row.try_get("scene")?,
        arm_id: row.try_get("arm_id")?,
        reward_metric_type: row.try_get("reward_metric_type")?,
        strategy: row.try_get("strategy")?,
        epsilon: row.try_get::<f64, _>("epsilon").unwrap_or(0.1),
        alpha: row.try_get::<f64, _>("alpha").unwrap_or(1.0),
        beta: row.try_get::<f64, _>("beta").unwrap_or(1.0),
        total_trials: row.try_get::<i64, _>("total_trials").unwrap_or(0),
        successes: row.try_get::<i64, _>("successes").unwrap_or(0),
        failures: row.try_get::<i64, _>("failures").unwrap_or(0),
        total_latency_ms: row.try_get::<i64, _>("total_latency_ms").unwrap_or(0),
        latency_p95_ms: row.try_get("latency_p95_ms")?,
        total_cost: row.try_get::<f64, _>("total_cost").unwrap_or(0.0),
        last_reward: row.try_get::<f64, _>("last_reward").unwrap_or(0.0),
        cooldown_until: row.try_get("cooldown_until")?,
        version: row.try_get::<i64, _>("version").unwrap_or(1),
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_instance(row: &SqliteRow) -> Result<ProviderInstance, ProviderError> {
    let meta_text: Option<String> = row.try_get("meta")?;
    Ok(ProviderInstance {
        id: Uuid::parse_str(row.try_get::<String, _>("id")?.as_str())
            .map_err(|e| ProviderError::Database(format!("invalid uuid: {e}")))?,
        preset_slug: row.try_get("preset_slug")?,
        name: row.try_get("name")?,
        base_url: row.try_get("base_url")?,
        description: row.try_get("description")?,
        icon: row.try_get("icon")?,
        priority: row.try_get::<i64, _>("priority").unwrap_or(0),
        meta: parse_json_object_text(meta_text),
        is_enabled: row.try_get::<i64, _>("is_enabled")? != 0,
        is_local: row.try_get::<i64, _>("is_local")? != 0,
        credentials_ref: row.try_get("credentials_ref")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_model(row: &SqliteRow) -> Result<ProviderModel, ProviderError> {
    let caps_str: String = row.try_get("capabilities")?;
    let pricing_config: Option<String> = row.try_get("pricing_config")?;
    let limit_config: Option<String> = row.try_get("limit_config")?;
    let tokenizer_config: Option<String> = row.try_get("tokenizer_config")?;
    let routing_config: Option<String> = row.try_get("routing_config")?;
    let config_override: Option<String> = row.try_get("config_override")?;
    let extra_meta: Option<String> = row.try_get("extra_meta")?;
    Ok(ProviderModel {
        id: Uuid::parse_str(row.try_get::<String, _>("id")?.as_str())
            .map_err(|e| ProviderError::Database(format!("invalid model uuid: {e}")))?,
        instance_id: Uuid::parse_str(row.try_get::<String, _>("instance_id")?.as_str())
            .map_err(|e| ProviderError::Database(format!("invalid instance uuid: {e}")))?,
        capabilities: serde_json::from_str(&caps_str).unwrap_or_default(),
        model_id: row.try_get("model_id")?,
        unified_model_id: row.try_get("unified_model_id")?,
        display_name: row.try_get("display_name")?,
        upstream_path: normalize_upstream_path(Some(
            row.try_get::<String, _>("upstream_path")?.as_str(),
        ))
        .unwrap_or_else(|| "v1/chat/completions".to_string()),
        pricing_config: parse_json_object_text(pricing_config),
        limit_config: parse_json_object_text(limit_config),
        tokenizer_config: parse_json_object_text(tokenizer_config),
        routing_config: parse_json_object_text(routing_config),
        config_override: parse_json_object_text(config_override),
        source: normalize_source(Some(row.try_get::<String, _>("source")?.as_str())),
        extra_meta: parse_json_object_text(extra_meta),
        weight: row.try_get::<i64, _>("weight").unwrap_or(100),
        priority: row.try_get::<i64, _>("priority").unwrap_or(0),
        is_active: row.try_get::<i64, _>("is_active")? != 0,
        synced_at: row.try_get("synced_at")?,
        created_at: row.try_get("created_at").ok(),
        updated_at: row.try_get("updated_at").ok(),
    })
}

fn row_to_user_secretary(row: &SqliteRow) -> Result<UserSecretary, ProviderError> {
    Ok(UserSecretary {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        name: row.try_get("name")?,
        model_name: row.try_get("model_name")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_user_embedding_config(row: &SqliteRow) -> Result<UserEmbeddingConfig, ProviderError> {
    Ok(UserEmbeddingConfig {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        provider_model_id: row.try_get("provider_model_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn has_embedding_capability(capabilities: &[String]) -> bool {
    capabilities
        .iter()
        .any(|capability| capability.eq_ignore_ascii_case("embedding"))
}

fn now_rfc3339() -> Result<String, ProviderError> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| ProviderError::Database(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn init_migrates_legacy_provider_models_before_index_creation() {
        let store = ProviderStore::new("sqlite::memory:")
            .await
            .expect("failed to create provider store");

        // Simulate legacy schema that existed before upstream_path/unified_model_id.
        sqlx::query(
            "CREATE TABLE provider_models (
                id TEXT PRIMARY KEY,
                instance_id TEXT NOT NULL,
                model_id TEXT NOT NULL,
                display_name TEXT,
                is_active BOOLEAN DEFAULT 1
            )",
        )
        .execute(&store.pool)
        .await
        .expect("failed to create legacy provider_models");
        store
            .init()
            .await
            .expect("provider init should migrate legacy schema");

        let columns = sqlx::query("PRAGMA table_info(provider_models)")
            .fetch_all(&store.pool)
            .await
            .expect("failed to inspect provider_models");
        let names: Vec<String> = columns
            .iter()
            .filter_map(|row| row.try_get::<String, _>("name").ok())
            .collect();

        assert!(
            names.iter().any(|name| name == "upstream_path"),
            "expected upstream_path to be added"
        );
        assert!(
            names.iter().any(|name| name == "unified_model_id"),
            "expected unified_model_id to be added"
        );
    }
}
