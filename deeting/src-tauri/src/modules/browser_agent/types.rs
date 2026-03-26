use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BrowserAgentBridgeStatus {
    pub bridge_url: String,
    pub config_source: String,
    pub configured: bool,
    pub running: bool,
    pub connected_sessions: usize,
    pub active_session_id: Option<String>,
    pub reachable: bool,
    pub status: String,
    pub status_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BrowserAgentElementLocator {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(rename = "tagName", skip_serializing_if = "Option::is_none")]
    pub tag_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum BrowserAgentAction {
    #[serde(rename = "open_tab")]
    OpenTab { url: String },
    #[serde(rename = "navigate_tab")]
    NavigateTab {
        #[serde(rename = "tabId")]
        tab_id: i64,
        url: String,
    },
    #[serde(rename = "get_page_snapshot")]
    GetPageSnapshot {
        #[serde(rename = "tabId")]
        tab_id: i64,
    },
    #[serde(rename = "click")]
    Click {
        #[serde(rename = "tabId")]
        tab_id: i64,
        target: BrowserAgentElementLocator,
    },
    #[serde(rename = "type")]
    Type {
        #[serde(rename = "tabId")]
        tab_id: i64,
        target: BrowserAgentElementLocator,
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BrowserAgentHelloMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub role: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "extensionVersion")]
    pub extension_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BrowserAgentCommandMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub action: BrowserAgentAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BrowserAgentResultError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BrowserAgentResultMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub ok: bool,
    pub data: Option<Value>,
    pub error: Option<BrowserAgentResultError>,
}
