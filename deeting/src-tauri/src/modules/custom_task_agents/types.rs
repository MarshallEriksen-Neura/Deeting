use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CustomTaskAgentInvocationKind {
    Chat,
    ImageGeneration,
    TextToSpeech,
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
            Self::TextToSpeech => "text_to_speech",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct CustomTaskAgentSkillActionRef {
    pub skill_id: String,
    pub action_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentProfile {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub task_prompt: String,
    pub invocation_kind: CustomTaskAgentInvocationKind,
    pub preferred_for_image_generation: bool,
    pub model_config: Option<Value>,
    pub callable_mcp_tool_ids: Vec<String>,
    pub guidance_skill_ids: Vec<String>,
    pub callable_skill_action_refs: Vec<CustomTaskAgentSkillActionRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bound_asset_id: Option<String>,
    pub tags: Vec<String>,
    pub discoverable: bool,
    pub is_enabled: bool,
    pub is_deleted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_repo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCustomTaskAgentRequest {
    pub name: String,
    pub description: Option<String>,
    pub task_prompt: String,
    pub invocation_kind: Option<CustomTaskAgentInvocationKind>,
    pub preferred_for_image_generation: Option<bool>,
    pub model_config: Option<Value>,
    #[serde(default, alias = "bound_tool_ids")]
    pub callable_mcp_tool_ids: Vec<String>,
    #[serde(default, alias = "bound_skill_ids")]
    pub guidance_skill_ids: Vec<String>,
    #[serde(default)]
    pub callable_skill_action_refs: Vec<CustomTaskAgentSkillActionRef>,
    #[serde(default)]
    pub bound_asset_id: Option<String>,
    pub tags: Option<Vec<String>>,
    pub discoverable: Option<bool>,
    pub is_enabled: Option<bool>,
    pub source_kind: Option<String>,
    pub source_path: Option<String>,
    pub source_repo: Option<String>,
    pub source_ref: Option<String>,
    pub source_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCustomTaskAgentRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub task_prompt: Option<String>,
    pub invocation_kind: Option<CustomTaskAgentInvocationKind>,
    pub preferred_for_image_generation: Option<bool>,
    pub model_config: Option<Value>,
    #[serde(alias = "bound_tool_ids")]
    pub callable_mcp_tool_ids: Option<Vec<String>>,
    #[serde(alias = "bound_skill_ids")]
    pub guidance_skill_ids: Option<Vec<String>>,
    pub callable_skill_action_refs: Option<Vec<CustomTaskAgentSkillActionRef>>,
    pub bound_asset_id: Option<String>,
    pub tags: Option<Vec<String>>,
    pub discoverable: Option<bool>,
    pub is_enabled: Option<bool>,
    pub source_kind: Option<String>,
    pub source_path: Option<String>,
    pub source_repo: Option<String>,
    pub source_ref: Option<String>,
    pub source_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentPreviewRequest {
    pub message: String,
    #[serde(default)]
    pub image_urls: Vec<String>,
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
    pub callable_mcp_tool_ids: Vec<String>,
    #[serde(default)]
    pub guidance_skill_ids: Vec<String>,
    #[serde(default)]
    pub callable_skill_action_refs: Vec<CustomTaskAgentSkillActionRef>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub audios: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentBindableMcpTool {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentBindableGuidanceSkill {
    pub skill_id: String,
    pub installed_version: Option<String>,
    pub is_enabled: bool,
    pub runtime: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentBindableSkillAction {
    pub skill_id: String,
    pub action_id: String,
    pub callable_name: String,
    pub description: String,
    pub runtime: String,
    pub entry_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskAgentBindingCatalogResponse {
    #[serde(default)]
    pub mcp_tools: Vec<CustomTaskAgentBindableMcpTool>,
    #[serde(default)]
    pub guidance_skills: Vec<CustomTaskAgentBindableGuidanceSkill>,
    #[serde(default)]
    pub skill_actions: Vec<CustomTaskAgentBindableSkillAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewClaudeAgentImportRequest {
    #[serde(default)]
    pub documents: Vec<UploadedClaudeAgentDocument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeAgentImportPreviewItem {
    pub source_path: String,
    pub relative_path: String,
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    #[serde(default)]
    pub inferred_mcp_tool_ids: Vec<String>,
    #[serde(default)]
    pub inferred_guidance_skill_ids: Vec<String>,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_agent_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeAgentImportPreviewResponse {
    pub root_path: String,
    #[serde(default)]
    pub items: Vec<ClaudeAgentImportPreviewItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportClaudeAgentsRequest {
    #[serde(default)]
    pub documents: Vec<UploadedClaudeAgentDocument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportClaudeAgentsResponse {
    pub root_path: String,
    pub created_count: usize,
    pub updated_count: usize,
    #[serde(default)]
    pub profiles: Vec<CustomTaskAgentProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadedClaudeAgentDocument {
    pub filename: String,
    #[serde(default)]
    pub relative_path: Option<String>,
    pub content: String,
}
