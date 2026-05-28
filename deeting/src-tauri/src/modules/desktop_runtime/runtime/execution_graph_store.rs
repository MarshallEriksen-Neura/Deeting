use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use sqlx::Row;

use super::e3_readiness;

const SQLITE_BUSY_RETRY_DELAYS_MS: [u64; 3] = [150, 400, 900];
const E3_READINESS_RATIO_TOLERANCE: f64 = 0.000_000_001;

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

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FramePhaseAlignmentReadiness {
    pub(crate) metric: &'static str,
    pub(crate) contract_schema_version: i64,
    pub(crate) observation_window: &'static str,
    pub(crate) window_start_unix_ms: Option<i64>,
    pub(crate) window_end_unix_ms: Option<i64>,
    pub(crate) observed_payload_start_unix_ms: Option<i64>,
    pub(crate) observed_payload_end_unix_ms: Option<i64>,
    pub(crate) eligible_sample_start_unix_ms: Option<i64>,
    pub(crate) eligible_sample_end_unix_ms: Option<i64>,
    pub(crate) observation_window_ms: Option<i64>,
    pub(crate) minimum_observation_window_ms: i64,
    pub(crate) observation_window_met: bool,
    pub(crate) graph_count: usize,
    pub(crate) malformed_payload_count: usize,
    pub(crate) malformed_graph_payload_count: usize,
    pub(crate) malformed_e3_payload_count: usize,
    pub(crate) missing_e3_payload_count: usize,
    pub(crate) observed_payload_count: usize,
    pub(crate) eligible_sample_count: usize,
    pub(crate) matched_sample_count: usize,
    pub(crate) mismatched_sample_count: usize,
    pub(crate) excluded_sample_count: usize,
    pub(crate) direct_iteration_sample_count: usize,
    pub(crate) non_direct_strategy_sample_count: usize,
    pub(crate) non_direct_strategy_ratio: Option<f64>,
    pub(crate) minimum_non_direct_strategy_ratio: f64,
    pub(crate) strategy_distribution_met: bool,
    pub(crate) overlap_ratio: Option<f64>,
    pub(crate) minimum_overlap_ratio: f64,
    pub(crate) overlap_threshold_met: bool,
    pub(crate) e3_payload_coverage_met: bool,
    pub(crate) e3_payload_health_met: bool,
    pub(crate) threshold_met: bool,
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
    let phase_step_type = execution_graph
        .get("phase_step_type")
        .or_else(|| execution_graph.get("plane"))
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
    .bind(&phase_step_type)
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

pub(crate) async fn summarize_frame_phase_alignment_readiness(
    store: &McpStore,
    window_start_unix_ms: Option<i64>,
    window_end_unix_ms: Option<i64>,
) -> Result<FramePhaseAlignmentReadiness, McpError> {
    e3_readiness::validate_frame_phase_alignment_readiness_window(
        window_start_unix_ms,
        window_end_unix_ms,
    )
    .map_err(|message| McpError::validation(message))?;

    let rows = sqlx::query(
        r#"
        SELECT graph_payload_json, updated_at_unix_ms
        FROM local_execution_graph_run
        WHERE (? IS NULL OR updated_at_unix_ms >= ?)
          AND (? IS NULL OR updated_at_unix_ms <= ?)
        ORDER BY updated_at_unix_ms DESC
        "#,
    )
    .bind(window_start_unix_ms)
    .bind(window_start_unix_ms)
    .bind(window_end_unix_ms)
    .bind(window_end_unix_ms)
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    let graph_count = rows.len();
    let mut malformed_graph_payload_count = 0usize;
    let mut malformed_e3_payload_count = 0usize;
    let mut missing_e3_payload_count = 0usize;
    let mut observed_payload_count = 0usize;
    let mut eligible_sample_count = 0usize;
    let mut matched_sample_count = 0usize;
    let mut excluded_sample_count = 0usize;
    let mut direct_iteration_sample_count = 0usize;
    let mut non_direct_strategy_sample_count = 0usize;
    let mut first_observed_payload_unix_ms: Option<i64> = None;
    let mut last_observed_payload_unix_ms: Option<i64> = None;
    let mut first_eligible_sample_unix_ms: Option<i64> = None;
    let mut last_eligible_sample_unix_ms: Option<i64> = None;

    for row in rows {
        let updated_at_unix_ms = row
            .try_get::<i64, _>("updated_at_unix_ms")
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let payload_json = row
            .try_get::<String, _>("graph_payload_json")
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let Ok(payload) = serde_json::from_str::<serde_json::Value>(&payload_json) else {
            malformed_graph_payload_count += 1;
            continue;
        };
        let Some(resolution) = payload.pointer("/metadata/runtime_phase_resolution") else {
            missing_e3_payload_count += 1;
            continue;
        };
        if resolution.get("e3_readiness").is_none() {
            missing_e3_payload_count += 1;
            continue;
        }
        let metric = resolution
            .pointer("/e3_readiness/metric")
            .and_then(serde_json::Value::as_str);

        observed_payload_count += 1;
        extend_unix_ms_range(
            &mut first_observed_payload_unix_ms,
            &mut last_observed_payload_unix_ms,
            updated_at_unix_ms,
        );
        if metric != Some(e3_readiness::FRAME_PHASE_ALIGNMENT_METRIC) {
            malformed_e3_payload_count += 1;
            continue;
        }
        if !e3_readiness_contract_matches(resolution) {
            malformed_e3_payload_count += 1;
            continue;
        }
        let Some(sample_eligible) = read_e3_sample_eligibility(resolution) else {
            malformed_e3_payload_count += 1;
            continue;
        };
        let alignment_status = resolution
            .pointer("/phase_policy_alignment/status")
            .and_then(serde_json::Value::as_str);

        if !sample_eligible {
            if e3_excluded_sample_contract_matches(resolution, alignment_status) {
                excluded_sample_count += 1;
            } else {
                malformed_e3_payload_count += 1;
            }
            continue;
        }

        let matched = match alignment_status {
            Some(status) if status == e3_readiness::PHASE_ALIGNMENT_MATCHED => true,
            Some(status) if status == e3_readiness::PHASE_ALIGNMENT_MISMATCHED => false,
            _ => {
                malformed_e3_payload_count += 1;
                continue;
            }
        };
        let Some(frame_strategy) = resolution
            .get("frame_strategy")
            .and_then(serde_json::Value::as_str)
        else {
            malformed_e3_payload_count += 1;
            continue;
        };

        extend_unix_ms_range(
            &mut first_eligible_sample_unix_ms,
            &mut last_eligible_sample_unix_ms,
            updated_at_unix_ms,
        );
        eligible_sample_count += 1;
        if frame_strategy == "direct_iteration" {
            direct_iteration_sample_count += 1;
        } else {
            non_direct_strategy_sample_count += 1;
        }
        if matched {
            matched_sample_count += 1;
        }
    }

    let mismatched_sample_count = eligible_sample_count.saturating_sub(matched_sample_count);
    let overlap_ratio = if eligible_sample_count == 0 {
        None
    } else {
        Some(matched_sample_count as f64 / eligible_sample_count as f64)
    };
    let observation_window_ms = match (first_eligible_sample_unix_ms, last_eligible_sample_unix_ms)
    {
        (Some(start), Some(end)) => Some(end.saturating_sub(start).max(0)),
        _ => None,
    };
    let observation_window_met = observation_window_ms
        .map(|duration| duration >= e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS)
        .unwrap_or(false);
    let overlap_threshold_met = overlap_ratio
        .map(|ratio| ratio >= e3_readiness::MINIMUM_OVERLAP_RATIO)
        .unwrap_or(false);
    let non_direct_strategy_ratio = if eligible_sample_count == 0 {
        None
    } else {
        Some(non_direct_strategy_sample_count as f64 / eligible_sample_count as f64)
    };
    let strategy_distribution_met = non_direct_strategy_ratio
        .map(|ratio| ratio >= e3_readiness::MINIMUM_NON_DIRECT_STRATEGY_RATIO)
        .unwrap_or(false);
    let malformed_payload_count = malformed_graph_payload_count + malformed_e3_payload_count;
    let e3_payload_coverage_met = missing_e3_payload_count == 0;
    let e3_payload_health_met = malformed_e3_payload_count == 0;
    let threshold_met = observation_window_met
        && overlap_threshold_met
        && strategy_distribution_met
        && e3_payload_coverage_met
        && e3_payload_health_met;

    Ok(FramePhaseAlignmentReadiness {
        metric: e3_readiness::FRAME_PHASE_ALIGNMENT_METRIC,
        contract_schema_version: e3_readiness::CONTRACT_SCHEMA_VERSION,
        observation_window: e3_readiness::OBSERVATION_WINDOW_LABEL,
        window_start_unix_ms,
        window_end_unix_ms,
        observed_payload_start_unix_ms: first_observed_payload_unix_ms,
        observed_payload_end_unix_ms: last_observed_payload_unix_ms,
        eligible_sample_start_unix_ms: first_eligible_sample_unix_ms,
        eligible_sample_end_unix_ms: last_eligible_sample_unix_ms,
        observation_window_ms,
        minimum_observation_window_ms: e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS,
        observation_window_met,
        graph_count,
        malformed_payload_count,
        malformed_graph_payload_count,
        malformed_e3_payload_count,
        missing_e3_payload_count,
        observed_payload_count,
        eligible_sample_count,
        matched_sample_count,
        mismatched_sample_count,
        excluded_sample_count,
        direct_iteration_sample_count,
        non_direct_strategy_sample_count,
        non_direct_strategy_ratio,
        minimum_non_direct_strategy_ratio: e3_readiness::MINIMUM_NON_DIRECT_STRATEGY_RATIO,
        strategy_distribution_met,
        overlap_ratio,
        minimum_overlap_ratio: e3_readiness::MINIMUM_OVERLAP_RATIO,
        overlap_threshold_met,
        e3_payload_coverage_met,
        e3_payload_health_met,
        threshold_met,
    })
}

fn extend_unix_ms_range(start: &mut Option<i64>, end: &mut Option<i64>, unix_ms: i64) {
    *start = Some(
        start
            .map(|existing| existing.min(unix_ms))
            .unwrap_or(unix_ms),
    );
    *end = Some(end.map(|existing| existing.max(unix_ms)).unwrap_or(unix_ms));
}

fn e3_readiness_contract_matches(resolution: &serde_json::Value) -> bool {
    let contract_schema_version = resolution
        .pointer("/e3_readiness/contract_schema_version")
        .and_then(serde_json::Value::as_i64);
    let minimum_overlap_ratio = resolution
        .pointer("/e3_readiness/minimum_overlap_ratio")
        .and_then(serde_json::Value::as_f64);
    let minimum_observation_window_ms = resolution
        .pointer("/e3_readiness/minimum_observation_window_ms")
        .and_then(serde_json::Value::as_i64);
    let observation_window = resolution
        .pointer("/e3_readiness/observation_window")
        .and_then(serde_json::Value::as_str);
    let requires_observation_window = resolution
        .pointer("/e3_readiness/requires_observation_window")
        .and_then(serde_json::Value::as_bool);
    let requires_strategy_distribution = resolution
        .pointer("/e3_readiness/requires_strategy_distribution")
        .and_then(serde_json::Value::as_bool);
    let minimum_non_direct_strategy_ratio = resolution
        .pointer("/e3_readiness/minimum_non_direct_strategy_ratio")
        .and_then(serde_json::Value::as_f64);
    let comparison_basis = resolution
        .pointer("/phase_policy_alignment/comparison_basis")
        .and_then(serde_json::Value::as_str);

    let overlap_ratio_matches = minimum_overlap_ratio
        .map(|ratio| {
            (ratio - e3_readiness::MINIMUM_OVERLAP_RATIO).abs() <= E3_READINESS_RATIO_TOLERANCE
        })
        .unwrap_or(false);
    let strategy_ratio_matches = minimum_non_direct_strategy_ratio
        .map(|ratio| {
            (ratio - e3_readiness::MINIMUM_NON_DIRECT_STRATEGY_RATIO).abs()
                <= E3_READINESS_RATIO_TOLERANCE
        })
        .unwrap_or(false);

    contract_schema_version == Some(e3_readiness::CONTRACT_SCHEMA_VERSION)
        && overlap_ratio_matches
        && strategy_ratio_matches
        && minimum_observation_window_ms == Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS)
        && observation_window == Some(e3_readiness::OBSERVATION_WINDOW_LABEL)
        && requires_observation_window == Some(true)
        && requires_strategy_distribution == Some(true)
        && comparison_basis == Some(e3_readiness::LEGACY_EFFECTIVE_PHASE_STEP_BASIS)
}

fn e3_excluded_sample_contract_matches(
    resolution: &serde_json::Value,
    alignment_status: Option<&str>,
) -> bool {
    let alignment_exclusion_reason = resolution
        .pointer("/phase_policy_alignment/sample_exclusion_reason")
        .and_then(serde_json::Value::as_str);
    let readiness_exclusion_reason = resolution
        .pointer("/e3_readiness/sample_exclusion_reason")
        .and_then(serde_json::Value::as_str);

    alignment_status == Some(e3_readiness::FRAME_STRATEGY_STEP_MISSING)
        && alignment_exclusion_reason == Some(e3_readiness::FRAME_STRATEGY_STEP_MISSING)
        && readiness_exclusion_reason == Some(e3_readiness::FRAME_STRATEGY_STEP_MISSING)
}

fn read_e3_sample_eligibility(resolution: &serde_json::Value) -> Option<bool> {
    let alignment_eligible = resolution
        .pointer("/phase_policy_alignment/sample_eligible")
        .and_then(serde_json::Value::as_bool);
    let readiness_eligible = resolution
        .pointer("/e3_readiness/sample_eligible")
        .and_then(serde_json::Value::as_bool);

    // The deletion gate is intentionally stricter than the runtime producer:
    // stale or partially written historical payloads should reduce confidence,
    // not silently enter the overlap denominator.
    match (alignment_eligible, readiness_eligible) {
        (Some(alignment), Some(readiness)) if alignment == readiness => Some(alignment),
        _ => None,
    }
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
        summarize_frame_phase_alignment_readiness,
    };
    use crate::modules::desktop_runtime::runtime::e3_readiness;
    use crate::modules::mcp::store::McpStore;
    use mcp_session::conversation::LocalConversationCreateRequest;
    use serde_json::{json, Value};
    use uuid::Uuid;

    async fn create_test_store(name: &str) -> McpStore {
        let db_path = std::env::temp_dir().join(format!("deeting-{name}-{}.db", Uuid::new_v4()));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        McpStore::new(&database_url)
            .await
            .expect("test store should be created")
    }

    async fn insert_e3_readiness_graph(
        store: &McpStore,
        execution_id: &str,
        updated_at_unix_ms: i64,
        runtime_phase_resolution: Option<serde_json::Value>,
    ) {
        let graph = json!({
            "execution_id": execution_id,
            "route": "direct",
            "phase_step_type": "direct_chat",
            "events": [],
            "metadata": {
                "runtime_phase_resolution": runtime_phase_resolution
            }
        });

        sqlx::query(
            r#"
            INSERT INTO local_execution_graph_run (
              execution_id, session_id, route, plane, status, root_execution_id, request_id,
              source_kind, graph_payload_json, created_at_unix_ms, updated_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
            "#,
        )
        .bind(execution_id)
        .bind("session-e3")
        .bind("direct")
        .bind("direct_chat")
        .bind("completed")
        .bind("desktop_local_chat")
        .bind(graph.to_string())
        .bind(updated_at_unix_ms)
        .bind(updated_at_unix_ms)
        .execute(&store.write_pool)
        .await
        .expect("insert execution graph");
    }

    async fn insert_raw_execution_graph_payload(
        store: &McpStore,
        execution_id: &str,
        updated_at_unix_ms: i64,
        graph_payload_json: &str,
    ) {
        sqlx::query(
            r#"
            INSERT INTO local_execution_graph_run (
              execution_id, session_id, route, plane, status, root_execution_id, request_id,
              source_kind, graph_payload_json, created_at_unix_ms, updated_at_unix_ms
            ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
            "#,
        )
        .bind(execution_id)
        .bind("session-e3")
        .bind("direct")
        .bind("direct_chat")
        .bind("completed")
        .bind("desktop_local_chat")
        .bind(graph_payload_json)
        .bind(updated_at_unix_ms)
        .bind(updated_at_unix_ms)
        .execute(&store.write_pool)
        .await
        .expect("insert raw execution graph");
    }

    fn e3_resolution(status: &str, sample_eligible: bool) -> serde_json::Value {
        e3_resolution_with_strategy(status, sample_eligible, "direct_iteration")
    }

    fn e3_resolution_with_strategy(
        status: &str,
        sample_eligible: bool,
        frame_strategy: &str,
    ) -> serde_json::Value {
        let sample_exclusion_reason = if sample_eligible {
            Value::Null
        } else {
            json!("missing_frame_strategy_step")
        };

        e3_resolution_from_parts(json!({
            "frame_strategy": frame_strategy,
            "phase_policy_alignment": {
                "status": status,
                "sample_eligible": sample_eligible,
                "sample_exclusion_reason": sample_exclusion_reason
            },
            "e3_readiness": {
                "metric": "frame_phase_step_alignment",
                "sample_eligible": sample_eligible,
                "sample_exclusion_reason": sample_exclusion_reason
            }
        }))
    }

    fn e3_resolution_with_readiness_eligibility(
        status: &str,
        alignment_sample_eligible: bool,
        readiness_sample_eligible: bool,
    ) -> serde_json::Value {
        let alignment_exclusion_reason = if alignment_sample_eligible {
            Value::Null
        } else {
            json!("missing_frame_strategy_step")
        };
        let readiness_exclusion_reason = if readiness_sample_eligible {
            Value::Null
        } else {
            json!("missing_frame_strategy_step")
        };

        e3_resolution_from_parts(json!({
            "phase_policy_alignment": {
                "status": status,
                "sample_eligible": alignment_sample_eligible,
                "sample_exclusion_reason": alignment_exclusion_reason
            },
            "e3_readiness": {
                "metric": "frame_phase_step_alignment",
                "sample_eligible": readiness_sample_eligible,
                "sample_exclusion_reason": readiness_exclusion_reason
            }
        }))
    }

    fn e3_resolution_missing_alignment_exclusion_reason(status: &str) -> serde_json::Value {
        e3_resolution_from_parts(json!({
            "phase_policy_alignment": {
                "status": status,
                "sample_eligible": false
            },
            "e3_readiness": {
                "metric": "frame_phase_step_alignment",
                "sample_eligible": false,
                "sample_exclusion_reason": "missing_frame_strategy_step"
            }
        }))
    }

    fn e3_resolution_missing_sample_eligibility(status: &str) -> serde_json::Value {
        e3_resolution_from_parts(json!({
            "phase_policy_alignment": {
                "status": status
            },
            "e3_readiness": {
                "metric": "frame_phase_step_alignment",
                "sample_exclusion_reason": Value::Null
            }
        }))
    }

    fn e3_resolution_with_mismatched_contract(
        mut resolution: serde_json::Value,
    ) -> serde_json::Value {
        if let Some(readiness) = resolution
            .get_mut("e3_readiness")
            .and_then(serde_json::Value::as_object_mut)
        {
            readiness.insert("minimum_overlap_ratio".to_string(), json!(0.90));
        }
        resolution
    }

    fn e3_resolution_with_mismatched_metric(
        mut resolution: serde_json::Value,
    ) -> serde_json::Value {
        if let Some(readiness) = resolution
            .get_mut("e3_readiness")
            .and_then(serde_json::Value::as_object_mut)
        {
            readiness.insert("metric".to_string(), json!("frame_phase_step_alignment_v2"));
        }
        resolution
    }

    fn e3_resolution_without_metric(mut resolution: serde_json::Value) -> serde_json::Value {
        if let Some(readiness) = resolution
            .get_mut("e3_readiness")
            .and_then(serde_json::Value::as_object_mut)
        {
            readiness.remove("metric");
        }
        resolution
    }

    fn e3_resolution_from_parts(mut resolution: serde_json::Value) -> serde_json::Value {
        if let Some(alignment) = resolution
            .get_mut("phase_policy_alignment")
            .and_then(serde_json::Value::as_object_mut)
        {
            alignment.insert(
                "comparison_basis".to_string(),
                json!("legacy_effective_phase_step"),
            );
        }
        if let Some(readiness) = resolution
            .get_mut("e3_readiness")
            .and_then(serde_json::Value::as_object_mut)
        {
            readiness.insert("contract_schema_version".to_string(), json!(2));
            readiness.insert("minimum_overlap_ratio".to_string(), json!(0.95));
            readiness.insert("minimum_non_direct_strategy_ratio".to_string(), json!(0.01));
            readiness.insert(
                "minimum_observation_window_ms".to_string(),
                json!(604800000),
            );
            readiness.insert("observation_window".to_string(), json!("1-2w"));
            readiness.insert("requires_observation_window".to_string(), json!(true));
            readiness.insert("requires_strategy_distribution".to_string(), json!(true));
        }
        resolution
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
            "phase_step_type": "direct_chat",
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
                    "enforcement": "enforced"
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
        .bind("direct_chat")
        .bind("completed")
        .bind("request-old")
        .bind("desktop_local_chat")
        .bind(
            json!({
                "execution_id": "graph-session-old",
                "phase_step_type": "direct_chat",
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
        .bind("direct_chat")
        .bind("completed")
        .bind("request-new")
        .bind("desktop_local_chat")
        .bind(json!({ "phase_step_type": "direct_chat", "events": [] }).to_string())
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
    async fn summarize_frame_phase_alignment_readiness_counts_persisted_e3_samples() {
        let store = create_test_store("execution-graph-e3-readiness").await;
        store.init().await.expect("init store");

        for (execution_id, updated_at_unix_ms, runtime_phase_resolution) in [
            (
                "graph-e3-matched",
                20_i64,
                Some(e3_resolution("matched", true)),
            ),
            (
                "graph-e3-mismatched",
                30_i64,
                Some(e3_resolution("mismatched", true)),
            ),
            (
                "graph-e3-excluded",
                40_i64,
                Some(e3_resolution("missing_frame_strategy_step", false)),
            ),
            (
                "graph-e3-unknown-status",
                42_i64,
                Some(e3_resolution("unknown", true)),
            ),
            (
                "graph-e3-inconsistent-eligibility",
                43_i64,
                Some(e3_resolution_with_readiness_eligibility(
                    "matched", true, false,
                )),
            ),
            (
                "graph-e3-missing-eligibility",
                44_i64,
                Some(e3_resolution_missing_sample_eligibility("matched")),
            ),
            (
                "graph-e3-bad-excluded-contract",
                46_i64,
                Some(e3_resolution_missing_alignment_exclusion_reason(
                    "missing_frame_strategy_step",
                )),
            ),
            (
                "graph-e3-drifted-metric",
                47_i64,
                Some(e3_resolution_with_mismatched_metric(e3_resolution(
                    "matched", true,
                ))),
            ),
            (
                "graph-e3-missing-metric",
                48_i64,
                Some(e3_resolution_without_metric(e3_resolution("matched", true))),
            ),
            ("graph-e3-no-payload", 50_i64, None),
            (
                "graph-e3-window-outside",
                5_i64,
                Some(e3_resolution("matched", true)),
            ),
        ] {
            insert_e3_readiness_graph(
                &store,
                execution_id,
                updated_at_unix_ms,
                runtime_phase_resolution,
            )
            .await;
        }
        insert_raw_execution_graph_payload(&store, "graph-e3-malformed", 45, "{").await;

        let readiness = summarize_frame_phase_alignment_readiness(&store, Some(10), Some(60))
            .await
            .expect("summarize e3 readiness");

        assert_eq!(readiness.window_start_unix_ms, Some(10));
        assert_eq!(readiness.window_end_unix_ms, Some(60));
        assert_eq!(readiness.metric, e3_readiness::FRAME_PHASE_ALIGNMENT_METRIC);
        assert_eq!(
            readiness.contract_schema_version,
            e3_readiness::CONTRACT_SCHEMA_VERSION
        );
        assert_eq!(
            readiness.observation_window,
            e3_readiness::OBSERVATION_WINDOW_LABEL
        );
        assert_eq!(readiness.observed_payload_start_unix_ms, Some(20));
        assert_eq!(readiness.observed_payload_end_unix_ms, Some(48));
        assert_eq!(readiness.eligible_sample_start_unix_ms, Some(20));
        assert_eq!(readiness.eligible_sample_end_unix_ms, Some(30));
        assert_eq!(readiness.observation_window_ms, Some(10));
        assert_eq!(
            readiness.minimum_observation_window_ms,
            e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS
        );
        assert!(!readiness.observation_window_met);
        assert_eq!(readiness.graph_count, 11);
        assert_eq!(readiness.malformed_payload_count, 7);
        assert_eq!(readiness.malformed_graph_payload_count, 1);
        assert_eq!(readiness.malformed_e3_payload_count, 6);
        assert_eq!(readiness.missing_e3_payload_count, 1);
        assert_eq!(readiness.observed_payload_count, 9);
        assert_eq!(readiness.eligible_sample_count, 2);
        assert_eq!(readiness.matched_sample_count, 1);
        assert_eq!(readiness.mismatched_sample_count, 1);
        assert_eq!(readiness.excluded_sample_count, 1);
        assert_eq!(readiness.direct_iteration_sample_count, 2);
        assert_eq!(readiness.non_direct_strategy_sample_count, 0);
        assert_eq!(readiness.non_direct_strategy_ratio, Some(0.0));
        assert_eq!(readiness.minimum_non_direct_strategy_ratio, 0.01);
        assert!(!readiness.strategy_distribution_met);
        assert_eq!(readiness.overlap_ratio, Some(0.5));
        assert_eq!(readiness.minimum_overlap_ratio, 0.95);
        assert!(!readiness.overlap_threshold_met);
        assert!(!readiness.e3_payload_coverage_met);
        assert!(!readiness.e3_payload_health_met);
        assert!(!readiness.threshold_met);
    }

    #[tokio::test]
    async fn summarize_frame_phase_alignment_readiness_rejects_invalid_windows() {
        let store = create_test_store("execution-graph-e3-readiness-window-validation").await;
        store.init().await.expect("init store");

        for (window_start_unix_ms, window_end_unix_ms, expected_message) in [
            (
                Some(-1_i64),
                Some(100_i64),
                e3_readiness::WINDOW_START_NEGATIVE_ERROR,
            ),
            (
                Some(0_i64),
                Some(-1_i64),
                e3_readiness::WINDOW_END_NEGATIVE_ERROR,
            ),
            (
                Some(101_i64),
                Some(100_i64),
                e3_readiness::WINDOW_REVERSED_ERROR,
            ),
        ] {
            let error = summarize_frame_phase_alignment_readiness(
                &store,
                window_start_unix_ms,
                window_end_unix_ms,
            )
            .await
            .expect_err("invalid readiness window should be rejected by the store");

            assert!(
                error.to_string().contains(expected_message),
                "expected error to contain {expected_message:?}, got {error}"
            );
        }
    }

    #[tokio::test]
    async fn summarize_frame_phase_alignment_readiness_requires_eligible_window_and_overlap() {
        let store = create_test_store("execution-graph-e3-readiness-threshold").await;
        store.init().await.expect("init store");

        insert_e3_readiness_graph(
            &store,
            "graph-e3-day-0",
            0,
            Some(e3_resolution("matched", true)),
        )
        .await;
        insert_e3_readiness_graph(
            &store,
            "graph-e3-excluded-after-window",
            e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 1,
            Some(e3_resolution("missing_frame_strategy_step", false)),
        )
        .await;

        let short_eligible_window = summarize_frame_phase_alignment_readiness(
            &store,
            Some(0),
            Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 1),
        )
        .await
        .expect("summarize e3 readiness before enough eligible samples");

        assert_eq!(short_eligible_window.overlap_ratio, Some(1.0));
        assert!(short_eligible_window.overlap_threshold_met);
        assert_eq!(short_eligible_window.observation_window_ms, Some(0));
        assert!(!short_eligible_window.observation_window_met);
        assert!(!short_eligible_window.threshold_met);

        insert_e3_readiness_graph(
            &store,
            "graph-e3-day-7",
            e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS,
            Some(e3_resolution("matched", true)),
        )
        .await;

        let readiness = summarize_frame_phase_alignment_readiness(
            &store,
            Some(0),
            Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 1),
        )
        .await
        .expect("summarize e3 readiness");

        assert_eq!(readiness.observed_payload_start_unix_ms, Some(0));
        assert_eq!(
            readiness.observed_payload_end_unix_ms,
            Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 1)
        );
        assert_eq!(readiness.eligible_sample_start_unix_ms, Some(0));
        assert_eq!(
            readiness.eligible_sample_end_unix_ms,
            Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS)
        );
        assert_eq!(
            readiness.observation_window_ms,
            Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS)
        );
        assert!(readiness.observation_window_met);
        assert_eq!(readiness.malformed_payload_count, 0);
        assert_eq!(readiness.malformed_graph_payload_count, 0);
        assert_eq!(readiness.malformed_e3_payload_count, 0);
        assert_eq!(readiness.missing_e3_payload_count, 0);
        assert_eq!(readiness.eligible_sample_count, 2);
        assert_eq!(readiness.matched_sample_count, 2);
        assert_eq!(readiness.mismatched_sample_count, 0);
        assert_eq!(readiness.excluded_sample_count, 1);
        assert_eq!(readiness.overlap_ratio, Some(1.0));
        assert!(readiness.overlap_threshold_met);
        assert_eq!(readiness.direct_iteration_sample_count, 2);
        assert_eq!(readiness.non_direct_strategy_sample_count, 0);
        assert_eq!(readiness.non_direct_strategy_ratio, Some(0.0));
        assert!(!readiness.strategy_distribution_met);
        assert!(readiness.e3_payload_coverage_met);
        assert!(readiness.e3_payload_health_met);
        assert!(!readiness.threshold_met);

        insert_e3_readiness_graph(
            &store,
            "graph-e3-non-direct-strategy",
            e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS,
            Some(e3_resolution_with_strategy(
                "matched",
                true,
                "delegated_workflow",
            )),
        )
        .await;

        let multi_strategy_ready = summarize_frame_phase_alignment_readiness(
            &store,
            Some(0),
            Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 1),
        )
        .await
        .expect("summarize e3 readiness with non-direct strategy sample");

        assert_eq!(multi_strategy_ready.direct_iteration_sample_count, 2);
        assert_eq!(multi_strategy_ready.non_direct_strategy_sample_count, 1);
        assert_eq!(
            multi_strategy_ready.non_direct_strategy_ratio,
            Some(1.0 / 3.0)
        );
        assert!(multi_strategy_ready.strategy_distribution_met);
        assert!(multi_strategy_ready.threshold_met);

        insert_e3_readiness_graph(
            &store,
            "graph-e3-missing-payload-after-ready-window",
            e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 1,
            None,
        )
        .await;

        let missing_payload = summarize_frame_phase_alignment_readiness(
            &store,
            Some(0),
            Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 1),
        )
        .await
        .expect("summarize e3 readiness with missing e3 payload");

        assert_eq!(missing_payload.overlap_ratio, Some(1.0));
        assert!(missing_payload.observation_window_met);
        assert!(missing_payload.overlap_threshold_met);
        assert_eq!(missing_payload.malformed_e3_payload_count, 0);
        assert_eq!(missing_payload.missing_e3_payload_count, 1);
        assert!(!missing_payload.e3_payload_coverage_met);
        assert!(missing_payload.e3_payload_health_met);
        assert!(!missing_payload.threshold_met);

        insert_e3_readiness_graph(
            &store,
            "graph-e3-bad-contract-after-ready-window",
            e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 1,
            Some(e3_resolution_missing_sample_eligibility("matched")),
        )
        .await;

        let unhealthy = summarize_frame_phase_alignment_readiness(
            &store,
            Some(0),
            Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 1),
        )
        .await
        .expect("summarize e3 readiness with malformed e3 payload");

        assert_eq!(unhealthy.overlap_ratio, Some(1.0));
        assert!(unhealthy.observation_window_met);
        assert!(unhealthy.overlap_threshold_met);
        assert_eq!(unhealthy.observed_payload_count, 5);
        assert_eq!(unhealthy.eligible_sample_count, 3);
        assert_eq!(unhealthy.observed_payload_start_unix_ms, Some(0));
        assert_eq!(
            unhealthy.observed_payload_end_unix_ms,
            Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 1)
        );
        assert_eq!(unhealthy.eligible_sample_start_unix_ms, Some(0));
        assert_eq!(
            unhealthy.eligible_sample_end_unix_ms,
            Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS)
        );
        assert_eq!(unhealthy.malformed_graph_payload_count, 0);
        assert_eq!(unhealthy.malformed_e3_payload_count, 1);
        assert_eq!(unhealthy.missing_e3_payload_count, 1);
        assert_eq!(unhealthy.direct_iteration_sample_count, 2);
        assert_eq!(unhealthy.non_direct_strategy_sample_count, 1);
        assert!(unhealthy.strategy_distribution_met);
        assert!(!unhealthy.e3_payload_coverage_met);
        assert!(!unhealthy.e3_payload_health_met);
        assert!(!unhealthy.threshold_met);
    }

    #[tokio::test]
    async fn summarize_frame_phase_alignment_readiness_rejects_mismatched_contract_payloads() {
        let store = create_test_store("execution-graph-e3-readiness-contract").await;
        store.init().await.expect("init store");

        insert_e3_readiness_graph(
            &store,
            "graph-e3-day-0",
            0,
            Some(e3_resolution("matched", true)),
        )
        .await;
        insert_e3_readiness_graph(
            &store,
            "graph-e3-day-7",
            e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS,
            Some(e3_resolution("matched", true)),
        )
        .await;
        insert_e3_readiness_graph(
            &store,
            "graph-e3-contract-drift",
            e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 1,
            Some(e3_resolution_with_mismatched_contract(e3_resolution(
                "matched", true,
            ))),
        )
        .await;
        insert_e3_readiness_graph(
            &store,
            "graph-e3-metric-drift",
            e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 2,
            Some(e3_resolution_with_mismatched_metric(e3_resolution(
                "matched", true,
            ))),
        )
        .await;
        insert_e3_readiness_graph(
            &store,
            "graph-e3-missing-metric",
            e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 3,
            Some(e3_resolution_without_metric(e3_resolution("matched", true))),
        )
        .await;

        let readiness = summarize_frame_phase_alignment_readiness(
            &store,
            Some(0),
            Some(e3_readiness::MINIMUM_OBSERVATION_WINDOW_MS + 3),
        )
        .await
        .expect("summarize e3 readiness with mismatched contract");

        assert_eq!(readiness.overlap_ratio, Some(1.0));
        assert!(readiness.observation_window_met);
        assert!(readiness.overlap_threshold_met);
        assert_eq!(readiness.observed_payload_count, 5);
        assert_eq!(readiness.eligible_sample_count, 2);
        assert_eq!(readiness.malformed_payload_count, 3);
        assert_eq!(readiness.malformed_graph_payload_count, 0);
        assert_eq!(readiness.malformed_e3_payload_count, 3);
        assert_eq!(readiness.missing_e3_payload_count, 0);
        assert!(readiness.e3_payload_coverage_met);
        assert!(!readiness.e3_payload_health_met);
        assert!(!readiness.threshold_met);
    }

    #[tokio::test]
    async fn summarize_frame_phase_alignment_readiness_stays_unready_without_eligible_samples() {
        let store = create_test_store("execution-graph-e3-readiness-empty").await;
        store.init().await.expect("init store");

        insert_e3_readiness_graph(&store, "graph-e3-no-payload", 10, None).await;
        insert_e3_readiness_graph(
            &store,
            "graph-e3-excluded",
            20,
            Some(e3_resolution("missing_frame_strategy_step", false)),
        )
        .await;

        let readiness = summarize_frame_phase_alignment_readiness(&store, Some(0), Some(30))
            .await
            .expect("summarize e3 readiness");

        assert_eq!(readiness.graph_count, 2);
        assert_eq!(readiness.observed_payload_count, 1);
        assert_eq!(readiness.excluded_sample_count, 1);
        assert_eq!(readiness.malformed_payload_count, 0);
        assert_eq!(readiness.malformed_graph_payload_count, 0);
        assert_eq!(readiness.malformed_e3_payload_count, 0);
        assert_eq!(readiness.missing_e3_payload_count, 1);
        assert_eq!(readiness.eligible_sample_count, 0);
        assert_eq!(readiness.matched_sample_count, 0);
        assert_eq!(readiness.mismatched_sample_count, 0);
        assert_eq!(readiness.overlap_ratio, None);
        assert_eq!(readiness.eligible_sample_start_unix_ms, None);
        assert_eq!(readiness.eligible_sample_end_unix_ms, None);
        assert_eq!(readiness.observation_window_ms, None);
        assert!(!readiness.observation_window_met);
        assert!(!readiness.overlap_threshold_met);
        assert!(!readiness.e3_payload_coverage_met);
        assert!(readiness.e3_payload_health_met);
        assert!(!readiness.threshold_met);
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
        .bind("direct_chat")
        .bind("waiting_approval")
        .bind("desktop_local_chat_waiting_approval")
        .bind(
            serde_json::json!({
                "execution_id": "graph-runtime-1",
                "route": "chat",
                "phase_step_type": "direct_chat",
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
