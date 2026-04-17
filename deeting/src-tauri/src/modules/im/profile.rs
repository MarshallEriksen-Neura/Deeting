use serde::{Deserialize, Serialize};

use super::ImPlatform;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImTransportPreference {
    Auto,
    Direct,
    Relay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImTransportKind {
    Direct,
    Relay,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImTransportReasonCode {
    DirectSupported,
    DirectMissingCredentials,
    DirectProbeFailed,
    RelayConfiguredFallback,
    RelayForcedByUser,
    DirectForcedByUser,
    RelayMissingConfig,
    NoAvailableTransport,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ImDirectConfig {
    #[serde(default)]
    pub feishu_app_id: String,
    #[serde(default)]
    pub feishu_app_secret: String,
    #[serde(default)]
    pub telegram_bot_token: String,
    #[serde(default)]
    pub telegram_media_enabled: bool,
    #[serde(default)]
    pub wechat_account_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ImRelayConfig {
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub shared_secret: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImConnectionProfile {
    pub id: String,
    pub platform: ImPlatform,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub enabled: bool,
    pub transport_preference: ImTransportPreference,
    #[serde(default)]
    pub direct_config: ImDirectConfig,
    #[serde(default)]
    pub relay_config: ImRelayConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImTransportResolution {
    pub effective: ImTransportKind,
    pub reason_code: ImTransportReasonCode,
    pub user_message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedImConnectionProfile {
    pub profile_id: String,
    pub platform: ImPlatform,
    pub display_name: String,
    pub enabled: bool,
    pub resolution: ImTransportResolution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImRuntimeState {
    Configured,
    Enabled,
    Running,
    Degraded,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ImRuntimeCapabilities {
    #[serde(default)]
    pub inbound: Vec<String>,
    #[serde(default)]
    pub outbound: Vec<String>,
    #[serde(default)]
    pub degradations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImRuntimeProfileSnapshot {
    pub profile_id: String,
    pub platform: ImPlatform,
    pub display_name: String,
    pub configured: bool,
    pub enabled: bool,
    pub effective_state: ImRuntimeState,
    pub status_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default)]
    pub restart_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_retry_at: Option<String>,
    pub capabilities: ImRuntimeCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalImSettingsSnapshot {
    pub profiles: Vec<ImConnectionProfile>,
    pub resolved_profiles: Vec<ResolvedImConnectionProfile>,
    #[serde(default)]
    pub runtime_profiles: Vec<ImRuntimeProfileSnapshot>,
}

impl ImConnectionProfile {
    pub fn default_feishu() -> Self {
        Self {
            id: "feishu-default".to_string(),
            platform: ImPlatform::Feishu,
            display_name: "Feishu".to_string(),
            enabled: false,
            transport_preference: ImTransportPreference::Auto,
            direct_config: ImDirectConfig::default(),
            relay_config: ImRelayConfig::default(),
        }
    }

    pub fn default_telegram() -> Self {
        Self {
            id: "telegram-default".to_string(),
            platform: ImPlatform::Telegram,
            display_name: "Telegram".to_string(),
            enabled: false,
            transport_preference: ImTransportPreference::Auto,
            direct_config: ImDirectConfig::default(),
            relay_config: ImRelayConfig::default(),
        }
    }

    pub fn trim(mut self) -> Self {
        self.id = self.id.trim().to_string();
        self.display_name = self.display_name.trim().to_string();
        self.direct_config.feishu_app_id = self.direct_config.feishu_app_id.trim().to_string();
        self.direct_config.feishu_app_secret =
            self.direct_config.feishu_app_secret.trim().to_string();
        self.direct_config.telegram_bot_token =
            self.direct_config.telegram_bot_token.trim().to_string();
        self.direct_config.wechat_account_id =
            self.direct_config.wechat_account_id.trim().to_string();
        self.relay_config.base_url = self.relay_config.base_url.trim().to_string();
        self.relay_config.shared_secret = self.relay_config.shared_secret.trim().to_string();
        self
    }

    pub fn supports_direct_transport(&self) -> bool {
        matches!(
            self.platform,
            ImPlatform::Feishu | ImPlatform::Telegram | ImPlatform::Wechat
        )
    }

    pub fn has_direct_credentials(&self) -> bool {
        match self.platform {
            ImPlatform::Feishu => {
                !self.direct_config.feishu_app_id.trim().is_empty()
                    && !self.direct_config.feishu_app_secret.trim().is_empty()
            }
            ImPlatform::Telegram => !self.direct_config.telegram_bot_token.trim().is_empty(),
            ImPlatform::Wechat => !self.direct_config.wechat_account_id.trim().is_empty(),
            _ => false,
        }
    }

    pub fn has_relay_config(&self) -> bool {
        !self.relay_config.base_url.trim().is_empty()
    }
}

pub fn resolve_transport(profile: &ImConnectionProfile) -> ImTransportResolution {
    let supports_direct = profile.supports_direct_transport();
    let has_direct_credentials = profile.has_direct_credentials();
    let has_relay_config = profile.has_relay_config();

    match profile.transport_preference {
        ImTransportPreference::Direct => {
            if supports_direct && has_direct_credentials {
                ImTransportResolution {
                    effective: ImTransportKind::Direct,
                    reason_code: ImTransportReasonCode::DirectForcedByUser,
                    user_message: "Direct transport was selected explicitly.".to_string(),
                }
            } else if supports_direct {
                ImTransportResolution {
                    effective: ImTransportKind::Unavailable,
                    reason_code: ImTransportReasonCode::DirectMissingCredentials,
                    user_message:
                        "Direct transport was selected, but required direct credentials are incomplete."
                            .to_string(),
                }
            } else {
                ImTransportResolution {
                    effective: ImTransportKind::Unavailable,
                    reason_code: ImTransportReasonCode::NoAvailableTransport,
                    user_message: "This platform does not support direct transport yet."
                        .to_string(),
                }
            }
        }
        ImTransportPreference::Relay => {
            if has_relay_config {
                ImTransportResolution {
                    effective: ImTransportKind::Relay,
                    reason_code: ImTransportReasonCode::RelayForcedByUser,
                    user_message: "Relay transport was selected explicitly.".to_string(),
                }
            } else {
                ImTransportResolution {
                    effective: ImTransportKind::Unavailable,
                    reason_code: ImTransportReasonCode::RelayMissingConfig,
                    user_message:
                        "Relay transport was selected, but relay settings are incomplete."
                            .to_string(),
                }
            }
        }
        ImTransportPreference::Auto => {
            if supports_direct && has_direct_credentials {
                ImTransportResolution {
                    effective: ImTransportKind::Direct,
                    reason_code: ImTransportReasonCode::DirectSupported,
                    user_message: "Direct transport is available, so auto mode selected it."
                        .to_string(),
                }
            } else if has_relay_config {
                ImTransportResolution {
                    effective: ImTransportKind::Relay,
                    reason_code: ImTransportReasonCode::RelayConfiguredFallback,
                    user_message:
                        "Direct transport is unavailable, so auto mode fell back to relay."
                            .to_string(),
                }
            } else if supports_direct {
                ImTransportResolution {
                    effective: ImTransportKind::Unavailable,
                    reason_code: ImTransportReasonCode::DirectMissingCredentials,
                    user_message:
                        "Direct transport is supported, but required credentials are missing."
                            .to_string(),
                }
            } else {
                ImTransportResolution {
                    effective: ImTransportKind::Unavailable,
                    reason_code: ImTransportReasonCode::NoAvailableTransport,
                    user_message: "No supported transport is configured for this platform."
                        .to_string(),
                }
            }
        }
    }
}

pub fn resolve_profiles(profiles: &[ImConnectionProfile]) -> Vec<ResolvedImConnectionProfile> {
    profiles
        .iter()
        .map(|profile| ResolvedImConnectionProfile {
            profile_id: profile.id.clone(),
            platform: profile.platform,
            display_name: profile.display_name.clone(),
            enabled: profile.enabled,
            resolution: resolve_transport(profile),
        })
        .collect()
}

fn feature_list(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

pub fn platform_capabilities(
    profile: &ImConnectionProfile,
    resolution: &ImTransportResolution,
) -> ImRuntimeCapabilities {
    match (profile.platform, resolution.effective) {
        (ImPlatform::Feishu, ImTransportKind::Direct) => ImRuntimeCapabilities {
            inbound: feature_list(&["text", "image", "file", "card_action"]),
            outbound: feature_list(&["text", "interactive_card", "image", "file"]),
            degradations: feature_list(&[
                "mixed_parts_to_text",
                "non_native_media_to_text_link",
                "raw_url_media_requires_feishu_asset_key",
            ]),
        },
        (ImPlatform::Feishu, ImTransportKind::Relay) => ImRuntimeCapabilities {
            inbound: feature_list(&["text"]),
            outbound: feature_list(&["text"]),
            degradations: feature_list(&["relay_runtime", "rich_content_to_text"]),
        },
        (ImPlatform::Telegram, _) => ImRuntimeCapabilities {
            inbound: feature_list(&["text", "image", "file", "card_action"]),
            outbound: if profile.direct_config.telegram_media_enabled {
                feature_list(&["text", "image", "file", "mixed"])
            } else {
                feature_list(&["text"])
            },
            degradations: if profile.direct_config.telegram_media_enabled {
                feature_list(&[
                    "interactive_card_as_text",
                    "non_remote_media_reference_to_text",
                ])
            } else {
                feature_list(&[
                    "interactive_card_as_text",
                    "telegram_media_gate_disabled",
                    "mixed_content_as_text_notice",
                ])
            },
        },
        (ImPlatform::Wechat, _) => ImRuntimeCapabilities {
            inbound: feature_list(&["text", "image", "file", "video", "voice"]),
            outbound: feature_list(&["text", "image", "file", "video", "voice", "typing", "mixed"]),
            degradations: feature_list(&[
                "upload_or_cdn_policy_still_evolving",
                "non_remote_media_reference_to_text",
            ]),
        },
        _ => ImRuntimeCapabilities {
            inbound: feature_list(&["text"]),
            outbound: feature_list(&["text"]),
            degradations: Vec::new(),
        },
    }
}

pub fn build_settings_snapshot(
    profiles: Vec<ImConnectionProfile>,
    runtime_profiles: Vec<ImRuntimeProfileSnapshot>,
) -> LocalImSettingsSnapshot {
    let resolved_profiles = resolve_profiles(&profiles);
    LocalImSettingsSnapshot {
        profiles,
        resolved_profiles,
        runtime_profiles,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feishu_profile(preference: ImTransportPreference) -> ImConnectionProfile {
        ImConnectionProfile {
            id: "profile-feishu".to_string(),
            platform: ImPlatform::Feishu,
            display_name: "Feishu".to_string(),
            enabled: true,
            transport_preference: preference,
            direct_config: ImDirectConfig {
                feishu_app_id: "cli_xxx".to_string(),
                feishu_app_secret: "secret".to_string(),
                telegram_bot_token: String::new(),
                telegram_media_enabled: false,
                wechat_account_id: String::new(),
            },
            relay_config: ImRelayConfig {
                base_url: "https://relay.example.com".to_string(),
                shared_secret: "relay-secret".to_string(),
            },
        }
    }

    fn telegram_profile(preference: ImTransportPreference) -> ImConnectionProfile {
        ImConnectionProfile {
            id: "profile-telegram".to_string(),
            platform: ImPlatform::Telegram,
            display_name: "Telegram".to_string(),
            enabled: true,
            transport_preference: preference,
            direct_config: ImDirectConfig {
                feishu_app_id: String::new(),
                feishu_app_secret: String::new(),
                telegram_bot_token: "telegram-token".to_string(),
                telegram_media_enabled: false,
                wechat_account_id: String::new(),
            },
            relay_config: ImRelayConfig::default(),
        }
    }

    #[test]
    fn auto_prefers_direct_when_platform_supports_it() {
        let profile = feishu_profile(ImTransportPreference::Auto);

        let resolved = resolve_transport(&profile);

        assert_eq!(resolved.effective, ImTransportKind::Direct);
        assert_eq!(resolved.reason_code, ImTransportReasonCode::DirectSupported);
    }

    #[test]
    fn auto_falls_back_to_relay_when_direct_credentials_missing() {
        let mut profile = feishu_profile(ImTransportPreference::Auto);
        profile.direct_config.feishu_app_id.clear();
        profile.direct_config.feishu_app_secret.clear();

        let resolved = resolve_transport(&profile);

        assert_eq!(resolved.effective, ImTransportKind::Relay);
        assert_eq!(
            resolved.reason_code,
            ImTransportReasonCode::RelayConfiguredFallback
        );
    }

    #[test]
    fn forced_direct_does_not_silently_fallback_to_relay() {
        let mut profile = feishu_profile(ImTransportPreference::Direct);
        profile.direct_config.feishu_app_id.clear();
        profile.direct_config.feishu_app_secret.clear();

        let resolved = resolve_transport(&profile);

        assert_eq!(resolved.effective, ImTransportKind::Unavailable);
        assert_eq!(
            resolved.reason_code,
            ImTransportReasonCode::DirectMissingCredentials
        );
    }

    #[test]
    fn telegram_profile_with_token_supports_direct_transport() {
        let profile = telegram_profile(ImTransportPreference::Auto);

        let resolved = resolve_transport(&profile);

        assert_eq!(resolved.effective, ImTransportKind::Direct);
        assert_eq!(resolved.reason_code, ImTransportReasonCode::DirectSupported);
    }
}
