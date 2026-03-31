pub mod commands;
pub mod service;
pub mod store;
pub mod types;

use std::path::PathBuf;

pub(crate) fn resolve_asset_registry_root(app_data_dir: Option<PathBuf>) -> PathBuf {
    if let Some(dir) = app_data_dir {
        return dir.join("asset_registry");
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(format!("{home}/.config/deeting/asset_registry"));
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.trim().is_empty() {
            return PathBuf::from(format!("{profile}/.config/deeting/asset_registry"));
        }
    }
    PathBuf::from("asset_registry")
}

pub(crate) fn resolve_asset_registry_bundle_dir(app_data_dir: Option<PathBuf>) -> PathBuf {
    resolve_asset_registry_root(app_data_dir).join("bundles")
}
