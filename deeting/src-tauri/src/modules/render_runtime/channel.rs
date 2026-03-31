use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RenderChannelMessage {
    pub channel_id: String,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub issued_at_ms: Option<i64>,
}
