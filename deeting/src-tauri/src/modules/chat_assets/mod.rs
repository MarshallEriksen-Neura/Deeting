pub mod commands;

use std::path::PathBuf;

/// Resolve the chat_assets directory under app_data_dir.
/// Falls back to HOME/.config/deeting/chat_assets or USERPROFILE equivalent.
pub fn resolve_chat_assets_dir(app_data_dir: Option<PathBuf>) -> PathBuf {
    if let Some(dir) = app_data_dir {
        return dir.join("chat_assets");
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(format!("{home}/.config/deeting/chat_assets"));
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.trim().is_empty() {
            return PathBuf::from(format!("{profile}/.config/deeting/chat_assets"));
        }
    }
    PathBuf::from("chat_assets")
}

fn ext_from_content_type(content_type: &str) -> &str {
    match content_type {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        _ => "bin",
    }
}
