use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEFAULT_EXTERNAL_SOURCE_BASE_URL: &str = "https://evomap.ai";
pub const DEFAULT_EXTERNAL_SOURCE_SYNC_INTERVAL_MINUTES: i64 = 360;
pub const MIN_EXTERNAL_SOURCE_SYNC_INTERVAL_MINUTES: i64 = 15;
pub const MAX_EXTERNAL_SOURCE_SYNC_INTERVAL_MINUTES: i64 = 7 * 24 * 60;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExternalSourceConnectorType {
    ManualImport,
    EvomapPublicFeed,
    EvomapKg,
}

impl ExternalSourceConnectorType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ManualImport => "manual_import",
            Self::EvomapPublicFeed => "evomap_public_feed",
            Self::EvomapKg => "evomap_kg",
        }
    }

    pub fn auth_mode(self) -> ExternalSourceAuthMode {
        match self {
            Self::ManualImport | Self::EvomapPublicFeed => ExternalSourceAuthMode::None,
            Self::EvomapKg => ExternalSourceAuthMode::ApiKey,
        }
    }

    pub fn default_base_url(self) -> Option<&'static str> {
        match self {
            Self::ManualImport => None,
            Self::EvomapPublicFeed | Self::EvomapKg => Some(DEFAULT_EXTERNAL_SOURCE_BASE_URL),
        }
    }
}

impl std::str::FromStr for ExternalSourceConnectorType {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "manual_import" => Ok(Self::ManualImport),
            "evomap_public_feed" => Ok(Self::EvomapPublicFeed),
            "evomap_kg" => Ok(Self::EvomapKg),
            other => Err(format!(
                "unsupported external source connector type: {other}"
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExternalSourceAuthMode {
    None,
    ApiKey,
}

impl ExternalSourceAuthMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::ApiKey => "api_key",
        }
    }
}

impl std::str::FromStr for ExternalSourceAuthMode {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "none" => Ok(Self::None),
            "api_key" => Ok(Self::ApiKey),
            other => Err(format!("unsupported external source auth mode: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExternalSourceSyncMode {
    Manual,
    Scheduled,
}

impl ExternalSourceSyncMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Scheduled => "scheduled",
        }
    }
}

impl std::str::FromStr for ExternalSourceSyncMode {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "manual" => Ok(Self::Manual),
            "scheduled" => Ok(Self::Scheduled),
            other => Err(format!("unsupported external source sync mode: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExternalSourceStatus {
    Draft,
    Ready,
    Syncing,
    Error,
    Disabled,
}

impl ExternalSourceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Ready => "ready",
            Self::Syncing => "syncing",
            Self::Error => "error",
            Self::Disabled => "disabled",
        }
    }
}

impl std::str::FromStr for ExternalSourceStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "draft" => Ok(Self::Draft),
            "ready" => Ok(Self::Ready),
            "syncing" => Ok(Self::Syncing),
            "error" => Ok(Self::Error),
            "disabled" => Ok(Self::Disabled),
            other => Err(format!("unsupported external source status: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalSourceRecord {
    pub id: String,
    pub display_name: String,
    pub connector_type: ExternalSourceConnectorType,
    pub auth_mode: ExternalSourceAuthMode,
    pub base_url: Option<String>,
    pub is_enabled: bool,
    pub sync_mode: ExternalSourceSyncMode,
    pub sync_interval_minutes: i64,
    pub status: ExternalSourceStatus,
    pub last_synced_at: Option<String>,
    pub last_error: Option<String>,
    pub trust_level: String,
    pub has_credentials: bool,
    pub metadata_json: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalRawRecord {
    pub id: String,
    pub source_id: String,
    pub source_asset_id: String,
    pub source_version: Option<String>,
    pub asset_family: String,
    pub observed_at_unix_ms: i64,
    pub freshness_hint: Option<f64>,
    pub content_hash: String,
    pub raw_payload_json: String,
    pub translation_status: String,
    pub translated_at_unix_ms: Option<i64>,
    pub translation_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalExperienceCandidate {
    pub id: String,
    pub source_id: String,
    pub raw_record_id: String,
    pub candidate_kind: String,
    pub title: String,
    pub summary: String,
    pub canonical_payload_json: String,
    pub provenance_json: String,
    pub confidence: f64,
    pub validation_status: String,
    pub review_status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejected_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted_target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted_ref: Option<String>,
    pub adoption_status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adopted_memory_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adoption_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adopted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateExternalSourceRequest {
    pub display_name: String,
    pub connector_type: ExternalSourceConnectorType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_mode: Option<ExternalSourceSyncMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_interval_minutes: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct UpdateExternalSourceRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clear_api_key: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_mode: Option<ExternalSourceSyncMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_interval_minutes: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalSourceConnectionTestResult {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    pub message: String,
    pub connector_type: ExternalSourceConnectorType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub discovered_targets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalSourceSyncResult {
    pub source_id: String,
    pub connector_type: ExternalSourceConnectorType,
    pub fetched_count: usize,
    pub stored_count: usize,
    #[serde(default)]
    pub synced_targets: Vec<String>,
    pub synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateManualExternalRawRecordRequest {
    pub asset_family: String,
    pub source_asset_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_version: Option<String>,
    pub payload_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freshness_hint: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_mode: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct NewExternalRawRecord {
    pub record_key: String,
    pub source_id: String,
    pub source_asset_id: String,
    pub source_version: Option<String>,
    pub asset_family: String,
    pub observed_at_unix_ms: i64,
    pub freshness_hint: Option<f64>,
    pub content_hash: String,
    pub raw_payload_json: String,
    pub translation_status: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ExternalRawRecordForTranslation {
    pub record: ExternalRawRecord,
    pub connector_type: ExternalSourceConnectorType,
    pub source_display_name: String,
}

#[derive(Debug, Clone)]
pub(crate) struct NewExternalExperienceCandidate {
    pub source_id: String,
    pub raw_record_id: String,
    pub candidate_kind: String,
    pub title: String,
    pub summary: String,
    pub canonical_payload_json: String,
    pub provenance_json: String,
    pub confidence: f64,
    pub validation_status: String,
    pub review_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ListExternalExperienceCandidatesRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_record_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewExternalExperienceCandidateRequest {
    pub review_status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejected_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct AcceptExternalExperienceCandidateRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AcceptExternalExperienceCandidateResult {
    pub candidate: ExternalExperienceCandidate,
    pub accepted_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct AdoptExternalExperienceCandidateRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AdoptExternalExperienceCandidateResult {
    pub candidate: ExternalExperienceCandidate,
    pub memory_id: String,
    pub memory_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalSourceTranslationRunResult {
    pub translated_count: usize,
    pub failed_count: usize,
}

pub(crate) fn normalize_sync_interval_minutes(value: Option<i64>) -> i64 {
    value
        .unwrap_or(DEFAULT_EXTERNAL_SOURCE_SYNC_INTERVAL_MINUTES)
        .clamp(
            MIN_EXTERNAL_SOURCE_SYNC_INTERVAL_MINUTES,
            MAX_EXTERNAL_SOURCE_SYNC_INTERVAL_MINUTES,
        )
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_sync_interval_minutes, ExternalSourceAuthMode, ExternalSourceConnectorType,
        ExternalSourceSyncMode,
    };

    #[test]
    fn connector_type_implies_auth_mode() {
        assert_eq!(
            ExternalSourceConnectorType::ManualImport.auth_mode(),
            ExternalSourceAuthMode::None
        );
        assert_eq!(
            ExternalSourceConnectorType::EvomapPublicFeed.auth_mode(),
            ExternalSourceAuthMode::None
        );
        assert_eq!(
            ExternalSourceConnectorType::EvomapKg.auth_mode(),
            ExternalSourceAuthMode::ApiKey
        );
    }

    #[test]
    fn sync_interval_is_clamped() {
        assert_eq!(normalize_sync_interval_minutes(Some(1)), 15);
        assert_eq!(normalize_sync_interval_minutes(Some(30)), 30);
        assert_eq!(normalize_sync_interval_minutes(Some(50_000)), 10_080);
    }

    #[test]
    fn sync_mode_roundtrips() {
        assert_eq!(
            "manual"
                .parse::<ExternalSourceSyncMode>()
                .expect("manual mode"),
            ExternalSourceSyncMode::Manual
        );
        assert_eq!(ExternalSourceSyncMode::Scheduled.as_str(), "scheduled");
    }
}
