use mcp_session::context::LocalConversationRuntimeWindow;
use mcp_session::conversation::{
    LocalConversationCompareFinalizeRequest, LocalConversationCompareFinalizeResponse,
};
use serde_json::Value;

use crate::modules::memory::service::MemoryService;
use crate::modules::memory::types::{LocalMemoryItem, LocalMemoryListQuery};
use crate::state::AppState;

pub(crate) async fn sync_compare_finalize_memories(
    app_state: AppState,
    payload: &LocalConversationCompareFinalizeRequest,
    response: &LocalConversationCompareFinalizeResponse,
) -> Result<(), String> {
    let deleted = clear_session_auto_extraction_memories(
        app_state.memory.service.as_ref(),
        &response.session_id,
    )
    .await?;

    let runtime_window = app_state
        .mcp
        .store
        .load_local_conversation_runtime_window(&response.session_id)
        .await
        .map_err(|err| err.to_string())?;

    let Some(provider_model_id) = resolve_finalize_provider_model_id(payload, response) else {
        log::warn!(
            "compare finalize fact rebuild skipped for session {}: provider_model_id missing",
            response.session_id
        );
        return Ok(());
    };

    let Some(conversation_text) = build_fact_rebuild_conversation_text(&runtime_window) else {
        log::warn!(
            "compare finalize fact rebuild skipped for session {}: empty canonical conversation",
            response.session_id
        );
        return Ok(());
    };

    log::info!(
        "compare finalize cleared {} auto-extracted memories for session {} before rebuilding facts",
        deleted,
        response.session_id
    );

    let fact_app_state = app_state.clone();
    let fact_memory_service = app_state.memory.service.clone();
    let fact_session_id = response.session_id.clone();
    let fact_assistant_id = runtime_window.assistant_id.clone();
    let fact_provider_model_id = provider_model_id;
    let fact_model_id = payload.model_id.clone();

    tauri::async_runtime::spawn(async move {
        crate::modules::memory::fact_extractor::extract_and_store_facts(
            &fact_app_state,
            fact_memory_service,
            &fact_provider_model_id,
            &fact_model_id,
            &conversation_text,
            &fact_session_id,
            fact_assistant_id.as_deref(),
        )
        .await;
    });

    Ok(())
}

pub(crate) async fn clear_session_auto_extraction_memories(
    memory_service: &MemoryService,
    session_id: &str,
) -> Result<usize, String> {
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Ok(0);
    }

    let mut deleted = 0usize;
    let mut cursor = None;
    loop {
        let page = memory_service
            .list(LocalMemoryListQuery {
                cursor: cursor.clone(),
                limit: Some(200),
                session_id: Some(normalized_session_id.to_string()),
                capability_id: None,
            })
            .await
            .map_err(|err| err.to_string())?;

        for item in &page.items {
            if !is_auto_extracted_memory(item) {
                continue;
            }
            let removed = memory_service
                .delete(&item.id)
                .await
                .map_err(|err| err.to_string())?;
            if removed {
                deleted += 1;
            }
        }

        if !page.has_more {
            break;
        }
        cursor = page.next_cursor;
    }

    Ok(deleted)
}

fn is_auto_extracted_memory(item: &LocalMemoryItem) -> bool {
    item.source
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("auto_extraction"))
        .unwrap_or(false)
        || item
            .meta_info
            .as_ref()
            .and_then(|value| value.get("source"))
            .and_then(|value| value.as_str())
            .map(|value| value.eq_ignore_ascii_case("auto_extraction"))
            .unwrap_or(false)
}

fn resolve_finalize_provider_model_id(
    payload: &LocalConversationCompareFinalizeRequest,
    response: &LocalConversationCompareFinalizeResponse,
) -> Option<String> {
    normalize_optional_string(payload.provider_model_id.as_deref()).or_else(|| {
        response
            .message
            .meta_info
            .as_ref()
            .and_then(|value| value.get("provider_model_id"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn build_fact_rebuild_conversation_text(
    runtime_window: &LocalConversationRuntimeWindow,
) -> Option<String> {
    let mut sections = Vec::new();
    if let Some(summary_text) = extract_summary_text(runtime_window.summary.as_ref()) {
        sections.push(format!("Summary: {}", summary_text));
    }

    for message in &runtime_window.messages {
        let Some(content) = history_message_text(message.content.as_ref()) else {
            continue;
        };
        let role = match message.role.trim().to_ascii_lowercase().as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            "system" => "System",
            _ => "Message",
        };
        sections.push(format!("{}: {}", role, content));
    }

    let conversation = sections.join("\n").trim().to_string();
    if conversation.is_empty() {
        None
    } else {
        Some(conversation)
    }
}

fn extract_summary_text(summary: Option<&Value>) -> Option<String> {
    summary
        .and_then(|value| value.get("summary_text"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn history_message_text(content: Option<&Value>) -> Option<String> {
    content
        .and_then(|value| {
            if let Some(text) = value.as_str() {
                Some(text.to_string())
            } else {
                serde_json::to_string(value).ok()
            }
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

#[cfg(test)]
mod tests {
    use super::{
        build_fact_rebuild_conversation_text, clear_session_auto_extraction_memories,
    };
    use crate::modules::memory::types::{CreateLocalMemoryRequest, LocalMemoryListQuery};
    use mcp_session::context::LocalConversationRuntimeWindow;
    use mcp_session::conversation::LocalConversationHistoryMessage;
    use serde_json::json;
    use uuid::Uuid;

    async fn create_test_memory_state(test_name: &str) -> crate::modules::memory::MemoryState {
        let mut lancedb_path = std::env::temp_dir();
        lancedb_path.push(format!(
            "deeting-tauri-conversation-fact-sync-{test_name}-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&lancedb_path).expect("create lancedb dir");
        let lancedb_uri = lancedb_path.to_string_lossy().replace('\\', "/");
        crate::modules::memory::MemoryState::new(&lancedb_uri)
            .await
            .expect("create test memory state")
    }

    #[tokio::test]
    async fn clear_session_auto_extraction_memories_pages_and_preserves_manual_rows() {
        let memory_state = create_test_memory_state("compare-finalize-cleanup").await;
        let session_id = "session-compare-finalize";

        for index in 0..35 {
            memory_state
                .service
                .append(CreateLocalMemoryRequest {
                    content: format!("auto fact {index}"),
                    session_id: Some(session_id.to_string()),
                    capability_id: None,
                    meta_info: Some(json!({ "source": "auto_extraction" })),
                    category: Some("fact".to_string()),
                    source: Some("auto_extraction".to_string()),
                    tags: None,
                })
                .await
                .expect("append auto-extracted memory");
        }

        for index in 0..2 {
            memory_state
                .service
                .append(CreateLocalMemoryRequest {
                    content: format!("manual note {index}"),
                    session_id: Some(session_id.to_string()),
                    capability_id: None,
                    meta_info: Some(json!({ "source": "manual" })),
                    category: Some("note".to_string()),
                    source: Some("manual".to_string()),
                    tags: None,
                })
                .await
                .expect("append manual memory");
        }

        let deleted =
            clear_session_auto_extraction_memories(memory_state.service.as_ref(), session_id)
                .await
                .expect("clear auto-extracted memories");

        assert_eq!(deleted, 35);

        let remaining = memory_state
            .service
            .list(LocalMemoryListQuery {
                cursor: None,
                limit: Some(100),
                session_id: Some(session_id.to_string()),
                capability_id: None,
            })
            .await
            .expect("list remaining memories");

        assert_eq!(remaining.items.len(), 2);
        assert!(remaining
            .items
            .iter()
            .all(|item| item.source.as_deref() == Some("manual")));
    }

    #[test]
    fn build_fact_rebuild_conversation_text_uses_summary_and_canonical_messages() {
        let runtime_window = LocalConversationRuntimeWindow {
            session_id: "session-1".to_string(),
            assistant_id: Some("assistant-1".to_string()),
            meta: None,
            summary: Some(json!({ "summary_text": "User is building desktop compare mode." })),
            messages: vec![
                LocalConversationHistoryMessage {
                    role: "user".to_string(),
                    content: Some(json!("Please compare these answers.")),
                    turn_index: Some(1),
                    created_at: None,
                    is_truncated: Some(false),
                    name: None,
                    meta_info: None,
                },
                LocalConversationHistoryMessage {
                    role: "assistant".to_string(),
                    content: Some(json!("Winner answer kept in canonical history.")),
                    turn_index: Some(2),
                    created_at: None,
                    is_truncated: Some(false),
                    name: None,
                    meta_info: None,
                },
            ],
        };

        let conversation = build_fact_rebuild_conversation_text(&runtime_window)
            .expect("build fact rebuild conversation");

        assert!(conversation.contains("Summary: User is building desktop compare mode."));
        assert!(conversation.contains("User: Please compare these answers."));
        assert!(conversation.contains("Assistant: Winner answer kept in canonical history."));
    }
}
