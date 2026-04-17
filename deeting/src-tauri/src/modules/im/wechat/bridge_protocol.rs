use serde::{Deserialize, Serialize};

use super::types::{WechatGetUpdatesResponse, WechatQrCodeResponse, WechatQrStatusResponse};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum BridgeRequest {
    FetchLoginQr {
        base_url: String,
    },
    FetchQrStatus {
        base_url: String,
        qrcode_id: String,
    },
    GetUpdates {
        base_url: String,
        token: String,
        cursor: String,
    },
    SendText {
        base_url: String,
        token: String,
        contact_id: String,
        text: String,
        context_token: String,
    },
    SendMessage {
        base_url: String,
        token: String,
        message: super::types::WechatOutboundMessage,
    },
    SendTyping {
        base_url: String,
        token: String,
        contact_id: String,
        context_token: String,
        status: i64,
    },
    GetUploadUrl {
        base_url: String,
        token: String,
        file_name: String,
    },
    GetConfig {
        base_url: String,
        token: String,
        contact_id: String,
        context_token: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeEnvelope {
    pub id: String,
    #[serde(flatten)]
    pub request: BridgeRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BridgeResponsePayload {
    FetchLoginQr { data: WechatQrCodeResponse },
    FetchQrStatus { data: WechatQrStatusResponse },
    GetUpdates { data: WechatGetUpdatesResponse },
    SendText { ok: bool },
    SendMessage { ok: bool },
    SendTyping { ok: bool },
    GetUploadUrl { data: serde_json::Value },
    GetConfig { data: serde_json::Value },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeResponseEnvelope {
    pub id: String,
    #[serde(flatten)]
    pub payload: BridgeResponsePayload,
}
