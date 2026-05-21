//! SQL CRUD for evolution signals and cases.
//!
//! Tables live in `mcp` store's SQLite file (see `McpStore::init`); this
//! module owns the schema's read/write logic so `McpStore` itself does not
//! grow evolution-specific methods. Pools are accessed via the existing
//! `pub(crate)` fields on `McpStore`.

use serde_json::Value as JsonValue;
use sqlx::{QueryBuilder, Row, Sqlite};
use uuid::Uuid;

use crate::modules::mcp::store::McpStore;
use mcp_session::admin::LocalEvolutionSignalQuery;

use super::types::{
    EvolutionCase, EvolutionCaseType, EvolutionSignal, EvolutionSignalClassification,
    EvolutionSignalDraft, EvolutionSignalSource, EvolutionSignalStatus,
};

fn now_unix_ms() -> i64 {
    (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn normalize_filter(value: Option<&String>) -> Option<&str> {
    value
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn push_signal_filters<'a>(
    query: &'a LocalEvolutionSignalQuery,
    builder: &mut QueryBuilder<'a, Sqlite>,
) {
    if let Some(value) = normalize_filter(query.source.as_ref()) {
        builder.push(" AND source = ").push_bind(value);
    }
    if let Some(value) = normalize_filter(query.classification.as_ref()) {
        builder.push(" AND classification = ").push_bind(value);
    }
    if let Some(value) = normalize_filter(query.session_id.as_ref()) {
        builder.push(" AND session_id = ").push_bind(value);
    }
    if let Some(value) = normalize_filter(query.trace_id.as_ref()) {
        builder.push(" AND trace_id = ").push_bind(value);
    }
    if let Some(value) = normalize_filter(query.run_id.as_ref()) {
        builder.push(" AND run_id = ").push_bind(value);
    }
    if let Some(value) = normalize_filter(query.fingerprint_key.as_ref()) {
        builder.push(" AND fingerprint_key = ").push_bind(value);
    }
    if let Some(value) = normalize_filter(query.status.as_ref()) {
        builder.push(" AND status = ").push_bind(value);
    }
    if let Some(value) = query.created_at_start_unix_ms {
        builder.push(" AND created_at_unix_ms >= ").push_bind(value);
    }
    if let Some(value) = query.created_at_end_unix_ms {
        builder.push(" AND created_at_unix_ms <= ").push_bind(value);
    }
}

fn signal_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<EvolutionSignal, String> {
    let source_text: String = row
        .try_get("source")
        .map_err(|err| format!("evolution signal row source: {err}"))?;
    let source = EvolutionSignalSource::from_canonical_str(&source_text)
        .ok_or_else(|| format!("unknown evolution signal source: {source_text}"))?;
    let status_text: String = row
        .try_get("status")
        .map_err(|err| format!("evolution signal row status: {err}"))?;
    let status = EvolutionSignalStatus::from_canonical_str(&status_text)
        .ok_or_else(|| format!("unknown evolution signal status: {status_text}"))?;
    let classification_text: String = row
        .try_get("classification")
        .map_err(|err| format!("evolution signal row classification: {err}"))?;
    let classification = EvolutionSignalClassification::from_canonical_str(&classification_text)
        .ok_or_else(|| format!("unknown evolution signal classification: {classification_text}"))?;
    let payload_text: String = row
        .try_get("payload_json")
        .map_err(|err| format!("evolution signal row payload: {err}"))?;
    let payload_json: JsonValue = serde_json::from_str(&payload_text).unwrap_or(JsonValue::Null);

    Ok(EvolutionSignal {
        id: row
            .try_get("id")
            .map_err(|err| format!("evolution signal row id: {err}"))?,
        source,
        status,
        classification,
        session_id: row
            .try_get::<Option<String>, _>("session_id")
            .map_err(|err| format!("evolution signal row session_id: {err}"))?,
        trace_id: row
            .try_get::<Option<String>, _>("trace_id")
            .map_err(|err| format!("evolution signal row trace_id: {err}"))?,
        run_id: row
            .try_get::<Option<String>, _>("run_id")
            .map_err(|err| format!("evolution signal row run_id: {err}"))?,
        monitor_task_id: row
            .try_get::<Option<String>, _>("monitor_task_id")
            .map_err(|err| format!("evolution signal row monitor_task_id: {err}"))?,
        monitor_log_id: row
            .try_get::<Option<String>, _>("monitor_log_id")
            .map_err(|err| format!("evolution signal row monitor_log_id: {err}"))?,
        fingerprint_key: row
            .try_get::<Option<String>, _>("fingerprint_key")
            .map_err(|err| format!("evolution signal row fingerprint_key: {err}"))?,
        confidence: row
            .try_get::<f64, _>("confidence")
            .map_err(|err| format!("evolution signal row confidence: {err}"))?,
        payload_json,
        note: row
            .try_get::<Option<String>, _>("note")
            .map_err(|err| format!("evolution signal row note: {err}"))?,
        created_at_unix_ms: row
            .try_get::<i64, _>("created_at_unix_ms")
            .map_err(|err| format!("evolution signal row created_at: {err}"))?,
    })
}

pub(crate) async fn insert_signal(
    store: &McpStore,
    draft: EvolutionSignalDraft,
    status: EvolutionSignalStatus,
) -> Result<EvolutionSignal, String> {
    let id = Uuid::new_v4().to_string();
    let created_at_unix_ms = now_unix_ms();
    let payload_text = serde_json::to_string(&draft.payload_json)
        .map_err(|err| format!("evolution signal payload encode: {err}"))?;
    let confidence = draft.confidence.clamp(0.0, 1.0);
    let session_id = normalize_optional(draft.session_id);
    let trace_id = normalize_optional(draft.trace_id);
    let run_id = normalize_optional(draft.run_id);
    let monitor_task_id = normalize_optional(draft.monitor_task_id);
    let monitor_log_id = normalize_optional(draft.monitor_log_id);
    let fingerprint_key = normalize_optional(draft.fingerprint_key);
    let note = normalize_optional(draft.note);

    sqlx::query(
        r#"
        INSERT INTO evolution_signals (
          id, source, status, classification,
          session_id, trace_id, run_id,
          monitor_task_id, monitor_log_id,
          fingerprint_key, confidence,
          payload_json, note, created_at_unix_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(draft.source.as_canonical_str())
    .bind(status.as_canonical_str())
    .bind(draft.classification.as_canonical_str())
    .bind(session_id.as_deref())
    .bind(trace_id.as_deref())
    .bind(run_id.as_deref())
    .bind(monitor_task_id.as_deref())
    .bind(monitor_log_id.as_deref())
    .bind(fingerprint_key.as_deref())
    .bind(confidence)
    .bind(&payload_text)
    .bind(note.as_deref())
    .bind(created_at_unix_ms)
    .execute(&store.write_pool)
    .await
    .map_err(|err| format!("evolution signal insert: {err}"))?;

    Ok(EvolutionSignal {
        id,
        source: draft.source,
        status,
        classification: draft.classification,
        session_id,
        trace_id,
        run_id,
        monitor_task_id,
        monitor_log_id,
        fingerprint_key,
        confidence,
        payload_json: draft.payload_json,
        note,
        created_at_unix_ms,
    })
}

pub(crate) async fn update_signal_status(
    store: &McpStore,
    signal_id: &str,
    new_status: EvolutionSignalStatus,
) -> Result<(), String> {
    sqlx::query(
        r#"
        UPDATE evolution_signals
        SET status = ?
        WHERE id = ?
        "#,
    )
    .bind(new_status.as_canonical_str())
    .bind(signal_id.trim())
    .execute(&store.write_pool)
    .await
    .map_err(|err| format!("evolution signal status update: {err}"))?;
    Ok(())
}

pub(crate) async fn insert_case(
    store: &McpStore,
    fingerprint_key: &str,
    case_type: EvolutionCaseType,
    summary: &str,
    evidence_signal_ids: &[String],
    source_run_id: Option<&str>,
    confidence: f64,
) -> Result<EvolutionCase, String> {
    let id = Uuid::new_v4().to_string();
    let created_at_unix_ms = now_unix_ms();
    let evidence_text = serde_json::to_string(evidence_signal_ids)
        .map_err(|err| format!("evolution case evidence encode: {err}"))?;
    let confidence = confidence.clamp(0.0, 1.0);
    let trimmed_fingerprint = fingerprint_key.trim();
    let normalized_source_run = source_run_id
        .map(str::trim)
        .filter(|value| !value.is_empty());

    sqlx::query(
        r#"
        INSERT INTO evolution_cases (
          id, fingerprint_key, case_type, summary,
          evidence_signal_ids, source_run_id, confidence,
          created_at_unix_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(trimmed_fingerprint)
    .bind(case_type.as_canonical_str())
    .bind(summary)
    .bind(&evidence_text)
    .bind(normalized_source_run)
    .bind(confidence)
    .bind(created_at_unix_ms)
    .execute(&store.write_pool)
    .await
    .map_err(|err| format!("evolution case insert: {err}"))?;

    Ok(EvolutionCase {
        id,
        fingerprint_key: trimmed_fingerprint.to_string(),
        case_type,
        summary: summary.to_string(),
        evidence_signal_ids: evidence_signal_ids.to_vec(),
        source_run_id: normalized_source_run.map(str::to_string),
        confidence,
        created_at_unix_ms,
    })
}

pub(crate) async fn list_cases_for_fingerprint(
    store: &McpStore,
    fingerprint_key: &str,
    case_type: EvolutionCaseType,
    limit: usize,
) -> Result<Vec<EvolutionCase>, String> {
    let fp = fingerprint_key.trim();
    if fp.is_empty() {
        return Ok(Vec::new());
    }
    let safe_limit = limit.max(1) as i64;

    let rows = sqlx::query(
        r#"
        SELECT id, fingerprint_key, case_type, summary,
               evidence_signal_ids, source_run_id, confidence,
               created_at_unix_ms
        FROM evolution_cases
        WHERE fingerprint_key = ? AND case_type = ?
        ORDER BY created_at_unix_ms DESC
        LIMIT ?
        "#,
    )
    .bind(fp)
    .bind(case_type.as_canonical_str())
    .bind(safe_limit)
    .fetch_all(&store.pool)
    .await
    .map_err(|err| format!("evolution case list: {err}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let case_type_text: String = row
            .try_get("case_type")
            .map_err(|err| format!("evolution case row case_type: {err}"))?;
        let parsed_case_type = EvolutionCaseType::from_canonical_str(&case_type_text)
            .ok_or_else(|| format!("unknown evolution case_type: {case_type_text}"))?;
        let evidence_text: String = row
            .try_get("evidence_signal_ids")
            .map_err(|err| format!("evolution case row evidence: {err}"))?;
        let evidence_signal_ids: Vec<String> = serde_json::from_str(&evidence_text)
            .map_err(|err| format!("evolution case evidence decode: {err}"))?;
        out.push(EvolutionCase {
            id: row
                .try_get("id")
                .map_err(|err| format!("evolution case row id: {err}"))?,
            fingerprint_key: row
                .try_get("fingerprint_key")
                .map_err(|err| format!("evolution case row fingerprint_key: {err}"))?,
            case_type: parsed_case_type,
            summary: row
                .try_get("summary")
                .map_err(|err| format!("evolution case row summary: {err}"))?,
            evidence_signal_ids,
            source_run_id: row
                .try_get::<Option<String>, _>("source_run_id")
                .map_err(|err| format!("evolution case row source_run_id: {err}"))?,
            confidence: row
                .try_get::<f64, _>("confidence")
                .map_err(|err| format!("evolution case row confidence: {err}"))?,
            created_at_unix_ms: row
                .try_get::<i64, _>("created_at_unix_ms")
                .map_err(|err| format!("evolution case row created_at: {err}"))?,
        });
    }
    Ok(out)
}

pub(crate) async fn list_signals_by_trace(
    store: &McpStore,
    trace_id: &str,
    limit: usize,
) -> Result<Vec<EvolutionSignal>, String> {
    let trace = trace_id.trim();
    if trace.is_empty() {
        return Ok(Vec::new());
    }
    let safe_limit = limit.max(1) as i64;

    let rows = sqlx::query(
        r#"
        SELECT id, source, status, classification,
               session_id, trace_id, run_id,
               monitor_task_id, monitor_log_id,
               fingerprint_key, confidence,
               payload_json, note, created_at_unix_ms
        FROM evolution_signals
        WHERE trace_id = ?
        ORDER BY created_at_unix_ms DESC
        LIMIT ?
        "#,
    )
    .bind(trace)
    .bind(safe_limit)
    .fetch_all(&store.pool)
    .await
    .map_err(|err| format!("evolution signal list by trace: {err}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(signal_from_row(&row)?);
    }
    Ok(out)
}

pub(crate) async fn count_signals_for_query(
    store: &McpStore,
    query: &LocalEvolutionSignalQuery,
) -> Result<i64, String> {
    let mut builder =
        QueryBuilder::<Sqlite>::new("SELECT COUNT(*) AS total FROM evolution_signals WHERE 1=1");
    push_signal_filters(query, &mut builder);
    let row = builder
        .build()
        .fetch_one(&store.pool)
        .await
        .map_err(|err| format!("evolution signal count: {err}"))?;
    row.try_get::<i64, _>("total")
        .map_err(|err| format!("evolution signal count row: {err}"))
}

pub(crate) async fn list_signals_for_query(
    store: &McpStore,
    query: &LocalEvolutionSignalQuery,
    skip: usize,
    limit: usize,
) -> Result<Vec<EvolutionSignal>, String> {
    let mut builder = QueryBuilder::<Sqlite>::new(
        r#"
        SELECT id, source, status, classification,
               session_id, trace_id, run_id,
               monitor_task_id, monitor_log_id,
               fingerprint_key, confidence,
               payload_json, note, created_at_unix_ms
        FROM evolution_signals
        WHERE 1=1
        "#,
    );
    push_signal_filters(query, &mut builder);
    builder
        .push(" ORDER BY created_at_unix_ms DESC LIMIT ")
        .push_bind(limit.max(1) as i64)
        .push(" OFFSET ")
        .push_bind(skip as i64);

    let rows = builder
        .build()
        .fetch_all(&store.pool)
        .await
        .map_err(|err| format!("evolution signal list: {err}"))?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(signal_from_row(&row)?);
    }
    Ok(out)
}
