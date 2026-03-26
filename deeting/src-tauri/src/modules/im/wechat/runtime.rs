use std::collections::HashMap;

use log::info;

use crate::modules::im::handlers::{
    build_direct_card_action_outcome, build_text_approval_prompt, generate_local_chat_reply_outcome,
};
use crate::modules::im::{ImConnectionProfile, MessageContent};
use crate::state::AppState;

use super::api::{get_updates, send_text_message};
use super::types::{
    WechatOutboundMessage, WechatOutboundMessageItem, WechatOutboundTextItem,
    WECHAT_ITEM_TYPE_TEXT, WECHAT_MESSAGE_STATE_FINISH, WECHAT_MESSAGE_TYPE_BOT,
    WECHAT_MESSAGE_TYPE_USER,
};

#[derive(Debug, Clone)]
struct PendingWechatTextApproval {
    approval_token: String,
    call_id: Option<String>,
    tool_name: String,
}

pub async fn run_wechat_direct_profile_worker(
    app_state: AppState,
    app_handle: tauri::AppHandle,
    profile: ImConnectionProfile,
) -> Result<(), String> {
    let Some(mut account) = app_state.wechat.load_account().await? else {
        return Err("wechat account is not connected".to_string());
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(65))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let mut pending_text_approvals = HashMap::<String, PendingWechatTextApproval>::new();

    loop {
        let response = get_updates(
            &client,
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

            match app_state
                .wechat
                .ensure_allowed_or_create_pairing(contact_id)
                .await?
            {
                Ok(()) => {}
                Err(code) => {
                    send_text(
                        &client,
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

            if let Some(pending) = pending_text_approvals.get(contact_id).cloned() {
                if let Some(approved) = parse_text_approval_command(text.as_str()) {
                    pending_text_approvals.remove(contact_id);
                    let outcome = build_direct_card_action_outcome(
                        &app_handle,
                        &app_state,
                        if approved {
                            "approve_tool"
                        } else {
                            "reject_tool"
                        },
                        &serde_json::json!({
                            "approval_token": pending.approval_token,
                            "call_id": pending.call_id,
                            "tool_name": pending.tool_name,
                        }),
                    )
                    .await?;
                    let mut sent_any = false;
                    for follow_up in outcome.follow_up_messages {
                        if let MessageContent::Text { text } = follow_up {
                            send_text(
                                &client,
                                &account.base_url,
                                &account.token,
                                contact_id,
                                text.as_str(),
                                context_token.as_str(),
                            )
                            .await?;
                            sent_any = true;
                        }
                    }
                    if !sent_any {
                        send_text(
                            &client,
                            &account.base_url,
                            &account.token,
                            contact_id,
                            if approved {
                                "已批准，当前流程继续执行。"
                            } else {
                                "已拒绝，本次工具调用不会继续执行。"
                            },
                            context_token.as_str(),
                        )
                        .await?;
                    }
                    continue;
                }

                send_text(
                    &client,
                    &account.base_url,
                    &account.token,
                    contact_id,
                    "当前有待审批操作，请先回复 `1` 确认执行，或回复 `0` 拒绝执行。",
                    context_token.as_str(),
                )
                .await?;
                continue;
            }

            let session_id = format!("im:{}:chat:{}", profile.id, contact_id);
            send_text(
                &client,
                &account.base_url,
                &account.token,
                contact_id,
                "收到，正在处理中…",
                context_token.as_str(),
            )
            .await?;

            let Some(reply_outcome) = generate_local_chat_reply_outcome(
                &app_state,
                &app_handle,
                text.as_str(),
                session_id.as_str(),
            )
            .await?
            else {
                continue;
            };

            if let Some(approval_request) = reply_outcome.approval_request {
                let approval_prompt = build_text_approval_prompt(&approval_request);
                pending_text_approvals.insert(
                    contact_id.to_string(),
                    PendingWechatTextApproval {
                        approval_token: approval_request.approval_token,
                        call_id: approval_request.call_id,
                        tool_name: approval_request.tool_name,
                    },
                );
                send_text(
                    &client,
                    &account.base_url,
                    &account.token,
                    contact_id,
                    approval_prompt.as_str(),
                    context_token.as_str(),
                )
                .await?;
                continue;
            }

            match reply_outcome.content {
                MessageContent::Text { text } => {
                    send_text(
                        &client,
                        &account.base_url,
                        &account.token,
                        contact_id,
                        text.as_str(),
                        context_token.as_str(),
                    )
                    .await?;
                }
                _ => {
                    send_text(
                        &client,
                        &account.base_url,
                        &account.token,
                        contact_id,
                        "当前微信通道暂不支持该回复格式，请在桌面端查看完整结果。",
                        context_token.as_str(),
                    )
                    .await?;
                }
            }
        }

        app_state.wechat.clear_last_error().await;
        info!("wechat_runtime_tick profile={}", profile.id);
    }
}

fn parse_text_approval_command(text: &str) -> Option<bool> {
    match text.trim() {
        "1" => Some(true),
        "0" => Some(false),
        _ => None,
    }
}

async fn send_text(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    contact_id: &str,
    text: &str,
    context_token: &str,
) -> Result<(), String> {
    let message = WechatOutboundMessage {
        to_user_id: contact_id.trim().to_string(),
        from_user_id: String::new(),
        client_id: uuid::Uuid::new_v4().to_string(),
        message_type: WECHAT_MESSAGE_TYPE_BOT,
        message_state: WECHAT_MESSAGE_STATE_FINISH,
        context_token: context_token.trim().to_string(),
        item_list: vec![WechatOutboundMessageItem {
            r#type: WECHAT_ITEM_TYPE_TEXT,
            text_item: WechatOutboundTextItem {
                text: markdown_to_plain_text(text),
            },
        }],
    };
    send_text_message(client, base_url, token, message).await
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
    use super::parse_text_approval_command;

    #[test]
    fn parse_text_approval_command_accepts_numeric_choices() {
        assert_eq!(parse_text_approval_command("1"), Some(true));
        assert_eq!(parse_text_approval_command("0"), Some(false));
        assert_eq!(parse_text_approval_command(" yes "), None);
    }
}
