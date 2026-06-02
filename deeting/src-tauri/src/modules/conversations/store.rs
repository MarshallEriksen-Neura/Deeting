use sqlx::{sqlite::SqliteRow, Row, Sqlite};
use uuid::Uuid;

use crate::modules::conversations::commands::build_fact_extraction_new_chat_marker_key;
use crate::modules::conversations::fact_sync::{
    build_fact_extraction_last_hash_key, build_fact_extraction_last_run_at_key,
};
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use mcp_core::types::LocalChatInputMessage;
use mcp_session::admin::*;
use mcp_session::context::{
    LocalConversationChatContext, LocalConversationRegenerateContext,
    LocalConversationRuntimeWindow, LocalConversationTitleContext,
};
use mcp_session::conversation::*;
use mcp_storage::helpers::{
    estimate_token_count, now_rfc3339, now_unix_epoch, parse_rfc3339_to_unix_epoch,
};
use mcp_storage::types::{LocalConversationSummaryJob, LocalPeriodicTask};
use serde_json::Value;

const CONVERSATION_SUMMARY_JOB_STATUS_PENDING: &str = "pending";
const CONVERSATION_SUMMARY_JOB_STATUS_RUNNING: &str = "running";
const CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED: &str = "completed";
const CONVERSATION_SUMMARY_JOB_STATUS_FAILED: &str = "failed";
const CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS: i64 = 5;
const LOCAL_CONVERSATION_ACTIVE_WINDOW_TURN_CAP_INTERNAL: i64 = 48;
const LOCAL_CONVERSATION_ACTIVE_WINDOW_TOKENS_INTERNAL: i64 = 32768;
const LOCAL_CONVERSATION_FLUSH_THRESHOLD_TOKENS: i64 = 262144;
const LOCAL_CONVERSATION_SUMMARY_IDLE_SECONDS: i64 = 600;
const LOCAL_CONVERSATION_IDLE_CHECK_BATCH_SIZE: i64 = 50;
const LOCAL_PERIODIC_TASK_MAX_ERROR_CHARS: usize = 2000;
const SQLITE_BUSY_RETRY_DELAYS_MS: [u64; 3] = [150, 400, 900];
pub(crate) const CHAT_HISTORY_RETENTION_CONFIG_KEY: &str = "chat.history_retention_days";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LocalConversationModelContext {
    pub(crate) last_model_id: Option<String>,
    pub(crate) last_provider_model_id: Option<String>,
    pub(crate) pinned_model_key: Option<String>,
    pub(crate) pinned_provider_model_id: Option<String>,
}

fn is_sqlite_busy_error(err: &McpError) -> bool {
    let text = err.to_string().to_ascii_lowercase();
    text.contains("database is locked")
        || text.contains("sqlite_busy")
        || text.contains("(code: 5)")
}

fn storage_step_error(step: &str, err: impl std::fmt::Display) -> McpError {
    McpError::Storage(format!("append_message step={} err={}", step, err))
}

fn update_assistant_meta_step_error(step: &str, err: impl std::fmt::Display) -> McpError {
    McpError::Storage(format!("update_assistant_meta step={} err={}", step, err))
}

pub(crate) fn parse_chat_history_retention_days(value: Option<String>) -> Option<i64> {
    let raw = value?.trim().to_string();
    if raw.is_empty() {
        return None;
    }
    let parsed = raw.parse::<i64>().ok()?;
    if parsed <= 0 {
        None
    } else {
        Some(parsed)
    }
}

fn build_session_scoped_fact_extraction_marker_keys(session_id: &str) -> [String; 3] {
    [
        build_fact_extraction_new_chat_marker_key(session_id),
        build_fact_extraction_last_hash_key(session_id),
        build_fact_extraction_last_run_at_key(session_id),
    ]
}

fn local_conversation_row_token_estimate(row: &SqliteRow) -> i64 {
    row.try_get::<i64, _>("token_estimate").unwrap_or(0).max(0)
}

fn local_conversation_row_turn_index(row: &SqliteRow) -> i64 {
    row.try_get::<i64, _>("turn_index").unwrap_or(0)
}

fn filter_local_rows_outside_summary_coverage(
    rows: Vec<SqliteRow>,
    summary_coverage: Option<(i64, i64)>,
) -> Vec<SqliteRow> {
    let Some((covered_from_turn, covered_to_turn)) = summary_coverage else {
        return rows;
    };

    rows.into_iter()
        .filter(|row| {
            let turn_index = local_conversation_row_turn_index(row);
            turn_index < covered_from_turn || turn_index > covered_to_turn
        })
        .collect()
}

fn trim_local_active_window_rows(rows: Vec<SqliteRow>) -> Vec<SqliteRow> {
    let mut selected_rows = Vec::new();
    let mut total_tokens = 0_i64;

    for row in rows.into_iter() {
        let next_total = total_tokens.saturating_add(local_conversation_row_token_estimate(&row));
        if !selected_rows.is_empty()
            && next_total > LOCAL_CONVERSATION_ACTIVE_WINDOW_TOKENS_INTERNAL
        {
            break;
        }
        total_tokens = next_total;
        selected_rows.push(row);
    }

    selected_rows.reverse();
    selected_rows
}

fn select_local_active_window_rows(
    rows: Vec<SqliteRow>,
    summary_coverage: Option<(i64, i64)>,
) -> Vec<SqliteRow> {
    trim_local_active_window_rows(filter_local_rows_outside_summary_coverage(
        rows,
        summary_coverage,
    ))
}

fn sum_local_conversation_row_tokens(rows: &[SqliteRow]) -> i64 {
    rows.iter().fold(0_i64, |acc, row| {
        acc.saturating_add(local_conversation_row_token_estimate(row))
    })
}

async fn fetch_local_summary_row_by_version<'e, E>(
    executor: E,
    session_id: &str,
    version: i64,
) -> Result<Option<SqliteRow>, McpError>
where
    E: sqlx::Executor<'e, Database = Sqlite>,
{
    sqlx::query(
        r#"
        SELECT
          id, version, summary_text, covered_from_turn, covered_to_turn,
          token_estimate, summarizer_model, created_at, updated_at
        FROM conversation_summary
        WHERE session_id = ? AND version = ?
        LIMIT 1;
        "#,
    )
    .bind(session_id)
    .bind(version)
    .fetch_optional(executor)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))
}

fn conversation_json_text(value: Option<&Value>) -> Result<Option<String>, McpError> {
    value
        .map(serde_json::to_string)
        .transpose()
        .map_err(|err| McpError::Storage(err.to_string()))
}

fn parse_optional_json_text(value: Option<String>) -> Result<Option<Value>, McpError> {
    match value {
        Some(text) if !text.trim().is_empty() => serde_json::from_str(&text)
            .map(Some)
            .map_err(|err| McpError::Storage(err.to_string())),
        _ => Ok(None),
    }
}

fn extract_execution_tree(meta_info: Option<&Value>) -> Option<&serde_json::Map<String, Value>> {
    meta_info
        .and_then(|value| value.get("execution_tree"))
        .and_then(Value::as_object)
}

async fn sync_conversation_execution_tree_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    session_id: &str,
    message_id: &str,
    turn_index: i64,
    meta_info: Option<&Value>,
    now: &str,
) -> Result<(), McpError> {
    let Some(tree) = extract_execution_tree(meta_info) else {
        return Ok(());
    };

    let root_execution_id = tree
        .get("root_execution_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            tree.get("execution_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .ok_or_else(|| McpError::validation("execution_tree.root_execution_id is required"))?
        .to_string();

    let execution_id = tree
        .get("execution_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(root_execution_id.as_str())
        .to_string();
    let execution_kind = tree
        .get("execution_kind")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_string();
    let execution_status = tree
        .get("execution_status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_string();
    let terminal_status = tree
        .get("terminal_status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(execution_status.as_str())
        .to_string();
    let target = tree.get("target").and_then(Value::as_object);
    let delegated_result = tree.get("delegated_result").and_then(Value::as_object);
    let selection = conversation_json_text(tree.get("selection"))?;
    let available_actions = conversation_json_text(tree.get("available_actions"))?;
    let result_payload = conversation_json_text(
        tree.get("result_payload")
            .or_else(|| delegated_result.and_then(|value| value.get("primary_output"))),
    )?;
    let raw_json = conversation_json_text(Some(&Value::Object(tree.clone())))?;
    let schema_version = tree
        .get("schema_version")
        .and_then(Value::as_i64)
        .unwrap_or(1);
    let summary = tree
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let error = tree
        .get("error")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let started_at_ms = tree.get("started_at_ms").and_then(Value::as_i64);
    let completed_at_ms = tree.get("completed_at_ms").and_then(Value::as_i64);

    sqlx::query(
        r#"
        INSERT INTO conversation_execution_root (
          root_execution_id, session_id, message_id, turn_index, schema_version,
          execution_id, execution_kind, execution_status, terminal_status,
          target_id, target_name, target_invocation_kind, target_worker_ref, target_workflow_run_id,
          selection_json, available_actions_json, summary, error, result_payload_json, raw_json,
          started_at_ms, completed_at_ms, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(root_execution_id) DO UPDATE SET
          session_id = excluded.session_id,
          message_id = excluded.message_id,
          turn_index = excluded.turn_index,
          schema_version = excluded.schema_version,
          execution_id = excluded.execution_id,
          execution_kind = excluded.execution_kind,
          execution_status = excluded.execution_status,
          terminal_status = excluded.terminal_status,
          target_id = excluded.target_id,
          target_name = excluded.target_name,
          target_invocation_kind = excluded.target_invocation_kind,
          target_worker_ref = excluded.target_worker_ref,
          target_workflow_run_id = excluded.target_workflow_run_id,
          selection_json = excluded.selection_json,
          available_actions_json = excluded.available_actions_json,
          summary = excluded.summary,
          error = excluded.error,
          result_payload_json = excluded.result_payload_json,
          raw_json = excluded.raw_json,
          started_at_ms = excluded.started_at_ms,
          completed_at_ms = excluded.completed_at_ms,
          updated_at = excluded.updated_at;
        "#,
    )
    .bind(&root_execution_id)
    .bind(session_id)
    .bind(message_id)
    .bind(turn_index)
    .bind(schema_version)
    .bind(&execution_id)
    .bind(&execution_kind)
    .bind(&execution_status)
    .bind(&terminal_status)
    .bind(
        target
            .and_then(|value| value.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(
        target
            .and_then(|value| value.get("name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(
        target
            .and_then(|value| value.get("invocation_kind"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(
        target
            .and_then(|value| value.get("worker_ref"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(
        target
            .and_then(|value| value.get("workflow_run_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(selection)
    .bind(available_actions)
    .bind(summary)
    .bind(error)
    .bind(result_payload)
    .bind(raw_json)
    .bind(started_at_ms)
    .bind(completed_at_ms)
    .bind(now)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        DELETE FROM conversation_execution_child
        WHERE root_execution_id = ?;
        "#,
    )
    .bind(&root_execution_id)
    .execute(&mut **tx)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    let children = tree
        .get("children")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for (index, child) in children.into_iter().enumerate() {
        let Some(child_object) = child.as_object() else {
            continue;
        };
        let child_id = child_object
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{}:child-{}", root_execution_id, index + 1));
        let available_actions = conversation_json_text(child_object.get("available_actions"))?;
        let raw_json = conversation_json_text(Some(&Value::Object(child_object.clone())))?;

        sqlx::query(
            r#"
            INSERT INTO conversation_execution_child (
              id, root_execution_id, session_id, message_id, phase_id, step_type,
              title, status, worker_ref, summary, error, available_actions_json, raw_json,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&child_id)
        .bind(&root_execution_id)
        .bind(session_id)
        .bind(message_id)
        .bind(
            child_object
                .get("phase_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            child_object
                .get("step_type")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            child_object
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("Execution Child"),
        )
        .bind(
            child_object
                .get("status")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("unknown"),
        )
        .bind(
            child_object
                .get("worker_ref")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            child_object
                .get("summary")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            child_object
                .get("error")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(available_actions)
        .bind(raw_json)
        .bind(now)
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    }

    Ok(())
}

pub(crate) async fn init_conversation_tables(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS conversation_session (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          user_id TEXT,
          assistant_id TEXT,
          channel TEXT NOT NULL DEFAULT 'internal',
          status TEXT NOT NULL DEFAULT 'active',
          preset_id TEXT,
          title TEXT,
          message_count INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          last_summary_version INTEGER NOT NULL DEFAULT 0,
          summarizing INTEGER NOT NULL DEFAULT 0,
          summary_job_id TEXT,
          last_summary_generated_at TEXT,
          last_model_id TEXT,
          last_provider_model_id TEXT,
          pinned_model_key TEXT,
          pinned_provider_model_id TEXT,
          pinned_binding_source TEXT,
          first_message_at TEXT,
          last_active_at TEXT NOT NULL,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    // Migration: Add is_pinned column if it doesn't exist (for existing databases)
    let _ = sqlx::query(
        r#"
        ALTER TABLE conversation_session ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
        "#,
    )
    .execute(&store.write_pool)
    .await;
    // Ignore error if column already exists

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS conversation_message (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES conversation_session(id) ON DELETE CASCADE,
          turn_index INTEGER NOT NULL,
          role TEXT NOT NULL,
          name TEXT,
          content TEXT,
          meta_info TEXT,
          used_persona_id TEXT,
          token_estimate INTEGER NOT NULL DEFAULT 0,
          is_truncated INTEGER NOT NULL DEFAULT 0,
          is_deleted INTEGER NOT NULL DEFAULT 0,
          parent_message_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS conversation_summary (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES conversation_session(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          summary_text TEXT NOT NULL,
          covered_from_turn INTEGER NOT NULL,
          covered_to_turn INTEGER NOT NULL,
          previous_summary_id TEXT,
          start_message_id TEXT,
          end_message_id TEXT,
          token_estimate INTEGER NOT NULL DEFAULT 0,
          summarizer_model TEXT,
          summarizer_preset_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS conversation_execution_root (
          root_execution_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES conversation_session(id) ON DELETE CASCADE,
          message_id TEXT NOT NULL REFERENCES conversation_message(id) ON DELETE CASCADE,
          turn_index INTEGER NOT NULL,
          schema_version INTEGER NOT NULL DEFAULT 1,
          execution_id TEXT NOT NULL,
          execution_kind TEXT NOT NULL,
          execution_status TEXT NOT NULL,
          terminal_status TEXT NOT NULL,
          target_id TEXT,
          target_name TEXT,
          target_invocation_kind TEXT,
          target_worker_ref TEXT,
          target_workflow_run_id TEXT,
          selection_json TEXT,
          available_actions_json TEXT,
          summary TEXT,
          error TEXT,
          result_payload_json TEXT,
          raw_json TEXT,
          started_at_ms INTEGER,
          completed_at_ms INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS conversation_execution_child (
          id TEXT PRIMARY KEY,
          root_execution_id TEXT NOT NULL REFERENCES conversation_execution_root(root_execution_id) ON DELETE CASCADE,
          session_id TEXT NOT NULL REFERENCES conversation_session(id) ON DELETE CASCADE,
          message_id TEXT NOT NULL REFERENCES conversation_message(id) ON DELETE CASCADE,
          phase_id TEXT,
          step_type TEXT,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          worker_ref TEXT,
          summary TEXT,
          error TEXT,
          available_actions_json TEXT,
          raw_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS conversation_summary_job (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES conversation_session(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          trigger_source TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          available_after_epoch INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS conversation_summary_idle_task (
          session_id TEXT PRIMARY KEY REFERENCES conversation_session(id) ON DELETE CASCADE,
          last_active_epoch INTEGER NOT NULL,
          run_after_epoch INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS local_periodic_task (
          task_name TEXT PRIMARY KEY,
          interval_seconds INTEGER NOT NULL,
          next_run_after_epoch INTEGER NOT NULL,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          last_run_at TEXT,
          last_success_at TEXT,
          last_error TEXT,
          last_error_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_conversation_session_assistant_id
        ON conversation_session(assistant_id);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_conversation_session_status_last_active
        ON conversation_session(status, last_active_at DESC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_conversation_execution_root_session_turn
        ON conversation_execution_root(session_id, turn_index DESC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_conversation_execution_root_message_id
        ON conversation_execution_root(message_id);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_conversation_execution_root_workflow_run
        ON conversation_execution_root(target_workflow_run_id);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_conversation_execution_child_root
        ON conversation_execution_child(root_execution_id);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_conversation_execution_child_session
        ON conversation_execution_child(session_id);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_message_turn
        ON conversation_message(session_id, turn_index);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_conversation_message_session_turn
        ON conversation_message(session_id, turn_index DESC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_summary_version
        ON conversation_summary(session_id, version);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_conversation_summary_job_status_available
        ON conversation_summary_job(status, available_after_epoch ASC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_conversation_summary_job_session_status
        ON conversation_summary_job(session_id, status);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_conversation_summary_idle_task_due
        ON conversation_summary_idle_task(run_after_epoch ASC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_local_periodic_task_enabled_due
        ON local_periodic_task(is_enabled, next_run_after_epoch ASC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_summary_job_pending_session
        ON conversation_summary_job(session_id)
        WHERE status = 'pending';
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_summary_job_running_session
        ON conversation_summary_job(session_id)
        WHERE status = 'running';
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    store
        .ensure_column(
            "conversation_session",
            "total_tokens",
            "ALTER TABLE conversation_session ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;",
        )
        .await?;
    store
        .ensure_column(
            "conversation_session",
            "summarizing",
            "ALTER TABLE conversation_session ADD COLUMN summarizing INTEGER NOT NULL DEFAULT 0;",
        )
        .await?;
    store
        .ensure_column(
            "conversation_session",
            "summary_job_id",
            "ALTER TABLE conversation_session ADD COLUMN summary_job_id TEXT;",
        )
        .await?;
    store
        .ensure_column(
            "conversation_session",
            "last_summary_generated_at",
            "ALTER TABLE conversation_session ADD COLUMN last_summary_generated_at TEXT;",
        )
        .await?;
    store
        .ensure_column(
            "conversation_session",
            "last_model_id",
            "ALTER TABLE conversation_session ADD COLUMN last_model_id TEXT;",
        )
        .await?;
    store
        .ensure_column(
            "conversation_session",
            "last_provider_model_id",
            "ALTER TABLE conversation_session ADD COLUMN last_provider_model_id TEXT;",
        )
        .await?;
    store
        .ensure_column(
            "conversation_session",
            "pinned_model_key",
            "ALTER TABLE conversation_session ADD COLUMN pinned_model_key TEXT;",
        )
        .await?;
    store
        .ensure_column(
            "conversation_session",
            "pinned_provider_model_id",
            "ALTER TABLE conversation_session ADD COLUMN pinned_provider_model_id TEXT;",
        )
        .await?;
    store
        .ensure_column(
            "conversation_session",
            "pinned_binding_source",
            "ALTER TABLE conversation_session ADD COLUMN pinned_binding_source TEXT;",
        )
        .await?;

    Ok(())
}

impl McpStore {
    async fn compute_local_conversation_runtime_tokens_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        session_id: &str,
    ) -> Result<i64, McpError> {
        let session_row = sqlx::query(
            r#"
            SELECT last_summary_version
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(session_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let last_summary_version = session_row
            .try_get::<i64, _>("last_summary_version")
            .unwrap_or(0);
        let summary_coverage = if last_summary_version > 0 {
            fetch_local_summary_row_by_version(&mut **tx, session_id, last_summary_version)
                .await?
                .and_then(|row| {
                    Some((
                        row.try_get::<i64, _>("covered_from_turn").ok()?,
                        row.try_get::<i64, _>("covered_to_turn").ok()?,
                    ))
                })
        } else {
            None
        };

        let recent_rows = sqlx::query(
            r#"
            SELECT turn_index, token_estimate
            FROM conversation_message
            WHERE session_id = ? AND is_deleted = 0
            ORDER BY turn_index DESC
            LIMIT ?;
            "#,
        )
        .bind(session_id)
        .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURN_CAP_INTERNAL)
        .fetch_all(&mut **tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let active_rows = select_local_active_window_rows(recent_rows, summary_coverage);
        Ok(sum_local_conversation_row_tokens(&active_rows))
    }

    pub async fn finalize_local_compare_winner(
        &self,
        request: LocalConversationCompareFinalizeRequest,
    ) -> Result<LocalConversationCompareFinalizeResponse, McpError> {
        let session_id = request.session_id.trim().to_string();
        if session_id.is_empty() {
            return Err(McpError::Validation("session_id is required".to_string()));
        }

        let model_id = request.model_id.trim().to_string();
        if model_id.is_empty() {
            return Err(McpError::Validation("model_id is required".to_string()));
        }

        let blocks = request.blocks.unwrap_or_default();
        if blocks.is_empty() {
            return Err(McpError::Validation("blocks is required".to_string()));
        }

        let provider_model_id = request
            .provider_model_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);

        let regenerate_context = self
            .prepare_local_conversation_regenerate(&session_id)
            .await?;
        let replaced_turn_index = regenerate_context.deleted_turn_index.ok_or_else(|| {
            McpError::Validation("latest assistant message not found".to_string())
        })?;

        self.update_local_conversation_model_context(
            &session_id,
            Some(model_id.as_str()),
            provider_model_id.as_deref(),
        )
        .await?;

        let mut meta = serde_json::Map::new();
        meta.insert("model_id".to_string(), Value::String(model_id));
        if let Some(provider_model_id) = provider_model_id.clone() {
            meta.insert(
                "provider_model_id".to_string(),
                Value::String(provider_model_id),
            );
        }
        if !blocks.is_empty() {
            meta.insert("blocks".to_string(), Value::Array(blocks));
        }
        meta.insert("compare_winner".to_string(), Value::Bool(true));

        let message = self
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session_id.clone(),
                role: "assistant".to_string(),
                content: String::new(),
                name: None,
                meta_info: Some(Value::Object(meta)),
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await?;

        Ok(LocalConversationCompareFinalizeResponse {
            session_id,
            replaced_turn_index,
            message,
        })
    }

    pub async fn list_local_admin_conversations(
        &self,
        query: LocalAdminConversationQuery,
    ) -> Result<LocalAdminConversationListResponse, McpError> {
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(100).clamp(1, 1000);
        let status = query.status.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let channel = query.channel.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let user_id = query.user_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let assistant_id = query.assistant_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let start_time = query.start_time.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let end_time = query.end_time.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM conversation_session
            WHERE (? IS NULL OR status = ?)
              AND (? IS NULL OR channel = ?)
              AND (? IS NULL OR user_id = ?)
              AND (? IS NULL OR assistant_id = ?)
              AND (? IS NULL OR last_active_at >= ?)
              AND (? IS NULL OR last_active_at <= ?);
            "#,
        )
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(channel.as_deref())
        .bind(channel.as_deref())
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(assistant_id.as_deref())
        .bind(assistant_id.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              id, title, user_id, assistant_id, channel, status,
              message_count, first_message_at, last_active_at, last_summary_version,
              created_at, updated_at
            FROM conversation_session
            WHERE (? IS NULL OR status = ?)
              AND (? IS NULL OR channel = ?)
              AND (? IS NULL OR user_id = ?)
              AND (? IS NULL OR assistant_id = ?)
              AND (? IS NULL OR last_active_at >= ?)
              AND (? IS NULL OR last_active_at <= ?)
            ORDER BY last_active_at DESC, id DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(channel.as_deref())
        .bind(channel.as_deref())
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(assistant_id.as_deref())
        .bind(assistant_id.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalAdminConversationItem {
                id: row.try_get("id")?,
                title: row.try_get("title")?,
                user_id: row.try_get("user_id")?,
                assistant_id: row.try_get("assistant_id")?,
                channel: row.try_get::<String, _>("channel")?,
                status: row.try_get::<String, _>("status")?,
                message_count: row.try_get::<i64, _>("message_count").unwrap_or(0),
                first_message_at: row.try_get("first_message_at")?,
                last_active_at: row.try_get("last_active_at")?,
                last_summary_version: row.try_get::<i64, _>("last_summary_version").unwrap_or(0),
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(LocalAdminConversationListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn get_local_admin_conversation(
        &self,
        session_id: &str,
    ) -> Result<LocalAdminConversationItem, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT
              id, title, user_id, assistant_id, channel, status,
              message_count, first_message_at, last_active_at, last_summary_version,
              created_at, updated_at
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        Ok(LocalAdminConversationItem {
            id: row.try_get("id")?,
            title: row.try_get("title")?,
            user_id: row.try_get("user_id")?,
            assistant_id: row.try_get("assistant_id")?,
            channel: row.try_get::<String, _>("channel")?,
            status: row.try_get::<String, _>("status")?,
            message_count: row.try_get::<i64, _>("message_count").unwrap_or(0),
            first_message_at: row.try_get("first_message_at")?,
            last_active_at: row.try_get("last_active_at")?,
            last_summary_version: row.try_get::<i64, _>("last_summary_version").unwrap_or(0),
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    pub async fn list_local_admin_conversation_messages(
        &self,
        session_id: &str,
        query: LocalAdminConversationMessageQuery,
    ) -> Result<LocalAdminConversationMessageListResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(50).clamp(1, 200);
        let include_deleted = query.include_deleted.unwrap_or(true);
        let include_deleted_flag = if include_deleted { 1_i64 } else { 0_i64 };

        let session_exists = sqlx::query(
            r#"
            SELECT id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM conversation_message
            WHERE session_id = ?
              AND (? = 1 OR is_deleted = 0);
            "#,
        )
        .bind(&normalized_session_id)
        .bind(include_deleted_flag)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              id, session_id, turn_index, role, content, name, token_estimate, meta_info,
              used_persona_id, is_deleted, parent_message_id, created_at, updated_at
            FROM conversation_message
            WHERE session_id = ?
              AND (? = 1 OR is_deleted = 0)
            ORDER BY turn_index ASC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(include_deleted_flag)
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let meta_info_text: Option<String> = row.try_get("meta_info")?;
            items.push(LocalAdminConversationMessageItem {
                id: row.try_get("id")?,
                session_id: row.try_get("session_id")?,
                turn_index: row.try_get("turn_index")?,
                role: row.try_get("role")?,
                content: row.try_get("content")?,
                name: row.try_get("name")?,
                token_estimate: row.try_get::<i64, _>("token_estimate").unwrap_or(0),
                meta_info: match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                },
                used_persona_id: row.try_get("used_persona_id")?,
                is_deleted: row.try_get::<i64, _>("is_deleted").unwrap_or(0) != 0,
                parent_message_id: row.try_get("parent_message_id")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(LocalAdminConversationMessageListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn list_local_admin_conversation_summaries(
        &self,
        session_id: &str,
    ) -> Result<LocalAdminConversationSummaryListResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_exists = sqlx::query(
            r#"
            SELECT id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        let rows = sqlx::query(
            r#"
            SELECT
              id, session_id, version, summary_text, covered_from_turn, covered_to_turn,
              token_estimate, summarizer_model, created_at, updated_at
            FROM conversation_summary
            WHERE session_id = ?
            ORDER BY version DESC;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalAdminConversationSummaryItem {
                id: row.try_get("id")?,
                session_id: row.try_get("session_id")?,
                version: row.try_get("version")?,
                summary_text: row.try_get("summary_text")?,
                covered_from_turn: row.try_get("covered_from_turn")?,
                covered_to_turn: row.try_get("covered_to_turn")?,
                token_estimate: row.try_get::<i64, _>("token_estimate").unwrap_or(0),
                summarizer_model: row.try_get("summarizer_model")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(LocalAdminConversationSummaryListResponse { items })
    }

    pub async fn list_local_conversation_summary_jobs(
        &self,
        query: LocalConversationSummaryJobQuery,
    ) -> Result<LocalConversationSummaryJobListResponse, McpError> {
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(100).clamp(1, 1000);
        let status = query.status.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let session_id = query.session_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let error_contains = query.error_contains.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let error_like = error_contains
            .as_ref()
            .map(|value| format!("%{}%", value.replace('%', "\\%").replace('_', "\\_")));

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM conversation_summary_job
            WHERE (? IS NULL OR status = ?)
              AND (? IS NULL OR session_id = ?)
              AND (? IS NULL OR (last_error IS NOT NULL AND last_error LIKE ? ESCAPE '\'));
            "#,
        )
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(session_id.as_deref())
        .bind(session_id.as_deref())
        .bind(error_like.as_deref())
        .bind(error_like.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              id, session_id, status, trigger_source, attempts, max_attempts,
              available_after_epoch, last_error, created_at, updated_at
            FROM conversation_summary_job
            WHERE (? IS NULL OR status = ?)
              AND (? IS NULL OR session_id = ?)
              AND (? IS NULL OR (last_error IS NOT NULL AND last_error LIKE ? ESCAPE '\'))
            ORDER BY updated_at DESC, id DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(session_id.as_deref())
        .bind(session_id.as_deref())
        .bind(error_like.as_deref())
        .bind(error_like.as_deref())
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalConversationSummaryJobItem {
                id: row.try_get("id")?,
                session_id: row.try_get("session_id")?,
                status: row.try_get("status")?,
                trigger_source: row.try_get("trigger_source")?,
                attempts: row.try_get::<i64, _>("attempts").unwrap_or(0),
                max_attempts: row
                    .try_get::<i64, _>("max_attempts")
                    .unwrap_or(CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS),
                available_after_epoch: row.try_get::<i64, _>("available_after_epoch").unwrap_or(0),
                last_error: row.try_get("last_error")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(LocalConversationSummaryJobListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn list_local_conversation_summary_idle_tasks(
        &self,
        query: LocalConversationSummaryIdleTaskQuery,
    ) -> Result<LocalConversationSummaryIdleTaskListResponse, McpError> {
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(100).clamp(1, 1000);
        let session_id = query.session_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let now_epoch = now_unix_epoch()?;

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM conversation_summary_idle_task
            WHERE (? IS NULL OR session_id = ?);
            "#,
        )
        .bind(session_id.as_deref())
        .bind(session_id.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              session_id, last_active_epoch, run_after_epoch, created_at, updated_at
            FROM conversation_summary_idle_task
            WHERE (? IS NULL OR session_id = ?)
            ORDER BY run_after_epoch ASC, session_id ASC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(session_id.as_deref())
        .bind(session_id.as_deref())
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let run_after_epoch = row.try_get::<i64, _>("run_after_epoch").unwrap_or(0);
            items.push(LocalConversationSummaryIdleTaskItem {
                session_id: row.try_get("session_id")?,
                last_active_epoch: row.try_get::<i64, _>("last_active_epoch").unwrap_or(0),
                run_after_epoch,
                is_due: run_after_epoch <= now_epoch,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(LocalConversationSummaryIdleTaskListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn get_local_conversation_summary_queue_stats(
        &self,
    ) -> Result<LocalConversationSummaryQueueStats, McpError> {
        let now_epoch = now_unix_epoch()?;
        let job_row = sqlx::query(
            r#"
            SELECT
              SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS pending_jobs,
              SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS running_jobs,
              SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS completed_jobs,
              SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS failed_jobs
            FROM conversation_summary_job;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_FAILED)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let pending_jobs = job_row
            .try_get::<Option<i64>, _>("pending_jobs")
            .ok()
            .flatten()
            .unwrap_or(0);
        let running_jobs = job_row
            .try_get::<Option<i64>, _>("running_jobs")
            .ok()
            .flatten()
            .unwrap_or(0);
        let completed_jobs = job_row
            .try_get::<Option<i64>, _>("completed_jobs")
            .ok()
            .flatten()
            .unwrap_or(0);
        let failed_jobs = job_row
            .try_get::<Option<i64>, _>("failed_jobs")
            .ok()
            .flatten()
            .unwrap_or(0);

        let idle_row = sqlx::query(
            r#"
            SELECT
              COUNT(*) AS idle_total_tasks,
              SUM(CASE WHEN run_after_epoch <= ? THEN 1 ELSE 0 END) AS idle_due_tasks
            FROM conversation_summary_idle_task;
            "#,
        )
        .bind(now_epoch)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let idle_total_tasks = idle_row
            .try_get::<Option<i64>, _>("idle_total_tasks")
            .ok()
            .flatten()
            .unwrap_or(0);
        let idle_due_tasks = idle_row
            .try_get::<Option<i64>, _>("idle_due_tasks")
            .ok()
            .flatten()
            .unwrap_or(0);

        Ok(LocalConversationSummaryQueueStats {
            pending_jobs,
            running_jobs,
            completed_jobs,
            failed_jobs,
            idle_due_tasks,
            idle_total_tasks,
        })
    }

    pub async fn trigger_local_conversation_summary_job(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationSummaryEnqueueResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        self.enqueue_local_conversation_summary_job(&normalized_session_id, "manual_trigger")
            .await?;

        Ok(LocalConversationSummaryEnqueueResponse {
            session_id: normalized_session_id,
            queued: true,
        })
    }

    pub async fn retry_local_conversation_summary_job(
        &self,
        job_id: &str,
    ) -> Result<LocalConversationSummaryEnqueueResponse, McpError> {
        let normalized_job_id = job_id.trim().to_string();
        if normalized_job_id.is_empty() {
            return Err(McpError::validation("job_id is required"));
        }

        let job_row = sqlx::query(
            r#"
            SELECT session_id, status
            FROM conversation_summary_job
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_job_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation summary job not found".to_string()))?;

        let session_id: String = job_row.try_get("session_id")?;
        let status: String = job_row.try_get("status")?;
        if status == CONVERSATION_SUMMARY_JOB_STATUS_RUNNING {
            return Err(McpError::validation(
                "conversation summary job is running and cannot be retried".to_string(),
            ));
        }

        self.enqueue_local_conversation_summary_job(&session_id, "manual_retry")
            .await?;

        Ok(LocalConversationSummaryEnqueueResponse {
            session_id,
            queued: true,
        })
    }

    pub async fn retry_local_conversation_summary_jobs(
        &self,
        payload: LocalConversationSummaryBatchRetryRequest,
    ) -> Result<LocalConversationSummaryBatchRetryResponse, McpError> {
        let limit = payload.limit.unwrap_or(200).clamp(1, 1000);
        let status = payload.status.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let session_id = payload.session_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let error_contains = payload.error_contains.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let error_like = error_contains
            .as_ref()
            .map(|value| format!("%{}%", value.replace('%', "\\%").replace('_', "\\_")));
        let default_status = CONVERSATION_SUMMARY_JOB_STATUS_FAILED;
        let status_filter = status.as_deref().unwrap_or(default_status);

        let rows = sqlx::query(
            r#"
            SELECT DISTINCT session_id
            FROM conversation_summary_job
            WHERE status = ?
              AND (? IS NULL OR session_id = ?)
              AND (? IS NULL OR (last_error IS NOT NULL AND last_error LIKE ? ESCAPE '\'))
            ORDER BY updated_at DESC, id DESC
            LIMIT ?;
            "#,
        )
        .bind(status_filter)
        .bind(session_id.as_deref())
        .bind(session_id.as_deref())
        .bind(error_like.as_deref())
        .bind(error_like.as_deref())
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let matched_count = i64::try_from(rows.len()).unwrap_or(i64::MAX);
        let mut queued_count = 0_i64;
        for row in rows {
            let target_session_id: String = row.try_get("session_id")?;
            self.enqueue_local_conversation_summary_job(&target_session_id, "manual_retry_batch")
                .await?;
            queued_count = queued_count.saturating_add(1);
        }

        Ok(LocalConversationSummaryBatchRetryResponse {
            matched_count,
            queued_count,
        })
    }

    pub async fn get_local_trace_feedback_meta_by_trace_id(
        &self,
        trace_id: &str,
    ) -> Result<Option<serde_json::Value>, McpError> {
        let normalized_trace_id = trace_id.trim().to_string();
        if normalized_trace_id.is_empty() {
            return Err(McpError::validation("trace_id is required"));
        }

        let gateway_log_row = sqlx::query(
            r#"
            SELECT meta
            FROM gateway_log
            WHERE trace_id = ?
            ORDER BY created_at DESC
            LIMIT 1;
            "#,
        )
        .bind(&normalized_trace_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if let Some(value) = gateway_log_row {
            let meta_text: Option<String> = value.try_get("meta")?;
            if let Some(text) = meta_text {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    if let Ok(meta) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        return Ok(Some(meta));
                    }
                }
            }
        }

        let row = sqlx::query(
            r#"
            SELECT cm.meta_info
            FROM conversation_message cm
            WHERE cm.role = 'assistant'
              AND cm.meta_info IS NOT NULL
              AND json_extract(cm.meta_info, '$.trace_id') = ?
            ORDER BY cm.created_at DESC, cm.turn_index DESC
            LIMIT 1;
            "#,
        )
        .bind(&normalized_trace_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        match row {
            Some(value) => {
                let meta_info_text: Option<String> = value.try_get("meta_info")?;
                let meta_info = match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                };
                Ok(meta_info)
            }
            None => Ok(None),
        }
    }

    pub async fn list_local_conversations(
        &self,
        query: LocalConversationSessionsQuery,
    ) -> Result<LocalConversationSessionPage, McpError> {
        let size = query.size.unwrap_or(24).clamp(1, 100);
        let offset = query
            .cursor
            .as_deref()
            .unwrap_or("0")
            .trim()
            .parse::<i64>()
            .unwrap_or(0)
            .max(0);
        let status = query.status.unwrap_or(LocalConversationStatus::Active);
        let assistant_id = query.assistant_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        let total: i64 = if let Some(assistant_id) = assistant_id.as_deref() {
            let row = sqlx::query(
                r#"
                SELECT COUNT(1) AS total
                FROM conversation_session
                WHERE status = ? AND assistant_id = ?;
                "#,
            )
            .bind(status.as_str())
            .bind(assistant_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            row.try_get("total")?
        } else {
            let row = sqlx::query(
                r#"
                SELECT COUNT(1) AS total
                FROM conversation_session
                WHERE status = ?;
                "#,
            )
            .bind(status.as_str())
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            row.try_get("total")?
        };

        let rows = if let Some(assistant_id) = assistant_id.as_deref() {
            sqlx::query(
                r#"
                SELECT
                  cs.id AS id,
                  cs.title AS title,
                  cs.message_count AS message_count,
                  cs.first_message_at AS first_message_at,
                  cs.last_active_at AS last_active_at,
                  cs.is_pinned AS is_pinned,
                  sm.summary_text AS summary_text
                FROM conversation_session cs
                LEFT JOIN conversation_summary sm
                  ON sm.session_id = cs.id
                 AND sm.version = cs.last_summary_version
                WHERE cs.status = ? AND cs.assistant_id = ?
                ORDER BY cs.is_pinned DESC, cs.last_active_at DESC, cs.id DESC
                LIMIT ? OFFSET ?;
                "#,
            )
            .bind(status.as_str())
            .bind(assistant_id)
            .bind(size)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        } else {
            sqlx::query(
                r#"
                SELECT
                  cs.id AS id,
                  cs.title AS title,
                  cs.message_count AS message_count,
                  cs.first_message_at AS first_message_at,
                  cs.last_active_at AS last_active_at,
                  cs.is_pinned AS is_pinned,
                  sm.summary_text AS summary_text
                FROM conversation_session cs
                LEFT JOIN conversation_summary sm
                  ON sm.session_id = cs.id
                 AND sm.version = cs.last_summary_version
                WHERE cs.status = ?
                ORDER BY cs.is_pinned DESC, cs.last_active_at DESC, cs.id DESC
                LIMIT ? OFFSET ?;
                "#,
            )
            .bind(status.as_str())
            .bind(size)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        };

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalConversationSessionItem {
                session_id: row.try_get("id")?,
                title: row.try_get("title")?,
                summary_text: row.try_get("summary_text")?,
                message_count: row.try_get::<i64, _>("message_count").unwrap_or(0),
                first_message_at: row.try_get("first_message_at")?,
                last_active_at: row.try_get("last_active_at")?,
                is_pinned: row.try_get::<i64, _>("is_pinned").unwrap_or(0) != 0,
            });
        }

        let next_offset = offset + size;
        let next_page = if next_offset < total {
            Some(next_offset.to_string())
        } else {
            None
        };
        let previous_page = if offset > 0 {
            Some((offset - size).max(0).to_string())
        } else {
            None
        };

        Ok(LocalConversationSessionPage {
            items,
            next_page,
            previous_page,
        })
    }

    pub async fn create_local_conversation(
        &self,
        payload: LocalConversationCreateRequest,
    ) -> Result<LocalConversationCreateResponse, McpError> {
        let now = now_rfc3339()?;
        let session_id = Uuid::new_v4().to_string();
        let assistant_id = payload.assistant_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let title = payload.title.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        sqlx::query(
            r#"
            INSERT INTO conversation_session (
              id, tenant_id, user_id, assistant_id, channel, status, preset_id, title,
              message_count, last_summary_version, first_message_at, last_active_at, created_at, updated_at
            )
            VALUES (?, NULL, NULL, ?, 'internal', 'active', NULL, ?, 0, 0, NULL, ?, ?, ?);
            "#,
        )
        .bind(&session_id)
        .bind(&assistant_id)
        .bind(&title)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalConversationCreateResponse { session_id, title })
    }

    /// 若指定 session_id 的会话不存在则创建（用于 IM 等按固定 session_id 首次入站）
    pub async fn ensure_local_conversation_for_session_id(
        &self,
        session_id: &str,
    ) -> Result<(), McpError> {
        let normalized = session_id.trim().to_string();
        if normalized.is_empty() {
            return Err(McpError::Validation("session_id is required".to_string()));
        }
        let exists = sqlx::query(
            r#"
            SELECT id FROM conversation_session WHERE id = ? LIMIT 1;
            "#,
        )
        .bind(&normalized)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| McpError::Storage(e.to_string()))?;
        if exists.is_some() {
            return Ok(());
        }
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            INSERT INTO conversation_session (
              id, tenant_id, user_id, assistant_id, channel, status, preset_id, title,
              message_count, last_summary_version, first_message_at, last_active_at, created_at, updated_at
            )
            VALUES (?, NULL, NULL, NULL, 'internal', 'active', NULL, NULL, 0, 0, NULL, ?, ?, ?);
            "#,
        )
        .bind(&normalized)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.write_pool)
        .await
        .map_err(|e| McpError::Storage(e.to_string()))?;
        Ok(())
    }

    pub async fn find_latest_local_fact_extraction_candidate_session(
        &self,
    ) -> Result<Option<String>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT id
            FROM conversation_session
            WHERE channel = 'internal'
              AND status = ?
              AND message_count > 1
            ORDER BY COALESCE(last_active_at, updated_at, created_at) DESC
            LIMIT 1;
            "#,
        )
        .bind(LocalConversationStatus::Active.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(row.and_then(|item| item.try_get::<String, _>("id").ok()))
    }

    pub async fn update_local_conversation_status(
        &self,
        session_id: &str,
        status: LocalConversationStatus,
    ) -> Result<LocalConversationArchiveResponse, McpError> {
        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET status = ?, last_active_at = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(status.as_str())
        .bind(&now)
        .bind(&now)
        .bind(session_id)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        Ok(LocalConversationArchiveResponse {
            session_id: session_id.to_string(),
            status,
        })
    }

    pub async fn update_local_conversation_pin_status(
        &self,
        session_id: &str,
        is_pinned: bool,
    ) -> Result<LocalConversationPinResponse, McpError> {
        let now = now_rfc3339()?;
        let pin_value = if is_pinned { 1 } else { 0 };
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET is_pinned = ?, last_active_at = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(pin_value)
        .bind(&now)
        .bind(&now)
        .bind(session_id)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        Ok(LocalConversationPinResponse {
            session_id: session_id.to_string(),
            is_pinned,
        })
    }

    pub async fn rename_local_conversation(
        &self,
        session_id: &str,
        title: String,
    ) -> Result<LocalConversationRenameResponse, McpError> {
        let now = now_rfc3339()?;
        let normalized_title = {
            let trimmed = title.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        };
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET title = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&normalized_title)
        .bind(&now)
        .bind(session_id)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        Ok(LocalConversationRenameResponse {
            session_id: session_id.to_string(),
            title: normalized_title,
        })
    }

    pub async fn update_local_conversation_title_if_empty(
        &self,
        session_id: &str,
        title: &str,
    ) -> Result<Option<String>, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let normalized_title = {
            let trimmed = title.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        };
        let Some(next_title) = normalized_title else {
            return Err(McpError::validation("title is required"));
        };

        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET title = ?, updated_at = ?
            WHERE id = ?
              AND (title IS NULL OR TRIM(title) = '');
            "#,
        )
        .bind(&next_title)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Ok(None);
        }

        Ok(Some(next_title))
    }

    pub async fn update_local_conversation_model_context(
        &self,
        session_id: &str,
        model_id: Option<&str>,
        provider_model_id: Option<&str>,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let normalized_model_id = model_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let normalized_provider_model_id = provider_model_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET last_model_id = ?,
                last_provider_model_id = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&normalized_model_id)
        .bind(&normalized_provider_model_id)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        Ok(())
    }

    pub async fn update_local_conversation_model_binding(
        &self,
        session_id: &str,
        pinned_model_key: Option<&str>,
        pinned_provider_model_id: Option<&str>,
        pinned_binding_source: Option<&str>,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let normalize_optional = |value: Option<&str>| {
            value.and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
        };

        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE conversation_session
            SET pinned_model_key = ?,
                pinned_provider_model_id = ?,
                pinned_binding_source = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(normalize_optional(pinned_model_key))
        .bind(normalize_optional(pinned_provider_model_id))
        .bind(normalize_optional(pinned_binding_source))
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        Ok(())
    }

    pub(crate) async fn get_local_conversation_model_context(
        &self,
        session_id: &str,
    ) -> Result<Option<LocalConversationModelContext>, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT
              last_model_id, last_provider_model_id,
              pinned_model_key, pinned_provider_model_id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let Some(session_row) = session_row else {
            return Ok(None);
        };

        Ok(Some(LocalConversationModelContext {
            last_model_id: session_row.try_get("last_model_id")?,
            last_provider_model_id: session_row.try_get("last_provider_model_id")?,
            pinned_model_key: session_row.try_get("pinned_model_key")?,
            pinned_provider_model_id: session_row.try_get("pinned_provider_model_id")?,
        }))
    }
    pub async fn get_local_conversation_title_context(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationTitleContext, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT id, title, message_count
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let first_message_row = sqlx::query(
            r#"
            SELECT content
            FROM conversation_message
            WHERE session_id = ? AND is_deleted = 0 AND LOWER(role) = 'user'
            ORDER BY turn_index ASC
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalConversationTitleContext {
            session_id: normalized_session_id,
            title: session_row.try_get("title")?,
            message_count: session_row.try_get::<i64, _>("message_count").unwrap_or(0),
            first_user_message: first_message_row.and_then(|row| {
                row.try_get::<Option<String>, _>("content")
                    .ok()
                    .flatten()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            }),
        })
    }

    pub async fn delete_local_conversation_message(
        &self,
        session_id: &str,
        turn_index: i64,
    ) -> Result<LocalConversationDeleteResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        if turn_index <= 0 {
            return Err(McpError::validation("turn_index must be greater than 0"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.begin_write().await?;

        let session_exists = sqlx::query(
            r#"
            SELECT id FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        let result = sqlx::query(
            r#"
            UPDATE conversation_message
            SET is_deleted = 1, updated_at = ?
            WHERE session_id = ? AND turn_index = ? AND is_deleted = 0;
            "#,
        )
        .bind(&now)
        .bind(&normalized_session_id)
        .bind(turn_index)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let deleted = result.rows_affected() > 0;
        if deleted {
            sqlx::query(
                r#"
                DELETE FROM conversation_summary
                WHERE session_id = ?;
                "#,
            )
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                DELETE FROM conversation_summary_job
                WHERE session_id = ?;
                "#,
            )
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                DELETE FROM conversation_summary_idle_task
                WHERE session_id = ?;
                "#,
            )
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            let runtime_window_tokens = self
                .compute_local_conversation_runtime_tokens_tx(&mut tx, &normalized_session_id)
                .await?;

            sqlx::query(
                r#"
                UPDATE conversation_session
                SET message_count = CASE WHEN message_count > 0 THEN message_count - 1 ELSE 0 END,
                    total_tokens = ?,
                    last_summary_version = 0,
                    summarizing = 0,
                    summary_job_id = '',
                    last_summary_generated_at = NULL,
                    last_active_at = ?,
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(runtime_window_tokens)
            .bind(&now)
            .bind(&now)
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        tx.commit().await?;

        Ok(LocalConversationDeleteResponse {
            session_id: normalized_session_id,
            turn_index,
            deleted,
        })
    }

    pub async fn clear_local_conversation(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationClearResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.begin_write().await?;

        let session_exists = sqlx::query(
            r#"
            SELECT id FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        sqlx::query(
            r#"
            UPDATE conversation_message
            SET is_deleted = 1, updated_at = ?
            WHERE session_id = ? AND is_deleted = 0;
            "#,
        )
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM conversation_summary
            WHERE session_id = ?;
            "#,
        )
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM conversation_summary_job
            WHERE session_id = ?;
            "#,
        )
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM conversation_summary_idle_task
            WHERE session_id = ?;
            "#,
        )
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        for marker_key in build_session_scoped_fact_extraction_marker_keys(&normalized_session_id) {
            sqlx::query(
                r#"
                DELETE FROM desktop_config
                WHERE key = ?;
                "#,
            )
            .bind(&marker_key)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET message_count = 0,
                total_tokens = 0,
                last_summary_version = 0,
                summarizing = 0,
                summary_job_id = '',
                last_summary_generated_at = NULL,
                first_message_at = NULL,
                last_active_at = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&now)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;

        Ok(LocalConversationClearResponse {
            session_id: normalized_session_id,
            cleared: true,
        })
    }

    pub async fn prepare_local_conversation_regenerate(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationRegenerateContext, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.begin_write().await?;

        let session_row = sqlx::query(
            r#"
            SELECT assistant_id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let assistant_id: Option<String> = session_row.try_get("assistant_id")?;

        let rows = sqlx::query(
            r#"
            SELECT role, content, turn_index
            FROM conversation_message
            WHERE session_id = ? AND is_deleted = 0
            ORDER BY turn_index ASC;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if rows.is_empty() {
            return Err(McpError::validation("conversation has no messages"));
        }

        let mut timeline = Vec::with_capacity(rows.len());
        for row in rows {
            timeline.push((
                row.try_get::<i64, _>("turn_index")?,
                row.try_get::<String, _>("role")?,
                row.try_get::<Option<String>, _>("content")?,
            ));
        }

        let last_user_turn = timeline
            .iter()
            .rev()
            .find_map(|(turn, role, _)| if role == "user" { Some(*turn) } else { None })
            .ok_or_else(|| McpError::validation("no user message found"))?;

        let deleted_turn_index = timeline.iter().find_map(|(turn, role, _)| {
            if role == "assistant" && *turn > last_user_turn {
                Some(*turn)
            } else {
                None
            }
        });

        if let Some(turn) = deleted_turn_index {
            let delete_result = sqlx::query(
                r#"
                UPDATE conversation_message
                SET is_deleted = 1, updated_at = ?
                WHERE session_id = ? AND turn_index = ? AND is_deleted = 0;
                "#,
            )
            .bind(&now)
            .bind(&normalized_session_id)
            .bind(turn)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if delete_result.rows_affected() > 0 {
                sqlx::query(
                    r#"
                    DELETE FROM conversation_summary
                    WHERE session_id = ?;
                    "#,
                )
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                sqlx::query(
                    r#"
                    DELETE FROM conversation_summary_job
                    WHERE session_id = ?;
                    "#,
                )
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                sqlx::query(
                    r#"
                    DELETE FROM conversation_summary_idle_task
                    WHERE session_id = ?;
                    "#,
                )
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                let runtime_window_tokens = self
                    .compute_local_conversation_runtime_tokens_tx(&mut tx, &normalized_session_id)
                    .await?;

                sqlx::query(
                    r#"
                    UPDATE conversation_session
                    SET message_count = CASE WHEN message_count > 0 THEN message_count - 1 ELSE 0 END,
                        total_tokens = ?,
                        last_summary_version = 0,
                        summarizing = 0,
                        summary_job_id = '',
                        last_summary_generated_at = NULL,
                        last_active_at = ?,
                        updated_at = ?
                    WHERE id = ?;
                    "#,
                )
                .bind(runtime_window_tokens)
                .bind(&now)
                .bind(&now)
                .bind(&normalized_session_id)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            }
        }

        let messages: Vec<LocalChatInputMessage> = timeline
            .into_iter()
            .filter(|(turn, _, _)| deleted_turn_index != Some(*turn))
            .map(|(_, role, content)| LocalChatInputMessage {
                role,
                content: content.unwrap_or_default(),
                reasoning_content: None,
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            })
            .collect();

        if messages.is_empty() {
            return Err(McpError::validation("conversation has no messages"));
        }

        tx.commit().await?;

        Ok(LocalConversationRegenerateContext {
            session_id: normalized_session_id,
            assistant_id,
            deleted_turn_index,
            messages,
        })
    }

    pub async fn get_local_conversation_chat_context(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationChatContext, McpError> {
        let runtime_window = self
            .load_local_conversation_runtime_window(session_id)
            .await?;
        let messages = runtime_window
            .messages
            .into_iter()
            .map(|message| {
                let content = message
                    .content
                    .as_ref()
                    .and_then(|value| {
                        if let Some(text) = value.as_str() {
                            Some(text.to_string())
                        } else {
                            serde_json::to_string(value).ok()
                        }
                    })
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_default();
                LocalChatInputMessage {
                    role: message.role,
                    content,
                    reasoning_content: None,
                    tool_calls: vec![],
                    tool_call_id: None,
                    name: None,
                }
            })
            .collect();

        Ok(LocalConversationChatContext {
            session_id: runtime_window.session_id,
            assistant_id: runtime_window.assistant_id,
            messages,
        })
    }

    pub async fn load_local_conversation_runtime_window(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationRuntimeWindow, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT
              assistant_id, title, status, message_count, total_tokens, last_summary_version,
              summarizing, summary_job_id, last_summary_generated_at,
              last_model_id, last_provider_model_id,
              pinned_model_key, pinned_provider_model_id, pinned_binding_source,
              first_message_at, last_active_at, created_at, updated_at
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let assistant_id: Option<String> = session_row.try_get("assistant_id")?;
        let last_summary_version: i64 = session_row.try_get("last_summary_version").unwrap_or(0);
        let summary_row = if last_summary_version > 0 {
            fetch_local_summary_row_by_version(
                &self.pool,
                &normalized_session_id,
                last_summary_version,
            )
            .await?
        } else {
            None
        };
        let summary_coverage = summary_row.as_ref().and_then(|row| {
            Some((
                row.try_get::<i64, _>("covered_from_turn").ok()?,
                row.try_get::<i64, _>("covered_to_turn").ok()?,
            ))
        });
        let summary = summary_row.map(|row| {
            serde_json::json!({
                "id": row.try_get::<String, _>("id").ok(),
                "version": row.try_get::<i64, _>("version").ok(),
                "summary_text": row.try_get::<String, _>("summary_text").ok(),
                "covered_from_turn": row.try_get::<i64, _>("covered_from_turn").ok(),
                "covered_to_turn": row.try_get::<i64, _>("covered_to_turn").ok(),
                "token_estimate": row.try_get::<i64, _>("token_estimate").ok().unwrap_or(0),
                "summarizer_model": row.try_get::<Option<String>, _>("summarizer_model").ok().flatten(),
                "created_at": row.try_get::<String, _>("created_at").ok(),
                "updated_at": row.try_get::<String, _>("updated_at").ok(),
            })
        });

        let recent_rows = sqlx::query(
            r#"
            SELECT role, content, turn_index, created_at, is_truncated, name, meta_info, token_estimate
            FROM conversation_message
            WHERE session_id = ? AND is_deleted = 0
            ORDER BY turn_index DESC
            LIMIT ?;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURN_CAP_INTERNAL)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let rows = select_local_active_window_rows(recent_rows, summary_coverage);
        if rows.is_empty() && summary.is_none() {
            return Err(McpError::validation("conversation has no messages"));
        }

        let mut messages = Vec::with_capacity(rows.len());
        for row in &rows {
            let content_text: Option<String> = row.try_get("content")?;
            let meta_info_text: Option<String> = row.try_get("meta_info")?;
            messages.push(LocalConversationHistoryMessage {
                role: row.try_get("role")?,
                content: content_text.map(serde_json::Value::String),
                turn_index: row.try_get("turn_index")?,
                created_at: row.try_get("created_at")?,
                is_truncated: Some(row.try_get::<i64, _>("is_truncated")? != 0),
                name: row.try_get("name")?,
                meta_info: match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                },
            });
        }

        let meta = Some(serde_json::json!({
            "title": session_row.try_get::<Option<String>, _>("title").ok().flatten(),
            "status": session_row.try_get::<String, _>("status").ok(),
            "message_count": session_row.try_get::<i64, _>("message_count").ok().unwrap_or(0),
            "total_tokens": session_row.try_get::<i64, _>("total_tokens").ok().unwrap_or(0),
            "last_summary_version": last_summary_version,
            "summarizing": session_row.try_get::<i64, _>("summarizing").ok().unwrap_or(0) != 0,
            "summary_job_id": session_row.try_get::<Option<String>, _>("summary_job_id").ok().flatten(),
            "last_summary_generated_at": session_row.try_get::<Option<String>, _>("last_summary_generated_at").ok().flatten(),
            "last_model_id": session_row.try_get::<Option<String>, _>("last_model_id").ok().flatten(),
            "last_provider_model_id": session_row.try_get::<Option<String>, _>("last_provider_model_id").ok().flatten(),
            "pinned_model_key": session_row.try_get::<Option<String>, _>("pinned_model_key").ok().flatten(),
            "pinned_provider_model_id": session_row.try_get::<Option<String>, _>("pinned_provider_model_id").ok().flatten(),
            "pinned_binding_source": session_row.try_get::<Option<String>, _>("pinned_binding_source").ok().flatten(),
            "first_message_at": session_row.try_get::<Option<String>, _>("first_message_at").ok().flatten(),
            "last_active_at": session_row.try_get::<Option<String>, _>("last_active_at").ok().flatten(),
            "created_at": session_row.try_get::<Option<String>, _>("created_at").ok().flatten(),
            "updated_at": session_row.try_get::<Option<String>, _>("updated_at").ok().flatten(),
        }));

        Ok(LocalConversationRuntimeWindow {
            session_id: normalized_session_id,
            assistant_id,
            messages,
            meta,
            summary,
        })
    }

    pub async fn append_local_conversation_message(
        &self,
        payload: CreateConversationMessageRequest,
    ) -> Result<LocalConversationHistoryMessage, McpError> {
        let mut attempt = 0_usize;
        loop {
            match self
                .append_local_conversation_message_once(payload.clone())
                .await
            {
                Ok(message) => return Ok(message),
                Err(err)
                    if is_sqlite_busy_error(&err)
                        && attempt < SQLITE_BUSY_RETRY_DELAYS_MS.len() =>
                {
                    let delay_ms = SQLITE_BUSY_RETRY_DELAYS_MS[attempt];
                    attempt += 1;
                    log::warn!(
                        "append_local_conversation_message busy retry session={} attempt={} delay_ms={}",
                        payload.session_id,
                        attempt,
                        delay_ms
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
                Err(err) => return Err(err),
            }
        }
    }

    async fn append_local_conversation_message_once(
        &self,
        payload: CreateConversationMessageRequest,
    ) -> Result<LocalConversationHistoryMessage, McpError> {
        let session_id = payload.session_id.trim().to_string();
        if session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        let role = payload.role.trim().to_string();
        if role.is_empty() {
            return Err(McpError::validation("role is required"));
        }

        let now = now_rfc3339()?;
        let content = if payload.content.trim().is_empty() {
            None
        } else {
            Some(payload.content)
        };
        let name = payload.name.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let parent_message_id = payload.parent_message_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let meta_json = payload
            .meta_info
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|err| storage_step_error("serialize_meta_info", err))?;
        let is_truncated = payload.is_truncated.unwrap_or(false);
        let token_estimate = payload
            .meta_info
            .as_ref()
            .and_then(|value| value.get("token_estimate"))
            .and_then(|value| value.as_i64())
            .filter(|value| *value >= 0)
            .unwrap_or_else(|| estimate_token_count(content.as_deref().unwrap_or("")));

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|err| storage_step_error("begin_tx", err))?;

        let exists = sqlx::query(
            r#"
            SELECT id FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| storage_step_error("fetch_session", err))?;

        if exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        let turn_row = sqlx::query(
            r#"
            SELECT COALESCE(MAX(turn_index), 0) + 1 AS next_turn
            FROM conversation_message
            WHERE session_id = ?;
            "#,
        )
        .bind(&session_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| storage_step_error("fetch_next_turn", err))?;
        let next_turn: i64 = turn_row.try_get("next_turn")?;
        let message_id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO conversation_message (
              id, session_id, turn_index, role, name, content, meta_info, used_persona_id,
              token_estimate, is_truncated, is_deleted, parent_message_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?);
            "#,
        )
        .bind(&message_id)
        .bind(&session_id)
        .bind(next_turn)
        .bind(&role)
        .bind(&name)
        .bind(&content)
        .bind(&meta_json)
        .bind(token_estimate)
        .bind(if is_truncated { 1 } else { 0 })
        .bind(&parent_message_id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| storage_step_error("insert_message", err))?;

        let window_tokens = self
            .compute_local_conversation_runtime_tokens_tx(&mut tx, &session_id)
            .await
            .map_err(|err| storage_step_error("compute_window_tokens", err))?;

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET message_count = message_count + 1,
                total_tokens = ?,
                first_message_at = COALESCE(first_message_at, ?),
                last_active_at = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(window_tokens)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .bind(&session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| storage_step_error("update_session_counters", err))?;

        if role.eq_ignore_ascii_case("assistant") {
            sync_conversation_execution_tree_tx(
                &mut tx,
                &session_id,
                &message_id,
                next_turn,
                payload.meta_info.as_ref(),
                &now,
            )
            .await
            .map_err(|err| storage_step_error("sync_execution_tree", err))?;
        }

        tx.commit()
            .await
            .map_err(|err| storage_step_error("commit_tx", err))?;
        if let Err(err) = self
            .touch_local_conversation_summary_idle_task(&session_id)
            .await
        {
            log::warn!(
                "append_message step=touch_summary_idle_task session={} err={}",
                session_id,
                err
            );
        }
        if let Err(err) = self
            .try_trigger_local_conversation_summary_flush(&session_id, "message_append")
            .await
        {
            log::warn!(
                "append_message step=trigger_summary_flush session={} err={}",
                session_id,
                err
            );
        }

        Ok(LocalConversationHistoryMessage {
            role,
            content: content.map(serde_json::Value::String),
            turn_index: Some(next_turn),
            created_at: Some(now),
            is_truncated: Some(is_truncated),
            name,
            meta_info: payload.meta_info,
        })
    }

    pub async fn soft_delete_stale_pending_approval_assistant_messages_before_turn(
        &self,
        session_id: &str,
        keep_turn_index: i64,
    ) -> Result<u64, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        if keep_turn_index <= 0 {
            return Err(McpError::validation("keep_turn_index must be positive"));
        }

        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE conversation_message
            SET is_deleted = 1, updated_at = ?
            WHERE session_id = ?
              AND role = 'assistant'
              AND is_deleted = 0
              AND turn_index < ?
              AND json_extract(meta_info, '$.blocks') IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM json_each(conversation_message.meta_info, '$.blocks') AS block
                WHERE json_extract(block.value, '$.type') = 'tool_result'
                  AND lower(COALESCE(json_extract(block.value, '$.status'), '')) = 'requires_approval'
              );
            "#,
        )
        .bind(&now)
        .bind(&normalized_session_id)
        .bind(keep_turn_index)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(result.rows_affected())
    }

    pub async fn update_local_conversation_assistant_meta_info(
        &self,
        session_id: &str,
        turn_index: i64,
        meta_info: Option<Value>,
    ) -> Result<(), McpError> {
        let mut attempt = 0_usize;
        loop {
            match self
                .update_local_conversation_assistant_meta_info_once(
                    session_id,
                    turn_index,
                    meta_info.clone(),
                )
                .await
            {
                Ok(()) => return Ok(()),
                Err(err)
                    if is_sqlite_busy_error(&err)
                        && attempt < SQLITE_BUSY_RETRY_DELAYS_MS.len() =>
                {
                    let delay_ms = SQLITE_BUSY_RETRY_DELAYS_MS[attempt];
                    attempt += 1;
                    log::warn!(
                        "update_local_conversation_assistant_meta_info busy retry session={} turn={} attempt={} delay_ms={}",
                        session_id,
                        turn_index,
                        attempt,
                        delay_ms
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
                Err(err) => return Err(err),
            }
        }
    }

    async fn update_local_conversation_assistant_meta_info_once(
        &self,
        session_id: &str,
        turn_index: i64,
        meta_info: Option<Value>,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        if turn_index <= 0 {
            return Err(McpError::validation("turn_index must be positive"));
        }

        let now = now_rfc3339()?;
        let meta_json = meta_info
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|err| update_assistant_meta_step_error("serialize_meta_info", err))?;

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|err| update_assistant_meta_step_error("begin_tx", err))?;

        let row = sqlx::query(
            r#"
            SELECT id, role
            FROM conversation_message
            WHERE session_id = ? AND turn_index = ? AND is_deleted = 0
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(turn_index)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| update_assistant_meta_step_error("fetch_message", err))?
        .ok_or_else(|| McpError::NotFound("conversation message not found".to_string()))?;

        let message_id: String = row
            .try_get("id")
            .map_err(|err| update_assistant_meta_step_error("read_message_id", err))?;
        let role: String = row
            .try_get("role")
            .map_err(|err| update_assistant_meta_step_error("read_role", err))?;
        if !role.eq_ignore_ascii_case("assistant") {
            return Err(McpError::validation(
                "only assistant messages support meta_info replacement",
            ));
        }

        sqlx::query(
            r#"
            UPDATE conversation_message
            SET meta_info = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(meta_json)
        .bind(&now)
        .bind(&message_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| update_assistant_meta_step_error("update_message", err))?;

        sync_conversation_execution_tree_tx(
            &mut tx,
            &normalized_session_id,
            &message_id,
            turn_index,
            meta_info.as_ref(),
            &now,
        )
        .await
        .map_err(|err| update_assistant_meta_step_error("sync_execution_tree", err))?;

        tx.commit()
            .await
            .map_err(|err| update_assistant_meta_step_error("commit_tx", err))?;

        Ok(())
    }

    pub async fn get_local_conversation_execution_tree(
        &self,
        root_execution_id: &str,
    ) -> Result<Option<LocalConversationExecutionTreeResponse>, McpError> {
        let normalized_root_execution_id = root_execution_id.trim().to_string();
        if normalized_root_execution_id.is_empty() {
            return Err(McpError::validation("root_execution_id is required"));
        }

        let root_row = sqlx::query(
            r#"
            SELECT
              root_execution_id, session_id, message_id, turn_index, schema_version,
              execution_id, execution_kind, execution_status, terminal_status,
              target_id, target_name, target_invocation_kind, target_worker_ref, target_workflow_run_id,
              selection_json, available_actions_json, summary, error, result_payload_json, raw_json,
              started_at_ms, completed_at_ms, created_at, updated_at
            FROM conversation_execution_root
            WHERE root_execution_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_root_execution_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let Some(root_row) = root_row else {
            return Ok(None);
        };

        let root = LocalConversationExecutionRoot {
            root_execution_id: root_row.try_get("root_execution_id")?,
            session_id: root_row.try_get("session_id")?,
            message_id: root_row.try_get("message_id")?,
            turn_index: root_row.try_get("turn_index")?,
            schema_version: root_row.try_get("schema_version").unwrap_or(1),
            execution_id: root_row.try_get("execution_id")?,
            execution_kind: root_row.try_get("execution_kind")?,
            execution_status: root_row.try_get("execution_status")?,
            terminal_status: root_row.try_get("terminal_status")?,
            target_id: root_row.try_get("target_id")?,
            target_name: root_row.try_get("target_name")?,
            target_invocation_kind: root_row.try_get("target_invocation_kind")?,
            target_worker_ref: root_row.try_get("target_worker_ref")?,
            target_workflow_run_id: root_row.try_get("target_workflow_run_id")?,
            selection: parse_optional_json_text(root_row.try_get("selection_json")?)?,
            available_actions: parse_optional_json_text(
                root_row.try_get("available_actions_json")?,
            )?,
            summary: root_row.try_get("summary")?,
            error: root_row.try_get("error")?,
            result_payload: parse_optional_json_text(root_row.try_get("result_payload_json")?)?,
            raw_json: parse_optional_json_text(root_row.try_get("raw_json")?)?,
            started_at_ms: root_row.try_get("started_at_ms")?,
            completed_at_ms: root_row.try_get("completed_at_ms")?,
            created_at: root_row.try_get("created_at")?,
            updated_at: root_row.try_get("updated_at")?,
        };

        let child_rows = sqlx::query(
            r#"
            SELECT
              id, root_execution_id, session_id, message_id, phase_id, step_type,
              title, status, worker_ref, summary, error, available_actions_json, raw_json,
              created_at, updated_at
            FROM conversation_execution_child
            WHERE root_execution_id = ?
            ORDER BY created_at ASC, id ASC;
            "#,
        )
        .bind(&normalized_root_execution_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut children = Vec::with_capacity(child_rows.len());
        for row in child_rows {
            children.push(LocalConversationExecutionChild {
                id: row.try_get("id")?,
                root_execution_id: row.try_get("root_execution_id")?,
                session_id: row.try_get("session_id")?,
                message_id: row.try_get("message_id")?,
                phase_id: row.try_get("phase_id")?,
                step_type: row.try_get("step_type")?,
                title: row.try_get("title")?,
                status: row.try_get("status")?,
                worker_ref: row.try_get("worker_ref")?,
                summary: row.try_get("summary")?,
                error: row.try_get("error")?,
                available_actions: parse_optional_json_text(
                    row.try_get("available_actions_json")?,
                )?,
                raw_json: parse_optional_json_text(row.try_get("raw_json")?)?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(Some(LocalConversationExecutionTreeResponse {
            root,
            children,
        }))
    }

    pub async fn list_local_conversation_execution_roots(
        &self,
        session_id: &str,
    ) -> Result<Vec<LocalConversationExecutionRoot>, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let rows = sqlx::query(
            r#"
            SELECT
              root_execution_id, session_id, message_id, turn_index, schema_version,
              execution_id, execution_kind, execution_status, terminal_status,
              target_id, target_name, target_invocation_kind, target_worker_ref, target_workflow_run_id,
              selection_json, available_actions_json, summary, error, result_payload_json, raw_json,
              started_at_ms, completed_at_ms, created_at, updated_at
            FROM conversation_execution_root
            WHERE session_id = ?
            ORDER BY turn_index DESC, updated_at DESC;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut roots = Vec::with_capacity(rows.len());
        for row in rows {
            roots.push(LocalConversationExecutionRoot {
                root_execution_id: row.try_get("root_execution_id")?,
                session_id: row.try_get("session_id")?,
                message_id: row.try_get("message_id")?,
                turn_index: row.try_get("turn_index")?,
                schema_version: row.try_get("schema_version").unwrap_or(1),
                execution_id: row.try_get("execution_id")?,
                execution_kind: row.try_get("execution_kind")?,
                execution_status: row.try_get("execution_status")?,
                terminal_status: row.try_get("terminal_status")?,
                target_id: row.try_get("target_id")?,
                target_name: row.try_get("target_name")?,
                target_invocation_kind: row.try_get("target_invocation_kind")?,
                target_worker_ref: row.try_get("target_worker_ref")?,
                target_workflow_run_id: row.try_get("target_workflow_run_id")?,
                selection: parse_optional_json_text(row.try_get("selection_json")?)?,
                available_actions: parse_optional_json_text(
                    row.try_get("available_actions_json")?,
                )?,
                summary: row.try_get("summary")?,
                error: row.try_get("error")?,
                result_payload: parse_optional_json_text(row.try_get("result_payload_json")?)?,
                raw_json: parse_optional_json_text(row.try_get("raw_json")?)?,
                started_at_ms: row.try_get("started_at_ms")?,
                completed_at_ms: row.try_get("completed_at_ms")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        Ok(roots)
    }

    /// Returns the latest summary text for a conversation session, or None if no summary exists.
    pub async fn get_latest_local_conversation_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<String>, McpError> {
        let normalized = session_id.trim().to_string();
        if normalized.is_empty() {
            return Ok(None);
        }

        let session_row = sqlx::query(
            r#"
            SELECT last_summary_version
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let version: i64 = match session_row {
            Some(row) => row.try_get::<i64, _>("last_summary_version").unwrap_or(0),
            None => return Ok(None),
        };
        if version <= 0 {
            return Ok(None);
        }

        let summary_row = sqlx::query(
            r#"
            SELECT summary_text
            FROM conversation_summary
            WHERE session_id = ? AND version = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized)
        .bind(version)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(summary_row.and_then(|row| {
            row.try_get::<String, _>("summary_text")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        }))
    }

    pub async fn persist_local_conversation_summary(
        &self,
        session_id: &str,
        summary_text: &str,
        summarizer_model: Option<&str>,
    ) -> Result<(), McpError> {
        let mut attempt = 0_usize;
        loop {
            match self
                .persist_local_conversation_summary_once(session_id, summary_text, summarizer_model)
                .await
            {
                Ok(()) => return Ok(()),
                Err(err)
                    if is_sqlite_busy_error(&err)
                        && attempt < SQLITE_BUSY_RETRY_DELAYS_MS.len() =>
                {
                    let delay_ms = SQLITE_BUSY_RETRY_DELAYS_MS[attempt];
                    attempt += 1;
                    log::warn!(
                        "persist_local_conversation_summary busy retry session={} attempt={} delay_ms={}",
                        session_id,
                        attempt,
                        delay_ms
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
                Err(err) => return Err(err),
            }
        }
    }

    async fn persist_local_conversation_summary_once(
        &self,
        session_id: &str,
        summary_text: &str,
        summarizer_model: Option<&str>,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let normalized_summary = summary_text.trim().to_string();
        if normalized_summary.is_empty() {
            return Err(McpError::validation("summary_text is required"));
        }

        let normalized_summarizer_model = summarizer_model.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        let now = now_rfc3339()?;
        let mut tx = self.begin_write().await?;

        let session_row = sqlx::query(
            r#"
            SELECT id, last_summary_version
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let recent_message_rows = sqlx::query(
            r#"
            SELECT id, turn_index, token_estimate
            FROM conversation_message
            WHERE session_id = ? AND is_deleted = 0
            ORDER BY turn_index DESC
            LIMIT ?;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(LOCAL_CONVERSATION_ACTIVE_WINDOW_TURN_CAP_INTERNAL)
        .fetch_all(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let current_version: i64 = session_row.try_get("last_summary_version").unwrap_or(0);
        let (previous_summary_id, previous_summary_coverage) = if current_version > 0 {
            let row = fetch_local_summary_row_by_version(
                &mut *tx,
                &normalized_session_id,
                current_version,
            )
            .await?;
            (
                row.as_ref()
                    .and_then(|item| item.try_get::<String, _>("id").ok()),
                row.and_then(|item| {
                    Some((
                        item.try_get::<i64, _>("covered_from_turn").ok()?,
                        item.try_get::<i64, _>("covered_to_turn").ok()?,
                    ))
                }),
            )
        } else {
            (None, None)
        };

        let recent_message_rows = filter_local_rows_outside_summary_coverage(
            recent_message_rows,
            previous_summary_coverage,
        );
        let message_rows = trim_local_active_window_rows(recent_message_rows);
        if message_rows.is_empty() {
            return Err(McpError::validation(
                "conversation summary has no uncovered runtime messages",
            ));
        }

        let first_row = message_rows.first().ok_or_else(|| {
            McpError::Storage("conversation summary missing first row".to_string())
        })?;
        let last_row = message_rows.last().ok_or_else(|| {
            McpError::Storage("conversation summary missing last row".to_string())
        })?;

        let start_message_id: String = first_row.try_get("id")?;
        let end_message_id: String = last_row.try_get("id")?;
        let covered_from_turn: i64 = first_row.try_get("turn_index")?;
        let covered_to_turn: i64 = last_row.try_get("turn_index")?;

        let token_estimate = sum_local_conversation_row_tokens(&message_rows);
        let new_version = current_version.max(0) + 1;

        let summary_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO conversation_summary (
              id, session_id, version, summary_text, covered_from_turn, covered_to_turn,
              previous_summary_id, start_message_id, end_message_id, token_estimate,
              summarizer_model, summarizer_preset_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?);
            "#,
        )
        .bind(&summary_id)
        .bind(&normalized_session_id)
        .bind(new_version)
        .bind(&normalized_summary)
        .bind(covered_from_turn)
        .bind(covered_to_turn)
        .bind(&previous_summary_id)
        .bind(&start_message_id)
        .bind(&end_message_id)
        .bind(token_estimate)
        .bind(&normalized_summarizer_model)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET last_summary_version = ?,
                total_tokens = ?,
                summarizing = 0,
                summary_job_id = '',
                last_summary_generated_at = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(new_version)
        .bind(0_i64)
        .bind(&now)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn enqueue_local_conversation_summary_job(
        &self,
        session_id: &str,
        trigger_source: &str,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }
        let normalized_trigger_source = {
            let trimmed = trigger_source.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        };

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let mut tx = self.begin_write().await?;

        let session_exists = sqlx::query(
            r#"
            SELECT id
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if session_exists.is_none() {
            return Err(McpError::NotFound(
                "conversation session not found".to_string(),
            ));
        }

        sqlx::query(
            r#"
            DELETE FROM conversation_summary_job
            WHERE session_id = ? AND status IN (?, ?);
            "#,
        )
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_FAILED)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let refreshed_pending = sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET trigger_source = COALESCE(?, trigger_source),
                available_after_epoch = ?,
                last_error = NULL,
                updated_at = ?
            WHERE session_id = ? AND status = ?;
            "#,
        )
        .bind(&normalized_trigger_source)
        .bind(now_epoch)
        .bind(&now)
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if refreshed_pending.rows_affected() > 0 {
            let pending_job_row = sqlx::query(
                r#"
                SELECT id
                FROM conversation_summary_job
                WHERE session_id = ? AND status = ?
                LIMIT 1;
                "#,
            )
            .bind(&normalized_session_id)
            .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let pending_job_id = pending_job_row
                .and_then(|row| row.try_get::<String, _>("id").ok())
                .unwrap_or_default();
            sqlx::query(
                r#"
                UPDATE conversation_session
                SET summarizing = 1,
                    summary_job_id = ?,
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(&pending_job_id)
            .bind(&now)
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            tx.commit().await?;
            return Ok(());
        }

        let running_exists = sqlx::query(
            r#"
            SELECT id
            FROM conversation_summary_job
            WHERE session_id = ? AND status = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if let Some(row) = running_exists {
            let running_job_id = row.try_get::<String, _>("id").unwrap_or_default();
            sqlx::query(
                r#"
                UPDATE conversation_session
                SET summarizing = 1,
                    summary_job_id = ?,
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(&running_job_id)
            .bind(&now)
            .bind(&normalized_session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            tx.commit().await?;
            return Ok(());
        }

        let job_id = Uuid::new_v4().to_string();
        let insert_result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO conversation_summary_job (
              id, session_id, status, trigger_source, attempts, max_attempts,
              available_after_epoch, last_error, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?, ?);
            "#,
        )
        .bind(&job_id)
        .bind(&normalized_session_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .bind(&normalized_trigger_source)
        .bind(CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS)
        .bind(now_epoch)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if insert_result.rows_affected() == 0 {
            let _ = sqlx::query(
                r#"
                UPDATE conversation_summary_job
                SET trigger_source = COALESCE(?, trigger_source),
                    available_after_epoch = ?,
                    last_error = NULL,
                    updated_at = ?
                WHERE session_id = ? AND status = ?;
                "#,
            )
            .bind(&normalized_trigger_source)
            .bind(now_epoch)
            .bind(&now)
            .bind(&normalized_session_id)
            .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET summarizing = 1,
                summary_job_id = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&job_id)
        .bind(&now)
        .bind(&normalized_session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn claim_next_local_conversation_summary_job(
        &self,
    ) -> Result<Option<LocalConversationSummaryJob>, McpError> {
        let mut attempt = 0_usize;
        loop {
            match self.claim_next_local_conversation_summary_job_once().await {
                Ok(job) => return Ok(job),
                Err(err)
                    if is_sqlite_busy_error(&err)
                        && attempt < SQLITE_BUSY_RETRY_DELAYS_MS.len() =>
                {
                    let delay_ms = SQLITE_BUSY_RETRY_DELAYS_MS[attempt];
                    attempt += 1;
                    log::warn!(
                        "claim_next_local_conversation_summary_job busy retry attempt={} delay_ms={}",
                        attempt,
                        delay_ms
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
                Err(err) => return Err(err),
            }
        }
    }

    async fn claim_next_local_conversation_summary_job_once(
        &self,
    ) -> Result<Option<LocalConversationSummaryJob>, McpError> {
        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let mut tx = self.begin_write().await?;

        let next_row = sqlx::query(
            r#"
            SELECT id, session_id, attempts, max_attempts
            FROM conversation_summary_job
            WHERE status = ? AND available_after_epoch <= ?
            ORDER BY available_after_epoch ASC, created_at ASC
            LIMIT 1;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .bind(now_epoch)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let Some(row) = next_row else {
            tx.commit().await?;
            return Ok(None);
        };

        let id: String = row.try_get("id")?;
        let session_id: String = row.try_get("session_id")?;
        let previous_attempts: i64 = row.try_get("attempts").unwrap_or(0);
        let max_attempts: i64 = row
            .try_get::<i64, _>("max_attempts")
            .unwrap_or(CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS);
        let attempts = previous_attempts.saturating_add(1);

        let result = sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET status = ?,
                attempts = ?,
                last_error = NULL,
                updated_at = ?
            WHERE id = ? AND status = ?;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .bind(attempts)
        .bind(&now)
        .bind(&id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_PENDING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            tx.commit().await?;
            return Ok(None);
        }

        tx.commit().await?;
        Ok(Some(LocalConversationSummaryJob {
            id,
            session_id,
            attempts,
            max_attempts,
        }))
    }

    pub async fn complete_local_conversation_summary_job(
        &self,
        job_id: &str,
    ) -> Result<(), McpError> {
        let mut attempt = 0_usize;
        loop {
            match self
                .complete_local_conversation_summary_job_once(job_id)
                .await
            {
                Ok(()) => return Ok(()),
                Err(err)
                    if is_sqlite_busy_error(&err)
                        && attempt < SQLITE_BUSY_RETRY_DELAYS_MS.len() =>
                {
                    let delay_ms = SQLITE_BUSY_RETRY_DELAYS_MS[attempt];
                    attempt += 1;
                    log::warn!(
                        "complete_local_conversation_summary_job busy retry job_id={} attempt={} delay_ms={}",
                        job_id,
                        attempt,
                        delay_ms
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
                Err(err) => return Err(err),
            }
        }
    }

    async fn complete_local_conversation_summary_job_once(
        &self,
        job_id: &str,
    ) -> Result<(), McpError> {
        let normalized_job_id = job_id.trim().to_string();
        if normalized_job_id.is_empty() {
            return Err(McpError::validation("job_id is required"));
        }

        let now = now_rfc3339()?;
        let mut tx = self.begin_write().await?;
        let session_row = sqlx::query(
            r#"
            SELECT session_id
            FROM conversation_summary_job
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_job_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET status = ?,
                last_error = NULL,
                available_after_epoch = 0,
                updated_at = ?
            WHERE id = ? AND status = ?;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED)
        .bind(&now)
        .bind(&normalized_job_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if let Some(row) = session_row {
            let session_id: String = row.try_get("session_id")?;
            sqlx::query(
                r#"
                UPDATE conversation_session
                SET summarizing = 0,
                    summary_job_id = '',
                    updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(&now)
            .bind(&session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        tx.commit().await?;

        Ok(())
    }

    pub async fn fail_local_conversation_summary_job(
        &self,
        job: &LocalConversationSummaryJob,
        error_message: &str,
        retry_delay_seconds: i64,
    ) -> Result<(), McpError> {
        let mut attempt = 0_usize;
        loop {
            match self
                .fail_local_conversation_summary_job_once(job, error_message, retry_delay_seconds)
                .await
            {
                Ok(()) => return Ok(()),
                Err(err)
                    if is_sqlite_busy_error(&err)
                        && attempt < SQLITE_BUSY_RETRY_DELAYS_MS.len() =>
                {
                    let delay_ms = SQLITE_BUSY_RETRY_DELAYS_MS[attempt];
                    attempt += 1;
                    log::warn!(
                        "fail_local_conversation_summary_job busy retry job_id={} attempt={} delay_ms={}",
                        job.id,
                        attempt,
                        delay_ms
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
                Err(err) => return Err(err),
            }
        }
    }

    async fn fail_local_conversation_summary_job_once(
        &self,
        job: &LocalConversationSummaryJob,
        error_message: &str,
        retry_delay_seconds: i64,
    ) -> Result<(), McpError> {
        let normalized_job_id = job.id.trim().to_string();
        if normalized_job_id.is_empty() {
            return Err(McpError::validation("job_id is required"));
        }

        let max_attempts = if job.max_attempts <= 0 {
            CONVERSATION_SUMMARY_JOB_MAX_ATTEMPTS
        } else {
            job.max_attempts
        };
        let should_retry = job.attempts < max_attempts;
        let next_status = if should_retry {
            CONVERSATION_SUMMARY_JOB_STATUS_PENDING
        } else {
            CONVERSATION_SUMMARY_JOB_STATUS_FAILED
        };

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let next_available_after = if should_retry {
            now_epoch.saturating_add(retry_delay_seconds.max(0))
        } else {
            now_epoch
        };
        let normalized_error = {
            let trimmed = error_message.trim();
            if trimmed.is_empty() {
                "conversation summary worker failed".to_string()
            } else {
                trimmed.chars().take(2000).collect()
            }
        };

        let mut tx = self.begin_write().await?;
        sqlx::query(
            r#"
            UPDATE conversation_summary_job
            SET status = ?,
                available_after_epoch = ?,
                last_error = ?,
                updated_at = ?
            WHERE id = ? AND status = ?;
            "#,
        )
        .bind(next_status)
        .bind(next_available_after)
        .bind(&normalized_error)
        .bind(&now)
        .bind(&normalized_job_id)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_RUNNING)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE conversation_session
            SET summarizing = ?,
                summary_job_id = ?,
                updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(if should_retry { 1 } else { 0 })
        .bind(if should_retry {
            normalized_job_id.as_str()
        } else {
            ""
        })
        .bind(&now)
        .bind(&job.session_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit().await?;

        Ok(())
    }

    pub async fn touch_local_conversation_summary_idle_task(
        &self,
        session_id: &str,
    ) -> Result<(), McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let run_after_epoch = now_epoch.saturating_add(LOCAL_CONVERSATION_SUMMARY_IDLE_SECONDS);

        sqlx::query(
            r#"
            INSERT INTO conversation_summary_idle_task (
              session_id, last_active_epoch, run_after_epoch, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE
            SET last_active_epoch = excluded.last_active_epoch,
                run_after_epoch = conversation_summary_idle_task.run_after_epoch,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&normalized_session_id)
        .bind(now_epoch)
        .bind(run_after_epoch)
        .bind(&now)
        .bind(&now)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn try_trigger_local_conversation_summary_flush(
        &self,
        session_id: &str,
        trigger_source: &str,
    ) -> Result<bool, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT total_tokens, summarizing
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("conversation session not found".to_string()))?;

        let total_tokens = session_row.try_get::<i64, _>("total_tokens").unwrap_or(0);
        let summarizing = session_row.try_get::<i64, _>("summarizing").unwrap_or(0) != 0;
        let message_count = session_row.try_get::<i64, _>("message_count").unwrap_or(0);
        if total_tokens < LOCAL_CONVERSATION_FLUSH_THRESHOLD_TOKENS
            || summarizing
            || message_count < 20
        {
            return Ok(false);
        }

        self.enqueue_local_conversation_summary_job(&normalized_session_id, trigger_source)
            .await?;
        Ok(true)
    }

    pub async fn dispatch_due_local_conversation_summary_idle_tasks(
        &self,
    ) -> Result<i64, McpError> {
        let now_epoch = now_unix_epoch()?;
        let due_rows = sqlx::query(
            r#"
            SELECT session_id, last_active_epoch
            FROM conversation_summary_idle_task
            WHERE run_after_epoch <= ?
            ORDER BY run_after_epoch ASC
            LIMIT ?;
            "#,
        )
        .bind(now_epoch)
        .bind(LOCAL_CONVERSATION_IDLE_CHECK_BATCH_SIZE)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut dispatched = 0_i64;
        for row in due_rows {
            let session_id: String = row.try_get("session_id")?;
            let last_active_epoch = row.try_get::<i64, _>("last_active_epoch").unwrap_or(0);

            let claim = sqlx::query(
                r#"
                DELETE FROM conversation_summary_idle_task
                WHERE session_id = ? AND run_after_epoch <= ?;
                "#,
            )
            .bind(&session_id)
            .bind(now_epoch)
            .execute(&self.write_pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if claim.rows_affected() == 0 {
                continue;
            }

            if now_epoch.saturating_sub(last_active_epoch) < LOCAL_CONVERSATION_SUMMARY_IDLE_SECONDS
            {
                continue;
            }

            let session_row = sqlx::query(
                r#"
                SELECT message_count, summarizing, last_summary_version, last_summary_generated_at
                FROM conversation_session
                WHERE id = ?
                LIMIT 1;
                "#,
            )
            .bind(&session_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let Some(session_row) = session_row else {
                continue;
            };

            let message_count = session_row.try_get::<i64, _>("message_count").unwrap_or(0);
            if message_count <= 0 {
                continue;
            }
            // 最少需要 20 轮对话才允许空闲触发摘要，避免短对话被过早压缩
            if message_count < 20 {
                continue;
            }
            let summarizing = session_row.try_get::<i64, _>("summarizing").unwrap_or(0) != 0;
            if summarizing {
                continue;
            }

            let max_turn_row = sqlx::query(
                r#"
                SELECT COALESCE(MAX(turn_index), 0) AS max_turn
                FROM conversation_message
                WHERE session_id = ? AND is_deleted = 0;
                "#,
            )
            .bind(&session_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let last_turn = max_turn_row.try_get::<i64, _>("max_turn").unwrap_or(0);
            if last_turn <= 0 {
                continue;
            }

            let last_summary_version = session_row
                .try_get::<i64, _>("last_summary_version")
                .unwrap_or(0);
            if last_summary_version > 0 {
                let covered_row = sqlx::query(
                    r#"
                    SELECT covered_to_turn
                    FROM conversation_summary
                    WHERE session_id = ? AND version = ?
                    LIMIT 1;
                    "#,
                )
                .bind(&session_id)
                .bind(last_summary_version)
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
                if let Some(covered_row) = covered_row {
                    let covered_to_turn = covered_row
                        .try_get::<i64, _>("covered_to_turn")
                        .unwrap_or(0);
                    if covered_to_turn >= last_turn {
                        continue;
                    }
                }
            }

            self.enqueue_local_conversation_summary_job(&session_id, "idle_check")
                .await?;
            dispatched = dispatched.saturating_add(1);
        }

        Ok(dispatched)
    }

    pub async fn upsert_local_periodic_task(
        &self,
        task_name: &str,
        interval_seconds: i64,
        initial_delay_seconds: i64,
    ) -> Result<(), McpError> {
        let normalized_task_name = task_name.trim().to_string();
        if normalized_task_name.is_empty() {
            return Err(McpError::validation("task_name is required"));
        }
        if interval_seconds <= 0 {
            return Err(McpError::validation(
                "interval_seconds must be greater than 0",
            ));
        }

        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let next_run_after_epoch = now_epoch.saturating_add(initial_delay_seconds.max(0));

        sqlx::query(
            r#"
            INSERT INTO local_periodic_task (
              task_name, interval_seconds, next_run_after_epoch, is_enabled,
              last_run_at, last_success_at, last_error, last_error_at,
              created_at, updated_at
            )
            VALUES (?, ?, ?, 1, NULL, NULL, NULL, NULL, ?, ?)
            ON CONFLICT(task_name) DO UPDATE
            SET interval_seconds = excluded.interval_seconds,
                is_enabled = 1,
                next_run_after_epoch = CASE
                    WHEN local_periodic_task.next_run_after_epoch < excluded.next_run_after_epoch
                    THEN local_periodic_task.next_run_after_epoch
                    ELSE excluded.next_run_after_epoch
                END,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&normalized_task_name)
        .bind(interval_seconds)
        .bind(next_run_after_epoch)
        .bind(&now)
        .bind(&now)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn claim_next_local_periodic_task(
        &self,
    ) -> Result<Option<LocalPeriodicTask>, McpError> {
        let now = now_rfc3339()?;
        let now_epoch = now_unix_epoch()?;
        let mut tx = self.begin_write().await?;

        let task_row = sqlx::query(
            r#"
            SELECT task_name, interval_seconds, next_run_after_epoch
            FROM local_periodic_task
            WHERE is_enabled = 1 AND next_run_after_epoch <= ?
            ORDER BY next_run_after_epoch ASC
            LIMIT 1;
            "#,
        )
        .bind(now_epoch)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let Some(row) = task_row else {
            tx.commit().await?;
            return Ok(None);
        };

        let task_name: String = row.try_get("task_name")?;
        let interval_seconds = row
            .try_get::<i64, _>("interval_seconds")
            .unwrap_or(60)
            .max(1);
        let next_run_after_epoch = now_epoch.saturating_add(interval_seconds);

        let result = sqlx::query(
            r#"
            UPDATE local_periodic_task
            SET next_run_after_epoch = ?,
                last_run_at = ?,
                updated_at = ?
            WHERE task_name = ? AND is_enabled = 1 AND next_run_after_epoch <= ?;
            "#,
        )
        .bind(next_run_after_epoch)
        .bind(&now)
        .bind(&now)
        .bind(&task_name)
        .bind(now_epoch)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            tx.commit().await?;
            return Ok(None);
        }

        tx.commit().await?;
        Ok(Some(LocalPeriodicTask {
            task_name,
            interval_seconds,
        }))
    }

    pub async fn mark_local_periodic_task_success(&self, task_name: &str) -> Result<(), McpError> {
        let normalized_task_name = task_name.trim().to_string();
        if normalized_task_name.is_empty() {
            return Err(McpError::validation("task_name is required"));
        }
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            UPDATE local_periodic_task
            SET last_success_at = ?,
                last_error = NULL,
                last_error_at = NULL,
                updated_at = ?
            WHERE task_name = ?;
            "#,
        )
        .bind(&now)
        .bind(&now)
        .bind(&normalized_task_name)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn mark_local_periodic_task_failure(
        &self,
        task_name: &str,
        error_message: &str,
    ) -> Result<(), McpError> {
        let normalized_task_name = task_name.trim().to_string();
        if normalized_task_name.is_empty() {
            return Err(McpError::validation("task_name is required"));
        }
        let now = now_rfc3339()?;
        let normalized_error = {
            let trimmed = error_message.trim();
            if trimmed.is_empty() {
                "periodic task failed".to_string()
            } else {
                trimmed
                    .chars()
                    .take(LOCAL_PERIODIC_TASK_MAX_ERROR_CHARS)
                    .collect()
            }
        };

        sqlx::query(
            r#"
            UPDATE local_periodic_task
            SET last_error = ?,
                last_error_at = ?,
                updated_at = ?
            WHERE task_name = ?;
            "#,
        )
        .bind(&normalized_error)
        .bind(&now)
        .bind(&now)
        .bind(&normalized_task_name)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn cleanup_old_local_conversation_summary_jobs(
        &self,
        older_than_seconds: i64,
    ) -> Result<i64, McpError> {
        if older_than_seconds <= 0 {
            return Err(McpError::validation(
                "older_than_seconds must be greater than 0",
            ));
        }
        let threshold_epoch = now_unix_epoch()?.saturating_sub(older_than_seconds);
        let result = sqlx::query(
            r#"
            DELETE FROM conversation_summary_job
            WHERE status IN (?, ?)
              AND COALESCE(CAST(strftime('%s', updated_at) AS INTEGER), 0) <= ?;
            "#,
        )
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_COMPLETED)
        .bind(CONVERSATION_SUMMARY_JOB_STATUS_FAILED)
        .bind(threshold_epoch)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(i64::try_from(result.rows_affected()).unwrap_or(i64::MAX))
    }

    pub async fn cleanup_expired_local_conversations(
        &self,
        retention_days: i64,
    ) -> Result<i64, McpError> {
        if retention_days <= 0 {
            return Err(McpError::validation(
                "retention_days must be greater than 0",
            ));
        }

        let retention_seconds = retention_days.saturating_mul(24 * 60 * 60);
        let threshold_epoch = now_unix_epoch()?.saturating_sub(retention_seconds);
        let rows = sqlx::query(
            r#"
            SELECT id, last_active_at
            FROM conversation_session;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let expired_ids: Vec<String> = rows
            .into_iter()
            .filter_map(|row| {
                let session_id = row.try_get::<String, _>("id").ok()?;
                let last_active_at = row.try_get::<String, _>("last_active_at").ok()?;
                let last_active_epoch = parse_rfc3339_to_unix_epoch(&last_active_at)?;
                if last_active_epoch <= threshold_epoch {
                    Some(session_id)
                } else {
                    None
                }
            })
            .collect();

        if expired_ids.is_empty() {
            return Ok(0);
        }

        let mut tx = self.begin_write().await?;
        let mut deleted = 0_i64;
        for session_id in expired_ids {
            sqlx::query(
                r#"
                DELETE FROM conversation_summary
                WHERE session_id = ?;
                "#,
            )
            .bind(&session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            sqlx::query(
                r#"
                DELETE FROM conversation_summary_job
                WHERE session_id = ?;
                "#,
            )
            .bind(&session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            sqlx::query(
                r#"
                DELETE FROM conversation_summary_idle_task
                WHERE session_id = ?;
                "#,
            )
            .bind(&session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            for marker_key in build_session_scoped_fact_extraction_marker_keys(&session_id) {
                sqlx::query(
                    r#"
                    DELETE FROM desktop_config
                    WHERE key = ?;
                    "#,
                )
                .bind(&marker_key)
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            }
            sqlx::query(
                r#"
                DELETE FROM conversation_message
                WHERE session_id = ?;
                "#,
            )
            .bind(&session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let result = sqlx::query(
                r#"
                DELETE FROM conversation_session
                WHERE id = ?;
                "#,
            )
            .bind(&session_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            deleted += i64::try_from(result.rows_affected()).unwrap_or(i64::MAX);
        }
        tx.commit().await?;

        Ok(deleted)
    }

    pub async fn cleanup_expired_local_conversations_from_retention_config(
        &self,
    ) -> Result<i64, McpError> {
        let retention_days = parse_chat_history_retention_days(
            self.get_desktop_config(CHAT_HISTORY_RETENTION_CONFIG_KEY)
                .await?,
        );
        let Some(retention_days) = retention_days else {
            return Ok(0);
        };
        self.cleanup_expired_local_conversations(retention_days)
            .await
    }

    pub async fn get_local_conversation_history(
        &self,
        session_id: &str,
        query: LocalConversationHistoryQuery,
    ) -> Result<LocalConversationHistoryResponse, McpError> {
        let limit = query.limit.unwrap_or(30).clamp(1, 200);
        let before_turn = query.cursor;

        let rows = if let Some(cursor) = before_turn {
            sqlx::query(
                r#"
                SELECT role, content, turn_index, created_at, is_truncated, name, meta_info
                FROM conversation_message
                WHERE session_id = ? AND is_deleted = 0 AND turn_index < ?
                ORDER BY turn_index DESC
                LIMIT ?;
                "#,
            )
            .bind(session_id)
            .bind(cursor)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        } else {
            sqlx::query(
                r#"
                SELECT role, content, turn_index, created_at, is_truncated, name, meta_info
                FROM conversation_message
                WHERE session_id = ? AND is_deleted = 0
                ORDER BY turn_index DESC
                LIMIT ?;
                "#,
            )
            .bind(session_id)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        };

        let mut messages_desc = Vec::with_capacity(rows.len());
        for row in rows {
            let content_text: Option<String> = row.try_get("content")?;
            let meta_info_text: Option<String> = row.try_get("meta_info")?;
            messages_desc.push(LocalConversationHistoryMessage {
                role: row.try_get("role")?,
                content: content_text.map(serde_json::Value::String),
                turn_index: row.try_get("turn_index")?,
                created_at: row.try_get("created_at")?,
                is_truncated: Some(row.try_get::<i64, _>("is_truncated")? != 0),
                name: row.try_get("name")?,
                meta_info: match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                },
            });
        }

        let oldest_turn = messages_desc
            .last()
            .and_then(|item| item.turn_index)
            .unwrap_or_default();
        let has_more = if messages_desc.is_empty() {
            false
        } else {
            let row = sqlx::query(
                r#"
                SELECT EXISTS(
                  SELECT 1
                  FROM conversation_message
                  WHERE session_id = ? AND is_deleted = 0 AND turn_index < ?
                ) AS has_more;
                "#,
            )
            .bind(session_id)
            .bind(oldest_turn)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            row.try_get::<i64, _>("has_more")? != 0
        };

        let mut messages = messages_desc;
        messages.reverse();

        Ok(LocalConversationHistoryResponse {
            session_id: session_id.to_string(),
            messages,
            next_cursor: if has_more { Some(oldest_turn) } else { None },
            has_more,
        })
    }

    pub async fn get_local_conversation_window(
        &self,
        session_id: &str,
    ) -> Result<LocalConversationWindowResponse, McpError> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err(McpError::validation("session_id is required"));
        }

        let session_row = sqlx::query(
            r#"
            SELECT
              id, title, status, message_count, total_tokens, last_summary_version,
              summarizing, summary_job_id, last_summary_generated_at,
              last_model_id, last_provider_model_id,
              pinned_model_key, pinned_provider_model_id, pinned_binding_source,
              first_message_at, last_active_at, created_at, updated_at
            FROM conversation_session
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let session_row = match session_row {
            Some(row) => row,
            None => {
                return Err(McpError::NotFound(
                    "conversation session not found".to_string(),
                ))
            }
        };

        let rows = sqlx::query(
            r#"
            SELECT role, content, turn_index, created_at, is_truncated, name, meta_info
            FROM conversation_message
            WHERE session_id = ? AND is_deleted = 0
            ORDER BY turn_index ASC;
            "#,
        )
        .bind(&normalized_session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut messages = Vec::with_capacity(rows.len());
        for row in rows {
            let content_text: Option<String> = row.try_get("content")?;
            let meta_info_text: Option<String> = row.try_get("meta_info")?;
            messages.push(LocalConversationHistoryMessage {
                role: row.try_get("role")?,
                content: content_text.map(serde_json::Value::String),
                turn_index: row.try_get("turn_index")?,
                created_at: row.try_get("created_at")?,
                is_truncated: Some(row.try_get::<i64, _>("is_truncated")? != 0),
                name: row.try_get("name")?,
                meta_info: match meta_info_text {
                    Some(text) if !text.trim().is_empty() => serde_json::from_str(&text).ok(),
                    _ => None,
                },
            });
        }

        let last_summary_version: i64 = session_row.try_get("last_summary_version").unwrap_or(0);
        let summary = if last_summary_version > 0 {
            let summary_row = sqlx::query(
                r#"
                SELECT
                  id, version, summary_text, covered_from_turn, covered_to_turn,
                  token_estimate, summarizer_model, created_at, updated_at
                FROM conversation_summary
                WHERE session_id = ? AND version = ?
                LIMIT 1;
                "#,
            )
            .bind(&normalized_session_id)
            .bind(last_summary_version)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            summary_row.map(|row| {
                serde_json::json!({
                    "id": row.try_get::<String, _>("id").ok(),
                    "version": row.try_get::<i64, _>("version").ok(),
                    "summary_text": row.try_get::<String, _>("summary_text").ok(),
                    "covered_from_turn": row.try_get::<i64, _>("covered_from_turn").ok(),
                    "covered_to_turn": row.try_get::<i64, _>("covered_to_turn").ok(),
                    "token_estimate": row.try_get::<i64, _>("token_estimate").ok().unwrap_or(0),
                    "summarizer_model": row.try_get::<Option<String>, _>("summarizer_model").ok().flatten(),
                    "created_at": row.try_get::<String, _>("created_at").ok(),
                    "updated_at": row.try_get::<String, _>("updated_at").ok(),
                })
            })
        } else {
            None
        };

        let meta = Some(serde_json::json!({
            "title": session_row.try_get::<Option<String>, _>("title").ok().flatten(),
            "status": session_row.try_get::<String, _>("status").ok(),
            "message_count": session_row.try_get::<i64, _>("message_count").ok().unwrap_or(0),
            "total_tokens": session_row.try_get::<i64, _>("total_tokens").ok().unwrap_or(0),
            "last_summary_version": last_summary_version,
            "summarizing": session_row.try_get::<i64, _>("summarizing").ok().unwrap_or(0) != 0,
            "summary_job_id": session_row.try_get::<Option<String>, _>("summary_job_id").ok().flatten(),
            "last_summary_generated_at": session_row.try_get::<Option<String>, _>("last_summary_generated_at").ok().flatten(),
            "last_model_id": session_row.try_get::<Option<String>, _>("last_model_id").ok().flatten(),
            "last_provider_model_id": session_row.try_get::<Option<String>, _>("last_provider_model_id").ok().flatten(),
            "pinned_model_key": session_row.try_get::<Option<String>, _>("pinned_model_key").ok().flatten(),
            "pinned_provider_model_id": session_row.try_get::<Option<String>, _>("pinned_provider_model_id").ok().flatten(),
            "pinned_binding_source": session_row.try_get::<Option<String>, _>("pinned_binding_source").ok().flatten(),
            "first_message_at": session_row.try_get::<Option<String>, _>("first_message_at").ok().flatten(),
            "last_active_at": session_row.try_get::<Option<String>, _>("last_active_at").ok().flatten(),
            "created_at": session_row.try_get::<Option<String>, _>("created_at").ok().flatten(),
            "updated_at": session_row.try_get::<Option<String>, _>("updated_at").ok().flatten(),
        }));

        Ok(LocalConversationWindowResponse {
            session_id: normalized_session_id,
            messages,
            meta,
            summary,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_session_scoped_fact_extraction_marker_keys, McpStore,
        CHAT_HISTORY_RETENTION_CONFIG_KEY,
    };
    use mcp_session::conversation::{
        CreateConversationMessageRequest, LocalConversationCreateRequest,
    };
    use sqlx::Row;
    use uuid::Uuid;

    async fn create_test_store(name: &str) -> McpStore {
        let db_path = std::env::temp_dir().join(format!(
            "deeting-conversations-{name}-{}.db",
            Uuid::new_v4()
        ));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        let store = McpStore::new(&database_url)
            .await
            .expect("create test conversation store");
        store.init().await.expect("init conversation test store");
        store
    }

    #[tokio::test]
    async fn chat_retention_cleanup_deletes_expired_sessions_and_keeps_recent_ones() {
        let store = create_test_store("chat-retention").await;
        let now = mcp_storage::helpers::now_rfc3339().expect("current time");
        let expired_marker_keys =
            build_session_scoped_fact_extraction_marker_keys("expired-session");
        let recent_marker_keys = build_session_scoped_fact_extraction_marker_keys("recent-session");

        store
            .set_desktop_config(CHAT_HISTORY_RETENTION_CONFIG_KEY, "7")
            .await
            .expect("persist retention config");

        sqlx::query(
            r#"
            INSERT INTO conversation_session (
              id, channel, status, title, message_count, total_tokens,
              last_summary_version, summarizing, summary_job_id, last_summary_generated_at,
              last_model_id, last_provider_model_id, first_message_at, last_active_at,
              created_at, updated_at
            )
            VALUES (?, 'internal', 'active', ?, 1, 0, 0, 0, '', NULL, NULL, NULL, ?, ?, ?, ?);
            "#,
        )
        .bind("expired-session")
        .bind("Expired")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(&store.pool)
        .await
        .expect("insert expired session");

        sqlx::query(
            r#"
            INSERT INTO conversation_message (
              id, session_id, turn_index, role, content, token_estimate,
              is_truncated, is_deleted, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?);
            "#,
        )
        .bind("expired-message")
        .bind("expired-session")
        .bind(1_i64)
        .bind("user")
        .bind("old message")
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(&store.pool)
        .await
        .expect("insert expired message");

        for marker_key in &expired_marker_keys {
            store
                .set_desktop_config(marker_key, "1")
                .await
                .expect("persist expired marker");
        }

        sqlx::query(
            r#"
            INSERT INTO conversation_session (
              id, channel, status, title, message_count, total_tokens,
              last_summary_version, summarizing, summary_job_id, last_summary_generated_at,
              last_model_id, last_provider_model_id, first_message_at, last_active_at,
              created_at, updated_at
            )
            VALUES (?, 'internal', 'active', ?, 1, 0, 0, 0, '', NULL, NULL, NULL, ?, ?, ?, ?);
            "#,
        )
        .bind("recent-session")
        .bind("Recent")
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&store.pool)
        .await
        .expect("insert recent session");

        for marker_key in &recent_marker_keys {
            store
                .set_desktop_config(marker_key, "1")
                .await
                .expect("persist recent marker");
        }

        let deleted = store
            .cleanup_expired_local_conversations_from_retention_config()
            .await
            .expect("run chat retention cleanup");

        assert_eq!(deleted, 1);

        let remaining_sessions =
            sqlx::query("SELECT id FROM conversation_session ORDER BY id ASC;")
                .fetch_all(&store.pool)
                .await
                .expect("list remaining sessions");
        let remaining_session_ids: Vec<String> = remaining_sessions
            .into_iter()
            .map(|row| row.try_get("id").expect("session id"))
            .collect();
        assert_eq!(remaining_session_ids, vec!["recent-session".to_string()]);

        let remaining_message_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM conversation_message WHERE session_id = ?;")
                .bind("expired-session")
                .fetch_one(&store.pool)
                .await
                .expect("count remaining expired messages");
        assert_eq!(remaining_message_count, 0);

        let remaining_expired_marker_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM desktop_config WHERE key LIKE ?;")
                .bind("fact_extraction.%.expired-session")
                .fetch_one(&store.pool)
                .await
                .expect("count remaining expired markers");
        assert_eq!(remaining_expired_marker_count, 0);

        let remaining_recent_marker_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM desktop_config WHERE key LIKE ?;")
                .bind("fact_extraction.%.recent-session")
                .fetch_one(&store.pool)
                .await
                .expect("count remaining recent markers");
        assert_eq!(
            remaining_recent_marker_count,
            i64::try_from(recent_marker_keys.len()).expect("recent marker key count")
        );
    }

    #[tokio::test]
    async fn clear_local_conversation_removes_session_fact_extraction_markers() {
        let store = create_test_store("chat-clear-markers").await;
        let created = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("Clear markers".to_string()),
            })
            .await
            .expect("create session");
        let marker_keys =
            build_session_scoped_fact_extraction_marker_keys(created.session_id.as_str());

        for marker_key in &marker_keys {
            store
                .set_desktop_config(marker_key, "1")
                .await
                .expect("persist clear marker");
        }

        store
            .clear_local_conversation(created.session_id.as_str())
            .await
            .expect("clear local conversation");

        let remaining_marker_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM desktop_config WHERE key LIKE ?;")
                .bind(format!("fact_extraction.%.{}", created.session_id))
                .fetch_one(&store.pool)
                .await
                .expect("count remaining clear markers");
        assert_eq!(remaining_marker_count, 0);

        let remaining_session_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM conversation_session WHERE id = ?;")
                .bind(created.session_id.as_str())
                .fetch_one(&store.pool)
                .await
                .expect("count remaining cleared session");
        assert_eq!(remaining_session_count, 1);
    }

    #[tokio::test]
    async fn append_message_syncs_execution_tree_into_execution_tables() {
        let store = create_test_store("execution-tree-sync").await;
        let created = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("Execution Tree".to_string()),
            })
            .await
            .expect("create conversation");

        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: created.session_id.clone(),
                role: "assistant".to_string(),
                content: "delegated result".to_string(),
                name: None,
                meta_info: Some(serde_json::json!({
                    "execution_tree": {
                        "schema_version": 1,
                        "root_execution_id": "exec-root-1",
                        "execution_id": "exec-root-1",
                        "execution_kind": "workflow",
                        "execution_status": "integrated",
                        "terminal_status": "succeeded",
                        "target": {
                            "id": "worker-1",
                            "name": "Research Worker",
                            "workflow_run_id": "run-123",
                        },
                        "children": [
                            {
                                "id": "step-1",
                                "phase_id": "phase-1",
                                "step_type": "worker_call",
                                "title": "Execute",
                                "status": "succeeded",
                                "available_actions": [{ "kind": "open" }]
                            }
                        ]
                    }
                })),
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append assistant message");

        let execution_tree = store
            .get_local_conversation_execution_tree("exec-root-1")
            .await
            .expect("query execution tree")
            .expect("execution tree exists");

        assert_eq!(execution_tree.root.root_execution_id, "exec-root-1");
        assert_eq!(execution_tree.root.session_id, created.session_id);
        assert_eq!(execution_tree.root.execution_kind, "workflow");
        assert_eq!(
            execution_tree.root.target_workflow_run_id.as_deref(),
            Some("run-123")
        );
        assert_eq!(execution_tree.children.len(), 1);
        assert_eq!(execution_tree.children[0].id, "step-1");
        assert_eq!(
            execution_tree.children[0].phase_id.as_deref(),
            Some("phase-1")
        );
    }

    #[tokio::test]
    async fn update_assistant_meta_info_resyncs_execution_tree_rows() {
        let store = create_test_store("execution-tree-resync").await;
        let created = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("Execution Tree Update".to_string()),
            })
            .await
            .expect("create conversation");

        let appended = store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: created.session_id.clone(),
                role: "assistant".to_string(),
                content: "delegated result".to_string(),
                name: None,
                meta_info: Some(serde_json::json!({
                    "execution_tree": {
                        "schema_version": 1,
                        "root_execution_id": "exec-root-update-1",
                        "execution_id": "exec-root-update-1",
                        "execution_kind": "workflow",
                        "execution_status": "waiting_graph",
                        "terminal_status": "waiting_graph",
                        "children": [
                            {
                                "id": "step-old",
                                "title": "Old Child",
                                "status": "pending"
                            }
                        ]
                    }
                })),
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append assistant message");

        let updated_meta = serde_json::json!({
            "execution_tree": {
                "schema_version": 1,
                "root_execution_id": "exec-root-update-1",
                "execution_id": "exec-root-update-1",
                "execution_kind": "workflow",
                "execution_status": "integrated",
                "terminal_status": "succeeded",
                "children": [
                    {
                        "id": "step-new",
                        "phase_id": "phase-updated",
                        "title": "Updated Child",
                        "status": "succeeded"
                    }
                ]
            }
        });

        store
            .update_local_conversation_assistant_meta_info(
                &created.session_id,
                appended.turn_index.expect("assistant turn index"),
                Some(updated_meta),
            )
            .await
            .expect("update assistant meta info");

        let execution_tree = store
            .get_local_conversation_execution_tree("exec-root-update-1")
            .await
            .expect("query execution tree")
            .expect("execution tree exists");

        assert_eq!(execution_tree.root.execution_status, "integrated");
        assert_eq!(execution_tree.root.terminal_status, "succeeded");
        assert_eq!(execution_tree.children.len(), 1);
        assert_eq!(execution_tree.children[0].id, "step-new");
        assert_eq!(
            execution_tree.children[0].phase_id.as_deref(),
            Some("phase-updated")
        );
    }
}
