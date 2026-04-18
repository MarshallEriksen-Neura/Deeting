pub mod commands;
pub(crate) mod network;
pub(crate) mod store;
pub(crate) mod store_init;

pub(crate) const MAX_AGENTIC_ROUNDS_CONFIG_KEY: &str = "max_agentic_rounds";
pub(crate) const DEFAULT_MAX_AGENTIC_ROUNDS: usize = 10;
pub(crate) const APPROVAL_POLICY_LEVEL_CONFIG_KEY: &str = "chat.approval_policy_level";
pub(crate) const DESKTOP_NETWORK_PROXY_MODE_CONFIG_KEY: &str = "network.proxy.mode";
pub(crate) const DESKTOP_NETWORK_PROXY_URL_CONFIG_KEY: &str = "network.proxy.url";
pub(crate) const DESKTOP_SANDBOX_IMAGE_REGISTRIES_CONFIG_KEY: &str = "sandbox.image_registries";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesktopNetworkProxyMode {
    None,
    System,
    Custom,
}

pub(crate) const DEFAULT_DESKTOP_NETWORK_PROXY_MODE: DesktopNetworkProxyMode =
    DesktopNetworkProxyMode::System;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesktopApprovalPolicyLevel {
    High,
    Medium,
    Low,
}

pub(crate) const DEFAULT_APPROVAL_POLICY_LEVEL: DesktopApprovalPolicyLevel =
    DesktopApprovalPolicyLevel::Medium;

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

pub(crate) fn parse_approval_policy_level(raw: Option<&str>) -> DesktopApprovalPolicyLevel {
    match raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("high") => DesktopApprovalPolicyLevel::High,
        Some("low") => DesktopApprovalPolicyLevel::Low,
        _ => DEFAULT_APPROVAL_POLICY_LEVEL,
    }
}

/// Parse a newline/comma-separated string of image registry hosts.
///
/// - Splits on `\n`, `\r`, `,`, `;`, `\t` and ASCII whitespace.
/// - Trims each entry, drops empties.
/// - Dedupes case-insensitively while preserving first-seen order.
pub(crate) fn parse_sandbox_image_registries(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for part in raw.split(['\n', '\r', ',', ';', '\t', ' ']) {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = trimmed.to_ascii_lowercase();
        if seen.insert(key) {
            out.push(trimmed.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{
        parse_approval_policy_level, parse_desktop_network_proxy_mode, parse_max_agentic_rounds,
        DesktopApprovalPolicyLevel, DesktopNetworkProxyMode, APPROVAL_POLICY_LEVEL_CONFIG_KEY,
        DEFAULT_APPROVAL_POLICY_LEVEL, DEFAULT_DESKTOP_NETWORK_PROXY_MODE,
        DEFAULT_MAX_AGENTIC_ROUNDS, DESKTOP_NETWORK_PROXY_MODE_CONFIG_KEY,
        DESKTOP_NETWORK_PROXY_URL_CONFIG_KEY, MAX_AGENTIC_ROUNDS_CONFIG_KEY,
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

    #[test]
    fn parse_approval_policy_level_defaults_to_medium() {
        assert_eq!(
            parse_approval_policy_level(None),
            DEFAULT_APPROVAL_POLICY_LEVEL
        );
        assert_eq!(
            parse_approval_policy_level(Some("")),
            DEFAULT_APPROVAL_POLICY_LEVEL
        );
        assert_eq!(
            parse_approval_policy_level(Some("unknown")),
            DEFAULT_APPROVAL_POLICY_LEVEL
        );
        assert_eq!(
            APPROVAL_POLICY_LEVEL_CONFIG_KEY,
            "chat.approval_policy_level"
        );
    }

    #[test]
    fn parse_approval_policy_level_accepts_known_values() {
        assert_eq!(
            parse_approval_policy_level(Some("high")),
            DesktopApprovalPolicyLevel::High
        );
        assert_eq!(
            parse_approval_policy_level(Some(" medium ")),
            DesktopApprovalPolicyLevel::Medium
        );
        assert_eq!(
            parse_approval_policy_level(Some("LOW")),
            DesktopApprovalPolicyLevel::Low
        );
    }
}
