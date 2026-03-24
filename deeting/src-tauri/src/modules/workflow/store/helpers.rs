use std::str::FromStr;

use serde::Serialize;
use serde_json::Value;
use sqlx::sqlite::SqliteRow;
use sqlx::Row;

use super::schema::{WORKFLOW_RUN_TABLE, WORKFLOW_STEP_RUN_TABLE};
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use crate::modules::workflow::types::{
    WorkflowArtifactKind, WorkflowRunStatus, WorkflowStepStatus, WorkflowStepType,
};

pub(super) fn now_rfc3339() -> Result<String, McpError> {
    Ok(time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| McpError::Storage(err.to_string()))?)
}

pub(super) fn parse_required_json(raw: &str, label: &str) -> Result<Value, McpError> {
    serde_json::from_str(raw)
        .map_err(|err| McpError::Storage(format!("invalid {label} json: {err}")))
}

pub(super) fn parse_optional_json(
    raw: Option<String>,
    label: &str,
) -> Result<Option<Value>, McpError> {
    raw.map(|value| parse_required_json(&value, label))
        .transpose()
}

pub(super) fn parse_string_list(raw: Option<String>, label: &str) -> Result<Vec<String>, McpError> {
    let Some(value) = raw else {
        return Ok(Vec::new());
    };
    serde_json::from_str::<Vec<String>>(&value)
        .map_err(|err| McpError::Storage(format!("invalid {label} json list: {err}")))
}

pub(super) fn serialize_json<T: Serialize + ?Sized>(value: &T) -> Result<String, McpError> {
    serde_json::to_string(value).map_err(|err| McpError::Storage(err.to_string()))
}

pub(super) fn serialize_json_opt<T: Serialize>(
    value: Option<&T>,
) -> Result<Option<String>, McpError> {
    value.map(serialize_json).transpose()
}

pub(super) fn parse_run_status(
    row: &SqliteRow,
    column: &str,
) -> Result<WorkflowRunStatus, McpError> {
    let value: String = row
        .try_get(column)
        .map_err(|err| McpError::Storage(err.to_string()))?;
    WorkflowRunStatus::from_str(&value).map_err(McpError::Storage)
}

pub(super) fn parse_step_status(
    row: &SqliteRow,
    column: &str,
) -> Result<WorkflowStepStatus, McpError> {
    let value: String = row
        .try_get(column)
        .map_err(|err| McpError::Storage(err.to_string()))?;
    WorkflowStepStatus::from_str(&value).map_err(McpError::Storage)
}

pub(super) fn parse_step_type(row: &SqliteRow, column: &str) -> Result<WorkflowStepType, McpError> {
    let value: String = row
        .try_get(column)
        .map_err(|err| McpError::Storage(err.to_string()))?;
    WorkflowStepType::from_str(&value).map_err(McpError::Storage)
}

pub(super) fn parse_artifact_kind(
    row: &SqliteRow,
    column: &str,
) -> Result<WorkflowArtifactKind, McpError> {
    let value: String = row
        .try_get(column)
        .map_err(|err| McpError::Storage(err.to_string()))?;
    WorkflowArtifactKind::from_str(&value).map_err(McpError::Storage)
}

pub(super) async fn ensure_run_exists(store: &McpStore, run_id: &str) -> Result<(), McpError> {
    let exists = sqlx::query_scalar::<_, i64>(&format!(
        "SELECT 1 FROM {WORKFLOW_RUN_TABLE} WHERE id = ? LIMIT 1"
    ))
    .bind(run_id)
    .fetch_optional(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?
    .is_some();

    if exists {
        Ok(())
    } else {
        Err(McpError::NotFound("workflow run not found".to_string()))
    }
}

pub(super) async fn ensure_step_belongs_to_run(
    store: &McpStore,
    step_id: &str,
    run_id: &str,
) -> Result<(), McpError> {
    let exists = sqlx::query_scalar::<_, i64>(&format!(
        "SELECT 1 FROM {WORKFLOW_STEP_RUN_TABLE} WHERE id = ? AND run_id = ? LIMIT 1"
    ))
    .bind(step_id)
    .bind(run_id)
    .fetch_optional(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?
    .is_some();

    if exists {
        Ok(())
    } else {
        Err(McpError::NotFound(
            "workflow step not found for run".to_string(),
        ))
    }
}
