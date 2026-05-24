use super::super::streaming::{build_runtime_bridge_stream_target, LocalRealtimeToolTraceEmitter};
use crate::modules::code_mode::types::ExecuteLocalCodemodeRequest;
use crate::modules::desktop_runtime::runtime::sovereign::{DecisionLocus, PolicyGuidance, Self_};
use crate::state::AppState;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn consult_task_policy_guidance(
    app_state: &AppState,
    task_query: Option<&str>,
    locus: DecisionLocus,
) -> Option<PolicyGuidance> {
    let query = task_query
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(Self_::consult(app_state.mcp.store.as_ref(), locus, query, 4).await)
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn execute_code_mode_request(
    app_state: &AppState,
    request: ExecuteLocalCodemodeRequest,
    realtime_emitter: &LocalRealtimeToolTraceEmitter,
) -> Result<crate::modules::code_mode::types::ExecuteLocalCodemodeResponse, String> {
    Box::pin(
        crate::modules::code_mode::commands::execute_local_code_mode_inner(
            app_state,
            request,
            build_runtime_bridge_stream_target(realtime_emitter),
        ),
    )
    .await
    .map_err(|err| err.to_string())
}
