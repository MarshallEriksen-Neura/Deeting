use serde::{Deserialize, Serialize};

pub const WECHAT_DEFAULT_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
pub const WECHAT_CHANNEL_VERSION: &str = "0.1.0";
pub const WECHAT_DEFAULT_ACCOUNT_KEY: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WechatPairingResponse {
    pub pairing_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qr_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qr_image_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WechatConnectionStateResponse {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected_at: Option<String>,
    pub pending_pairings: i64,
    pub allowlist_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WechatDisconnectResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WechatPairingDecisionResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WechatCancelPairingResponse {
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredWechatAccount {
    pub token: String,
    pub base_url: String,
    pub user_id: Option<String>,
    pub account_id: Option<String>,
    pub cursor: String,
    pub saved_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WechatQrCodeResponse {
    pub qrcode: Option<String>,
    pub qrcode_img_content: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WechatQrStatusResponse {
    pub status: Option<String>,
    pub bot_token: Option<String>,
    pub ilink_bot_id: Option<String>,
    pub baseurl: Option<String>,
    pub ilink_user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WechatBaseInfo {
    pub channel_version: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct WechatGetUpdatesRequest {
    pub get_updates_buf: String,
    pub base_info: WechatBaseInfo,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WechatGetUpdatesResponse {
    pub ret: Option<i64>,
    pub errcode: Option<i64>,
    pub errmsg: Option<String>,
    pub msgs: Option<Vec<WechatMessage>>,
    pub get_updates_buf: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WechatMessage {
    pub message_id: Option<i64>,
    pub from_user_id: Option<String>,
    pub message_type: Option<i64>,
    pub item_list: Option<Vec<WechatMessageItem>>,
    pub context_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WechatMessageItem {
    pub r#type: Option<i64>,
    pub text_item: Option<WechatTextItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WechatTextItem {
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WechatSendMessageRequest {
    pub msg: WechatOutboundMessage,
    pub base_info: WechatBaseInfo,
}

#[derive(Debug, Clone, Serialize)]
pub struct WechatOutboundMessage {
    pub to_user_id: String,
    pub from_user_id: String,
    pub client_id: String,
    pub message_type: i64,
    pub message_state: i64,
    pub context_token: String,
    pub item_list: Vec<WechatOutboundMessageItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WechatOutboundMessageItem {
    pub r#type: i64,
    pub text_item: WechatOutboundTextItem,
}

#[derive(Debug, Clone, Serialize)]
pub struct WechatOutboundTextItem {
    pub text: String,
}

pub const WECHAT_MESSAGE_TYPE_USER: i64 = 1;
pub const WECHAT_MESSAGE_TYPE_BOT: i64 = 2;
pub const WECHAT_MESSAGE_STATE_FINISH: i64 = 2;
pub const WECHAT_ITEM_TYPE_TEXT: i64 = 1;
