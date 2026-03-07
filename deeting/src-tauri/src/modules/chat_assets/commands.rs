use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

use super::{ext_from_content_type, resolve_chat_assets_dir};

#[derive(Debug, Deserialize)]
pub struct SaveChatAssetRequest {
    pub content_base64: String,
    pub sha256: String,
    pub content_type: String,
}

#[derive(Debug, Serialize)]
pub struct SaveChatAssetResponse {
    pub asset_id: String,
    pub already_exists: bool,
}

#[derive(Debug, Deserialize)]
pub struct ReadChatAssetRequest {
    pub sha256: String,
    pub content_type: String,
}

#[derive(Debug, Serialize)]
pub struct ReadChatAssetResponse {
    pub data_url: String,
    pub size_bytes: u64,
}

#[derive(Debug, Deserialize)]
pub struct DeleteChatAssetRequest {
    pub sha256: String,
    pub content_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DeleteChatAssetResponse {
    pub deleted: bool,
}

fn asset_path(base_dir: &PathBuf, sha256: &str, content_type: &str) -> PathBuf {
    let ext = ext_from_content_type(content_type);
    base_dir.join(format!("{sha256}.{ext}"))
}

fn get_assets_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().ok();
    let dir = resolve_chat_assets_dir(app_data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create chat_assets dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub async fn save_local_chat_asset(
    app: tauri::AppHandle,
    payload: SaveChatAssetRequest,
) -> Result<SaveChatAssetResponse, String> {
    let dir = get_assets_dir(&app)?;
    let path = asset_path(&dir, &payload.sha256, &payload.content_type);

    if path.exists() {
        return Ok(SaveChatAssetResponse {
            asset_id: payload.sha256,
            already_exists: true,
        });
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&payload.content_base64)
        .map_err(|e| format!("Invalid base64: {e}"))?;

    std::fs::write(&path, &bytes)
        .map_err(|e| format!("Failed to write asset {}: {e}", path.display()))?;

    Ok(SaveChatAssetResponse {
        asset_id: payload.sha256,
        already_exists: false,
    })
}

#[tauri::command]
pub async fn read_local_chat_asset(
    app: tauri::AppHandle,
    payload: ReadChatAssetRequest,
) -> Result<ReadChatAssetResponse, String> {
    let dir = get_assets_dir(&app)?;
    let path = asset_path(&dir, &payload.sha256, &payload.content_type);

    if !path.exists() {
        return Err(format!("Asset not found: {}", payload.sha256));
    }

    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read asset {}: {e}", path.display()))?;
    let size_bytes = bytes.len() as u64;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let data_url = format!("data:{};base64,{b64}", payload.content_type);

    Ok(ReadChatAssetResponse {
        data_url,
        size_bytes,
    })
}

#[tauri::command]
pub async fn delete_local_chat_asset(
    app: tauri::AppHandle,
    payload: DeleteChatAssetRequest,
) -> Result<DeleteChatAssetResponse, String> {
    let dir = get_assets_dir(&app)?;
    let content_type = payload.content_type.as_deref().unwrap_or("image/png");
    let path = asset_path(&dir, &payload.sha256, content_type);

    if !path.exists() {
        // Try all known image extensions as fallback
        let exts = ["png", "jpg", "gif", "webp", "svg", "bmp", "tiff", "bin"];
        for ext in exts {
            let candidate = dir.join(format!("{}.{ext}", payload.sha256));
            if candidate.exists() {
                std::fs::remove_file(&candidate)
                    .map_err(|e| format!("Failed to delete asset: {e}"))?;
                return Ok(DeleteChatAssetResponse { deleted: true });
            }
        }
        return Ok(DeleteChatAssetResponse { deleted: false });
    }

    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete asset: {e}"))?;
    Ok(DeleteChatAssetResponse { deleted: true })
}

#[derive(Debug, Serialize)]
pub struct CleanupChatAssetsResponse {
    pub deleted_count: u32,
}

#[tauri::command]
pub async fn cleanup_conversation_chat_assets(
    app: tauri::AppHandle,
    sha256_list: Vec<String>,
) -> Result<CleanupChatAssetsResponse, String> {
    if sha256_list.is_empty() {
        return Ok(CleanupChatAssetsResponse { deleted_count: 0 });
    }

    let dir = get_assets_dir(&app)?;
    let exts = ["png", "jpg", "gif", "webp", "svg", "bmp", "tiff", "bin"];
    let mut deleted_count = 0u32;

    for sha256 in &sha256_list {
        let trimmed = sha256.trim();
        if trimmed.is_empty() {
            continue;
        }
        for ext in &exts {
            let path = dir.join(format!("{trimmed}.{ext}"));
            if path.exists() {
                if std::fs::remove_file(&path).is_ok() {
                    deleted_count += 1;
                }
                break;
            }
        }
    }

    Ok(CleanupChatAssetsResponse { deleted_count })
}
