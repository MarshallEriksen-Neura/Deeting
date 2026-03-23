use sqlx::{sqlite::SqliteRow, Row};
use uuid::Uuid;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use crate::modules::workflow::types::{
    CreateWorkflowStepRunRequest, WorkflowStepRun, WorkflowStepStatus,
};

use super::helpers::{
    ensure_run_exists, now_rfc3339, parse_optional_json, parse_step_status, parse_step_type, parse_string_list,
    serialize_json,
};
use super::schema::{ensure_schema, WORKFLOW_STEP_RUN_TABLE};

pub(crate) async fn create_workflow_step_run(
    store: &McpStore,
    req: CreateWorkflowStepRunRequest,
) -> Result<WorkflowStepRun, McpError> {
    ensure_schema(store).await?;

    let run_id = req.run_id.trim().to_string();
    if run_id.is_empty() {
        return Err(McpError::validation("workflow step run_id is required"));
    }
    ensure_run_exists(store, &run_id).await?;
    let phase_id = req.phase_id.trim().to_string();
    if phase_id.is_empty() {
        return Err(McpError::validation("workflow step phase_id is required"));
    }
    if req.phase_index < 0 {
        return Err(McpError::validation("workflow step phase_index must be >= 0"));
    }
    let title = req.title.trim().to_string();
    if title.is_empty() {
        return Err(McpError::validation("workflow step title is required"));
    }
    let worker_ref = req
        .worker_ref
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let goal = req
        .goal
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let id = Uuid::new_v4().to_string();
    let now = now_rfc3339()?;
    let empty_artifacts = serialize_json(&Vec::<String>::new())?;

    sqlx::query(&format!(
        r#"
        INSERT INTO {WORKFLOW_STEP_RUN_TABLE}
          (id, run_id, phase_id, phase_index, step_type, title, status, worker_ref, goal, input_snapshot,
           output_artifact_refs, worker_trace_summary, retry_count, error, started_at, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, ?, NULL, 0, NULL, NULL, NULL, ?, ?);
        "#
    ))
    .bind(&id)
    .bind(&run_id)
    .bind(&phase_id)
    .bind(req.phase_index)
    .bind(req.step_type.as_str())
    .bind(&title)
    .bind(worker_ref.as_deref())
    .bind(goal.as_deref())
    .bind(empty_artifacts)
    .bind(&now)
    .bind(&now)
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(WorkflowStepRun {
        id,
        run_id,
        phase_id,
        phase_index: req.phase_index,
        step_type: req.step_type,
        title,
        status: WorkflowStepStatus::Pending,
        worker_ref,
        goal,
        input_snapshot: None,
        output_artifact_refs: Vec::new(),
        worker_trace_summary: None,
        retry_count: 0,
        error: None,
        started_at: None,
        completed_at: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn get_workflow_step_run(
    store: &McpStore,
    id: &str,
) -> Result<Option<WorkflowStepRun>, McpError> {
    ensure_schema(store).await?;
    let row = sqlx::query(&format!(
        "SELECT * FROM {WORKFLOW_STEP_RUN_TABLE} WHERE id = ? LIMIT 1"
    ))
    .bind(id.trim())
    .fetch_optional(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;
    row.as_ref().map(row_to_workflow_step_run).transpose()
}

pub(crate) async fn list_workflow_step_runs_by_run(
    store: &McpStore,
    run_id: &str,
) -> Result<Vec<WorkflowStepRun>, McpError> {
    ensure_schema(store).await?;
    let rows = sqlx::query(&format!(
        "SELECT * FROM {WORKFLOW_STEP_RUN_TABLE} WHERE run_id = ? ORDER BY phase_index ASC, created_at ASC"
    ))
    .bind(run_id.trim())
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    rows.iter().map(row_to_workflow_step_run).collect()
}

pub(crate) async fn update_workflow_step_status(
    store: &McpStore,
    id: &str,
    status: WorkflowStepStatus,
) -> Result<(), McpError> {
    ensure_schema(store).await?;
    let now = now_rfc3339()?;
    let result = sqlx::query(&format!(
        "UPDATE {WORKFLOW_STEP_RUN_TABLE} SET status = ?, updated_at = ? WHERE id = ?"
    ))
    .bind(status.as_str())
    .bind(&now)
    .bind(id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(McpError::NotFound("workflow step run not found".to_string()));
    }
    Ok(())
}

pub(crate) async fn update_workflow_step_result(
    store: &McpStore,
    id: &str,
    output_artifact_refs: &[String],
    worker_trace_summary: Option<&str>,
    completed_at: &str,
) -> Result<(), McpError> {
    ensure_schema(store).await?;
    let now = now_rfc3339()?;
    let artifact_json = serialize_json(output_artifact_refs)?;
    let result = sqlx::query(&format!(
        r#"
        UPDATE {WORKFLOW_STEP_RUN_TABLE}
        SET status = 'succeeded',
            output_artifact_refs = ?,
            worker_trace_summary = ?,
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
        "#
    ))
    .bind(artifact_json)
    .bind(worker_trace_summary)
    .bind(completed_at)
    .bind(&now)
    .bind(id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(McpError::NotFound("workflow step run not found".to_string()));
    }
    Ok(())
}

fn row_to_workflow_step_run(row: &SqliteRow) -> Result<WorkflowStepRun, McpError> {
    Ok(WorkflowStepRun {
        id: row
            .try_get("id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        run_id: row
            .try_get("run_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        phase_id: row
            .try_get("phase_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        phase_index: row
            .try_get("phase_index")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        step_type: parse_step_type(row, "step_type")?,
        title: row
            .try_get("title")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        status: parse_step_status(row, "status")?,
        worker_ref: row
            .try_get("worker_ref")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        goal: row
            .try_get("goal")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        input_snapshot: parse_optional_json(
            row.try_get("input_snapshot")
                .map_err(|err| McpError::Storage(err.to_string()))?,
            "workflow_step_run.input_snapshot",
        )?,
        output_artifact_refs: parse_string_list(
            row.try_get("output_artifact_refs")
                .map_err(|err| McpError::Storage(err.to_string()))?,
            "workflow_step_run.output_artifact_refs",
        )?,
        worker_trace_summary: row
            .try_get("worker_trace_summary")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        retry_count: row
            .try_get("retry_count")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        error: row
            .try_get("error")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        started_at: row
            .try_get("started_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        completed_at: row
            .try_get("completed_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        created_at: row
            .try_get("created_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
    })
}
