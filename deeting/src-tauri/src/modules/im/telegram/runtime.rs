use log::{info, warn};
use tokio::sync::mpsc;

use crate::modules::im::handlers::build_direct_card_action_outcome;
use crate::modules::im::text_runtime::TextImConversationRuntime;
use crate::modules::im::{
    ChatType, ImClient, ImConnectionProfile, ImEvent, MessageContent, SendMessageRequest,
    SenderType,
};
use crate::state::AppState;

use super::{TelegramClient, TelegramConfig};

struct AbortOnDrop(tokio::task::JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub async fn run_telegram_direct_profile_worker(
    app_state: AppState,
    app_handle: tauri::AppHandle,
    profile: ImConnectionProfile,
) -> Result<(), String> {
    let client = TelegramClient::new(TelegramConfig {
        bot_token: profile.direct_config.telegram_bot_token.clone(),
        allow_group_message: false,
        ..Default::default()
    });
    let (event_tx, mut event_rx) = mpsc::channel(256);
    let _poll_guard = AbortOnDrop(
        client
            .start_background_loop(event_tx)
            .map_err(|err| err.to_string())?,
    );

    let mut text_runtime = TextImConversationRuntime::default();

    while let Some(event) = event_rx.recv().await {
        match event {
            ImEvent::Message {
                chat_id,
                chat_type,
                message_id,
                sender,
                content,
                ..
            } => {
                if !matches!(sender.sender_type, SenderType::User) {
                    continue;
                }

                if matches!(
                    chat_type,
                    ChatType::Group | ChatType::SuperGroup | ChatType::Channel
                ) {
                    continue;
                }

                let incoming_text = match content {
                    MessageContent::Text { text } => text,
                    MessageContent::Image { url } => {
                        format!(
                            "[telegram-rich:image] user sent an image reference: {}",
                            url
                        )
                    }
                    MessageContent::File { name, url } => {
                        format!("[telegram-rich:file] user sent a file: {} ({})", name, url)
                    }
                    MessageContent::Mixed { parts } => format!(
                        "[telegram-rich:mixed] user sent mixed content: {}",
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

                let send_client = client.clone();
                let send_chat_id = chat_id.clone();
                let send_message_id = message_id.clone();
                let mut send_message = move |content| {
                    let client = send_client.clone();
                    let chat_id = send_chat_id.clone();
                    let message_id = send_message_id.clone();
                    Box::pin(async move {
                        client
                            .send_message(SendMessageRequest {
                                chat_id,
                                content,
                                reply_to: Some(message_id),
                            })
                            .await
                            .map(|_| ())
                            .map_err(|err| err.to_string())
                    }) as crate::modules::im::text_runtime::SendMessageFuture
                };

                text_runtime
                    .handle_incoming_text(
                        &app_state,
                        &app_handle,
                        &profile,
                        chat_id.as_str(),
                        incoming_text.as_str(),
                        "Telegram",
                        &mut send_message,
                    )
                    .await?;
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
                    Ok(result) => result,
                    Err(err) => {
                        warn!(
                            "im_telegram_profile card_action_response_failed profile={} err={}",
                            profile.id, err
                        );
                        continue;
                    }
                };

                if let Err(err) = client
                    .reply_card_action(callback_token.as_str(), outcome.callback_response)
                    .await
                {
                    warn!(
                        "im_telegram_profile reply_card_action_failed profile={} err={}",
                        profile.id, err
                    );
                    continue;
                }

                for message in outcome.follow_up_messages {
                    if let Err(err) = client
                        .send_message(SendMessageRequest {
                            chat_id: chat_id.clone(),
                            content: message,
                            reply_to: Some(message_id.clone()),
                        })
                        .await
                    {
                        warn!(
                            "im_telegram_profile follow_up_send_failed profile={} chat_id={} err={}",
                            profile.id, chat_id, err
                        );
                    }
                }
            }
            ImEvent::ConnectionStatus { status, .. } => {
                info!(
                    "im_direct_profile_status profile={} platform=telegram status={:?}",
                    profile.id, status
                );
            }
        }
    }

    let _ = client.stop().await;

    Ok(())
}
