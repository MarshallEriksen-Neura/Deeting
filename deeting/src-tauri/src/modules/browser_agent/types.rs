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
    #[serde(
        rename = "tagName",
        alias = "tag_name",
        skip_serializing_if = "Option::is_none"
    )]
    pub tag_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
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
    #[serde(rename = "wait_for_element")]
    WaitForElement {
        #[serde(rename = "tabId")]
        tab_id: i64,
        target: BrowserAgentElementLocator,
        #[serde(rename = "timeoutMs")]
        timeout_ms: i64,
        #[serde(rename = "pollIntervalMs")]
        poll_interval_ms: i64,
    },
    #[serde(rename = "wait_for_navigation")]
    WaitForNavigation {
        #[serde(rename = "tabId")]
        tab_id: i64,
        #[serde(rename = "timeoutMs")]
        timeout_ms: i64,
        #[serde(
            rename = "expectedUrlContains",
            alias = "expected_url_contains",
            skip_serializing_if = "Option::is_none"
        )]
        expected_url_contains: Option<String>,
        #[serde(
            rename = "expectedTitleContains",
            alias = "expected_title_contains",
            skip_serializing_if = "Option::is_none"
        )]
        expected_title_contains: Option<String>,
        #[serde(
            rename = "waitForReadyState",
            alias = "wait_for_ready_state",
            skip_serializing_if = "Option::is_none"
        )]
        wait_for_ready_state: Option<String>,
    },
    #[serde(rename = "scroll_into_view")]
    ScrollIntoView {
        #[serde(rename = "tabId")]
        tab_id: i64,
        target: BrowserAgentElementLocator,
        #[serde(skip_serializing_if = "Option::is_none")]
        align: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::{BrowserAgentAction, BrowserAgentElementLocator};

    #[test]
    fn wait_for_element_action_serializes_with_expected_shape() {
        let action = BrowserAgentAction::WaitForElement {
            tab_id: 42,
            target: BrowserAgentElementLocator {
                selector: None,
                text: Some("Continue".to_string()),
                role: None,
                tag_name: None,
                placeholder: None,
                index: None,
            },
            timeout_ms: 10_000,
            poll_interval_ms: 250,
        };

        let value = serde_json::to_value(action).expect("serialize action");

        assert_eq!(
            value.get("kind").and_then(|item| item.as_str()),
            Some("wait_for_element")
        );
        assert_eq!(value.get("tabId").and_then(|item| item.as_i64()), Some(42));
        assert_eq!(
            value.get("timeoutMs").and_then(|item| item.as_i64()),
            Some(10_000)
        );
        assert_eq!(
            value.get("pollIntervalMs").and_then(|item| item.as_i64()),
            Some(250)
        );
        assert_eq!(
            value
                .get("target")
                .and_then(|item| item.get("text"))
                .and_then(|item| item.as_str()),
            Some("Continue")
        );
    }

    #[test]
    fn wait_for_navigation_action_serializes_with_expected_shape() {
        let action = BrowserAgentAction::WaitForNavigation {
            tab_id: 42,
            timeout_ms: 10_000,
            expected_url_contains: Some("/dashboard".to_string()),
            expected_title_contains: None,
            wait_for_ready_state: Some("complete".to_string()),
        };

        let value = serde_json::to_value(action).expect("serialize action");

        assert_eq!(
            value.get("kind").and_then(|item| item.as_str()),
            Some("wait_for_navigation")
        );
        assert_eq!(value.get("tabId").and_then(|item| item.as_i64()), Some(42));
        assert_eq!(
            value.get("timeoutMs").and_then(|item| item.as_i64()),
            Some(10_000)
        );
        assert_eq!(
            value.get("expectedUrlContains")
                .and_then(|item| item.as_str()),
            Some("/dashboard")
        );
        assert_eq!(
            value.get("waitForReadyState")
                .and_then(|item| item.as_str()),
            Some("complete")
        );
    }

    #[test]
    fn scroll_into_view_action_serializes_with_expected_shape() {
        let action = BrowserAgentAction::ScrollIntoView {
            tab_id: 42,
            target: BrowserAgentElementLocator {
                selector: Some("button.primary".to_string()),
                text: None,
                role: None,
                tag_name: None,
                placeholder: None,
                index: None,
            },
            align: Some("center".to_string()),
        };

        let value = serde_json::to_value(action).expect("serialize action");

        assert_eq!(
            value.get("kind").and_then(|item| item.as_str()),
            Some("scroll_into_view")
        );
        assert_eq!(value.get("tabId").and_then(|item| item.as_i64()), Some(42));
        assert_eq!(
            value.get("align").and_then(|item| item.as_str()),
            Some("center")
        );
        assert_eq!(
            value.get("target")
                .and_then(|item| item.get("selector"))
                .and_then(|item| item.as_str()),
            Some("button.primary")
        );
    }
}
