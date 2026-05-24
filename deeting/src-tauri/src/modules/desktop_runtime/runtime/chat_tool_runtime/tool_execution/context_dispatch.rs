use super::super::context_tools::{execute_terminal_context_tool, execute_workflow_plan_tool};
use crate::modules::desktop_runtime::context_orchestrator::execute_context_tool;
use crate::state::AppState;
use tauri::AppHandle;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct ContextToolExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
}

fn success_result(
    call_id: &str,
    tool_name: &str,
    result: serde_json::Value,
    message_prefix: &str,
) -> ContextToolExecutionResult {
    let result_message = format!(
        "{}:\n{}",
        message_prefix,
        serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
    );
    ContextToolExecutionResult {
        meta: serde_json::json!({
            "id": call_id,
            "name": tool_name,
            "status": "success",
            "result": result,
        }),
        result_message,
    }
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn execute_terminal_context_runtime_tool(
    app: &AppHandle,
    terminal_context: Option<&serde_json::Value>,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<ContextToolExecutionResult, String> {
    let result = execute_terminal_context_tool(app, terminal_context, tool_name, arguments)?;
    Ok(success_result(
        call_id,
        tool_name,
        result,
        "Terminal context result",
    ))
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_workflow_plan_runtime_tool(
    app: &AppHandle,
    app_state: &AppState,
    workflow_context: Option<&serde_json::Value>,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<ContextToolExecutionResult, String> {
    let result =
        execute_workflow_plan_tool(app, app_state, workflow_context, tool_name, arguments).await?;
    Ok(success_result(
        call_id,
        tool_name,
        result,
        "Workflow plan result",
    ))
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_context_runtime_tool(
    app_state: &AppState,
    selected_knowledge_file_ids: &[String],
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<ContextToolExecutionResult, String> {
    let result =
        execute_context_tool(app_state, tool_name, arguments, selected_knowledge_file_ids).await?;
    Ok(success_result(
        call_id,
        tool_name,
        result,
        "Context tool result",
    ))
}
