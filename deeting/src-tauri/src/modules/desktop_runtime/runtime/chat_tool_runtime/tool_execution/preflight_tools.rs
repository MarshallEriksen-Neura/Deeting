pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct PreflightToolExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn build_policy_blocked_tool_result(
    call_id: &str,
    tool_name: &str,
) -> PreflightToolExecutionResult {
    let error = format!(
        "tool '{}' is not enabled for the current execution policy",
        tool_name
    );
    let result_message = format!(
        "Tool call '{}' blocked [LOCAL_TOOL_POLICY_BLOCKED]: {}",
        tool_name, error
    );
    PreflightToolExecutionResult {
        meta: serde_json::json!({
            "id": call_id,
            "name": tool_name,
            "status": "error",
            "error_code": "LOCAL_TOOL_POLICY_BLOCKED",
            "error": error,
        }),
        result_message,
    }
}
