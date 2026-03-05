use uuid::Uuid;
use crate::modules::providers::error::ProviderError;
use crate::modules::providers::types::{ProviderModel, ProviderModelUpdateRequest};
use crate::modules::providers::store::ProviderStore;
use crate::modules::providers::store::utils::{
    now_rfc3339, row_to_model, normalize_upstream_path, normalize_source
};

impl ProviderStore {
    pub async fn list_models(
        &self,
        instance_id: Option<String>,
        capabilities: Option<Vec<String>>,
    ) -> Result<Vec<ProviderModel>, ProviderError> {
        let mut query = "SELECT * FROM provider_models WHERE 1=1".to_string();
        if instance_id.is_some() {
            query.push_str(" AND instance_id = ?");
        }
        query.push_str(" ORDER BY priority DESC, weight DESC");

        let mut q = sqlx::query(&query);
        if let Some(id) = instance_id {
            q = q.bind(id);
        }

        let rows = q.fetch_all(&self.pool).await?;
        let mut models = Vec::with_capacity(rows.len());
        for row in rows {
            let model = row_to_model(&row)?;
            if let Some(ref caps) = capabilities {
                if caps.iter().all(|c| model.capabilities.contains(c)) {
                    models.push(model);
                }
            } else {
                models.push(model);
            }
        }
        Ok(models)
    }

    pub async fn list_active_models(&self) -> Result<Vec<ProviderModel>, ProviderError> {
        let rows = sqlx::query("SELECT * FROM provider_models WHERE is_active = 1 ORDER BY priority DESC, weight DESC")
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
        instance_id: &str,
        models: Vec<ProviderModel>,
    ) -> Result<(), ProviderError> {
        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        // Mark existing as inactive first for this instance
        sqlx::query("UPDATE provider_models SET is_active = 0 WHERE instance_id = ?")
            .bind(instance_id)
            .execute(&mut *tx)
            .await?;

        for model in models {
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO provider_models (
                    id, instance_id, capabilities, model_id, unified_model_id, display_name,
                    upstream_path, pricing_config, limit_config, tokenizer_config,
                    routing_config, config_override, source, extra_meta, weight, priority,
                    is_active, synced_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                ON CONFLICT(instance_id, model_id, upstream_path) DO UPDATE SET
                    capabilities = excluded.capabilities,
                    unified_model_id = COALESCE(excluded.unified_model_id, provider_models.unified_model_id),
                    display_name = COALESCE(excluded.display_name, provider_models.display_name),
                    pricing_config = excluded.pricing_config,
                    limit_config = excluded.limit_config,
                    tokenizer_config = excluded.tokenizer_config,
                    routing_config = excluded.routing_config,
                    config_override = excluded.config_override,
                    source = excluded.source,
                    extra_meta = excluded.extra_meta,
                    is_active = 1,
                    synced_at = excluded.synced_at,
                    updated_at = excluded.updated_at",
            )
            .bind(&id)
            .bind(instance_id)
            .bind(serde_json::to_string(&model.capabilities).unwrap_or_else(|_| "[]".to_string()))
            .bind(&model.model_id)
            .bind(&model.unified_model_id)
            .bind(&model.display_name)
            .bind(&model.upstream_path)
            .bind(serde_json::to_string(&model.pricing_config).unwrap_or_else(|_| "{}".to_string()))
            .bind(serde_json::to_string(&model.limit_config).unwrap_or_else(|_| "{}".to_string()))
            .bind(serde_json::to_string(&model.tokenizer_config).unwrap_or_else(|_| "{}".to_string()))
            .bind(serde_json::to_string(&model.routing_config).unwrap_or_else(|_| "{}".to_string()))
            .bind(serde_json::to_string(&model.config_override).unwrap_or_else(|_| "{}".to_string()))
            .bind(&model.source)
            .bind(serde_json::to_string(&model.extra_meta).unwrap_or_else(|_| "{}".to_string()))
            .bind(model.weight)
            .bind(model.priority)
            .bind(&now)
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn quick_add_models(
        &self,
        instance_id: &str,
        model_ids: Vec<String>,
    ) -> Result<(), ProviderError> {
        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        for model_id in model_ids {
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO provider_models (
                    id, instance_id, capabilities, model_id, display_name,
                    upstream_path, pricing_config, limit_config, tokenizer_config,
                    routing_config, config_override, source, extra_meta, weight, priority,
                    is_active, synced_at, created_at, updated_at
                ) VALUES (?, ?, '[\"chat\"]', ?, ?, 'v1/chat/completions', '{}', '{}', '{}', '{}', '{}', 'manual', '{}', 100, 0, 1, ?, ?, ?)
                ON CONFLICT(instance_id, model_id, upstream_path) DO UPDATE SET
                    is_active = 1,
                    synced_at = excluded.synced_at,
                    updated_at = excluded.updated_at",
            )
            .bind(&id)
            .bind(instance_id)
            .bind(&model_id)
            .bind(&model_id)
            .bind(&now)
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn update_model(
        &self,
        model_id: &Uuid,
        payload: ProviderModelUpdateRequest,
    ) -> Result<ProviderModel, ProviderError> {
        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        if let Some(display_name) = payload.display_name {
            sqlx::query("UPDATE provider_models SET display_name = ?, updated_at = ? WHERE id = ?")
                .bind(display_name)
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(capabilities) = payload.capabilities {
            sqlx::query("UPDATE provider_models SET capabilities = ?, updated_at = ? WHERE id = ?")
                .bind(serde_json::to_string(&capabilities).unwrap_or_else(|_| "[]".to_string()))
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(upstream_path) = payload.upstream_path {
            let normalized = normalize_upstream_path(Some(&upstream_path))
                .unwrap_or_else(|| "v1/chat/completions".to_string());
            sqlx::query("UPDATE provider_models SET upstream_path = ?, updated_at = ? WHERE id = ?")
                .bind(normalized)
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(pricing_config) = payload.pricing_config {
            sqlx::query("UPDATE provider_models SET pricing_config = ?, updated_at = ? WHERE id = ?")
                .bind(pricing_config.to_string())
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(limit_config) = payload.limit_config {
            sqlx::query("UPDATE provider_models SET limit_config = ?, updated_at = ? WHERE id = ?")
                .bind(limit_config.to_string())
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(tokenizer_config) = payload.tokenizer_config {
            sqlx::query("UPDATE provider_models SET tokenizer_config = ?, updated_at = ? WHERE id = ?")
                .bind(tokenizer_config.to_string())
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(routing_config) = payload.routing_config {
            sqlx::query("UPDATE provider_models SET routing_config = ?, updated_at = ? WHERE id = ?")
                .bind(routing_config.to_string())
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(config_override) = payload.config_override {
            sqlx::query("UPDATE provider_models SET config_override = ?, updated_at = ? WHERE id = ?")
                .bind(config_override.to_string())
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(source) = payload.source {
            let normalized = normalize_source(Some(&source));
            sqlx::query("UPDATE provider_models SET source = ?, updated_at = ? WHERE id = ?")
                .bind(normalized)
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(extra_meta) = payload.extra_meta {
            sqlx::query("UPDATE provider_models SET extra_meta = ?, updated_at = ? WHERE id = ?")
                .bind(extra_meta.to_string())
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(weight) = payload.weight {
            sqlx::query("UPDATE provider_models SET weight = ?, updated_at = ? WHERE id = ?")
                .bind(weight)
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(priority) = payload.priority {
            sqlx::query("UPDATE provider_models SET priority = ?, updated_at = ? WHERE id = ?")
                .bind(priority)
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(is_active) = payload.is_active {
            sqlx::query("UPDATE provider_models SET is_active = ?, updated_at = ? WHERE id = ?")
                .bind(is_active)
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;

        self.get_model(model_id)
            .await?
            .ok_or_else(|| ProviderError::NotFound(format!("Model {model_id} not found after update")))
    }

    pub async fn get_model(&self, model_id: &Uuid) -> Result<Option<ProviderModel>, ProviderError> {
        let row = sqlx::query("SELECT * FROM provider_models WHERE id = ?")
            .bind(model_id.to_string())
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(row) => Ok(Some(row_to_model(&row)?)),
            None => Ok(None),
        }
    }
}
