use serde::{Deserialize, Deserializer, Serialize};
use prost::Message;

#[derive(Deserialize)]
#[serde(untagged)]
enum StringOrInt {
    S(String),
    I(i64),
}

/// 反序列化时间戳字段：飞书可能返回字符串或整数（毫秒）
fn deserialize_string_or_int<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    match StringOrInt::deserialize(deserializer)? {
        StringOrInt::S(s) => Ok(s),
        StringOrInt::I(n) => Ok(n.to_string()),
    }
}

/// 反序列化 Option 时间戳：飞书可能返回字符串或整数
fn deserialize_opt_string_or_int<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let opt: Option<StringOrInt> = Option::deserialize(deserializer)?;
    Ok(opt.map(|v| match v {
        StringOrInt::S(s) => s,
        StringOrInt::I(n) => n.to_string(),
    }))
}

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
    #[serde(default, deserialize_with = "deserialize_opt_string_or_int")]
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
    #[serde(rename = "create_time", deserialize_with = "deserialize_string_or_int")]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsClientConfig {
    #[serde(rename = "PingInterval", default)]
    pub ping_interval: u64,
    #[serde(rename = "ReconnectCount", default)]
    pub reconnect_count: i32,
    #[serde(rename = "ReconnectInterval", default)]
    pub reconnect_interval: u64,
    #[serde(rename = "ReconnectNonce", default)]
    pub reconnect_nonce: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsConnectConfigData {
    #[serde(rename = "URL", default)]
    pub url: String,
    #[serde(rename = "ClientConfig")]
    pub client_config: WsClientConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsConnectConfigResponse {
    pub code: i32,
    pub msg: String,
    pub data: Option<WsConnectConfigData>,
}

#[derive(Clone, PartialEq, Message)]
pub struct ProtoHeader {
    #[prost(string, tag = "1")]
    pub key: String,
    #[prost(string, tag = "2")]
    pub value: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct ProtoFrame {
    #[prost(uint64, tag = "1")]
    pub seq_id: u64,
    #[prost(uint64, tag = "2")]
    pub log_id: u64,
    #[prost(int32, tag = "3")]
    pub service: i32,
    #[prost(int32, tag = "4")]
    pub method: i32,
    #[prost(message, repeated, tag = "5")]
    pub headers: Vec<ProtoHeader>,
    #[prost(string, tag = "6")]
    pub payload_encoding: String,
    #[prost(string, tag = "7")]
    pub payload_type: String,
    #[prost(bytes = "vec", tag = "8")]
    pub payload: Vec<u8>,
    #[prost(string, tag = "9")]
    pub log_id_new: String,
}

pub const FEISHU_FRAME_TYPE_CONTROL: i32 = 0;
pub const FEISHU_FRAME_TYPE_DATA: i32 = 1;
pub const FEISHU_MESSAGE_TYPE_EVENT: &str = "event";
pub const FEISHU_MESSAGE_TYPE_PING: &str = "ping";
pub const FEISHU_MESSAGE_TYPE_PONG: &str = "pong";
pub const FEISHU_HEADER_TYPE: &str = "type";
pub const FEISHU_HEADER_MESSAGE_ID: &str = "message_id";
pub const FEISHU_HEADER_SUM: &str = "sum";
pub const FEISHU_HEADER_SEQ: &str = "seq";
pub const FEISHU_HEADER_TRACE_ID: &str = "trace_id";
pub const FEISHU_HEADER_BIZ_RT: &str = "biz_rt";

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
