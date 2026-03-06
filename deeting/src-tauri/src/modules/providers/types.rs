use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

fn default_auth_type() -> String {
    "api_key".to_string()
}

fn default_json_object() -> Value {
    serde_json::json!({})
}

fn default_preset_version() -> i64 {
    1
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderPreset {
    pub slug: String,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub icon: Option<String>,
    #[serde(default)]
    pub theme_color: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub url_template: Option<String>,
    #[serde(default)]
    pub template_engine: Option<String>,
    #[serde(default)]
    pub response_transform: Option<Value>,
    #[serde(default = "default_auth_type")]
    pub auth_type: String,
    #[serde(default = "default_json_object")]
    pub auth_config: Value,
    #[serde(default = "default_json_object")]
    pub default_headers: Value,
    #[serde(default = "default_json_object")]
    pub default_params: Value,
    #[serde(default = "default_json_object")]
    pub capability_configs: Value,
    #[serde(default = "default_preset_version")]
    pub version: i64,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderInstance {
    pub id: Uuid,
    pub preset_slug: String,
    pub name: String,
    pub base_url: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub meta: Value,
    #[serde(default)]
    pub template_engine: Option<String>,
    #[serde(default)]
    pub response_transform: Option<Value>,
    pub is_enabled: bool,
    pub is_local: bool,
    /// "local" = use instance base_url + secret_key; "platform" = use cloud credits proxy.
    #[serde(default)]
    pub credential_source: String,
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
    pub unified_model_id: Option<String>,
    pub display_name: Option<String>,
    pub capabilities: Vec<String>,
    pub upstream_path: String,
    #[serde(default)]
    pub pricing_config: Value,
    #[serde(default)]
    pub limit_config: Value,
    #[serde(default)]
    pub tokenizer_config: Value,
    #[serde(default)]
    pub routing_config: Value,
    #[serde(default)]
    pub config_override: Value,
    pub source: String,
    #[serde(default)]
    pub extra_meta: Value,
    #[serde(default)]
    pub weight: i64,
    #[serde(default)]
    pub priority: i64,
    pub is_active: bool,
    pub synced_at: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserEmbeddingConfig {
    pub id: String,
    pub user_id: String,
    pub provider_model_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateInstanceRequest {
    pub preset_slug: String,
    pub name: String,
    pub base_url: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub priority: Option<i64>,
    pub protocol: Option<String>,
    pub model_prefix: Option<String>,
    pub auto_append_v1: Option<bool>,
    pub resource_name: Option<String>,
    pub deployment_name: Option<String>,
    pub api_version: Option<String>,
    pub project_id: Option<String>,
    pub region: Option<String>,
    pub is_local: Option<bool>,
    /// "local" or "platform"; default "local".
    pub credential_source: Option<String>,
    pub secret_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateInstanceRequest {
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub credential_source: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub priority: Option<i64>,
    pub protocol: Option<String>,
    pub model_prefix: Option<String>,
    pub auto_append_v1: Option<bool>,
    pub resource_name: Option<String>,
    pub deployment_name: Option<String>,
    pub api_version: Option<String>,
    pub project_id: Option<String>,
    pub region: Option<String>,
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
    pub unified_model_id: Option<Option<String>>,
    pub upstream_path: Option<String>,
    pub weight: Option<i64>,
    pub priority: Option<i64>,
    pub pricing_config: Option<Value>,
    pub limit_config: Option<Value>,
    pub tokenizer_config: Option<Value>,
    pub routing_config: Option<Value>,
    pub config_override: Option<Value>,
    pub source: Option<String>,
    pub extra_meta: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct ProviderModelTestRequest {
    pub prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ProviderVerifyRequest {
    pub preset_slug: String,
    pub base_url: String,
    pub api_key: String,
    pub model: Option<String>,
    pub protocol: Option<String>,
    pub auto_append_v1: Option<bool>,
    pub resource_name: Option<String>,
    pub deployment_name: Option<String>,
    pub project_id: Option<String>,
    pub region: Option<String>,
    pub api_version: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProviderVerifyResponse {
    pub success: bool,
    pub message: String,
    pub latency_ms: i64,
    pub discovered_models: Vec<String>,
    pub probe_url: Option<String>,
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

#[derive(Debug, Deserialize)]
pub struct UserEmbeddingConfigUpdateRequest {
    #[serde(default)]
    pub provider_model_id: Option<Option<String>>,
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
