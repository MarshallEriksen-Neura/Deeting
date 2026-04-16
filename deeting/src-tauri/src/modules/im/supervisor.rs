use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::RwLock;

use super::{
    platform_capabilities, resolve_transport, ImConnectionProfile, ImRuntimeProfileSnapshot,
    ImRuntimeState, ImTransportKind,
};

#[derive(Debug, Clone)]
pub(crate) struct ImSupervisorStatus {
    pub profile: ImConnectionProfile,
    pub effective_state: ImRuntimeState,
    pub status_message: String,
    pub last_error: Option<String>,
    pub restart_count: u32,
    pub next_retry_at: Option<DateTime<Utc>>,
}

impl ImSupervisorStatus {
    fn from_profile(profile: &ImConnectionProfile) -> Self {
        let resolution = resolve_transport(profile);
        let configured = profile.has_direct_credentials() || profile.has_relay_config();
        let effective_state = if !configured {
            ImRuntimeState::Unavailable
        } else if !profile.enabled {
            ImRuntimeState::Configured
        } else if resolution.effective == ImTransportKind::Unavailable {
            ImRuntimeState::Unavailable
        } else {
            ImRuntimeState::Enabled
        };

        Self {
            profile: profile.clone(),
            effective_state,
            status_message: resolution.user_message,
            last_error: None,
            restart_count: 0,
            next_retry_at: None,
        }
    }

    fn to_snapshot(&self) -> ImRuntimeProfileSnapshot {
        let resolution = resolve_transport(&self.profile);
        ImRuntimeProfileSnapshot {
            profile_id: self.profile.id.clone(),
            platform: self.profile.platform,
            display_name: self.profile.display_name.clone(),
            configured: self.profile.has_direct_credentials() || self.profile.has_relay_config(),
            enabled: self.profile.enabled,
            effective_state: self.effective_state,
            status_message: self.status_message.clone(),
            last_error: self.last_error.clone(),
            restart_count: self.restart_count,
            next_retry_at: self.next_retry_at.map(|value| value.to_rfc3339()),
            capabilities: platform_capabilities(&self.profile, &resolution),
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct ImSupervisorState {
    statuses: HashMap<String, ImSupervisorStatus>,
}

impl ImSupervisorState {
    fn replace_profiles(&mut self, profiles: &[ImConnectionProfile]) {
        self.statuses = profiles
            .iter()
            .map(|profile| {
                (
                    profile.id.clone(),
                    ImSupervisorStatus::from_profile(profile),
                )
            })
            .collect();
    }

    fn update_state(
        &mut self,
        profile_id: &str,
        effective_state: ImRuntimeState,
        status_message: impl Into<String>,
    ) {
        if let Some(status) = self.statuses.get_mut(profile_id) {
            status.effective_state = effective_state;
            status.status_message = status_message.into();
            if !matches!(
                effective_state,
                ImRuntimeState::Degraded | ImRuntimeState::Unavailable
            ) {
                status.last_error = None;
                status.next_retry_at = None;
            }
        }
    }

    fn record_error(
        &mut self,
        profile_id: &str,
        effective_state: ImRuntimeState,
        message: impl Into<String>,
        retry_delay: Option<Duration>,
    ) {
        if let Some(status) = self.statuses.get_mut(profile_id) {
            let message = message.into();
            status.effective_state = effective_state;
            status.status_message = message.clone();
            status.last_error = Some(message);
            status.restart_count = status.restart_count.saturating_add(1);
            status.next_retry_at = retry_delay.map(|delay| {
                Utc::now()
                    + chrono::Duration::from_std(delay)
                        .unwrap_or_else(|_| chrono::Duration::seconds(0))
            });
        }
    }

    fn snapshots(&self) -> Vec<ImRuntimeProfileSnapshot> {
        let mut snapshots = self
            .statuses
            .values()
            .map(ImSupervisorStatus::to_snapshot)
            .collect::<Vec<_>>();
        snapshots.sort_by(|left, right| left.profile_id.cmp(&right.profile_id));
        snapshots
    }
}

fn state_slot() -> &'static Arc<RwLock<ImSupervisorState>> {
    static SLOT: OnceLock<Arc<RwLock<ImSupervisorState>>> = OnceLock::new();
    SLOT.get_or_init(|| Arc::new(RwLock::new(ImSupervisorState::default())))
}

pub(crate) async fn replace_supervisor_profiles(profiles: &[ImConnectionProfile]) {
    let state = state_slot();
    let mut guard = state.write().await;
    guard.replace_profiles(profiles);
}

pub(crate) async fn mark_profile_running(
    profile: &ImConnectionProfile,
    message: impl Into<String>,
) {
    let state = state_slot();
    let mut guard = state.write().await;
    guard.update_state(profile.id.as_str(), ImRuntimeState::Running, message);
}

pub(crate) async fn mark_profile_degraded(
    profile: &ImConnectionProfile,
    message: impl Into<String>,
    retry_delay: Option<Duration>,
) {
    let state = state_slot();
    let mut guard = state.write().await;
    guard.record_error(
        profile.id.as_str(),
        ImRuntimeState::Degraded,
        message,
        retry_delay,
    );
}

pub(crate) async fn mark_profile_unavailable(
    profile: &ImConnectionProfile,
    message: impl Into<String>,
) {
    let state = state_slot();
    let mut guard = state.write().await;
    guard.record_error(
        profile.id.as_str(),
        ImRuntimeState::Unavailable,
        message,
        None,
    );
}

pub(crate) async fn supervisor_snapshots() -> Vec<ImRuntimeProfileSnapshot> {
    let state = state_slot();
    let guard = state.read().await;
    guard.snapshots()
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::modules::im::{ImDirectConfig, ImPlatform, ImTransportPreference};

    fn telegram_profile(enabled: bool) -> ImConnectionProfile {
        ImConnectionProfile {
            id: "profile-telegram".to_string(),
            platform: ImPlatform::Telegram,
            display_name: "Telegram".to_string(),
            enabled,
            transport_preference: ImTransportPreference::Direct,
            direct_config: ImDirectConfig {
                telegram_bot_token: "telegram-token".to_string(),
                ..Default::default()
            },
            relay_config: Default::default(),
        }
    }

    #[tokio::test]
    async fn supervisor_tracks_running_and_degraded_states() {
        let profile = telegram_profile(true);
        replace_supervisor_profiles(&[profile.clone()]).await;

        mark_profile_running(&profile, "Telegram direct runtime is running.").await;
        let running = supervisor_snapshots().await;
        assert_eq!(running[0].effective_state, ImRuntimeState::Running);
        assert_eq!(
            running[0].status_message,
            "Telegram direct runtime is running."
        );

        mark_profile_degraded(
            &profile,
            "Telegram worker failed: transient error",
            Some(Duration::from_secs(5)),
        )
        .await;
        let degraded = supervisor_snapshots().await;
        assert_eq!(degraded[0].effective_state, ImRuntimeState::Degraded);
        assert_eq!(degraded[0].restart_count, 1);
        assert!(degraded[0]
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("transient error"));
        assert!(degraded[0].next_retry_at.is_some());
    }

    #[tokio::test]
    async fn supervisor_marks_disabled_profile_as_configured() {
        let profile = telegram_profile(false);
        replace_supervisor_profiles(&[profile]).await;

        let snapshots = supervisor_snapshots().await;
        assert_eq!(snapshots[0].effective_state, ImRuntimeState::Configured);
        assert!(snapshots[0].configured);
        assert!(!snapshots[0].enabled);
    }
}
