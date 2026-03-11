use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpSourceType {
    Local,
    Cloud,
    Modelscope,
    Github,
    Url,
    Skill,
}

impl McpSourceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            McpSourceType::Local => "local",
            McpSourceType::Cloud => "cloud",
            McpSourceType::Modelscope => "modelscope",
            McpSourceType::Github => "github",
            McpSourceType::Url => "url",
            McpSourceType::Skill => "skill",
        }
    }
}

impl std::str::FromStr for McpSourceType {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "local" => Ok(McpSourceType::Local),
            "cloud" => Ok(McpSourceType::Cloud),
            "modelscope" => Ok(McpSourceType::Modelscope),
            "github" => Ok(McpSourceType::Github),
            "url" => Ok(McpSourceType::Url),
            "skill" => Ok(McpSourceType::Skill),
            _ => Err(format!("unknown source type: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpSourceStatus {
    Active,
    Inactive,
    Syncing,
    Error,
}

impl McpSourceStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            McpSourceStatus::Active => "active",
            McpSourceStatus::Inactive => "inactive",
            McpSourceStatus::Syncing => "syncing",
            McpSourceStatus::Error => "error",
        }
    }
}

impl std::str::FromStr for McpSourceStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "active" => Ok(McpSourceStatus::Active),
            "inactive" => Ok(McpSourceStatus::Inactive),
            "syncing" => Ok(McpSourceStatus::Syncing),
            "error" => Ok(McpSourceStatus::Error),
            _ => Err(format!("unknown source status: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpTrustLevel {
    Official,
    Community,
    Private,
}

impl McpTrustLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            McpTrustLevel::Official => "official",
            McpTrustLevel::Community => "community",
            McpTrustLevel::Private => "private",
        }
    }
}

impl std::str::FromStr for McpTrustLevel {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "official" => Ok(McpTrustLevel::Official),
            "community" => Ok(McpTrustLevel::Community),
            "private" => Ok(McpTrustLevel::Private),
            _ => Err(format!("unknown trust level: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpToolStatus {
    Pending,
    Stopped,
    Starting,
    Healthy,
    Degraded,
    Crashed,
    Updating,
    Error,
    Orphaned,
}

impl McpToolStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            McpToolStatus::Pending => "pending",
            McpToolStatus::Stopped => "stopped",
            McpToolStatus::Starting => "starting",
            McpToolStatus::Healthy => "healthy",
            McpToolStatus::Degraded => "degraded",
            McpToolStatus::Crashed => "crashed",
            McpToolStatus::Updating => "updating",
            McpToolStatus::Error => "error",
            McpToolStatus::Orphaned => "orphaned",
        }
    }
}

impl std::str::FromStr for McpToolStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "pending" => Ok(McpToolStatus::Pending),
            "stopped" => Ok(McpToolStatus::Stopped),
            "starting" => Ok(McpToolStatus::Starting),
            "healthy" => Ok(McpToolStatus::Healthy),
            "degraded" => Ok(McpToolStatus::Degraded),
            "crashed" => Ok(McpToolStatus::Crashed),
            "updating" => Ok(McpToolStatus::Updating),
            "error" => Ok(McpToolStatus::Error),
            "orphaned" => Ok(McpToolStatus::Orphaned),
            _ => Err(format!("unknown tool status: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpConflictStatus {
    None,
    UpdateAvailable,
    Conflict,
}

impl McpConflictStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            McpConflictStatus::None => "none",
            McpConflictStatus::UpdateAvailable => "update_available",
            McpConflictStatus::Conflict => "conflict",
        }
    }
}

impl std::str::FromStr for McpConflictStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "none" => Ok(McpConflictStatus::None),
            "update_available" => Ok(McpConflictStatus::UpdateAvailable),
            "conflict" => Ok(McpConflictStatus::Conflict),
            _ => Err(format!("unknown conflict status: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpSource {
    pub id: String,
    pub name: String,
    pub source_type: McpSourceType,
    pub path_or_url: String,
    pub trust_level: McpTrustLevel,
    pub status: McpSourceStatus,
    pub last_synced_at: Option<String>,
    pub is_read_only: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub id: String,
    pub identifier: Option<String>,
    pub name: String,
    pub source_type: McpSourceType,
    pub source_id: Option<String>,
    pub status: McpToolStatus,
    pub ping_ms: Option<i64>,
    pub capabilities: Vec<String>,
    pub description: String,
    pub error: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub config_json: String,
    pub pending_config_json: Option<String>,
    pub config_hash: String,
    pub pending_config_hash: Option<String>,
    pub conflict_status: McpConflictStatus,
    pub is_read_only: bool,
    pub is_new: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpTransportKind {
    Stdio,
    Sse,
    Unknown,
}

fn normalized_transport_kind(value: Option<&str>) -> Option<McpTransportKind> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(raw) if raw.eq_ignore_ascii_case("stdio") => Some(McpTransportKind::Stdio),
        Some(raw) if raw.eq_ignore_ascii_case("sse") => Some(McpTransportKind::Sse),
        Some(_) => Some(McpTransportKind::Unknown),
        None => None,
    }
}

impl McpTool {
    fn config_value(&self) -> Option<Value> {
        serde_json::from_str(&self.config_json).ok()
    }

    pub fn has_local_command(&self) -> bool {
        self.command
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
    }

    pub fn transport_kind(&self) -> McpTransportKind {
        self.config_value()
            .as_ref()
            .and_then(|value| {
                value
                    .get("transport")
                    .and_then(Value::as_str)
                    .or_else(|| value.get("server_type").and_then(Value::as_str))
                    .or_else(|| value.get("type").and_then(Value::as_str))
            })
            .and_then(|value| normalized_transport_kind(Some(value)))
            .unwrap_or_else(|| {
                if self.has_local_command() {
                    McpTransportKind::Stdio
                } else {
                    McpTransportKind::Unknown
                }
            })
    }

    pub fn supports_local_process_lifecycle(&self) -> bool {
        self.transport_kind() == McpTransportKind::Stdio && self.has_local_command()
    }

    pub fn transport_label(&self) -> &'static str {
        match self.transport_kind() {
            McpTransportKind::Stdio => "stdio",
            McpTransportKind::Sse => "sse",
            McpTransportKind::Unknown => "unknown",
        }
    }

    pub fn is_remote_sse(&self) -> bool {
        self.transport_kind() == McpTransportKind::Sse
    }

    pub fn remote_sse_url(&self) -> Option<String> {
        self.config_value().and_then(|value| {
            value
                .get("sse_url")
                .and_then(Value::as_str)
                .or_else(|| value.get("url").and_then(Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
    }

    pub fn remote_tool_name(&self) -> Option<String> {
        self.config_value()
            .and_then(|value| {
                value
                    .get("remote_tool_name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .or_else(|| {
                self.is_remote_sse()
                    .then_some(self.name.trim().to_string())
                    .filter(|value| !value.is_empty())
            })
    }

    pub fn remote_server_name(&self) -> Option<String> {
        self.config_value().and_then(|value| {
            value
                .get("server_name")
                .and_then(Value::as_str)
                .or_else(|| value.get("source_entry_name").and_then(Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
    }

    pub fn is_stdio_mcp_tool(&self) -> bool {
        self.transport_kind() == McpTransportKind::Stdio
            && self
                .config_value()
                .as_ref()
                .and_then(|value| value.get("runtime_protocol").and_then(Value::as_str))
                .map(|value| value.eq_ignore_ascii_case("mcp"))
                .unwrap_or(false)
    }

    pub fn stdio_mcp_tool_name(&self) -> Option<String> {
        if !self.is_stdio_mcp_tool() {
            return None;
        }
        self.config_value()
            .and_then(|value| {
                value
                    .get("mcp_tool_name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .or_else(|| Some(self.name.trim().to_string()).filter(|value| !value.is_empty()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolConfigPayload {
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub description: Option<String>,
    pub capabilities: Option<Vec<String>>,
    #[serde(rename = "type")]
    pub transport_type: Option<String>,
    pub url: Option<String>,
    pub sse_url: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl McpToolConfigPayload {
    pub fn transport_kind(&self) -> McpTransportKind {
        normalized_transport_kind(self.transport_type.as_deref()).unwrap_or_else(|| {
            if self.command.is_some() {
                McpTransportKind::Stdio
            } else if self.sse_url.is_some() || self.url.is_some() {
                McpTransportKind::Sse
            } else {
                McpTransportKind::Unknown
            }
        })
    }

    pub fn remote_sse_url(&self) -> Option<&str> {
        self.sse_url
            .as_deref()
            .or(self.url.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfigPayload {
    #[serde(rename = "mcpServers")]
    pub mcp_servers: HashMap<String, McpToolConfigPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSourceRequest {
    pub name: String,
    pub source_type: McpSourceType,
    pub path_or_url: String,
    pub trust_level: McpTrustLevel,
    pub is_read_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportConfigRequest {
    pub source_id: Option<String>,
    pub config: McpConfigPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSourceRequest {
    pub auth_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateToolConfigRequest {
    pub apply_pending: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveConflictRequest {
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpLogEntry {
    pub timestamp: String,
    pub stream: McpLogStream,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpLogStream {
    Stdout,
    Stderr,
    Event,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistant {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub system_prompt: String,
    pub model_config: Option<Value>,
    pub tags: Vec<String>,
    pub visibility: String,
    pub source: String,
    pub cloud_id: Option<String>,
    pub is_deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantEntity {
    pub id: String,
    pub owner_user_id: Option<String>,
    pub visibility: String,
    pub status: String,
    pub share_slug: Option<String>,
    pub summary: Option<String>,
    pub icon_id: Option<String>,
    pub install_count: i64,
    pub rating_avg: f64,
    pub rating_count: i64,
    pub current_version_id: Option<String>,
    pub published_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantVersion {
    pub id: String,
    pub assistant_id: String,
    pub version: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub model_config: Option<Value>,
    pub tags: Vec<String>,
    pub changelog: Option<String>,
    pub published_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantSummaryVersion {
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub tags: Vec<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSystemAssistantVersionSnapshot {
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub tags: Vec<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSystemAssistantSnapshot {
    pub assistant_id: String,
    pub icon_id: Option<String>,
    pub share_slug: Option<String>,
    pub summary: Option<String>,
    pub published_at: Option<String>,
    pub install_count: i64,
    pub rating_avg: f64,
    pub rating_count: i64,
    pub version: CloudSystemAssistantVersionSnapshot,
}

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
    pub disabled_assistant_install_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSystemAssetRepairResponse {
    pub vector_dimension: i64,
    pub skill_reindexed_count: i64,
    pub assistant_reindexed_count: i64,
    pub sync: LocalSystemAssetSyncResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantSummary {
    pub assistant_id: String,
    pub owner_user_id: Option<String>,
    pub icon_id: Option<String>,
    pub share_slug: Option<String>,
    pub summary: Option<String>,
    pub published_at: Option<String>,
    pub current_version_id: Option<String>,
    pub install_count: i64,
    pub rating_avg: f64,
    pub rating_count: i64,
    pub tags: Vec<String>,
    pub version: LocalAssistantSummaryVersion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantInstallItem {
    pub id: String,
    pub assistant_id: String,
    pub alias: Option<String>,
    pub icon_override: Option<String>,
    pub pinned_version_id: Option<String>,
    pub follow_latest: bool,
    pub is_enabled: bool,
    pub sort_order: i64,
    pub assistant: LocalAssistantSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantInstallPage {
    pub items: Vec<LocalAssistantInstallItem>,
    pub next_page: Option<String>,
    pub previous_page: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantTag {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantInstallQuery {
    pub cursor: Option<String>,
    pub size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantInstallCreateRequest {
    pub follow_latest: Option<bool>,
    pub pinned_version_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantInstallUpdateRequest {
    pub alias: Option<String>,
    pub icon_override: Option<String>,
    pub pinned_version_id: Option<String>,
    pub follow_latest: Option<bool>,
    pub is_enabled: Option<bool>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRatingRequest {
    pub rating: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRatingResponse {
    pub assistant_id: String,
    pub rating_avg: f64,
    pub rating_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingState {
    pub assistant_id: String,
    pub total_trials: i64,
    pub positive_feedback: i64,
    pub negative_feedback: i64,
    pub last_used_at: Option<String>,
    pub last_feedback_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingFeedbackRequest {
    pub event: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingReportQuery {
    pub min_trials: Option<i64>,
    pub min_rating: Option<f64>,
    pub limit: Option<i64>,
    pub sort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingReportItem {
    pub assistant_id: String,
    pub name: Option<String>,
    pub summary: Option<String>,
    pub total_trials: i64,
    pub positive_feedback: i64,
    pub negative_feedback: i64,
    pub rating_score: f64,
    pub mab_score: f64,
    pub routing_score: f64,
    pub exploration_bonus: f64,
    pub last_used_at: Option<String>,
    pub last_feedback_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingReportSummary {
    pub total_assistants: i64,
    pub total_trials: i64,
    pub total_positive: i64,
    pub total_negative: i64,
    pub overall_rating: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantRoutingReportResponse {
    pub summary: LocalAssistantRoutingReportSummary,
    pub items: Vec<LocalAssistantRoutingReportItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalTraceFeedbackRequest {
    pub trace_id: String,
    pub score: f64,
    pub comment: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalTraceFeedback {
    pub id: String,
    pub trace_id: String,
    pub user_id: Option<String>,
    pub score: f64,
    pub comment: Option<String>,
    pub tags: Option<Vec<String>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGatewayLogQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub model: Option<String>,
    pub status_code: Option<i64>,
    pub is_cached: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGatewayLogItem {
    pub id: String,
    pub trace_id: Option<String>,
    pub user_id: Option<String>,
    pub api_key_id: Option<String>,
    pub model: String,
    pub status_code: i64,
    pub duration_ms: i64,
    pub ttft_ms: Option<i64>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_user: f64,
    pub is_cached: bool,
    pub error_code: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGatewayLogListResponse {
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
    pub items: Vec<LocalGatewayLogItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGatewayLogStatsBucket {
    pub key: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGatewayLogStatsResponse {
    pub total: i64,
    pub success_rate: f64,
    pub cache_hit_rate: f64,
    pub error_distribution: Vec<LocalGatewayLogStatsBucket>,
    pub model_ranking: Vec<LocalGatewayLogStatsBucket>,
    pub latency_histogram: Vec<LocalGatewayLogStatsBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeTreeQuery {
    pub parent_id: Option<String>,
    pub q: Option<String>,
    pub sort_field: Option<String>,
    pub sort_direction: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub file_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeFile {
    pub id: String,
    pub name: String,
    pub file_type: String,
    pub size: i64,
    pub status: String,
    pub chunks: Option<i64>,
    pub error_message: Option<String>,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeChunk {
    pub id: String,
    pub file_id: String,
    pub index: i64,
    pub content: String,
    pub token_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeBreadcrumbItem {
    pub id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeTreeResponse {
    pub folders: Vec<LocalKnowledgeFolder>,
    pub files: Vec<LocalKnowledgeFile>,
    pub breadcrumb: Vec<LocalKnowledgeBreadcrumbItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeStatsResponse {
    pub used_bytes: i64,
    pub total_bytes: i64,
    pub total_vectors: i64,
    pub total_files: i64,
    pub total_folders: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeChunkListResponse {
    pub items: Vec<LocalKnowledgeChunk>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalKnowledgeSearchHit {
    pub chunk_id: String,
    pub file_id: String,
    pub file_name: String,
    pub index: i64,
    pub content: String,
    pub token_count: i64,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLocalKnowledgeFolderRequest {
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateLocalKnowledgeFolderRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLocalUserDocumentRequest {
    pub filename: String,
    pub folder_id: Option<String>,
    pub media_asset_id: Option<String>,
    pub status: Option<String>,
    pub error_message: Option<String>,
    pub chunk_count: Option<i64>,
    pub embedding_model: Option<String>,
    pub meta_info: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateLocalUserDocumentRequest {
    pub name: Option<String>,
    pub folder_id: Option<String>,
    pub folder_id_provided: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalUserDocumentListQuery {
    pub folder_id: Option<String>,
    pub status: Option<String>,
    pub q: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalUserDocumentChunkListQuery {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub status: Option<String>,
    pub channel: Option<String>,
    pub user_id: Option<String>,
    pub assistant_id: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationItem {
    pub id: String,
    pub title: Option<String>,
    pub user_id: Option<String>,
    pub assistant_id: Option<String>,
    pub channel: String,
    pub status: String,
    pub message_count: i64,
    pub first_message_at: Option<String>,
    pub last_active_at: Option<String>,
    pub last_summary_version: i64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationListResponse {
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
    pub items: Vec<LocalAdminConversationItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationMessageQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub include_deleted: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationMessageItem {
    pub id: String,
    pub session_id: String,
    pub turn_index: i64,
    pub role: String,
    pub content: Option<String>,
    pub name: Option<String>,
    pub token_estimate: i64,
    pub meta_info: Option<Value>,
    pub used_persona_id: Option<String>,
    pub is_deleted: bool,
    pub parent_message_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationMessageListResponse {
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
    pub items: Vec<LocalAdminConversationMessageItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationSummaryItem {
    pub id: String,
    pub session_id: String,
    pub version: i64,
    pub summary_text: String,
    pub covered_from_turn: i64,
    pub covered_to_turn: i64,
    pub token_estimate: i64,
    pub summarizer_model: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAdminConversationSummaryListResponse {
    pub items: Vec<LocalAdminConversationSummaryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryJobQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub status: Option<String>,
    pub session_id: Option<String>,
    pub error_contains: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryJobItem {
    pub id: String,
    pub session_id: String,
    pub status: String,
    pub trigger_source: Option<String>,
    pub attempts: i64,
    pub max_attempts: i64,
    pub available_after_epoch: i64,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryJobListResponse {
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
    pub items: Vec<LocalConversationSummaryJobItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryIdleTaskQuery {
    pub skip: Option<i64>,
    pub limit: Option<i64>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryIdleTaskItem {
    pub session_id: String,
    pub last_active_epoch: i64,
    pub run_after_epoch: i64,
    pub is_due: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryIdleTaskListResponse {
    pub total: i64,
    pub skip: i64,
    pub limit: i64,
    pub items: Vec<LocalConversationSummaryIdleTaskItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryQueueStats {
    pub pending_jobs: i64,
    pub running_jobs: i64,
    pub completed_jobs: i64,
    pub failed_jobs: i64,
    pub idle_due_tasks: i64,
    pub idle_total_tasks: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryEnqueueResponse {
    pub session_id: String,
    pub queued: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryBatchRetryRequest {
    pub limit: Option<i64>,
    pub status: Option<String>,
    pub session_id: Option<String>,
    pub error_contains: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSummaryBatchRetryResponse {
    pub matched_count: i64,
    pub queued_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantPreviewRequest {
    pub message: String,
    pub stream: Option<bool>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLocalAssistantRequest {
    pub name: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub system_prompt: String,
    pub model_config: Option<Value>,
    pub tags: Option<Vec<String>>,
    pub visibility: Option<String>,
    pub source: Option<String>,
    pub cloud_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateLocalAssistantRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub system_prompt: Option<String>,
    pub model_config: Option<Value>,
    pub tags: Option<Vec<String>>,
    pub visibility: Option<String>,
    pub source: Option<String>,
    pub cloud_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAssistantMessage {
    pub id: String,
    pub assistant_id: String,
    pub role: String,
    pub content: String,
    pub is_deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAssistantMessageRequest {
    pub assistant_id: String,
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatInputMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatRequest {
    pub assistant_id: Option<String>,
    pub model: String,
    pub messages: Vec<LocalChatInputMessage>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatToolCall {
    pub id: Option<String>,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatResponse {
    pub content: String,
    pub tool_calls: Vec<LocalChatToolCall>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalConversationStatus {
    Active,
    Archived,
    Closed,
}

impl LocalConversationStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            LocalConversationStatus::Active => "active",
            LocalConversationStatus::Archived => "archived",
            LocalConversationStatus::Closed => "closed",
        }
    }
}

impl std::str::FromStr for LocalConversationStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "active" => Ok(LocalConversationStatus::Active),
            "archived" => Ok(LocalConversationStatus::Archived),
            "closed" => Ok(LocalConversationStatus::Closed),
            _ => Err(format!("unknown conversation status: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSessionItem {
    pub session_id: String,
    pub title: Option<String>,
    pub summary_text: Option<String>,
    pub message_count: i64,
    pub first_message_at: Option<String>,
    pub last_active_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSessionPage {
    pub items: Vec<LocalConversationSessionItem>,
    pub next_page: Option<String>,
    pub previous_page: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationCreateRequest {
    pub assistant_id: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationCreateResponse {
    pub session_id: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationArchiveResponse {
    pub session_id: String,
    pub status: LocalConversationStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationDeleteResponse {
    pub session_id: String,
    pub turn_index: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationClearResponse {
    pub session_id: String,
    pub cleared: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSendRequest {
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub content: String,
    pub model: String,
    pub provider_model_id: Option<String>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSendResponse {
    pub session_id: String,
    pub user_message: LocalConversationHistoryMessage,
    pub assistant_message: LocalConversationHistoryMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationCancelResponse {
    pub request_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationRenameRequest {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationRenameResponse {
    pub session_id: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationHistoryMessage {
    pub role: String,
    pub content: Option<Value>,
    pub turn_index: Option<i64>,
    pub created_at: Option<String>,
    pub is_truncated: Option<bool>,
    pub name: Option<String>,
    pub meta_info: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationHistoryResponse {
    pub session_id: String,
    pub messages: Vec<LocalConversationHistoryMessage>,
    pub next_cursor: Option<i64>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationWindowResponse {
    pub session_id: String,
    pub messages: Vec<LocalConversationHistoryMessage>,
    pub meta: Option<Value>,
    pub summary: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSessionsQuery {
    pub cursor: Option<String>,
    pub size: Option<i64>,
    pub assistant_id: Option<String>,
    pub status: Option<LocalConversationStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationHistoryQuery {
    pub session_id: Option<String>,
    pub cursor: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateConversationMessageRequest {
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub name: Option<String>,
    pub meta_info: Option<Value>,
    pub is_truncated: Option<bool>,
    pub parent_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationRegenerateRequest {
    pub session_id: String,
    pub model: String,
    pub provider_model_id: Option<String>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationRegenerateResponse {
    pub session_id: String,
    pub deleted_turn_index: Option<i64>,
    pub message: LocalConversationHistoryMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationCompareFinalizeRequest {
    pub session_id: String,
    pub model_id: String,
    pub provider_model_id: Option<String>,
    pub content: String,
    pub blocks: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationCompareFinalizeResponse {
    pub session_id: String,
    pub replaced_turn_index: i64,
    pub message: LocalConversationHistoryMessage,
}
