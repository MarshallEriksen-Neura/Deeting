use reqwest::Url;
use serde_json::{json, Map, Value};

use crate::modules::browser_agent::bridge::BrowserAgentBridgeState;
use crate::modules::browser_agent::types::{
    BrowserAgentBridgeStatus, BrowserAgentElementLocator, BrowserAgentPageContext,
};
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

    pub async fn navigate_tab(
        &self,
        store: &McpStore,
        tab_id: i64,
        url: &str,
    ) -> Result<serde_json::Value, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        if tab_id <= 0 {
            return Err("browser navigate_tab requires a positive tab id".to_string());
        }
        let normalized = url.trim();
        if normalized.is_empty() {
            return Err("browser navigate_tab requires a non-empty url".to_string());
        }
        let parsed = Url::parse(normalized).map_err(|err| err.to_string())?;
        match parsed.scheme() {
            "http" | "https" => {
                self.bridge
                    .dispatch_action(
                        &bridge_url,
                        crate::modules::browser_agent::types::BrowserAgentAction::NavigateTab {
                            tab_id,
                            url: parsed.to_string(),
                        },
                    )
                    .await
            }
            scheme => Err(format!(
                "browser navigate_tab does not support scheme: {scheme}"
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

    pub async fn get_active_page(
        &self,
        store: &McpStore,
    ) -> Result<Option<BrowserAgentPageContext>, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        self.bridge.ensure_started(&bridge_url).await?;
        let snapshot = self.bridge.snapshot().await;
        Ok(snapshot.active_page)
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

    pub async fn scroll_page(
        &self,
        store: &McpStore,
        tab_id: i64,
        direction: &str,
        amount: Option<i64>,
    ) -> Result<serde_json::Value, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        if tab_id <= 0 {
            return Err("browser scroll requires a positive tab id".to_string());
        }
        let direction = normalize_scroll_direction(direction)?;
        if let Some(value) = amount {
            if value <= 0 {
                return Err("browser scroll requires a positive amount when provided".to_string());
            }
        }
        self.bridge
            .dispatch_action(
                &bridge_url,
                crate::modules::browser_agent::types::BrowserAgentAction::Scroll {
                    tab_id,
                    direction: direction.to_string(),
                    amount,
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
            return Err(
                "browser retry_with_relocate requires a non-empty target locator".to_string(),
            );
        }
        if max_attempts <= 0 {
            return Err("browser retry_with_relocate requires a positive max_attempts".to_string());
        }
        if timeout_ms <= 0 {
            return Err("browser retry_with_relocate requires a positive timeout".to_string());
        }
        if poll_interval_ms <= 0 {
            return Err(
                "browser retry_with_relocate requires a positive poll interval".to_string(),
            );
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

                let wait_result = self
                    .wait_for_element(store, tab_id, target.clone(), timeout_ms, poll_interval_ms)
                    .await?;
                if !result_ok(&wait_result) {
                    let error = extract_result_error(&wait_result).unwrap_or_else(|| {
                        "browser wait_for_element did not match the target".to_string()
                    });
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

    pub async fn dispatch_expanded_action(
        &self,
        store: &McpStore,
        action_name: &str,
        payload: Map<String, Value>,
    ) -> Result<serde_json::Value, String> {
        let (bridge_url, _source) = self.get_bridge_url(store).await?;
        let payload = normalize_expanded_action_payload(payload);
        validate_expanded_action_payload(action_name, &payload)?;
        let action = match action_name {
            "browser_find_element" => {
                crate::modules::browser_agent::types::BrowserAgentAction::FindElement { payload }
            }
            "browser_extract" => {
                crate::modules::browser_agent::types::BrowserAgentAction::Extract { payload }
            }
            "browser_region_screenshot" => {
                crate::modules::browser_agent::types::BrowserAgentAction::RegionScreenshot {
                    payload,
                }
            }
            "browser_full_page_screenshot" => {
                crate::modules::browser_agent::types::BrowserAgentAction::FullPageScreenshot {
                    payload,
                }
            }
            "browser_get_active_page" => {
                crate::modules::browser_agent::types::BrowserAgentAction::GetActivePage { payload }
            }
            "browser_wait" => {
                crate::modules::browser_agent::types::BrowserAgentAction::Wait { payload }
            }
            "browser_tabs" => {
                crate::modules::browser_agent::types::BrowserAgentAction::Tabs { payload }
            }
            "browser_fill" => {
                crate::modules::browser_agent::types::BrowserAgentAction::Fill { payload }
            }
            "browser_key" => {
                crate::modules::browser_agent::types::BrowserAgentAction::Key { payload }
            }
            "browser_select" => {
                crate::modules::browser_agent::types::BrowserAgentAction::Select { payload }
            }
            "browser_upload_file" => {
                crate::modules::browser_agent::types::BrowserAgentAction::UploadFile { payload }
            }
            "browser_downloads" => {
                crate::modules::browser_agent::types::BrowserAgentAction::Downloads { payload }
            }
            "browser_dialog" => {
                crate::modules::browser_agent::types::BrowserAgentAction::Dialog { payload }
            }
            "browser_console_log" => {
                crate::modules::browser_agent::types::BrowserAgentAction::ConsoleLog { payload }
            }
            "browser_network_log" => {
                crate::modules::browser_agent::types::BrowserAgentAction::NetworkLog { payload }
            }
            "browser_storage_read" => {
                crate::modules::browser_agent::types::BrowserAgentAction::StorageRead { payload }
            }
            "browser_storage_write" => {
                crate::modules::browser_agent::types::BrowserAgentAction::StorageWrite { payload }
            }
            "browser_eval" => {
                crate::modules::browser_agent::types::BrowserAgentAction::Eval { payload }
            }
            "browser_highlight" => {
                crate::modules::browser_agent::types::BrowserAgentAction::Highlight { payload }
            }
            "browser_accessibility_audit" => {
                crate::modules::browser_agent::types::BrowserAgentAction::AccessibilityAudit {
                    payload,
                }
            }
            other => return Err(format!("unsupported expanded browser action: {other}")),
        };
        self.bridge.dispatch_action(&bridge_url, action).await
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

fn validate_expanded_action_payload(
    action_name: &str,
    payload: &Map<String, Value>,
) -> Result<(), String> {
    match action_name {
        "browser_get_active_page" | "browser_downloads" => Ok(()),
        "browser_full_page_screenshot" | "browser_accessibility_audit" => {
            require_positive_tab_id(action_name, payload)?;
            Ok(())
        }
        "browser_eval" => {
            require_positive_tab_id(action_name, payload)?;
            let code = payload
                .get("code")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "browser_eval requires non-empty code".to_string())?;
            if code.len() > 20_000 {
                return Err("browser_eval code is too large".to_string());
            }
            Ok(())
        }
        "browser_tabs" => {
            let action = payload
                .get("action")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "browser_tabs requires an action".to_string())?;
            match action {
                "switch" | "close" => {
                    require_positive_tab_id(action_name, payload)?;
                }
                "create" => {
                    payload
                        .get("url")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .ok_or_else(|| "browser_tabs create requires non-empty url".to_string())?;
                }
                "list" => {}
                other => return Err(format!("browser_tabs action is unsupported: {other}")),
            }
            Ok(())
        }
        "browser_find_element"
        | "browser_fill"
        | "browser_select"
        | "browser_upload_file"
        | "browser_highlight" => {
            require_positive_tab_id(action_name, payload)?;
            require_object(action_name, payload, "target")?;
            if action_name == "browser_fill" {
                require_non_empty_string(action_name, payload, "text")?;
            }
            Ok(())
        }
        "browser_key" => {
            require_positive_tab_id(action_name, payload)?;
            require_non_empty_string(action_name, payload, "key")?;
            Ok(())
        }
        "browser_storage_read" => {
            require_positive_tab_id(action_name, payload)?;
            require_storage_area(action_name, payload)?;
            Ok(())
        }
        "browser_storage_write" => {
            require_positive_tab_id(action_name, payload)?;
            require_storage_area(action_name, payload)?;
            require_non_empty_string(action_name, payload, "key")?;
            if !payload.contains_key("value") {
                return Err("browser_storage_write requires value".to_string());
            }
            Ok(())
        }
        "browser_wait" => {
            require_positive_tab_id(action_name, payload)?;
            let mode = require_non_empty_string(action_name, payload, "mode")?;
            match mode.as_str() {
                "element" => {
                    require_object(action_name, payload, "target")?;
                }
                "text" => {
                    require_non_empty_string(action_name, payload, "text")?;
                }
                "url" => {
                    require_non_empty_string(action_name, payload, "url")?;
                }
                "title" => {
                    require_non_empty_string(action_name, payload, "title")?;
                }
                "readyState" => {}
                other => return Err(format!("browser_wait mode is unsupported: {other}")),
            }
            Ok(())
        }
        _ => {
            require_positive_tab_id(action_name, payload)?;
            Ok(())
        }
    }
}

fn require_positive_tab_id(action_name: &str, payload: &Map<String, Value>) -> Result<i64, String> {
    payload
        .get("tabId")
        .or_else(|| payload.get("tab_id"))
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("{action_name} requires positive tab_id"))
}

fn require_non_empty_string(
    action_name: &str,
    payload: &Map<String, Value>,
    field: &str,
) -> Result<String, String> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| format!("{action_name} requires non-empty {field}"))
}

fn require_object(
    action_name: &str,
    payload: &Map<String, Value>,
    field: &str,
) -> Result<(), String> {
    payload
        .get(field)
        .and_then(Value::as_object)
        .filter(|object| !object.is_empty())
        .map(|_| ())
        .ok_or_else(|| format!("{action_name} requires {field}"))
}

fn require_storage_area(action_name: &str, payload: &Map<String, Value>) -> Result<(), String> {
    let area = require_non_empty_string(action_name, payload, "area")?;
    match area.as_str() {
        "localStorage" | "sessionStorage" => Ok(()),
        other => Err(format!("{action_name} area is unsupported: {other}")),
    }
}

fn normalize_expanded_action_payload(mut payload: Map<String, Value>) -> Map<String, Value> {
    move_alias_key(&mut payload, "tab_id", "tabId");
    move_alias_key(&mut payload, "timeout_ms", "timeoutMs");
    move_alias_key(&mut payload, "poll_interval_ms", "pollIntervalMs");
    move_alias_key(&mut payload, "expected_url_contains", "expectedUrlContains");
    move_alias_key(
        &mut payload,
        "expected_title_contains",
        "expectedTitleContains",
    );
    move_alias_key(&mut payload, "wait_for_ready_state", "waitForReadyState");
    move_alias_key(&mut payload, "filename_contains", "filenameContains");
    move_alias_key(&mut payload, "include_failed", "includeFailed");
    move_alias_key(&mut payload, "submit_after", "submitAfter");
    move_alias_key(&mut payload, "duration_ms", "durationMs");

    if let Some(Value::Object(target)) = payload.remove("target") {
        payload.insert(
            "target".to_string(),
            Value::Object(normalize_locator_payload(target)),
        );
    }

    payload
}

fn normalize_locator_payload(mut target: Map<String, Value>) -> Map<String, Value> {
    move_alias_key(&mut target, "tag_name", "tagName");
    move_alias_key(&mut target, "element_id", "elementId");
    move_alias_key(&mut target, "aria_label", "ariaLabel");
    move_alias_key(&mut target, "accessible_name", "accessibleName");
    move_alias_key(&mut target, "test_id", "testId");
    move_alias_key(&mut target, "frame_id", "frameId");
    target
}

fn move_alias_key(payload: &mut Map<String, Value>, alias: &str, canonical: &str) {
    let alias_value = payload.remove(alias);
    if payload.contains_key(canonical) {
        return;
    }
    if let Some(value) = alias_value {
        payload.insert(canonical.to_string(), value);
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
        || has_non_empty(&locator.element_id)
        || has_non_empty(&locator.aria_label)
        || has_non_empty(&locator.accessible_name)
        || has_non_empty(&locator.href)
        || has_non_empty(&locator.test_id)
        || has_non_empty(&locator.frame_id)
        || locator.index.is_some())
}

fn normalize_scroll_direction(direction: &str) -> Result<&'static str, String> {
    match direction.trim().to_lowercase().as_str() {
        "up" => Ok("up"),
        "down" => Ok("down"),
        other => Err(format!(
            "browser scroll direction must be up or down, got: {other}"
        )),
    }
}

fn parse_retry_action_kind(
    action_kind: &str,
    text: Option<&str>,
) -> Result<BrowserRetryActionKind, String> {
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
    matches!(
        action_kind,
        BrowserRetryActionKind::Click | BrowserRetryActionKind::Type
    )
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
    value
        .get("error")
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
        locator_is_empty, normalize_bridge_url, normalize_expanded_action_payload,
        normalize_scroll_direction, parse_retry_action_kind,
        requires_fresh_approval_after_recovery, result_ok, snapshot_summary,
        validate_expanded_action_payload, BrowserRetryActionKind, DEFAULT_BROWSER_AGENT_BRIDGE_URL,
    };
    use crate::modules::browser_agent::types::BrowserAgentElementLocator;
    use serde_json::{json, Value};

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
            element_id: None,
            aria_label: None,
            accessible_name: None,
            href: None,
            test_id: None,
            frame_id: None,
            index: None,
        };

        assert!(!locator_is_empty(&locator));
    }

    #[test]
    fn normalize_scroll_direction_accepts_only_up_and_down() {
        assert_eq!(normalize_scroll_direction("down").expect("down"), "down");
        assert_eq!(normalize_scroll_direction(" UP ").expect("up"), "up");
        assert!(normalize_scroll_direction("left").is_err());
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
        assert!(requires_fresh_approval_after_recovery(
            &BrowserRetryActionKind::Click
        ));
        assert!(requires_fresh_approval_after_recovery(
            &BrowserRetryActionKind::Type
        ));
    }

    #[test]
    fn recoverable_browser_action_errors_match_locator_and_transport_failures() {
        assert!(is_recoverable_browser_action_error(
            "click target not found"
        ));
        assert!(is_recoverable_browser_action_error(
            "browser agent request timed out"
        ));
        assert!(!is_recoverable_browser_action_error(
            "unsupported action_kind"
        ));
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

    #[test]
    fn normalize_expanded_action_payload_normalizes_root_and_target_aliases() {
        let normalized = normalize_expanded_action_payload(serde_json::Map::from_iter([
            ("tab_id".to_string(), json!(42)),
            ("timeout_ms".to_string(), json!(10_000)),
            (
                "target".to_string(),
                json!({
                    "tag_name": "button",
                    "element_id": "el-1",
                    "aria_label": "Submit",
                    "accessible_name": "Submit order",
                    "test_id": "submit-button",
                    "frame_id": "main"
                }),
            ),
        ]));

        assert_eq!(normalized.get("tabId"), Some(&json!(42)));
        assert!(!normalized.contains_key("tab_id"));
        assert_eq!(normalized.get("timeoutMs"), Some(&json!(10_000)));
        assert!(!normalized.contains_key("timeout_ms"));

        let target = normalized
            .get("target")
            .and_then(Value::as_object)
            .expect("normalized target");
        assert_eq!(target.get("tagName"), Some(&json!("button")));
        assert_eq!(target.get("elementId"), Some(&json!("el-1")));
        assert_eq!(target.get("ariaLabel"), Some(&json!("Submit")));
        assert_eq!(target.get("accessibleName"), Some(&json!("Submit order")));
        assert_eq!(target.get("testId"), Some(&json!("submit-button")));
        assert_eq!(target.get("frameId"), Some(&json!("main")));
        assert!(!target.contains_key("tag_name"));
        assert!(!target.contains_key("element_id"));
    }

    #[test]
    fn normalize_expanded_action_payload_preserves_existing_camel_case_fields() {
        let normalized = normalize_expanded_action_payload(serde_json::Map::from_iter([
            ("tabId".to_string(), json!(7)),
            ("tab_id".to_string(), json!(42)),
            (
                "target".to_string(),
                json!({
                    "elementId": "preferred",
                    "element_id": "alias"
                }),
            ),
        ]));

        assert_eq!(normalized.get("tabId"), Some(&json!(7)));
        let target = normalized
            .get("target")
            .and_then(Value::as_object)
            .expect("normalized target");
        assert_eq!(target.get("elementId"), Some(&json!("preferred")));
        assert!(!target.contains_key("element_id"));
    }

    #[test]
    fn validate_expanded_action_payload_requires_real_tab_scoped_fields() {
        assert!(validate_expanded_action_payload(
            "browser_full_page_screenshot",
            &serde_json::Map::new()
        )
        .expect_err("full-page screenshot requires tab")
        .contains("positive tab_id"));

        assert!(validate_expanded_action_payload(
            "browser_fill",
            &serde_json::Map::from_iter([("tabId".to_string(), json!(42))])
        )
        .expect_err("fill requires target")
        .contains("target"));

        assert!(validate_expanded_action_payload(
            "browser_storage_write",
            &serde_json::Map::from_iter([
                ("tabId".to_string(), json!(42)),
                ("area".to_string(), json!("localStorage")),
                ("key".to_string(), json!("feature")),
            ])
        )
        .expect_err("storage_write requires value")
        .contains("value"));
    }

    #[test]
    fn validate_expanded_action_payload_checks_grouped_action_semantics() {
        assert!(validate_expanded_action_payload(
            "browser_tabs",
            &serde_json::Map::from_iter([("action".to_string(), json!("switch"))])
        )
        .expect_err("switch requires tab")
        .contains("positive tab_id"));

        assert!(validate_expanded_action_payload(
            "browser_tabs",
            &serde_json::Map::from_iter([("action".to_string(), json!("create"))])
        )
        .expect_err("create requires url")
        .contains("non-empty url"));

        validate_expanded_action_payload(
            "browser_tabs",
            &serde_json::Map::from_iter([("action".to_string(), json!("list"))]),
        )
        .expect("list requires only action");
    }

    #[test]
    fn validate_expanded_action_payload_accepts_normalized_aliases() {
        let payload = normalize_expanded_action_payload(serde_json::Map::from_iter([
            ("tab_id".to_string(), json!(42)),
            ("mode".to_string(), json!("element")),
            ("target".to_string(), json!({"tag_name": "button"})),
        ]));

        validate_expanded_action_payload("browser_wait", &payload)
            .expect("normalized snake-case aliases should validate");
    }
}
