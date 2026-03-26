use std::io::Write;

use tokio::io::{AsyncBufReadExt, BufReader};

use super::api::{fetch_login_qr, fetch_qr_status, get_updates, send_text_message};
use super::bridge_protocol::{
    BridgeEnvelope, BridgeRequest, BridgeResponseEnvelope, BridgeResponsePayload,
};
use super::types::{
    WechatOutboundMessage, WechatOutboundMessageItem, WechatOutboundTextItem,
    WECHAT_ITEM_TYPE_TEXT, WECHAT_MESSAGE_STATE_FINISH, WECHAT_MESSAGE_TYPE_BOT,
};

pub async fn run_stdio_bridge() {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(65))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    let stdout = std::io::stdout();
    let mut stdout_lock = stdout.lock();

    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<BridgeEnvelope>(trimmed) {
            Ok(envelope) => handle_request(&client, envelope).await,
            Err(err) => BridgeResponseEnvelope {
                id: "invalid".to_string(),
                payload: BridgeResponsePayload::Error {
                    message: err.to_string(),
                },
            },
        };

        if let Ok(serialized) = serde_json::to_string(&response) {
            let _ = writeln!(stdout_lock, "{}", serialized);
            let _ = stdout_lock.flush();
        }
    }
}

async fn handle_request(
    client: &reqwest::Client,
    envelope: BridgeEnvelope,
) -> BridgeResponseEnvelope {
    let payload = match envelope.request {
        BridgeRequest::FetchLoginQr { base_url } => {
            match fetch_login_qr(client, base_url.as_str()).await {
                Ok(data) => BridgeResponsePayload::FetchLoginQr { data },
                Err(message) => BridgeResponsePayload::Error { message },
            }
        }
        BridgeRequest::FetchQrStatus {
            base_url,
            qrcode_id,
        } => match fetch_qr_status(client, base_url.as_str(), qrcode_id.as_str()).await {
            Ok(data) => BridgeResponsePayload::FetchQrStatus { data },
            Err(message) => BridgeResponsePayload::Error { message },
        },
        BridgeRequest::GetUpdates {
            base_url,
            token,
            cursor,
        } => match get_updates(client, base_url.as_str(), token.as_str(), cursor.as_str()).await {
            Ok(data) => BridgeResponsePayload::GetUpdates { data },
            Err(message) => BridgeResponsePayload::Error { message },
        },
        BridgeRequest::SendText {
            base_url,
            token,
            contact_id,
            text,
            context_token,
        } => {
            let message = WechatOutboundMessage {
                to_user_id: contact_id.trim().to_string(),
                from_user_id: String::new(),
                client_id: uuid::Uuid::new_v4().to_string(),
                message_type: WECHAT_MESSAGE_TYPE_BOT,
                message_state: WECHAT_MESSAGE_STATE_FINISH,
                context_token: context_token.trim().to_string(),
                item_list: vec![WechatOutboundMessageItem {
                    r#type: WECHAT_ITEM_TYPE_TEXT,
                    text_item: WechatOutboundTextItem { text },
                }],
            };
            match send_text_message(client, base_url.as_str(), token.as_str(), message).await {
                Ok(()) => BridgeResponsePayload::SendText { ok: true },
                Err(message) => BridgeResponsePayload::Error { message },
            }
        }
    };

    BridgeResponseEnvelope {
        id: envelope.id,
        payload,
    }
}
