use super::{
    InFlightExecutionStage, PersistedChatToolRuntimeContext, PersistedDelegationWait,
    PersistedPendingApproval,
};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PersistedInFlightExecutionContext {
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) schema_version: i64,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) session_id: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) trace_id: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) request_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) execution_graph_execution_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) stage: InFlightExecutionStage,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) current_node: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) current_call_id: Option<String>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) delegation: Option<PersistedDelegationWait>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) started_at_unix_ms: i64,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) last_heartbeat_at_unix_ms: i64,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) recoverable: bool,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) pending_approvals: Vec<PersistedPendingApproval>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) chat_runtime: Option<PersistedChatToolRuntimeContext>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) last_error: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) recovery_notice_emitted_at_unix_ms: Option<i64>,
}
