use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VoiceCapabilityKind {
    TextToSpeech,
    SpeechToText,
}

impl VoiceCapabilityKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TextToSpeech => "text_to_speech",
            Self::SpeechToText => "speech_to_text",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TtsRequest {
    pub model: String,
    pub provider_model_id: String,
    pub text: String,
    pub voice: Option<String>,
    pub response_format: Option<String>,
    pub extra_params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SttRequest {
    pub model: String,
    pub provider_model_id: String,
    pub audio_url: Option<String>,
    pub audio_content_type: Option<String>,
    pub language: Option<String>,
    pub response_format: Option<String>,
    pub timestamp_granularities: Option<Vec<String>>,
    pub extra_params: Option<Value>,
}
