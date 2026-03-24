use crate::modules::audio::types::{AudioAssetRef, AudioAssetSourceKind};
use crate::state::AppState;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

pub(crate) async fn persist_generated_audio(
    _app_handle: &AppHandle,
    app_state: &AppState,
    bytes: &[u8],
    content_type: &str,
    duration_ms: Option<i64>,
) -> Result<AudioAssetRef, String> {
    let object_key = build_audio_object_key(bytes, content_type);
    if let Some(stored_key) = app_state
        .providers
        .store
        .put_local_desktop_object_storage_bytes(&object_key, content_type, bytes)
        .await
        .map_err(|err| err.to_string())?
    {
        let public_url = app_state
            .providers
            .store
            .get_local_desktop_object_storage_config()
            .await
            .map_err(|err| err.to_string())?;
        return Ok(AudioAssetRef {
            url: public_url
                .and_then(|config| config.build_public_url(&stored_key))
                .unwrap_or_else(|| format!("asset://{}", stored_key)),
            source_kind: AudioAssetSourceKind::ObjectStorage,
            content_type: Some(content_type.to_string()),
            size_bytes: Some(bytes.len() as i64),
            duration_ms,
        });
    }

    let sha256 = hex::encode(Sha256::digest(bytes));
    Ok(AudioAssetRef {
        url: format!("local-asset://{}", sha256),
        source_kind: AudioAssetSourceKind::LocalAsset,
        content_type: Some(content_type.to_string()),
        size_bytes: Some(bytes.len() as i64),
        duration_ms,
    })
}

fn build_audio_object_key(bytes: &[u8], content_type: &str) -> String {
    let digest = hex::encode(Sha256::digest(bytes));
    let ext = match content_type {
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        _ => "bin",
    };
    format!("audio/{}.{}", digest, ext)
}
