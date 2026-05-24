use super::approval_graph::pending_approval_gate_ids_from_graph;
use super::build_persisted_resume_assistant_meta;
use crate::modules::mcp::commands::common_impl::LocalModelConnection;
use crate::state::AppState;
use mcp_session::conversation::CreateConversationMessageRequest;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) async fn persist_resumed_local_chat_assistant_message(
    app_state: &AppState,
    session_id: &str,
    model_connection: &LocalModelConnection,
    resumed_response: &serde_json::Value,
) -> Result<(), String> {
    if resumed_response
        .get("execution_graph")
        .is_some_and(|execution_graph| {
            !pending_approval_gate_ids_from_graph(execution_graph).is_empty()
        })
    {
        return Err(format!(
            "chat step=append_resumed_assistant_message blocked because execution_graph still has pending approval gates session={} ",
            session_id
        ));
    }

    let assistant_meta = build_persisted_resume_assistant_meta(resumed_response, model_connection);

    app_state
        .mcp
        .store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: session_id.to_string(),
            role: "assistant".to_string(),
            content: String::new(),
            name: None,
            meta_info: Some(assistant_meta),
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map(|_| ())
        .map_err(|err| {
            format!(
                "chat step=append_resumed_assistant_message session={} err={}",
                session_id, err
            )
        })?;

    let latest_turn_index = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COALESCE(MAX(turn_index), 0)
        FROM conversation_message
        WHERE session_id = ? AND is_deleted = 0;
        "#,
    )
    .bind(session_id)
    .fetch_one(&app_state.mcp.store.pool)
    .await
    .map_err(|err| {
        format!(
            "chat step=read_latest_turn_after_resumed_assistant_message session={} err={}",
            session_id, err
        )
    })?;

    if latest_turn_index > 0 {
        if let Err(err) = app_state
            .mcp
            .store
            .soft_delete_stale_pending_approval_assistant_messages_before_turn(
                session_id,
                latest_turn_index,
            )
            .await
        {
            log::warn!(
                "soft_delete_stale_pending_approval_assistant_messages_before_turn failed session={} turn={} err={}",
                session_id,
                latest_turn_index,
                err
            );
        }
    }

    if let Some(execution_graph) = resumed_response.get("execution_graph") {
        if let Err(err) =
            crate::modules::desktop_runtime::runtime::persist_execution_graph_snapshot(
                app_state.mcp.store.as_ref(),
                execution_graph,
                session_id,
                "desktop_local_chat_resume",
                None,
                Some("completed"),
            )
            .await
        {
            log::warn!(
                "persist_execution_graph_snapshot failed session={} err={}",
                session_id,
                err
            );
        }
    }

    Ok(())
}
