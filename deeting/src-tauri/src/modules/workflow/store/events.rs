use sqlx::{sqlite::SqliteRow, Row};
use uuid::Uuid;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use crate::modules::workflow::types::{CreateWorkflowEventRequest, WorkflowEvent};

use super::helpers::{
    ensure_run_exists, ensure_step_belongs_to_run, now_rfc3339, parse_optional_json,
    serialize_json_opt,
};
use super::schema::{ensure_schema, WORKFLOW_EVENT_TABLE};

pub(crate) async fn create_workflow_event(
    store: &McpStore,
    req: CreateWorkflowEventRequest,
) -> Result<WorkflowEvent, McpError> {
    ensure_schema(store).await?;

    let run_id = req.run_id.trim().to_string();
    if run_id.is_empty() {
        return Err(McpError::validation("workflow event run_id is required"));
    }
    ensure_run_exists(store, &run_id).await?;
    let event_type = req.event_type.trim().to_string();
    if event_type.is_empty() {
        return Err(McpError::validation("workflow event_type is required"));
    }
    if let Some(step_id) = req
        .step_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        ensure_step_belongs_to_run(store, step_id, &run_id).await?;
    }

    let id = Uuid::new_v4().to_string();
    let now = now_rfc3339()?;
    let payload_json = serialize_json_opt(req.payload.as_ref())?;

    sqlx::query(&format!(
        r#"
        INSERT INTO {WORKFLOW_EVENT_TABLE}
          (id, run_id, step_id, event_type, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        "#
    ))
    .bind(&id)
    .bind(&run_id)
    .bind(req.step_id.as_deref())
    .bind(&event_type)
    .bind(payload_json)
    .bind(&now)
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(WorkflowEvent {
        id,
        run_id,
        step_id: req.step_id,
        event_type,
        payload: req.payload,
        created_at: now,
    })
}

pub(crate) async fn list_workflow_events_by_run(
    store: &McpStore,
    run_id: &str,
) -> Result<Vec<WorkflowEvent>, McpError> {
    ensure_schema(store).await?;
    let rows = sqlx::query(&format!(
        "SELECT * FROM {WORKFLOW_EVENT_TABLE} WHERE run_id = ? ORDER BY created_at ASC, id ASC"
    ))
    .bind(run_id.trim())
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    rows.iter().map(row_to_workflow_event).collect()
}

fn row_to_workflow_event(row: &SqliteRow) -> Result<WorkflowEvent, McpError> {
    Ok(WorkflowEvent {
        id: row
            .try_get("id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        run_id: row
            .try_get("run_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        step_id: row
            .try_get("step_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        event_type: row
            .try_get("event_type")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        payload: parse_optional_json(
            row.try_get("payload")
                .map_err(|err| McpError::Storage(err.to_string()))?,
            "workflow_event.payload",
        )?,
        created_at: row
            .try_get("created_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
    })
}
