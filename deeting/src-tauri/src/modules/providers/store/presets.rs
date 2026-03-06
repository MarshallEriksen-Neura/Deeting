use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::ProviderStore;
use crate::modules::providers::store::utils::parse_json_object_text;
use crate::modules::providers::types::ProviderPreset;
use sqlx::Row;

impl ProviderStore {
    pub async fn list_presets(&self) -> Result<Vec<ProviderPreset>, ProviderError> {
        let rows = sqlx::query(
            "SELECT slug, name, provider, base_url, icon, theme_color, category, url_template,
                    template_engine, response_transform, auth_type, auth_config, default_headers,
                    default_params, capability_configs, version, is_active
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
                    default_params, capability_configs, version, is_active
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
                    default_params, capability_configs, version, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
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
            .bind(preset.version)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }
}
