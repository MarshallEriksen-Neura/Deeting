use sqlx::Row;
use crate::modules::providers::error::ProviderError;
use crate::modules::providers::types::ProviderPreset;
use crate::modules::providers::store::ProviderStore;

impl ProviderStore {
    pub async fn list_presets(&self) -> Result<Vec<ProviderPreset>, ProviderError> {
        let rows = sqlx::query(
            "SELECT slug, name, provider, base_url, icon, theme_color, category, url_template, template_engine, response_transform, is_active
             FROM provider_presets
             ORDER BY name ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut presets = Vec::with_capacity(rows.len());
        for row in rows {
            let response_transform_text: Option<String> = row.try_get("response_transform")?;
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
                response_transform: response_transform_text.and_then(|t| serde_json::from_str(&t).ok()),
                is_active: row.try_get::<i64, _>("is_active")? != 0,
            });
        }
        Ok(presets)
    }

    pub async fn replace_presets(
        &self,
        presets: Vec<ProviderPreset>,
    ) -> Result<(), ProviderError> {
        let mut tx = self.pool.begin().await?;

        // Mark all as inactive first
        sqlx::query("UPDATE provider_presets SET is_active = 0")
            .execute(&mut *tx)
            .await?;

        for preset in presets {
            sqlx::query(
                "INSERT INTO provider_presets (
                    slug, name, provider, base_url, icon, theme_color, category, url_template, template_engine, response_transform, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
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
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }
}
