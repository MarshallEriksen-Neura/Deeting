use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSystemAssetPolicySnapshot {
    pub visibility_scope: String,
    pub local_sync_policy: String,
    pub execution_policy: String,
    pub permission_grants: Vec<String>,
    pub allowed_role_names: Vec<String>,
    pub materialization_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSystemAssetSyncItem {
    pub asset_id: String,
    pub title: String,
    pub description: Option<String>,
    pub asset_kind: String,
    pub owner_scope: String,
    pub source_kind: String,
    pub version: String,
    pub artifact_ref: Option<String>,
    pub checksum: Option<String>,
    #[serde(default)]
    pub metadata_json: Value,
    pub policy_snapshot: CloudSystemAssetPolicySnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSystemAssetSyncResponse {
    #[serde(default)]
    pub items: Vec<CloudSystemAssetSyncItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSystemAssetSyncResponse {
    pub fetched_count: i64,
    pub assistant_fetched_count: i64,
    pub skill_fetched_count: i64,
    pub upserted_count: i64,
    pub hidden_count: i64,
    pub metadata_only_count: i64,
    pub executable_count: i64,
    pub archived_count: i64,
    pub skill_install_fetched_count: i64,
    pub skill_install_upserted_count: i64,
    pub skill_reinstalled_count: i64,
    pub skill_failed_count: i64,
    pub disabled_skill_count: i64,
    pub archived_assistant_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSystemAssetRepairResponse {
    pub vector_dimension: i64,
    pub skill_reindexed_count: i64,
    pub assistant_reindexed_count: i64,
    pub sync: LocalSystemAssetSyncResponse,
}
