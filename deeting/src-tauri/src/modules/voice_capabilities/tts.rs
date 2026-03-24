use serde_json::Value;
use uuid::Uuid;

use crate::modules::audio::storage::persist_generated_audio;
use crate::modules::audio::types::{AudioAssetRef, AudioAssetSourceKind, AudioResultPayload};
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::providers::request_runtime::{
    prepare_provider_request, send_prepared_request_raw,
};
use crate::state::AppState;
use tauri::AppHandle;

use super::types::TtsRequest;

pub(crate) fn build_tts_request_data(request: &TtsRequest) -> Value {
    let mut data = serde_json::Map::new();
    data.insert("model".to_string(), Value::String(request.model.clone()));
    data.insert("input".to_string(), Value::String(request.text.clone()));

    if let Some(voice) = request
        .voice
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        data.insert("voice".to_string(), Value::String(voice.to_string()));
    }
    if let Some(format) = request
        .response_format
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        data.insert(
            "response_format".to_string(),
            Value::String(format.to_string()),
        );
    }
    if let Some(extra) = request.extra_params.as_ref() {
        if let Some(extra_object) = extra.as_object() {
            for (key, value) in extra_object {
                data.insert(key.clone(), value.clone());
            }
        } else if !extra.is_null() {
            data.insert("extra_params".to_string(), extra.clone());
        }
    }

    Value::Object(data)
}

pub(crate) async fn request_provider_text_to_speech(
    app_handle: &AppHandle,
    app_state: &AppState,
    request: &TtsRequest,
    trace_id: Option<&str>,
) -> Result<AudioResultPayload, String> {
    let provider_model_uuid =
        Uuid::parse_str(request.provider_model_id.as_str()).map_err(to_string)?;
    let model = app_state
        .providers
        .store
        .get_model(&provider_model_uuid)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider model not found".to_string())?;
    let instance = app_state
        .providers
        .store
        .get_instance(&model.instance_id.to_string())
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider instance not found".to_string())?;
    let connection = app_state
        .providers
        .store
        .get_instance_connection(&model.instance_id.to_string())
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider instance connection not found".to_string())?;

    let preset = app_state
        .providers
        .store
        .get_preset(&instance.preset_slug)
        .await
        .map_err(to_string)?;
    let prepared = prepare_provider_request(
        preset.as_ref(),
        &instance,
        &model,
        connection.secret_key.as_deref(),
        "text_to_speech",
        build_tts_request_data(request),
        None,
        trace_id,
    )?;
    let response = send_prepared_request_raw(&reqwest::Client::new(), &prepared).await?;
    if !response.status.is_success() {
        let error_message = response
            .json
            .as_ref()
            .and_then(|value| {
                value
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .or_else(|| value.get("message").and_then(Value::as_str))
            })
            .or_else(|| response.text.as_deref())
            .unwrap_or("text_to_speech request failed");
        return Err(error_message.to_string());
    }

    let content_type = response
        .headers
        .get("content-type")
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "audio/mpeg".to_string());

    if is_audio_content_type(content_type.as_str()) {
        let asset =
            persist_generated_audio(app_handle, app_state, &response.bytes, &content_type, None)
                .await?;
        return Ok(AudioResultPayload {
            asset,
            model: Some(request.model.clone()),
            voice: request.voice.clone(),
            transcript: None,
            prompt_text: Some(request.text.clone()),
        });
    }

    if let Some(url) = extract_audio_url(response.json.as_ref()) {
        return Ok(AudioResultPayload {
            asset: AudioAssetRef {
                url,
                source_kind: AudioAssetSourceKind::RemoteUrl,
                content_type: Some(content_type),
                size_bytes: None,
                duration_ms: None,
            },
            model: Some(request.model.clone()),
            voice: request.voice.clone(),
            transcript: None,
            prompt_text: Some(request.text.clone()),
        });
    }

    Err("text_to_speech response did not contain audio bytes or a playable audio URL".to_string())
}

fn is_audio_content_type(content_type: &str) -> bool {
    let normalized = content_type.trim().to_ascii_lowercase();
    normalized.starts_with("audio/")
        || matches!(
            normalized.as_str(),
            "application/octet-stream" | "binary/octet-stream"
        )
}

fn extract_audio_url(payload: Option<&Value>) -> Option<String> {
    let payload = payload?;
    [
        payload.get("audio_url"),
        payload.get("url"),
        payload.pointer("/data/0/url"),
        payload.pointer("/data/url"),
    ]
    .into_iter()
    .flatten()
    .find_map(Value::as_str)
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::build_tts_request_data;
    use crate::modules::voice_capabilities::types::TtsRequest;
    use serde_json::json;

    #[test]
    fn build_tts_request_data_preserves_voice_and_format() {
        let payload = build_tts_request_data(&TtsRequest {
            model: "tts-1".to_string(),
            provider_model_id: "provider-1".to_string(),
            text: "hello world".to_string(),
            voice: Some("alloy".to_string()),
            response_format: Some("mp3".to_string()),
            extra_params: Some(json!({ "speed": 1.1 })),
        });

        assert_eq!(payload["model"], json!("tts-1"));
        assert_eq!(payload["input"], json!("hello world"));
        assert_eq!(payload["voice"], json!("alloy"));
        assert_eq!(payload["response_format"], json!("mp3"));
        assert_eq!(payload["speed"], json!(1.1));
    }
}
