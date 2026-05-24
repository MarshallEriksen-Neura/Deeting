use super::super::frame_tools::{format_diting_think_reasoning, DITING_THINK_TOOL_NAME};

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct PreflightToolExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn build_diting_think_tool_result(
    call_id: &str,
    arguments: &serde_json::Value,
) -> PreflightToolExecutionResult {
    let reasoning = format_diting_think_reasoning(arguments);
    PreflightToolExecutionResult {
        meta: serde_json::json!({
            "id": call_id,
            "name": DITING_THINK_TOOL_NAME,
            "status": "success",
            "result": "Deep reasoning complete. Proceed with execution based on your plan.",
            "reasoning": reasoning,
        }),
        result_message: "Deep reasoning acknowledged. Continue with your planned execution."
            .to_string(),
    }
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
