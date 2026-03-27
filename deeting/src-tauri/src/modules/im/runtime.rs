use std::sync::{Mutex, OnceLock};

use log::{info, warn};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use crate::state::AppState;

use super::feishu::{FeishuClient, FeishuConfig};
use super::handlers::{build_direct_card_action_outcome, generate_local_chat_reply_content};
use super::{
    build_settings_snapshot, resolve_transport, ImClient, ImConnectionProfile, ImEvent, ImPlatform,
    ImTransportKind, ImTransportPreference, LocalImSettingsSnapshot, MessageContent,
    SendMessageRequest,
};

type ImWorkerHandle = tauri::async_runtime::JoinHandle<()>;

fn im_worker_slot() -> &'static Mutex<Option<ImWorkerHandle>> {
    static IM_WORKER_HANDLE: OnceLock<Mutex<Option<ImWorkerHandle>>> = OnceLock::new();
    IM_WORKER_HANDLE.get_or_init(|| Mutex::new(None))
}

fn config_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn config_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn derive_profile_from_notification_channel(
    channel: &crate::modules::monitor::types::LocalNotificationChannel,
    wechat_account_id: Option<&str>,
) -> Option<ImConnectionProfile> {
    match channel.channel.trim().to_lowercase().as_str() {
        "feishu" => {}
        "telegram" => {
            let has_im_fields = config_string(&channel.config, "bot_token").is_some()
                || config_string(&channel.config, "bot_model").is_some()
                || config_string(&channel.config, "bot_system_prompt").is_some();
            if !has_im_fields {
                return None;
            }

            let mut profile = ImConnectionProfile::default_telegram();
            profile.id = format!("notification-channel:{}", channel.id);
            profile.display_name = channel
                .display_name
                .clone()
                .unwrap_or_else(|| "Telegram".to_string());
            profile.enabled = channel.is_active;
            profile.transport_preference = ImTransportPreference::Direct;
            profile.direct_config.telegram_bot_token =
                config_string(&channel.config, "bot_token").unwrap_or_default();
            return Some(profile);
        }
        "wechat" => {
            let has_im_fields = config_bool(&channel.config, "im_enabled").unwrap_or(false)
                || config_string(&channel.config, "access_policy").is_some()
                || config_string(&channel.config, "bot_model").is_some()
                || config_string(&channel.config, "bot_system_prompt").is_some();
            if !has_im_fields {
                return None;
            }

            let mut profile = ImConnectionProfile {
                id: format!("notification-channel:{}", channel.id),
                platform: ImPlatform::Wechat,
                display_name: channel
                    .display_name
                    .clone()
                    .unwrap_or_else(|| "WeChat".to_string()),
                enabled: channel.is_active
                    && config_bool(&channel.config, "im_enabled").unwrap_or(false),
                transport_preference: ImTransportPreference::Direct,
                direct_config: Default::default(),
                relay_config: Default::default(),
            };
            profile.direct_config.wechat_account_id =
                wechat_account_id.unwrap_or_default().trim().to_string();
            return Some(profile);
        }
        _ => return None,
    }

    let transport_preference = match config_string(&channel.config, "transport_preference")
        .as_deref()
        .unwrap_or("auto")
    {
        "direct" => ImTransportPreference::Direct,
        "relay" => ImTransportPreference::Relay,
        _ => ImTransportPreference::Auto,
    };

    let has_im_fields = config_bool(&channel.config, "im_enabled").unwrap_or(false)
        || config_string(&channel.config, "bot_app_id").is_some()
        || config_string(&channel.config, "bot_app_secret").is_some()
        || config_string(&channel.config, "relay_base_url").is_some()
        || config_string(&channel.config, "relay_shared_secret").is_some()
        || config_string(&channel.config, "transport_preference").is_some();
    if !has_im_fields {
        return None;
    }

    let mut profile = ImConnectionProfile::default_feishu();
    profile.id = format!("notification-channel:{}", channel.id);
    profile.display_name = channel
        .display_name
        .clone()
        .unwrap_or_else(|| "Feishu".to_string());
    profile.enabled =
        channel.is_active && config_bool(&channel.config, "im_enabled").unwrap_or(false);
    profile.transport_preference = transport_preference;
    profile.direct_config.feishu_app_id =
        config_string(&channel.config, "bot_app_id").unwrap_or_default();
    profile.direct_config.feishu_app_secret =
        config_string(&channel.config, "bot_app_secret").unwrap_or_default();
    profile.relay_config.base_url =
        config_string(&channel.config, "relay_base_url").unwrap_or_default();
    profile.relay_config.shared_secret =
        config_string(&channel.config, "relay_shared_secret").unwrap_or_default();
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
    let channels = app_state
        .monitor
        .list_notification_channels()
        .await
        .map_err(|err| err.to_string())?
        .items;
    let wechat_account_id = app_state
        .wechat
        .load_account()
        .await?
        .and_then(|account| account.account_id.or(account.user_id));
    let profiles = channels
        .iter()
        .filter_map(|channel| {
            derive_profile_from_notification_channel(channel, wechat_account_id.as_deref())
        })
        .collect();

    Ok(normalize_profiles(profiles))
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
    client
        .start(event_tx)
        .await
        .map_err(|err| err.to_string())?;

    while let Some(event) = event_rx.recv().await {
        match event {
            ImEvent::Message {
                chat_id,
                message_id,
                sender,
                content: MessageContent::Text { text },
                ..
            } => {
                let session_id = format!("im:{}:chat:{}", profile.id, chat_id);
                let reply_to = Some(message_id.clone());
                // 先发一条即时确认，挂在用户消息下（与官方 OpenClaw 类似的回复线程体验）
                let ack = "收到，正在处理中…";
                if let Err(e) = client
                    .send_message(SendMessageRequest {
                        chat_id: chat_id.clone(),
                        content: MessageContent::Text {
                            text: ack.to_string(),
                        },
                        reply_to: reply_to.clone(),
                    })
                    .await
                {
                    warn!(
                        "im_direct_profile ack_send_failed profile={} chat_id={} err={}",
                        profile.id, chat_id, e
                    );
                }
                let reply_content = match generate_local_chat_reply_content(
                    &app_state,
                    &app_handle,
                    text.as_str(),
                    session_id.as_str(),
                )
                .await
                {
                    Ok(Some(content)) => content,
                    Ok(None) => continue,
                    Err(e) => {
                        warn!(
                            "im_direct_profile chat_reply_failed profile={} session={} err={}",
                            profile.id, session_id, e
                        );
                        continue;
                    }
                };
                // 回复内容带上引用格式：回复 用户名: 原文，与官方 OpenClaw 展示一致
                let user_ref = sender
                    .name
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("用户");
                let quoted = text.trim();
                let quoted_preview = if quoted.len() > 60 {
                    format!(
                        "{}…",
                        quoted.chars().take(57).collect::<String>().trim_end()
                    )
                } else {
                    quoted.to_string()
                };
                let display_reply = match &reply_content {
                    MessageContent::Text { text } => Some(format!(
                        "| 回复 {}: {}\n\n{}",
                        user_ref,
                        quoted_preview,
                        text.trim()
                    )),
                    _ => None,
                };
                if let Err(e) = client
                    .send_message(SendMessageRequest {
                        chat_id: chat_id.clone(),
                        content: match (display_reply, reply_content) {
                            (Some(display_text), MessageContent::Text { .. }) => {
                                MessageContent::Text { text: display_text }
                            }
                            (_, content) => content,
                        },
                        reply_to,
                    })
                    .await
                {
                    warn!(
                        "im_direct_profile send_message_failed profile={} chat_id={} err={}",
                        profile.id, chat_id, e
                    );
                }
            }
            ImEvent::CardAction {
                chat_id,
                message_id,
                callback_token,
                action,
                ..
            } => {
                let outcome = match build_direct_card_action_outcome(
                    &app_handle,
                    &app_state,
                    action.event.as_str(),
                    &action.value,
                )
                .await
                {
                    Ok(r) => r,
                    Err(e) => {
                        warn!(
                            "im_direct_profile card_action_response_failed profile={} err={}",
                            profile.id, e
                        );
                        continue;
                    }
                };
                if let Err(e) = client
                    .reply_card_action(callback_token.as_str(), outcome.callback_response)
                    .await
                {
                    warn!(
                        "im_direct_profile reply_card_action_failed profile={} err={}",
                        profile.id, e
                    );
                    continue;
                }
                for message in outcome.follow_up_messages {
                    if let Err(e) = client
                        .send_message(SendMessageRequest {
                            chat_id: chat_id.clone(),
                            content: message,
                            reply_to: Some(message_id.clone()),
                        })
                        .await
                    {
                        warn!(
                            "im_direct_profile follow_up_send_failed profile={} chat_id={} err={}",
                            profile.id, chat_id, e
                        );
                    }
                }
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
            (ImPlatform::Wechat, ImTransportKind::Direct) => {
                let state = app_state.clone();
                let handle = app_handle.clone();
                tasks.spawn(async move {
                    if let Err(err) =
                        crate::modules::im::wechat::runtime::run_wechat_direct_profile_worker(
                            state, handle, profile,
                        )
                        .await
                    {
                        warn!("im_wechat_profile_worker_failed: {}", err);
                    }
                });
            }
            (ImPlatform::Telegram, ImTransportKind::Direct) => {
                let state = app_state.clone();
                let handle = app_handle.clone();
                tasks.spawn(async move {
                    if let Err(err) =
                        crate::modules::im::telegram::runtime::run_telegram_direct_profile_worker(
                            state, handle, profile,
                        )
                        .await
                    {
                        warn!("im_telegram_profile_worker_failed: {}", err);
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
