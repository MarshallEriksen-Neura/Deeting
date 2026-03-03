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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserSecretary {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub model_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BanditArmState {
    pub id: String,
    pub provider_model_id: Option<String>,
    pub scene: String,
    pub arm_id: Option<String>,
    pub reward_metric_type: Option<String>,
    pub strategy: String,
    pub epsilon: f64,
    pub alpha: f64,
    pub beta: f64,
    pub total_trials: i64,
    pub successes: i64,
    pub failures: i64,
    pub total_latency_ms: i64,
    pub latency_p95_ms: Option<f64>,
    pub total_cost: f64,
    pub last_reward: f64,
    pub cooldown_until: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct BanditFeedbackRequest {
    pub scene: Option<String>,
    pub arm_id: String,
    pub success: bool,
    pub latency_ms: Option<f64>,
    pub cost: Option<f64>,
    pub reward: Option<f64>,
    pub routing_config: Option<Value>,
    pub reward_metric_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UserSecretaryUpdateRequest {
    #[serde(default)]
    pub model_name: Option<Option<String>>,
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
