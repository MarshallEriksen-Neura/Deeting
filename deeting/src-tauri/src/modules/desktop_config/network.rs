use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

use super::{
    parse_desktop_network_proxy_mode, DesktopNetworkProxyMode,
    DESKTOP_NETWORK_PROXY_MODE_CONFIG_KEY, DESKTOP_NETWORK_PROXY_URL_CONFIG_KEY,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DesktopNetworkProxySettings {
    pub mode: DesktopNetworkProxyMode,
    pub url: Option<String>,
}

fn normalize_proxy_url(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) async fn resolve_desktop_network_proxy_settings(
    store: &McpStore,
) -> Result<DesktopNetworkProxySettings, McpError> {
    let mode_raw = store
        .get_desktop_config(DESKTOP_NETWORK_PROXY_MODE_CONFIG_KEY)
        .await?;
    let url_raw = store
        .get_desktop_config(DESKTOP_NETWORK_PROXY_URL_CONFIG_KEY)
        .await?;

    Ok(DesktopNetworkProxySettings {
        mode: parse_desktop_network_proxy_mode(mode_raw.as_deref()),
        url: normalize_proxy_url(url_raw.as_deref()),
    })
}

pub(crate) fn build_proxy_aware_reqwest_client_for_settings(
    settings: &DesktopNetworkProxySettings,
) -> Result<reqwest::Client, String> {
    let builder = match settings.mode {
        DesktopNetworkProxyMode::None => reqwest::Client::builder().no_proxy(),
        DesktopNetworkProxyMode::System => reqwest::Client::builder(),
        DesktopNetworkProxyMode::Custom => {
            let proxy_url = settings
                .url
                .as_deref()
                .ok_or_else(|| "Custom desktop proxy mode requires a proxy URL".to_string())?;
            let proxy = reqwest::Proxy::all(proxy_url).map_err(|err| err.to_string())?;
            reqwest::Client::builder().proxy(proxy)
        }
    };

    builder.build().map_err(|err| err.to_string())
}

pub(crate) async fn build_proxy_aware_reqwest_client(
    store: &McpStore,
) -> Result<reqwest::Client, String> {
    let settings = resolve_desktop_network_proxy_settings(store)
        .await
        .map_err(|err| err.to_string())?;
    build_proxy_aware_reqwest_client_for_settings(&settings)
}

#[cfg(test)]
mod tests {
    use super::{build_proxy_aware_reqwest_client_for_settings, DesktopNetworkProxySettings};
    use crate::modules::desktop_config::DesktopNetworkProxyMode;

    #[test]
    fn proxy_client_builder_accepts_system_and_none_modes() {
        for mode in [
            DesktopNetworkProxyMode::System,
            DesktopNetworkProxyMode::None,
        ] {
            let settings = DesktopNetworkProxySettings { mode, url: None };
            build_proxy_aware_reqwest_client_for_settings(&settings).expect("client should build");
        }
    }

    #[test]
    fn proxy_client_builder_accepts_valid_custom_proxy() {
        let settings = DesktopNetworkProxySettings {
            mode: DesktopNetworkProxyMode::Custom,
            url: Some("http://127.0.0.1:7890".to_string()),
        };
        build_proxy_aware_reqwest_client_for_settings(&settings)
            .expect("client should build with explicit proxy");
    }

    #[test]
    fn proxy_client_builder_rejects_missing_custom_proxy_url() {
        let settings = DesktopNetworkProxySettings {
            mode: DesktopNetworkProxyMode::Custom,
            url: None,
        };
        let error = build_proxy_aware_reqwest_client_for_settings(&settings)
            .expect_err("missing custom proxy URL should fail");
        assert!(error.contains("requires a proxy URL"));
    }
}
