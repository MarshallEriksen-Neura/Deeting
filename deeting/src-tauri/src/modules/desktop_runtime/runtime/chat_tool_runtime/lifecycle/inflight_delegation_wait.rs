fn default_delegation_resume_policy() -> String {
    "on_completed".to_string()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub(crate) struct PersistedDelegationWait {
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) kind: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) delegated_run_id: String,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) delegated_target_id: Option<String>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) delegated_target_name: Option<String>,
    #[serde(default = "default_delegation_resume_policy")]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) resume_policy: String,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) consumed_event_ids: Vec<String>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) last_status: Option<String>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_ref: Option<String>,
    #[serde(default)]
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) started_at_unix_ms: i64,
}
