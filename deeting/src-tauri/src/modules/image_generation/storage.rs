use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::modules::chat_assets::resolve_chat_assets_dir;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct PersistedImageRecord {
    pub asset_url: Option<String>,
    pub source_url: Option<String>,
    pub content_type: String,
    pub size_bytes: i64,
}

pub async fn persist_generated_image(
    app_handle: &AppHandle,
    app_state: &AppState,
    image: &str,
    content_type: &str,
) -> Option<PersistedImageRecord> {
    let bytes = if let Some(bytes) = decode_data_url_bytes(image) {
        bytes
    } else if image.trim_start().starts_with("http://")
        || image.trim_start().starts_with("https://")
    {
        let response = app_state.mcp.client.get(image).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.bytes().await.ok()?.to_vec()
    } else {
        return None;
    };
    let sha256 = compute_sha256_hex(&bytes);
    let ext = image_ext_from_content_type(content_type);
    let object_key = format!("chat-assets/generated/{}.{}", sha256, ext);

    match app_state
        .providers
        .store
        .put_local_desktop_object_storage_bytes(&object_key, content_type, &bytes)
        .await
    {
        Ok(Some(saved_object_key)) => {
            let public_url = app_state
                .providers
                .store
                .get_local_desktop_object_storage_config()
                .await
                .ok()
                .flatten()
                .and_then(|config| config.build_public_url(&saved_object_key));
            Some(PersistedImageRecord {
                asset_url: public_url,
                source_url: Some(format!("asset://{}", saved_object_key)),
                content_type: content_type.to_string(),
                size_bytes: bytes.len() as i64,
            })
        }
        Ok(None) | Err(_) => {
            let app_data_dir = app_handle.path().app_data_dir().ok();
            let dir = resolve_chat_assets_dir(app_data_dir);
            std::fs::create_dir_all(&dir).ok()?;
            let path = dir.join(format!("{}.{}", sha256, ext));
            if !path.exists() {
                std::fs::write(&path, &bytes).ok()?;
            }
            Some(PersistedImageRecord {
                asset_url: None,
                source_url: Some(format!("local-asset://{}", sha256)),
                content_type: content_type.to_string(),
                size_bytes: bytes.len() as i64,
            })
        }
    }
}

pub fn build_image_output_items(
    raw: &Value,
) -> Vec<crate::modules::image_generation::types::LocalImageGenerationOutputItem> {
    let raw_items = raw
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    raw_items
        .into_iter()
        .enumerate()
        .map(|(index, raw_item)| {
            let source = raw_item
                .get("url")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    raw_item
                        .get("b64_json")
                        .and_then(Value::as_str)
                        .map(|value| format!("data:image/png;base64,{}", value))
                })
                .unwrap_or_default();
            let content_type = raw_item
                .get("content_type")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| infer_image_content_type(&source).to_string());
            crate::modules::image_generation::types::LocalImageGenerationOutputItem {
                output_index: index as i64,
                asset_url: None,
                source_url: Some(source),
                seed: raw_item.get("seed").and_then(Value::as_i64),
                content_type: Some(content_type),
                size_bytes: raw_item.get("size_bytes").and_then(Value::as_i64),
                width: raw_item.get("width").and_then(Value::as_i64),
                height: raw_item.get("height").and_then(Value::as_i64),
            }
        })
        .collect()
}

pub fn infer_image_content_type(value: &str) -> &str {
    let trimmed = value.trim();
    if let Some(rest) = trimmed.strip_prefix("data:") {
        if let Some(idx) = rest.find(';') {
            let content_type = &rest[..idx];
            if !content_type.trim().is_empty() {
                return content_type;
            }
        }
    }
    "image/png"
}

fn decode_data_url_bytes(value: &str) -> Option<Vec<u8>> {
    let trimmed = value.trim();
    let marker = ";base64,";
    let idx = trimmed.find(marker)?;
    let encoded = &trimmed[idx + marker.len()..];
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()
}

fn image_ext_from_content_type(content_type: &str) -> &str {
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

fn compute_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}
