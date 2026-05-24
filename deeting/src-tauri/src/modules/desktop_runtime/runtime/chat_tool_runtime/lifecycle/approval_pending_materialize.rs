use super::approval_runtime_lookup::find_canonical_pending_local_approval_match;
use super::{
    collect_waiting_approval_tokens_from_graph, pending_tool_call_from_persisted_approval,
};
use crate::modules::desktop_runtime::runtime::load_execution_graph_snapshot;
use crate::state::AppState;

pub(crate) async fn materialize_pending_local_approval_from_runtime_context(
    app_state: &AppState,
    approval_token: &str,
    execution_graph_execution_id: Option<&str>,
) -> Result<Option<crate::modules::mcp::PendingToolCall>, String> {
    let normalized_token = approval_token.trim();
    if normalized_token.is_empty() {
        return Ok(None);
    }

    let Some(matched) = find_canonical_pending_local_approval_match(
        app_state.mcp.store.as_ref(),
        normalized_token,
        execution_graph_execution_id,
    )
    .await?
    else {
        return Ok(None);
    };

    let graph_snapshot =
        load_execution_graph_snapshot(app_state.mcp.store.as_ref(), matched.execution_id.as_str())
            .await
            .map_err(|err| err.to_string())?;
    let graph_says_waiting = graph_snapshot
        .as_ref()
        .map(|graph| collect_waiting_approval_tokens_from_graph(graph).contains(normalized_token))
        .unwrap_or(false);
    if !graph_says_waiting {
        log::warn!(
            "materialize_skipped_graph_not_waiting approval_token={} execution_id={}",
            normalized_token,
            matched.execution_id,
        );
        return Ok(None);
    }

    let expires_at_unix_ms =
        (super::now_unix_ms_i64() as i128) + app_state.mcp.pending_tool_call_ttl_ms();
    Ok(Some(pending_tool_call_from_persisted_approval(
        &matched.pending,
        Some(matched.execution_id.as_str()),
        expires_at_unix_ms,
    )))
}
