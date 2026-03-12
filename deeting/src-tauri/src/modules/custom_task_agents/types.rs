use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CustomTaskAgentInvocationKind {
    Chat,
    ImageGeneration,
}

impl Default for CustomTaskAgentInvocationKind {
    fn default() -> Self {
        Self::Chat
    }
}

impl CustomTaskAgentInvocationKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::ImageGeneration => "image_generation",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentProfile {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub task_prompt: String,
    pub invocation_kind: CustomTaskAgentInvocationKind,
    pub model_config: Option<Value>,
    pub bound_tool_ids: Vec<String>,
    pub bound_skill_ids: Vec<String>,
    pub tags: Vec<String>,
    pub discoverable: bool,
    pub is_enabled: bool,
    pub is_deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCustomTaskAgentRequest {
    pub name: String,
    pub description: Option<String>,
    pub task_prompt: String,
    pub invocation_kind: Option<CustomTaskAgentInvocationKind>,
    pub model_config: Option<Value>,
    #[serde(default)]
    pub bound_tool_ids: Vec<String>,
    #[serde(default)]
    pub bound_skill_ids: Vec<String>,
    pub tags: Option<Vec<String>>,
    pub discoverable: Option<bool>,
    pub is_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCustomTaskAgentRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub task_prompt: Option<String>,
    pub invocation_kind: Option<CustomTaskAgentInvocationKind>,
    pub model_config: Option<Value>,
    pub bound_tool_ids: Option<Vec<String>>,
    pub bound_skill_ids: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub discoverable: Option<bool>,
    pub is_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentPreviewRequest {
    pub message: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub max_rounds: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentPreviewResponse {
    pub status: String,
    pub content: String,
    pub model_id: String,
    pub provider_model_id: String,
    pub invocation_kind: CustomTaskAgentInvocationKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub tool_calls: Vec<Value>,
    #[serde(default)]
    pub tool_trace: Vec<Value>,
    #[serde(default)]
    pub bound_tool_ids: Vec<String>,
    #[serde(default)]
    pub bound_skill_ids: Vec<String>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentBindableTool {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentBindableSkill {
    pub skill_id: String,
    pub installed_version: Option<String>,
    pub is_enabled: bool,
    pub runtime: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentBindingCatalogResponse {
    #[serde(default)]
    pub tools: Vec<CustomTaskAgentBindableTool>,
    #[serde(default)]
    pub skills: Vec<CustomTaskAgentBindableSkill>,
}
