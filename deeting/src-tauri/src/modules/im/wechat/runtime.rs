use std::time::Duration;

use log::{info, warn};

use crate::modules::im::text_runtime::TextImConversationRuntime;
use crate::modules::im::ImConnectionProfile;
use crate::state::AppState;

use super::types::{
    WECHAT_ITEM_TYPE_FILE, WECHAT_ITEM_TYPE_IMAGE, WECHAT_ITEM_TYPE_TEXT, WECHAT_ITEM_TYPE_VIDEO,
    WECHAT_ITEM_TYPE_VOICE, WECHAT_MESSAGE_TYPE_USER,
};

const WECHAT_RUNTIME_RETRY_DELAY: Duration = Duration::from_secs(5);
const WECHAT_SESSION_EXPIRED_RETRY_DELAY: Duration = Duration::from_secs(30);

pub async fn run_wechat_direct_profile_worker(
    app_state: AppState,
    app_handle: tauri::AppHandle,
    profile: ImConnectionProfile,
) -> Result<(), String> {
    let Some(mut account) = app_state.wechat.load_account().await? else {
        return Err("wechat account is not connected".to_string());
    };

    let mut text_runtime = TextImConversationRuntime::default();

    loop {
        let response = match app_state
            .wechat
            .get_updates(
                account.base_url.as_str(),
                account.token.as_str(),
                account.cursor.as_str(),
            )
            .await
        {
            Ok(response) => response,
            Err(err) => {
                warn!(
                    "wechat_runtime_get_updates_failed profile={} err={}",
                    profile.id, err
                );
                app_state
                    .wechat
                    .set_last_error(Some(format!("微信消息轮询失败：{err}")))
                    .await;
                tokio::time::sleep(WECHAT_RUNTIME_RETRY_DELAY).await;
                continue;
            }
        };
        let mut had_runtime_error = false;

        if response.errcode == Some(-14) {
            app_state
                .wechat
                .set_last_error(Some("微信会话已过期，请重新连接。".to_string()))
                .await;
            tokio::time::sleep(WECHAT_SESSION_EXPIRED_RETRY_DELAY).await;
            continue;
        }

        if let Some(cursor) = response
            .get_updates_buf
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if cursor != account.cursor {
                account.cursor = cursor.to_string();
                if let Err(err) = app_state.wechat.update_cursor(cursor).await {
                    had_runtime_error = true;
                    warn!(
                        "wechat_runtime_update_cursor_failed profile={} cursor={} err={}",
                        profile.id, cursor, err
                    );
                    app_state
                        .wechat
                        .set_last_error(Some(format!("微信游标更新失败：{err}")))
                        .await;
                }
            }
        }

        for message in response.msgs.unwrap_or_default() {
            if message.message_type != Some(WECHAT_MESSAGE_TYPE_USER) {
                continue;
            }
            let Some(contact_id) = message
                .from_user_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            let (text, richer_notice) = classify_incoming_message(&message);
            if text.is_empty() && richer_notice.is_none() {
                continue;
            }

            let incoming_context_token = message
                .context_token
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            if !incoming_context_token.is_empty() {
                if let Err(err) = app_state
                    .wechat
                    .update_context_token(contact_id, incoming_context_token.as_str())
                    .await
                {
                    had_runtime_error = true;
                    warn!(
                        "wechat_runtime_update_context_token_failed profile={} contact_id={} err={}",
                        profile.id, contact_id, err
                    );
                    app_state
                        .wechat
                        .set_last_error(Some(format!("微信会话上下文保存失败：{err}")))
                        .await;
                }
            }

            let reply_context_token = match resolve_reply_context_token(
                &app_state,
                contact_id,
                incoming_context_token.as_str(),
            )
            .await
            {
                Ok(token) => token,
                Err(err) => {
                    had_runtime_error = true;
                    warn!(
                        "wechat_runtime_load_context_token_failed profile={} contact_id={} err={}",
                        profile.id, contact_id, err
                    );
                    app_state
                        .wechat
                        .set_last_error(Some(format!("微信会话上下文读取失败：{err}")))
                        .await;
                    continue;
                }
            };

            match app_state
                .wechat
                .ensure_allowed_or_create_pairing(contact_id)
                .await
            {
                Err(err) => {
                    had_runtime_error = true;
                    warn!(
                        "wechat_runtime_pairing_lookup_failed profile={} contact_id={} err={}",
                        profile.id, contact_id, err
                    );
                    app_state
                        .wechat
                        .set_last_error(Some(format!("微信联系人配对状态读取失败：{err}")))
                        .await;
                    continue;
                }
                Ok(Ok(())) => {}
                Ok(Err(code)) => {
                    if let Err(err) = send_text(
                        &app_state,
                        &account.base_url,
                        &account.token,
                        contact_id,
                        format!(
                            "你的配对码是：{}\n\n请在 Deeting 桌面端确认后再继续对话。",
                            code
                        )
                        .as_str(),
                        reply_context_token.as_str(),
                    )
                    .await
                    {
                        had_runtime_error = true;
                        warn!(
                            "wechat_runtime_send_pairing_code_failed profile={} contact_id={} err={}",
                            profile.id, contact_id, err
                        );
                        app_state
                            .wechat
                            .set_last_error(Some(format!("微信配对提示发送失败：{err}")))
                            .await;
                    }
                    continue;
                }
            }

            let incoming_user_text = if text.is_empty() {
                richer_notice.clone().unwrap_or_default()
            } else {
                text.clone()
            };

            if let Err(err) = text_runtime
                .handle_incoming_text(
                    &app_state,
                    &app_handle,
                    &profile,
                    contact_id,
                    incoming_user_text.as_str(),
                    "微信",
                    |reply_text| {
                        let app_state = app_state.clone();
                        let base_url = account.base_url.clone();
                        let token = account.token.clone();
                        let context_token = reply_context_token.clone();
                        let contact_id = contact_id.to_string();
                        let text = reply_text;
                        async move {
                            send_text(
                                &app_state,
                                base_url.as_str(),
                                token.as_str(),
                                contact_id.as_str(),
                                text.as_str(),
                                context_token.as_str(),
                            )
                            .await
                        }
                    },
                )
                .await
            {
                had_runtime_error = true;
                warn!(
                    "wechat_runtime_handle_incoming_text_failed profile={} contact_id={} err={}",
                    profile.id, contact_id, err
                );
                app_state
                    .wechat
                    .set_last_error(Some(format!("微信消息处理失败：{err}")))
                    .await;
            }
        }

        if had_runtime_error {
            tokio::time::sleep(WECHAT_RUNTIME_RETRY_DELAY).await;
        } else {
            app_state.wechat.clear_last_error().await;
        }
        info!("wechat_runtime_tick profile={}", profile.id);
    }
}

async fn resolve_reply_context_token(
    app_state: &AppState,
    contact_id: &str,
    incoming_context_token: &str,
) -> Result<String, String> {
    let incoming = incoming_context_token.trim();
    if !incoming.is_empty() {
        return Ok(incoming.to_string());
    }

    Ok(select_context_token(
        incoming,
        app_state
            .wechat
            .context_token_for_contact(contact_id)
            .await?
            .as_deref(),
    ))
}

fn classify_incoming_message(message: &super::types::WechatMessage) -> (String, Option<String>) {
    let mut text_parts = Vec::new();
    let mut richer_kinds = Vec::new();

    for item in message.item_list.as_ref().into_iter().flatten() {
        match item.r#type {
            Some(WECHAT_ITEM_TYPE_TEXT) => {
                if let Some(text) = item
                    .text_item
                    .as_ref()
                    .and_then(|entry| entry.text.as_deref())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    text_parts.push(text.to_string());
                }
            }
            Some(WECHAT_ITEM_TYPE_IMAGE) => richer_kinds.push("image".to_string()),
            Some(WECHAT_ITEM_TYPE_FILE) => richer_kinds.push("file".to_string()),
            Some(WECHAT_ITEM_TYPE_VIDEO) => richer_kinds.push("video".to_string()),
            Some(WECHAT_ITEM_TYPE_VOICE) => richer_kinds.push("voice".to_string()),
            Some(other) => richer_kinds.push(format!("item_type_{other}")),
            None => richer_kinds.push("unknown_item".to_string()),
        }
    }

    let text = text_parts.join("\n");
    let richer_notice = if richer_kinds.is_empty() {
        None
    } else {
        Some(format!(
            "[wx-rich:{}] 当前桌面微信 IM 仍以文本为主，富媒体输入已被识别并进入兼容降级路径。",
            richer_kinds.join(",")
        ))
    };

    (text, richer_notice)
}

fn select_context_token(
    incoming_context_token: &str,
    stored_context_token: Option<&str>,
) -> String {
    let incoming = incoming_context_token.trim();
    if !incoming.is_empty() {
        return incoming.to_string();
    }

    stored_context_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_default()
}

async fn send_text(
    app_state: &AppState,
    base_url: &str,
    token: &str,
    contact_id: &str,
    text: &str,
    context_token: &str,
) -> Result<(), String> {
    app_state
        .wechat
        .send_text(
            base_url,
            token,
            contact_id,
            markdown_to_plain_text(text).as_str(),
            context_token,
        )
        .await
}

fn markdown_to_plain_text(input: &str) -> String {
    input
        .replace("```", "")
        .replace("**", "")
        .replace('`', "")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use crate::modules::im::text_runtime::parse_text_approval_command;

    use super::select_context_token;

    #[test]
    fn parse_text_approval_command_accepts_numeric_choices() {
        assert_eq!(parse_text_approval_command("1"), Some(true));
        assert_eq!(parse_text_approval_command("0"), Some(false));
        assert_eq!(parse_text_approval_command(" yes "), None);
    }

    #[test]
    fn select_context_token_prefers_incoming_value() {
        assert_eq!(
            select_context_token("ctx-live", Some("ctx-stored")),
            "ctx-live".to_string()
        );
    }

    #[test]
    fn select_context_token_falls_back_to_stored_value() {
        assert_eq!(
            select_context_token("   ", Some("ctx-stored")),
            "ctx-stored".to_string()
        );
    }
}
