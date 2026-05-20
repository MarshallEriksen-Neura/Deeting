use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::ProviderStore;
use crate::modules::providers::types::ProviderPreset;

impl ProviderStore {
    pub async fn list_presets(&self) -> Result<Vec<ProviderPreset>, ProviderError> {
        let mut presets =
            crate::modules::providers::provider_market_file::load_provider_market_presets_from_path(
                self.provider_market_file_path(),
            )
            .map_err(crate::modules::providers::error::ProviderError::Validation)?;
        presets.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(presets)
    }

    pub async fn get_preset(&self, slug: &str) -> Result<Option<ProviderPreset>, ProviderError> {
        let slug = slug.trim();
        Ok(self
            .list_presets()
            .await?
            .into_iter()
            .find(|preset| preset.slug.eq_ignore_ascii_case(slug)))
    }

    pub async fn replace_presets(&self, presets: Vec<ProviderPreset>) -> Result<(), ProviderError> {
        crate::modules::providers::provider_market_file::write_provider_market_presets_to_path(
            self.provider_market_file_path(),
            presets,
        )
        .map_err(crate::modules::providers::error::ProviderError::Validation)
    }
}
