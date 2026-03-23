use sqlx::{sqlite::SqliteRow, Row};
use uuid::Uuid;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use crate::modules::workflow::types::{CreateWorkflowRunRequest, WorkflowRun, WorkflowRunStatus};

use super::helpers::{now_rfc3339, parse_optional_json, parse_run_status};
use super::schema::{ensure_schema, WORKFLOW_RUN_TABLE};

pub(crate) async fn create_workflow_run(
    store: &McpStore,
    req: CreateWorkflowRunRequest,
) -> Result<WorkflowRun, McpError> {
    ensure_schema(store).await?;

    let title = req.title.trim().to_string();
    if title.is_empty() {
        return Err(McpError::validation("workflow run title is required"));
    }
    let goal = req.goal.trim().to_string();
    if goal.is_empty() {
        return Err(McpError::validation("workflow run goal is required"));
    }
    let proposal_text = req.proposal_text.and_then(|value| {
        if value.trim().is_empty() {
            None
        } else {
            Some(value)
        }
    });

    let id = Uuid::new_v4().to_string();
    let now = now_rfc3339()?;

    sqlx::query(&format!(
        r#"
        INSERT INTO {WORKFLOW_RUN_TABLE}
          (id, title, goal, status, proposal_text, snapshot_json, proposal_version, snapshot_version, run_dir, error, created_at, updated_at)
        VALUES (?, ?, ?, 'draft', ?, NULL, 0, 0, NULL, NULL, ?, ?);
        "#
    ))
    .bind(&id)
    .bind(&title)
    .bind(&goal)
    .bind(proposal_text.as_deref())
    .bind(&now)
    .bind(&now)
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(WorkflowRun {
        id,
        title,
        goal,
        status: WorkflowRunStatus::Draft,
        proposal_text,
        snapshot_json: None,
        proposal_version: 0,
        snapshot_version: 0,
        run_dir: None,
        error: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub(crate) async fn get_workflow_run(
    store: &McpStore,
    id: &str,
) -> Result<Option<WorkflowRun>, McpError> {
    ensure_schema(store).await?;
    let row = sqlx::query(&format!("SELECT * FROM {WORKFLOW_RUN_TABLE} WHERE id = ? LIMIT 1"))
        .bind(id.trim())
        .fetch_optional(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    row.as_ref().map(row_to_workflow_run).transpose()
}

pub(crate) async fn list_workflow_runs(store: &McpStore) -> Result<Vec<WorkflowRun>, McpError> {
    ensure_schema(store).await?;
    let rows = sqlx::query(&format!(
        "SELECT * FROM {WORKFLOW_RUN_TABLE} ORDER BY created_at DESC, updated_at DESC"
    ))
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    rows.iter().map(row_to_workflow_run).collect()
}

pub(crate) async fn update_workflow_run_status(
    store: &McpStore,
    id: &str,
    status: WorkflowRunStatus,
) -> Result<(), McpError> {
    ensure_schema(store).await?;
    let now = now_rfc3339()?;
    let result = sqlx::query(&format!(
        "UPDATE {WORKFLOW_RUN_TABLE} SET status = ?, updated_at = ? WHERE id = ?"
    ))
    .bind(status.as_str())
    .bind(&now)
    .bind(id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(McpError::NotFound("workflow run not found".to_string()));
    }
    Ok(())
}

pub(crate) async fn update_workflow_run_proposal(
    store: &McpStore,
    id: &str,
    proposal_text: &str,
    proposal_version: i64,
) -> Result<(), McpError> {
    ensure_schema(store).await?;
    let now = now_rfc3339()?;
    let normalized = proposal_text;
    if normalized.trim().is_empty() {
        return Err(McpError::validation("workflow proposal text is required"));
    }
    let result = sqlx::query(&format!(
        "UPDATE {WORKFLOW_RUN_TABLE} SET proposal_text = ?, proposal_version = ?, updated_at = ? WHERE id = ?"
    ))
    .bind(normalized)
    .bind(proposal_version)
    .bind(&now)
    .bind(id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(McpError::NotFound("workflow run not found".to_string()));
    }
    Ok(())
}

pub(crate) async fn update_workflow_run_snapshot(
    store: &McpStore,
    id: &str,
    snapshot_json: &serde_json::Value,
    snapshot_version: i64,
) -> Result<(), McpError> {
    ensure_schema(store).await?;
    let now = now_rfc3339()?;
    let snapshot_raw =
        serde_json::to_string(snapshot_json).map_err(|err| McpError::Storage(err.to_string()))?;
    let result = sqlx::query(&format!(
        "UPDATE {WORKFLOW_RUN_TABLE} SET snapshot_json = ?, snapshot_version = ?, updated_at = ? WHERE id = ?"
    ))
    .bind(snapshot_raw)
    .bind(snapshot_version)
    .bind(&now)
    .bind(id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(McpError::NotFound("workflow run not found".to_string()));
    }
    Ok(())
}

pub(crate) async fn update_workflow_run_run_dir(
    store: &McpStore,
    id: &str,
    run_dir: &str,
) -> Result<(), McpError> {
    ensure_schema(store).await?;
    let now = now_rfc3339()?;
    let normalized = run_dir.trim();
    if normalized.is_empty() {
        return Err(McpError::validation("workflow run_dir is required"));
    }
    let result = sqlx::query(&format!(
        "UPDATE {WORKFLOW_RUN_TABLE} SET run_dir = ?, updated_at = ? WHERE id = ?"
    ))
    .bind(normalized)
    .bind(&now)
    .bind(id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(McpError::NotFound("workflow run not found".to_string()));
    }
    Ok(())
}

pub(crate) async fn invalidate_workflow_run_compiled_state(
    store: &McpStore,
    id: &str,
    status: WorkflowRunStatus,
) -> Result<(), McpError> {
    ensure_schema(store).await?;
    let now = now_rfc3339()?;
    let result = sqlx::query(&format!(
        r#"
        UPDATE {WORKFLOW_RUN_TABLE}
        SET snapshot_json = NULL,
            status = ?,
            error = NULL,
            updated_at = ?
        WHERE id = ?
        "#
    ))
    .bind(status.as_str())
    .bind(&now)
    .bind(id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(McpError::NotFound("workflow run not found".to_string()));
    }
    Ok(())
}

pub(crate) async fn delete_workflow_run(store: &McpStore, id: &str) -> Result<(), McpError> {
    ensure_schema(store).await?;
    let result = sqlx::query(&format!("DELETE FROM {WORKFLOW_RUN_TABLE} WHERE id = ?"))
        .bind(id.trim())
        .execute(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(McpError::NotFound("workflow run not found".to_string()));
    }
    Ok(())
}

pub(crate) async fn transition_workflow_run_status_if_current(
    store: &McpStore,
    id: &str,
    from: WorkflowRunStatus,
    to: WorkflowRunStatus,
) -> Result<bool, McpError> {
    ensure_schema(store).await?;
    let now = now_rfc3339()?;
    let result = sqlx::query(&format!(
        "UPDATE {WORKFLOW_RUN_TABLE} SET status = ?, updated_at = ? WHERE id = ? AND status = ?"
    ))
    .bind(to.as_str())
    .bind(&now)
    .bind(id.trim())
    .bind(from.as_str())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(result.rows_affected() > 0)
}

fn row_to_workflow_run(row: &SqliteRow) -> Result<WorkflowRun, McpError> {
    Ok(WorkflowRun {
        id: row
            .try_get("id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        title: row
            .try_get("title")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        goal: row
            .try_get("goal")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        status: parse_run_status(row, "status")?,
        proposal_text: row
            .try_get("proposal_text")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        snapshot_json: parse_optional_json(
            row.try_get("snapshot_json")
                .map_err(|err| McpError::Storage(err.to_string()))?,
            "workflow_run.snapshot_json",
        )?,
        proposal_version: row
            .try_get("proposal_version")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        snapshot_version: row
            .try_get("snapshot_version")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        run_dir: row
            .try_get("run_dir")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        error: row
            .try_get("error")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        created_at: row
            .try_get("created_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
    })
}
