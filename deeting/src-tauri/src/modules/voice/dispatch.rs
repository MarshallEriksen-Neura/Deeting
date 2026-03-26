use crate::modules::audio::types::AudioResultPayload;
use crate::modules::voice::shared::resolve_tts_context;
use crate::modules::voice::tts;
use crate::modules::voice::types::VoiceRuntimeMode;
use crate::modules::voice_capabilities::types::TtsRequest;
use crate::state::AppState;
use tauri::AppHandle;

pub(crate) async fn request_text_to_speech(
    app_handle: &AppHandle,
    app_state: &AppState,
    request: &TtsRequest,
    trace_id: Option<&str>,
) -> Result<AudioResultPayload, String> {
    let context = resolve_tts_context(app_state, request).await?;
    match context.runtime_mode {
        VoiceRuntimeMode::OpenAiTts => {
            tts::openai::request_text_to_speech(app_handle, app_state, request, &context, trace_id)
                .await
        }
        VoiceRuntimeMode::MiniMaxTts => {
            tts::minimax::request_text_to_speech(app_handle, app_state, request, &context, trace_id)
                .await
        }
        VoiceRuntimeMode::VolcengineTts => {
            tts::volcengine::request_text_to_speech(
                app_handle, app_state, request, &context, trace_id,
            )
            .await
        }
    }
}
