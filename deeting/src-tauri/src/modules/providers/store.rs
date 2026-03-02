use std::str::FromStr;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use uuid::Uuid;
use crate::modules::providers::error::ProviderError;
use crate::modules::providers::types::{
    ProviderInstance, ProviderModel, CreateInstanceRequest
};

pub struct ProviderStore {
    pool: SqlitePool,
}

impl ProviderStore {
    pub async fn new(database_url: &str) -> Result<Self, ProviderError> {
        let options = SqliteConnectOptions::from_str(database_url)
            .map_err(|err| ProviderError::Database(err.to_string()))?
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new().connect_with(options).await?;
        Ok(Self { pool })
    }

    pub async fn init(&self) -> Result<(), ProviderError> {
        // 1. 预设表
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS provider_presets (
                slug TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                base_url TEXT NOT NULL,
                icon TEXT,
                is_active BOOLEAN DEFAULT 1
            )"
        ).execute(&self.pool).await?;

        // 2. 实例表
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS provider_instances (
                id TEXT PRIMARY KEY,
                preset_slug TEXT NOT NULL,
                name TEXT NOT NULL,
                base_url TEXT NOT NULL,
                is_local BOOLEAN DEFAULT 0,
                credentials_ref TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"
        ).execute(&self.pool).await?;

        // 3. 凭证表
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS provider_credentials (
                id TEXT PRIMARY KEY,
                instance_id TEXT NOT NULL REFERENCES provider_instances(id) ON DELETE CASCADE,
                alias TEXT NOT NULL,
                secret_key TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"
        ).execute(&self.pool).await?;

        // 4. 模型表
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS provider_models (
                id TEXT PRIMARY KEY,
                instance_id TEXT NOT NULL REFERENCES provider_instances(id) ON DELETE CASCADE,
                model_id TEXT NOT NULL,
                display_name TEXT,
                capabilities TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1
            )"
        ).execute(&self.pool).await?;

        Ok(())
    }

    // --- 业务操作 ---

    pub async fn list_instances(&self) -> Result<Vec<ProviderInstance>, ProviderError> {
        let rows = sqlx::query(
            "SELECT id, preset_slug, name, base_url, is_local, credentials_ref, created_at FROM provider_instances"
        ).fetch_all(&self.pool).await?;
        
        let mut instances = Vec::new();
        for row in rows {
            instances.push(ProviderInstance {
                id: Uuid::parse_str(row.try_get::<String, _>("id")?.as_str())
                    .map_err(|e| ProviderError::Database(format!("Invalid UUID: {}", e)))?,
                preset_slug: row.try_get("preset_slug")?,
                name: row.try_get("name")?,
                base_url: row.try_get("base_url")?,
                is_local: row.try_get::<i64, _>("is_local")? != 0,
                credentials_ref: row.try_get("credentials_ref")?,
                created_at: row.try_get("created_at")?,
            });
        }
        Ok(instances)
    }

    pub async fn create_instance(&self, payload: CreateInstanceRequest) -> Result<ProviderInstance, ProviderError> {
        let instance_id = Uuid::new_v4();
        let credential_id = Uuid::new_v4();
        let now = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|e| ProviderError::Database(e.to_string()))?;
        let credentials_ref = format!("db:{}", credential_id);
        let is_local = payload.is_local.unwrap_or(false);

        let mut tx = self.pool.begin().await?;

        // 插入实例
        sqlx::query(
            "INSERT INTO provider_instances (id, preset_slug, name, base_url, is_local, credentials_ref, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(instance_id.to_string())
        .bind(&payload.preset_slug)
        .bind(&payload.name)
        .bind(&payload.base_url)
        .bind(if is_local { 1 } else { 0 })
        .bind(&credentials_ref)
        .bind(&now)
        .execute(&mut *tx).await?;

        // 插入凭证 (默认 alias 为 'default')
        sqlx::query(
            "INSERT INTO provider_credentials (id, instance_id, alias, secret_key, created_at)
             VALUES (?, ?, ?, ?, ?)"
        )
        .bind(credential_id.to_string())
        .bind(instance_id.to_string())
        .bind("default")
        .bind(&payload.secret_key)
        .bind(&now)
        .execute(&mut *tx).await?;

        tx.commit().await?;

        Ok(ProviderInstance {
            id: instance_id,
            preset_slug: payload.preset_slug,
            name: payload.name,
            base_url: payload.base_url,
            is_local,
            credentials_ref,
            created_at: now,
        })
    }

    pub async fn list_models(&self, instance_id: &Uuid) -> Result<Vec<ProviderModel>, ProviderError> {
        let rows = sqlx::query(
            "SELECT id, instance_id, model_id, display_name, capabilities, is_active FROM provider_models WHERE instance_id = ?"
        )
        .bind(instance_id.to_string())
        .fetch_all(&self.pool).await?;

        let mut models = Vec::new();
        for row in rows {
            let caps_str: String = row.try_get("capabilities")?;
            models.push(ProviderModel {
                id: Uuid::parse_str(row.try_get::<String, _>("id")?.as_str())
                    .map_err(|_| ProviderError::Database("Invalid UUID in DB".into()))?,
                instance_id: Uuid::parse_str(row.try_get::<String, _>("instance_id")?.as_str())
                    .map_err(|_| ProviderError::Database("Invalid UUID in DB".into()))?,
                model_id: row.try_get("model_id")?,
                display_name: row.try_get("display_name")?,
                capabilities: serde_json::from_str(&caps_str).unwrap_or_default(),
                is_active: row.try_get::<i64, _>("is_active")? != 0,
            });
        }
        Ok(models)
    }
    
    pub async fn sync_models(&self, instance_id: &Uuid, models: Vec<ProviderModel>) -> Result<(), ProviderError> {
        let mut tx = self.pool.begin().await?;

        // 简单处理：清空再重新插入（或者可以做 upsert）
        sqlx::query("DELETE FROM provider_models WHERE instance_id = ?")
            .bind(instance_id.to_string())
            .execute(&mut *tx).await?;

        for model in models {
            let caps = serde_json::to_string(&model.capabilities).unwrap_or_else(|_| "[]".into());
            sqlx::query(
                "INSERT INTO provider_models (id, instance_id, model_id, display_name, capabilities, is_active)
                 VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(model.id.to_string())
            .bind(instance_id.to_string())
            .bind(&model.model_id)
            .bind(&model.display_name)
            .bind(&caps)
            .bind(if model.is_active { 1 } else { 0 })
            .execute(&mut *tx).await?;
        }

        tx.commit().await?;
        Ok(())
    }
}
