use reqwest::Url;

use crate::modules::browser_agent::bridge::BrowserAgentBridgeState;
use crate::modules::browser_agent::types::{BrowserAgentBridgeStatus, BrowserAgentElementLocator};
use crate::modules::mcp::store::McpStore;

pub const BROWSER_AGENT_BRIDGE_URL_KEY: &str = "browser_agent.bridge_url";
pub const DEFAULT_BROWSER_AGENT_BRIDGE_URL: &str = "ws://127.0.0.1:31937/bridge";

#[derive(Clone)]
pub struct BrowserAgentService {
    bridge: BrowserAgentBridgeState,
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
        if target.selector.is_none()
            && target.text.is_none()
            && target.role.is_none()
            && target.tag_name.is_none()
            && target.index.is_none()
        {
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
        if target.selector.is_none()
            && target.text.is_none()
            && target.role.is_none()
            && target.tag_name.is_none()
            && target.index.is_none()
        {
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

#[cfg(test)]
mod tests {
    use super::{bridge_socket_target, normalize_bridge_url, DEFAULT_BROWSER_AGENT_BRIDGE_URL};

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
}
