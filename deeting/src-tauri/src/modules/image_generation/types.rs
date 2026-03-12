use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalImageGenerationTaskCreateRequest {
    pub model: String,
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub aspect_ratio: Option<String>,
    pub num_outputs: Option<i64>,
    pub steps: Option<i64>,
    pub cfg_scale: Option<f64>,
    pub seed: Option<i64>,
    pub sampler_name: Option<String>,
    pub quality: Option<String>,
    pub style: Option<String>,
    pub response_format: Option<String>,
    pub extra_params: Option<Value>,
    pub provider_model_id: String,
    pub session_id: Option<String>,
    pub request_id: Option<String>,
    pub encrypt_prompt: Option<bool>,
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalImageGenerationTaskCreateResponse {
    pub task_id: String,
    pub status: String,
    pub created_at: String,
    pub deduped: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalImageGenerationOutputItem {
    pub output_index: i64,
    pub asset_url: Option<String>,
    pub source_url: Option<String>,
    pub seed: Option<i64>,
    pub content_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalImageGenerationTaskDetail {
    pub task_id: String,
    pub status: String,
    pub model: String,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub outputs: Vec<LocalImageGenerationOutputItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalImageGenerationTaskItem {
    pub task_id: String,
    pub status: String,
    pub model: String,
    pub session_id: Option<String>,
    pub prompt: Option<String>,
    pub prompt_encrypted: Option<bool>,
    pub negative_prompt: Option<String>,
    pub aspect_ratio: Option<String>,
    pub steps: Option<i64>,
    pub cfg_scale: Option<f64>,
    pub seed: Option<i64>,
    pub provider_model_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub preview: Option<LocalImageGenerationOutputItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalImageGenerationTaskPage {
    pub items: Vec<LocalImageGenerationTaskItem>,
    pub next_page: Option<String>,
    pub previous_page: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalImageGenerationTasksQuery {
    pub cursor: Option<String>,
    pub size: Option<i64>,
    pub status: Option<String>,
    pub include_outputs: Option<bool>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalImageGenerationCancelResponse {
    pub request_id: String,
    pub status: String,
}
