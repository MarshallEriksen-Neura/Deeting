use std::env;
#[cfg(target_os = "windows")]
use std::process::Command;

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

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct DesktopResolvedProxyConfig {
    http_proxy: Option<String>,
    https_proxy: Option<String>,
    all_proxy: Option<String>,
    no_proxy: Option<String>,
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

impl DesktopResolvedProxyConfig {
    fn is_empty(&self) -> bool {
        self.http_proxy.is_none() && self.https_proxy.is_none() && self.all_proxy.is_none()
    }

    fn with_default_no_proxy(mut self) -> Self {
        self.no_proxy = Some(combine_no_proxy(self.no_proxy.as_deref()));
        self
    }

    fn to_environment(&self) -> DesktopNetworkProxyEnvironment {
        let mut set = Vec::new();
        if let Some(value) = self.http_proxy.as_deref() {
            set.push(("HTTP_PROXY".to_string(), value.to_string()));
            set.push(("http_proxy".to_string(), value.to_string()));
        }
        if let Some(value) = self.https_proxy.as_deref() {
            set.push(("HTTPS_PROXY".to_string(), value.to_string()));
            set.push(("https_proxy".to_string(), value.to_string()));
        }
        if let Some(value) = self.all_proxy.as_deref() {
            set.push(("ALL_PROXY".to_string(), value.to_string()));
            set.push(("all_proxy".to_string(), value.to_string()));
        }
        let no_proxy = combine_no_proxy(self.no_proxy.as_deref());
        set.push(("NO_PROXY".to_string(), no_proxy.clone()));
        set.push(("no_proxy".to_string(), no_proxy));
        DesktopNetworkProxyEnvironment {
            set,
            unset: Vec::new(),
        }
    }
}

fn combine_no_proxy(raw: Option<&str>) -> String {
    let mut values = Vec::new();
    for item in raw
        .unwrap_or_default()
        .split([';', ',', ' ', '\t', '\r', '\n'])
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "<local>")
    {
        if !values
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(item))
        {
            values.push(item.to_string());
        }
    }
    for local in ["127.0.0.1", "localhost"] {
        if !values
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(local))
        {
            values.push(local.to_string());
        }
    }
    values.join(",")
}

fn apply_resolved_proxy_to_reqwest_builder(
    mut builder: reqwest::ClientBuilder,
    config: &DesktopResolvedProxyConfig,
) -> reqwest::ClientBuilder {
    let http_proxy = config.http_proxy.as_deref().or(config.all_proxy.as_deref());
    let https_proxy = config
        .https_proxy
        .as_deref()
        .or(config.http_proxy.as_deref())
        .or(config.all_proxy.as_deref());

    if let Some(proxy_url) = http_proxy {
        if let Ok(proxy) = reqwest::Proxy::http(proxy_url) {
            builder = builder.proxy(proxy);
        }
    }
    if let Some(proxy_url) = https_proxy {
        if let Ok(proxy) = reqwest::Proxy::https(proxy_url) {
            builder = builder.proxy(proxy);
        }
    }
    builder
}

fn resolve_system_proxy_config() -> Option<DesktopResolvedProxyConfig> {
    #[cfg(target_os = "windows")]
    {
        resolve_windows_system_proxy_config().or_else(proxy_config_from_process_env)
    }

    #[cfg(not(target_os = "windows"))]
    {
        proxy_config_from_process_env()
    }
}

fn proxy_config_from_process_env() -> Option<DesktopResolvedProxyConfig> {
    let config = DesktopResolvedProxyConfig {
        http_proxy: normalize_proxy_url(env::var("HTTP_PROXY").ok().as_deref())
            .or_else(|| normalize_proxy_url(env::var("http_proxy").ok().as_deref())),
        https_proxy: normalize_proxy_url(env::var("HTTPS_PROXY").ok().as_deref())
            .or_else(|| normalize_proxy_url(env::var("https_proxy").ok().as_deref())),
        all_proxy: normalize_proxy_url(env::var("ALL_PROXY").ok().as_deref())
            .or_else(|| normalize_proxy_url(env::var("all_proxy").ok().as_deref())),
        no_proxy: normalize_proxy_url(env::var("NO_PROXY").ok().as_deref())
            .or_else(|| normalize_proxy_url(env::var("no_proxy").ok().as_deref())),
    };
    (!config.is_empty()).then(|| config.with_default_no_proxy())
}

#[cfg(target_os = "windows")]
fn resolve_windows_system_proxy_config() -> Option<DesktopResolvedProxyConfig> {
    let output = Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let proxy_enable = parse_registry_value(stdout.as_ref(), "ProxyEnable")
        .map(|value| parse_registry_dword(value.as_str()))
        .unwrap_or(false);
    let proxy_server = parse_registry_value(stdout.as_ref(), "ProxyServer");
    let proxy_override = parse_registry_value(stdout.as_ref(), "ProxyOverride");

    if !proxy_enable {
        return None;
    }

    let config = parse_windows_proxy_server(proxy_server.as_deref()?)?;
    Some(
        DesktopResolvedProxyConfig {
            no_proxy: proxy_override,
            ..config
        }
        .with_default_no_proxy(),
    )
}

#[cfg(target_os = "windows")]
fn parse_registry_value(output: &str, value_name: &str) -> Option<String> {
    output.lines().map(str::trim).find_map(|line| {
        let mut parts = line.split_whitespace();
        let name = parts.next()?;
        if !name.eq_ignore_ascii_case(value_name) {
            return None;
        }
        let _kind = parts.next()?;
        let value = parts.collect::<Vec<_>>().join(" ");
        (!value.is_empty()).then_some(value)
    })
}

#[cfg(target_os = "windows")]
fn parse_registry_dword(raw: &str) -> bool {
    let value = raw.trim();
    value.eq_ignore_ascii_case("0x1") || value == "1"
}

#[cfg(target_os = "windows")]
fn parse_windows_proxy_server(raw: &str) -> Option<DesktopResolvedProxyConfig> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if !trimmed.contains('=') {
        let proxy = normalize_registry_proxy_url(trimmed, "http")?;
        return Some(DesktopResolvedProxyConfig {
            http_proxy: Some(proxy.clone()),
            https_proxy: Some(proxy.clone()),
            all_proxy: Some(proxy),
            no_proxy: None,
        });
    }

    let mut config = DesktopResolvedProxyConfig::default();
    for segment in trimmed.split(';') {
        let (scheme, value) = match segment.split_once('=') {
            Some(parts) => parts,
            None => continue,
        };
        let scheme = scheme.trim().to_ascii_lowercase();
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match scheme.as_str() {
            "http" => {
                config.http_proxy = normalize_registry_proxy_url(value, "http");
            }
            "https" => {
                config.https_proxy = normalize_registry_proxy_url(value, "http");
            }
            "socks" => {
                config.all_proxy = normalize_registry_proxy_url(value, "socks5");
            }
            "all" | "proxy" => {
                let proxy = normalize_registry_proxy_url(value, "http");
                config.http_proxy = proxy.clone();
                config.https_proxy = proxy.clone();
                config.all_proxy = proxy;
            }
            _ => {}
        }
    }

    if config.http_proxy.is_none() {
        config.http_proxy = config.all_proxy.clone();
    }
    if config.https_proxy.is_none() {
        config.https_proxy = config
            .http_proxy
            .clone()
            .or_else(|| config.all_proxy.clone());
    }
    (!config.is_empty()).then_some(config)
}

#[cfg(target_os = "windows")]
fn normalize_registry_proxy_url(value: &str, default_scheme: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.contains("://") {
        return Some(trimmed.to_string());
    }
    Some(format!("{default_scheme}://{trimmed}"))
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
        DesktopNetworkProxyMode::System => match resolve_system_proxy_config() {
            Some(config) => {
                apply_resolved_proxy_to_reqwest_builder(reqwest::Client::builder(), &config)
            }
            None => reqwest::Client::builder(),
        },
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
        DesktopNetworkProxyMode::System => Ok(resolve_system_proxy_config()
            .map(|config| config.to_environment())
            .unwrap_or_default()),
        DesktopNetworkProxyMode::None => Ok(DesktopNetworkProxyEnvironment {
            set: Vec::new(),
            unset: PROXY_ENV_KEYS
                .iter()
                .map(|key| (*key).to_string())
                .collect(),
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
        combine_no_proxy, DesktopNetworkProxySettings,
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
        let env = build_proxy_environment_for_settings(&settings).unwrap();
        assert!(env.set.is_empty() || env.set.iter().any(|(key, _)| key == "NO_PROXY"));
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
        assert!(env.set.contains(&(
            "HTTP_PROXY".to_string(),
            "http://127.0.0.1:7890".to_string()
        )));
        assert!(env
            .set
            .contains(&("ALL_PROXY".to_string(), "http://127.0.0.1:7890".to_string())));
        assert!(env
            .set
            .contains(&("NO_PROXY".to_string(), "127.0.0.1,localhost".to_string())));
    }

    #[test]
    fn combine_no_proxy_merges_existing_entries_with_local_hosts() {
        assert_eq!(
            combine_no_proxy(Some("example.com;<local>;localhost")),
            "example.com,localhost,127.0.0.1"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parse_windows_proxy_server_supports_single_proxy_endpoint() {
        let config = super::parse_windows_proxy_server("127.0.0.1:7890").expect("config");
        assert_eq!(config.http_proxy.as_deref(), Some("http://127.0.0.1:7890"));
        assert_eq!(config.https_proxy.as_deref(), Some("http://127.0.0.1:7890"));
        assert_eq!(config.all_proxy.as_deref(), Some("http://127.0.0.1:7890"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parse_windows_proxy_server_supports_scheme_specific_entries() {
        let config = super::parse_windows_proxy_server(
            "http=127.0.0.1:7890;https=127.0.0.1:7891;socks=127.0.0.1:1080",
        )
        .expect("config");
        assert_eq!(config.http_proxy.as_deref(), Some("http://127.0.0.1:7890"));
        assert_eq!(config.https_proxy.as_deref(), Some("http://127.0.0.1:7891"));
        assert_eq!(config.all_proxy.as_deref(), Some("socks5://127.0.0.1:1080"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parse_registry_value_reads_reg_query_lines() {
        let output = r#"
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ       127.0.0.1:7890
    ProxyOverride  REG_SZ       <local>;localhost
"#;

        assert_eq!(
            super::parse_registry_value(output, "ProxyServer").as_deref(),
            Some("127.0.0.1:7890")
        );
        assert!(super::parse_registry_dword(
            super::parse_registry_value(output, "ProxyEnable")
                .as_deref()
                .expect("ProxyEnable")
        ));
    }
}
