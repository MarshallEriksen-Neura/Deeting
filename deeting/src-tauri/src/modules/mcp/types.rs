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
