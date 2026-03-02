use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderPreset {
    pub slug: String,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub icon: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderInstance {
    pub id: Uuid,
    pub preset_slug: String,
    pub name: String,
    pub base_url: String,
    pub is_enabled: bool,
    pub is_local: bool,
    pub credentials_ref: String,
    pub updated_at: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderCredential {
    pub id: Uuid,
    pub instance_id: Uuid,
    pub alias: String,
    pub secret_key: String, // 实际存储加密后的内容
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderModel {
    pub id: Uuid,
    pub instance_id: Uuid,
    pub model_id: String,
    pub display_name: Option<String>,
    pub capabilities: Vec<String>,
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateInstanceRequest {
    pub preset_slug: String,
    pub name: String,
    pub base_url: String,
    pub is_local: Option<bool>,
    pub secret_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateInstanceRequest {
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub is_enabled: Option<bool>,
    pub secret_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ProviderModelsQuickAddRequest {
    pub models: Vec<String>,
    pub capability: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ProviderModelUpdateRequest {
    pub display_name: Option<String>,
    pub is_active: Option<bool>,
    pub capabilities: Option<Vec<String>>,
    pub routing_config: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct ProviderModelTestRequest {
    pub prompt: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProviderModelTestResponse {
    pub success: bool,
    pub latency_ms: i64,
    pub status_code: i32,
    pub upstream_url: String,
    pub response_body: Option<Value>,
    pub error: Option<String>,
}
