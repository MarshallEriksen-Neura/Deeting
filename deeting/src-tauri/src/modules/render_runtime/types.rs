use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RenderRefreshSpec {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RenderRequest {
    pub hint: String,
    #[serde(default)]
    pub asset_id: Option<String>,
    #[serde(default)]
    pub data: Value,
    #[serde(default)]
    pub preferred_runtime: Option<String>,
    #[serde(default)]
    pub preferred_height: Option<u32>,
    #[serde(default)]
    pub live_channel_id: Option<String>,
    #[serde(default)]
    pub refresh_interval_ms: Option<u64>,
    #[serde(default)]
    pub expires_at_ms: Option<i64>,
    #[serde(default)]
    pub refresh_spec: Option<RenderRefreshSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AssistantRenderEnvelope {
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub render: Option<RenderRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RenderTemplateManifest {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub render_hint: Option<String>,
    #[serde(default)]
    pub runtime_mode: Option<String>,
    #[serde(default)]
    pub preferred_height: Option<u32>,
    #[serde(default)]
    pub template_version: Option<String>,
    #[serde(default)]
    pub allow_live_updates: Option<bool>,
    #[serde(default)]
    pub refresh_interval_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderCacheEntry {
    pub cache_key: String,
    pub template_id: String,
    pub render_hint: String,
    pub schema_fingerprint: String,
    pub runtime_mode: String,
    pub artifact_path: String,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}
