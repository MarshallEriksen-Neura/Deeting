use sqlx::sqlite::SqlitePool;
use uuid::Uuid;
use crate::modules::providers::error::ProviderError;
use crate::modules::providers::types::{
    ProviderPreset, ProviderInstance, ProviderModel, ProviderCredential, CreateInstanceRequest
};

pub struct ProviderStore {
    pool: SqlitePool,
}

impl ProviderStore {
    pub async fn new(database_url: &str) -> Result<Self, ProviderError> {
        let pool = SqlitePool::connect(database_url).await?;
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
        let rows = sqlx::query_as!(
            ProviderInstance,
            "SELECT id, preset_slug, name, base_url, is_local, credentials_ref, created_at FROM provider_instances"
        ).fetch_all(&self.pool).await?;
        Ok(rows)
    }

    pub async fn create_instance(&self, payload: CreateInstanceRequest) -> Result<ProviderInstance, ProviderError> {
        let instance_id = Uuid::new_v4();
        let credential_id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        let credentials_ref = format!("db:{}", credential_id);

        let mut tx = self.pool.begin().await?;

        // 插入实例
        sqlx::query!(
            "INSERT INTO provider_instances (id, preset_slug, name, base_url, is_local, credentials_ref, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            instance_id, payload.preset_slug, payload.name, payload.base_url, payload.is_local.unwrap_or(false), credentials_ref, now
        ).execute(&mut *tx).await?;

        // 插入凭证 (默认 alias 为 'default')
        sqlx::query!(
            "INSERT INTO provider_credentials (id, instance_id, alias, secret_key, created_at)
             VALUES (?, ?, ?, ?, ?)",
            credential_id, instance_id, "default", payload.secret_key, now
        ).execute(&mut *tx).await?;

        tx.commit().await?;

        Ok(ProviderInstance {
            id: instance_id,
            preset_slug: payload.preset_slug,
            name: payload.name,
            base_url: payload.base_url,
            is_local: payload.is_local.unwrap_or(false),
            credentials_ref,
            created_at: now,
        })
    }

    pub async fn list_models(&self, instance_id: &Uuid) -> Result<Vec<ProviderModel>, ProviderError> {
        let rows = sqlx::query!(
            "SELECT id, instance_id, model_id, display_name, capabilities, is_active FROM provider_models WHERE instance_id = ?",
            instance_id
        ).fetch_all(&self.pool).await?;

        let mut models = Vec::new();
        for row in rows {
            models.push(ProviderModel {
                id: Uuid::parse_str(&row.id).map_err(|_| ProviderError::Database("Invalid UUID in DB".into()))?,
                instance_id: Uuid::parse_str(&row.instance_id).map_err(|_| ProviderError::Database("Invalid UUID in DB".into()))?,
                model_id: row.model_id,
                display_name: row.display_name,
                capabilities: serde_json::from_str(&row.capabilities).unwrap_or_default(),
                is_active: row.is_active != 0,
            });
        }
        Ok(models)
    }
    
    pub async fn sync_models(&self, instance_id: &Uuid, models: Vec<ProviderModel>) -> Result<(), ProviderError> {
        let mut tx = self.pool.begin().await?;
        
        // 简单处理：清空再重新插入（或者可以做 upsert）
        sqlx::query!("DELETE FROM provider_models WHERE instance_id = ?", instance_id)
            .execute(&mut *tx).await?;
            
        for model in models {
            let caps = serde_json::to_string(&model.capabilities).unwrap_or_else(|_| "[]".into());
            sqlx::query!(
                "INSERT INTO provider_models (id, instance_id, model_id, display_name, capabilities, is_active)
                 VALUES (?, ?, ?, ?, ?, ?)",
                model.id, instance_id, model.model_id, model.display_name, caps, model.is_active
            ).execute(&mut *tx).await?;
        }
        
        tx.commit().await?;
        Ok(())
    }
}
