use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::utils::{now_rfc3339, parse_json_object_text, row_to_instance};
use crate::modules::providers::store::ProviderStore;
use crate::modules::providers::types::{
    CreateInstanceRequest, ProviderInstance, UpdateInstanceRequest,
};
use sqlx::Row;
use uuid::Uuid;

impl ProviderStore {
    pub async fn list_instances(&self) -> Result<Vec<ProviderInstance>, ProviderError> {
        let rows =
            sqlx::query("SELECT * FROM provider_instances ORDER BY priority DESC, created_at DESC")
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
        let instance_id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;
        let credentials_ref = Uuid::new_v4().to_string();

        let mut tx = self.pool.begin().await?;

        // Try to inherit template_engine and response_transform from preset if available
        let preset_row = sqlx::query(
            "SELECT template_engine, response_transform FROM provider_presets WHERE slug = ?",
        )
        .bind(&payload.preset_slug)
        .fetch_optional(&mut *tx)
        .await?;

        let (template_engine, response_transform) = match preset_row {
            Some(row) => (
                row.try_get::<Option<String>, _>("template_engine")?,
                row.try_get::<Option<String>, _>("response_transform")?,
            ),
            None => (None, None),
        };

        // meta and is_enabled are missing in CreateInstanceRequest, use defaults
        let meta = "{}";
        let is_enabled = true;

        let credential_source = payload
            .credential_source
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("local");
        sqlx::query(
            "INSERT INTO provider_instances (
                id, preset_slug, name, base_url, description, icon, priority, meta,
                template_engine, response_transform,
                is_enabled, is_local, credential_source, credentials_ref, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&instance_id)
        .bind(&payload.preset_slug)
        .bind(&payload.name)
        .bind(&payload.base_url)
        .bind(&payload.description)
        .bind(&payload.icon)
        .bind(payload.priority.unwrap_or(0))
        .bind(meta)
        .bind(&template_engine)
        .bind(&response_transform)
        .bind(is_enabled)
        .bind(payload.is_local.unwrap_or(false))
        .bind(credential_source)
        .bind(&credentials_ref)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        if let Some(secret_key) = payload.secret_key {
            let credential_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO provider_credentials (
                    id, instance_id, alias, secret_key, weight, priority, is_active, created_at
                ) VALUES (?, ?, ?, '', 100, 0, 1, ?)",
            )
            .bind(&credential_id)
            .bind(&instance_id)
            .bind("default")
            .bind(&now)
            .execute(&mut *tx)
            .await?;

            self.persist_secret_for_credential(&mut tx, &credential_id, &secret_key)
                .await?;
        }

        tx.commit().await?;

        self.get_instance(&instance_id)
            .await?
            .ok_or_else(|| ProviderError::NotFound("Instance not found after creation".into()))
    }

    pub async fn update_instance(
        &self,
        instance_id: &str,
        payload: UpdateInstanceRequest,
    ) -> Result<ProviderInstance, ProviderError> {
        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        if let Some(name) = payload.name {
            sqlx::query("UPDATE provider_instances SET name = ?, updated_at = ? WHERE id = ?")
                .bind(name)
                .bind(&now)
                .bind(instance_id)
                .execute(&mut *tx)
                .await?;
        }

        if let Some(base_url) = payload.base_url {
            sqlx::query("UPDATE provider_instances SET base_url = ?, updated_at = ? WHERE id = ?")
                .bind(base_url)
                .bind(&now)
                .bind(instance_id)
                .execute(&mut *tx)
                .await?;
        }

        if let Some(description) = payload.description {
            sqlx::query(
                "UPDATE provider_instances SET description = ?, updated_at = ? WHERE id = ?",
            )
            .bind(description)
            .bind(&now)
            .bind(instance_id)
            .execute(&mut *tx)
            .await?;
        }

        if let Some(icon) = payload.icon {
            sqlx::query("UPDATE provider_instances SET icon = ?, updated_at = ? WHERE id = ?")
                .bind(icon)
                .bind(&now)
                .bind(instance_id)
                .execute(&mut *tx)
                .await?;
        }

        if let Some(priority) = payload.priority {
            sqlx::query("UPDATE provider_instances SET priority = ?, updated_at = ? WHERE id = ?")
                .bind(priority)
                .bind(&now)
                .bind(instance_id)
                .execute(&mut *tx)
                .await?;
        }

        if let Some(is_enabled) = payload.is_enabled {
            sqlx::query(
                "UPDATE provider_instances SET is_enabled = ?, updated_at = ? WHERE id = ?",
            )
            .bind(is_enabled)
            .bind(&now)
            .bind(instance_id)
            .execute(&mut *tx)
            .await?;
        }

        if let Some(cs) = payload.credential_source {
            let normalized = cs.trim();
            let value = if normalized.is_empty() {
                "local"
            } else {
                normalized
            };
            sqlx::query(
                "UPDATE provider_instances SET credential_source = ?, updated_at = ? WHERE id = ?",
            )
            .bind(value)
            .bind(&now)
            .bind(instance_id)
            .execute(&mut *tx)
            .await?;
        }

        // meta is missing in UpdateInstanceRequest

        if let Some(secret_key) = payload.secret_key {
            let row =
                sqlx::query("SELECT id FROM provider_credentials WHERE instance_id = ? LIMIT 1")
                    .bind(instance_id)
                    .fetch_optional(&mut *tx)
                    .await?;

            if let Some(row) = row {
                let credential_id: String = row.try_get("id")?;
                self.persist_secret_for_credential(&mut tx, &credential_id, &secret_key)
                    .await?;
            } else {
                let credential_id = Uuid::new_v4().to_string();
                sqlx::query(
                    "INSERT INTO provider_credentials (
                        id, instance_id, alias, secret_key, weight, priority, is_active, created_at
                    ) VALUES (?, ?, ?, '', 100, 0, 1, ?)",
                )
                .bind(&credential_id)
                .bind(instance_id)
                .bind("default")
                .bind(&now)
                .execute(&mut *tx)
                .await?;

                self.persist_secret_for_credential(&mut tx, &credential_id, &secret_key)
                    .await?;
            }
        }

        tx.commit().await?;

        self.get_instance(instance_id).await?.ok_or_else(|| {
            ProviderError::NotFound(format!("Instance {instance_id} not found after update"))
        })
    }

    pub async fn delete_instance(&self, instance_id: &str) -> Result<(), ProviderError> {
        let creds = sqlx::query("SELECT id FROM provider_credentials WHERE instance_id = ?")
            .bind(instance_id)
            .fetch_all(&self.pool)
            .await?;

        for row in creds {
            let cred_id: String = row.try_get("id")?;
            let _ = self.delete_secret_in_keychain(&cred_id);
        }

        sqlx::query("DELETE FROM provider_instances WHERE id = ?")
            .bind(instance_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_instance(&self, id: &str) -> Result<Option<ProviderInstance>, ProviderError> {
        let row = sqlx::query("SELECT * FROM provider_instances WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(row) => Ok(Some(row_to_instance(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn get_instance_connection(
        &self,
        instance_id: &str,
    ) -> Result<Option<crate::modules::providers::store::ProviderConnection>, ProviderError> {
        let instance_row = sqlx::query(
            "SELECT base_url, meta, COALESCE(credential_source, 'local') AS credential_source FROM provider_instances WHERE id = ?",
        )
        .bind(instance_id)
        .fetch_optional(&self.pool)
        .await?;

        let (base_url, meta, credential_source) = match instance_row {
            Some(row) => (
                row.try_get::<String, _>("base_url")?,
                parse_json_object_text(row.try_get::<Option<String>, _>("meta")?),
                row.try_get::<String, _>("credential_source")
                    .unwrap_or_else(|_| "local".to_string()),
            ),
            None => return Ok(None),
        };
        let protocol = meta
            .get("protocol")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let auto_append_v1 = meta.get("auto_append_v1").and_then(|value| match value {
            serde_json::Value::Bool(item) => Some(*item),
            serde_json::Value::String(item) => match item.trim().to_ascii_lowercase().as_str() {
                "true" | "1" | "yes" | "on" => Some(true),
                "false" | "0" | "no" | "off" => Some(false),
                _ => None,
            },
            _ => None,
        });

        if credential_source.eq_ignore_ascii_case("platform") {
            return Ok(Some(crate::modules::providers::store::ProviderConnection {
                base_url: String::new(),
                secret_key: None,
                protocol,
                auto_append_v1,
                credential_source: Some("platform".to_string()),
            }));
        }

        let cred_row = sqlx::query(
            "SELECT id, secret_key, secret_ciphertext, secret_key_version FROM provider_credentials
             WHERE instance_id = ? AND is_active = 1
             ORDER BY priority DESC, weight DESC
             LIMIT 1",
        )
        .bind(instance_id)
        .fetch_optional(&self.pool)
        .await?;

        let secret_key = match cred_row {
            Some(row) => self.resolve_secret_from_row(&row)?,
            None => None,
        };

        Ok(Some(crate::modules::providers::store::ProviderConnection {
            base_url,
            secret_key,
            protocol,
            auto_append_v1,
            credential_source: None,
        }))
    }
}
