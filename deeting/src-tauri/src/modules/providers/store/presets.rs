use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::utils::parse_json_object_text;
use crate::modules::providers::store::ProviderStore;
use crate::modules::providers::types::ProviderPreset;
use serde_json::{Map, Value, json};
use sqlx::Row;

impl ProviderStore {
    pub async fn backfill_protocol_profiles(&self) -> Result<(), ProviderError> {
        let rows = sqlx::query(
            "SELECT slug, provider, default_headers, default_params, capability_configs, protocol_profiles
             FROM provider_presets",
        )
        .fetch_all(&self.pool)
        .await?;

        for row in rows {
            let slug: String = row.try_get("slug")?;
            let provider: String = row.try_get("provider")?;
            let default_headers = parse_json_object_text(row.try_get("default_headers")?);
            let default_params = parse_json_object_text(row.try_get("default_params")?);
            let capability_configs = parse_json_object_text(row.try_get("capability_configs")?);
            let protocol_profiles = parse_json_object_text(row.try_get("protocol_profiles")?);

            let existing_empty = protocol_profiles
                .as_object()
                .map(|obj| obj.is_empty())
                .unwrap_or(true);
            if !existing_empty {
                continue;
            }

            let Some(configs) = capability_configs.as_object() else {
                continue;
            };
            if configs.is_empty() {
                continue;
            }

            let built = build_protocol_profiles_from_capability_configs(
                provider.as_str(),
                &default_headers,
                &default_params,
                &capability_configs,
            );

            sqlx::query(
                "UPDATE provider_presets
                 SET protocol_schema_version = ?, protocol_profiles = ?
                 WHERE slug = ?",
            )
            .bind("2026-03-07")
            .bind(built.to_string())
            .bind(slug)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    pub async fn list_presets(&self) -> Result<Vec<ProviderPreset>, ProviderError> {
        let rows = sqlx::query(
            "SELECT slug, name, provider, base_url, icon, theme_color, category, url_template,
                    template_engine, response_transform, auth_type, auth_config, default_headers,
                    default_params, capability_configs, protocol_schema_version, protocol_profiles,
                    version, is_active
             FROM provider_presets
             ORDER BY name ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut presets = Vec::with_capacity(rows.len());
        for row in rows {
            let response_transform_text: Option<String> = row.try_get("response_transform")?;
            let auth_config_text: Option<String> = row.try_get("auth_config")?;
            let default_headers_text: Option<String> = row.try_get("default_headers")?;
            let default_params_text: Option<String> = row.try_get("default_params")?;
            let capability_configs_text: Option<String> = row.try_get("capability_configs")?;
            let protocol_profiles_text: Option<String> = row.try_get("protocol_profiles")?;
            presets.push(ProviderPreset {
                slug: row.try_get("slug")?,
                name: row.try_get("name")?,
                provider: row.try_get("provider")?,
                base_url: row.try_get("base_url")?,
                icon: row.try_get("icon")?,
                theme_color: row.try_get("theme_color")?,
                category: row.try_get("category")?,
                url_template: row.try_get("url_template")?,
                template_engine: row.try_get("template_engine")?,
                response_transform: Some(parse_json_object_text(response_transform_text)),
                auth_type: row
                    .try_get::<String, _>("auth_type")
                    .unwrap_or_else(|_| "api_key".to_string()),
                auth_config: parse_json_object_text(auth_config_text),
                default_headers: parse_json_object_text(default_headers_text),
                default_params: parse_json_object_text(default_params_text),
                capability_configs: parse_json_object_text(capability_configs_text),
                protocol_schema_version: row.try_get("protocol_schema_version")?,
                protocol_profiles: parse_json_object_text(protocol_profiles_text),
                version: row.try_get::<i64, _>("version").unwrap_or(1),
                is_active: row.try_get::<i64, _>("is_active")? != 0,
            });
        }
        Ok(presets)
    }

    pub async fn get_preset(&self, slug: &str) -> Result<Option<ProviderPreset>, ProviderError> {
        let row = sqlx::query(
            "SELECT slug, name, provider, base_url, icon, theme_color, category, url_template,
                    template_engine, response_transform, auth_type, auth_config, default_headers,
                    default_params, capability_configs, protocol_schema_version, protocol_profiles,
                    version, is_active
             FROM provider_presets WHERE slug = ?",
        )
        .bind(slug)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let response_transform_text: Option<String> = row.try_get("response_transform")?;
        let auth_config_text: Option<String> = row.try_get("auth_config")?;
        let default_headers_text: Option<String> = row.try_get("default_headers")?;
        let default_params_text: Option<String> = row.try_get("default_params")?;
        let capability_configs_text: Option<String> = row.try_get("capability_configs")?;
        let protocol_profiles_text: Option<String> = row.try_get("protocol_profiles")?;

        Ok(Some(ProviderPreset {
            slug: row.try_get("slug")?,
            name: row.try_get("name")?,
            provider: row.try_get("provider")?,
            base_url: row.try_get("base_url")?,
            icon: row.try_get("icon")?,
            theme_color: row.try_get("theme_color")?,
            category: row.try_get("category")?,
            url_template: row.try_get("url_template")?,
            template_engine: row.try_get("template_engine")?,
            response_transform: Some(parse_json_object_text(response_transform_text)),
            auth_type: row
                .try_get::<String, _>("auth_type")
                .unwrap_or_else(|_| "api_key".to_string()),
            auth_config: parse_json_object_text(auth_config_text),
            default_headers: parse_json_object_text(default_headers_text),
            default_params: parse_json_object_text(default_params_text),
            capability_configs: parse_json_object_text(capability_configs_text),
            protocol_schema_version: row.try_get("protocol_schema_version")?,
            protocol_profiles: parse_json_object_text(protocol_profiles_text),
            version: row.try_get::<i64, _>("version").unwrap_or(1),
            is_active: row.try_get::<i64, _>("is_active")? != 0,
        }))
    }

    pub async fn replace_presets(&self, presets: Vec<ProviderPreset>) -> Result<(), ProviderError> {
        let mut tx = self.pool.begin().await?;

        // Mark all as inactive first
        sqlx::query("UPDATE provider_presets SET is_active = 0")
            .execute(&mut *tx)
            .await?;

        for preset in presets {
            sqlx::query(
                "INSERT INTO provider_presets (
                    slug, name, provider, base_url, icon, theme_color, category, url_template,
                    template_engine, response_transform, auth_type, auth_config, default_headers,
                    default_params, capability_configs, protocol_schema_version, protocol_profiles,
                    version, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(slug) DO UPDATE SET
                    name = excluded.name,
                    provider = excluded.provider,
                    base_url = excluded.base_url,
                    icon = excluded.icon,
                    theme_color = excluded.theme_color,
                    category = excluded.category,
                    url_template = excluded.url_template,
                    template_engine = excluded.template_engine,
                    response_transform = excluded.response_transform,
                    auth_type = excluded.auth_type,
                    auth_config = excluded.auth_config,
                    default_headers = excluded.default_headers,
                    default_params = excluded.default_params,
                    capability_configs = excluded.capability_configs,
                    protocol_schema_version = excluded.protocol_schema_version,
                    protocol_profiles = excluded.protocol_profiles,
                    version = excluded.version,
                    is_active = 1",
            )
            .bind(&preset.slug)
            .bind(&preset.name)
            .bind(&preset.provider)
            .bind(&preset.base_url)
            .bind(&preset.icon)
            .bind(&preset.theme_color)
            .bind(&preset.category)
            .bind(&preset.url_template)
            .bind(&preset.template_engine)
            .bind(preset.response_transform.as_ref().map(|v| v.to_string()))
            .bind(preset.auth_type.trim())
            .bind(preset.auth_config.to_string())
            .bind(preset.default_headers.to_string())
            .bind(preset.default_params.to_string())
            .bind(preset.capability_configs.to_string())
            .bind(&preset.protocol_schema_version)
            .bind(preset.protocol_profiles.to_string())
            .bind(preset.version)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }
}

fn build_protocol_profiles_from_capability_configs(
    provider: &str,
    default_headers: &Value,
    default_params: &Value,
    capability_configs: &Value,
) -> Value {
    let mut profiles = Map::new();
    let Some(configs) = capability_configs.as_object() else {
        return Value::Object(profiles);
    };

    for (capability, config_value) in configs {
        let Some(config) = config_value.as_object() else {
            continue;
        };
        let request_template = config
            .get("request_template")
            .cloned()
            .or_else(|| config.get("body_template").cloned())
            .unwrap_or_else(|| json!({}));
        let family = infer_protocol_family(provider, capability, &request_template);
        let merged_headers = merge_json_objects(
            default_headers,
            config
                .get("default_headers")
                .or_else(|| config.get("headers"))
                .unwrap_or(&json!({})),
        );
        let merged_body = merge_json_objects(
            default_params,
            config
                .get("default_params")
                .or_else(|| config.get("params"))
                .unwrap_or(&json!({})),
        );

        profiles.insert(
            capability.clone(),
            json!({
                "runtime_version": "v2",
                "schema_version": "2026-03-07",
                "profile_id": format!("{provider}:{capability}:{family}"),
                "provider": provider,
                "protocol_family": family,
                "capability": capability,
                "transport": {
                    "method": config.get("http_method").or_else(|| config.get("method")).cloned().unwrap_or_else(|| json!("POST")),
                    "path": default_upstream_path(capability, family),
                    "query_template": {},
                    "header_template": merged_headers,
                },
                "request": {
                    "template_engine": config.get("template_engine").cloned().unwrap_or_else(|| json!("openai_compat")),
                    "request_template": request_template,
                    "request_builder": config.get("request_builder").cloned().unwrap_or(Value::Null),
                },
                "response": {
                    "decoder": {
                        "name": default_decoder(family),
                        "config": {}
                    },
                    "response_template": config.get("response_transform").or_else(|| config.get("response_template")).cloned().unwrap_or_else(|| json!({})),
                    "output_mapping": config.get("output_mapping").cloned().unwrap_or_else(|| json!({})),
                },
                "stream": {
                    "stream_decoder": {
                        "name": default_stream_decoder(family),
                        "config": {}
                    }
                },
                "auth": {"auth_policy": "inherit", "config": {}},
                "features": {
                    "supports_messages": family != "openai_responses",
                    "supports_input_items": family == "openai_responses",
                },
                "defaults": {
                    "headers": merged_headers,
                    "query": {},
                    "body": merged_body,
                },
                "metadata": {
                    "async_config": config.get("async_config").or_else(|| config.get("async_flow")).cloned().unwrap_or_else(|| json!({}))
                }
            }),
        );
    }

    Value::Object(profiles)
}

fn infer_protocol_family(provider: &str, capability: &str, request_template: &Value) -> &'static str {
    let provider_lower = provider.trim().to_ascii_lowercase();
    if provider_lower.contains("anthropic") || provider_lower.contains("claude") {
        return "anthropic_messages";
    }
    if capability == "chat" {
        if request_template
            .as_object()
            .map(|obj| obj.contains_key("input") && !obj.contains_key("messages"))
            .unwrap_or(false)
        {
            return "openai_responses";
        }
    }
    "openai_chat"
}

fn default_upstream_path(capability: &str, family: &str) -> &'static str {
    match capability {
        "embedding" => "embeddings",
        "image_generation" => "images/generations",
        "text_to_speech" => "audio/speech",
        "speech_to_text" => "audio/transcriptions",
        "video_generation" => "videos/generations",
        _ if family == "openai_responses" => "responses",
        _ if family == "anthropic_messages" => "v1/messages",
        _ => "chat/completions",
    }
}

fn default_decoder(family: &str) -> &'static str {
    match family {
        "openai_responses" => "openai_responses",
        "anthropic_messages" => "anthropic_messages",
        _ => "openai_chat",
    }
}

fn default_stream_decoder(family: &str) -> &'static str {
    match family {
        "openai_responses" => "openai_responses_events",
        "anthropic_messages" => "anthropic_messages_events",
        _ => "openai_chat_events",
    }
}

fn merge_json_objects(base: &Value, override_value: &Value) -> Value {
    let mut merged = base.as_object().cloned().unwrap_or_default();
    if let Some(obj) = override_value.as_object() {
        for (key, value) in obj {
            merged.insert(key.clone(), value.clone());
        }
    }
    Value::Object(merged)
}
