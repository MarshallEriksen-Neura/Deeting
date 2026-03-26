use reqwest::Url;
use serde_json::{json, Value};

use crate::modules::browser_agent::bridge::BrowserAgentBridgeState;
use crate::modules::browser_agent::types::{BrowserAgentBridgeStatus, BrowserAgentElementLocator};
use crate::modules::mcp::store::McpStore;

pub const BROWSER_AGENT_BRIDGE_URL_KEY: &str = "browser_agent.bridge_url";
pub const DEFAULT_BROWSER_AGENT_BRIDGE_URL: &str = "ws://127.0.0.1:31937/bridge";

#[derive(Clone)]
pub struct BrowserAgentService {
    bridge: BrowserAgentBridgeState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum BrowserRetryActionKind {
    Click,
    Type,
}

fn retry_action_kind_as_str(kind: &BrowserRetryActionKind) -> &'static str {
    match kind {
        BrowserRetryActionKind::Click => "click",
        BrowserRetryActionKind::Type => "type",
    }
}

impl BrowserAgentService {
    pub fn new() -> Self {
        Self {
            bridge: BrowserAgentBridgeState::new(),
        }
    }

    pub async fn get_bridge_url(&self, store: &McpStore) -> Result<(String, &'static str), String> {
        let configured = store
            .get_desktop_config(BROWSER_AGENT_BRIDGE_URL_KEY)
            .await
            .map_err(|err| err.to_string())?;

        let normalized = configured
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_BROWSER_AGENT_BRIDGE_URL);

        let source = if configured
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
        {
            "desktop_config"
        } else {
            "default"
        };

        Ok((normalize_bridge_url(normalized)?, source))
    }

    pub async fn set_bridge_url(&self, store: &McpStore, url: &str) -> Result<String, String> {
        let normalized = normalize_bridge_url(url)?;
        store
            .set_desktop_config(BROWSER_AGENT_BRIDGE_URL_KEY, &normalized)
            .await
            .map_err(|err| err.to_string())?;
        Ok(normalized)
    }

    pub async fn status_report(
        &self,
        store: &McpStore,
    ) -> Result<BrowserAgentBridgeStatus, String> {
        let (bridge_url, config_source) = self.get_bridge_url(store).await?;
        let configured = config_source == "desktop_config";
        let (running, connected_sessions, active_session_id, reachable, status, status_reason) =
            match self.bridge.ensure_started(&bridge_url).await {
                Ok(_) => {
                    let snapshot = self.bridge.snapshot().await;
                    let status = if snapshot.connected_sessions > 0 {
                        "connected".to_string()
                    } else {
                        "listening".to_string()
                    };
                    let reason = if snapshot.connected_sessions > 0 {
                        "browser_agent_extension_connected".to_string()
                    } else {
                        "browser_agent_bridge_listening".to_string()
                    };
                    (
                        snapshot.running,
                        snapshot.connected_sessions,
                        snapshot.active_session_id,
                        snapshot.running,
                        status,
                        reason,
                    )
                }
                Err(err) => (
                    false,
                    0,
                    None,
                    false,
                    "start_failed".to_string(),
                    format!("browser_agent_bridge_start_failed:{err}"),
                ),
            };

        Ok(BrowserAgentBridgeStatus {
            bridge_url,
            config_source: config_source.to_string(),
            configured,
            running,
            connected_sessions,
            active_session_id,
            reachable,
            status,
            status_reason,
        })
    }

    pub async fn ensure_started(&self, store: &McpStore) -> Result<String, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        self.bridge.ensure_started(&bridge_url).await
    }

    pub async fn open_tab(&self, store: &McpStore, url: &str) -> Result<serde_json::Value, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        let normalized = url.trim();
        if normalized.is_empty() {
            return Err("browser open tab requires a non-empty url".to_string());
        }
        let parsed = Url::parse(normalized).map_err(|err| err.to_string())?;
        match parsed.scheme() {
            "http" | "https" => {
                self.bridge
                    .dispatch_action(
                        &bridge_url,
                        crate::modules::browser_agent::types::BrowserAgentAction::OpenTab {
                            url: parsed.to_string(),
                        },
                    )
                    .await
            }
            scheme => Err(format!(
                "browser open tab does not support scheme: {scheme}"
            )),
        }
    }

    pub async fn get_page_snapshot(
        &self,
        store: &McpStore,
        tab_id: i64,
    ) -> Result<serde_json::Value, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        if tab_id <= 0 {
            return Err("browser page snapshot requires a positive tab id".to_string());
        }
        self.bridge
            .dispatch_action(
                &bridge_url,
                crate::modules::browser_agent::types::BrowserAgentAction::GetPageSnapshot {
                    tab_id,
                },
            )
            .await
    }

    pub async fn wait_for_element(
        &self,
        store: &McpStore,
        tab_id: i64,
        target: BrowserAgentElementLocator,
        timeout_ms: i64,
        poll_interval_ms: i64,
    ) -> Result<serde_json::Value, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        if tab_id <= 0 {
            return Err("browser wait_for_element requires a positive tab id".to_string());
        }
        if locator_is_empty(&target) {
            return Err("browser wait_for_element requires a non-empty target locator".to_string());
        }
        if timeout_ms <= 0 {
            return Err("browser wait_for_element requires a positive timeout".to_string());
        }
        if poll_interval_ms <= 0 {
            return Err("browser wait_for_element requires a positive poll interval".to_string());
        }
        self.bridge
            .dispatch_action(
                &bridge_url,
                crate::modules::browser_agent::types::BrowserAgentAction::WaitForElement {
                    tab_id,
                    target,
                    timeout_ms,
                    poll_interval_ms,
                },
            )
            .await
    }

    pub async fn wait_for_navigation(
        &self,
        store: &McpStore,
        tab_id: i64,
        timeout_ms: i64,
        expected_url_contains: Option<&str>,
        expected_title_contains: Option<&str>,
        wait_for_ready_state: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        if tab_id <= 0 {
            return Err("browser wait_for_navigation requires a positive tab id".to_string());
        }
        if timeout_ms <= 0 {
            return Err("browser wait_for_navigation requires a positive timeout".to_string());
        }
        self.bridge
            .dispatch_action(
                &bridge_url,
                crate::modules::browser_agent::types::BrowserAgentAction::WaitForNavigation {
                    tab_id,
                    timeout_ms,
                    expected_url_contains: expected_url_contains.map(|value| value.to_string()),
                    expected_title_contains: expected_title_contains.map(|value| value.to_string()),
                    wait_for_ready_state: wait_for_ready_state.map(|value| value.to_string()),
                },
            )
            .await
    }

    pub async fn scroll_into_view(
        &self,
        store: &McpStore,
        tab_id: i64,
        target: BrowserAgentElementLocator,
        align: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        if tab_id <= 0 {
            return Err("browser scroll_into_view requires a positive tab id".to_string());
        }
        if locator_is_empty(&target) {
            return Err("browser scroll_into_view requires a non-empty target locator".to_string());
        }
        self.bridge
            .dispatch_action(
                &bridge_url,
                crate::modules::browser_agent::types::BrowserAgentAction::ScrollIntoView {
                    tab_id,
                    target,
                    align: align.map(|value| value.to_string()),
                },
            )
            .await
    }

    pub async fn retry_with_relocate(
        &self,
        store: &McpStore,
        tab_id: i64,
        action_kind: &str,
        target: BrowserAgentElementLocator,
        text: Option<&str>,
        max_attempts: i64,
        timeout_ms: i64,
        poll_interval_ms: i64,
    ) -> Result<serde_json::Value, String> {
        if tab_id <= 0 {
            return Err("browser retry_with_relocate requires a positive tab id".to_string());
        }
        if locator_is_empty(&target) {
            return Err("browser retry_with_relocate requires a non-empty target locator".to_string());
        }
        if max_attempts <= 0 {
            return Err("browser retry_with_relocate requires a positive max_attempts".to_string());
        }
        if timeout_ms <= 0 {
            return Err("browser retry_with_relocate requires a positive timeout".to_string());
        }
        if poll_interval_ms <= 0 {
            return Err("browser retry_with_relocate requires a positive poll interval".to_string());
        }

        let action_kind = parse_retry_action_kind(action_kind, text)?;
        let mut attempts = 0_i64;
        let mut last_error: Option<String> = None;
        let mut last_snapshot_summary: Option<serde_json::Value> = None;

        while attempts < max_attempts {
            attempts += 1;

            if attempts > 1 {
                let snapshot = self.get_page_snapshot(store, tab_id).await?;
                last_snapshot_summary = snapshot_summary(snapshot);

                let wait_result =
                    self.wait_for_element(store, tab_id, target.clone(), timeout_ms, poll_interval_ms)
                        .await?;
                if !result_ok(&wait_result) {
                    let error = extract_result_error(&wait_result)
                        .unwrap_or_else(|| "browser wait_for_element did not match the target".to_string());
                    return Ok(json!({
                        "ok": false,
                        "attempts": attempts,
                        "recovered": attempts > 1,
                        "final_error": error,
                        "last_snapshot_summary": last_snapshot_summary,
                    }));
                }

                let _ = self
                    .scroll_into_view(store, tab_id, target.clone(), Some("center"))
                    .await;

                if requires_fresh_approval_after_recovery(&action_kind) {
                    return Ok(json!({
                        "status": "RECOVERED_REQUIRES_APPROVAL",
                        "action_kind": retry_action_kind_as_str(&action_kind),
                        "attempts": attempts,
                        "recovered": true,
                        "recovery_reason": last_error.clone().unwrap_or_else(|| "Recovered target after re-locating browser action".to_string()),
                        "last_snapshot_summary": last_snapshot_summary,
                    }));
                }
            }

            let attempt_result = match action_kind {
                BrowserRetryActionKind::Click => {
                    self.click_element(store, tab_id, target.clone()).await
                }
                BrowserRetryActionKind::Type => {
                    self.type_element(
                        store,
                        tab_id,
                        target.clone(),
                        text.expect("type text validated"),
                    )
                    .await
                }
            };

            match attempt_result {
                Ok(_) => {
                    return Ok(json!({
                        "ok": true,
                        "attempts": attempts,
                        "recovered": attempts > 1,
                        "final_error": Value::Null,
                        "last_snapshot_summary": last_snapshot_summary,
                    }));
                }
                Err(error) => {
                    last_error = Some(error.clone());
                    if attempts >= max_attempts || !is_recoverable_browser_action_error(&error) {
                        return Ok(json!({
                            "ok": false,
                            "attempts": attempts,
                            "recovered": attempts > 1,
                            "final_error": error,
                            "last_snapshot_summary": last_snapshot_summary,
                        }));
                    }
                }
            }
        }

        Ok(json!({
            "ok": false,
            "attempts": attempts,
            "recovered": attempts > 1,
            "final_error": last_error.unwrap_or_else(|| "browser retry_with_relocate exhausted attempts".to_string()),
            "last_snapshot_summary": last_snapshot_summary,
        }))
    }

    pub async fn click_element(
        &self,
        store: &McpStore,
        tab_id: i64,
        target: BrowserAgentElementLocator,
    ) -> Result<serde_json::Value, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        if tab_id <= 0 {
            return Err("browser click requires a positive tab id".to_string());
        }
        if locator_is_empty(&target) {
            return Err("browser click requires a non-empty target locator".to_string());
        }
        self.bridge
            .dispatch_action(
                &bridge_url,
                crate::modules::browser_agent::types::BrowserAgentAction::Click { tab_id, target },
            )
            .await
    }

    pub async fn type_element(
        &self,
        store: &McpStore,
        tab_id: i64,
        target: BrowserAgentElementLocator,
        text: &str,
    ) -> Result<serde_json::Value, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        if tab_id <= 0 {
            return Err("browser type requires a positive tab id".to_string());
        }
        if locator_is_empty(&target) {
            return Err("browser type requires a non-empty target locator".to_string());
        }
        let value = text.trim();
        if value.is_empty() {
            return Err("browser type requires non-empty text".to_string());
        }
        self.bridge
            .dispatch_action(
                &bridge_url,
                crate::modules::browser_agent::types::BrowserAgentAction::Type {
                    tab_id,
                    target,
                    text: value.to_string(),
                },
            )
            .await
    }
}

fn normalize_bridge_url(raw: &str) -> Result<String, String> {
    let normalized = raw.trim();
    if normalized.is_empty() {
        return Err("browser agent bridge url is required".to_string());
    }
    let parsed = Url::parse(normalized).map_err(|err| err.to_string())?;
    match parsed.scheme() {
        "ws" | "wss" | "http" | "https" => Ok(parsed.to_string()),
        scheme => Err(format!("unsupported browser agent bridge scheme: {scheme}")),
    }
}

pub(crate) fn bridge_socket_target(raw: &str) -> Result<(String, u16), String> {
    let parsed = Url::parse(raw).map_err(|err| err.to_string())?;
    let host = parsed
        .host_str()
        .map(str::to_string)
        .ok_or_else(|| "browser agent bridge host is missing".to_string())?;
    let port = parsed.port_or_known_default().ok_or_else(|| {
        "browser agent bridge port could not be inferred from the URL".to_string()
    })?;
    Ok((host, port))
}

pub(crate) fn locator_is_empty(locator: &BrowserAgentElementLocator) -> bool {
    let has_non_empty = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .is_some()
    };

    !(has_non_empty(&locator.selector)
        || has_non_empty(&locator.text)
        || has_non_empty(&locator.role)
        || has_non_empty(&locator.tag_name)
        || has_non_empty(&locator.placeholder)
        || locator.index.is_some())
}

fn parse_retry_action_kind(action_kind: &str, text: Option<&str>) -> Result<BrowserRetryActionKind, String> {
    match action_kind.trim() {
        "click" => Ok(BrowserRetryActionKind::Click),
        "type" => {
            let value = text.map(str::trim).filter(|item| !item.is_empty());
            if value.is_none() {
                return Err(
                    "browser retry_with_relocate requires non-empty text for type actions"
                        .to_string(),
                );
            }
            Ok(BrowserRetryActionKind::Type)
        }
        other => Err(format!(
            "browser retry_with_relocate does not support action_kind: {other}"
        )),
    }
}

fn requires_fresh_approval_after_recovery(action_kind: &BrowserRetryActionKind) -> bool {
    matches!(action_kind, BrowserRetryActionKind::Click | BrowserRetryActionKind::Type)
}

fn is_recoverable_browser_action_error(error: &str) -> bool {
    let normalized = error.trim().to_lowercase();
    normalized.contains("not found")
        || normalized.contains("timed out")
        || normalized.contains("channel closed")
        || normalized.contains("no browser agent extension session is connected")
}

fn result_ok(value: &serde_json::Value) -> bool {
    value
        .get("ok")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn extract_result_error(value: &serde_json::Value) -> Option<String> {
    value.get("error")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn snapshot_summary(snapshot: serde_json::Value) -> Option<serde_json::Value> {
    Some(json!({
        "url": snapshot.get("url")?.as_str()?,
        "title": snapshot.get("title")?.as_str()?,
        "documentReadyState": snapshot.get("documentReadyState")?.as_str()?,
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        bridge_socket_target, extract_result_error, is_recoverable_browser_action_error,
        locator_is_empty, normalize_bridge_url, parse_retry_action_kind,
        requires_fresh_approval_after_recovery, result_ok, snapshot_summary,
        BrowserRetryActionKind, DEFAULT_BROWSER_AGENT_BRIDGE_URL,
    };
    use crate::modules::browser_agent::types::BrowserAgentElementLocator;
    use serde_json::json;

    #[test]
    fn normalize_bridge_url_accepts_default_ws_endpoint() {
        let normalized =
            normalize_bridge_url(DEFAULT_BROWSER_AGENT_BRIDGE_URL).expect("normalize default");
        assert_eq!(normalized, DEFAULT_BROWSER_AGENT_BRIDGE_URL.to_string());
    }

    #[test]
    fn bridge_socket_target_infers_default_ports() {
        let ws_target = bridge_socket_target("ws://127.0.0.1/bridge").expect("ws target");
        let https_target = bridge_socket_target("https://example.com/path").expect("https target");

        assert_eq!(ws_target, ("127.0.0.1".to_string(), 80));
        assert_eq!(https_target, ("example.com".to_string(), 443));
    }

    #[test]
    fn normalize_bridge_url_rejects_non_websocket_like_schemes() {
        let error = normalize_bridge_url("ftp://127.0.0.1:31937/bridge").expect_err("reject ftp");
        assert!(error.contains("unsupported browser agent bridge scheme"));
    }

    #[test]
    fn locator_is_empty_accepts_placeholder_only_targets() {
        let locator = BrowserAgentElementLocator {
            selector: None,
            text: None,
            role: None,
            tag_name: None,
            placeholder: Some("Search".to_string()),
            index: None,
        };

        assert!(!locator_is_empty(&locator));
    }

    #[test]
    fn parse_retry_action_kind_requires_text_for_type() {
        let result = parse_retry_action_kind("type", None).expect_err("type requires text");
        assert!(result.contains("requires non-empty text"));
    }

    #[test]
    fn parse_retry_action_kind_accepts_click_and_type() {
        assert_eq!(
            parse_retry_action_kind("click", None).expect("click kind"),
            BrowserRetryActionKind::Click
        );
        assert_eq!(
            parse_retry_action_kind("type", Some("hello")).expect("type kind"),
            BrowserRetryActionKind::Type
        );
    }

    #[test]
    fn click_and_type_require_fresh_approval_after_recovery() {
        assert!(requires_fresh_approval_after_recovery(&BrowserRetryActionKind::Click));
        assert!(requires_fresh_approval_after_recovery(&BrowserRetryActionKind::Type));
    }

    #[test]
    fn recoverable_browser_action_errors_match_locator_and_transport_failures() {
        assert!(is_recoverable_browser_action_error("click target not found"));
        assert!(is_recoverable_browser_action_error(
            "browser agent request timed out"
        ));
        assert!(!is_recoverable_browser_action_error("unsupported action_kind"));
    }

    #[test]
    fn result_helpers_extract_ok_and_error_fields() {
        let ok_payload = json!({ "ok": true });
        let error_payload = json!({ "ok": false, "error": "missing target" });

        assert!(result_ok(&ok_payload));
        assert!(!result_ok(&error_payload));
        assert_eq!(
            extract_result_error(&error_payload).as_deref(),
            Some("missing target")
        );
    }

    #[test]
    fn snapshot_summary_extracts_minimal_page_metadata() {
        let snapshot = json!({
            "url": "https://example.com",
            "title": "Example",
            "documentReadyState": "complete",
            "mainText": "ignored"
        });

        assert_eq!(
            snapshot_summary(snapshot),
            Some(json!({
                "url": "https://example.com",
                "title": "Example",
                "documentReadyState": "complete"
            }))
        );
    }
}
