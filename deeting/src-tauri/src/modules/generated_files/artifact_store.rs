use crate::modules::generated_files::artifact_types::{
    AppendGeneratedArtifactRevision, CreateGeneratedArtifactRevision,
    CreatedGeneratedArtifactRevision, GeneratedArtifactRecord, GeneratedArtifactRevisionRecord,
};
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use sqlx::Row;
use time::OffsetDateTime;
use uuid::Uuid;

const GENERATED_ARTIFACT_TABLE: &str = "generated_artifact";
const GENERATED_ARTIFACT_REVISION_TABLE: &str = "generated_artifact_revision";

const GENERATED_ARTIFACT_SELECT_COLUMNS: &str = r#"
    artifact_id, artifact_kind, title, status, origin_session_id, origin_message_id,
    origin_block_id, current_revision_id, created_at, updated_at, last_opened_at
"#;

const GENERATED_ARTIFACT_REVISION_SELECT_COLUMNS: &str = r#"
    revision_id, artifact_id, revision_number, parent_revision_id, file_id, filename,
    content_type, size, source_json, outline_json, preview_text, change_summary,
    creation_mode, created_at, binary_status, binary_pruned_at
"#;

pub(crate) async fn init_generated_artifact_tables(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {GENERATED_ARTIFACT_TABLE} (
          artifact_id TEXT PRIMARY KEY,
          artifact_kind TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          origin_session_id TEXT,
          origin_message_id TEXT,
          origin_block_id TEXT,
          current_revision_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_opened_at TEXT
        );
        "#
    ))
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {GENERATED_ARTIFACT_REVISION_TABLE} (
          revision_id TEXT PRIMARY KEY,
          artifact_id TEXT NOT NULL,
          revision_number INTEGER NOT NULL,
          parent_revision_id TEXT,
          file_id TEXT NOT NULL,
          filename TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          source_json TEXT NOT NULL,
          outline_json TEXT,
          preview_text TEXT,
          change_summary TEXT,
          creation_mode TEXT NOT NULL,
          created_at TEXT NOT NULL,
          binary_status TEXT NOT NULL DEFAULT 'available',
          binary_pruned_at TEXT,
          FOREIGN KEY(artifact_id) REFERENCES {GENERATED_ARTIFACT_TABLE}(artifact_id)
        );
        "#
    ))
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    ensure_generated_artifact_revision_column(
        store,
        "binary_status",
        "TEXT NOT NULL DEFAULT 'available'",
    )
    .await?;
    ensure_generated_artifact_revision_column(store, "binary_pruned_at", "TEXT").await?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{GENERATED_ARTIFACT_TABLE}_updated ON {GENERATED_ARTIFACT_TABLE}(updated_at DESC);"
    ))
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{GENERATED_ARTIFACT_REVISION_TABLE}_artifact ON {GENERATED_ARTIFACT_REVISION_TABLE}(artifact_id, revision_number DESC);"
    ))
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(())
}

async fn ensure_generated_artifact_revision_column(
    store: &McpStore,
    column_name: &str,
    column_definition: &str,
) -> Result<(), McpError> {
    let query = format!(
        "ALTER TABLE {GENERATED_ARTIFACT_REVISION_TABLE} ADD COLUMN {column_name} {column_definition};"
    );
    match sqlx::query(&query).execute(&store.write_pool).await {
        Ok(_) => Ok(()),
        Err(err) => {
            let message = err.to_string();
            if message.contains("duplicate column name") {
                Ok(())
            } else {
                Err(McpError::Storage(message))
            }
        }
    }
}

impl McpStore {
    pub async fn create_generated_artifact_with_revision(
        &self,
        input: CreateGeneratedArtifactRevision,
    ) -> Result<CreatedGeneratedArtifactRevision, McpError> {
        let artifact_kind = normalize_required("artifact_kind", &input.artifact_kind)?;
        let title = normalize_required("title", &input.title)?;
        let file_id = normalize_required("file_id", &input.file_id)?;
        let filename = normalize_required("filename", &input.filename)?;
        let content_type = normalize_required("content_type", &input.content_type)?;
        let source_json = normalize_required("source_json", &input.source_json)?;
        let creation_mode = normalize_required("creation_mode", &input.creation_mode)?;
        let now = now_rfc3339()?;
        let artifact_id = Uuid::new_v4().to_string();
        let revision_id = Uuid::new_v4().to_string();

        let mut tx = self.begin_write().await?;
        sqlx::query(&format!(
            r#"
            INSERT INTO {GENERATED_ARTIFACT_TABLE}
              (artifact_id, artifact_kind, title, status, origin_session_id, origin_message_id,
               origin_block_id, current_revision_id, created_at, updated_at, last_opened_at)
            VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL)
            "#
        ))
        .bind(&artifact_id)
        .bind(&artifact_kind)
        .bind(&title)
        .bind(input.origin_session_id.as_deref().and_then(nonempty_opt))
        .bind(input.origin_message_id.as_deref().and_then(nonempty_opt))
        .bind(input.origin_block_id.as_deref().and_then(nonempty_opt))
        .bind(&revision_id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(&format!(
            r#"
            INSERT INTO {GENERATED_ARTIFACT_REVISION_TABLE}
              (revision_id, artifact_id, revision_number, parent_revision_id, file_id, filename,
               content_type, size, source_json, outline_json, preview_text, change_summary,
               creation_mode, created_at)
            VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        ))
        .bind(&revision_id)
        .bind(&artifact_id)
        .bind(&file_id)
        .bind(&filename)
        .bind(&content_type)
        .bind(input.size)
        .bind(&source_json)
        .bind(input.outline_json.as_deref().and_then(nonempty_opt))
        .bind(input.preview_text.as_deref().and_then(nonempty_opt))
        .bind(input.change_summary.as_deref().and_then(nonempty_opt))
        .bind(&creation_mode)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit()
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(CreatedGeneratedArtifactRevision {
            artifact_id,
            revision_id,
            revision_number: 1,
        })
    }

    pub async fn append_generated_artifact_revision(
        &self,
        input: AppendGeneratedArtifactRevision,
    ) -> Result<CreatedGeneratedArtifactRevision, McpError> {
        let artifact_id = normalize_required("artifact_id", &input.artifact_id)?;
        let file_id = normalize_required("file_id", &input.file_id)?;
        let filename = normalize_required("filename", &input.filename)?;
        let content_type = normalize_required("content_type", &input.content_type)?;
        let source_json = normalize_required("source_json", &input.source_json)?;
        let creation_mode = normalize_required("creation_mode", &input.creation_mode)?;
        let now = now_rfc3339()?;
        let revision_id = Uuid::new_v4().to_string();

        let mut tx = self.begin_write().await?;
        let artifact_row = sqlx::query(&format!(
            r#"
            SELECT current_revision_id
            FROM {GENERATED_ARTIFACT_TABLE}
            WHERE artifact_id = ?
            LIMIT 1
            "#
        ))
        .bind(&artifact_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("generated artifact not found".to_string()))?;

        let current_revision_id: String = artifact_row
            .try_get("current_revision_id")
            .map_err(|err| McpError::Storage(err.to_string()))?;

        if let Some(base_revision_id) = input.base_revision_id.as_deref().and_then(nonempty_opt) {
            if base_revision_id != current_revision_id {
                return Err(McpError::Validation(format!(
                    "stale generated artifact revision: requested {base_revision_id}, current {current_revision_id}"
                )));
            }
        }

        let next_revision_number: i64 = sqlx::query(&format!(
            r#"
            SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision_number
            FROM {GENERATED_ARTIFACT_REVISION_TABLE}
            WHERE artifact_id = ?
            "#
        ))
        .bind(&artifact_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .try_get("next_revision_number")
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(&format!(
            r#"
            INSERT INTO {GENERATED_ARTIFACT_REVISION_TABLE}
              (revision_id, artifact_id, revision_number, parent_revision_id, file_id, filename,
               content_type, size, source_json, outline_json, preview_text, change_summary,
               creation_mode, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        ))
        .bind(&revision_id)
        .bind(&artifact_id)
        .bind(next_revision_number)
        .bind(&current_revision_id)
        .bind(&file_id)
        .bind(&filename)
        .bind(&content_type)
        .bind(input.size)
        .bind(&source_json)
        .bind(input.outline_json.as_deref().and_then(nonempty_opt))
        .bind(input.preview_text.as_deref().and_then(nonempty_opt))
        .bind(input.change_summary.as_deref().and_then(nonempty_opt))
        .bind(&creation_mode)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(&format!(
            r#"
            UPDATE {GENERATED_ARTIFACT_TABLE}
            SET current_revision_id = ?, updated_at = ?
            WHERE artifact_id = ?
            "#
        ))
        .bind(&revision_id)
        .bind(&now)
        .bind(&artifact_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        tx.commit()
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(CreatedGeneratedArtifactRevision {
            artifact_id,
            revision_id,
            revision_number: next_revision_number,
        })
    }

    pub async fn get_generated_artifact(
        &self,
        artifact_id: &str,
    ) -> Result<Option<GeneratedArtifactRecord>, McpError> {
        let artifact_id = match nonempty_opt(artifact_id) {
            Some(value) => value,
            None => return Ok(None),
        };
        let row = sqlx::query(&format!(
            r#"
            SELECT {GENERATED_ARTIFACT_SELECT_COLUMNS}
            FROM {GENERATED_ARTIFACT_TABLE}
            WHERE artifact_id = ?
            LIMIT 1
            "#
        ))
        .bind(artifact_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(row_to_generated_artifact).transpose()
    }

    pub async fn get_generated_artifact_revision(
        &self,
        revision_id: &str,
    ) -> Result<Option<GeneratedArtifactRevisionRecord>, McpError> {
        let revision_id = match nonempty_opt(revision_id) {
            Some(value) => value,
            None => return Ok(None),
        };
        let row = sqlx::query(&format!(
            r#"
            SELECT {GENERATED_ARTIFACT_REVISION_SELECT_COLUMNS}
            FROM {GENERATED_ARTIFACT_REVISION_TABLE}
            WHERE revision_id = ?
            LIMIT 1
            "#
        ))
        .bind(revision_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(row_to_generated_artifact_revision).transpose()
    }

    pub async fn get_generated_artifact_revision_by_file_id(
        &self,
        file_id: &str,
    ) -> Result<Option<GeneratedArtifactRevisionRecord>, McpError> {
        let file_id = match nonempty_opt(file_id) {
            Some(value) => value,
            None => return Ok(None),
        };
        let row = sqlx::query(&format!(
            r#"
            SELECT {GENERATED_ARTIFACT_REVISION_SELECT_COLUMNS}
            FROM {GENERATED_ARTIFACT_REVISION_TABLE}
            WHERE file_id = ?
            ORDER BY revision_number DESC
            LIMIT 1
            "#
        ))
        .bind(file_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(row_to_generated_artifact_revision).transpose()
    }

    pub async fn list_prunable_generated_artifact_revisions(
        &self,
        artifact_id: &str,
        retain_recent_binary_revisions: usize,
    ) -> Result<Vec<GeneratedArtifactRevisionRecord>, McpError> {
        let artifact_id = match nonempty_opt(artifact_id) {
            Some(value) => value,
            None => return Ok(Vec::new()),
        };
        let retained_non_current_count =
            retain_recent_binary_revisions.max(1).saturating_sub(1) as i64;
        let rows = sqlx::query(&format!(
            r#"
            SELECT {GENERATED_ARTIFACT_REVISION_SELECT_COLUMNS}
            FROM {GENERATED_ARTIFACT_REVISION_TABLE}
            WHERE artifact_id = ?
              AND binary_status = 'available'
              AND revision_id != (
                SELECT current_revision_id
                FROM {GENERATED_ARTIFACT_TABLE}
                WHERE artifact_id = ?
                LIMIT 1
              )
            ORDER BY revision_number DESC
            LIMIT -1 OFFSET ?
            "#
        ))
        .bind(artifact_id)
        .bind(artifact_id)
        .bind(retained_non_current_count)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(row_to_generated_artifact_revision)
            .collect()
    }

    pub async fn mark_generated_artifact_revision_binary_pruned(
        &self,
        revision_id: &str,
    ) -> Result<(), McpError> {
        let revision_id = match nonempty_opt(revision_id) {
            Some(value) => value,
            None => return Ok(()),
        };
        let now = now_rfc3339()?;
        sqlx::query(&format!(
            r#"
            UPDATE {GENERATED_ARTIFACT_REVISION_TABLE}
            SET binary_status = 'pruned', binary_pruned_at = ?
            WHERE revision_id = ?
            "#
        ))
        .bind(&now)
        .bind(revision_id)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn list_recent_generated_artifacts(
        &self,
        limit: usize,
    ) -> Result<Vec<GeneratedArtifactRecord>, McpError> {
        let rows = sqlx::query(&format!(
            r#"
            SELECT {GENERATED_ARTIFACT_SELECT_COLUMNS}
            FROM {GENERATED_ARTIFACT_TABLE}
            WHERE status != 'archived'
            ORDER BY updated_at DESC, created_at DESC
            LIMIT ?
            "#
        ))
        .bind(limit.max(1) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter().map(row_to_generated_artifact).collect()
    }
}

fn normalize_required(field: &str, value: &str) -> Result<String, McpError> {
    nonempty_opt(value)
        .map(str::to_string)
        .ok_or_else(|| McpError::validation(format!("{field} is required")))
}

fn nonempty_opt(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn now_rfc3339() -> Result<String, McpError> {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| McpError::Storage(err.to_string()))
}

fn row_to_generated_artifact(
    row: sqlx::sqlite::SqliteRow,
) -> Result<GeneratedArtifactRecord, McpError> {
    Ok(GeneratedArtifactRecord {
        artifact_id: row.try_get("artifact_id").map_err(storage_err)?,
        artifact_kind: row.try_get("artifact_kind").map_err(storage_err)?,
        title: row.try_get("title").map_err(storage_err)?,
        status: row.try_get("status").map_err(storage_err)?,
        origin_session_id: row.try_get("origin_session_id").map_err(storage_err)?,
        origin_message_id: row.try_get("origin_message_id").map_err(storage_err)?,
        origin_block_id: row.try_get("origin_block_id").map_err(storage_err)?,
        current_revision_id: row.try_get("current_revision_id").map_err(storage_err)?,
        created_at: row.try_get("created_at").map_err(storage_err)?,
        updated_at: row.try_get("updated_at").map_err(storage_err)?,
        last_opened_at: row.try_get("last_opened_at").map_err(storage_err)?,
    })
}

fn row_to_generated_artifact_revision(
    row: sqlx::sqlite::SqliteRow,
) -> Result<GeneratedArtifactRevisionRecord, McpError> {
    Ok(GeneratedArtifactRevisionRecord {
        revision_id: row.try_get("revision_id").map_err(storage_err)?,
        artifact_id: row.try_get("artifact_id").map_err(storage_err)?,
        revision_number: row.try_get("revision_number").map_err(storage_err)?,
        parent_revision_id: row.try_get("parent_revision_id").map_err(storage_err)?,
        file_id: row.try_get("file_id").map_err(storage_err)?,
        filename: row.try_get("filename").map_err(storage_err)?,
        content_type: row.try_get("content_type").map_err(storage_err)?,
        size: row.try_get("size").map_err(storage_err)?,
        source_json: row.try_get("source_json").map_err(storage_err)?,
        outline_json: row.try_get("outline_json").map_err(storage_err)?,
        preview_text: row.try_get("preview_text").map_err(storage_err)?,
        change_summary: row.try_get("change_summary").map_err(storage_err)?,
        creation_mode: row.try_get("creation_mode").map_err(storage_err)?,
        created_at: row.try_get("created_at").map_err(storage_err)?,
        binary_status: row.try_get("binary_status").map_err(storage_err)?,
        binary_pruned_at: row.try_get("binary_pruned_at").map_err(storage_err)?,
    })
}

fn storage_err(err: sqlx::Error) -> McpError {
    McpError::Storage(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_store() -> McpStore {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create in-memory sqlite pool");
        let store = McpStore::with_pool(pool);
        init_generated_artifact_tables(&store)
            .await
            .expect("init generated artifact tables");
        store
    }

    fn create_input(title: &str) -> CreateGeneratedArtifactRevision {
        CreateGeneratedArtifactRevision {
            artifact_kind: "pptx".to_string(),
            title: title.to_string(),
            file_id: "file-1".to_string(),
            filename: format!("{title}.pptx"),
            content_type:
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    .to_string(),
            size: 42,
            source_json: "{\"filename\":\"deck.pptx\",\"slides\":[]}".to_string(),
            outline_json: Some("[]".to_string()),
            preview_text: Some("preview".to_string()),
            change_summary: None,
            creation_mode: "generated".to_string(),
            origin_session_id: Some("session-1".to_string()),
            origin_message_id: None,
            origin_block_id: None,
        }
    }

    #[tokio::test]
    async fn create_artifact_with_revision_sets_current_revision() {
        let store = test_store().await;
        let created = store
            .create_generated_artifact_with_revision(create_input("deck"))
            .await
            .expect("create generated artifact");

        assert_eq!(created.revision_number, 1);
        let artifact = store
            .get_generated_artifact(&created.artifact_id)
            .await
            .expect("get artifact")
            .expect("artifact exists");
        assert_eq!(artifact.current_revision_id, created.revision_id);
        assert_eq!(artifact.artifact_kind, "pptx");

        let revision = store
            .get_generated_artifact_revision(&created.revision_id)
            .await
            .expect("get revision")
            .expect("revision exists");
        assert_eq!(revision.artifact_id, created.artifact_id);
        assert_eq!(revision.revision_number, 1);
        assert_eq!(revision.creation_mode, "generated");
    }

    #[tokio::test]
    async fn append_artifact_revision_increments_revision_number() {
        let store = test_store().await;
        let first = store
            .create_generated_artifact_with_revision(create_input("deck"))
            .await
            .expect("create generated artifact");

        let second = store
            .append_generated_artifact_revision(AppendGeneratedArtifactRevision {
                artifact_id: first.artifact_id.clone(),
                base_revision_id: Some(first.revision_id.clone()),
                file_id: "file-2".to_string(),
                filename: "deck-v2.pptx".to_string(),
                content_type:
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                        .to_string(),
                size: 84,
                source_json: "{\"filename\":\"deck-v2.pptx\",\"slides\":[]}".to_string(),
                outline_json: Some("[]".to_string()),
                preview_text: Some("preview v2".to_string()),
                change_summary: Some("Updated slide 2".to_string()),
                creation_mode: "patched".to_string(),
            })
            .await
            .expect("append revision");

        assert_eq!(second.revision_number, 2);
        let artifact = store
            .get_generated_artifact(&first.artifact_id)
            .await
            .expect("get artifact")
            .expect("artifact exists");
        assert_eq!(artifact.current_revision_id, second.revision_id);

        let revision = store
            .get_generated_artifact_revision(&second.revision_id)
            .await
            .expect("get revision")
            .expect("revision exists");
        assert_eq!(revision.parent_revision_id, Some(first.revision_id));
        assert_eq!(revision.creation_mode, "patched");
    }

    #[tokio::test]
    async fn append_revision_rejects_stale_base_revision() {
        let store = test_store().await;
        let first = store
            .create_generated_artifact_with_revision(create_input("deck"))
            .await
            .expect("create generated artifact");
        let second = store
            .append_generated_artifact_revision(AppendGeneratedArtifactRevision {
                artifact_id: first.artifact_id.clone(),
                base_revision_id: Some(first.revision_id.clone()),
                file_id: "file-2".to_string(),
                filename: "deck-v2.pptx".to_string(),
                content_type:
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                        .to_string(),
                size: 84,
                source_json: "{}".to_string(),
                outline_json: None,
                preview_text: None,
                change_summary: None,
                creation_mode: "patched".to_string(),
            })
            .await
            .expect("append revision");

        let err = store
            .append_generated_artifact_revision(AppendGeneratedArtifactRevision {
                artifact_id: first.artifact_id,
                base_revision_id: Some(first.revision_id),
                file_id: "file-3".to_string(),
                filename: "deck-v3.pptx".to_string(),
                content_type:
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                        .to_string(),
                size: 126,
                source_json: "{}".to_string(),
                outline_json: None,
                preview_text: None,
                change_summary: None,
                creation_mode: "patched".to_string(),
            })
            .await
            .expect_err("stale revision should be rejected");

        assert!(err.to_string().contains(&second.revision_id));
    }
}
