use std::str::FromStr;

use log::warn;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;
use uuid::Uuid;

use crate::modules::providers::error::ProviderError;
use crate::modules::providers::types::{
    BanditArmState, BanditFeedbackRequest, CreateInstanceRequest, ProviderInstance, ProviderModel,
    ProviderModelUpdateRequest, ProviderPreset, UpdateInstanceRequest, UserSecretary,
    UserSecretaryUpdateRequest,
};

#[derive(Debug, Clone)]
pub struct ProviderConnection {
    pub base_url: String,
    pub secret_key: Option<String>,
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
                created_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS provider_models (
                id TEXT PRIMARY KEY,
                instance_id TEXT NOT NULL REFERENCES provider_instances(id) ON DELETE CASCADE,
                model_id TEXT NOT NULL,
                display_name TEXT,
                capabilities TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1
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
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_models_instance_model
             ON provider_models(instance_id, model_id)",
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

        // Backfill updated_at for existing rows.
        sqlx::query(
            "UPDATE provider_instances
             SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at)",
        )
        .execute(&self.pool)
        .await?;

        self.migrate_legacy_secrets_to_keychain().await?;

        Ok(())
    }

    pub async fn list_presets(&self) -> Result<Vec<ProviderPreset>, ProviderError> {
        let rows = sqlx::query(
            "SELECT slug, name, provider, base_url, icon, is_active
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
                "INSERT INTO provider_presets (slug, name, provider, base_url, icon, is_active)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&preset.slug)
            .bind(&preset.name)
            .bind(&preset.provider)
            .bind(&preset.base_url)
            .bind(&preset.icon)
            .bind(if preset.is_active { 1 } else { 0 })
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(presets.len())
    }

    pub async fn list_instances(&self) -> Result<Vec<ProviderInstance>, ProviderError> {
        let rows = sqlx::query(
            "SELECT id, preset_slug, name, base_url, is_enabled, is_local, credentials_ref, created_at, updated_at
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
        let secret_key = payload
            .secret_key
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO provider_instances (
                id, preset_slug, name, base_url, is_enabled, is_local, credentials_ref, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(instance_id.to_string())
        .bind(&payload.preset_slug)
        .bind(&payload.name)
        .bind(&payload.base_url)
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
            self.set_secret_in_keychain(&credential_key, value)?;
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
        let is_enabled = payload.is_enabled.unwrap_or(existing.is_enabled);
        let now = now_rfc3339()?;

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "UPDATE provider_instances
             SET name = ?, base_url = ?, is_enabled = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(name)
        .bind(base_url)
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
                self.set_secret_in_keychain(&credential_id, secret)?;
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
            "SELECT id, instance_id, model_id, display_name, capabilities, is_active
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
        let mut tx = self.pool.begin().await?;

        sqlx::query("DELETE FROM provider_models WHERE instance_id = ?")
            .bind(instance_id.to_string())
            .execute(&mut *tx)
            .await?;

        for model in models {
            let caps =
                serde_json::to_string(&model.capabilities).unwrap_or_else(|_| "[]".to_string());
            sqlx::query(
                "INSERT INTO provider_models (id, instance_id, model_id, display_name, capabilities, is_active)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(model.id.to_string())
            .bind(instance_id.to_string())
            .bind(model.model_id)
            .bind(model.display_name)
            .bind(caps)
            .bind(if model.is_active { 1 } else { 0 })
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

        for raw in model_ids {
            let model_id = raw.trim().to_string();
            if model_id.is_empty() {
                continue;
            }

            let existing_row = sqlx::query(
                "SELECT id, instance_id, model_id, display_name, capabilities, is_active
                 FROM provider_models
                 WHERE instance_id = ? AND model_id = ?
                 LIMIT 1",
            )
            .bind(instance_id.to_string())
            .bind(&model_id)
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
                "INSERT INTO provider_models (id, instance_id, model_id, display_name, capabilities, is_active)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&new_id)
            .bind(instance_id.to_string())
            .bind(&model_id)
            .bind(model_id.clone())
            .bind(caps)
            .bind(1)
            .execute(&mut *tx)
            .await?;

            let row = sqlx::query(
                "SELECT id, instance_id, model_id, display_name, capabilities, is_active
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
            "SELECT id, instance_id, model_id, display_name, capabilities, is_active
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

        let caps = serde_json::to_string(&capabilities)
            .map_err(|e| ProviderError::Database(e.to_string()))?;
        sqlx::query(
            "UPDATE provider_models
             SET display_name = ?, capabilities = ?, is_active = ?
             WHERE id = ?",
        )
        .bind(display_name)
        .bind(caps)
        .bind(if is_active { 1 } else { 0 })
        .bind(model_id.to_string())
        .execute(&self.pool)
        .await?;

        let updated_row = sqlx::query(
            "SELECT id, instance_id, model_id, display_name, capabilities, is_active
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
            "SELECT id, instance_id, model_id, display_name, capabilities, is_active
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
        let epsilon = extract_routing_f64(payload.routing_config.as_ref(), "epsilon").unwrap_or(0.1);
        let alpha = extract_routing_f64(payload.routing_config.as_ref(), "alpha").unwrap_or(1.0);
        let beta = extract_routing_f64(payload.routing_config.as_ref(), "beta").unwrap_or(1.0);
        let failure_cooldown_threshold = extract_routing_i64(
            payload.routing_config.as_ref(),
            "failure_cooldown_threshold",
        )
        .unwrap_or(5)
        .max(1);
        let cooldown_seconds = extract_routing_i64(payload.routing_config.as_ref(), "cooldown_seconds")
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

    pub async fn get_instance_connection(
        &self,
        instance_id: &Uuid,
    ) -> Result<Option<ProviderConnection>, ProviderError> {
        let row = sqlx::query(
            "SELECT base_url, credentials_ref
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

        let mut secret_key = None;
        if let Some(value) = credential_row {
            let credential_id: String = value.try_get("id")?;
            match self.get_secret_from_keychain(&credential_id) {
                Ok(Some(secret)) => {
                    secret_key = Some(secret);
                }
                Ok(None) => {
                    let legacy_secret: String = value.try_get("secret_key")?;
                    let trimmed = legacy_secret.trim();
                    if !trimmed.is_empty() {
                        secret_key = Some(trimmed.to_string());
                    }
                }
                Err(err) => {
                    warn!(
                        "failed to read keychain secret for credential {}: {}",
                        credential_id, err
                    );
                    let legacy_secret: String = value.try_get("secret_key")?;
                    let trimmed = legacy_secret.trim();
                    if !trimmed.is_empty() {
                        secret_key = Some(trimmed.to_string());
                    }
                }
            }
        }

        Ok(Some(ProviderConnection {
            base_url,
            secret_key,
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

    async fn get_instance(
        &self,
        instance_id: &str,
    ) -> Result<Option<ProviderInstance>, ProviderError> {
        let row = sqlx::query(
            "SELECT id, preset_slug, name, base_url, is_enabled, is_local, credentials_ref, created_at, updated_at
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

fn normalize_bandit_scene(scene: Option<&str>) -> Result<String, ProviderError> {
    let normalized = scene
        .unwrap_or(BANDIT_DEFAULT_SCENE)
        .trim()
        .to_string();
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
    value.as_str().and_then(|raw| raw.trim().parse::<f64>().ok())
}

fn extract_routing_i64(config: Option<&serde_json::Value>, key: &str) -> Option<i64> {
    let value = config.and_then(|item| item.get(key))?;
    if let Some(number) = value.as_i64() {
        return Some(number);
    }
    if let Some(number) = value.as_u64() {
        return i64::try_from(number).ok();
    }
    value.as_str().and_then(|raw| raw.trim().parse::<i64>().ok())
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
    Ok(ProviderInstance {
        id: Uuid::parse_str(row.try_get::<String, _>("id")?.as_str())
            .map_err(|e| ProviderError::Database(format!("invalid uuid: {e}")))?,
        preset_slug: row.try_get("preset_slug")?,
        name: row.try_get("name")?,
        base_url: row.try_get("base_url")?,
        is_enabled: row.try_get::<i64, _>("is_enabled")? != 0,
        is_local: row.try_get::<i64, _>("is_local")? != 0,
        credentials_ref: row.try_get("credentials_ref")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_model(row: &SqliteRow) -> Result<ProviderModel, ProviderError> {
    let caps_str: String = row.try_get("capabilities")?;
    Ok(ProviderModel {
        id: Uuid::parse_str(row.try_get::<String, _>("id")?.as_str())
            .map_err(|e| ProviderError::Database(format!("invalid model uuid: {e}")))?,
        instance_id: Uuid::parse_str(row.try_get::<String, _>("instance_id")?.as_str())
            .map_err(|e| ProviderError::Database(format!("invalid instance uuid: {e}")))?,
        model_id: row.try_get("model_id")?,
        display_name: row.try_get("display_name")?,
        capabilities: serde_json::from_str(&caps_str).unwrap_or_default(),
        is_active: row.try_get::<i64, _>("is_active")? != 0,
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

fn now_rfc3339() -> Result<String, ProviderError> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| ProviderError::Database(e.to_string()))
}
