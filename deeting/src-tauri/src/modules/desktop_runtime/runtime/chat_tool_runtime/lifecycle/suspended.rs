use super::super::frame_tools::DitingThinkExtract;
use super::super::runtime_metrics::RuntimeMetricsAccumulator;
use super::PersistedPendingApproval;
use crate::modules::desktop_runtime::runtime::{
    ActiveSkillContextState, LocalCapabilityActivationState, LocalExecutionPolicy,
};
use crate::modules::mcp::commands::common_impl::LocalModelConnection;
use crate::modules::mcp::commands::support::LocalChatInputMessage;
use desktop_runtime_core::WorldModelFrame;

#[derive(Clone)]
pub(crate) struct SuspendedChatToolExecution {
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
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) world_model_frame:
        Option<WorldModelFrame>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) task_query: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) session_id: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) temperature: Option<f32>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) max_tokens: Option<u32>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) reasoning_enabled:
        Option<bool>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) reasoning_effort:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) active_capability:
        Option<LocalCapabilityActivationState>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) active_skill_context:
        Option<ActiveSkillContextState>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) captured_frame_extract:
        Option<DitingThinkExtract>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) runtime_metrics:
        RuntimeMetricsAccumulator,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) last_capability_snapshot:
        Option<serde_json::Value>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) terminal_context:
        Option<serde_json::Value>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) workflow_context:
        Option<serde_json::Value>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) last_response:
        Option<serde_json::Value>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) pending_approvals:
        Vec<PersistedPendingApproval>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) execution_graph:
        serde_json::Value,
    // Carries the workflow-supplied selected knowledge file ids so that the
    // context tool fallback (used by `context_search` with `scope: "selected"`
    // but no `filters.selected_file_ids`) still works after suspend/resume.
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) selected_knowledge_file_ids:
        Vec<String>,
}
