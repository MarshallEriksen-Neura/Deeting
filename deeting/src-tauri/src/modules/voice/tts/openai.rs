use crate::modules::audio::types::AudioResultPayload;
use crate::modules::providers::request_runtime::{
    prepare_provider_request, send_prepared_request_raw,
};
use crate::modules::voice::shared::{
    audio_content_type_from_format, build_remote_audio_result, extract_audio_url,
    extract_error_message, is_audio_content_type, persist_audio_bytes_result, trim_secret,
};
use crate::modules::voice::types::ResolvedTtsContext;
use crate::modules::voice_capabilities::types::TtsRequest;
use crate::state::AppState;
use serde_json::Value;
use tauri::AppHandle;

pub(crate) fn build_request_data(request: &TtsRequest) -> Value {
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

pub(crate) async fn request_text_to_speech(
    app_handle: &AppHandle,
    app_state: &AppState,
    request: &TtsRequest,
    context: &ResolvedTtsContext,
    trace_id: Option<&str>,
) -> Result<AudioResultPayload, String> {
    let prepared = prepare_provider_request(
        context.preset.as_ref(),
        &context.instance,
        &context.model,
        trim_secret(context.connection.secret_key.as_deref()),
        "text_to_speech",
        build_request_data(request),
        None,
        trace_id,
    )?;
    let response = send_prepared_request_raw(&reqwest::Client::new(), &prepared).await?;
    if !response.status.is_success() {
        return Err(extract_error_message(
            response.json.as_ref(),
            response.text.as_deref(),
            "text_to_speech request failed",
        ));
    }

    let content_type = response
        .headers
        .get("content-type")
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            audio_content_type_from_format(request.response_format.as_deref()).to_string()
        });

    if is_audio_content_type(content_type.as_str()) {
        return persist_audio_bytes_result(
            app_handle,
            app_state,
            request,
            &response.bytes,
            content_type.as_str(),
            None,
        )
        .await;
    }

    if let Some(url) = extract_audio_url(response.json.as_ref()) {
        return Ok(build_remote_audio_result(request, url, Some(content_type)));
    }

    Err("text_to_speech response did not contain audio bytes or a playable audio URL".to_string())
}

#[cfg(test)]
mod tests {
    use super::build_request_data;
    use crate::modules::voice_capabilities::types::TtsRequest;
    use serde_json::json;

    #[test]
    fn build_request_data_preserves_voice_and_format() {
        let payload = build_request_data(&TtsRequest {
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
