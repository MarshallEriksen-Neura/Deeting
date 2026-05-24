use super::now_unix_ms_i64;
use super::recovery_prompt_lookup::{
    find_recovery_message_turn_and_meta, recovery_message_exists,
};
use super::recovery_prompt_meta::recovery_assistant_meta;
use mcp_session::conversation::CreateConversationMessageRequest;

pub(super) async fn resolve_recovery_prompt_message(
    store: &crate::modules::mcp::store::McpStore,
    session_id: &str,
    execution_id: &str,
    action: &str,
) -> Result<(), String> {
    let Some((turn_index, mut meta_info)) =
        find_recovery_message_turn_and_meta(store, session_id, execution_id).await?
    else {
        return Ok(());
    };

    let Some(recovery) = meta_info
        .get_mut("recovery")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return Ok(());
    };

    recovery.insert(
        "available_actions".to_string(),
        serde_json::Value::Array(Vec::new()),
    );
    recovery.insert(
        "resolved_action".to_string(),
        serde_json::Value::String(action.to_string()),
    );
    recovery.insert(
        "resolved_at_unix_ms".to_string(),
        serde_json::json!(now_unix_ms_i64()),
    );

    store
        .update_local_conversation_assistant_meta_info(session_id, turn_index, Some(meta_info))
        .await
        .map_err(|err| err.to_string())
}

pub(super) async fn append_recovery_assistant_message_if_missing(
    store: &crate::modules::mcp::store::McpStore,
    session_id: &str,
    execution_graph: &serde_json::Value,
    execution_id: &str,
    stage: &str,
    content: &str,
    available_actions: &[&str],
) -> Result<(), String> {
    if recovery_message_exists(store, session_id, execution_id).await? {
        return Ok(());
    }
    store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: session_id.to_string(),
            role: "assistant".to_string(),
            content: content.to_string(),
            name: None,
            meta_info: recovery_assistant_meta(
                execution_graph,
                execution_id,
                stage,
                available_actions,
            ),
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}
