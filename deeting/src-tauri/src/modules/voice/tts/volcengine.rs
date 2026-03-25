use crate::modules::audio::types::AudioResultPayload;
use crate::modules::voice::shared::{
    audio_content_type_from_format, extract_error_message, persist_audio_bytes_result,
    preferred_base_url, read_i64, trim_secret,
};
use crate::modules::voice::types::ResolvedTtsContext;
use crate::modules::voice_capabilities::types::TtsRequest;
use crate::state::AppState;
use base64::Engine;
use reqwest::Client;
use serde_json::{json, Map, Value};
use tauri::AppHandle;
use uuid::Uuid;

fn resolve_app_id(context: &ResolvedTtsContext) -> Option<String> {
    context
        .instance
        .meta
        .get("app_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn resolve_resource_id(context: &ResolvedTtsContext) -> Option<String> {
    context
        .instance
        .meta
        .get("resource_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn build_request_body(
    request: &TtsRequest,
    app_id: &str,
) -> Value {
    let mut audio_params = Map::new();
    if let Some(format) = request
        .response_format
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        audio_params.insert("format".to_string(), Value::String(format.to_string()));
    }
    let mut req_params = Map::new();
    req_params.insert("text".to_string(), Value::String(request.text.clone()));

    if let Some(voice) = request
        .voice
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        req_params.insert("speaker".to_string(), Value::String(voice.to_string()));
    }
    if let Some(extra_params) = request.extra_params.as_ref().and_then(Value::as_object) {
        if let Some(model) = extra_params.get("model").cloned() {
            req_params.insert("model".to_string(), model);
        }
        if let Some(ssml) = extra_params.get("ssml").cloned() {
            req_params.insert("ssml".to_string(), ssml);
        }
        if let Some(context_texts) = extra_params.get("context_texts").cloned() {
            req_params.insert("context_texts".to_string(), context_texts);
        }
        if let Some(mix_speaker) = extra_params.get("mix_speaker").cloned() {
            req_params.insert("mix_speaker".to_string(), mix_speaker);
        }
        for key in [
            "emotion",
            "emotion_scale",
            "speech_rate",
            "loudness_rate",
            "enable_timestamp",
            "bit_rate",
            "emotion",
        ] {
            if let Some(value) = extra_params.get(key).cloned() {
                audio_params.insert(key.to_string(), value);
            }
        }
        if let Some(sample_rate) = extra_params
            .get("sample_rate")
            .and_then(Value::as_i64)
            .or_else(|| read_i64(&Value::Object(extra_params.clone()), "sample_rate"))
        {
            audio_params.insert("sample_rate".to_string(), json!(sample_rate));
        }
    }
    if !audio_params.is_empty() {
        req_params.insert("audio_params".to_string(), Value::Object(audio_params));
    }
    let uid = request
        .extra_params
        .as_ref()
        .and_then(|value| value.get("uid"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(app_id);

    json!({
        "user": {
            "uid": uid,
        },
        "req_params": Value::Object(req_params),
    })
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
        return Err("Volcengine TTS base_url is required".to_string());
    }
    let access_key = trim_secret(context.connection.secret_key.as_deref())
        .ok_or_else(|| "Volcengine TTS requires an access key credential".to_string())?;
    let app_id = resolve_app_id(context)
        .ok_or_else(|| "Volcengine TTS requires app_id in provider instance metadata".to_string())?;
    let resource_id = resolve_resource_id(context)
        .ok_or_else(|| "Volcengine TTS requires resource_id in provider instance metadata".to_string())?;
    let url = format!("{}/api/v3/tts/unidirectional", base_url.trim_end_matches('/'));
    let body = build_request_body(request, &app_id);

    let mut builder = Client::new()
        .post(url)
        .header("Content-Type", "application/json")
        .header("X-Api-App-Id", app_id.as_str())
        .header("X-Api-Access-Key", access_key)
        .header("X-Api-Resource-Id", resource_id.as_str())
        .header("X-Api-Request-Id", trace_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| Uuid::new_v4().to_string()));
    if let Some(trace_id) = trace_id.map(str::trim).filter(|value| !value.is_empty()) {
        builder = builder.header("X-Trace-Id", trace_id);
    }
    let response = builder.json(&body).send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    let payload = response.json::<Value>().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(extract_error_message(
            Some(&payload),
            None,
            "Volcengine TTS request failed",
        ));
    }

    let audio_base64 = payload
        .get("data")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Volcengine TTS response did not contain audio data".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64)
        .map_err(|err| err.to_string())?;
    let content_type = audio_content_type_from_format(request.response_format.as_deref());
    persist_audio_bytes_result(app_handle, app_state, request, &bytes, content_type, None).await
}

#[cfg(test)]
mod tests {
    use super::build_request_body;
    use crate::modules::voice_capabilities::types::TtsRequest;
    use serde_json::json;

    #[test]
    fn build_request_body_serializes_volcengine_payload() {
        let payload = build_request_body(
            &TtsRequest {
                model: "unused".to_string(),
                provider_model_id: "provider-1".to_string(),
                text: "hello".to_string(),
                voice: Some("BV001_streaming".to_string()),
                response_format: Some("mp3".to_string()),
                extra_params: Some(json!({
                    "speech_rate": 10,
                    "sample_rate": 24000
                })),
            },
            "123456789",
        );

        assert_eq!(payload["user"]["uid"], json!("123456789"));
        assert_eq!(payload["req_params"]["text"], json!("hello"));
        assert_eq!(payload["req_params"]["speaker"], json!("BV001_streaming"));
        assert_eq!(payload["req_params"]["audio_params"]["format"], json!("mp3"));
        assert_eq!(payload["req_params"]["audio_params"]["sample_rate"], json!(24000));
        assert_eq!(payload["req_params"]["audio_params"]["speech_rate"], json!(10));
    }
}
