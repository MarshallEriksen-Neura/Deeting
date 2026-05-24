use crate::modules::desktop_runtime::runtime::sovereign::Self_;
use crate::state::AppState;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct PolicyQueryToolExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_query_task_policy_tool(
    app_state: &AppState,
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> PolicyQueryToolExecutionResult {
    let query = arguments
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let decision_point = arguments
        .get("decision_point")
        .and_then(|v| v.as_str())
        .unwrap_or("route");
    let limit = arguments
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .unwrap_or(4);
    let policy_hint =
        Self_::consult_named(app_state.mcp.store.as_ref(), decision_point, query, limit)
            .await
            .as_raw()
            .clone();
    let policy_hint_value =
        serde_json::to_value(&policy_hint).unwrap_or_else(|_| serde_json::json!({}));
    PolicyQueryToolExecutionResult {
        meta: serde_json::json!({
            "id": call_id,
            "name": tool_name,
            "status": "success",
            "result": policy_hint_value,
        }),
        result_message: format!(
            "Task policy hint for '{}' at '{}':\n{}",
            query,
            decision_point,
            serde_json::to_string_pretty(&policy_hint).unwrap_or_else(|_| "{}".to_string())
        ),
    }
}
