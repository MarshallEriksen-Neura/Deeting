use super::super::frame_tools::WorldModelUpdate;
use super::super::runtime_metrics::RuntimeMetricsAccumulator;
use crate::modules::desktop_runtime::runtime::{
    ActiveSkillContextState, LocalCapabilityActivationState, LocalExecutionPolicy,
};
use crate::modules::mcp::commands::common_impl::LocalModelConnection;
use crate::modules::mcp::commands::support::LocalChatInputMessage;
use desktop_runtime_core::WorldModelFrame;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PersistedChatToolRuntimeContext {
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) max_rounds: usize,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) round: usize,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) trace_id: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) request_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) execution_policy:
        LocalExecutionPolicy,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) model_connection:
        LocalModelConnection,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) orchestrated_messages:
        Vec<LocalChatInputMessage>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) world_model_frame:
        Option<WorldModelFrame>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) task_query: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) session_id: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) temperature: Option<f32>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) max_tokens: Option<u32>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) reasoning_enabled:
        Option<bool>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) reasoning_effort:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) active_capability:
        Option<LocalCapabilityActivationState>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) active_skill_context:
        Option<ActiveSkillContextState>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) captured_world_model_update:
        Option<WorldModelUpdate>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) runtime_metrics:
        RuntimeMetricsAccumulator,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) last_capability_snapshot:
        Option<serde_json::Value>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) terminal_context:
        Option<serde_json::Value>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) workflow_context:
        Option<serde_json::Value>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) last_response:
        Option<serde_json::Value>,
    // Backwards-compat: older persisted contexts pre-date the context
    // orchestrator manifest, so deserialize as empty when missing.
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) selected_knowledge_file_ids:
        Vec<String>,
}
