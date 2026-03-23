use sqlx::{sqlite::SqliteRow, Row};
use uuid::Uuid;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use crate::modules::workflow::types::{CreateWorkflowCheckpointRequest, WorkflowCheckpoint};

use super::helpers::{
    ensure_run_exists, ensure_step_belongs_to_run, now_rfc3339, parse_optional_json,
    serialize_json_opt,
};
use super::schema::{ensure_schema, WORKFLOW_CHECKPOINT_TABLE};

pub(crate) async fn create_workflow_checkpoint(
    store: &McpStore,
    req: CreateWorkflowCheckpointRequest,
) -> Result<WorkflowCheckpoint, McpError> {
    ensure_schema(store).await?;

    let run_id = req.run_id.trim().to_string();
    if run_id.is_empty() {
        return Err(McpError::validation("workflow checkpoint run_id is required"));
    }
    ensure_run_exists(store, &run_id).await?;
    let reason = req.reason.trim().to_string();
    if reason.is_empty() {
        return Err(McpError::validation("workflow checkpoint reason is required"));
    }
    if let Some(blocked_step_id) = req
        .blocked_step_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        ensure_step_belongs_to_run(store, blocked_step_id, &run_id).await?;
    }

    let id = Uuid::new_v4().to_string();
    let now = now_rfc3339()?;
    let approval_payload_json = serialize_json_opt(req.approval_payload.as_ref())?;

    sqlx::query(&format!(
        r#"
        INSERT INTO {WORKFLOW_CHECKPOINT_TABLE}
          (id, run_id, blocked_step_id, reason, approval_payload, resume_payload, resolved, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, NULL, 0, ?, NULL)
        "#
    ))
    .bind(&id)
    .bind(&run_id)
    .bind(req.blocked_step_id.as_deref())
    .bind(&reason)
    .bind(approval_payload_json)
    .bind(&now)
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(WorkflowCheckpoint {
        id,
        run_id,
        blocked_step_id: req.blocked_step_id,
        reason,
        approval_payload: req.approval_payload,
        resume_payload: None,
        resolved: false,
        created_at: now,
        resolved_at: None,
    })
}

pub(crate) async fn get_active_checkpoint_for_run(
    store: &McpStore,
    run_id: &str,
) -> Result<Option<WorkflowCheckpoint>, McpError> {
    ensure_schema(store).await?;
    let row = sqlx::query(&format!(
        "SELECT * FROM {WORKFLOW_CHECKPOINT_TABLE} WHERE run_id = ? AND resolved = 0 ORDER BY created_at DESC, id DESC LIMIT 1"
    ))
    .bind(run_id.trim())
    .fetch_optional(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;
    row.as_ref().map(row_to_workflow_checkpoint).transpose()
}

pub(crate) async fn resolve_checkpoint(
    store: &McpStore,
    id: &str,
    resume_payload: Option<&serde_json::Value>,
) -> Result<(), McpError> {
    ensure_schema(store).await?;
    let now = now_rfc3339()?;
    let resume_payload_json = serialize_json_opt(resume_payload)?;

    let result = sqlx::query(&format!(
        r#"
        UPDATE {WORKFLOW_CHECKPOINT_TABLE}
        SET resolved = 1, resume_payload = ?, resolved_at = ?
        WHERE id = ? AND resolved = 0
        "#
    ))
    .bind(resume_payload_json)
    .bind(&now)
    .bind(id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(McpError::NotFound(
            "active workflow checkpoint not found".to_string(),
        ));
    }
    Ok(())
}

fn row_to_workflow_checkpoint(row: &SqliteRow) -> Result<WorkflowCheckpoint, McpError> {
    Ok(WorkflowCheckpoint {
        id: row
            .try_get("id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        run_id: row
            .try_get("run_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        blocked_step_id: row
            .try_get("blocked_step_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        reason: row
            .try_get("reason")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        approval_payload: parse_optional_json(
            row.try_get("approval_payload")
                .map_err(|err| McpError::Storage(err.to_string()))?,
            "workflow_checkpoint.approval_payload",
        )?,
        resume_payload: parse_optional_json(
            row.try_get("resume_payload")
                .map_err(|err| McpError::Storage(err.to_string()))?,
            "workflow_checkpoint.resume_payload",
        )?,
        resolved: row
            .try_get::<i64, _>("resolved")
            .map_err(|err| McpError::Storage(err.to_string()))?
            != 0,
        created_at: row
            .try_get("created_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        resolved_at: row
            .try_get("resolved_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
    })
}
