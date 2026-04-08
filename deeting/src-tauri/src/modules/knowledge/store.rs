use std::cmp::Ordering;
use std::collections::HashSet;

use sqlx::sqlite::{SqlitePool, SqliteRow};
use sqlx::Row;
use uuid::Uuid;

use crate::modules::knowledge::error::KnowledgeError;
use crate::modules::knowledge::types::{
    CreateLocalKnowledgeFolderRequest, CreateLocalUserDocumentRequest,
    LocalKnowledgeBreadcrumbItem, LocalKnowledgeChunk, LocalKnowledgeChunkListResponse,
    LocalKnowledgeFile, LocalKnowledgeFolder, LocalKnowledgeSearchHit, LocalKnowledgeStatsResponse,
    LocalKnowledgeTreeQuery, LocalKnowledgeTreeResponse, LocalUserDocumentChunkListQuery,
    LocalUserDocumentListQuery, UpdateLocalKnowledgeFolderRequest, UpdateLocalUserDocumentRequest,
};
use crate::utils::now_rfc3339;

const LOCAL_DESKTOP_USER_ID: &str = "00000000-0000-0000-0000-000000000000";
const LOCAL_KNOWLEDGE_CHUNK_MAX_CHARS: usize = 1200;
const LOCAL_KNOWLEDGE_CHUNK_OVERLAP_CHARS: usize = 120;

pub struct KnowledgeStore {
    pool: SqlitePool,
}

impl KnowledgeStore {
    pub fn with_pool(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn init(&self) -> Result<(), KnowledgeError> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS knowledge_folder (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              parent_id TEXT,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (parent_id) REFERENCES knowledge_folder(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_folder_user_parent_name
            ON knowledge_folder(user_id, parent_id, name);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_folder_user_root_name
            ON knowledge_folder(user_id, name)
            WHERE parent_id IS NULL;
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_folder_user_id
            ON knowledge_folder(user_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_folder_parent_id
            ON knowledge_folder(parent_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS user_document (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              media_asset_id TEXT NOT NULL,
              filename TEXT NOT NULL,
              folder_id TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              error_message TEXT,
              chunk_count INTEGER NOT NULL DEFAULT 0,
              embedding_model TEXT,
              meta_info TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (folder_id) REFERENCES knowledge_folder(id) ON DELETE SET NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_user_id
            ON user_document(user_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_status
            ON user_document(status);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_media_asset_id
            ON user_document(media_asset_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_folder_id
            ON user_document(folder_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS knowledge_chunk (
              id TEXT PRIMARY KEY,
              document_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              chunk_index INTEGER NOT NULL,
              text_content TEXT NOT NULL,
              token_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (document_id) REFERENCES user_document(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_chunk_document_index
            ON knowledge_chunk(document_id, chunk_index);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_document_id
            ON knowledge_chunk(document_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_user_id
            ON knowledge_chunk(user_id);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn get_local_knowledge_tree(
        &self,
        query: LocalKnowledgeTreeQuery,
    ) -> Result<LocalKnowledgeTreeResponse, KnowledgeError> {
        let parent_id = query.parent_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let keyword = query.q.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let sort_field = query
            .sort_field
            .unwrap_or_else(|| "created_at".to_string())
            .trim()
            .to_string();
        let sort_direction = query
            .sort_direction
            .unwrap_or_else(|| "desc".to_string())
            .trim()
            .to_ascii_lowercase();
        let keyword_like = keyword
            .as_ref()
            .map(|value| format!("%{}%", value.replace('%', "\\%").replace('_', "\\_")));

        if let Some(parent) = parent_id.as_deref() {
            let parent_row = sqlx::query(
                r#"
                SELECT id
                FROM knowledge_folder
                WHERE id = ? AND user_id = ?
                LIMIT 1;
                "#,
            )
            .bind(parent)
            .bind(LOCAL_DESKTOP_USER_ID)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
            if parent_row.is_none() {
                return Err(KnowledgeError::NotFound(
                    "knowledge folder not found".to_string(),
                ));
            }
        }

        let folder_rows = sqlx::query(
            r#"
            SELECT
              f.id, f.name, f.parent_id, f.created_at, f.updated_at,
              COALESCE(fc.file_count, 0) AS file_count
            FROM knowledge_folder f
            LEFT JOIN (
              SELECT folder_id, COUNT(*) AS file_count
              FROM user_document
              WHERE user_id = ?
              GROUP BY folder_id
            ) fc ON fc.folder_id = f.id
            WHERE f.user_id = ?
              AND ((? IS NULL AND f.parent_id IS NULL) OR f.parent_id = ?)
              AND (? IS NULL OR f.name LIKE ? ESCAPE '\')
            ORDER BY f.created_at DESC, f.id DESC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(parent_id.as_deref())
        .bind(parent_id.as_deref())
        .bind(keyword_like.as_deref())
        .bind(keyword_like.as_deref())
        .fetch_all(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        let file_rows = sqlx::query(
            r#"
            SELECT
              id, filename, folder_id, status, error_message, chunk_count,
              meta_info, created_at, updated_at
            FROM user_document
            WHERE user_id = ?
              AND ((? IS NULL AND folder_id IS NULL) OR folder_id = ?)
              AND (? IS NULL OR filename LIKE ? ESCAPE '\')
            ORDER BY created_at DESC, id DESC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(parent_id.as_deref())
        .bind(parent_id.as_deref())
        .bind(keyword_like.as_deref())
        .bind(keyword_like.as_deref())
        .fetch_all(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        let mut folders = Vec::with_capacity(folder_rows.len());
        for row in folder_rows {
            folders.push(LocalKnowledgeFolder {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                parent_id: row.try_get("parent_id")?,
                file_count: row.try_get::<i64, _>("file_count").unwrap_or(0),
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        let mut files = Vec::with_capacity(file_rows.len());
        for row in file_rows {
            files.push(row_to_local_knowledge_file(&row)?);
        }

        sort_local_knowledge_folders(&mut folders, &sort_field, &sort_direction);
        sort_local_knowledge_files(&mut files, &sort_field, &sort_direction);

        let mut breadcrumb = vec![LocalKnowledgeBreadcrumbItem {
            id: None,
            name: "All Files".to_string(),
        }];
        if let Some(current_parent_id) = parent_id {
            let mut chain = Vec::new();
            let mut cursor = Some(current_parent_id);
            while let Some(folder_id) = cursor {
                let row = sqlx::query(
                    r#"
                    SELECT id, name, parent_id
                    FROM knowledge_folder
                    WHERE id = ? AND user_id = ?
                    LIMIT 1;
                    "#,
                )
                .bind(&folder_id)
                .bind(LOCAL_DESKTOP_USER_ID)
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
                let Some(row) = row else {
                    break;
                };
                let id: String = row.try_get("id")?;
                chain.push(LocalKnowledgeBreadcrumbItem {
                    id: Some(id),
                    name: row.try_get("name")?,
                });
                cursor = row.try_get("parent_id")?;
            }
            chain.reverse();
            breadcrumb.extend(chain);
        }

        Ok(LocalKnowledgeTreeResponse {
            folders,
            files,
            breadcrumb,
        })
    }

    pub async fn get_local_knowledge_stats(
        &self,
    ) -> Result<LocalKnowledgeStatsResponse, KnowledgeError> {
        let file_row = sqlx::query(
            r#"
            SELECT
              COUNT(*) AS total_files,
              COALESCE(SUM(chunk_count), 0) AS total_vectors,
              COALESCE(SUM(CAST(json_extract(meta_info, '$.size') AS INTEGER)), 0) AS used_bytes
            FROM user_document
            WHERE user_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        let folder_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total_folders
            FROM knowledge_folder
            WHERE user_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        let used_bytes = file_row.try_get::<i64, _>("used_bytes").unwrap_or(0).max(0);
        let total_vectors = file_row
            .try_get::<i64, _>("total_vectors")
            .unwrap_or(0)
            .max(0);
        let total_files = file_row
            .try_get::<i64, _>("total_files")
            .unwrap_or(0)
            .max(0);
        let total_folders = folder_row
            .try_get::<i64, _>("total_folders")
            .unwrap_or(0)
            .max(0);
        Ok(LocalKnowledgeStatsResponse {
            used_bytes,
            total_bytes: None,
            total_vectors,
            total_files,
            total_folders,
        })
    }

    pub async fn create_local_knowledge_folder(
        &self,
        payload: CreateLocalKnowledgeFolderRequest,
    ) -> Result<LocalKnowledgeFolder, KnowledgeError> {
        let name = payload.name.trim().to_string();
        if name.is_empty() {
            return Err(KnowledgeError::validation("folder name is required"));
        }
        let parent_id = payload.parent_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        if let Some(parent) = parent_id.as_deref() {
            let parent_row = sqlx::query(
                r#"
                SELECT id
                FROM knowledge_folder
                WHERE id = ? AND user_id = ?
                LIMIT 1;
                "#,
            )
            .bind(parent)
            .bind(LOCAL_DESKTOP_USER_ID)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
            if parent_row.is_none() {
                return Err(KnowledgeError::NotFound(
                    "parent folder not found".to_string(),
                ));
            }
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO knowledge_folder (id, user_id, parent_id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(parent_id.as_deref())
        .bind(name)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        self.get_local_knowledge_folder_by_id(&id).await
    }

    pub async fn update_local_knowledge_folder(
        &self,
        folder_id: &str,
        payload: UpdateLocalKnowledgeFolderRequest,
    ) -> Result<LocalKnowledgeFolder, KnowledgeError> {
        let normalized_id = folder_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(KnowledgeError::validation("folder_id is required"));
        }
        let name = payload.name.trim().to_string();
        if name.is_empty() {
            return Err(KnowledgeError::validation("folder name is required"));
        }

        let now = now_rfc3339();
        let result = sqlx::query(
            r#"
            UPDATE knowledge_folder
            SET name = ?, updated_at = ?
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(name)
        .bind(&now)
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        if result.rows_affected() == 0 {
            return Err(KnowledgeError::NotFound(
                "knowledge folder not found".to_string(),
            ));
        }
        self.get_local_knowledge_folder_by_id(&normalized_id).await
    }

    pub async fn delete_local_knowledge_folder(
        &self,
        folder_id: &str,
        recursive: bool,
    ) -> Result<(), KnowledgeError> {
        let normalized_id = folder_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(KnowledgeError::validation("folder_id is required"));
        }

        let exists = sqlx::query(
            r#"
            SELECT id
            FROM knowledge_folder
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        if exists.is_none() {
            return Err(KnowledgeError::NotFound(
                "knowledge folder not found".to_string(),
            ));
        }

        if !recursive {
            let child_row = sqlx::query(
                r#"
                SELECT COUNT(*) AS total
                FROM knowledge_folder
                WHERE user_id = ? AND parent_id = ?;
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
            let child_count = child_row.try_get::<i64, _>("total").unwrap_or(0);
            if child_count > 0 {
                return Err(KnowledgeError::validation(
                    "folder has children; use recursive delete".to_string(),
                ));
            }

            let file_row = sqlx::query(
                r#"
                SELECT COUNT(*) AS total
                FROM user_document
                WHERE user_id = ? AND folder_id = ?;
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
            let file_count = file_row.try_get::<i64, _>("total").unwrap_or(0);
            if file_count > 0 {
                return Err(KnowledgeError::validation(
                    "folder contains files; use recursive delete".to_string(),
                ));
            }

            sqlx::query(
                r#"
                DELETE FROM knowledge_folder
                WHERE id = ? AND user_id = ?;
                "#,
            )
            .bind(&normalized_id)
            .bind(LOCAL_DESKTOP_USER_ID)
            .execute(&self.pool)
            .await
            .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
            return Ok(());
        }

        sqlx::query(
            r#"
            DELETE FROM user_document
            WHERE user_id = ?
              AND folder_id IN (
                WITH RECURSIVE subtree(id) AS (
                  SELECT id FROM knowledge_folder WHERE id = ? AND user_id = ?
                  UNION ALL
                  SELECT f.id
                  FROM knowledge_folder f
                  INNER JOIN subtree s ON f.parent_id = s.id
                  WHERE f.user_id = ?
                )
                SELECT id FROM subtree
              );
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            DELETE FROM knowledge_folder
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn list_local_user_documents(
        &self,
        query: LocalUserDocumentListQuery,
    ) -> Result<Vec<LocalKnowledgeFile>, KnowledgeError> {
        let folder_id = query.folder_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let status = query.status.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let keyword = query.q.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let keyword_like = keyword
            .as_ref()
            .map(|value| format!("%{}%", value.replace('%', "\\%").replace('_', "\\_")));

        let rows = sqlx::query(
            r#"
            SELECT
              id, filename, folder_id, status, error_message, chunk_count,
              meta_info, created_at, updated_at
            FROM user_document
            WHERE user_id = ?
              AND ((? IS NULL AND folder_id IS NULL) OR folder_id = ?)
              AND (? IS NULL OR status = ?)
              AND (? IS NULL OR filename LIKE ? ESCAPE '\')
            ORDER BY created_at DESC, id DESC;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(folder_id.as_deref())
        .bind(folder_id.as_deref())
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(keyword_like.as_deref())
        .bind(keyword_like.as_deref())
        .fetch_all(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        let mut files = Vec::with_capacity(rows.len());
        for row in rows {
            files.push(row_to_local_knowledge_file(&row)?);
        }
        Ok(files)
    }

    pub async fn create_local_user_document(
        &self,
        payload: CreateLocalUserDocumentRequest,
    ) -> Result<LocalKnowledgeFile, KnowledgeError> {
        let filename = payload.filename.trim().to_string();
        if filename.is_empty() {
            return Err(KnowledgeError::validation("filename is required"));
        }
        let folder_id = payload.folder_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        if let Some(folder) = folder_id.as_deref() {
            let parent_row = sqlx::query(
                r#"
                SELECT id
                FROM knowledge_folder
                WHERE id = ? AND user_id = ?
                LIMIT 1;
                "#,
            )
            .bind(folder)
            .bind(LOCAL_DESKTOP_USER_ID)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
            if parent_row.is_none() {
                return Err(KnowledgeError::NotFound("folder not found".to_string()));
            }
        }

        let status = normalize_storage_document_status(payload.status.as_deref());
        let media_asset_id = payload
            .media_asset_id
            .and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let chunk_count = payload.chunk_count.unwrap_or(0).max(0);
        let meta_info = payload.meta_info.unwrap_or_else(|| serde_json::json!({}));
        let meta_info_text = serde_json::to_string(&meta_info)?;
        let now = now_rfc3339();
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO user_document (
              id, user_id, media_asset_id, filename, folder_id, status, error_message,
              chunk_count, embedding_model, meta_info, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(media_asset_id)
        .bind(filename)
        .bind(folder_id.as_deref())
        .bind(status)
        .bind(payload.error_message)
        .bind(chunk_count)
        .bind(payload.embedding_model)
        .bind(meta_info_text)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        if let Err(err) = self
            .process_local_user_document_chunks_if_available(&id, &meta_info)
            .await
        {
            let _ = self
                .mark_local_user_document_failed(
                    &id,
                    &format!("local document processing failed: {}", err),
                )
                .await;
        }

        self.get_local_user_document(&id).await
    }

    pub async fn get_local_user_document(
        &self,
        file_id: &str,
    ) -> Result<LocalKnowledgeFile, KnowledgeError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(KnowledgeError::validation("file_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT
              id, filename, folder_id, status, error_message, chunk_count,
              meta_info, created_at, updated_at
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        let Some(row) = row else {
            return Err(KnowledgeError::NotFound(
                "local user document not found".to_string(),
            ));
        };
        row_to_local_knowledge_file(&row)
    }

    pub async fn get_local_user_document_download_url(
        &self,
        file_id: &str,
    ) -> Result<String, KnowledgeError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(KnowledgeError::validation("file_id is required"));
        }
        let row = sqlx::query(
            r#"
            SELECT meta_info
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?
        .ok_or_else(|| KnowledgeError::NotFound("user document not found".to_string()))?;

        let meta_info_text: String = row.try_get("meta_info")?;
        let meta_info = if meta_info_text.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str::<serde_json::Value>(&meta_info_text)
                .unwrap_or_else(|_| serde_json::json!({}))
        };

        extract_local_document_download_url(&meta_info)
            .ok_or_else(|| KnowledgeError::NotFound("download url not available".to_string()))
    }

    pub async fn get_local_user_document_object_key(
        &self,
        file_id: &str,
    ) -> Result<Option<String>, KnowledgeError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(KnowledgeError::validation("file_id is required"));
        }
        let row = sqlx::query(
            r#"
            SELECT meta_info
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?
        .ok_or_else(|| KnowledgeError::NotFound("user document not found".to_string()))?;

        let meta_info_text: String = row.try_get("meta_info")?;
        let meta_info = if meta_info_text.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str::<serde_json::Value>(&meta_info_text)
                .unwrap_or_else(|_| serde_json::json!({}))
        };
        Ok(extract_local_document_object_key(&meta_info))
    }

    pub async fn update_local_user_document(
        &self,
        file_id: &str,
        payload: UpdateLocalUserDocumentRequest,
    ) -> Result<LocalKnowledgeFile, KnowledgeError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(KnowledgeError::validation("file_id is required"));
        }

        let current_row = sqlx::query(
            r#"
            SELECT filename, folder_id
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        let Some(current_row) = current_row else {
            return Err(KnowledgeError::NotFound(
                "local user document not found".to_string(),
            ));
        };

        let mut target_filename: String = current_row.try_get("filename")?;
        if let Some(name) = payload.name {
            let normalized_name = name.trim().to_string();
            if normalized_name.is_empty() {
                return Err(KnowledgeError::validation("file name is required"));
            }
            target_filename = normalized_name;
        }

        let mut target_folder_id: Option<String> = current_row.try_get("folder_id")?;
        let folder_id_provided = payload.folder_id_provided.unwrap_or(false);
        if folder_id_provided {
            let normalized_folder_id = payload.folder_id.and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            });
            if let Some(folder_id) = normalized_folder_id.as_deref() {
                let folder_row = sqlx::query(
                    r#"
                    SELECT id
                    FROM knowledge_folder
                    WHERE id = ? AND user_id = ?
                    LIMIT 1;
                    "#,
                )
                .bind(folder_id)
                .bind(LOCAL_DESKTOP_USER_ID)
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
                if folder_row.is_none() {
                    return Err(KnowledgeError::NotFound("folder not found".to_string()));
                }
            }
            target_folder_id = normalized_folder_id;
        }

        let now = now_rfc3339();
        sqlx::query(
            r#"
            UPDATE user_document
            SET filename = ?, folder_id = ?, updated_at = ?
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(target_filename)
        .bind(target_folder_id.as_deref())
        .bind(&now)
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        self.get_local_user_document(&normalized_id).await
    }

    pub async fn delete_local_user_document(&self, file_id: &str) -> Result<(), KnowledgeError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(KnowledgeError::validation("file_id is required"));
        }

        sqlx::query(
            r#"
            DELETE FROM knowledge_chunk
            WHERE document_id = ? AND user_id = ?;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        let result = sqlx::query(
            r#"
            DELETE FROM user_document
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        if result.rows_affected() == 0 {
            return Err(KnowledgeError::NotFound(
                "local user document not found".to_string(),
            ));
        }
        Ok(())
    }

    pub async fn retry_local_user_document(
        &self,
        file_id: &str,
    ) -> Result<LocalKnowledgeFile, KnowledgeError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(KnowledgeError::validation("file_id is required"));
        }

        let now = now_rfc3339();
        let result = sqlx::query(
            r#"
            UPDATE user_document
            SET status = 'processing',
                error_message = NULL,
                chunk_count = 0,
                embedding_model = NULL,
                updated_at = ?
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(&now)
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        if result.rows_affected() == 0 {
            return Err(KnowledgeError::NotFound(
                "local user document not found".to_string(),
            ));
        }

        sqlx::query(
            r#"
            DELETE FROM knowledge_chunk
            WHERE document_id = ? AND user_id = ?;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        let meta_info_row = sqlx::query(
            r#"
            SELECT meta_info
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        let meta_info = meta_info_row
            .and_then(|row| row.try_get::<String, _>("meta_info").ok())
            .filter(|raw| !raw.trim().is_empty())
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .unwrap_or_else(|| serde_json::json!({}));

        if let Err(err) = self
            .process_local_user_document_chunks_if_available(&normalized_id, &meta_info)
            .await
        {
            let _ = self
                .mark_local_user_document_failed(
                    &normalized_id,
                    &format!("local document retry failed: {}", err),
                )
                .await;
        }

        self.get_local_user_document(&normalized_id).await
    }

    pub async fn list_local_user_document_chunks(
        &self,
        file_id: &str,
        query: LocalUserDocumentChunkListQuery,
    ) -> Result<LocalKnowledgeChunkListResponse, KnowledgeError> {
        let normalized_id = file_id.trim().to_string();
        if normalized_id.is_empty() {
            return Err(KnowledgeError::validation("file_id is required"));
        }
        let offset = query.offset.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(20).clamp(1, 100);

        let file_row = sqlx::query(
            r#"
            SELECT id, chunk_count
            FROM user_document
            WHERE id = ? AND user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        let Some(file_row) = file_row else {
            return Err(KnowledgeError::NotFound(
                "local user document not found".to_string(),
            ));
        };
        let expected_count = file_row
            .try_get::<i64, _>("chunk_count")
            .unwrap_or(0)
            .max(0);

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM knowledge_chunk
            WHERE user_id = ? AND document_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        let stored_total = total_row.try_get::<i64, _>("total").unwrap_or(0).max(0);
        let total = stored_total.max(expected_count);

        let rows = sqlx::query(
            r#"
            SELECT id, document_id, chunk_index, text_content, token_count
            FROM knowledge_chunk
            WHERE user_id = ? AND document_id = ?
            ORDER BY chunk_index ASC, id ASC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let content: String = row.try_get("text_content")?;
            let token_count = row
                .try_get::<i64, _>("token_count")
                .unwrap_or_else(|_| estimate_local_tokens(&content));
            items.push(LocalKnowledgeChunk {
                id: row.try_get("id")?,
                file_id: row.try_get("document_id")?,
                index: row.try_get::<i64, _>("chunk_index").unwrap_or(0).max(0),
                content,
                token_count: token_count.max(0),
            });
        }

        Ok(LocalKnowledgeChunkListResponse {
            items,
            total,
            offset,
            limit,
        })
    }

    pub async fn search_local_knowledge_chunks(
        &self,
        query: &str,
        limit: Option<i64>,
    ) -> Result<Vec<LocalKnowledgeSearchHit>, KnowledgeError> {
        self.search_local_knowledge_chunks_internal(query, limit, None)
            .await
    }

    pub async fn search_local_knowledge_chunks_in_documents(
        &self,
        query: &str,
        file_ids: &[String],
        limit: Option<i64>,
    ) -> Result<Vec<LocalKnowledgeSearchHit>, KnowledgeError> {
        self.search_local_knowledge_chunks_internal(query, limit, Some(file_ids))
            .await
    }

    async fn search_local_knowledge_chunks_internal(
        &self,
        query: &str,
        limit: Option<i64>,
        file_ids: Option<&[String]>,
    ) -> Result<Vec<LocalKnowledgeSearchHit>, KnowledgeError> {
        let normalized_query = query.trim().to_string();
        if normalized_query.is_empty() {
            return Ok(Vec::new());
        }
        let normalized_limit = limit.unwrap_or(4).clamp(1, 20);
        let tokens = tokenize_local_search_query(&normalized_query);
        if tokens.is_empty() {
            return Ok(Vec::new());
        }

        let lowered_tokens: Vec<String> = tokens
            .iter()
            .map(|token| token.to_ascii_lowercase())
            .collect();
        let query_lower = normalized_query.to_ascii_lowercase();
        let document_ids = file_ids
            .unwrap_or(&[])
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        if file_ids.is_some() && document_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut where_predicate = String::new();
        for (index, _) in lowered_tokens.iter().enumerate() {
            if index > 0 {
                where_predicate.push_str(" OR ");
            }
            where_predicate.push_str("LOWER(kc.text_content) LIKE ? ESCAPE '\\'");
        }
        let document_filter = if document_ids.is_empty() {
            String::new()
        } else {
            format!(
                " AND kc.document_id IN ({})",
                vec!["?"; document_ids.len()].join(", ")
            )
        };

        let sql = format!(
            r#"
            SELECT
              kc.id AS chunk_id,
              kc.document_id AS file_id,
              kc.chunk_index AS chunk_index,
              kc.text_content AS text_content,
              kc.token_count AS token_count,
              ud.filename AS file_name
            FROM knowledge_chunk kc
            INNER JOIN user_document ud
              ON ud.id = kc.document_id AND ud.user_id = kc.user_id
            WHERE kc.user_id = ?
              AND ud.status = 'indexed'
              AND ({where_predicate})
              {document_filter}
            ORDER BY kc.updated_at DESC, kc.chunk_index ASC
            LIMIT 300;
            "#
        );

        let mut query_builder = sqlx::query(&sql).bind(LOCAL_DESKTOP_USER_ID);
        for token in &lowered_tokens {
            query_builder = query_builder.bind(format!(
                "%{}%",
                token.replace('%', "\\%").replace('_', "\\_")
            ));
        }
        for file_id in document_ids {
            query_builder = query_builder.bind(file_id);
        }
        let rows = query_builder
            .fetch_all(&self.pool)
            .await
            .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        let mut scored_hits = Vec::new();
        for row in rows {
            let content: String = row.try_get("text_content")?;
            let content_lower = content.to_ascii_lowercase();
            let score =
                compute_local_knowledge_match_score(&query_lower, &lowered_tokens, &content_lower);
            if score <= 0.0 {
                continue;
            }
            scored_hits.push(LocalKnowledgeSearchHit {
                chunk_id: row.try_get("chunk_id")?,
                file_id: row.try_get("file_id")?,
                file_name: row.try_get("file_name")?,
                index: row.try_get::<i64, _>("chunk_index").unwrap_or(0).max(0),
                content,
                token_count: row.try_get::<i64, _>("token_count").unwrap_or(0).max(0),
                score,
            });
        }

        scored_hits.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| right.token_count.cmp(&left.token_count))
                .then_with(|| left.file_name.cmp(&right.file_name))
                .then_with(|| left.index.cmp(&right.index))
        });
        scored_hits.truncate(normalized_limit as usize);

        Ok(scored_hits)
    }

    async fn process_local_user_document_chunks_if_available(
        &self,
        file_id: &str,
        meta_info: &serde_json::Value,
    ) -> Result<(), KnowledgeError> {
        let Some(raw_text) = extract_local_document_text(meta_info) else {
            return Ok(());
        };
        let chunks = split_local_document_text_into_chunks(&raw_text);
        if chunks.is_empty() {
            self.mark_local_user_document_failed(file_id, "document content is empty")
                .await?;
            return Ok(());
        }

        let now = now_rfc3339();
        let sanitized_meta_info = strip_local_document_raw_text(meta_info);
        let sanitized_meta_info_text = serde_json::to_string(&sanitized_meta_info)?;
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            DELETE FROM knowledge_chunk
            WHERE document_id = ? AND user_id = ?;
            "#,
        )
        .bind(file_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&mut *tx)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        for (index, chunk) in chunks.iter().enumerate() {
            let chunk_id = Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO knowledge_chunk (
                  id, document_id, user_id, chunk_index, text_content, token_count, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                "#,
            )
            .bind(&chunk_id)
            .bind(file_id)
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(index as i64)
            .bind(chunk)
            .bind(estimate_local_tokens(chunk).max(0))
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        }

        sqlx::query(
            r#"
            UPDATE user_document
            SET status = 'indexed',
                error_message = NULL,
                chunk_count = ?,
                meta_info = ?,
                updated_at = ?
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(chunks.len() as i64)
        .bind(sanitized_meta_info_text)
        .bind(&now)
        .bind(file_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&mut *tx)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        tx.commit().await?;
        Ok(())
    }

    async fn mark_local_user_document_failed(
        &self,
        file_id: &str,
        error_message: &str,
    ) -> Result<(), KnowledgeError> {
        let now = now_rfc3339();
        let normalized_error = truncate_local_document_error_message(error_message);
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            DELETE FROM knowledge_chunk
            WHERE document_id = ? AND user_id = ?;
            "#,
        )
        .bind(file_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&mut *tx)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE user_document
            SET status = 'failed',
                error_message = ?,
                chunk_count = 0,
                updated_at = ?
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(normalized_error)
        .bind(&now)
        .bind(file_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&mut *tx)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        tx.commit().await?;
        Ok(())
    }

    async fn get_local_knowledge_folder_by_id(
        &self,
        folder_id: &str,
    ) -> Result<LocalKnowledgeFolder, KnowledgeError> {
        let row = sqlx::query(
            r#"
            SELECT
              f.id, f.name, f.parent_id, f.created_at, f.updated_at,
              COALESCE(fc.file_count, 0) AS file_count
            FROM knowledge_folder f
            LEFT JOIN (
              SELECT folder_id, COUNT(*) AS file_count
              FROM user_document
              WHERE user_id = ?
              GROUP BY folder_id
            ) fc ON fc.folder_id = f.id
            WHERE f.id = ? AND f.user_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(folder_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        let Some(row) = row else {
            return Err(KnowledgeError::NotFound(
                "knowledge folder not found".to_string(),
            ));
        };

        Ok(LocalKnowledgeFolder {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            parent_id: row.try_get("parent_id")?,
            file_count: row.try_get::<i64, _>("file_count").unwrap_or(0),
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

fn row_to_local_knowledge_file(row: &SqliteRow) -> Result<LocalKnowledgeFile, KnowledgeError> {
    let filename: String = row.try_get("filename")?;
    let status_raw: String = row.try_get("status")?;
    let chunk_count = row.try_get::<i64, _>("chunk_count").unwrap_or(0).max(0);
    let meta_info_text: String = row.try_get("meta_info")?;
    let meta_info = if meta_info_text.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str::<serde_json::Value>(&meta_info_text)
            .unwrap_or_else(|_| serde_json::json!({}))
    };

    let file_type = meta_info
        .get("file_type")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| infer_file_type_from_filename(&filename));
    let size = meta_info
        .get("size")
        .and_then(|value| value.as_i64())
        .unwrap_or(0)
        .max(0);

    Ok(LocalKnowledgeFile {
        id: row.try_get("id")?,
        name: filename,
        file_type,
        size,
        status: normalize_local_document_status(&status_raw).to_string(),
        chunks: Some(chunk_count),
        error_message: row.try_get("error_message")?,
        folder_id: row.try_get("folder_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn infer_file_type_from_filename(filename: &str) -> String {
    let lower = filename.trim().to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or_default();
    match ext {
        "pdf" => "pdf".to_string(),
        "docx" => "docx".to_string(),
        "txt" => "txt".to_string(),
        "md" => "md".to_string(),
        "csv" => "csv".to_string(),
        "xlsx" => "xlsx".to_string(),
        "html" | "htm" => "html".to_string(),
        "json" => "json".to_string(),
        _ => "txt".to_string(),
    }
}

fn normalize_local_document_status(status: &str) -> &'static str {
    match status.trim().to_ascii_lowercase().as_str() {
        "active" | "indexed" | "success" => "active",
        "processing" | "pending" | "running" => "processing",
        "failed" | "error" => "failed",
        _ => "processing",
    }
}

fn normalize_storage_document_status(status: Option<&str>) -> &'static str {
    match status
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_else(|| "processing".to_string())
        .as_str()
    {
        "active" | "indexed" | "success" => "indexed",
        "failed" | "error" => "failed",
        "processing" | "pending" | "running" => "processing",
        _ => "processing",
    }
}

fn truncate_local_document_error_message(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "local document processing failed".to_string();
    }
    trimmed.chars().take(300).collect::<String>()
}

fn extract_local_document_text(meta_info: &serde_json::Value) -> Option<String> {
    const CANDIDATE_KEYS: [&str; 5] = ["raw_text", "text", "content", "markdown", "body"];
    for key in CANDIDATE_KEYS {
        if let Some(value) = meta_info.get(key).and_then(|value| value.as_str()) {
            let normalized = value.trim().to_string();
            if !normalized.is_empty() {
                return Some(normalized);
            }
        }
    }

    let mut composed_segments = Vec::new();
    if let Some(items) = meta_info.get("chunks").and_then(|value| value.as_array()) {
        for item in items {
            if let Some(text) = item.as_str() {
                let normalized = text.trim();
                if !normalized.is_empty() {
                    composed_segments.push(normalized.to_string());
                }
            }
        }
    }
    if composed_segments.is_empty() {
        None
    } else {
        Some(composed_segments.join("\n\n"))
    }
}

fn strip_local_document_raw_text(meta_info: &serde_json::Value) -> serde_json::Value {
    let mut sanitized = meta_info.clone();
    if let Some(object) = sanitized.as_object_mut() {
        object.remove("raw_text");
    }
    sanitized
}

fn extract_local_document_download_url(meta_info: &serde_json::Value) -> Option<String> {
    if let Some(url) = meta_info
        .get("object_storage")
        .and_then(|value| value.get("asset_url"))
        .and_then(|value| value.as_str())
    {
        let normalized = url.trim();
        if !normalized.is_empty() {
            return Some(normalized.to_string());
        }
    }
    None
}

fn extract_local_document_object_key(meta_info: &serde_json::Value) -> Option<String> {
    let key = meta_info
        .get("object_storage")
        .and_then(|value| value.get("object_key"))
        .and_then(|value| value.as_str())?;
    let normalized = key.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn split_local_document_text_into_chunks(text: &str) -> Vec<String> {
    let normalized = text.trim();
    if normalized.is_empty() {
        return Vec::new();
    }

    let chars: Vec<char> = normalized.chars().collect();
    if chars.len() <= LOCAL_KNOWLEDGE_CHUNK_MAX_CHARS {
        return vec![normalized.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let mut end = (start + LOCAL_KNOWLEDGE_CHUNK_MAX_CHARS).min(chars.len());
        if end < chars.len() {
            let scan_floor = start + (LOCAL_KNOWLEDGE_CHUNK_MAX_CHARS / 2);
            let mut cursor = end;
            while cursor > scan_floor {
                let current = chars[cursor - 1];
                if current.is_whitespace()
                    || matches!(current, '。' | '！' | '？' | '.' | '!' | '?' | '\n')
                {
                    end = cursor;
                    break;
                }
                cursor -= 1;
            }
        }

        let chunk = chars[start..end]
            .iter()
            .collect::<String>()
            .trim()
            .to_string();
        if !chunk.is_empty() {
            chunks.push(chunk);
        }

        if end >= chars.len() {
            break;
        }
        let next_start = end.saturating_sub(LOCAL_KNOWLEDGE_CHUNK_OVERLAP_CHARS);
        if next_start == start {
            start = end;
        } else {
            start = next_start;
        }
    }

    chunks
}

fn tokenize_local_search_query(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut seen = HashSet::new();
    let normalized = query.to_ascii_lowercase();
    for token in normalized.split(|ch: char| !ch.is_alphanumeric()) {
        let trimmed = token.trim();
        if trimmed.len() < 2 {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            tokens.push(trimmed.to_string());
        }
    }
    if tokens.is_empty() && !normalized.trim().is_empty() {
        tokens.push(normalized.trim().to_string());
    }
    tokens.truncate(8);
    tokens
}

fn compute_local_knowledge_match_score(
    query_lower: &str,
    tokens_lower: &[String],
    content_lower: &str,
) -> f64 {
    if content_lower.is_empty() {
        return 0.0;
    }
    let mut score = 0.0;
    if !query_lower.is_empty() && content_lower.contains(query_lower) {
        score += 8.0;
    }
    for token in tokens_lower {
        let mut start = 0usize;
        let mut token_hits = 0usize;
        while start < content_lower.len() {
            let Some(pos) = content_lower[start..].find(token) else {
                break;
            };
            token_hits += 1;
            start += pos + token.len();
        }
        if token_hits > 0 {
            score += (token_hits as f64) * (1.0 + (token.len() as f64 / 10.0));
        }
    }
    score
}

fn estimate_local_tokens(text: &str) -> i64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    trimmed.split_whitespace().count() as i64
}

fn sort_local_knowledge_folders(
    folders: &mut [LocalKnowledgeFolder],
    sort_field: &str,
    sort_direction: &str,
) {
    folders.sort_by(|left, right| {
        let base = match sort_field {
            "name" => left
                .name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase()),
            _ => left.created_at.cmp(&right.created_at),
        };
        if sort_direction == "asc" {
            base
        } else {
            reverse_ordering(base)
        }
    });
}

fn sort_local_knowledge_files(
    files: &mut [LocalKnowledgeFile],
    sort_field: &str,
    sort_direction: &str,
) {
    files.sort_by(|left, right| {
        let base = match sort_field {
            "name" => left
                .name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase()),
            "size" => left.size.cmp(&right.size),
            "status" => left
                .status
                .to_ascii_lowercase()
                .cmp(&right.status.to_ascii_lowercase()),
            "chunks" => left.chunks.unwrap_or(0).cmp(&right.chunks.unwrap_or(0)),
            _ => left.created_at.cmp(&right.created_at),
        };
        if sort_direction == "asc" {
            base
        } else {
            reverse_ordering(base)
        }
    });
}

fn reverse_ordering(value: Ordering) -> Ordering {
    match value {
        Ordering::Less => Ordering::Greater,
        Ordering::Greater => Ordering::Less,
        Ordering::Equal => Ordering::Equal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_local_document_raw_text_removes_only_processing_payload() {
        let meta_info = serde_json::json!({
            "file_type": "pdf",
            "size": 42,
            "raw_text": "hello world",
            "object_storage": {
                "object_key": "knowledge/demo.pdf"
            }
        });

        let sanitized = strip_local_document_raw_text(&meta_info);

        assert_eq!(sanitized.get("raw_text"), None);
        assert_eq!(
            sanitized
                .get("file_type")
                .and_then(serde_json::Value::as_str),
            Some("pdf")
        );
        assert_eq!(
            sanitized
                .pointer("/object_storage/object_key")
                .and_then(serde_json::Value::as_str),
            Some("knowledge/demo.pdf")
        );
    }
}
