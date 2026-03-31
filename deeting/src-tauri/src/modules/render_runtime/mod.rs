pub mod channel;
pub mod schema;
pub mod service;
pub mod store;
pub mod types;

pub(crate) use service::resolve_response_rendering;

use std::path::PathBuf;

/// Resolve the render_runtime root under app_data_dir.
/// Falls back to HOME/.config/deeting/render_runtime or USERPROFILE equivalent.
pub(crate) fn resolve_render_runtime_root(app_data_dir: Option<PathBuf>) -> PathBuf {
    if let Some(dir) = app_data_dir {
        return dir.join("render_runtime");
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(format!("{home}/.config/deeting/render_runtime"));
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.trim().is_empty() {
            return PathBuf::from(format!("{profile}/.config/deeting/render_runtime"));
        }
    }
    PathBuf::from("render_runtime")
}

pub(crate) fn resolve_render_runtime_manual_dir(app_data_dir: Option<PathBuf>) -> PathBuf {
    resolve_render_runtime_root(app_data_dir).join("manual")
}

pub(crate) fn resolve_render_runtime_cache_dir(app_data_dir: Option<PathBuf>) -> PathBuf {
    resolve_render_runtime_root(app_data_dir).join("cache")
}
