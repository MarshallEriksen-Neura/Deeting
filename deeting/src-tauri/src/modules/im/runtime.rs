use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use log::{info, warn};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::task::JoinSet;
use tokio::time::sleep;

use crate::state::AppState;

use super::feishu::{FeishuClient, FeishuConfig};
use super::handlers::{build_direct_card_action_outcome, generate_local_chat_reply_content};
use super::{
    build_settings_snapshot, mark_profile_degraded, mark_profile_running, mark_profile_unavailable,
    replace_supervisor_profiles, resolve_transport, supervisor_snapshots, ImClient,
    ImConnectionProfile, ImEvent, ImPlatform, ImTransportKind, ImTransportPreference,
    LocalImSettingsSnapshot, MessageContent, SendMessageRequest,
};

type ImWorkerHandle = tauri::async_runtime::JoinHandle<()>;

fn im_worker_slot() -> &'static Mutex<Option<ImWorkerHandle>> {
    static IM_WORKER_HANDLE: OnceLock<Mutex<Option<ImWorkerHandle>>> = OnceLock::new();
    IM_WORKER_HANDLE.get_or_init(|| Mutex::new(None))
}

fn config_value<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value
        .get("im_config")
        .and_then(Value::as_object)
        .and_then(|nested| nested.get(key))
        .or_else(|| value.get(key))
}

fn config_string(value: &Value, key: &str) -> Option<String> {
    config_value(value, key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn config_bool(value: &Value, key: &str) -> Option<bool> {
    config_value(value, key).and_then(Value::as_bool)
}

fn derive_profile_from_notification_channel(
    channel: &crate::modules::monitor::types::LocalNotificationChannel,
    wechat_account_id: Option<&str>,
) -> Option<ImConnectionProfile> {
    match channel.channel.trim().to_lowercase().as_str() {
        "feishu" => {}
        "telegram" => {
            let has_im_fields = config_bool(&channel.config, "im_enabled").unwrap_or(true)
                || config_string(&channel.config, "bot_token").is_some()
                || config_string(&channel.config, "chat_id").is_some()
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
            profile.enabled =
                channel.is_active && config_bool(&channel.config, "im_enabled").unwrap_or(true);
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
                content,
                ..
            } => {
                let incoming_text = match content {
                    MessageContent::Text { text } => text,
                    MessageContent::Image { url } => {
                        format!("[feishu-rich:image] 用户发送了一张飞书图片引用：{}", url)
                    }
                    MessageContent::File { name, url } => format!(
                        "[feishu-rich:file] 用户发送了一个飞书文件：{} ({})",
                        name, url
                    ),
                    MessageContent::Mixed { parts } => format!(
                        "[feishu-rich:mixed] 用户发送了富文本内容：{}",
                        parts
                            .iter()
                            .filter_map(|part| match part {
                                crate::modules::im::MessagePart::Text { text } =>
                                    Some(text.as_str()),
                                crate::modules::im::MessagePart::Image { url } =>
                                    Some(url.as_str()),
                            })
                            .collect::<Vec<_>>()
                            .join(" ")
                    ),
                    MessageContent::Card { .. } => continue,
                };
                let session_id = format!("im:{}:chat:{}", profile.id, chat_id);
                let reply_to = Some(message_id.clone());
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
                    incoming_text.as_str(),
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
                let user_ref = sender
                    .name
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("用户");
                let quoted = incoming_text.trim();
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
    let runtime_profiles = supervisor_snapshots().await;
    Ok(build_settings_snapshot(profiles, runtime_profiles))
}

async fn run_profile_worker_once(
    app_state: AppState,
    app_handle: tauri::AppHandle,
    profile: ImConnectionProfile,
    effective_transport: ImTransportKind,
) -> Result<(), String> {
    match (profile.platform, effective_transport) {
        (ImPlatform::Feishu, ImTransportKind::Direct) => {
            run_feishu_direct_profile_worker(app_state, app_handle, profile).await
        }
        (ImPlatform::Feishu, ImTransportKind::Relay) => {
            crate::modules::relay::start_relay_profile_worker(app_state, app_handle, profile).await
        }
        (ImPlatform::Wechat, ImTransportKind::Direct) => {
            crate::modules::im::wechat::runtime::run_wechat_direct_profile_worker(
                app_state, app_handle, profile,
            )
            .await
        }
        (ImPlatform::Telegram, ImTransportKind::Direct) => {
            crate::modules::im::telegram::runtime::run_telegram_direct_profile_worker(
                app_state, app_handle, profile,
            )
            .await
        }
        _ => Err("unsupported im runtime worker".to_string()),
    }
}

async fn supervise_profile_worker(
    app_state: AppState,
    app_handle: tauri::AppHandle,
    profile: ImConnectionProfile,
    effective_transport: ImTransportKind,
) {
    const MAX_RESTARTS: u32 = 3;
    const BASE_RETRY_SECS: u64 = 5;

    let running_message = match (profile.platform, effective_transport) {
        (ImPlatform::Feishu, ImTransportKind::Direct) => "Feishu direct runtime is running.",
        (ImPlatform::Feishu, ImTransportKind::Relay) => "Feishu relay runtime is running.",
        (ImPlatform::Wechat, ImTransportKind::Direct) => "WeChat direct runtime is running.",
        (ImPlatform::Telegram, ImTransportKind::Direct) => "Telegram direct runtime is running.",
        _ => "IM runtime is running.",
    };

    let mut restart_count = 0_u32;
    loop {
        mark_profile_running(&profile, running_message).await;
        let result = run_profile_worker_once(
            app_state.clone(),
            app_handle.clone(),
            profile.clone(),
            effective_transport,
        )
        .await;

        match result {
            Ok(()) => {
                if restart_count >= MAX_RESTARTS {
                    mark_profile_unavailable(
                        &profile,
                        format!(
                            "{} worker exited after exhausting restart budget.",
                            profile.platform
                        ),
                    )
                    .await;
                    break;
                }
                restart_count = restart_count.saturating_add(1);
                let retry_secs = BASE_RETRY_SECS.saturating_mul(restart_count as u64);
                mark_profile_degraded(
                    &profile,
                    format!(
                        "{} worker exited unexpectedly; restarting.",
                        profile.platform
                    ),
                    Some(Duration::from_secs(retry_secs)),
                )
                .await;
                sleep(Duration::from_secs(retry_secs)).await;
            }
            Err(err) => {
                restart_count = restart_count.saturating_add(1);
                if restart_count > MAX_RESTARTS {
                    mark_profile_unavailable(
                        &profile,
                        format!("{} worker failed repeatedly: {err}", profile.platform),
                    )
                    .await;
                    warn!(
                        "im_profile_worker_exhausted profile={} err={}",
                        profile.id, err
                    );
                    break;
                }
                let retry_secs = BASE_RETRY_SECS.saturating_mul(restart_count as u64);
                mark_profile_degraded(&profile, err.clone(), Some(Duration::from_secs(retry_secs)))
                    .await;
                warn!(
                    "im_profile_worker_failed profile={} restart={} err={}",
                    profile.id, restart_count, err
                );
                sleep(Duration::from_secs(retry_secs)).await;
            }
        }
    }
}

pub async fn start_im_runtime_worker(app_state: AppState, app_handle: tauri::AppHandle) {
    let profiles = match load_im_connection_profiles(&app_state).await {
        Ok(profiles) => profiles,
        Err(err) => {
            warn!("im_runtime_load_profiles_failed: {}", err);
            return;
        }
    };

    replace_supervisor_profiles(&profiles).await;

    let mut tasks = JoinSet::new();
    for profile in profiles.into_iter().filter(|profile| profile.enabled) {
        let resolution = resolve_transport(&profile);
        match resolution.effective {
            ImTransportKind::Direct | ImTransportKind::Relay => {
                let state = app_state.clone();
                let handle = app_handle.clone();
                let effective_transport = resolution.effective;
                tasks.spawn(async move {
                    supervise_profile_worker(state, handle, profile, effective_transport).await;
                });
            }
            ImTransportKind::Unavailable => {
                mark_profile_unavailable(
                    &profile,
                    format!(
                        "{} transport is unavailable: {:?}",
                        profile.platform, resolution.reason_code
                    ),
                )
                .await;
                warn!(
                    "im_profile_unavailable profile={} platform={} reason={:?}",
                    profile.id, profile.platform, resolution.reason_code
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::monitor::types::LocalNotificationChannel;

    fn notification_channel(
        channel: &str,
        config: Value,
        is_active: bool,
    ) -> LocalNotificationChannel {
        LocalNotificationChannel {
            id: format!("{channel}-1"),
            user_id: "user-1".to_string(),
            channel: channel.to_string(),
            config,
            display_name: None,
            is_active,
            priority: 0,
            last_used_at: None,
            created_at: "2026-04-16T00:00:00Z".to_string(),
            updated_at: "2026-04-16T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn derive_profile_reads_nested_im_config_for_telegram() {
        let channel = notification_channel(
            "telegram",
            serde_json::json!({
                "chat_id": "12345",
                "im_config": {
                    "im_enabled": true,
                    "bot_token": "telegram-token"
                }
            }),
            true,
        );

        let profile =
            derive_profile_from_notification_channel(&channel, None).expect("telegram profile");
        assert!(profile.enabled);
        assert_eq!(profile.direct_config.telegram_bot_token, "telegram-token");
    }

    #[test]
    fn derive_profile_prefers_nested_im_config_over_legacy_root_fields() {
        let channel = notification_channel(
            "telegram",
            serde_json::json!({
                "bot_token": "legacy-token",
                "im_enabled": false,
                "im_config": {
                    "im_enabled": true,
                    "bot_token": "nested-token"
                }
            }),
            true,
        );

        let profile =
            derive_profile_from_notification_channel(&channel, None).expect("telegram profile");
        assert!(profile.enabled);
        assert_eq!(profile.direct_config.telegram_bot_token, "nested-token");
    }

    #[test]
    fn derive_profile_respects_telegram_im_enabled_flag() {
        let channel = notification_channel(
            "telegram",
            serde_json::json!({
                "bot_token": "telegram-token",
                "chat_id": "12345",
                "im_enabled": false
            }),
            true,
        );

        let profile =
            derive_profile_from_notification_channel(&channel, None).expect("telegram profile");
        assert!(!profile.enabled);
    }
}
