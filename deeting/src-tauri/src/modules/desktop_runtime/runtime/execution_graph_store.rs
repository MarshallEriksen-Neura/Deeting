use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use sqlx::Row;

const SQLITE_BUSY_RETRY_DELAYS_MS: [u64; 3] = [150, 400, 900];

fn is_sqlite_busy_error(err: &McpError) -> bool {
    let text = err.to_string().to_ascii_lowercase();
    text.contains("database is locked")
        || text.contains("sqlite_busy")
        || text.contains("(code: 5)")
}

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
        .unwrap_or("unknown")
        .to_string();
    let mut attempt = 0usize;
    loop {
        match persist_execution_graph_snapshot_once(
            store,
            execution_graph,
            session_id,
            source_kind,
            request_id,
            status,
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(err)
                if is_sqlite_busy_error(&err) && attempt < SQLITE_BUSY_RETRY_DELAYS_MS.len() =>
            {
                let delay_ms = SQLITE_BUSY_RETRY_DELAYS_MS[attempt];
                attempt += 1;
                log::warn!(
                    "persist_execution_graph_snapshot busy retry execution_id={} attempt={} delay_ms={}",
                    execution_id,
                    attempt,
                    delay_ms
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
            Err(err) => return Err(err),
        }
    }
}

async fn persist_execution_graph_snapshot_once(
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

pub(crate) async fn list_execution_graph_snapshots_for_session(
    store: &McpStore,
    session_id: &str,
    limit: Option<i64>,
) -> Result<Vec<serde_json::Value>, McpError> {
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Err(McpError::validation("session_id is required"));
    }
    let limit = limit.unwrap_or(20).clamp(1, 100);
    let rows = sqlx::query(
        r#"
        SELECT execution_id, graph_payload_json
        FROM local_execution_graph_run
        WHERE session_id = ?
        ORDER BY updated_at_unix_ms DESC
        LIMIT ?
        "#,
    )
    .bind(normalized_session_id)
    .bind(limit)
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    rows.into_iter()
        .map(|row| {
            let execution_id = row
                .try_get::<String, _>("execution_id")
                .map_err(|err| McpError::Storage(err.to_string()))?;
            let payload_json = row
                .try_get::<String, _>("graph_payload_json")
                .map_err(|err| McpError::Storage(err.to_string()))?;
            let mut payload: serde_json::Value = serde_json::from_str(&payload_json)
                .map_err(|err| McpError::Storage(err.to_string()))?;
            if let Some(object) = payload.as_object_mut() {
                object
                    .entry("execution_id".to_string())
                    .or_insert_with(|| serde_json::Value::String(execution_id));
            }
            Ok(payload)
        })
        .collect()
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
    let mut attempt = 0usize;
    loop {
        match persist_execution_graph_runtime_context_once(store, normalized_execution_id, context)
            .await
        {
            Ok(()) => return Ok(()),
            Err(err)
                if is_sqlite_busy_error(&err) && attempt < SQLITE_BUSY_RETRY_DELAYS_MS.len() =>
            {
                let delay_ms = SQLITE_BUSY_RETRY_DELAYS_MS[attempt];
                attempt += 1;
                log::warn!(
                    "persist_execution_graph_runtime_context busy retry execution_id={} attempt={} delay_ms={}",
                    normalized_execution_id,
                    attempt,
                    delay_ms
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
            Err(err) => return Err(err),
        }
    }
}

async fn persist_execution_graph_runtime_context_once(
    store: &McpStore,
    normalized_execution_id: &str,
    context: &serde_json::Value,
) -> Result<(), McpError> {
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
    let mut attempt = 0usize;
    loop {
        match delete_execution_graph_runtime_context_once(store, normalized_execution_id).await {
            Ok(()) => return Ok(()),
            Err(err)
                if is_sqlite_busy_error(&err) && attempt < SQLITE_BUSY_RETRY_DELAYS_MS.len() =>
            {
                let delay_ms = SQLITE_BUSY_RETRY_DELAYS_MS[attempt];
                attempt += 1;
                log::warn!(
                    "delete_execution_graph_runtime_context busy retry execution_id={} attempt={} delay_ms={}",
                    normalized_execution_id,
                    attempt,
                    delay_ms
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
            Err(err) => return Err(err),
        }
    }
}

async fn delete_execution_graph_runtime_context_once(
    store: &McpStore,
    normalized_execution_id: &str,
) -> Result<(), McpError> {
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
        delete_execution_graph_runtime_context, list_execution_graph_snapshots_for_session,
        load_execution_graph_snapshot, migrate_execution_graph_runtime_bootstrap,
        persist_execution_graph_runtime_context, persist_execution_graph_snapshot,
    };
    use crate::modules::mcp::store::McpStore;
    use mcp_session::conversation::LocalConversationCreateRequest;
    use serde_json::json;
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
        let _session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("execution graph backfill".to_string()),
            })
            .await
            .expect("create conversation");
        migrate_execution_graph_runtime_bootstrap(&store)
            .await
            .expect("run bootstrap");

        let snapshot = load_execution_graph_snapshot(&store, "graph-backfill-1")
            .await
            .expect("load execution graph");
        assert!(snapshot.is_none());
    }

    #[tokio::test]
    async fn persist_and_load_graph_preserves_runtime_transition_events() {
        let store = create_test_store("execution-graph-runtime-transition-events").await;
        store.init().await.expect("init store");
        let graph = json!({
            "execution_id": "graph-transition-1",
            "session_id": "session-1",
            "route": "direct",
            "plane": "response_only",
            "request_id": "request-1",
            "nodes": [],
            "events": [{
                "event_id": "event:runtime_transition:0",
                "node_id": null,
                "event_type": "runtime_transition.decision",
                "payload": {
                    "transition_id": "runtime-transition:call-1",
                    "trace_id": "trace-1",
                    "request_id": "request-1",
                    "required_artifact": "diting_think_preflight",
                    "enforcement": "shadow"
                }
            }],
            "metadata": {"trace_id": "trace-1"}
        });

        persist_execution_graph_snapshot(
            &store,
            &graph,
            "session-1",
            "desktop_local_chat",
            Some("request-1"),
            Some("active"),
        )
        .await
        .expect("persist graph snapshot");

        let loaded = load_execution_graph_snapshot(&store, "graph-transition-1")
            .await
            .expect("load graph snapshot")
            .expect("stored graph snapshot");

        assert_eq!(
            loaded["events"][0]["event_type"],
            json!("runtime_transition.decision")
        );
        assert_eq!(
            loaded["events"][0]["payload"]["transition_id"],
            json!("runtime-transition:call-1")
        );
    }

    #[tokio::test]
    async fn list_graph_snapshots_for_session_returns_recent_graphs_with_execution_ids() {
        let store = create_test_store("execution-graph-session-list").await;
        store.init().await.expect("init store");

        sqlx::query(
            r#"
            INSERT INTO local_execution_graph_run (
              execution_id, session_id, route, plane, status, root_execution_id, request_id,
              source_kind, graph_payload_json, created_at_unix_ms, updated_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
            "#,
        )
        .bind("graph-session-old")
        .bind("session-list")
        .bind("direct")
        .bind("response_only")
        .bind("completed")
        .bind("request-old")
        .bind("desktop_local_chat")
        .bind(
            json!({
                "execution_id": "graph-session-old",
                "events": []
            })
            .to_string(),
        )
        .bind(10_i64)
        .bind(10_i64)
        .execute(&store.write_pool)
        .await
        .expect("insert old graph");

        sqlx::query(
            r#"
            INSERT INTO local_execution_graph_run (
              execution_id, session_id, route, plane, status, root_execution_id, request_id,
              source_kind, graph_payload_json, created_at_unix_ms, updated_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
            "#,
        )
        .bind("graph-session-new")
        .bind("session-list")
        .bind("direct")
        .bind("response_only")
        .bind("completed")
        .bind("request-new")
        .bind("desktop_local_chat")
        .bind(json!({ "events": [] }).to_string())
        .bind(20_i64)
        .bind(20_i64)
        .execute(&store.write_pool)
        .await
        .expect("insert new graph");

        let snapshots =
            list_execution_graph_snapshots_for_session(&store, "session-list", Some(10))
                .await
                .expect("list session graphs");

        assert_eq!(snapshots.len(), 2);
        assert_eq!(snapshots[0]["execution_id"], json!("graph-session-new"));
        assert_eq!(snapshots[1]["execution_id"], json!("graph-session-old"));
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
}
