use log::info;

use crate::modules::im::text_runtime::TextImConversationRuntime;
use crate::modules::im::ImConnectionProfile;
use crate::state::AppState;

use super::types::{WECHAT_ITEM_TYPE_TEXT, WECHAT_MESSAGE_TYPE_USER};

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
        let response = app_state
            .wechat
            .get_updates(
                account.base_url.as_str(),
                account.token.as_str(),
                account.cursor.as_str(),
            )
            .await?;

        if response.errcode == Some(-14) {
            app_state
                .wechat
                .set_last_error(Some("微信会话已过期，请重新连接。".to_string()))
                .await;
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
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
                app_state.wechat.update_cursor(cursor).await?;
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
            let text = message
                .item_list
                .as_ref()
                .into_iter()
                .flatten()
                .filter(|item| item.r#type == Some(WECHAT_ITEM_TYPE_TEXT))
                .filter_map(|item| item.text_item.as_ref())
                .filter_map(|item| item.text.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            if text.is_empty() {
                continue;
            }
            let context_token = message
                .context_token
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            if !context_token.is_empty() {
                app_state
                    .wechat
                    .update_context_token(contact_id, context_token.as_str())
                    .await?;
            }

            match app_state
                .wechat
                .ensure_allowed_or_create_pairing(contact_id)
                .await?
            {
                Ok(()) => {}
                Err(code) => {
                    send_text(
                        &app_state,
                        &account.base_url,
                        &account.token,
                        contact_id,
                        format!(
                            "你的配对码是：{}\n\n请在 Deeting 桌面端确认后再继续对话。",
                            code
                        )
                        .as_str(),
                        context_token.as_str(),
                    )
                    .await?;
                    continue;
                }
            }

            text_runtime
                .handle_incoming_text(
                    &app_state,
                    &app_handle,
                    &profile,
                    contact_id,
                    text.as_str(),
                    "微信",
                    |reply_text| {
                        let app_state = app_state.clone();
                        let base_url = account.base_url.clone();
                        let token = account.token.clone();
                        let context_token = context_token.clone();
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
                .await?;
        }

        app_state.wechat.clear_last_error().await;
        info!("wechat_runtime_tick profile={}", profile.id);
    }
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

    #[test]
    fn parse_text_approval_command_accepts_numeric_choices() {
        assert_eq!(parse_text_approval_command("1"), Some(true));
        assert_eq!(parse_text_approval_command("0"), Some(false));
        assert_eq!(parse_text_approval_command(" yes "), None);
    }
}
