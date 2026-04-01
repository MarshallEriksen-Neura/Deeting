pub mod commands;
pub(crate) mod network;
pub(crate) mod store;
pub(crate) mod store_init;

pub(crate) const MAX_AGENTIC_ROUNDS_CONFIG_KEY: &str = "max_agentic_rounds";
pub(crate) const DEFAULT_MAX_AGENTIC_ROUNDS: usize = 10;
pub(crate) const DESKTOP_NETWORK_PROXY_MODE_CONFIG_KEY: &str = "network.proxy.mode";
pub(crate) const DESKTOP_NETWORK_PROXY_URL_CONFIG_KEY: &str = "network.proxy.url";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesktopNetworkProxyMode {
    None,
    System,
    Custom,
}

pub(crate) const DEFAULT_DESKTOP_NETWORK_PROXY_MODE: DesktopNetworkProxyMode =
    DesktopNetworkProxyMode::System;

pub(crate) fn parse_max_agentic_rounds(raw: Option<&str>) -> usize {
    raw.and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_MAX_AGENTIC_ROUNDS)
}

pub(crate) fn parse_desktop_network_proxy_mode(raw: Option<&str>) -> DesktopNetworkProxyMode {
    match raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("none") => DesktopNetworkProxyMode::None,
        Some("custom") => DesktopNetworkProxyMode::Custom,
        _ => DEFAULT_DESKTOP_NETWORK_PROXY_MODE,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_desktop_network_proxy_mode, parse_max_agentic_rounds, DesktopNetworkProxyMode,
        DEFAULT_DESKTOP_NETWORK_PROXY_MODE, DEFAULT_MAX_AGENTIC_ROUNDS,
        DESKTOP_NETWORK_PROXY_MODE_CONFIG_KEY, DESKTOP_NETWORK_PROXY_URL_CONFIG_KEY,
        MAX_AGENTIC_ROUNDS_CONFIG_KEY,
    };

    #[test]
    fn parse_max_agentic_rounds_accepts_valid_positive_values() {
        assert_eq!(parse_max_agentic_rounds(Some("12")), 12);
        assert_eq!(parse_max_agentic_rounds(Some(" 7 ")), 7);
    }

    #[test]
    fn parse_max_agentic_rounds_falls_back_for_missing_or_invalid_values() {
        assert_eq!(MAX_AGENTIC_ROUNDS_CONFIG_KEY, "max_agentic_rounds");
        assert_eq!(parse_max_agentic_rounds(None), DEFAULT_MAX_AGENTIC_ROUNDS);
        assert_eq!(
            parse_max_agentic_rounds(Some("")),
            DEFAULT_MAX_AGENTIC_ROUNDS
        );
        assert_eq!(
            parse_max_agentic_rounds(Some("0")),
            DEFAULT_MAX_AGENTIC_ROUNDS
        );
        assert_eq!(
            parse_max_agentic_rounds(Some("nope")),
            DEFAULT_MAX_AGENTIC_ROUNDS
        );
    }

    #[test]
    fn parse_desktop_network_proxy_mode_defaults_to_system() {
        assert_eq!(
            parse_desktop_network_proxy_mode(None),
            DEFAULT_DESKTOP_NETWORK_PROXY_MODE
        );
        assert_eq!(
            parse_desktop_network_proxy_mode(Some("")),
            DEFAULT_DESKTOP_NETWORK_PROXY_MODE
        );
        assert_eq!(
            parse_desktop_network_proxy_mode(Some("unknown")),
            DEFAULT_DESKTOP_NETWORK_PROXY_MODE
        );
        assert_eq!(DESKTOP_NETWORK_PROXY_MODE_CONFIG_KEY, "network.proxy.mode");
        assert_eq!(DESKTOP_NETWORK_PROXY_URL_CONFIG_KEY, "network.proxy.url");
    }

    #[test]
    fn parse_desktop_network_proxy_mode_accepts_known_values() {
        assert_eq!(
            parse_desktop_network_proxy_mode(Some("none")),
            DesktopNetworkProxyMode::None
        );
        assert_eq!(
            parse_desktop_network_proxy_mode(Some(" custom ")),
            DesktopNetworkProxyMode::Custom
        );
        assert_eq!(
            parse_desktop_network_proxy_mode(Some("system")),
            DesktopNetworkProxyMode::System
        );
    }
}
