use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::modules::providers::types::ProviderPreset;

const DEFAULT_PROVIDER_MARKET_JSON: &str = include_str!("default_provider_market_presets.json");
const PROVIDER_MARKET_FILE_ENV: &str = "DEETING_PROVIDER_MARKET_FILE";

#[derive(Debug, Serialize, Deserialize)]
struct ProviderMarketFile {
    presets: Vec<ProviderPreset>,
}

pub fn provider_market_file_path() -> PathBuf {
    if let Ok(path) = std::env::var(PROVIDER_MARKET_FILE_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    dirs::config_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("deeting")
        .join("provider-market-presets.json")
}

fn ensure_provider_market_file_at(path: Option<&Path>) -> Result<PathBuf, String> {
    let path = path
        .map(Path::to_path_buf)
        .unwrap_or_else(provider_market_file_path);
    if path.exists() {
        return Ok(path);
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create provider market config dir: {err}"))?;
    }

    std::fs::write(&path, DEFAULT_PROVIDER_MARKET_JSON)
        .map_err(|err| format!("failed to write provider market config file: {err}"))?;
    Ok(path)
}

fn ensure_provider_market_file() -> Result<PathBuf, String> {
    ensure_provider_market_file_at(None)
}

pub fn provider_market_file_path_string() -> Result<String, String> {
    ensure_provider_market_file().map(|path| path.to_string_lossy().to_string())
}

pub fn parse_provider_market_presets(input: &str) -> Result<Vec<ProviderPreset>, String> {
    let value: Value = serde_json::from_str(input)
        .map_err(|err| format!("provider market preset file is not valid JSON: {err}"))?;
    let presets_value = value.get("presets").cloned().unwrap_or(value);
    serde_json::from_value::<Vec<ProviderPreset>>(presets_value)
        .map_err(|err| format!("provider market preset file has invalid presets: {err}"))
}

pub fn load_provider_market_presets() -> Result<Vec<ProviderPreset>, String> {
    load_provider_market_presets_from_path(None)
}

pub fn load_provider_market_presets_from_path(
    path: Option<&Path>,
) -> Result<Vec<ProviderPreset>, String> {
    let path = ensure_provider_market_file_at(path)?;
    let content = std::fs::read_to_string(&path).map_err(|err| {
        format!(
            "failed to read provider market config file {}: {err}",
            path.to_string_lossy()
        )
    })?;
    parse_provider_market_presets(&content)
}

pub fn write_provider_market_presets(presets: Vec<ProviderPreset>) -> Result<(), String> {
    write_provider_market_presets_to_path(None, presets)
}

pub fn write_provider_market_presets_to_path(
    path: Option<&Path>,
    presets: Vec<ProviderPreset>,
) -> Result<(), String> {
    let path = ensure_provider_market_file_at(path)?;
    let content = serde_json::to_string_pretty(&ProviderMarketFile { presets })
        .map_err(|err| format!("failed to serialize provider market config file: {err}"))?;
    std::fs::write(&path, format!("{content}\n")).map_err(|err| {
        format!(
            "failed to write provider market config file {}: {err}",
            path.to_string_lossy()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::parse_provider_market_presets;

    #[test]
    fn parses_wrapped_provider_market_presets() {
        let presets = parse_provider_market_presets(
            r#"{
              "presets": [{
                "slug": "openai",
                "name": "OpenAI",
                "provider": "openai",
                "base_url": "https://api.openai.com",
                "icon": null,
                "category": "cloud api",
                "auth_type": "bearer",
                "auth_config": {},
                "protocol_profiles": {},
                "is_active": true
              }]
            }"#,
        )
        .expect("parse presets");

        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].slug, "openai");
        assert_eq!(presets[0].auth_type, "bearer");
    }
}
