use sqlx::Row;

pub(super) async fn recovery_message_exists(
    store: &crate::modules::mcp::store::McpStore,
    session_id: &str,
    execution_id: &str,
) -> Result<bool, String> {
    let count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM conversation_message
        WHERE session_id = ?
          AND role = 'assistant'
          AND is_deleted = 0
          AND (
            json_extract(meta_info, '$.recovery.execution_id') = ?
            OR json_extract(meta_info, '$.execution_graph.execution_id') = ?
          )
        "#,
    )
    .bind(session_id)
    .bind(execution_id)
    .bind(execution_id)
    .fetch_one(&store.pool)
    .await
    .map_err(|err| err.to_string())?;
    Ok(count > 0)
}

pub(super) async fn find_recovery_message_turn_and_meta(
    store: &crate::modules::mcp::store::McpStore,
    session_id: &str,
    execution_id: &str,
) -> Result<Option<(i64, serde_json::Value)>, String> {
    let row = sqlx::query(
        r#"
        SELECT turn_index, meta_info
        FROM conversation_message
        WHERE session_id = ?
          AND role = 'assistant'
          AND is_deleted = 0
          AND json_extract(meta_info, '$.recovery.execution_id') = ?
        ORDER BY turn_index DESC
        LIMIT 1
        "#,
    )
    .bind(session_id)
    .bind(execution_id)
    .fetch_optional(&store.pool)
    .await
    .map_err(|err| err.to_string())?;

    let Some(row) = row else {
        return Ok(None);
    };
    let turn_index: i64 = row.try_get("turn_index").map_err(|err| err.to_string())?;
    let meta_info_text: Option<String> = row.try_get("meta_info").map_err(|err| err.to_string())?;
    let Some(meta_info_text) = meta_info_text else {
        return Ok(None);
    };
    let meta_info = serde_json::from_str::<serde_json::Value>(&meta_info_text)
        .map_err(|err| err.to_string())?;
    Ok(Some((turn_index, meta_info)))
}
