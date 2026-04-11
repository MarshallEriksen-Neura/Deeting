use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::utils::{
    normalize_source, normalize_upstream_path, now_rfc3339, parse_json_object_text, row_to_model,
};
use crate::modules::providers::store::{
    ProviderStore, CHAT_CAPABILITY, CHAT_UPSTREAM_PATH, EMBEDDING_CAPABILITY,
    EMBEDDING_UPSTREAM_PATH, IMAGE_GENERATION_CAPABILITY, IMAGE_GENERATION_UPSTREAM_PATH,
    SPEECH_TO_TEXT_CAPABILITY, SPEECH_TO_TEXT_UPSTREAM_PATH, TEXT_TO_SPEECH_CAPABILITY,
    TEXT_TO_SPEECH_UPSTREAM_PATH, VIDEO_GENERATION_CAPABILITY, VIDEO_GENERATION_UPSTREAM_PATH,
};
use crate::modules::providers::types::{ProviderModel, ProviderModelUpdateRequest};
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

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
        let rows = sqlx::query(
            "SELECT * FROM provider_models WHERE is_active = 1 ORDER BY priority DESC, weight DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut models = Vec::with_capacity(rows.len());
        for row in rows {
            models.push(row_to_model(&row)?);
        }
        Ok(models)
    }

    pub async fn normalize_model_capability_data(&self) -> Result<(), ProviderError> {
        let rows = sqlx::query(
            "SELECT id, model_id, capabilities, routing_config, extra_meta FROM provider_models",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut tx = self.begin_write().await?;
        for row in rows {
            let id: String = row.try_get("id")?;
            let model_id: String = row.try_get("model_id")?;
            let caps_text: String = row.try_get("capabilities")?;
            let routing_config =
                parse_json_object_text(row.try_get::<Option<String>, _>("routing_config")?);
            let extra_meta =
                parse_json_object_text(row.try_get::<Option<String>, _>("extra_meta")?);

            let mut merged_caps: Vec<String> =
                serde_json::from_str::<Vec<String>>(&caps_text).unwrap_or_default();
            if let Some(routing_caps) = routing_config
                .get("capabilities")
                .and_then(|value| value.as_array())
            {
                merged_caps.extend(
                    routing_caps
                        .iter()
                        .filter_map(|value| value.as_str().map(|item| item.to_string())),
                );
            }
            if let Some(upstream_caps) = extra_meta
                .get("upstream_capabilities")
                .and_then(|value| value.as_array())
            {
                merged_caps.extend(
                    upstream_caps
                        .iter()
                        .filter_map(|value| value.as_str().map(|item| item.to_string())),
                );
            }

            let normalized =
                normalize_capabilities(merged_caps.iter().map(|item| item.as_str()), None);
            let final_caps = if normalized.is_empty() {
                guess_capabilities(&model_id)
            } else {
                normalized
            };

            sqlx::query("UPDATE provider_models SET capabilities = ? WHERE id = ?")
                .bind(serde_json::to_string(&final_caps).unwrap_or_else(|_| "[]".to_string()))
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn sync_models(
        &self,
        instance_id: &str,
        models: Vec<ProviderModel>,
    ) -> Result<(), ProviderError> {
        let now = now_rfc3339()?;
        let mut tx = self.begin_write().await?;

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
        forced_capability: Option<&str>,
    ) -> Result<(), ProviderError> {
        let now = now_rfc3339()?;
        let preferred_chat_upstream_path = self
            .preferred_upstream_path_for_instance_capability(instance_id, CHAT_CAPABILITY)
            .await?;
        let mut tx = self.begin_write().await?;
        let normalized_forced_capability = normalize_capability(forced_capability);

        for model_id in model_ids {
            let capabilities = normalized_forced_capability
                .clone()
                .map(|capability| vec![capability])
                .unwrap_or_else(|| guess_capabilities(&model_id));
            let primary_capability = capabilities
                .first()
                .map(String::as_str)
                .unwrap_or(CHAT_CAPABILITY);
            let upstream_path = if primary_capability == CHAT_CAPABILITY {
                preferred_chat_upstream_path
                    .as_deref()
                    .unwrap_or_else(|| upstream_path_for_capability(primary_capability))
            } else {
                upstream_path_for_capability(primary_capability)
            };
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                "UPDATE provider_models
                 SET is_active = 0, updated_at = ?
                 WHERE instance_id = ? AND model_id = ?",
            )
            .bind(&now)
            .bind(instance_id)
            .bind(&model_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO provider_models (
                    id, instance_id, capabilities, model_id, display_name,
                    upstream_path, pricing_config, limit_config, tokenizer_config,
                    routing_config, config_override, source, extra_meta, weight, priority,
                    is_active, synced_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, '{}', '{}', '{}', '{}', '{}', 'manual', '{}', 100, 0, 1, ?, ?, ?)
                ON CONFLICT(instance_id, model_id, upstream_path) DO UPDATE SET
                    capabilities = excluded.capabilities,
                    is_active = 1,
                    synced_at = excluded.synced_at,
                    updated_at = excluded.updated_at",
            )
            .bind(&id)
            .bind(instance_id)
            .bind(serde_json::to_string(&capabilities).unwrap_or_else(|_| "[]".to_string()))
            .bind(&model_id)
            .bind(&model_id)
            .bind(upstream_path)
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
        let mut tx = self.begin_write().await?;

        if let Some(display_name) = payload.display_name {
            sqlx::query("UPDATE provider_models SET display_name = ?, updated_at = ? WHERE id = ?")
                .bind(display_name)
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
        }

        if let Some(capabilities) = payload.capabilities {
            if capabilities.is_empty() {
                // Keep existing behavior aligned with cloud: ignore empty capability updates.
            } else {
                let normalized = normalize_capabilities(
                    capabilities.iter().map(|item| item.as_str()),
                    Some(CHAT_CAPABILITY),
                );
                sqlx::query(
                    "UPDATE provider_models SET capabilities = ?, updated_at = ? WHERE id = ?",
                )
                .bind(serde_json::to_string(&normalized).unwrap_or_else(|_| "[]".to_string()))
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
            }
        }

        if let Some(upstream_path) = payload.upstream_path {
            let normalized = normalize_upstream_path(Some(&upstream_path))
                .unwrap_or_else(|| CHAT_UPSTREAM_PATH.to_string());
            sqlx::query(
                "UPDATE provider_models SET upstream_path = ?, updated_at = ? WHERE id = ?",
            )
            .bind(normalized)
            .bind(&now)
            .bind(model_id.to_string())
            .execute(&mut *tx)
            .await?;
        }

        if let Some(pricing_config) = payload.pricing_config {
            sqlx::query(
                "UPDATE provider_models SET pricing_config = ?, updated_at = ? WHERE id = ?",
            )
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
            sqlx::query(
                "UPDATE provider_models SET tokenizer_config = ?, updated_at = ? WHERE id = ?",
            )
            .bind(tokenizer_config.to_string())
            .bind(&now)
            .bind(model_id.to_string())
            .execute(&mut *tx)
            .await?;
        }

        if let Some(mut routing_config) = payload.routing_config {
            let normalized_from_routing = routing_config
                .get("capabilities")
                .and_then(|value| value.as_array())
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|value| value.as_str().map(|item| item.to_string()))
                        .collect::<Vec<String>>()
                })
                .filter(|values| !values.is_empty())
                .map(|values| {
                    normalize_capabilities(
                        values.iter().map(|item| item.as_str()),
                        Some(CHAT_CAPABILITY),
                    )
                });

            if let Some(normalized_caps) = normalized_from_routing.as_ref() {
                if let Some(object) = routing_config.as_object_mut() {
                    object.insert(
                        "capabilities".to_string(),
                        Value::Array(
                            normalized_caps
                                .iter()
                                .map(|item| Value::String(item.clone()))
                                .collect(),
                        ),
                    );
                }
            }

            sqlx::query(
                "UPDATE provider_models SET routing_config = ?, updated_at = ? WHERE id = ?",
            )
            .bind(routing_config.to_string())
            .bind(&now)
            .bind(model_id.to_string())
            .execute(&mut *tx)
            .await?;

            if let Some(normalized_caps) = normalized_from_routing {
                sqlx::query(
                    "UPDATE provider_models SET capabilities = ?, updated_at = ? WHERE id = ?",
                )
                .bind(serde_json::to_string(&normalized_caps).unwrap_or_else(|_| "[]".to_string()))
                .bind(&now)
                .bind(model_id.to_string())
                .execute(&mut *tx)
                .await?;
            }
        }

        if let Some(config_override) = payload.config_override {
            sqlx::query(
                "UPDATE provider_models SET config_override = ?, updated_at = ? WHERE id = ?",
            )
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

        self.get_model(model_id).await?.ok_or_else(|| {
            ProviderError::NotFound(format!("Model {model_id} not found after update"))
        })
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

impl ProviderStore {
    async fn preferred_upstream_path_for_instance_capability(
        &self,
        instance_id: &str,
        capability: &str,
    ) -> Result<Option<String>, ProviderError> {
        let Some(instance) = self.get_instance(instance_id).await? else {
            return Ok(None);
        };
        if instance.preset_slug.eq_ignore_ascii_case("custom") {
            if capability.eq_ignore_ascii_case(CHAT_CAPABILITY) {
                let path = instance
                    .meta
                    .get("chat_transport_path")
                    .and_then(|path| path.as_str())
                    .map(str::trim)
                    .filter(|path| !path.is_empty());
                return Ok(normalize_upstream_path(path));
            }
            return Ok(None);
        }

        let Some(preset) = self.get_preset(&instance.preset_slug).await? else {
            return Ok(None);
        };

        let Some(path) = preset
            .protocol_profiles
            .get(capability)
            .and_then(|profile| profile.get("transport"))
            .and_then(|transport| transport.get("path"))
            .and_then(|path| path.as_str())
            .map(str::trim)
            .filter(|path| !path.is_empty())
        else {
            return Ok(None);
        };

        Ok(normalize_upstream_path(Some(path)))
    }
}

fn normalize_capability(capability: Option<&str>) -> Option<String> {
    let normalized = capability
        .map(|value| value.trim().to_ascii_lowercase().replace(['-', ' '], "_"))
        .filter(|value| !value.is_empty())?;

    let canonical = match normalized.as_str() {
        "chat" | "chat_completion" | "chat_completions" | "text_generation" | "text"
        | "reasoning" | "code" | "vision" => CHAT_CAPABILITY,
        "embedding" | "embeddings" | "vector" => EMBEDDING_CAPABILITY,
        "image_generation" | "image" | "image_gen" | "text_to_image" => IMAGE_GENERATION_CAPABILITY,
        "text_to_speech" | "tts" | "speech" => TEXT_TO_SPEECH_CAPABILITY,
        "speech_to_text" | "stt" | "audio" | "audio_to_text" | "transcription" => {
            SPEECH_TO_TEXT_CAPABILITY
        }
        "video_generation" | "video" | "video_gen" | "text_to_video" | "t2v" => {
            VIDEO_GENERATION_CAPABILITY
        }
        _ => normalized.as_str(),
    };

    Some(canonical.to_string())
}

fn normalize_capabilities<'a>(
    capabilities: impl IntoIterator<Item = &'a str>,
    default: Option<&str>,
) -> Vec<String> {
    let mut normalized = Vec::new();
    for capability in capabilities {
        let canonical = normalize_capability(Some(capability));
        if let Some(canonical) = canonical {
            if !normalized.contains(&canonical) {
                normalized.push(canonical);
            }
        }
    }
    if !normalized.is_empty() {
        return normalized;
    }
    default
        .and_then(|value| normalize_capability(Some(value)))
        .map(|value| vec![value])
        .unwrap_or_default()
}

fn guess_capabilities(model_id: &str) -> Vec<String> {
    let model_id_lower = model_id.to_ascii_lowercase();
    let model_id_trimmed = model_id_lower.trim();

    let capability = if model_id_trimmed.starts_with("text-embedding")
        || model_id_trimmed.starts_with("embedding")
        || model_id_trimmed.starts_with("ada-embedding")
        || model_id_trimmed.contains("embed")
    {
        EMBEDDING_CAPABILITY
    } else if model_id_trimmed.starts_with("whisper")
        || model_id_trimmed.contains("transcrib")
        || model_id_trimmed.contains("stt")
        || model_id_trimmed.contains("speech-to-text")
    {
        SPEECH_TO_TEXT_CAPABILITY
    } else if model_id_trimmed.starts_with("tts-")
        || model_id_trimmed.contains("tts")
        || model_id_trimmed.contains("text-to-speech")
    {
        TEXT_TO_SPEECH_CAPABILITY
    } else if model_id_trimmed.starts_with("gpt-image")
        || model_id_trimmed.starts_with("dall-e")
        || model_id_trimmed.starts_with("sd")
        || model_id_trimmed.starts_with("flux")
        || model_id_trimmed.starts_with("glm-image")
        || model_id_trimmed.starts_with("qwen-image")
        || model_id_trimmed.contains("dall-e")
        || model_id_trimmed.contains("sdxl")
        || model_id_trimmed.contains("sd")
        || model_id_trimmed.contains("flux")
        || model_id_trimmed.contains("nano-banana")
        || model_id_trimmed.contains("nano_banana")
        || model_id_trimmed.contains("nano banana")
        || model_id_trimmed.contains("banana")
        || model_id_trimmed.contains("image")
        || model_id_trimmed.contains("imagine")
        || model_id_trimmed.contains("pixart")
        || model_id_trimmed.contains("kolors")
        || model_id_trimmed.contains("kandinsky")
    {
        IMAGE_GENERATION_CAPABILITY
    } else if model_id_trimmed.starts_with("doubao-seedance")
        || model_id_trimmed.starts_with("doubao-video")
        || model_id_trimmed.starts_with("kling")
        || model_id_trimmed.starts_with("cogvideox")
        || model_id_trimmed.starts_with("wan-x")
        || model_id_trimmed.starts_with("gen-")
        || model_id_trimmed.contains("seedance")
        || model_id_trimmed.contains("video-gen")
        || model_id_trimmed.contains("runway")
        || model_id_trimmed.contains("kling")
        || model_id_trimmed.contains("cogvideo")
        || model_id_trimmed.contains("wan-x")
        || model_id_trimmed.contains("wan_x")
        || model_id_trimmed.contains("hunyuan-video")
        || model_id_trimmed.contains("video")
    {
        VIDEO_GENERATION_CAPABILITY
    } else {
        CHAT_CAPABILITY
    };

    vec![capability.to_string()]
}

fn upstream_path_for_capability(capability: &str) -> &'static str {
    match capability {
        EMBEDDING_CAPABILITY => EMBEDDING_UPSTREAM_PATH,
        IMAGE_GENERATION_CAPABILITY => IMAGE_GENERATION_UPSTREAM_PATH,
        TEXT_TO_SPEECH_CAPABILITY => TEXT_TO_SPEECH_UPSTREAM_PATH,
        SPEECH_TO_TEXT_CAPABILITY => SPEECH_TO_TEXT_UPSTREAM_PATH,
        VIDEO_GENERATION_CAPABILITY => VIDEO_GENERATION_UPSTREAM_PATH,
        _ => CHAT_UPSTREAM_PATH,
    }
}
