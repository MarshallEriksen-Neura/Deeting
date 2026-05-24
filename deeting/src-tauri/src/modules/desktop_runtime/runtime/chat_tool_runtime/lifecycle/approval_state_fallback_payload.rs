use super::approval_failed_payload::build_local_chat_resume_failed_payload;

pub(super) fn build_stale_waiting_graph_fallback_payload(
    execution_id: &str,
    execution_graph: &serde_json::Value,
    fallback_error: Option<&str>,
) -> serde_json::Value {
    build_local_chat_resume_failed_payload(
        execution_id,
        None,
        None,
        &serde_json::Value::Null,
        execution_graph,
        Some(execution_id),
        "LOCAL_CHAT_APPROVAL_FALLBACK_STALE",
        fallback_error.unwrap_or(
            "approval continuation fell back to a stale waiting graph; resolved gate identity was unavailable",
        ),
        true,
    )
}

pub(super) fn build_resume_failed_fallback_payload(
    execution_id: &str,
    execution_graph: &serde_json::Value,
    continuation_blocks: Vec<serde_json::Value>,
    error: Option<&str>,
) -> serde_json::Value {
    let mut payload = build_local_chat_resume_failed_payload(
        execution_id,
        None,
        None,
        &serde_json::Value::Null,
        execution_graph,
        Some(execution_id),
        "LOCAL_CHAT_RESUME_FAILED",
        error.unwrap_or_default(),
        true,
    );
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "continuation_blocks".to_string(),
            serde_json::Value::Array(continuation_blocks),
        );
    }
    payload
}

pub(super) fn build_terminal_fallback_no_identity_payload(
    execution_id: &str,
    execution_graph: &serde_json::Value,
    fallback_error: Option<&str>,
) -> serde_json::Value {
    build_local_chat_resume_failed_payload(
        execution_id,
        None,
        None,
        &serde_json::Value::Null,
        execution_graph,
        Some(execution_id),
        "LOCAL_CHAT_RESUME_FALLBACK_NO_IDENTITY",
        fallback_error.unwrap_or(
            "approval continuation returned a terminal fallback snapshot without resolved gate identity",
        ),
        true,
    )
}
