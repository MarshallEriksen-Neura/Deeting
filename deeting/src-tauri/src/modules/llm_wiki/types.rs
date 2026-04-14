use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiBinding {
    pub vault_root: String,
    pub vault_name: String,
    pub workspace_relative_path: String,
    pub read_scope: String,
    pub write_scope: String,
    pub is_probable_obsidian_vault: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiCandidateFolder {
    pub relative_path: String,
    pub reason: String,
    pub score: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiVaultScanSummary {
    pub detected_obsidian_config: bool,
    pub total_markdown_files: i64,
    pub total_attachment_files: i64,
    pub total_directories: i64,
    pub candidate_folders: Vec<LocalLlmWikiCandidateFolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiWorkspaceStatus {
    pub resolved_workspace_path: String,
    pub workspace_exists: bool,
    pub has_readme: bool,
    pub has_agents: bool,
    pub has_home: bool,
    pub has_index: bool,
    pub has_log: bool,
    pub has_raw: bool,
    pub has_wiki: bool,
    pub ready_file_count: i64,
    pub last_bootstrapped_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiCorpusStatus {
    pub indexed_note_count: i64,
    pub managed_workspace_note_count: i64,
    pub legacy_vault_note_count: i64,
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiMaintainerAgentSummary {
    pub agent_id: String,
    pub name: String,
    pub source_path: Option<String>,
    pub updated_at: String,
    pub discoverable: bool,
    pub is_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiAutomationSettings {
    pub auto_sync_on_vault_bound: bool,
    pub suggest_maintainer_on_workspace_bootstrap: bool,
    pub auto_refresh_inspector_on_corpus_sync: bool,
    pub create_crystallization_candidates_on_session_end: bool,
    pub enable_schedule_suggestions: bool,
    pub suggest_on_valuable_answer: bool,
    pub auto_delegate_new_sources: bool,
    pub auto_delegate_maintenance_schedule: bool,
    pub promote_repeated_stable_conclusions_to_memory: bool,
}

impl Default for LocalLlmWikiAutomationSettings {
    fn default() -> Self {
        Self {
            auto_sync_on_vault_bound: true,
            suggest_maintainer_on_workspace_bootstrap: true,
            auto_refresh_inspector_on_corpus_sync: true,
            create_crystallization_candidates_on_session_end: true,
            enable_schedule_suggestions: true,
            suggest_on_valuable_answer: true,
            auto_delegate_new_sources: false,
            auto_delegate_maintenance_schedule: false,
            promote_repeated_stable_conclusions_to_memory: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiAutomationSuggestion {
    pub id: String,
    pub fingerprint: String,
    pub trigger: String,
    pub action_kind: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiAutomationAuditEntry {
    pub id: String,
    pub trigger: String,
    pub level: String,
    pub disposition: String,
    pub message: String,
    pub created_at: String,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiAutomationState {
    pub settings: LocalLlmWikiAutomationSettings,
    pub suggestions: Vec<LocalLlmWikiAutomationSuggestion>,
    pub audit: Vec<LocalLlmWikiAutomationAuditEntry>,
    pub last_schedule_run_at: Option<String>,
}

impl Default for LocalLlmWikiAutomationState {
    fn default() -> Self {
        Self {
            settings: LocalLlmWikiAutomationSettings::default(),
            suggestions: Vec::new(),
            audit: Vec::new(),
            last_schedule_run_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiState {
    pub binding: Option<LocalLlmWikiBinding>,
    pub scan_summary: Option<LocalLlmWikiVaultScanSummary>,
    pub workspace_status: Option<LocalLlmWikiWorkspaceStatus>,
    pub corpus_status: Option<LocalLlmWikiCorpusStatus>,
    pub maintainer_agent: Option<LocalLlmWikiMaintainerAgentSummary>,
    pub recommended_agent_prompt: Option<String>,
    pub automation: LocalLlmWikiAutomationState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocalLlmWikiBindingRequest {
    pub vault_root: String,
    pub workspace_relative_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapLocalLlmWikiWorkspaceResult {
    pub workspace_path: String,
    pub created_directories: Vec<String>,
    pub created_files: Vec<String>,
    pub skipped_files: Vec<String>,
    pub state: LocalLlmWikiState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrUpdateLocalLlmWikiMaintainerAgentResult {
    pub state: LocalLlmWikiState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLocalLlmWikiCorpusResult {
    pub indexed_files: i64,
    pub removed_files: i64,
    pub state: LocalLlmWikiState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalLlmWikiCorpusRequest {
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiCorpusSearchHit {
    pub asset_id: String,
    pub relative_path: String,
    pub title: String,
    pub scope: String,
    pub summary: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLocalLlmWikiCorpusResult {
    pub hits: Vec<LocalLlmWikiCorpusSearchHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLocalLlmWikiAutomationSettingsRequest {
    pub auto_sync_on_vault_bound: Option<bool>,
    pub suggest_maintainer_on_workspace_bootstrap: Option<bool>,
    pub auto_refresh_inspector_on_corpus_sync: Option<bool>,
    pub create_crystallization_candidates_on_session_end: Option<bool>,
    pub enable_schedule_suggestions: Option<bool>,
    pub suggest_on_valuable_answer: Option<bool>,
    pub auto_delegate_new_sources: Option<bool>,
    pub auto_delegate_maintenance_schedule: Option<bool>,
    pub promote_repeated_stable_conclusions_to_memory: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmWikiAutomationExecutionResult {
    pub state: LocalLlmWikiState,
    pub workflow_run_id: Option<String>,
    pub memory_action: Option<String>,
    pub message: Option<String>,
}
