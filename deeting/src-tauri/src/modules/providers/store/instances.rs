use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::utils::{
    now_rfc3339, parse_json_object_text, row_to_instance,
};
use crate::modules::providers::store::ProviderStore;
use crate::modules::providers::types::{
    CreateInstanceRequest, ProviderInstance, UpdateInstanceRequest,
};
use serde_json::{json, Map, Value};
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

        let meta = build_create_instance_meta(&payload).to_string();
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
                is_enabled, is_local, credential_source, credentials_ref, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&instance_id)
        .bind(&payload.preset_slug)
        .bind(&payload.name)
        .bind(&payload.base_url)
        .bind(&payload.description)
        .bind(&payload.icon)
        .bind(payload.priority.unwrap_or(0))
        .bind(meta)
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
        let existing_meta = sqlx::query("SELECT meta FROM provider_instances WHERE id = ?")
            .bind(instance_id)
            .fetch_optional(&mut *tx)
            .await?
            .and_then(|row| row.try_get::<Option<String>, _>("meta").ok())
            .map(parse_json_object_text)
            .unwrap_or_else(|| json!({}));
        let merged_meta = build_update_instance_meta(&payload, existing_meta);

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

        sqlx::query("UPDATE provider_instances SET meta = ?, updated_at = ? WHERE id = ?")
            .bind(merged_meta.to_string())
            .bind(&now)
            .bind(instance_id)
            .execute(&mut *tx)
            .await?;

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
            "SELECT i.base_url, i.meta,
                    COALESCE(i.credential_source, 'local') AS credential_source,
                    p.provider AS preset_provider
             FROM provider_instances i
             LEFT JOIN provider_presets p ON p.slug = i.preset_slug
             WHERE i.id = ?",
        )
        .bind(instance_id)
        .fetch_optional(&self.pool)
        .await?;

        let (base_url, meta, credential_source, preset_provider) = match instance_row {
            Some(row) => (
                row.try_get::<String, _>("base_url")?,
                parse_json_object_text(row.try_get::<Option<String>, _>("meta")?),
                row.try_get::<String, _>("credential_source")
                    .unwrap_or_else(|_| "local".to_string()),
                row.try_get::<Option<String>, _>("preset_provider")?,
            ),
            None => return Ok(None),
        };
        let protocol = resolve_instance_protocol(
            meta.get("protocol").and_then(|value| value.as_str()),
            preset_provider.as_deref(),
            &base_url,
        );
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

    pub(crate) async fn normalize_provider_instance_protocol_data(
        &self,
    ) -> Result<(), ProviderError> {
        let rows = sqlx::query(
            "SELECT i.id, i.base_url, i.meta, p.provider AS preset_provider
             FROM provider_instances i
             LEFT JOIN provider_presets p ON p.slug = i.preset_slug",
        )
        .fetch_all(&self.pool)
        .await?;

        if rows.is_empty() {
            return Ok(());
        }

        let now = now_rfc3339()?;
        let mut tx = self.pool.begin().await?;

        for row in rows {
            let instance_id: String = row.try_get("id")?;
            let base_url: String = row.try_get("base_url")?;
            let preset_provider = row.try_get::<Option<String>, _>("preset_provider")?;
            let mut meta = parse_json_object_text(row.try_get::<Option<String>, _>("meta")?);
            let stored_protocol = meta.get("protocol").and_then(|value| value.as_str());
            let repaired_protocol = repair_instance_protocol_for_persistence(
                stored_protocol,
                preset_provider.as_deref(),
                &base_url,
            );

            if let Some(protocol) = repaired_protocol {
                let current_protocol = normalize_protocol_text(stored_protocol);
                if current_protocol.as_deref() != Some(protocol.as_str()) {
                    if let Some(meta_object) = meta.as_object_mut() {
                        meta_object.insert("protocol".to_string(), Value::String(protocol));
                    }
                    sqlx::query(
                        "UPDATE provider_instances SET meta = ?, updated_at = ? WHERE id = ?",
                    )
                    .bind(meta.to_string())
                    .bind(&now)
                    .bind(&instance_id)
                    .execute(&mut *tx)
                    .await?;
                }
            }
        }

        tx.commit().await?;
        Ok(())
    }
}

fn normalize_protocol_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn resolve_instance_protocol(
    stored_protocol: Option<&str>,
    preset_protocol: Option<&str>,
    base_url: &str,
) -> Option<String> {
    let stored_protocol = normalize_protocol_text(stored_protocol);
    let preset_protocol = normalize_protocol_text(preset_protocol);

    match stored_protocol {
        Some(value)
            if value.eq_ignore_ascii_case("openai")
                && preset_protocol
                    .as_deref()
                    .map(is_anthropic_protocol)
                    .unwrap_or(false)
                && is_official_anthropic_base_url(base_url) =>
        {
            preset_protocol.clone()
        }
        Some(value) => Some(value),
        None => preset_protocol,
    }
}

fn repair_instance_protocol_for_persistence(
    stored_protocol: Option<&str>,
    preset_protocol: Option<&str>,
    base_url: &str,
) -> Option<String> {
    let preset_protocol = normalize_protocol_text(preset_protocol)
        .filter(|value| is_anthropic_protocol(value.as_str()))?;

    match normalize_protocol_text(stored_protocol) {
        None => Some(preset_protocol),
        Some(value)
            if value.eq_ignore_ascii_case("openai") && is_official_anthropic_base_url(base_url) =>
        {
            Some(preset_protocol)
        }
        _ => None,
    }
}

fn is_anthropic_protocol(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized.contains("anthropic") || normalized.contains("claude")
}

fn is_official_anthropic_base_url(value: &str) -> bool {
    value.trim().to_ascii_lowercase().contains("anthropic.com")
}

fn build_update_instance_meta(update_payload: &UpdateInstanceRequest, existing: Value) -> Value {
    let mut meta = existing.as_object().cloned().unwrap_or_default();

    let protocol = update_payload
        .protocol
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    if let Some(value) = protocol {
        meta.insert("protocol".to_string(), Value::String(value));
    }

    if let Some(value) = update_payload.auto_append_v1 {
        meta.insert("auto_append_v1".to_string(), Value::Bool(value));
    }

    if update_payload.base_url.is_some()
        || update_payload.protocol.is_some()
        || update_payload.chat_transport_path.is_some()
    {
        meta.remove("chat_transport_path");
    }

    let model_prefix = update_payload
        .model_prefix
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    if let Some(value) = model_prefix {
        meta.insert("model_prefix".to_string(), Value::String(value));
    }

    for (key, value) in [
        (
            "chat_transport_path",
            update_payload.chat_transport_path.as_deref(),
        ),
        ("resource_name", update_payload.resource_name.as_deref()),
        ("deployment_name", update_payload.deployment_name.as_deref()),
        ("api_version", update_payload.api_version.as_deref()),
        ("project_id", update_payload.project_id.as_deref()),
        ("region", update_payload.region.as_deref()),
        ("app_id", update_payload.app_id.as_deref()),
        ("resource_id", update_payload.resource_id.as_deref()),
    ] {
        if let Some(trimmed) = value.map(str::trim).filter(|item| !item.is_empty()) {
            meta.insert(key.to_string(), Value::String(trimmed.to_string()));
        }
    }

    Value::Object(meta)
}

fn build_create_instance_meta(payload: &CreateInstanceRequest) -> Value {
    let mut meta = Map::new();

    if let Some(value) = payload
        .protocol
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        meta.insert("protocol".to_string(), Value::String(value.to_string()));
    }
    if let Some(value) = payload.auto_append_v1 {
        meta.insert("auto_append_v1".to_string(), Value::Bool(value));
    }
    if let Some(value) = payload
        .model_prefix
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        meta.insert("model_prefix".to_string(), Value::String(value.to_string()));
    }

    for (key, value) in [
        (
            "chat_transport_path",
            payload.chat_transport_path.as_deref(),
        ),
        ("resource_name", payload.resource_name.as_deref()),
        ("deployment_name", payload.deployment_name.as_deref()),
        ("api_version", payload.api_version.as_deref()),
        ("project_id", payload.project_id.as_deref()),
        ("region", payload.region.as_deref()),
        ("app_id", payload.app_id.as_deref()),
        ("resource_id", payload.resource_id.as_deref()),
    ] {
        if let Some(trimmed) = value.map(str::trim).filter(|item| !item.is_empty()) {
            meta.insert(key.to_string(), Value::String(trimmed.to_string()));
        }
    }

    Value::Object(meta)
}
