use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCapabilityRegistrySnapshot {
    pub capability_id: String,
    pub source_kind: String,
    pub asset_kind: String,
    pub package_id: String,
    pub package_version: Option<String>,
    pub title: String,
    pub description: String,
    pub tool_name: Option<String>,
    pub callable_name: Option<String>,
    pub binding_kind: Option<String>,
    pub execution_surface: String,
    pub runtime: Option<String>,
    pub entry_path: Option<String>,
    pub is_direct_callable: bool,
    pub activation_state: String,
    pub runtime_state: String,
    pub search_index_state: String,
    pub generation: i64,
    pub descriptor_json: serde_json::Value,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCapabilityRegistryUpsert {
    pub capability_id: String,
    pub source_kind: String,
    pub asset_kind: String,
    pub package_id: String,
    pub package_version: Option<String>,
    pub title: String,
    pub description: String,
    pub tool_name: Option<String>,
    pub callable_name: Option<String>,
    pub binding_kind: Option<String>,
    pub execution_surface: String,
    pub runtime: Option<String>,
    pub entry_path: Option<String>,
    pub is_direct_callable: bool,
    pub activation_state: String,
    pub runtime_state: String,
    pub search_index_state: String,
    pub generation: i64,
    pub descriptor_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCapabilityRegistryDiagnosticsBucket {
    pub key: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCapabilityRegistryDiagnosticsItem {
    pub capability_id: String,
    pub source_kind: String,
    pub asset_kind: String,
    pub package_id: String,
    pub package_version: Option<String>,
    pub title: String,
    pub tool_name: Option<String>,
    pub callable_name: Option<String>,
    pub execution_surface: String,
    pub activation_state: String,
    pub runtime_state: String,
    pub search_index_state: String,
    pub generation: i64,
    pub is_direct_callable: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCapabilityRegistryParityItem {
    pub key: String,
    pub asset_id: Option<String>,
    pub name: Option<String>,
    pub source_type: String,
    pub asset_type: String,
    pub package_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCapabilityRegistryDiagnosticsResponse {
    pub read_path_enabled: bool,
    pub read_path_mode: String,
    pub legacy_control_plane_reads_enabled: bool,
    pub current_generation: i64,
    pub total: i64,
    pub direct_callable_count: i64,
    pub source_kind_counts: Vec<LocalCapabilityRegistryDiagnosticsBucket>,
    pub memory_source_type_counts: Vec<LocalCapabilityRegistryDiagnosticsBucket>,
    pub asset_kind_counts: Vec<LocalCapabilityRegistryDiagnosticsBucket>,
    pub activation_state_counts: Vec<LocalCapabilityRegistryDiagnosticsBucket>,
    pub runtime_state_counts: Vec<LocalCapabilityRegistryDiagnosticsBucket>,
    pub search_index_state_counts: Vec<LocalCapabilityRegistryDiagnosticsBucket>,
    pub legacy_only_asset_count: i64,
    pub registry_first_only_asset_count: i64,
    pub migration_gaps: Vec<String>,
    pub legacy_only_assets: Vec<LocalCapabilityRegistryParityItem>,
    pub registry_first_only_assets: Vec<LocalCapabilityRegistryParityItem>,
    pub items: Vec<LocalCapabilityRegistryDiagnosticsItem>,
}
