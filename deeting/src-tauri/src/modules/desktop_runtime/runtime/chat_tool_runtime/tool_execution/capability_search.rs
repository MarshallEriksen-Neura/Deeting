use super::super::runtime_state::LocalChatToolRuntimeState;
use crate::modules::desktop_runtime::runtime::{
    build_local_sdk_search_result_bundle_with_feedback_runtime, search_feedback,
};
use crate::state::AppState;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct CapabilitySearchToolExecutionResult
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) meta: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) result_message: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) full_payload:
        serde_json::Value,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_search_sdk_tool(
    app_state: &AppState,
    state: &LocalChatToolRuntimeState,
    feedback_tool_call_meta: &[serde_json::Value],
    call_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> CapabilitySearchToolExecutionResult {
    let query = arguments
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let limit = arguments
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .unwrap_or(8);
    let feedback_context =
        search_feedback::search_feedback_context_from_tool_call_meta(feedback_tool_call_meta);
    let search_bundle = build_local_sdk_search_result_bundle_with_feedback_runtime(
        app_state.mcp.store.as_ref(),
        &app_state.providers.embedding,
        app_state.memory.service.as_ref(),
        query,
        limit,
        &feedback_context,
    )
    .await;
    let search_res = search_bundle.summary_payload;
    let result_message = format!(
        "SDK Search Result for '{}':\n{}",
        query,
        serde_json::to_string_pretty(&search_res).unwrap()
    );
    CapabilitySearchToolExecutionResult {
        meta: serde_json::json!({
            "id": call_id,
            "name": tool_name,
            "status": "success",
            "result": search_res,
            "observation_patch": [{
                "text": format!("searched SDK index for '{query}' (limit {limit})"),
                "structured": {
                    "query": query,
                    "limit": limit,
                },
            }],
        }),
        result_message,
        full_payload: search_bundle.full_payload,
    }
}
