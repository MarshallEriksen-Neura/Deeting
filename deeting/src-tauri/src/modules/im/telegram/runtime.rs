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
    client
        .start(event_tx)
        .await
        .map_err(|err| err.to_string())?;

    let mut text_runtime = TextImConversationRuntime::default();

    while let Some(event) = event_rx.recv().await {
        match event {
            ImEvent::Message {
                chat_id,
                chat_type,
                message_id,
                sender,
                content: MessageContent::Text { text },
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

                text_runtime
                    .handle_incoming_text(
                        &app_state,
                        &app_handle,
                        &profile,
                        chat_id.as_str(),
                        text.as_str(),
                        "Telegram",
                        |reply_text| {
                            let text = reply_text;
                            async {
                                client
                                    .send_message(SendMessageRequest {
                                        chat_id: chat_id.clone(),
                                        content: MessageContent::Text { text },
                                        reply_to: Some(message_id.clone()),
                                    })
                                    .await
                                    .map(|_| ())
                                    .map_err(|err| err.to_string())
                            }
                        },
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
                    if let MessageContent::Text { text } = message {
                        if let Err(err) = client
                            .send_message(SendMessageRequest {
                                chat_id: chat_id.clone(),
                                content: MessageContent::Text { text },
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
            }
            ImEvent::ConnectionStatus { status, .. } => {
                info!(
                    "im_direct_profile_status profile={} platform=telegram status={:?}",
                    profile.id, status
                );
            }
            _ => {}
        }
    }

    Ok(())
}
