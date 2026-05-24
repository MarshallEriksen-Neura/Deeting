use std::future::Future;
use std::pin::Pin;

use serde_json::{Map, Value};

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use mcp_session::conversation::CreateConversationMessageRequest;

use super::execution_graph_store::persist_execution_graph_snapshot;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AssistantPersistenceState {
    pub assistant_message_persisted: bool,
    pub execution_graph_persisted: bool,
    pub postprocess_completed: bool,
}

impl AssistantPersistenceState {
    pub(crate) const fn pending_graph() -> Self {
        Self {
            assistant_message_persisted: true,
            execution_graph_persisted: false,
            postprocess_completed: false,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct AssistantCorePersistenceResult {
    pub turn_index: i64,
    pub assistant_meta: Option<Value>,
}

type PersistExecutionGraphFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), McpError>> + Send + 'a>>;
type PersistExecutionGraphFn = for<'a> fn(
    &'a McpStore,
    &'a Value,
    &'a str,
    Option<&'a str>,
) -> PersistExecutionGraphFuture<'a>;

pub(crate) fn assistant_persistence_state(
    meta_info: Option<&Value>,
) -> Option<AssistantPersistenceState> {
    let persistence = meta_info
        .and_then(Value::as_object)
        .and_then(|meta| meta.get("persistence"))
        .and_then(Value::as_object)?;

    Some(AssistantPersistenceState {
        assistant_message_persisted: persistence
            .get("assistant_message_persisted")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        execution_graph_persisted: persistence
            .get("execution_graph_persisted")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        postprocess_completed: persistence
            .get("postprocess_completed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

pub(crate) fn with_assistant_persistence_state(
    meta_info: Option<Value>,
    state: AssistantPersistenceState,
) -> Option<Value> {
    let mut meta = match meta_info {
        Some(Value::Object(object)) => object,
        Some(other) => return Some(other),
        None => Map::new(),
    };
    meta.insert(
        "persistence".to_string(),
        serde_json::json!({
            "assistant_message_persisted": state.assistant_message_persisted,
            "execution_graph_persisted": state.execution_graph_persisted,
            "postprocess_completed": state.postprocess_completed,
        }),
    );
    Some(Value::Object(meta))
}

pub(crate) fn mark_execution_graph_persisted(
    meta_info: Option<Value>,
    persisted: bool,
) -> Option<Value> {
    let mut state = assistant_persistence_state(meta_info.as_ref())
        .unwrap_or_else(AssistantPersistenceState::pending_graph);
    state.assistant_message_persisted = true;
    state.execution_graph_persisted = persisted;
    with_assistant_persistence_state(meta_info, state)
}

pub(crate) fn mark_postprocess_completed(
    meta_info: Option<Value>,
    completed: bool,
) -> Option<Value> {
    let mut state = assistant_persistence_state(meta_info.as_ref())
        .unwrap_or_else(AssistantPersistenceState::pending_graph);
    state.assistant_message_persisted = true;
    state.postprocess_completed = completed;
    with_assistant_persistence_state(meta_info, state)
}

fn persist_execution_graph_for_local_chat<'a>(
    store: &'a McpStore,
    execution_graph: &'a Value,
    session_id: &'a str,
    request_id: Option<&'a str>,
) -> PersistExecutionGraphFuture<'a> {
    Box::pin(async move {
        persist_execution_graph_snapshot(
            store,
            execution_graph,
            session_id,
            "desktop_local_chat",
            request_id,
            Some("completed"),
        )
        .await
    })
}

pub(crate) async fn persist_local_assistant_turn(
    store: &McpStore,
    session_id: &str,
    assistant_meta: Option<Value>,
    execution_graph: &Value,
    request_id: Option<&str>,
) -> Result<AssistantCorePersistenceResult, McpError> {
    persist_local_assistant_turn_with(
        store,
        session_id,
        assistant_meta,
        execution_graph,
        request_id,
        persist_execution_graph_for_local_chat,
    )
    .await
}

async fn persist_local_assistant_turn_with(
    store: &McpStore,
    session_id: &str,
    assistant_meta: Option<Value>,
    execution_graph: &Value,
    request_id: Option<&str>,
    persist_execution_graph: PersistExecutionGraphFn,
) -> Result<AssistantCorePersistenceResult, McpError> {
    let mut persisted_meta = with_assistant_persistence_state(
        assistant_meta,
        AssistantPersistenceState::pending_graph(),
    );
    let appended = store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: session_id.trim().to_string(),
            role: "assistant".to_string(),
            content: String::new(),
            name: None,
            meta_info: persisted_meta.clone(),
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await?;
    let turn_index = appended
        .turn_index
        .ok_or_else(|| McpError::Storage("assistant append missing turn_index".to_string()))?;

    match persist_execution_graph(store, execution_graph, session_id, request_id).await {
        Ok(()) => {
            let next_meta = mark_execution_graph_persisted(persisted_meta.clone(), true);
            match store
                .update_local_conversation_assistant_meta_info(
                    session_id,
                    turn_index,
                    next_meta.clone(),
                )
                .await
            {
                Ok(()) => {
                    persisted_meta = next_meta;
                }
                Err(err) => {
                    log::warn!(
                        "update assistant persistence after graph success failed session={} turn={} err={}",
                        session_id,
                        turn_index,
                        err
                    );
                }
            }
        }
        Err(err) => {
            log::warn!(
                "persist_execution_graph_snapshot failed session={} err={}",
                session_id,
                err
            );
        }
    }

    Ok(AssistantCorePersistenceResult {
        turn_index,
        assistant_meta: persisted_meta,
    })
}

pub(crate) async fn mark_local_assistant_postprocess_completed(
    store: &McpStore,
    session_id: &str,
    turn_index: i64,
    assistant_meta: Option<Value>,
) -> Result<Option<Value>, McpError> {
    let next_meta = mark_postprocess_completed(assistant_meta, true);
    store
        .update_local_conversation_assistant_meta_info(session_id, turn_index, next_meta.clone())
        .await?;
    Ok(next_meta)
}

#[cfg(test)]
mod tests {
    use super::{
        assistant_persistence_state, persist_local_assistant_turn_with, AssistantPersistenceState,
        PersistExecutionGraphFuture,
    };
    use crate::modules::mcp::error::McpError;
    use crate::modules::mcp::store::McpStore;
    use mcp_session::conversation::LocalConversationCreateRequest;
    use serde_json::Value;
    use uuid::Uuid;

    async fn create_test_store(name: &str) -> McpStore {
        let db_path = std::env::temp_dir().join(format!(
            "deeting-assistant-persistence-{name}-{}.db",
            Uuid::new_v4()
        ));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        let store = McpStore::new(&database_url)
            .await
            .expect("create assistant persistence test store");
        store
            .init()
            .await
            .expect("init assistant persistence test store");
        store
    }

    async fn latest_assistant_meta(store: &McpStore, session_id: &str) -> Value {
        let meta_info_text: String = sqlx::query_scalar(
            r#"
            SELECT meta_info
            FROM conversation_message
            WHERE session_id = ? AND role = 'assistant' AND is_deleted = 0
            ORDER BY turn_index DESC
            LIMIT 1
            "#,
        )
        .bind(session_id)
        .fetch_one(&store.pool)
        .await
        .expect("read latest assistant meta info");

        serde_json::from_str(&meta_info_text).expect("parse latest assistant meta info")
    }

    fn fail_persist_execution_graph<'a>(
        _store: &'a McpStore,
        _execution_graph: &'a Value,
        _session_id: &'a str,
        _request_id: Option<&'a str>,
    ) -> PersistExecutionGraphFuture<'a> {
        Box::pin(async {
            Err(McpError::Storage(
                "simulated execution graph persistence failure".to_string(),
            ))
        })
    }

    #[tokio::test]
    async fn persist_local_assistant_turn_keeps_pending_state_when_graph_write_fails() {
        let store = create_test_store("pending-graph-failure").await;
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("Assistant Pending Graph".to_string()),
            })
            .await
            .expect("create local conversation");
        let execution_graph = serde_json::json!({
            "execution_id": "assistant-pending-graph-1",
            "route": "chat",
            "phase_step_type": "direct_chat",
            "metadata": { "status": "completed" },
            "nodes": [],
            "events": []
        });

        let result = persist_local_assistant_turn_with(
            &store,
            &session.session_id,
            Some(serde_json::json!({
                "execution_graph": execution_graph.clone(),
            })),
            &execution_graph,
            None,
            fail_persist_execution_graph,
        )
        .await
        .expect("persist assistant turn");

        let state = assistant_persistence_state(result.assistant_meta.as_ref())
            .expect("assistant persistence state");
        assert_eq!(
            state,
            AssistantPersistenceState {
                assistant_message_persisted: true,
                execution_graph_persisted: false,
                postprocess_completed: false,
            }
        );

        let persisted_meta = latest_assistant_meta(&store, &session.session_id).await;
        let persisted_state =
            assistant_persistence_state(Some(&persisted_meta)).expect("persisted assistant state");
        assert_eq!(persisted_state.execution_graph_persisted, false);

        let graph_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM local_execution_graph_run WHERE execution_id = ?",
        )
        .bind("assistant-pending-graph-1")
        .fetch_one(&store.pool)
        .await
        .expect("count execution graph rows");
        assert_eq!(graph_count, 0);
    }
}
