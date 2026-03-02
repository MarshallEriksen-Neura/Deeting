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
}

impl McpSourceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            McpSourceType::Local => "local",
            McpSourceType::Cloud => "cloud",
            McpSourceType::Modelscope => "modelscope",
            McpSourceType::Github => "github",
            McpSourceType::Url => "url",
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolConfigPayload {
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub description: Option<String>,
    pub capabilities: Option<Vec<String>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
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
    pub skill_refs: Vec<Value>,
    pub tags: Vec<String>,
    pub changelog: Option<String>,
    pub published_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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
pub struct LocalChatResponse {
    pub content: String,
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
    pub content: String,
    pub model: String,
    pub provider_model_id: Option<String>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationSendResponse {
    pub session_id: String,
    pub user_message: LocalConversationHistoryMessage,
    pub assistant_message: LocalConversationHistoryMessage,
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
pub struct LocalConversationSessionsQuery {
    pub cursor: Option<String>,
    pub size: Option<i64>,
    pub assistant_id: Option<String>,
    pub status: Option<LocalConversationStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationHistoryQuery {
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
    pub model: String,
    pub provider_model_id: Option<String>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversationRegenerateResponse {
    pub session_id: String,
    pub deleted_turn_index: Option<i64>,
    pub message: LocalConversationHistoryMessage,
}
