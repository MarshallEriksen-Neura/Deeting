#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PersistedPendingApproval {
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) approval_token: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) tool_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) tool_name: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) arguments:
        serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) call_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) execution_token:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) session_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) description: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) risk_level: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) risk_reasons: Vec<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) tool_fingerprint: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) policy_rule_key:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) approval_grant_key:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) execution_graph_execution_id:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) execution_graph_gate_node_id:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) execution_graph_tool_node_id:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) approval_status:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) created_at_unix_ms: i128,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) expires_at_unix_ms: i128,
}
