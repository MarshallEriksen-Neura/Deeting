use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssetRecord {
    pub asset_id: String,
    pub asset_kind: String,
    pub title: String,
    pub summary: Option<String>,
    pub origin_session_id: String,
    pub origin_turn_index: i64,
    pub source_block_id: Option<String>,
    pub source_view_type: String,
    pub render_hint: Option<String>,
    pub template_id: Option<String>,
    pub template_version: Option<String>,
    pub html_entry: Option<String>,
    pub data_mode: Option<String>,
    pub match_hints_json: Option<String>,
    pub props_hint_json: Option<String>,
    pub output_example_json: Option<String>,
    pub latest_snapshot_html: Option<String>,
    pub latest_render_data_json: Option<String>,
    pub refresh_spec_json: Option<String>,
    pub status: String,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_refreshed_at: Option<String>,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListLocalAssetsRequest {
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub pinned_only: Option<bool>,
    #[serde(default)]
    pub include_archived: Option<bool>,
    #[serde(default)]
    pub asset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateLocalAssetRequest {
    #[serde(default)]
    pub is_pinned: Option<bool>,
    #[serde(default)]
    pub is_archived: Option<bool>,
    #[serde(default)]
    pub mark_opened: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveLocalAssetRequest {
    pub asset_id: String,
    pub title: String,
    #[serde(default)]
    pub summary: Option<String>,
    pub html: String,
    #[serde(default)]
    pub asset_kind: Option<String>,
    #[serde(default)]
    pub source_view_type: Option<String>,
    #[serde(default)]
    pub render_hint: Option<String>,
    #[serde(default)]
    pub template_version: Option<String>,
    #[serde(default)]
    pub origin_session_id: Option<String>,
    #[serde(default)]
    pub origin_turn_index: Option<i64>,
    #[serde(default)]
    pub source_block_id: Option<String>,
    #[serde(default)]
    pub data_mode: Option<String>,
    #[serde(default)]
    pub match_hints: Option<Vec<String>>,
    #[serde(default)]
    pub props_hint: Option<Vec<String>>,
    #[serde(default)]
    pub output_example: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveLocalAssetManifest {
    pub asset_id: String,
    pub title: String,
    #[serde(default)]
    pub summary: Option<String>,
    pub data_mode: String,
    pub html_entry: String,
    #[serde(default)]
    pub render_hint: Option<String>,
    #[serde(default)]
    pub match_hints: Vec<String>,
    #[serde(default)]
    pub props_hint: Vec<String>,
    #[serde(default)]
    pub output_example: Option<Value>,
    #[serde(default)]
    pub template_version: Option<String>,
}
