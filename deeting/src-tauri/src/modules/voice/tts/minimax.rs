use crate::modules::audio::types::AudioResultPayload;
use crate::modules::voice::shared::{
    audio_content_type_from_format, build_remote_audio_result, extract_error_message,
    persist_audio_bytes_result, preferred_base_url, read_string, trim_secret,
};
use crate::modules::voice::types::ResolvedTtsContext;
use crate::modules::voice_capabilities::types::TtsRequest;
use crate::state::AppState;
use serde_json::{Map, Value};
use tauri::AppHandle;

pub(crate) fn build_request_body(request: &TtsRequest) -> Result<Value, String> {
    let mut voice_setting = Map::new();
    let voice_id = request
        .voice
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            request
                .extra_params
                .as_ref()
                .and_then(|value| read_string(value, "voice_id"))
        })
        .or_else(|| {
            request
                .extra_params
                .as_ref()
                .and_then(|value| read_string(value, "speaker"))
        })
        .ok_or_else(|| "MiniMax TTS requires a voice or voice_id".to_string())?;
    voice_setting.insert("voice_id".to_string(), Value::String(voice_id));

    let mut audio_setting = Map::new();
    if let Some(format) = request
        .response_format
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        audio_setting.insert("format".to_string(), Value::String(format.to_string()));
    }

    if let Some(extra_params) = request.extra_params.as_ref().and_then(Value::as_object) {
        for key in ["speed", "vol", "pitch", "emotion"] {
            if let Some(value) = extra_params.get(key).cloned() {
                voice_setting.insert(key.to_string(), value);
            }
        }
        for key in ["sample_rate", "audio_sample_rate", "bitrate", "channel"] {
            if let Some(value) = extra_params.get(key).cloned() {
                let normalized_key = if key == "audio_sample_rate" {
                    "sample_rate"
                } else {
                    key
                };
                audio_setting.insert(normalized_key.to_string(), value);
            }
        }
    }

    let mut body = Map::new();
    body.insert("model".to_string(), Value::String(request.model.clone()));
    body.insert("text".to_string(), Value::String(request.text.clone()));
    body.insert("stream".to_string(), Value::Bool(false));
    body.insert("voice_setting".to_string(), Value::Object(voice_setting));
    if !audio_setting.is_empty() {
        body.insert("audio_setting".to_string(), Value::Object(audio_setting));
    }
    body.insert("subtitle_enable".to_string(), Value::Bool(false));
    if let Some(extra_params) = request.extra_params.as_ref().and_then(Value::as_object) {
        for key in [
            "pronunciation_dict",
            "language_boost",
            "voice_modify",
            "timbre_weights",
            "stream_options",
            "output_format",
            "subtitle_enable",
            "aigc_watermark",
        ] {
            if let Some(value) = extra_params.get(key).cloned() {
                body.insert(key.to_string(), value);
            }
        }
    }
    Ok(Value::Object(body))
}

pub(crate) async fn request_text_to_speech(
    app_handle: &AppHandle,
    app_state: &AppState,
    request: &TtsRequest,
    context: &ResolvedTtsContext,
    trace_id: Option<&str>,
) -> Result<AudioResultPayload, String> {
    let base_url = preferred_base_url(context);
    if base_url.is_empty() {
        return Err("MiniMax TTS base_url is required".to_string());
    }
    let secret = trim_secret(context.connection.secret_key.as_deref())
        .ok_or_else(|| "MiniMax TTS requires an API key".to_string())?;
    let url = format!("{}/v1/t2a_v2", base_url.trim_end_matches('/'));
    let body = build_request_body(request)?;

    let client = crate::modules::desktop_config::network::build_proxy_aware_reqwest_client(
        app_state.mcp.store.as_ref(),
    )
    .await?;
    let mut builder = client
        .post(url)
        .header("Authorization", format!("Bearer {secret}"))
        .header("Content-Type", "application/json");
    if let Some(trace_id) = trace_id.map(str::trim).filter(|value| !value.is_empty()) {
        builder = builder.header("X-Trace-Id", trace_id);
    }
    let response = builder
        .json(&body)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(extract_error_message(
            Some(&payload),
            None,
            "MiniMax TTS request failed",
        ));
    }

    let audio_value = payload
        .pointer("/data/audio")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "MiniMax TTS response did not contain audio data".to_string())?;
    let output_format = request
        .extra_params
        .as_ref()
        .and_then(|value| read_string(value, "output_format"))
        .unwrap_or_else(|| "hex".to_string());
    let response_format = payload
        .pointer("/extra_info/audio_format")
        .and_then(Value::as_str)
        .or(request.response_format.as_deref());
    let content_type = audio_content_type_from_format(response_format);

    if output_format.eq_ignore_ascii_case("url")
        || audio_value.starts_with("http://")
        || audio_value.starts_with("https://")
    {
        return Ok(build_remote_audio_result(
            request,
            audio_value.to_string(),
            Some(content_type.to_string()),
        ));
    }

    let bytes = hex::decode(audio_value).map_err(|err| err.to_string())?;
    persist_audio_bytes_result(app_handle, app_state, request, &bytes, content_type, None).await
}

#[cfg(test)]
mod tests {
    use super::build_request_body;
    use crate::modules::voice_capabilities::types::TtsRequest;
    use serde_json::json;

    #[test]
    fn build_request_body_maps_voice_and_audio_settings() {
        let payload = build_request_body(&TtsRequest {
            model: "speech-2.8-hd".to_string(),
            provider_model_id: "provider-1".to_string(),
            text: "hello".to_string(),
            voice: Some("male-qn-qingse".to_string()),
            response_format: Some("mp3".to_string()),
            extra_params: Some(json!({
                "speed": 1.2,
                "pitch": 0,
                "sample_rate": 32000
            })),
        })
        .expect("request body");

        assert_eq!(
            payload["voice_setting"]["voice_id"],
            json!("male-qn-qingse")
        );
        assert_eq!(payload["voice_setting"]["speed"], json!(1.2));
        assert_eq!(payload["audio_setting"]["format"], json!("mp3"));
        assert_eq!(payload["audio_setting"]["sample_rate"], json!(32000));
    }

    #[test]
    fn build_request_body_preserves_supported_extra_fields() {
        let payload = build_request_body(&TtsRequest {
            model: "speech-2.8-hd".to_string(),
            provider_model_id: "provider-1".to_string(),
            text: "hello".to_string(),
            voice: Some("male-qn-qingse".to_string()),
            response_format: Some("mp3".to_string()),
            extra_params: Some(json!({
                "output_format": "url",
                "language_boost": "auto",
                "subtitle_enable": true,
                "pronunciation_dict": {
                    "tone": ["危险/dangerous"]
                }
            })),
        })
        .expect("request body");

        assert_eq!(payload["output_format"], json!("url"));
        assert_eq!(payload["language_boost"], json!("auto"));
        assert_eq!(payload["subtitle_enable"], json!(true));
        assert_eq!(
            payload["pronunciation_dict"]["tone"][0],
            json!("危险/dangerous")
        );
    }
}
