use crate::modules::audio::storage::persist_generated_audio;
use crate::modules::audio::types::{AudioAssetRef, AudioAssetSourceKind, AudioResultPayload};
use crate::modules::mcp::commands::common_impl::to_string;
use crate::modules::voice::types::{ResolvedTtsContext, VoiceRuntimeMode};
use crate::modules::voice_capabilities::types::TtsRequest;
use crate::state::AppState;
use serde_json::Value;
use tauri::AppHandle;
use uuid::Uuid;

pub(crate) async fn resolve_tts_context(
    app_state: &AppState,
    request: &TtsRequest,
) -> Result<ResolvedTtsContext, String> {
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
    let runtime_mode = resolve_voice_runtime_mode(
        &model,
        &instance,
        preset.as_ref(),
        connection.protocol.as_deref(),
    );

    Ok(ResolvedTtsContext {
        model,
        instance,
        preset,
        connection,
        runtime_mode,
    })
}

pub(crate) fn resolve_voice_runtime_mode(
    model: &crate::modules::providers::types::ProviderModel,
    instance: &crate::modules::providers::types::ProviderInstance,
    preset: Option<&crate::modules::providers::types::ProviderPreset>,
    resolved_protocol: Option<&str>,
) -> VoiceRuntimeMode {
    // Phase-one keeps explicit override support for exceptional cases, but normal routing
    // should follow the same provider-instance protocol flow used by other capabilities.
    //
    // Resolution order:
    // 1. model.config_override.voice_runtime
    // 2. resolved instance protocol
    // 3. instance.meta.protocol
    // 4. preset.provider
    //
    // Supported phase-one values:
    // - openai_tts
    // - minimax_tts
    // - volcengine_openspeech_tts
    //
    // Short aliases remain accepted so existing presets can migrate gradually.
    let model_hint = model
        .config_override
        .get("voice_runtime")
        .and_then(Value::as_str);
    let protocol_hint = instance.meta.get("protocol").and_then(Value::as_str);
    let preset_hint = preset.map(|item| item.provider.as_str());

    model_hint
        .and_then(parse_voice_runtime_mode)
        .or_else(|| resolved_protocol.and_then(parse_voice_runtime_mode))
        .or_else(|| preset_hint.and_then(parse_voice_runtime_mode))
        .or_else(|| protocol_hint.and_then(parse_voice_runtime_mode))
        .unwrap_or(VoiceRuntimeMode::OpenAiTts)
}

fn parse_voice_runtime_mode(value: &str) -> Option<VoiceRuntimeMode> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "openai" | "openai_tts" | "openai_compat" | "openai_compat_tts" | "custom" | "voice" => {
            Some(VoiceRuntimeMode::OpenAiTts)
        }
        "minimax_tts" => Some(VoiceRuntimeMode::MiniMaxTts),
        "volcengine" | "volcengine_tts" | "volcengine_openspeech_tts" | "openspeech_tts" => {
            Some(VoiceRuntimeMode::VolcengineTts)
        }
        _ => None,
    }
}

pub(crate) fn build_audio_result(request: &TtsRequest, asset: AudioAssetRef) -> AudioResultPayload {
    AudioResultPayload {
        asset,
        model: Some(request.model.clone()),
        voice: request.voice.clone(),
        transcript: None,
        prompt_text: Some(request.text.clone()),
    }
}

pub(crate) async fn persist_audio_bytes_result(
    app_handle: &AppHandle,
    app_state: &AppState,
    request: &TtsRequest,
    bytes: &[u8],
    content_type: &str,
    duration_ms: Option<i64>,
) -> Result<AudioResultPayload, String> {
    let asset =
        persist_generated_audio(app_handle, app_state, bytes, content_type, duration_ms).await?;
    Ok(build_audio_result(request, asset))
}

pub(crate) fn build_remote_audio_result(
    request: &TtsRequest,
    url: String,
    content_type: Option<String>,
) -> AudioResultPayload {
    build_audio_result(
        request,
        AudioAssetRef {
            url,
            source_kind: AudioAssetSourceKind::RemoteUrl,
            content_type,
            size_bytes: None,
            duration_ms: None,
        },
    )
}

pub(crate) fn extract_error_message(
    payload: Option<&Value>,
    text: Option<&str>,
    fallback: &str,
) -> String {
    payload
        .map(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    value
                        .pointer("/base_resp/status_msg")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .or_else(|| {
                    value
                        .pointer("/header/message")
                        .and_then(Value::as_str)
                        .map(|message| {
                            let code = value
                                .pointer("/header/code")
                                .and_then(Value::as_i64)
                                .map(|item| item.to_string())
                                .or_else(|| {
                                    value
                                        .pointer("/header/code")
                                        .and_then(Value::as_str)
                                        .map(str::to_string)
                                });
                            let reqid = value
                                .pointer("/header/reqid")
                                .and_then(Value::as_str)
                                .map(str::trim)
                                .filter(|item| !item.is_empty())
                                .map(str::to_string);

                            match (code, reqid) {
                                (Some(code), Some(reqid)) => {
                                    format!("{message} ({code}, reqid: {reqid})")
                                }
                                (Some(code), None) => format!("{message} ({code})"),
                                (None, Some(reqid)) => {
                                    format!("{message} (reqid: {reqid})")
                                }
                                (None, None) => message.to_string(),
                            }
                        })
                })
                .or_else(|| {
                    value
                        .get("message")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .or_else(|| {
                    value
                        .get("error")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .or_else(|| {
                    value
                        .pointer("/base_resp/status_code")
                        .and_then(Value::as_i64)
                        .map(|code| {
                            if let Some(message) = value
                                .pointer("/base_resp/status_msg")
                                .and_then(Value::as_str)
                            {
                                format!("{message} ({code})")
                            } else {
                                format!("upstream status code {code}")
                            }
                        })
                })
        })
        .flatten()
        .or_else(|| {
            text.map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| fallback.to_string())
}

pub(crate) fn is_audio_content_type(content_type: &str) -> bool {
    let normalized = content_type.trim().to_ascii_lowercase();
    normalized.starts_with("audio/")
        || matches!(
            normalized.as_str(),
            "application/octet-stream" | "binary/octet-stream"
        )
}

pub(crate) fn extract_audio_url(payload: Option<&Value>) -> Option<String> {
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

pub(crate) fn audio_content_type_from_format(format: Option<&str>) -> &'static str {
    match format
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("mp3")
        .to_ascii_lowercase()
        .as_str()
    {
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        _ => "audio/mpeg",
    }
}

pub(crate) fn preferred_base_url(context: &ResolvedTtsContext) -> &str {
    if !context.connection.base_url.trim().is_empty() {
        context.connection.base_url.trim()
    } else if !context.instance.base_url.trim().is_empty() {
        context.instance.base_url.trim()
    } else if let Some(preset) = context.preset.as_ref() {
        preset.base_url.trim()
    } else {
        ""
    }
}

pub(crate) fn trim_secret(secret: Option<&str>) -> Option<&str> {
    secret.map(str::trim).filter(|value| !value.is_empty())
}

pub(crate) fn read_string(source: &Value, key: &str) -> Option<String> {
    source
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn read_i64(source: &Value, key: &str) -> Option<i64> {
    source.get(key).and_then(Value::as_i64)
}

#[cfg(test)]
mod tests {
    use super::{extract_error_message, resolve_voice_runtime_mode};
    use crate::modules::providers::types::{ProviderInstance, ProviderModel, ProviderPreset};
    use crate::modules::voice::types::VoiceRuntimeMode;
    use serde_json::json;
    use uuid::Uuid;

    fn mock_model() -> ProviderModel {
        ProviderModel {
            id: Uuid::new_v4(),
            instance_id: Uuid::new_v4(),
            model_id: "tts-1".to_string(),
            unified_model_id: None,
            display_name: None,
            capabilities: vec!["text_to_speech".to_string()],
            upstream_path: "v1/audio/speech".to_string(),
            pricing_config: json!({}),
            limit_config: json!({}),
            tokenizer_config: json!({}),
            routing_config: json!({}),
            config_override: json!({}),
            source: "manual".to_string(),
            extra_meta: json!({}),
            weight: 100,
            priority: 0,
            is_active: true,
            synced_at: None,
            created_at: None,
            updated_at: None,
        }
    }

    fn mock_instance() -> ProviderInstance {
        ProviderInstance {
            id: Uuid::new_v4(),
            preset_slug: "voice".to_string(),
            name: "Voice".to_string(),
            base_url: "https://example.com".to_string(),
            description: None,
            icon: None,
            priority: 0,
            meta: json!({}),
            is_enabled: true,
            is_local: false,
            credential_source: "local".to_string(),
            credentials_ref: "cred".to_string(),
            updated_at: String::new(),
            created_at: String::new(),
        }
    }

    fn mock_preset(provider: &str) -> ProviderPreset {
        ProviderPreset {
            slug: provider.to_string(),
            name: provider.to_string(),
            provider: provider.to_string(),
            base_url: "https://example.com".to_string(),
            icon: None,
            theme_color: None,
            category: None,
            url_template: None,
            auth_type: "bearer".to_string(),
            auth_config: json!({}),
            protocol_schema_version: None,
            protocol_profiles: json!({}),
            version: 1,
            is_active: true,
        }
    }

    #[test]
    fn resolve_voice_runtime_mode_prefers_model_override() {
        let mut model = mock_model();
        model.config_override = json!({ "voice_runtime": "minimax_tts" });
        let instance = mock_instance();
        let preset = mock_preset("openai");

        let mode = resolve_voice_runtime_mode(&model, &instance, Some(&preset), Some("openai"));

        assert_eq!(mode, VoiceRuntimeMode::MiniMaxTts);
    }

    #[test]
    fn resolve_voice_runtime_mode_falls_back_to_preset_provider() {
        let model = mock_model();
        let instance = mock_instance();
        let preset = mock_preset("volcengine_openspeech_tts");

        let mode = resolve_voice_runtime_mode(
            &model,
            &instance,
            Some(&preset),
            Some("volcengine_openspeech_tts"),
        );

        assert_eq!(mode, VoiceRuntimeMode::VolcengineTts);
    }

    #[test]
    fn resolve_voice_runtime_mode_accepts_volcengine_protocol_alias() {
        let model = mock_model();
        let instance = mock_instance();
        let preset = mock_preset("volcengine");

        let mode = resolve_voice_runtime_mode(&model, &instance, Some(&preset), Some("volcengine"));

        assert_eq!(mode, VoiceRuntimeMode::VolcengineTts);
    }

    #[test]
    fn extract_error_message_reads_volcengine_header_payload() {
        let message = extract_error_message(
            Some(&json!({
                "header": {
                    "reqid": "abc-123",
                    "code": 45000000,
                    "message": "speaker permission denied"
                }
            })),
            None,
            "fallback",
        );

        assert_eq!(
            message,
            "speaker permission denied (45000000, reqid: abc-123)"
        );
    }
}
