use serde_json::Value;

use super::types::SttRequest;

pub(crate) fn build_stt_request_data(request: &SttRequest) -> Value {
    let mut data = serde_json::Map::new();
    data.insert("model".to_string(), Value::String(request.model.clone()));

    if let Some(audio_url) = request
        .audio_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        data.insert(
            "audio_url".to_string(),
            Value::String(audio_url.to_string()),
        );
    }
    if let Some(content_type) = request
        .audio_content_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        data.insert(
            "audio_content_type".to_string(),
            Value::String(content_type.to_string()),
        );
    }
    if let Some(language) = request
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        data.insert("language".to_string(), Value::String(language.to_string()));
    }
    if let Some(response_format) = request
        .response_format
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        data.insert(
            "response_format".to_string(),
            Value::String(response_format.to_string()),
        );
    }
    if let Some(timestamp_granularities) = request.timestamp_granularities.as_ref() {
        if !timestamp_granularities.is_empty() {
            data.insert(
                "timestamp_granularities".to_string(),
                serde_json::to_value(timestamp_granularities).unwrap_or(Value::Null),
            );
        }
    }
    if let Some(extra) = request.extra_params.as_ref() {
        if !extra.is_null() {
            data.insert("extra_params".to_string(), extra.clone());
        }
    }

    Value::Object(data)
}

#[cfg(test)]
mod tests {
    use super::build_stt_request_data;
    use crate::modules::voice_capabilities::types::SttRequest;
    use serde_json::json;

    #[test]
    fn build_stt_request_data_preserves_language_and_timestamp_config() {
        let payload = build_stt_request_data(&SttRequest {
            model: "whisper-1".to_string(),
            provider_model_id: "provider-1".to_string(),
            audio_url: Some("https://example.com/audio.mp3".to_string()),
            audio_content_type: Some("audio/mpeg".to_string()),
            language: Some("zh".to_string()),
            response_format: Some("json".to_string()),
            timestamp_granularities: Some(vec!["segment".to_string(), "word".to_string()]),
            extra_params: Some(json!({ "temperature": 0.2 })),
        });

        assert_eq!(payload["model"], json!("whisper-1"));
        assert_eq!(payload["audio_url"], json!("https://example.com/audio.mp3"));
        assert_eq!(payload["language"], json!("zh"));
        assert_eq!(payload["response_format"], json!("json"));
        assert_eq!(payload["timestamp_granularities"], json!(["segment", "word"]));
    }
}
