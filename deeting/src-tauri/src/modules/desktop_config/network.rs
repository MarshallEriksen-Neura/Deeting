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

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct DesktopNetworkProxyEnvironment {
    pub set: Vec<(String, String)>,
    pub unset: Vec<String>,
}

const PROXY_ENV_KEYS: [&str; 8] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
];

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

pub(crate) fn build_proxy_environment_for_settings(
    settings: &DesktopNetworkProxySettings,
) -> Result<DesktopNetworkProxyEnvironment, String> {
    match settings.mode {
        DesktopNetworkProxyMode::System => Ok(DesktopNetworkProxyEnvironment::default()),
        DesktopNetworkProxyMode::None => Ok(DesktopNetworkProxyEnvironment {
            set: Vec::new(),
            unset: PROXY_ENV_KEYS.iter().map(|key| (*key).to_string()).collect(),
        }),
        DesktopNetworkProxyMode::Custom => {
            let proxy_url = settings
                .url
                .as_deref()
                .ok_or_else(|| "Custom desktop proxy mode requires a proxy URL".to_string())?;
            let proxy_url = proxy_url.to_string();
            let no_proxy = "127.0.0.1,localhost".to_string();
            Ok(DesktopNetworkProxyEnvironment {
                set: vec![
                    ("HTTP_PROXY".to_string(), proxy_url.clone()),
                    ("HTTPS_PROXY".to_string(), proxy_url.clone()),
                    ("ALL_PROXY".to_string(), proxy_url.clone()),
                    ("http_proxy".to_string(), proxy_url.clone()),
                    ("https_proxy".to_string(), proxy_url.clone()),
                    ("all_proxy".to_string(), proxy_url),
                    ("NO_PROXY".to_string(), no_proxy.clone()),
                    ("no_proxy".to_string(), no_proxy),
                ],
                unset: Vec::new(),
            })
        }
    }
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
    use super::{
        build_proxy_aware_reqwest_client_for_settings, build_proxy_environment_for_settings,
        DesktopNetworkProxyEnvironment, DesktopNetworkProxySettings,
    };
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

    #[test]
    fn proxy_environment_defaults_to_empty_for_system_mode() {
        let settings = DesktopNetworkProxySettings {
            mode: DesktopNetworkProxyMode::System,
            url: None,
        };
        assert_eq!(
            build_proxy_environment_for_settings(&settings).unwrap(),
            DesktopNetworkProxyEnvironment::default()
        );
    }

    #[test]
    fn proxy_environment_unsets_known_proxy_keys_for_none_mode() {
        let settings = DesktopNetworkProxySettings {
            mode: DesktopNetworkProxyMode::None,
            url: None,
        };
        let env = build_proxy_environment_for_settings(&settings).unwrap();
        assert!(env.set.is_empty());
        assert!(env.unset.contains(&"HTTP_PROXY".to_string()));
        assert!(env.unset.contains(&"no_proxy".to_string()));
    }

    #[test]
    fn proxy_environment_sets_upper_and_lower_case_proxy_vars_for_custom_mode() {
        let settings = DesktopNetworkProxySettings {
            mode: DesktopNetworkProxyMode::Custom,
            url: Some("http://127.0.0.1:7890".to_string()),
        };
        let env = build_proxy_environment_for_settings(&settings).unwrap();
        assert!(env.unset.is_empty());
        assert!(env
            .set
            .contains(&("HTTP_PROXY".to_string(), "http://127.0.0.1:7890".to_string())));
        assert!(env
            .set
            .contains(&("ALL_PROXY".to_string(), "http://127.0.0.1:7890".to_string())));
        assert!(env
            .set
            .contains(&("NO_PROXY".to_string(), "127.0.0.1,localhost".to_string())));
    }
}
