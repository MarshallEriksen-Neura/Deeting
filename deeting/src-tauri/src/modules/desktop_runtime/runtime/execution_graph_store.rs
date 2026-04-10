use super::assistant_persistence::{assistant_persistence_state, mark_execution_graph_persisted};
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use sqlx::Row;

pub(crate) const DESKTOP_EXECUTION_GRAPH_SCHEMA_VERSION_KEY: &str =
    "desktop.runtime.execution_graph.schema_version";
pub(crate) const DESKTOP_EXECUTION_GRAPH_BOOTSTRAP_KEY: &str =
    "desktop.runtime.execution_graph.bootstrap_state";
const DESKTOP_EXECUTION_GRAPH_SCHEMA_VERSION: &str = "2";
const DESKTOP_EXECUTION_GRAPH_BOOTSTRAP_DONE: &str = "done:v2";

#[derive(Debug, Clone)]
pub(crate) struct ExecutionGraphRuntimeContextRow {
    pub(crate) execution_id: String,
    pub(crate) context: serde_json::Value,
}

pub(crate) async fn init_execution_graph_tables(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS local_execution_graph_run (
          execution_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          route TEXT NOT NULL,
          plane TEXT NOT NULL,
          status TEXT NOT NULL,
          root_execution_id TEXT,
          request_id TEXT,
          source_kind TEXT NOT NULL DEFAULT 'desktop_local_chat',
          graph_payload_json TEXT NOT NULL,
          created_at_unix_ms INTEGER NOT NULL,
          updated_at_unix_ms INTEGER NOT NULL
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS local_execution_graph_node (
          execution_id TEXT NOT NULL,
          node_id TEXT NOT NULL,
          node_type TEXT NOT NULL,
          status TEXT NOT NULL,
          dependency_ids_json TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          input_payload_json TEXT,
          output_payload_json TEXT,
          created_at_unix_ms INTEGER NOT NULL,
          updated_at_unix_ms INTEGER NOT NULL,
          PRIMARY KEY (execution_id, node_id),
          FOREIGN KEY (execution_id) REFERENCES local_execution_graph_run(execution_id)
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS local_execution_graph_event (
          execution_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          node_id TEXT,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at_unix_ms INTEGER NOT NULL,
          PRIMARY KEY (execution_id, event_id),
          FOREIGN KEY (execution_id) REFERENCES local_execution_graph_run(execution_id)
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS local_execution_graph_runtime_context (
          execution_id TEXT PRIMARY KEY,
          context_json TEXT NOT NULL,
          updated_at_unix_ms INTEGER NOT NULL,
          FOREIGN KEY (execution_id) REFERENCES local_execution_graph_run(execution_id)
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    for statement in [
        "CREATE INDEX IF NOT EXISTS idx_local_execution_graph_run_session_id ON local_execution_graph_run(session_id)",
        "CREATE INDEX IF NOT EXISTS idx_local_execution_graph_run_updated_at ON local_execution_graph_run(updated_at_unix_ms)",
        "CREATE INDEX IF NOT EXISTS idx_local_execution_graph_node_status ON local_execution_graph_node(status)",
        "CREATE INDEX IF NOT EXISTS idx_local_execution_graph_event_node_id ON local_execution_graph_event(node_id)",
        "CREATE INDEX IF NOT EXISTS idx_local_execution_graph_event_created_at ON local_execution_graph_event(created_at_unix_ms)",
        "CREATE INDEX IF NOT EXISTS idx_local_execution_graph_runtime_context_updated_at ON local_execution_graph_runtime_context(updated_at_unix_ms)",
    ] {
        sqlx::query(statement)
            .execute(&store.write_pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
    }

    Ok(())
}

pub(crate) async fn migrate_execution_graph_runtime_bootstrap(
    store: &McpStore,
) -> Result<(), McpError> {
    init_execution_graph_tables(store).await?;

    let already_bootstrapped = store
        .get_desktop_config(DESKTOP_EXECUTION_GRAPH_BOOTSTRAP_KEY)
        .await?
        .as_deref()
        == Some(DESKTOP_EXECUTION_GRAPH_BOOTSTRAP_DONE);
    if !already_bootstrapped {
        backfill_execution_graph_history_from_conversation_messages(store).await?;

        store
            .set_desktop_config(
                DESKTOP_EXECUTION_GRAPH_SCHEMA_VERSION_KEY,
                DESKTOP_EXECUTION_GRAPH_SCHEMA_VERSION,
            )
            .await?;
        store
            .set_desktop_config(
                DESKTOP_EXECUTION_GRAPH_BOOTSTRAP_KEY,
                DESKTOP_EXECUTION_GRAPH_BOOTSTRAP_DONE,
            )
            .await?;
    }

    repair_pending_execution_graph_persistence(store).await?;

    Ok(())
}

async fn backfill_execution_graph_history_from_conversation_messages(
    store: &McpStore,
) -> Result<(), McpError> {
    let rows = sqlx::query(
        r#"
        SELECT session_id, meta_info
        FROM conversation_message
        WHERE role = 'assistant'
          AND meta_info IS NOT NULL
          AND json_extract(meta_info, '$.execution_graph.execution_id') IS NOT NULL
        ORDER BY created_at ASC, turn_index ASC
        "#,
    )
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    for row in rows {
        let session_id = row
            .try_get::<String, _>("session_id")
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let meta_info_text = row
            .try_get::<String, _>("meta_info")
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let meta_info: serde_json::Value = match serde_json::from_str(&meta_info_text) {
            Ok(value) => value,
            Err(err) => {
                log::warn!(
                    "execution graph bootstrap skipped malformed conversation meta session={} err={}",
                    session_id,
                    err
                );
                continue;
            }
        };
        let Some(execution_graph) = meta_info.get("execution_graph") else {
            continue;
        };
        if let Err(err) = persist_execution_graph_snapshot(
            store,
            execution_graph,
            session_id.as_str(),
            "desktop_local_chat_history_backfill",
            None,
            None,
        )
        .await
        {
            log::warn!(
                "execution graph history backfill failed session={} err={}",
                session_id,
                err
            );
        }
    }

    Ok(())
}

async fn repair_pending_execution_graph_persistence(store: &McpStore) -> Result<(), McpError> {
    let rows = sqlx::query(
        r#"
        SELECT session_id, turn_index, meta_info
        FROM conversation_message
        WHERE role = 'assistant'
          AND is_deleted = 0
          AND meta_info IS NOT NULL
          AND json_extract(meta_info, '$.execution_graph.execution_id') IS NOT NULL
          AND json_extract(meta_info, '$.persistence.assistant_message_persisted') = 1
          AND COALESCE(json_extract(meta_info, '$.persistence.execution_graph_persisted'), 0) = 0
        ORDER BY created_at ASC, turn_index ASC
        "#,
    )
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    for row in rows {
        let session_id = row
            .try_get::<String, _>("session_id")
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let turn_index = row
            .try_get::<i64, _>("turn_index")
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let meta_info_text = row
            .try_get::<String, _>("meta_info")
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let meta_info: serde_json::Value = match serde_json::from_str(&meta_info_text) {
            Ok(value) => value,
            Err(err) => {
                log::warn!(
                    "execution graph pending repair skipped malformed conversation meta session={} turn={} err={}",
                    session_id,
                    turn_index,
                    err
                );
                continue;
            }
        };
        let Some(state) = assistant_persistence_state(Some(&meta_info)) else {
            continue;
        };
        if !state.assistant_message_persisted || state.execution_graph_persisted {
            continue;
        }
        let Some(execution_graph) = meta_info.get("execution_graph") else {
            continue;
        };

        if let Err(err) = persist_execution_graph_snapshot(
            store,
            execution_graph,
            session_id.as_str(),
            "desktop_local_chat_pending_repair",
            None,
            None,
        )
        .await
        {
            log::warn!(
                "execution graph pending repair failed session={} turn={} err={}",
                session_id,
                turn_index,
                err
            );
            continue;
        }

        let repaired_meta = mark_execution_graph_persisted(Some(meta_info.clone()), true);
        if let Err(err) = store
            .update_local_conversation_assistant_meta_info(
                session_id.as_str(),
                turn_index,
                repaired_meta,
            )
            .await
        {
            log::warn!(
                "execution graph pending repair meta update failed session={} turn={} err={}",
                session_id,
                turn_index,
                err
            );
        }
    }

    Ok(())
}

pub(crate) async fn persist_execution_graph_snapshot(
    store: &McpStore,
    execution_graph: &serde_json::Value,
    session_id: &str,
    source_kind: &str,
    request_id: Option<&str>,
    status: Option<&str>,
) -> Result<(), McpError> {
    let execution_id = execution_graph
        .get("execution_id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| McpError::validation("execution_graph.execution_id is required"))?
        .to_string();
    let route = execution_graph
        .get("route")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let plane = execution_graph
        .get("plane")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let root_execution_id = execution_graph
        .get("root_execution_id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let graph_status = status
        .map(str::to_string)
        .or_else(|| {
            execution_graph
                .get("metadata")
                .and_then(|value| value.get("status"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| "active".to_string());
    let nodes = execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let events = execution_graph
        .get("events")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let graph_payload_json =
        serde_json::to_string(execution_graph).map_err(|err| McpError::Storage(err.to_string()))?;

    let mut tx = store.begin_write().await?;
    sqlx::query(
        r#"
        INSERT INTO local_execution_graph_run (
          execution_id, session_id, route, plane, status, root_execution_id,
          request_id, source_kind, graph_payload_json, created_at_unix_ms, updated_at_unix_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(execution_id) DO UPDATE SET
          session_id = excluded.session_id,
          route = excluded.route,
          plane = excluded.plane,
          status = excluded.status,
          root_execution_id = excluded.root_execution_id,
          request_id = excluded.request_id,
          source_kind = excluded.source_kind,
          graph_payload_json = excluded.graph_payload_json,
          updated_at_unix_ms = excluded.updated_at_unix_ms
        "#,
    )
    .bind(&execution_id)
    .bind(session_id.trim())
    .bind(&route)
    .bind(&plane)
    .bind(&graph_status)
    .bind(root_execution_id)
    .bind(request_id.map(str::trim).filter(|value| !value.is_empty()))
    .bind(source_kind.trim())
    .bind(&graph_payload_json)
    .bind(now as i64)
    .bind(now as i64)
    .execute(&mut *tx)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query("DELETE FROM local_execution_graph_node WHERE execution_id = ?")
        .bind(&execution_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    sqlx::query("DELETE FROM local_execution_graph_event WHERE execution_id = ?")
        .bind(&execution_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

    for node in nodes {
        let node_id = node
            .get("node_id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| McpError::validation("execution_graph.nodes[].node_id is required"))?;
        let node_type = node
            .get("node_type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown");
        let node_status = node
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown");
        let dependency_ids_json = serde_json::to_string(
            &node
                .get("dependency_ids")
                .cloned()
                .unwrap_or_else(|| serde_json::json!([])),
        )
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let metadata_json = serde_json::to_string(
            &node
                .get("metadata")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({})),
        )
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let input_payload_json = node
            .get("input_payload")
            .map(serde_json::to_string)
            .transpose()
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let output_payload_json = node
            .get("output_payload")
            .map(serde_json::to_string)
            .transpose()
            .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            INSERT INTO local_execution_graph_node (
              execution_id, node_id, node_type, status, dependency_ids_json, metadata_json,
              input_payload_json, output_payload_json, created_at_unix_ms, updated_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&execution_id)
        .bind(node_id)
        .bind(node_type)
        .bind(node_status)
        .bind(dependency_ids_json)
        .bind(metadata_json)
        .bind(input_payload_json)
        .bind(output_payload_json)
        .bind(now as i64)
        .bind(now as i64)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    }

    for event in events {
        let event_id = event
            .get("event_id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| McpError::validation("execution_graph.events[].event_id is required"))?;
        let event_type = event
            .get("event_type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown");
        let node_id = event
            .get("node_id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let payload_json = serde_json::to_string(
            &event
                .get("payload")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({})),
        )
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            INSERT INTO local_execution_graph_event (
              execution_id, event_id, node_id, event_type, payload_json, created_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&execution_id)
        .bind(event_id)
        .bind(node_id)
        .bind(event_type)
        .bind(payload_json)
        .bind(now as i64)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(())
}

pub(crate) async fn load_execution_graph_snapshot(
    store: &McpStore,
    execution_id: &str,
) -> Result<Option<serde_json::Value>, McpError> {
    let normalized_execution_id = execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Ok(None);
    }
    let row = sqlx::query(
        "SELECT graph_payload_json FROM local_execution_graph_run WHERE execution_id = ? LIMIT 1",
    )
    .bind(normalized_execution_id)
    .fetch_optional(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    let Some(row) = row else {
        return Ok(None);
    };
    let payload_json = row
        .try_get::<String, _>("graph_payload_json")
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let payload =
        serde_json::from_str(&payload_json).map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(Some(payload))
}

pub(crate) async fn load_execution_graph_snapshot_by_approval_token(
    store: &McpStore,
    approval_token: &str,
) -> Result<Option<serde_json::Value>, McpError> {
    let normalized_approval_token = approval_token.trim();
    if normalized_approval_token.is_empty() {
        return Ok(None);
    }
    let like_pattern = format!("%{}%", normalized_approval_token);
    let rows = sqlx::query(
        r#"
        SELECT graph_payload_json
        FROM local_execution_graph_run
        WHERE graph_payload_json LIKE ?
        ORDER BY updated_at_unix_ms DESC
        LIMIT 20
        "#,
    )
    .bind(like_pattern)
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    for row in rows {
        let payload_json = row
            .try_get::<String, _>("graph_payload_json")
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let payload: serde_json::Value = serde_json::from_str(&payload_json)
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let matches = payload
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .map(|nodes| {
                nodes.iter().any(|node| {
                    node.get("node_type").and_then(serde_json::Value::as_str)
                        == Some("approval_gate")
                        && node
                            .get("metadata")
                            .and_then(|value| value.get("approval_token"))
                            .and_then(serde_json::Value::as_str)
                            .map(str::trim)
                            == Some(normalized_approval_token)
                })
            })
            .unwrap_or(false);
        if matches {
            return Ok(Some(payload));
        }
    }

    Ok(None)
}

pub(crate) async fn persist_execution_graph_runtime_context(
    store: &McpStore,
    execution_id: &str,
    context: &serde_json::Value,
) -> Result<(), McpError> {
    let normalized_execution_id = execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Err(McpError::validation("execution_id is required"));
    }
    let context_json =
        serde_json::to_string(context).map_err(|err| McpError::Storage(err.to_string()))?;
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    sqlx::query(
        r#"
        INSERT INTO local_execution_graph_runtime_context (
          execution_id, context_json, updated_at_unix_ms
        ) VALUES (?, ?, ?)
        ON CONFLICT(execution_id) DO UPDATE SET
          context_json = excluded.context_json,
          updated_at_unix_ms = excluded.updated_at_unix_ms
        "#,
    )
    .bind(normalized_execution_id)
    .bind(context_json)
    .bind(now as i64)
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(())
}

pub(crate) async fn load_execution_graph_runtime_context(
    store: &McpStore,
    execution_id: &str,
) -> Result<Option<serde_json::Value>, McpError> {
    let normalized_execution_id = execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Ok(None);
    }
    let row = sqlx::query(
        "SELECT context_json FROM local_execution_graph_runtime_context WHERE execution_id = ? LIMIT 1",
    )
    .bind(normalized_execution_id)
    .fetch_optional(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    let Some(row) = row else {
        return Ok(None);
    };
    let context_json = row
        .try_get::<String, _>("context_json")
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let context =
        serde_json::from_str(&context_json).map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(Some(context))
}

pub(crate) async fn delete_execution_graph_runtime_context(
    store: &McpStore,
    execution_id: &str,
) -> Result<(), McpError> {
    let normalized_execution_id = execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Ok(());
    }
    sqlx::query("DELETE FROM local_execution_graph_runtime_context WHERE execution_id = ?")
        .bind(normalized_execution_id)
        .execute(&store.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(())
}

pub(crate) async fn list_execution_graph_runtime_contexts(
    store: &McpStore,
) -> Result<Vec<ExecutionGraphRuntimeContextRow>, McpError> {
    let rows = sqlx::query(
        r#"
        SELECT execution_id, context_json, updated_at_unix_ms
        FROM local_execution_graph_runtime_context
        ORDER BY updated_at_unix_ms DESC
        "#,
    )
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    rows.into_iter()
        .map(|row| {
            let execution_id = row
                .try_get::<String, _>("execution_id")
                .map_err(|err| McpError::Storage(err.to_string()))?;
            let context_json = row
                .try_get::<String, _>("context_json")
                .map_err(|err| McpError::Storage(err.to_string()))?;
            let context = serde_json::from_str(&context_json)
                .map_err(|err| McpError::Storage(err.to_string()))?;
            Ok(ExecutionGraphRuntimeContextRow {
                execution_id,
                context,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        delete_execution_graph_runtime_context, load_execution_graph_snapshot,
        migrate_execution_graph_runtime_bootstrap, persist_execution_graph_runtime_context,
    };
    use crate::modules::desktop_runtime::runtime::assistant_persistence::assistant_persistence_state;
    use crate::modules::mcp::store::McpStore;
    use mcp_session::conversation::{
        CreateConversationMessageRequest, LocalConversationCreateRequest,
    };
    use sqlx::Row;
    use uuid::Uuid;

    async fn create_test_store(name: &str) -> McpStore {
        let db_path = std::env::temp_dir().join(format!("deeting-{name}-{}.db", Uuid::new_v4()));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        McpStore::new(&database_url)
            .await
            .expect("test store should be created")
    }

    #[tokio::test]
    async fn bootstrap_backfills_execution_graphs_from_conversation_history() {
        let store = create_test_store("execution-graph-bootstrap-backfill").await;
        store.init().await.expect("init store");
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("execution graph backfill".to_string()),
            })
            .await
            .expect("create conversation");
        let execution_graph = serde_json::json!({
            "execution_id": "graph-backfill-1",
            "route": "chat",
            "plane": "local",
            "metadata": { "status": "completed" },
            "nodes": [
                {
                    "node_id": "finalize:graph-backfill-1",
                    "node_type": "finalize",
                    "status": "completed",
                    "dependency_ids": [],
                    "metadata": {},
                    "input_payload": null,
                    "output_payload": { "ok": true }
                }
            ],
            "events": []
        });
        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "assistant".to_string(),
                content: "done".to_string(),
                name: None,
                meta_info: Some(serde_json::json!({
                    "execution_graph": execution_graph,
                })),
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append assistant history");

        migrate_execution_graph_runtime_bootstrap(&store)
            .await
            .expect("run bootstrap");

        let snapshot = load_execution_graph_snapshot(&store, "graph-backfill-1")
            .await
            .expect("load execution graph")
            .expect("execution graph snapshot should exist");
        assert_eq!(
            snapshot
                .get("execution_id")
                .and_then(serde_json::Value::as_str),
            Some("graph-backfill-1")
        );

        let row = sqlx::query(
            "SELECT source_kind, status FROM local_execution_graph_run WHERE execution_id = ?",
        )
        .bind("graph-backfill-1")
        .fetch_one(&store.pool)
        .await
        .expect("read execution run");
        assert_eq!(
            row.try_get::<String, _>("source_kind")
                .expect("source_kind"),
            "desktop_local_chat_history_backfill"
        );
        assert_eq!(
            row.try_get::<String, _>("status").expect("status"),
            "completed"
        );
    }

    #[tokio::test]
    async fn delete_runtime_context_removes_active_execution_state() {
        let store = create_test_store("execution-graph-runtime-context-delete").await;
        store.init().await.expect("init store");

        sqlx::query(
            r#"
            INSERT INTO local_execution_graph_run (
              execution_id, session_id, route, plane, status, root_execution_id, request_id,
              source_kind, graph_payload_json, created_at_unix_ms, updated_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1, 1)
            "#,
        )
        .bind("graph-runtime-1")
        .bind("session-1")
        .bind("chat")
        .bind("local")
        .bind("waiting_approval")
        .bind("desktop_local_chat_waiting_approval")
        .bind(
            serde_json::json!({
                "execution_id": "graph-runtime-1",
                "route": "chat",
                "plane": "local",
                "nodes": [],
                "events": []
            })
            .to_string(),
        )
        .execute(&store.write_pool)
        .await
        .expect("insert execution run");

        persist_execution_graph_runtime_context(
            &store,
            "graph-runtime-1",
            &serde_json::json!({ "session_id": "session-1" }),
        )
        .await
        .expect("persist runtime context");

        delete_execution_graph_runtime_context(&store, "graph-runtime-1")
            .await
            .expect("delete runtime context");

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM local_execution_graph_runtime_context WHERE execution_id = ?",
        )
        .bind("graph-runtime-1")
        .fetch_one(&store.pool)
        .await
        .expect("count runtime contexts");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn migrate_bootstrap_repairs_pending_execution_graph_persistence_after_bootstrap_done() {
        let store = create_test_store("execution-graph-pending-repair").await;
        store.init().await.expect("init store");
        migrate_execution_graph_runtime_bootstrap(&store)
            .await
            .expect("complete initial bootstrap");

        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("pending execution graph repair".to_string()),
            })
            .await
            .expect("create conversation");
        let execution_graph = serde_json::json!({
            "execution_id": "graph-pending-repair-1",
            "route": "chat",
            "plane": "local",
            "metadata": { "status": "completed" },
            "nodes": [
                {
                    "node_id": "finalize:graph-pending-repair-1",
                    "node_type": "finalize",
                    "status": "completed",
                    "dependency_ids": [],
                    "metadata": {},
                    "input_payload": null,
                    "output_payload": { "ok": true }
                }
            ],
            "events": []
        });

        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "assistant".to_string(),
                content: "pending graph".to_string(),
                name: None,
                meta_info: Some(serde_json::json!({
                    "execution_graph": execution_graph,
                    "persistence": {
                        "assistant_message_persisted": true,
                        "execution_graph_persisted": false,
                        "postprocess_completed": true
                    }
                })),
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append pending assistant message");

        migrate_execution_graph_runtime_bootstrap(&store)
            .await
            .expect("run startup repair");

        let snapshot = load_execution_graph_snapshot(&store, "graph-pending-repair-1")
            .await
            .expect("load repaired execution graph")
            .expect("repaired execution graph exists");
        assert_eq!(
            snapshot
                .get("execution_id")
                .and_then(serde_json::Value::as_str),
            Some("graph-pending-repair-1")
        );

        let meta_info_text: String = sqlx::query_scalar(
            r#"
            SELECT meta_info
            FROM conversation_message
            WHERE session_id = ? AND role = 'assistant'
            ORDER BY turn_index DESC
            LIMIT 1
            "#,
        )
        .bind(&session.session_id)
        .fetch_one(&store.pool)
        .await
        .expect("read repaired assistant meta");
        let meta_info: serde_json::Value =
            serde_json::from_str(&meta_info_text).expect("parse repaired assistant meta");
        let state = assistant_persistence_state(Some(&meta_info)).expect("assistant state");
        assert!(state.assistant_message_persisted);
        assert!(state.execution_graph_persisted);
        assert!(state.postprocess_completed);

        let run_row =
            sqlx::query("SELECT source_kind FROM local_execution_graph_run WHERE execution_id = ?")
                .bind("graph-pending-repair-1")
                .fetch_one(&store.pool)
                .await
                .expect("read repaired execution graph run");
        assert_eq!(
            run_row
                .try_get::<String, _>("source_kind")
                .expect("source kind"),
            "desktop_local_chat_pending_repair"
        );
    }
}
