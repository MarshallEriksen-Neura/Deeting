use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanRun {
    pub run_id: String,
    pub trigger: String,
    pub target_kind: String,
    pub target_path: String,
    pub started_at: String,
    pub finished_at: String,
    pub summary: ScanSummary,
    pub documents: Vec<ScanDocument>,
    pub findings: Vec<ScanFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ScanSummary {
    pub document_count: usize,
    pub finding_count: usize,
    pub warning_count: usize,
    pub error_count: usize,
    pub skill_bundle_count: usize,
    pub index_missing_count: usize,
    pub install_missing_count: usize,
    pub security_warning_count: usize,
    pub high_risk_script_count: usize,
    pub missing_skill_doc_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanDocument {
    pub id: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
    pub document_kind: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanFinding {
    pub id: String,
    pub severity: String,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<ScanFindingAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanFindingAction {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default)]
    pub destructive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ScanReviewActionRequest {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReviewBatchRequest {
    #[serde(default)]
    pub actions: Vec<ScanReviewActionRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReviewActionResult {
    pub kind: String,
    pub status: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReviewBatchResult {
    pub total: usize,
    pub applied: usize,
    pub failed: usize,
    pub skipped: usize,
    #[serde(default)]
    pub results: Vec<ScanReviewActionResult>,
}