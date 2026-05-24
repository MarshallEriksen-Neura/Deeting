use crate::modules::audio::result_blocks::build_audio_result_block;
use crate::modules::chat_assets::resolve_chat_assets_dir;
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentPreviewResponse, CustomTaskAgentProfile,
};
use crate::state::AppState;
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

pub(super) fn build_custom_task_agent_render_blocks(
    app_handle: &AppHandle,
    app_state: &AppState,
    profile: &CustomTaskAgentProfile,
    result: &CustomTaskAgentPreviewResponse,
    prompt: Option<&str>,
) -> futures_util::future::BoxFuture<'static, Vec<Value>> {
    let profile = profile.clone();
    let result = result.clone();
    let prompt = prompt.map(|value| value.to_string());
    let app_state = app_state.clone();
    let app_handle = app_handle.clone();
    Box::pin(async move {
        let mut blocks = Vec::new();
        if result.invocation_kind == CustomTaskAgentInvocationKind::ImageGeneration {
            let outputs =
                persist_custom_task_agent_image_outputs(&app_handle, &app_state, &result).await;
            if outputs.is_empty() {
                return blocks;
            }
            let preview = outputs.first().cloned().unwrap_or_else(|| json!({}));
            blocks.push(json!({
                "view_type": "image.result",
                "title": format!("{} Image Result", profile.name),
                "payload": {
                    "preview": preview,
                    "outputs": outputs,
                    "prompt": prompt.unwrap_or_default(),
                    "model": result.model_id,
                },
                "metadata": {
                    "agentId": profile.id,
                    "agentName": profile.name,
                    "invocationKind": result.invocation_kind.as_str(),
                    "providerModelId": result.provider_model_id,
                }
            }));
            return blocks;
        }

        if result.invocation_kind == CustomTaskAgentInvocationKind::TextToSpeech {
            let Some(payload) = result.raw.as_ref() else {
                return blocks;
            };
            let Some(audio_payload) = serde_json::from_value(payload.clone()).ok() else {
                return blocks;
            };
            let title = format!("{} Audio Result", profile.name);
            blocks.push(build_audio_result_block(
                profile.id.as_str(),
                Some(title.as_str()),
                &audio_payload,
                Some(json!({
                    "agentId": profile.id,
                    "agentName": profile.name,
                    "invocationKind": result.invocation_kind.as_str(),
                    "providerModelId": result.provider_model_id,
                })),
            ));
            return blocks;
        }

        blocks
    })
}

async fn persist_custom_task_agent_image_outputs(
    app_handle: &AppHandle,
    app_state: &AppState,
    result: &CustomTaskAgentPreviewResponse,
) -> Vec<Value> {
    if let Some(outputs) = result
        .raw
        .as_ref()
        .and_then(|raw| raw.get("outputs"))
        .and_then(Value::as_array)
    {
        return outputs.to_vec();
    }
    let raw_items = result
        .raw
        .as_ref()
        .and_then(|raw| raw.get("data"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut outputs = Vec::new();
    for (index, image) in result.images.iter().enumerate() {
        let raw_item = raw_items.get(index);
        let content_type = raw_item
            .and_then(|item| item.get("content_type"))
            .and_then(Value::as_str)
            .unwrap_or_else(|| infer_image_content_type(image))
            .to_string();
        let persisted =
            persist_custom_task_agent_image(app_handle, app_state, image, &content_type).await;
        let (asset_url, source_url, size_bytes) = match persisted {
            Some(PersistedImageLocation::ObjectStorage {
                object_key,
                public_url,
                size_bytes,
            }) => (
                public_url.map(Value::String).unwrap_or(Value::Null),
                Value::String(format!("asset://{}", object_key)),
                json!(size_bytes),
            ),
            Some(PersistedImageLocation::Local { sha256, size_bytes }) => (
                Value::Null,
                Value::String(format!("local-asset://{}", sha256)),
                json!(size_bytes),
            ),
            None => (Value::Null, Value::String(image.clone()), Value::Null),
        };

        outputs.push(json!({
            "output_index": index,
            "asset_url": asset_url,
            "source_url": source_url,
            "seed": raw_item.and_then(|item| item.get("seed")).cloned().unwrap_or(Value::Null),
            "content_type": content_type,
            "size_bytes": size_bytes,
            "width": raw_item.and_then(|item| item.get("width")).cloned().unwrap_or(Value::Null),
            "height": raw_item.and_then(|item| item.get("height")).cloned().unwrap_or(Value::Null),
        }));
    }
    outputs
}

enum PersistedImageLocation {
    ObjectStorage {
        object_key: String,
        public_url: Option<String>,
        size_bytes: usize,
    },
    Local {
        sha256: String,
        size_bytes: usize,
    },
}

async fn persist_custom_task_agent_image(
    app_handle: &AppHandle,
    app_state: &AppState,
    image: &str,
    content_type: &str,
) -> Option<PersistedImageLocation> {
    let bytes = if let Some(bytes) = decode_data_url_bytes(image) {
        bytes
    } else if image.trim_start().starts_with("http://")
        || image.trim_start().starts_with("https://")
    {
        let response = app_state
            .mcp
            .transport
            .client
            .get(image)
            .send()
            .await
            .ok()?;
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
            Some(PersistedImageLocation::ObjectStorage {
                object_key: saved_object_key,
                public_url,
                size_bytes: bytes.len(),
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
            Some(PersistedImageLocation::Local {
                sha256,
                size_bytes: bytes.len(),
            })
        }
    }
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

fn infer_image_content_type(value: &str) -> &str {
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
