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
pub struct LocalChatInputMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<LocalChatToolCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatToolCall {
    pub id: Option<String>,
    pub name: String,
    pub arguments: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_content: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_transport_kind_prefers_explicit_sse_transport() {
        let tool = McpTool {
            id: "tool-1".to_string(),
            identifier: None,
            name: "remote_tool".to_string(),
            source_type: McpSourceType::Local,
            source_id: None,
            status: McpToolStatus::Healthy,
            ping_ms: None,
            capabilities: Vec::new(),
            description: String::new(),
            error: None,
            command: Some("echo".to_string()),
            args: None,
            env: None,
            config_json: "{\"transport\":\"sse\",\"url\":\"https://example.com/sse\"}".to_string(),
            pending_config_json: None,
            config_hash: "hash".to_string(),
            pending_config_hash: None,
            conflict_status: McpConflictStatus::None,
            is_read_only: false,
            is_new: false,
            created_at: String::new(),
            updated_at: String::new(),
        };

        assert_eq!(tool.transport_kind(), McpTransportKind::Sse);
        assert_eq!(
            tool.remote_sse_url().as_deref(),
            Some("https://example.com/sse")
        );
    }

    #[test]
    fn tool_config_payload_infers_stdio_from_command() {
        let payload = McpToolConfigPayload {
            command: Some("uvx".to_string()),
            args: Some(vec!["pkg".to_string()]),
            env: None,
            description: None,
            capabilities: None,
            transport_type: None,
            url: None,
            sse_url: None,
            extra: HashMap::new(),
        };

        assert_eq!(payload.transport_kind(), McpTransportKind::Stdio);
    }
}
