use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

fn default_canonical_version() -> String {
    "2026-03-07".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CanonicalClientContext {
    #[serde(default = "default_internal_channel")]
    pub channel: String,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub trace_id: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

fn default_internal_channel() -> String {
    "internal".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CanonicalToolCall {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default = "default_function_type")]
    pub r#type: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub arguments: Option<Value>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub extra_content: Value,
}

fn default_function_type() -> String {
    "function".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CanonicalMessage {
    pub role: String,
    #[serde(default)]
    pub content: Value,
    #[serde(default)]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub tool_calls: Vec<CanonicalToolCall>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CanonicalInputItem {
    pub r#type: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalRequest {
    #[serde(default = "default_canonical_version")]
    pub canonical_version: String,
    #[serde(default = "default_chat_capability")]
    pub capability: String,
    pub model: String,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub messages: Vec<CanonicalMessage>,
    #[serde(default)]
    pub input_items: Vec<CanonicalInputItem>,
    #[serde(default)]
    pub stream: bool,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_output_tokens: Option<i64>,
    #[serde(default)]
    pub reasoning_enabled: Option<bool>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default = "default_json_object")]
    pub metadata: Value,
    #[serde(default)]
    pub client_context: CanonicalClientContext,
}

fn default_chat_capability() -> String {
    "chat".to_string()
}

fn default_json_object() -> Value {
    json!({})
}
