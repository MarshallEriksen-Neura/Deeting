use serde::{Deserialize, Serialize};
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
    pub is_local: bool,
    pub credentials_ref: String,
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
    pub secret_key: String,
}
