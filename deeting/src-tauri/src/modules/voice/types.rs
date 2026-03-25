use crate::modules::providers::store::ProviderConnection;
use crate::modules::providers::types::{ProviderInstance, ProviderModel, ProviderPreset};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VoiceRuntimeMode {
    OpenAiTts,
    MiniMaxTts,
    VolcengineTts,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedTtsContext {
    pub(crate) model: ProviderModel,
    pub(crate) instance: ProviderInstance,
    pub(crate) preset: Option<ProviderPreset>,
    pub(crate) connection: ProviderConnection,
    pub(crate) runtime_mode: VoiceRuntimeMode,
}
