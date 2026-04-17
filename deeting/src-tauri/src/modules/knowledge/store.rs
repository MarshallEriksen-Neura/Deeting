use std::cmp::Ordering;
use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeSet;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};

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
const LOCAL_KNOWLEDGE_CHUNK_MIN_CHARS: usize = 120;
const LOCAL_KNOWLEDGE_FTS_TABLE: &str = "knowledge_chunk_fts";

#[derive(Debug, Clone, PartialEq, Eq)]
struct LocalKnowledgeBlock {
    block_type: &'static str,
    text: String,
    level: Option<usize>,
    section_path: Vec<String>,
    char_start: usize,
    char_end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LocalKnowledgeChunkDraft {
    content: String,
    chunk_type: String,
    section_path: Vec<String>,
    page_hint: Option<i64>,
    char_start: i64,
    char_end: i64,
    char_count: i64,
    token_count: i64,
    content_hash: String,
    quality_flags: Vec<String>,
}

#[derive(Debug, Clone)]
struct LocalKnowledgeRankComputation {
    score: f64,
    lexical_score: f64,
    match_reasons: Vec<String>,
    score_breakdown: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum LocalKnowledgeFtsRepairPlan {
    Healthy,
    Documents(Vec<String>),
    FullRebuild,
}

pub struct KnowledgeStore {
    pool: SqlitePool,
    write_pool: SqlitePool,
}

impl KnowledgeStore {
    pub fn with_pool(pool: SqlitePool) -> Self {
        Self {
            write_pool: pool.clone(),
            pool,
        }
    }

    pub fn with_pools(pool: SqlitePool, write_pool: SqlitePool) -> Self {
        Self { pool, write_pool }
    }

    async fn begin_write(&self) -> Result<sqlx::Transaction<'_, sqlx::Sqlite>, KnowledgeError> {
        self.write_pool
            .begin()
            .await
            .map_err(|err| KnowledgeError::Storage(err.to_string()))
    }

    async fn add_column_if_missing(
        &self,
        table: &str,
        column_definition: &str,
    ) -> Result<(), KnowledgeError> {
        let sql = format!("ALTER TABLE {table} ADD COLUMN {column_definition};");
        match sqlx::query(&sql).execute(&self.write_pool).await {
            Ok(_) => Ok(()),
            Err(err) => {
                let message = err.to_string().to_ascii_lowercase();
                if message.contains("duplicate column name") {
                    Ok(())
                } else {
                    Err(KnowledgeError::Storage(err.to_string()))
                }
            }
        }
    }

    async fn delete_knowledge_chunk_fts_rows_for_document<'e, E>(
        &self,
        executor: E,
        document_id: &str,
    ) -> Result<(), KnowledgeError>
    where
        E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
    {
        sqlx::query(&format!(
            "DELETE FROM {LOCAL_KNOWLEDGE_FTS_TABLE} WHERE document_id = ?;"
        ))
        .bind(document_id)
        .execute(executor)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        Ok(())
    }

    async fn rebuild_local_knowledge_fts_index(&self) -> Result<(), KnowledgeError> {
        sqlx::query(&format!("DELETE FROM {LOCAL_KNOWLEDGE_FTS_TABLE};"))
            .execute(&self.write_pool)
            .await
            .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(&format!(
            r#"
            INSERT INTO {LOCAL_KNOWLEDGE_FTS_TABLE} (
              chunk_id, document_id, text_content, section_path, chunk_type
            )
            SELECT
              id,
              document_id,
              text_content,
              COALESCE(section_path, '[]'),
              COALESCE(chunk_type, 'paragraph')
            FROM knowledge_chunk
            WHERE user_id = ?;
            "#
        ))
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        Ok(())
    }

    async fn sync_local_knowledge_fts_rows_for_document_in_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        document_id: &str,
    ) -> Result<(), KnowledgeError> {
        self.delete_knowledge_chunk_fts_rows_for_document(&mut **tx, document_id)
            .await?;

        sqlx::query(&format!(
            r#"
            INSERT INTO {LOCAL_KNOWLEDGE_FTS_TABLE} (
              chunk_id, document_id, text_content, section_path, chunk_type
            )
            SELECT
              id,
              document_id,
              text_content,
              COALESCE(section_path, '[]'),
              COALESCE(chunk_type, 'paragraph')
            FROM knowledge_chunk
            WHERE user_id = ?
              AND document_id = ?;
            "#
        ))
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(document_id)
        .execute(&mut **tx)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        Ok(())
    }

    async fn local_knowledge_fts_repair_plan(
        &self,
    ) -> Result<LocalKnowledgeFtsRepairPlan, KnowledgeError> {
        let chunk_total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM knowledge_chunk
            WHERE user_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        let chunk_total = chunk_total_row
            .try_get::<i64, _>("total")
            .unwrap_or(0)
            .max(0);

        let fts_total_row = sqlx::query(&format!(
            "SELECT COUNT(*) AS total FROM {LOCAL_KNOWLEDGE_FTS_TABLE};"
        ))
        .fetch_one(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        let fts_total = fts_total_row.try_get::<i64, _>("total").unwrap_or(0).max(0);

        let mut affected_documents = BTreeSet::new();

        let missing_or_stale_rows = sqlx::query(&format!(
            r#"
            SELECT DISTINCT
              kc.document_id AS actual_document_id,
              fts.document_id AS fts_document_id
            FROM knowledge_chunk kc
            LEFT JOIN {LOCAL_KNOWLEDGE_FTS_TABLE} fts
              ON fts.chunk_id = kc.id
            WHERE kc.user_id = ?
              AND (
                fts.chunk_id IS NULL
                OR fts.document_id IS NULL
                OR fts.document_id != kc.document_id
                OR fts.text_content != kc.text_content
                OR fts.section_path != COALESCE(kc.section_path, '[]')
                OR fts.chunk_type != COALESCE(kc.chunk_type, 'paragraph')
              );
            "#
        ))
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        for row in missing_or_stale_rows {
            if let Ok(actual_document_id) = row.try_get::<String, _>("actual_document_id") {
                let trimmed = actual_document_id.trim();
                if !trimmed.is_empty() {
                    affected_documents.insert(trimmed.to_string());
                }
            }
            if let Ok(fts_document_id) = row.try_get::<String, _>("fts_document_id") {
                let trimmed = fts_document_id.trim();
                if !trimmed.is_empty() {
                    affected_documents.insert(trimmed.to_string());
                }
            }
        }

        let orphaned_fts_rows = sqlx::query(&format!(
            r#"
            SELECT DISTINCT fts.document_id AS document_id
            FROM {LOCAL_KNOWLEDGE_FTS_TABLE} fts
            LEFT JOIN knowledge_chunk kc
              ON kc.id = fts.chunk_id
            WHERE kc.id IS NULL;
            "#
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;
        for row in orphaned_fts_rows {
            let Some(document_id) = row
                .try_get::<String, _>("document_id")
                .ok()
                .map(|value| value.trim().to_string())
            else {
                return Ok(LocalKnowledgeFtsRepairPlan::FullRebuild);
            };
            if document_id.is_empty() {
                return Ok(LocalKnowledgeFtsRepairPlan::FullRebuild);
            }
            affected_documents.insert(document_id);
        }

        if affected_documents.is_empty() {
            return if chunk_total == fts_total {
                Ok(LocalKnowledgeFtsRepairPlan::Healthy)
            } else {
                Ok(LocalKnowledgeFtsRepairPlan::FullRebuild)
            };
        }

        Ok(LocalKnowledgeFtsRepairPlan::Documents(
            affected_documents.into_iter().collect(),
        ))
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_folder_user_parent_name
            ON knowledge_folder(user_id, parent_id, name);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_folder_user_root_name
            ON knowledge_folder(user_id, name)
            WHERE parent_id IS NULL;
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_folder_user_id
            ON knowledge_folder(user_id);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_folder_parent_id
            ON knowledge_folder(parent_id);
            "#,
        )
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_user_id
            ON user_document(user_id);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_status
            ON user_document(status);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_media_asset_id
            ON user_document(media_asset_id);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_user_document_folder_id
            ON user_document(folder_id);
            "#,
        )
        .execute(&self.write_pool)
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
              chunk_type TEXT NOT NULL DEFAULT 'paragraph',
              section_path TEXT NOT NULL DEFAULT '[]',
              page_hint INTEGER,
              char_start INTEGER,
              char_end INTEGER,
              char_count INTEGER NOT NULL DEFAULT 0,
              content_hash TEXT,
              quality_flags TEXT NOT NULL DEFAULT '[]',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (document_id) REFERENCES user_document(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_chunk_document_index
            ON knowledge_chunk(document_id, chunk_index);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_document_id
            ON knowledge_chunk(document_id);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_user_id
            ON knowledge_chunk(user_id);
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        self.add_column_if_missing(
            "knowledge_chunk",
            "chunk_type TEXT NOT NULL DEFAULT 'paragraph'",
        )
        .await?;
        self.add_column_if_missing("knowledge_chunk", "section_path TEXT NOT NULL DEFAULT '[]'")
            .await?;
        self.add_column_if_missing("knowledge_chunk", "page_hint INTEGER")
            .await?;
        self.add_column_if_missing("knowledge_chunk", "char_start INTEGER")
            .await?;
        self.add_column_if_missing("knowledge_chunk", "char_end INTEGER")
            .await?;
        self.add_column_if_missing("knowledge_chunk", "char_count INTEGER NOT NULL DEFAULT 0")
            .await?;
        self.add_column_if_missing("knowledge_chunk", "content_hash TEXT")
            .await?;
        self.add_column_if_missing(
            "knowledge_chunk",
            "quality_flags TEXT NOT NULL DEFAULT '[]'",
        )
        .await?;

        sqlx::query(&format!(
            r#"
            CREATE VIRTUAL TABLE IF NOT EXISTS {LOCAL_KNOWLEDGE_FTS_TABLE}
            USING fts5(
              chunk_id UNINDEXED,
              document_id UNINDEXED,
              text_content,
              section_path,
              chunk_type,
              tokenize='unicode61'
            );
            "#
        ))
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        match self.local_knowledge_fts_repair_plan().await? {
            LocalKnowledgeFtsRepairPlan::Healthy => {}
            LocalKnowledgeFtsRepairPlan::Documents(document_ids) => {
                log::info!(
                    "knowledge.store: repairing local knowledge FTS rows during init for {} documents",
                    document_ids.len()
                );
                let mut tx = self.begin_write().await?;
                for document_id in &document_ids {
                    self.sync_local_knowledge_fts_rows_for_document_in_tx(&mut tx, document_id)
                        .await?;
                }
                tx.commit().await?;
            }
            LocalKnowledgeFtsRepairPlan::FullRebuild => {
                log::info!("knowledge.store: rebuilding local knowledge FTS index during init");
                self.rebuild_local_knowledge_fts_index().await?;
            }
        }

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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
            .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        self.delete_knowledge_chunk_fts_rows_for_document(&self.write_pool, &normalized_id)
            .await?;

        let result = sqlx::query(
            r#"
            DELETE FROM user_document
            WHERE id = ? AND user_id = ?;
            "#,
        )
        .bind(&normalized_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

        self.delete_knowledge_chunk_fts_rows_for_document(&self.write_pool, &normalized_id)
            .await?;

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
            SELECT
              id,
              document_id,
              chunk_index,
              text_content,
              token_count,
              chunk_type,
              section_path,
              page_hint,
              char_start,
              char_end,
              char_count,
              content_hash,
              quality_flags
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
            let section_path = row
                .try_get::<String, _>("section_path")
                .ok()
                .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
                .unwrap_or_default();
            let quality_flags = row
                .try_get::<String, _>("quality_flags")
                .ok()
                .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
                .unwrap_or_default();
            items.push(LocalKnowledgeChunk {
                id: row.try_get("id")?,
                file_id: row.try_get("document_id")?,
                index: row.try_get::<i64, _>("chunk_index").unwrap_or(0).max(0),
                content,
                token_count: token_count.max(0),
                chunk_type: row
                    .try_get::<String, _>("chunk_type")
                    .unwrap_or_else(|_| "paragraph".to_string()),
                section_path,
                page_hint: row.try_get::<Option<i64>, _>("page_hint").unwrap_or(None),
                char_start: row.try_get::<Option<i64>, _>("char_start").unwrap_or(None),
                char_end: row.try_get::<Option<i64>, _>("char_end").unwrap_or(None),
                char_count: row.try_get::<i64, _>("char_count").unwrap_or(0).max(0),
                content_hash: row
                    .try_get::<Option<String>, _>("content_hash")
                    .unwrap_or(None),
                quality_flags,
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
        let fts_query = build_local_knowledge_fts_query(&lowered_tokens, &query_lower);
        if fts_query.trim().is_empty() {
            return Ok(Vec::new());
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
              kc.chunk_type AS chunk_type,
              kc.section_path AS section_path,
              kc.page_hint AS page_hint,
              kc.char_start AS char_start,
              kc.char_end AS char_end,
              kc.char_count AS char_count,
              kc.content_hash AS content_hash,
              kc.quality_flags AS quality_flags,
              ud.filename AS file_name,
              bm25({LOCAL_KNOWLEDGE_FTS_TABLE}, 1.0, 0.8, 0.6) AS bm25_score
            FROM {LOCAL_KNOWLEDGE_FTS_TABLE}
            INNER JOIN knowledge_chunk kc
              ON kc.id = {LOCAL_KNOWLEDGE_FTS_TABLE}.chunk_id
            INNER JOIN user_document ud
              ON ud.id = kc.document_id AND ud.user_id = kc.user_id
            WHERE {LOCAL_KNOWLEDGE_FTS_TABLE} MATCH ?
              AND kc.user_id = ?
              AND ud.status = 'indexed'
              {document_filter}
            ORDER BY bm25_score ASC, kc.chunk_index ASC
            LIMIT 300;
            "#
        );

        let mut query_builder = sqlx::query(&sql)
            .bind(&fts_query)
            .bind(LOCAL_DESKTOP_USER_ID);
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
            let section_path = row
                .try_get::<String, _>("section_path")
                .ok()
                .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
                .unwrap_or_default();
            let quality_flags = row
                .try_get::<String, _>("quality_flags")
                .ok()
                .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
                .unwrap_or_default();
            let file_name: String = row.try_get("file_name")?;
            let chunk_type = row
                .try_get::<String, _>("chunk_type")
                .unwrap_or_else(|_| "paragraph".to_string());
            let bm25_score = row.try_get::<f64, _>("bm25_score").unwrap_or(999.0);
            let content_lower = content.to_ascii_lowercase();
            let file_name_lower = file_name.to_ascii_lowercase();
            let rank = compute_local_knowledge_match_score(
                &query_lower,
                &lowered_tokens,
                &file_name_lower,
                &content_lower,
                &section_path,
                &chunk_type,
                &quality_flags,
                bm25_score,
            );
            if rank.score <= 0.0 {
                continue;
            }
            scored_hits.push(LocalKnowledgeSearchHit {
                chunk_id: row.try_get("chunk_id")?,
                file_id: row.try_get("file_id")?,
                file_name,
                index: row.try_get::<i64, _>("chunk_index").unwrap_or(0).max(0),
                content,
                token_count: row.try_get::<i64, _>("token_count").unwrap_or(0).max(0),
                chunk_type,
                section_path,
                page_hint: row.try_get::<Option<i64>, _>("page_hint").unwrap_or(None),
                char_start: row.try_get::<Option<i64>, _>("char_start").unwrap_or(None),
                char_end: row.try_get::<Option<i64>, _>("char_end").unwrap_or(None),
                char_count: row.try_get::<i64, _>("char_count").unwrap_or(0).max(0),
                content_hash: row
                    .try_get::<Option<String>, _>("content_hash")
                    .unwrap_or(None),
                quality_flags,
                lexical_score: Some(rank.lexical_score),
                match_reasons: rank.match_reasons,
                score_breakdown: Some(rank.score_breakdown),
                score: rank.score,
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
        let chunks = split_local_document_text_into_chunks_structure_first(&raw_text);
        if chunks.is_empty() {
            self.mark_local_user_document_failed(file_id, "document content is empty")
                .await?;
            return Ok(());
        }

        let now = now_rfc3339();
        let sanitized_meta_info = strip_local_document_raw_text(meta_info);
        let sanitized_meta_info_text = serde_json::to_string(&sanitized_meta_info)?;
        let mut tx = self.begin_write().await?;

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

        self.delete_knowledge_chunk_fts_rows_for_document(&mut *tx, file_id)
            .await?;

        for (index, chunk) in chunks.iter().enumerate() {
            let chunk_id = Uuid::new_v4().to_string();
            let section_path_text = serde_json::to_string(&chunk.section_path)?;
            let quality_flags_text = serde_json::to_string(&chunk.quality_flags)?;
            sqlx::query(
                r#"
                INSERT INTO knowledge_chunk (
                  id, document_id, user_id, chunk_index, text_content, token_count,
                  chunk_type, section_path, page_hint, char_start, char_end, char_count,
                  content_hash, quality_flags, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                "#,
            )
            .bind(&chunk_id)
            .bind(file_id)
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(index as i64)
            .bind(&chunk.content)
            .bind(chunk.token_count.max(0))
            .bind(&chunk.chunk_type)
            .bind(&section_path_text)
            .bind(chunk.page_hint)
            .bind(chunk.char_start)
            .bind(chunk.char_end)
            .bind(chunk.char_count.max(0))
            .bind(&chunk.content_hash)
            .bind(quality_flags_text)
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|err| KnowledgeError::Storage(err.to_string()))?;

            sqlx::query(&format!(
                r#"
                INSERT INTO {LOCAL_KNOWLEDGE_FTS_TABLE} (
                  chunk_id, document_id, text_content, section_path, chunk_type
                )
                VALUES (?, ?, ?, ?, ?);
                "#
            ))
            .bind(&chunk_id)
            .bind(file_id)
            .bind(&chunk.content)
            .bind(&section_path_text)
            .bind(&chunk.chunk_type)
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
        let mut tx = self.begin_write().await?;

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

        self.delete_knowledge_chunk_fts_rows_for_document(&mut *tx, file_id)
            .await?;

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

fn split_local_document_text_into_chunks_structure_first(
    text: &str,
) -> Vec<LocalKnowledgeChunkDraft> {
    let normalized = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string();
    if normalized.is_empty() {
        return Vec::new();
    }

    let blocks = build_local_knowledge_blocks(&normalized);
    let mut chunks = build_local_knowledge_chunks_from_blocks(&normalized, &blocks);
    if chunks.is_empty() {
        chunks.push(build_chunk_draft(
            normalized.clone(),
            "paragraph".to_string(),
            Vec::new(),
            0,
            normalized.chars().count(),
            None,
        ));
    }
    chunks
}

fn build_local_knowledge_blocks(text: &str) -> Vec<LocalKnowledgeBlock> {
    let mut blocks = Vec::new();
    let mut current_lines = Vec::new();
    let mut current_start = None;
    let mut current_offset = 0usize;
    let mut section_path = Vec::<String>::new();
    let mut is_first_block = true;

    for raw_line in text.split_inclusive('\n') {
        let line = raw_line.trim_end_matches('\n').trim_end_matches('\r');
        let line_chars = raw_line.chars().count();
        if line.trim().is_empty() {
            flush_local_knowledge_block(
                &mut blocks,
                &mut current_lines,
                &mut current_start,
                current_offset,
                &mut section_path,
                &mut is_first_block,
            );
            current_offset += line_chars;
            continue;
        }

        if current_start.is_none() {
            current_start = Some(current_offset);
        }
        current_lines.push(line.to_string());
        current_offset += line_chars;
    }

    flush_local_knowledge_block(
        &mut blocks,
        &mut current_lines,
        &mut current_start,
        current_offset,
        &mut section_path,
        &mut is_first_block,
    );
    blocks
}

fn flush_local_knowledge_block(
    blocks: &mut Vec<LocalKnowledgeBlock>,
    current_lines: &mut Vec<String>,
    current_start: &mut Option<usize>,
    current_end: usize,
    section_path: &mut Vec<String>,
    is_first_block: &mut bool,
) {
    if current_lines.is_empty() {
        *current_start = None;
        return;
    }

    let text = current_lines.join("\n").trim().to_string();
    let start = current_start.unwrap_or(0);
    current_lines.clear();
    *current_start = None;
    if text.is_empty() {
        return;
    }

    let (block_type, level, normalized_text) =
        classify_local_knowledge_block(&text, *is_first_block, section_path.len());
    *is_first_block = false;
    let block_section_path = if matches!(block_type, "title" | "heading") {
        apply_section_heading(section_path, &normalized_text, level.unwrap_or(1))
    } else {
        section_path.clone()
    };

    blocks.push(LocalKnowledgeBlock {
        block_type,
        text: normalized_text,
        level,
        section_path: block_section_path,
        char_start: start,
        char_end: current_end,
    });
}

fn classify_local_knowledge_block(
    text: &str,
    is_first_block: bool,
    current_depth: usize,
) -> (&'static str, Option<usize>, String) {
    if let Some((heading_text, level)) = parse_markdown_heading(text) {
        return ("heading", Some(level), heading_text);
    }

    let trimmed = text.trim();
    let lines = trimmed.lines().map(str::trim).collect::<Vec<_>>();
    let single_line = lines.len() == 1;
    let char_count = trimmed.chars().count();

    if single_line && is_first_block && char_count <= 120 {
        return ("title", Some(1), trimmed.to_string());
    }
    if single_line && looks_like_heading_line(trimmed) {
        let level = (current_depth + 1).clamp(1, 6);
        return ("heading", Some(level), trimmed.to_string());
    }
    if trimmed.contains("```") {
        return ("code", None, trimmed.to_string());
    }
    if !lines.is_empty() && lines.iter().all(|line| is_list_line(line)) {
        return ("list", None, trimmed.to_string());
    }
    if !lines.is_empty() && lines.iter().all(|line| line.starts_with('>')) {
        return ("quote", None, trimmed.to_string());
    }
    if lines.len() >= 2 && lines.iter().all(|line| line.contains('|')) {
        return ("table", None, trimmed.to_string());
    }

    ("paragraph", None, trimmed.to_string())
}

fn parse_markdown_heading(text: &str) -> Option<(String, usize)> {
    let trimmed = text.trim();
    let hashes = trimmed.chars().take_while(|ch| *ch == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = trimmed.get(hashes..)?.trim();
    if rest.is_empty() {
        return None;
    }
    Some((rest.to_string(), hashes))
}

fn looks_like_heading_line(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.contains('\n') {
        return false;
    }
    if trimmed.chars().count() > 100 {
        return false;
    }
    if matches!(
        trimmed.chars().last(),
        Some('.')
            | Some('!')
            | Some('?')
            | Some('\u{3002}')
            | Some('\u{FF01}')
            | Some('\u{FF1F}')
            | Some(';')
            | Some('\u{FF1B}')
    ) {
        return false;
    }
    trimmed.chars().any(|ch| ch.is_alphanumeric())
}

fn is_list_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
        || trimmed.starts_with("+ ")
        || trimmed.starts_with("\u{2022} ")
    {
        return true;
    }

    let digit_prefix_len = trimmed.chars().take_while(|ch| ch.is_ascii_digit()).count();
    if digit_prefix_len == 0 {
        return false;
    }
    matches!(
        trimmed.chars().nth(digit_prefix_len),
        Some('.') | Some(')') | Some('\u{3001}')
    ) && matches!(trimmed.chars().nth(digit_prefix_len + 1), Some(' '))
}

fn apply_section_heading(
    section_path: &mut Vec<String>,
    heading: &str,
    level: usize,
) -> Vec<String> {
    let normalized_heading = heading.trim().to_string();
    if normalized_heading.is_empty() {
        return section_path.clone();
    }
    let target_depth = level.saturating_sub(1);
    if section_path.len() > target_depth {
        section_path.truncate(target_depth);
    }
    section_path.push(normalized_heading);
    section_path.clone()
}

fn build_local_knowledge_chunks_from_blocks(
    normalized_text: &str,
    blocks: &[LocalKnowledgeBlock],
) -> Vec<LocalKnowledgeChunkDraft> {
    let mut chunks = Vec::new();
    let mut pending = Vec::<LocalKnowledgeBlock>::new();

    for block in blocks {
        if matches!(block.block_type, "title" | "heading") {
            continue;
        }

        let block_chars = block.text.chars().count();
        if block_chars > LOCAL_KNOWLEDGE_CHUNK_MAX_CHARS {
            flush_pending_local_knowledge_chunks(&mut pending, &mut chunks);
            chunks.extend(split_large_block_into_chunk_drafts(block, block.block_type));
            continue;
        }

        let current_len = pending
            .iter()
            .map(|item| item.text.chars().count())
            .sum::<usize>()
            + pending.len().saturating_sub(1) * 2;
        let next_len = if pending.is_empty() {
            block_chars
        } else {
            current_len + 2 + block_chars
        };
        let same_section = pending
            .last()
            .map(|item| item.section_path == block.section_path)
            .unwrap_or(true);
        if !pending.is_empty() && (!same_section || next_len > LOCAL_KNOWLEDGE_CHUNK_MAX_CHARS) {
            flush_pending_local_knowledge_chunks(&mut pending, &mut chunks);
        }

        pending.push(block.clone());
    }

    flush_pending_local_knowledge_chunks(&mut pending, &mut chunks);
    if chunks.is_empty() && !normalized_text.trim().is_empty() {
        chunks.push(build_chunk_draft(
            normalized_text.trim().to_string(),
            "paragraph".to_string(),
            Vec::new(),
            0,
            normalized_text.chars().count(),
            None,
        ));
    }
    chunks
}

fn flush_pending_local_knowledge_chunks(
    pending: &mut Vec<LocalKnowledgeBlock>,
    chunks: &mut Vec<LocalKnowledgeChunkDraft>,
) {
    if pending.is_empty() {
        return;
    }

    let content = pending
        .iter()
        .map(|block| block.text.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if content.is_empty() {
        pending.clear();
        return;
    }

    let chunk_type = if pending.len() == 1 {
        pending[0].block_type.to_string()
    } else {
        "mixed".to_string()
    };
    let section_path = pending
        .last()
        .map(|block| block.section_path.clone())
        .unwrap_or_default();
    let char_start = pending.first().map(|block| block.char_start).unwrap_or(0);
    let char_end = pending
        .last()
        .map(|block| block.char_end)
        .unwrap_or(char_start);
    chunks.push(build_chunk_draft(
        content,
        chunk_type,
        section_path,
        char_start,
        char_end,
        None,
    ));
    pending.clear();
}

fn split_large_block_into_chunk_drafts(
    block: &LocalKnowledgeBlock,
    chunk_type: &str,
) -> Vec<LocalKnowledgeChunkDraft> {
    let chars = block.text.chars().collect::<Vec<_>>();
    if chars.is_empty() {
        return Vec::new();
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
                    || matches!(
                        current,
                        '\u{3002}'
                            | '\u{FF01}'
                            | '\u{FF1F}'
                            | '\u{FF1B}'
                            | '.'
                            | '!'
                            | '?'
                            | ';'
                            | '\n'
                    )
                {
                    end = cursor;
                    break;
                }
                cursor -= 1;
            }
        }

        let raw_piece = chars[start..end].iter().collect::<String>();
        let leading_trim = raw_piece
            .chars()
            .take_while(|ch| ch.is_whitespace())
            .count();
        let trailing_trim = raw_piece
            .chars()
            .rev()
            .take_while(|ch| ch.is_whitespace())
            .count();
        let trimmed_piece = raw_piece.trim().to_string();
        if !trimmed_piece.is_empty() {
            let actual_start = block.char_start + start + leading_trim;
            let actual_end = block.char_start + end.saturating_sub(trailing_trim);
            chunks.push(build_chunk_draft(
                trimmed_piece,
                chunk_type.to_string(),
                block.section_path.clone(),
                actual_start,
                actual_end,
                None,
            ));
        }

        if end >= chars.len() {
            break;
        }
        let next_start = end.saturating_sub(LOCAL_KNOWLEDGE_CHUNK_OVERLAP_CHARS);
        start = if next_start == start { end } else { next_start };
    }

    chunks
}

fn build_chunk_draft(
    content: String,
    chunk_type: String,
    section_path: Vec<String>,
    char_start: usize,
    char_end: usize,
    page_hint: Option<i64>,
) -> LocalKnowledgeChunkDraft {
    let char_count = content.chars().count() as i64;
    LocalKnowledgeChunkDraft {
        token_count: estimate_local_tokens(&content).max(0),
        content_hash: hash_local_chunk_content(&content),
        quality_flags: build_local_chunk_quality_flags(&content, &chunk_type),
        content,
        chunk_type,
        section_path,
        page_hint,
        char_start: char_start as i64,
        char_end: char_end as i64,
        char_count,
    }
}

fn hash_local_chunk_content(content: &str) -> String {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn build_local_chunk_quality_flags(content: &str, chunk_type: &str) -> Vec<String> {
    let mut flags = Vec::new();
    let char_count = content.chars().count();
    if char_count < LOCAL_KNOWLEDGE_CHUNK_MIN_CHARS {
        flags.push("short_chunk".to_string());
    }
    if char_count >= (LOCAL_KNOWLEDGE_CHUNK_MAX_CHARS * 9 / 10) {
        flags.push("near_limit".to_string());
    }
    if matches!(chunk_type, "list" | "table" | "code" | "quote" | "mixed") {
        flags.push(format!("type:{chunk_type}"));
    }
    if looks_like_docx_field_artifact(content) {
        flags.push("noisy_chunk".to_string());
    }
    flags
}

fn looks_like_docx_field_artifact(content: &str) -> bool {
    let normalized = content.replace('\r', "").replace('\n', " ");
    let compact = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = compact.trim();
    if trimmed.is_empty() {
        return true;
    }
    if trimmed.eq_ignore_ascii_case("\\h") {
        return true;
    }
    if trimmed.starts_with("\\h ") {
        return true;
    }
    if trimmed.starts_with("HYPERLINK \\l ") {
        return true;
    }
    if trimmed.contains("PAGEREF _Toc") {
        return true;
    }
    if trimmed.starts_with("TOC \\") {
        return true;
    }
    false
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

fn sanitize_fts5_token(token: &str) -> String {
    token.replace('"', "\"\"").replace('*', "").replace('^', "")
}

fn is_fts5_operator(token: &str) -> bool {
    matches!(
        token.to_ascii_uppercase().as_str(),
        "AND" | "OR" | "NOT" | "NEAR"
    )
}

fn build_local_knowledge_fts_query(tokens_lower: &[String], query_lower: &str) -> String {
    let mut parts = Vec::new();
    let normalized_query = query_lower.trim();
    if !normalized_query.is_empty() && !is_fts5_operator(normalized_query) {
        parts.push(format!("\"{}\"", sanitize_fts5_token(normalized_query)));
    }
    for token in tokens_lower {
        let normalized = token.trim();
        if normalized.is_empty() || is_fts5_operator(normalized) {
            continue;
        }
        let quoted = format!("\"{}\"", sanitize_fts5_token(normalized));
        if !parts.contains(&quoted) {
            parts.push(quoted);
        }
    }
    parts.join(" OR ")
}

fn compute_local_knowledge_match_score(
    query_lower: &str,
    tokens_lower: &[String],
    file_name_lower: &str,
    content_lower: &str,
    section_path: &[String],
    chunk_type: &str,
    quality_flags: &[String],
    bm25_score: f64,
) -> LocalKnowledgeRankComputation {
    if content_lower.is_empty() {
        return LocalKnowledgeRankComputation {
            score: 0.0,
            lexical_score: 0.0,
            match_reasons: Vec::new(),
            score_breakdown: serde_json::json!({
                "lexical_score": 0.0,
                "filename_boost": 0.0,
                "heading_boost": 0.0,
                "chunk_type_boost": 0.0,
                "quality_penalty": 0.0,
            }),
        };
    }
    let mut lexical_score = normalize_local_bm25_score(bm25_score);
    let mut filename_boost = 0.0;
    let mut heading_boost = 0.0;
    let mut chunk_type_boost = 0.0;
    let mut quality_penalty = 0.0;
    let mut match_reasons = Vec::new();
    let section_lower = section_path
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if !query_lower.is_empty() && content_lower.contains(query_lower) {
        lexical_score += 0.45;
        match_reasons.push("fts:body".to_string());
    }
    if !query_lower.is_empty()
        && section_lower
            .iter()
            .any(|value| value.contains(query_lower))
    {
        heading_boost += 0.35;
        match_reasons.push("fts:section".to_string());
    }
    if !query_lower.is_empty() && file_name_lower.contains(query_lower) {
        filename_boost += 0.25;
        match_reasons.push("fts:filename".to_string());
    }
    for token in tokens_lower {
        if file_name_lower.contains(token) {
            filename_boost += 0.08;
        }
        let heading_hits = section_lower
            .iter()
            .filter(|value| value.contains(token))
            .count();
        if heading_hits > 0 {
            heading_boost += (heading_hits as f64) * 0.08;
        }
    }
    match chunk_type {
        "title" | "heading" => {
            chunk_type_boost += 0.2;
            match_reasons.push(format!("type:{chunk_type}"));
        }
        "list" => {
            chunk_type_boost += 0.08;
            match_reasons.push(format!("type:{chunk_type}"));
        }
        "table" | "code" => {
            chunk_type_boost += 0.04;
            match_reasons.push(format!("type:{chunk_type}"));
        }
        _ => {}
    }
    for flag in quality_flags {
        match flag.as_str() {
            "short_chunk" => quality_penalty -= 0.08,
            "near_limit" => quality_penalty -= 0.03,
            "noisy_chunk" => {
                quality_penalty -= 0.45;
                match_reasons.push("quality:noisy".to_string());
            }
            _ => {}
        }
    }
    let score =
        (lexical_score + filename_boost + heading_boost + chunk_type_boost + quality_penalty)
            .max(0.0);
    LocalKnowledgeRankComputation {
        score,
        lexical_score,
        match_reasons,
        score_breakdown: serde_json::json!({
            "lexical_score": lexical_score,
            "filename_boost": filename_boost,
            "heading_boost": heading_boost,
            "chunk_type_boost": chunk_type_boost,
            "quality_penalty": quality_penalty,
        }),
    }
}

/// SQLite `bm25()` returns negative values where more-negative = more relevant.
/// Convert to a 0..1 range where higher = more relevant using sigmoid normalization.
fn normalize_local_bm25_score(raw: f64) -> f64 {
    if !raw.is_finite() {
        return 0.0;
    }
    // raw is negative (e.g. -2.5 for a strong match, -0.1 for a weak one).
    // Flip sign so that higher absolute relevance maps to a higher positive value,
    // then apply sigmoid to map into (0, 1].
    let magnitude = (-raw).max(0.0);
    1.0 - 1.0 / (1.0 + magnitude)
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

    async fn build_test_store() -> KnowledgeStore {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await
            .expect("enable sqlite foreign keys");

        let store = KnowledgeStore::with_pools(pool.clone(), pool);
        store.init().await.expect("init knowledge store");
        store
    }

    async fn insert_test_document(store: &KnowledgeStore, document_id: &str) {
        let now = "2026-04-17T00:00:00Z";
        sqlx::query(
            r#"
            INSERT INTO user_document (
              id,
              user_id,
              media_asset_id,
              filename,
              status,
              chunk_count,
              meta_info,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, 'indexed', 1, '{}', ?, ?);
            "#,
        )
        .bind(document_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(format!("asset-{document_id}"))
        .bind(format!("{document_id}.md"))
        .bind(now)
        .bind(now)
        .execute(&store.write_pool)
        .await
        .expect("insert test document");
    }

    async fn insert_test_chunk(
        store: &KnowledgeStore,
        document_id: &str,
        chunk_id: &str,
        text_content: &str,
    ) {
        let now = "2026-04-17T00:00:00Z";
        let char_count = text_content.chars().count() as i64;
        sqlx::query(
            r#"
            INSERT INTO knowledge_chunk (
              id,
              document_id,
              user_id,
              chunk_index,
              text_content,
              token_count,
              chunk_type,
              section_path,
              page_hint,
              char_start,
              char_end,
              char_count,
              content_hash,
              quality_flags,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, 0, ?, 8, 'paragraph', '["Section"]', NULL, 0, ?, ?, 'hash', '[]', ?, ?);
            "#,
        )
        .bind(chunk_id)
        .bind(document_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(text_content)
        .bind(char_count)
        .bind(char_count)
        .bind(now)
        .bind(now)
        .execute(&store.write_pool)
        .await
        .expect("insert test chunk");
    }

    async fn insert_test_fts_row(
        store: &KnowledgeStore,
        document_id: &str,
        chunk_id: &str,
        text_content: &str,
    ) {
        sqlx::query(&format!(
            r#"
            INSERT INTO {LOCAL_KNOWLEDGE_FTS_TABLE} (
              chunk_id, document_id, text_content, section_path, chunk_type
            )
            VALUES (?, ?, ?, '["Section"]', 'paragraph');
            "#
        ))
        .bind(chunk_id)
        .bind(document_id)
        .bind(text_content)
        .execute(&store.write_pool)
        .await
        .expect("insert test fts row");
    }

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

    #[test]
    fn structure_first_chunking_tracks_section_path_and_chunk_type() {
        let text = r#"
# Desktop Knowledge

## Retrieval

Selected knowledge should use scoped hybrid recall.

- lexical search
- semantic search
"#;

        let chunks = split_local_document_text_into_chunks_structure_first(text);

        assert!(!chunks.is_empty());
        assert_eq!(
            chunks[0].section_path,
            vec!["Desktop Knowledge".to_string(), "Retrieval".to_string()]
        );
        assert_eq!(chunks[0].chunk_type, "mixed");
        assert!(chunks[0].content.contains("Selected knowledge"));
        assert!(chunks[0].content.contains("lexical search"));
    }

    #[test]
    fn structure_first_chunking_splits_large_block_and_keeps_metadata() {
        let large_paragraph = "alpha ".repeat(400);
        let text = format!("# Knowledge\n\n## Chunking\n\n{}", large_paragraph);

        let chunks = split_local_document_text_into_chunks_structure_first(&text);

        assert!(chunks.len() >= 2);
        assert!(chunks.iter().all(
            |chunk| chunk.section_path == vec!["Knowledge".to_string(), "Chunking".to_string()]
        ));
        assert!(chunks.iter().all(|chunk| chunk.char_count > 0));
        assert!(chunks.iter().all(|chunk| !chunk.content_hash.is_empty()));
    }

    #[test]
    fn lexical_score_prefers_heading_matches_and_penalizes_noisy_chunks() {
        let boosted = compute_local_knowledge_match_score(
            "chunking",
            &["chunking".to_string()],
            "knowledge-guide",
            "generic paragraph about alpha beta",
            &["Knowledge".to_string(), "Chunking".to_string()],
            "paragraph",
            &[],
            -1.2,
        );
        let penalized = compute_local_knowledge_match_score(
            "chunking",
            &["chunking".to_string()],
            "notes",
            "generic paragraph about alpha beta chunking",
            &[],
            "paragraph",
            &["noisy_chunk".to_string()],
            -1.2,
        );

        assert!(boosted.score > 0.0);
        assert!(boosted.score > penalized.score);
    }

    #[test]
    fn build_local_knowledge_fts_query_prefers_phrase_and_token_terms() {
        let query = build_local_knowledge_fts_query(
            &["knowledge".to_string(), "chunking".to_string()],
            "desktop knowledge chunking",
        );

        assert!(query.contains("\"desktop knowledge chunking\""));
        assert!(query.contains("\"knowledge\""));
        assert!(query.contains("\"chunking\""));
    }

    #[test]
    fn normalize_local_bm25_score_prefers_more_negative_scores() {
        let strong = normalize_local_bm25_score(-2.5);
        let weak = normalize_local_bm25_score(-0.1);
        let zero = normalize_local_bm25_score(0.0);
        let positive = normalize_local_bm25_score(1.2);

        assert!(strong > weak);
        assert!(weak > zero);
        assert_eq!(zero, 0.0);
        assert_eq!(positive, 0.0);
    }

    #[test]
    fn build_local_knowledge_fts_query_skips_reserved_operators_and_strips_syntax() {
        let query = build_local_knowledge_fts_query(
            &[
                "knowledge".to_string(),
                "and".to_string(),
                "near".to_string(),
                "road*map".to_string(),
                "note^".to_string(),
            ],
            "AND",
        );

        assert_eq!(query, "\"knowledge\" OR \"roadmap\" OR \"note\"");
    }

    #[tokio::test]
    async fn local_knowledge_fts_repair_plan_skips_healthy_index() {
        let store = build_test_store().await;
        insert_test_document(&store, "doc-healthy").await;
        insert_test_chunk(&store, "doc-healthy", "chunk-healthy", "healthy text").await;
        insert_test_fts_row(&store, "doc-healthy", "chunk-healthy", "healthy text").await;

        assert_eq!(
            store
                .local_knowledge_fts_repair_plan()
                .await
                .expect("check healthy fts state"),
            LocalKnowledgeFtsRepairPlan::Healthy
        );
    }

    #[tokio::test]
    async fn local_knowledge_fts_repair_plan_targets_affected_documents() {
        let store = build_test_store().await;
        insert_test_document(&store, "doc-stale").await;
        insert_test_chunk(&store, "doc-stale", "chunk-stale", "fresh text").await;
        insert_test_fts_row(&store, "doc-legacy", "chunk-stale", "stale text").await;

        assert_eq!(
            store
                .local_knowledge_fts_repair_plan()
                .await
                .expect("plan targeted repair"),
            LocalKnowledgeFtsRepairPlan::Documents(vec![
                "doc-legacy".to_string(),
                "doc-stale".to_string(),
            ])
        );
    }

    #[tokio::test]
    async fn init_repairs_missing_local_knowledge_fts_rows() {
        let store = build_test_store().await;
        insert_test_document(&store, "doc-repair").await;
        insert_test_chunk(&store, "doc-repair", "chunk-repair", "repair me").await;

        assert_eq!(
            store
                .local_knowledge_fts_repair_plan()
                .await
                .expect("detect missing fts row"),
            LocalKnowledgeFtsRepairPlan::Documents(vec!["doc-repair".to_string()])
        );

        store.init().await.expect("repair local knowledge fts");

        assert_eq!(
            store
                .local_knowledge_fts_repair_plan()
                .await
                .expect("confirm repaired fts state"),
            LocalKnowledgeFtsRepairPlan::Healthy
        );

        let repaired_row = sqlx::query(&format!(
            r#"
            SELECT document_id, text_content
            FROM {LOCAL_KNOWLEDGE_FTS_TABLE}
            WHERE chunk_id = ?
            LIMIT 1;
            "#
        ))
        .bind("chunk-repair")
        .fetch_one(&store.pool)
        .await
        .expect("fetch repaired fts row");

        assert_eq!(
            repaired_row
                .try_get::<String, _>("document_id")
                .expect("read repaired document id"),
            "doc-repair"
        );
        assert_eq!(
            repaired_row
                .try_get::<String, _>("text_content")
                .expect("read repaired text content"),
            "repair me"
        );
    }
}
