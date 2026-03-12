use super::{run_policy_scoped_chat_completion, LocalExecutionOutcome, LocalExecutionRequest};
use crate::modules::mcp::commands::runtime::control_plane::LocalExecutionPlane;
use serde_json::Value;

pub(super) async fn run_direct_execution_handler<F>(
    request: LocalExecutionRequest,
    emit_status: &mut F,
) -> Result<LocalExecutionOutcome, String>
where
    F: FnMut(&str, Option<&str>, &str, &str, Option<Value>),
{
    debug_assert_eq!(
        request.execution_policy.plane,
        LocalExecutionPlane::ResponseOnly
    );
    run_policy_scoped_chat_completion(request, None, emit_status).await
}