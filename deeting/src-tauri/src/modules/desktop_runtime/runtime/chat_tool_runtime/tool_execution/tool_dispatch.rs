use crate::modules::mcp::commands::runtime::execute_or_queue_mcp_tool_call_with_tool_ref;
use crate::modules::mcp::McpRuntimeState;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct GenericMcpToolDispatchResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) approval_token:
        Option<String>,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_generic_mcp_tool_call(
    mcp: &McpRuntimeState,
    session_id: &str,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<GenericMcpToolDispatchResult, String> {
    let approval_context = mcp.build_approval_context(Some(call_id), None, Some(session_id));
    let tool_result = Box::pin(execute_or_queue_mcp_tool_call_with_tool_ref(
        &approval_context,
        Some(mcp),
        mcp.store.as_ref(),
        mcp.approvals.pending_tool_calls.as_ref(),
        None,
        Some(tool_name.to_string()),
        arguments.clone(),
    ))
    .await
    .map_err(|err| err.to_string())?;

    let requires_approval = tool_result
        .get("status")
        .and_then(serde_json::Value::as_str)
        .map(|status| status == "REQUIRES_APPROVAL")
        .unwrap_or(false);
    let approval_token = if requires_approval {
        tool_result
            .get("approval_token")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    } else {
        None
    };
    let meta = serde_json::json!({
        "id": call_id,
        "name": tool_name,
        "status": if requires_approval { "requires_approval" } else { "success" },
        "result": tool_result,
    });
    let result_message = if requires_approval {
        format!(
            "Tool call '{}' requires approval before execution.",
            tool_name
        )
    } else {
        format!("Tool call '{}' executed successfully.", tool_name)
    };

    Ok(GenericMcpToolDispatchResult {
        meta,
        result_message,
        approval_token,
    })
}
