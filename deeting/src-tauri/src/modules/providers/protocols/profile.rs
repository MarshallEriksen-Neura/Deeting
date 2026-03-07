use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

fn default_runtime_version() -> String {
    "v2".to_string()
}

fn default_schema_version() -> String {
    "2026-03-07".to_string()
}

fn default_post_method() -> String {
    "POST".to_string()
}

fn default_openai_compat() -> String {
    "openai_compat".to_string()
}

fn default_json_object() -> Value {
    json!({})
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeHook {
    pub name: String,
    #[serde(default = "default_json_object")]
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileTransport {
    #[serde(default = "default_post_method")]
    pub method: String,
    pub path: String,
    #[serde(default = "default_json_object")]
    pub query_template: Value,
    #[serde(default = "default_json_object")]
    pub header_template: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileRequestConfig {
    #[serde(default = "default_openai_compat")]
    pub template_engine: String,
    #[serde(default = "default_json_object")]
    pub request_template: Value,
    #[serde(default)]
    pub request_builder: Option<RuntimeHook>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileResponseConfig {
    pub decoder: RuntimeHook,
    #[serde(default = "default_json_object")]
    pub response_template: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileStreamConfig {
    #[serde(default)]
    pub stream_decoder: Option<RuntimeHook>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileAuthConfig {
    pub auth_policy: String,
    #[serde(default = "default_json_object")]
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileFeatureFlags {
    pub supports_messages: bool,
    pub supports_input_items: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileDefaults {
    #[serde(default = "default_json_object")]
    pub headers: Value,
    #[serde(default = "default_json_object")]
    pub query: Value,
    #[serde(default = "default_json_object")]
    pub body: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolProfile {
    #[serde(default = "default_runtime_version")]
    pub runtime_version: String,
    #[serde(default = "default_schema_version")]
    pub schema_version: String,
    pub profile_id: String,
    pub provider: String,
    pub protocol_family: String,
    pub capability: String,
    pub transport: ProfileTransport,
    pub request: ProfileRequestConfig,
    pub response: ProfileResponseConfig,
    pub stream: ProfileStreamConfig,
    pub auth: ProfileAuthConfig,
    pub features: ProfileFeatureFlags,
    pub defaults: ProfileDefaults,
}
