use sqlx::{sqlite::SqliteRow, Row};
use uuid::Uuid;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use crate::modules::workflow::types::{CreateWorkflowArtifactRequest, WorkflowArtifact};

use super::helpers::{
    ensure_run_exists, ensure_step_belongs_to_run, now_rfc3339, parse_artifact_kind,
    parse_optional_json, serialize_json_opt,
};
use super::schema::{ensure_schema, WORKFLOW_ARTIFACT_TABLE};

pub(crate) async fn create_workflow_artifact(
    store: &McpStore,
    req: CreateWorkflowArtifactRequest,
) -> Result<WorkflowArtifact, McpError> {
    ensure_schema(store).await?;

    let run_id = req.run_id.trim().to_string();
    if run_id.is_empty() {
        return Err(McpError::validation("workflow artifact run_id is required"));
    }
    ensure_run_exists(store, &run_id).await?;
    let artifact_ref = req
        .artifact_ref
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let content = req
        .content
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if artifact_ref.is_none() && content.is_none() {
        return Err(McpError::validation(
            "workflow artifact requires artifact_ref or content",
        ));
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
    let metadata_json = serialize_json_opt(req.metadata.as_ref())?;

    sqlx::query(&format!(
        r#"
        INSERT INTO {WORKFLOW_ARTIFACT_TABLE}
          (id, run_id, step_id, phase_id, artifact_kind, artifact_ref, content, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#
    ))
    .bind(&id)
    .bind(&run_id)
    .bind(req.step_id.as_deref())
    .bind(req.phase_id.as_deref())
    .bind(req.artifact_kind.as_str())
    .bind(artifact_ref.as_deref())
    .bind(content.as_deref())
    .bind(metadata_json)
    .bind(&now)
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(WorkflowArtifact {
        id,
        run_id,
        step_id: req.step_id,
        phase_id: req.phase_id,
        artifact_kind: req.artifact_kind,
        artifact_ref,
        content,
        metadata: req.metadata,
        created_at: now,
    })
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn list_workflow_artifacts_by_run(
    store: &McpStore,
    run_id: &str,
) -> Result<Vec<WorkflowArtifact>, McpError> {
    ensure_schema(store).await?;
    let rows = sqlx::query(&format!(
        "SELECT * FROM {WORKFLOW_ARTIFACT_TABLE} WHERE run_id = ? ORDER BY created_at ASC, id ASC"
    ))
    .bind(run_id.trim())
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    rows.iter().map(row_to_workflow_artifact).collect()
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn list_workflow_artifacts_by_step(
    store: &McpStore,
    step_id: &str,
) -> Result<Vec<WorkflowArtifact>, McpError> {
    ensure_schema(store).await?;
    let rows = sqlx::query(&format!(
        "SELECT * FROM {WORKFLOW_ARTIFACT_TABLE} WHERE step_id = ? ORDER BY created_at ASC, id ASC"
    ))
    .bind(step_id.trim())
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    rows.iter().map(row_to_workflow_artifact).collect()
}

#[cfg_attr(not(test), allow(dead_code))]
fn row_to_workflow_artifact(row: &SqliteRow) -> Result<WorkflowArtifact, McpError> {
    Ok(WorkflowArtifact {
        id: row
            .try_get("id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        run_id: row
            .try_get("run_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        step_id: row
            .try_get("step_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        phase_id: row
            .try_get("phase_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        artifact_kind: parse_artifact_kind(row, "artifact_kind")?,
        artifact_ref: row
            .try_get("artifact_ref")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        content: row
            .try_get("content")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        metadata: parse_optional_json(
            row.try_get("metadata")
                .map_err(|err| McpError::Storage(err.to_string()))?,
            "workflow_artifact.metadata",
        )?,
        created_at: row
            .try_get("created_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
    })
}
