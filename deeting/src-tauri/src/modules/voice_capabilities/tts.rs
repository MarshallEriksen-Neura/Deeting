use crate::modules::audio::types::AudioResultPayload;
use crate::modules::voice::dispatch;
use crate::state::AppState;
use tauri::AppHandle;

use super::types::TtsRequest;

pub(crate) async fn request_provider_text_to_speech(
    app_handle: &AppHandle,
    app_state: &AppState,
    request: &TtsRequest,
    trace_id: Option<&str>,
) -> Result<AudioResultPayload, String> {
    dispatch::request_text_to_speech(app_handle, app_state, request, trace_id).await
}

#[cfg(test)]
mod tests {
    use crate::modules::voice::tts::openai::build_request_data;
    use crate::modules::voice_capabilities::types::TtsRequest;
    use serde_json::json;

    #[test]
    fn build_tts_request_data_preserves_voice_and_format() {
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
