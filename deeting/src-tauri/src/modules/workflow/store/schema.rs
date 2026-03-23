use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

pub(super) const WORKFLOW_RUN_TABLE: &str = "workflow_run";
pub(super) const WORKFLOW_STEP_RUN_TABLE: &str = "workflow_step_run";
pub(super) const WORKFLOW_EVENT_TABLE: &str = "workflow_event";
pub(super) const WORKFLOW_CHECKPOINT_TABLE: &str = "workflow_checkpoint";
pub(super) const WORKFLOW_ARTIFACT_TABLE: &str = "workflow_artifact";

pub(crate) async fn ensure_schema(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {WORKFLOW_RUN_TABLE} (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            goal TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            proposal_text TEXT,
            snapshot_json TEXT,
            proposal_version INTEGER NOT NULL DEFAULT 0,
            snapshot_version INTEGER NOT NULL DEFAULT 0,
            run_dir TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {WORKFLOW_STEP_RUN_TABLE} (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES {WORKFLOW_RUN_TABLE}(id) ON DELETE CASCADE,
            phase_id TEXT NOT NULL,
            phase_index INTEGER NOT NULL,
            step_type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            worker_ref TEXT,
            goal TEXT,
            input_snapshot TEXT,
            output_artifact_refs TEXT,
            worker_trace_summary TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            started_at TEXT,
            completed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {WORKFLOW_EVENT_TABLE} (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES {WORKFLOW_RUN_TABLE}(id) ON DELETE CASCADE,
            step_id TEXT REFERENCES {WORKFLOW_STEP_RUN_TABLE}(id) ON DELETE SET NULL,
            event_type TEXT NOT NULL,
            payload TEXT,
            created_at TEXT NOT NULL
        );
        "#
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {WORKFLOW_CHECKPOINT_TABLE} (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES {WORKFLOW_RUN_TABLE}(id) ON DELETE CASCADE,
            blocked_step_id TEXT REFERENCES {WORKFLOW_STEP_RUN_TABLE}(id) ON DELETE SET NULL,
            reason TEXT NOT NULL,
            approval_payload TEXT,
            resume_payload TEXT,
            resolved INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            resolved_at TEXT
        );
        "#
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {WORKFLOW_ARTIFACT_TABLE} (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES {WORKFLOW_RUN_TABLE}(id) ON DELETE CASCADE,
            step_id TEXT REFERENCES {WORKFLOW_STEP_RUN_TABLE}(id) ON DELETE SET NULL,
            phase_id TEXT,
            artifact_kind TEXT NOT NULL,
            artifact_ref TEXT,
            content TEXT,
            metadata TEXT,
            created_at TEXT NOT NULL
        );
        "#
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{WORKFLOW_STEP_RUN_TABLE}_run_id ON {WORKFLOW_STEP_RUN_TABLE}(run_id);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{WORKFLOW_STEP_RUN_TABLE}_run_phase ON {WORKFLOW_STEP_RUN_TABLE}(run_id, phase_index);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{WORKFLOW_EVENT_TABLE}_run_id ON {WORKFLOW_EVENT_TABLE}(run_id);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{WORKFLOW_EVENT_TABLE}_step_id ON {WORKFLOW_EVENT_TABLE}(step_id);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{WORKFLOW_CHECKPOINT_TABLE}_run_id ON {WORKFLOW_CHECKPOINT_TABLE}(run_id);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{WORKFLOW_ARTIFACT_TABLE}_run_id ON {WORKFLOW_ARTIFACT_TABLE}(run_id);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{WORKFLOW_ARTIFACT_TABLE}_step_id ON {WORKFLOW_ARTIFACT_TABLE}(step_id);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(())
}
