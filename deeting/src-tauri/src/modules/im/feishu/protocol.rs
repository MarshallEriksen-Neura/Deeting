use serde::{Deserialize, Serialize};

/// 飞书 WebSocket 消息头
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsHeader {
    pub app_id: String,
    pub nonce: String,
    pub timestamp: String,
    pub event_type: String,
    pub event_id: String,
    pub tenant_key: Option<String>,
    pub token: Option<String>,
}

/// 飞书 WebSocket 消息帧
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsFrame {
    #[serde(rename = "type")]
    pub frame_type: String,
    pub ts: Option<String>,
    pub uuid: Option<String>,
    pub data: Option<serde_json::Value>,
    pub header: Option<WsHeader>,
    pub event: Option<serde_json::Value>,
}

/// URL 验证请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlVerification {
    #[serde(rename = "type")]
    pub verify_type: String,
    pub challenge: String,
    pub token: String,
}

/// 飞书消息事件 (v2.0)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuMessageEvent {
    pub sender: FeishuSender,
    pub message: FeishuMessage,
    #[serde(default)]
    pub tenant_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuSender {
    #[serde(rename = "sender_type", default)]
    pub sender_type: String,
    #[serde(rename = "sender_id")]
    pub sender_id: FeishuSenderId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuSenderId {
    #[serde(default)]
    pub open_id: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub union_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuMessage {
    #[serde(rename = "message_id")]
    pub message_id: String,
    #[serde(rename = "root_id", default)]
    pub root_id: String,
    #[serde(rename = "parent_id", default)]
    pub parent_id: String,
    #[serde(rename = "create_time")]
    pub create_time: String,
    #[serde(rename = "chat_id")]
    pub chat_id: String,
    #[serde(rename = "chat_type", default)]
    pub chat_type: String,
    #[serde(rename = "message_type", default)]
    pub message_type: String,
    pub content: String,
    #[serde(default)]
    pub mentions: Vec<FeishuMention>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuMention {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub id: FeishuMentionId,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FeishuMentionId {
    #[serde(default)]
    pub open_id: String,
    #[serde(default)]
    pub user_id: String,
}

/// 飞书卡片回调事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuCardEvent {
    #[serde(default)]
    pub token: String,
    pub action: FeishuCardAction,
    pub context: FeishuCardContext,
    pub operator: FeishuCardOperator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuCardAction {
    #[serde(default)]
    pub tag: String,
    #[serde(default)]
    pub name: String,
    pub value: serde_json::Value,
    #[serde(default)]
    pub form_value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuCardContext {
    #[serde(rename = "open_message_id", default)]
    pub open_message_id: String,
    #[serde(rename = "open_chat_id", default)]
    pub open_chat_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuCardOperator {
    #[serde(default)]
    pub open_id: String,
    #[serde(default)]
    pub user_id: String,
}

/// 飞书卡片回调请求 (旧版)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyCardCallback {
    #[serde(rename = "type", default)]
    pub callback_type: String,
    #[serde(default)]
    pub challenge: String,
    #[serde(default)]
    pub token: String,
    #[serde(rename = "open_id", default)]
    pub open_id: String,
    #[serde(rename = "user_id", default)]
    pub user_id: String,
    #[serde(rename = "open_message_id", default)]
    pub open_message_id: String,
    #[serde(rename = "open_chat_id", default)]
    pub open_chat_id: String,
    pub action: FeishuCardAction,
}

/// 飞书 API 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuApiResponse<T> {
    pub code: i32,
    pub msg: String,
    pub data: Option<T>,
}

/// 租户访问令牌响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantAccessToken {
    #[serde(rename = "tenant_access_token")]
    pub token: String,
    pub expire: i32,
}

/// 自建应用获取 tenant_access_token 的响应是顶层字段，不在 `data` 里。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantAccessTokenResponse {
    pub code: i32,
    pub msg: String,
    #[serde(rename = "tenant_access_token", default)]
    pub tenant_access_token: String,
    #[serde(default)]
    pub expire: i32,
}

/// WebSocket 连接信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsConnectionInfo {
    pub url: String,
    pub expire: i64,
}

/// 发送消息请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageReq {
    pub receive_id: String,
    pub msg_type: String,
    pub content: String,
}

/// 发送消息响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageResp {
    pub message_id: String,
}
