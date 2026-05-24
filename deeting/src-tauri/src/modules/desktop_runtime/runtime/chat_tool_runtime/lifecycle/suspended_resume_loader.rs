use super::{
    list_canonical_waiting_approval_contexts, SuspendedChatToolExecution,
};
use super::suspended_persisted_execution::suspended_from_persisted_execution;
use crate::state::AppState;

pub(crate) async fn load_suspended_chat_tool_execution_for_resume(
    app_state: &AppState,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
) -> Result<Option<SuspendedChatToolExecution>, String> {
    if let Some(execution_id) = execution_graph_execution_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Some(suspended) = suspended_from_persisted_execution(app_state, execution_id).await?
        {
            return Ok(Some(suspended));
        }
    }

    let normalized_token = approval_token.trim();
    if !normalized_token.is_empty() {
        let contexts = list_canonical_waiting_approval_contexts(
            app_state.mcp.store.as_ref(),
            None,
            Some(normalized_token),
        )
        .await?;
        if let Some((execution_id, _)) = contexts.into_iter().next() {
            if let Some(suspended) =
                suspended_from_persisted_execution(app_state, execution_id.as_str()).await?
            {
                return Ok(Some(suspended));
            }
        }
    }

    Ok(None)
}
