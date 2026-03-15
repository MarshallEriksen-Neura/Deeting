use std::sync::{Mutex, OnceLock};

use log::{info, warn};
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use crate::state::AppState;

use super::feishu::{FeishuClient, FeishuConfig};
use super::handlers::{build_card_action_response, generate_local_chat_reply};
use super::{
    build_settings_snapshot, resolve_transport, ImClient, ImConnectionProfile, ImEvent,
    ImPlatform, ImTransportKind, LocalImSettingsSnapshot, MessageContent, SendMessageRequest,
    IM_CONNECTION_PROFILES_CONFIG_KEY,
};

type ImWorkerHandle = tauri::async_runtime::JoinHandle<()>;

fn im_worker_slot() -> &'static Mutex<Option<ImWorkerHandle>> {
    static IM_WORKER_HANDLE: OnceLock<Mutex<Option<ImWorkerHandle>>> = OnceLock::new();
    IM_WORKER_HANDLE.get_or_init(|| Mutex::new(None))
}

fn legacy_profile_from_relay_values(base_url: &str, shared_secret: &str) -> Option<ImConnectionProfile> {
    if base_url.trim().is_empty() && shared_secret.trim().is_empty() {
        return None;
    }
    let mut profile = ImConnectionProfile::default_feishu();
    profile.enabled = true;
    profile.relay_config.base_url = base_url.trim().to_string();
    profile.relay_config.shared_secret = shared_secret.trim().to_string();
    Some(profile)
}

fn normalize_profiles(mut profiles: Vec<ImConnectionProfile>) -> Vec<ImConnectionProfile> {
    if profiles.is_empty() {
        profiles.push(ImConnectionProfile::default_feishu());
    }
    profiles
        .into_iter()
        .enumerate()
        .map(|(index, profile)| {
            let mut normalized = profile.trim();
            if normalized.id.is_empty() {
                normalized.id = format!("{}-{}", normalized.platform, index + 1);
            }
            if normalized.display_name.is_empty() {
                normalized.display_name = normalized.platform.to_string();
            }
            normalized
        })
        .collect()
}

pub(crate) async fn load_im_connection_profiles(
    app_state: &AppState,
) -> Result<Vec<ImConnectionProfile>, String> {
    let raw = app_state
        .mcp
        .store
        .get_desktop_config(IM_CONNECTION_PROFILES_CONFIG_KEY)
        .await
        .map_err(|err| err.to_string())?;

    if let Some(serialized) = raw.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        let profiles: Vec<ImConnectionProfile> =
            serde_json::from_str(serialized).map_err(|err| err.to_string())?;
        return Ok(normalize_profiles(profiles));
    }

    let legacy_relay_base_url = app_state
        .mcp
        .store
        .get_desktop_config("relay.base_url")
        .await
        .map_err(|err| err.to_string())?
        .unwrap_or_default();
    let legacy_relay_shared_secret = app_state
        .mcp
        .store
        .get_desktop_config("relay.shared_secret")
        .await
        .map_err(|err| err.to_string())?
        .unwrap_or_default();

    let profiles = legacy_profile_from_relay_values(
        legacy_relay_base_url.as_str(),
        legacy_relay_shared_secret.as_str(),
    )
    .into_iter()
    .collect();

    Ok(normalize_profiles(profiles))
}

pub(crate) async fn save_im_connection_profiles(
    app_state: &AppState,
    profiles: Vec<ImConnectionProfile>,
) -> Result<Vec<ImConnectionProfile>, String> {
    let normalized_profiles = normalize_profiles(profiles);
    let serialized = serde_json::to_string(&normalized_profiles).map_err(|err| err.to_string())?;
    app_state
        .mcp
        .store
        .set_desktop_config(IM_CONNECTION_PROFILES_CONFIG_KEY, serialized.as_str())
        .await
        .map_err(|err| err.to_string())?;
    Ok(normalized_profiles)
}

async fn run_feishu_direct_profile_worker(
    app_state: AppState,
    app_handle: tauri::AppHandle,
    profile: ImConnectionProfile,
) -> Result<(), String> {
    let client = FeishuClient::new(FeishuConfig {
        app_id: profile.direct_config.feishu_app_id.clone(),
        app_secret: profile.direct_config.feishu_app_secret.clone(),
        ..Default::default()
    });
    let (event_tx, mut event_rx) = mpsc::channel(256);
    client.start(event_tx).await.map_err(|err| err.to_string())?;

    while let Some(event) = event_rx.recv().await {
        match event {
            ImEvent::Message {
                chat_id,
                content: MessageContent::Text { text },
                ..
            } => {
                let session_id = format!("im:{}:chat:{}", profile.id, chat_id);
                let Some(reply_text) = generate_local_chat_reply(
                    &app_state,
                    &app_handle,
                    text.as_str(),
                    session_id.as_str(),
                )
                .await?
                else {
                    continue;
                };

                client
                    .send_message(SendMessageRequest {
                        chat_id,
                        content: MessageContent::Text { text: reply_text },
                        reply_to: None,
                    })
                    .await
                    .map_err(|err| err.to_string())?;
            }
            ImEvent::CardAction {
                callback_token,
                action,
                ..
            } => {
                let response =
                    build_card_action_response(&app_state, action.event.as_str(), &action.value)
                        .await?;
                client
                    .reply_card_action(callback_token.as_str(), response)
                    .await
                    .map_err(|err| err.to_string())?;
            }
            ImEvent::ConnectionStatus { status, .. } => {
                info!(
                    "im_direct_profile_status profile={} platform=feishu status={:?}",
                    profile.id, status
                );
            }
            _ => {}
        }
    }

    Ok(())
}

pub fn spawn_im_runtime_worker(app_state: AppState, app_handle: tauri::AppHandle) {
    let mut slot = im_worker_slot()
        .lock()
        .expect("im worker mutex should not be poisoned");
    if let Some(handle) = slot.take() {
        handle.abort();
    }
    let handle = tauri::async_runtime::spawn(async move {
        start_im_runtime_worker(app_state, app_handle).await;
    });
    *slot = Some(handle);
}

#[tauri::command]
pub fn restart_im_runtime_worker(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    spawn_im_runtime_worker(state.inner().clone(), app_handle);
    Ok(())
}

#[tauri::command]
pub async fn get_local_im_settings(
    state: tauri::State<'_, AppState>,
) -> Result<LocalImSettingsSnapshot, String> {
    let profiles = load_im_connection_profiles(state.inner()).await?;
    Ok(build_settings_snapshot(profiles))
}

#[tauri::command]
pub async fn update_local_im_settings(
    state: tauri::State<'_, AppState>,
    profiles: Vec<ImConnectionProfile>,
    app_handle: tauri::AppHandle,
) -> Result<LocalImSettingsSnapshot, String> {
    let profiles = save_im_connection_profiles(state.inner(), profiles).await?;
    spawn_im_runtime_worker(state.inner().clone(), app_handle);
    Ok(build_settings_snapshot(profiles))
}

pub async fn start_im_runtime_worker(app_state: AppState, app_handle: tauri::AppHandle) {
    let profiles = match load_im_connection_profiles(&app_state).await {
        Ok(profiles) => profiles,
        Err(err) => {
            warn!("im_runtime_load_profiles_failed: {}", err);
            return;
        }
    };

    let mut tasks = JoinSet::new();
    for profile in profiles.into_iter().filter(|profile| profile.enabled) {
        let resolution = resolve_transport(&profile);
        match (profile.platform, resolution.effective) {
            (ImPlatform::Feishu, ImTransportKind::Direct) => {
                let state = app_state.clone();
                let handle = app_handle.clone();
                tasks.spawn(async move {
                    if let Err(err) = run_feishu_direct_profile_worker(state, handle, profile).await
                    {
                        warn!("im_direct_profile_worker_failed: {}", err);
                    }
                });
            }
            (ImPlatform::Feishu, ImTransportKind::Relay) => {
                let state = app_state.clone();
                let handle = app_handle.clone();
                tasks.spawn(async move {
                    if let Err(err) =
                        crate::modules::relay::start_relay_profile_worker(state, handle, profile)
                            .await
                    {
                        warn!("im_relay_profile_worker_failed: {}", err);
                    }
                });
            }
            (_, ImTransportKind::Unavailable) => {
                warn!(
                    "im_profile_unavailable profile={} platform={} reason={:?}",
                    profile.id, profile.platform, resolution.reason_code
                );
            }
            _ => {
                warn!(
                    "im_profile_transport_not_supported profile={} platform={} effective={:?}",
                    profile.id, profile.platform, resolution.effective
                );
            }
        }
    }

    while let Some(result) = tasks.join_next().await {
        if let Err(err) = result {
            warn!("im_runtime_task_join_failed: {}", err);
        }
    }
}
