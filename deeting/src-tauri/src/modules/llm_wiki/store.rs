use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::Row;

use crate::modules::conversations::text_utils::truncate_text_chars;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use crate::state::AppState;

use super::types::LocalLlmWikiCorpusStatus;

const INDEX_STATUS_PENDING: &str = "pending";
const INDEX_STATUS_INDEXED: &str = "indexed";
const INDEX_STATUS_FAILED: &str = "failed";
const RUN_STATUS_RUNNING: &str = "running";
const RUN_STATUS_COMPLETED: &str = "completed";
const RUN_KIND_BOOTSTRAP: &str = "bootstrap";
const RUN_KIND_RECONCILE: &str = "reconcile";
const CHANGE_KIND_UPSERT: &str = "upsert";
const CHANGE_KIND_DELETE: &str = "delete";
const SCOPE_MANAGED_WORKSPACE: &str = "managed_workspace";
const SCOPE_LEGACY_VAULT: &str = "legacy_vault";
const MAX_INDEXED_NOTE_BYTES: usize = 256 * 1024;
const CHUNK_ASSET_TYPE: &str = "llm_wiki_chunk";
const CHUNK_SOURCE_TYPE: &str = "llm_wiki_corpus";

#[derive(Debug, Clone)]
pub(crate) struct LlmWikiChunkRow {
    pub chunk_id: String,
    pub chunk_index: i64,
    pub text: String,
    pub token_count: i64,
    pub chunk_hash: String,
}

#[derive(Debug, Clone)]
pub(crate) struct LlmWikiDocumentSnapshot {
    pub doc_id: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub scope: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub content_hash: String,
    pub mtime_unix_ms: i64,
    pub size_bytes: i64,
    pub chunks: Vec<LlmWikiChunkRow>,
}

#[derive(Debug, Clone)]
pub(crate) struct LlmWikiQueryHit {
    pub doc_id: String,
    pub chunk_id: String,
    pub chunk_index: i64,
    pub relative_path: String,
    pub title: String,
    pub scope: String,
    pub snippet: String,
    pub lexical_score: f64,
    pub semantic_score: f64,
    pub final_score: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct CorpusSyncResult {
    pub indexed_files: i64,
    pub removed_files: i64,
    pub changed_doc_ids: Vec<String>,
    pub status: LocalLlmWikiCorpusStatus,
}

#[derive(Debug, Clone)]
struct FilesystemDocumentStub {
    doc_id: String,
    relative_path: String,
    absolute_path: String,
    scope: String,
    mtime_unix_ms: i64,
    size_bytes: i64,
}

#[derive(Debug, Clone)]
struct CatalogRow {
    doc_id: String,
    relative_path: String,
    title: String,
    scope: String,
    mtime_unix_ms: i64,
    size_bytes: i64,
    index_status: String,
    deleted_at: Option<String>,
}

impl CatalogRow {
    fn is_deleted(&self) -> bool {
        self.deleted_at
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
    }
}

pub(crate) async fn init_llm_wiki_tables(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS llm_wiki_document (
          workspace_id TEXT NOT NULL,
          doc_id TEXT PRIMARY KEY,
          relative_path TEXT NOT NULL,
          absolute_path TEXT NOT NULL,
          scope TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          mtime_unix_ms INTEGER NOT NULL DEFAULT 0,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          content_hash TEXT,
          index_status TEXT NOT NULL DEFAULT 'pending',
          last_indexed_at TEXT,
          embedding_version TEXT,
          discovered_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          tombstoned_at TEXT,
          last_error TEXT
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_wiki_document_workspace_relative_path
        ON llm_wiki_document(workspace_id, relative_path);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_llm_wiki_document_workspace_scope_status
        ON llm_wiki_document(workspace_id, scope, index_status);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS llm_wiki_chunk (
          chunk_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          doc_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          text_content TEXT NOT NULL,
          token_count INTEGER NOT NULL DEFAULT 0,
          chunk_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (doc_id) REFERENCES llm_wiki_document(doc_id) ON DELETE CASCADE
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_wiki_chunk_doc_index
        ON llm_wiki_chunk(doc_id, chunk_index);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS llm_wiki_sync_run (
          run_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          run_kind TEXT NOT NULL,
          trigger_source TEXT NOT NULL,
          status TEXT NOT NULL,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          discovered_count INTEGER NOT NULL DEFAULT 0,
          changed_count INTEGER NOT NULL DEFAULT 0,
          deleted_count INTEGER NOT NULL DEFAULT 0,
          projected_count INTEGER NOT NULL DEFAULT 0,
          queued_count INTEGER NOT NULL DEFAULT 0,
          error_json TEXT,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_llm_wiki_sync_run_workspace_created_at
        ON llm_wiki_sync_run(workspace_id, created_at DESC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS llm_wiki_change_queue (
          queue_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          doc_id TEXT,
          relative_path TEXT NOT NULL,
          absolute_path TEXT,
          change_kind TEXT NOT NULL,
          trigger_source TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          queued_at TEXT NOT NULL,
          claimed_at TEXT,
          completed_at TEXT,
          last_error TEXT
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_llm_wiki_change_queue_workspace_completed
        ON llm_wiki_change_queue(workspace_id, completed_at, queued_at DESC);
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS llm_wiki_document_fts
        USING fts5(
          doc_id UNINDEXED,
          workspace_id UNINDEXED,
          relative_path,
          title,
          summary,
          content,
          tokenize = 'unicode61'
        );
        "#,
    )
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(())
}

pub(crate) fn workspace_id_from_path(workspace_path: &Path) -> String {
    workspace_path.to_string_lossy().replace('\\', "/")
}

pub(crate) async fn load_corpus_status(
    store: &McpStore,
    workspace_id: &str,
) -> Result<LocalLlmWikiCorpusStatus, McpError> {
    let normalized_workspace_id = workspace_id.trim();
    if normalized_workspace_id.is_empty() {
        return Ok(LocalLlmWikiCorpusStatus::default());
    }

    let aggregate_row = sqlx::query(
        r#"
        SELECT
          COALESCE(SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS total_docs,
          COALESCE(SUM(CASE WHEN deleted_at IS NULL AND scope = ? THEN 1 ELSE 0 END), 0) AS managed_docs,
          COALESCE(SUM(CASE WHEN deleted_at IS NULL AND scope = ? THEN 1 ELSE 0 END), 0) AS legacy_docs
        FROM llm_wiki_document
        WHERE workspace_id = ?;
        "#,
    )
    .bind(SCOPE_MANAGED_WORKSPACE)
    .bind(SCOPE_LEGACY_VAULT)
    .bind(normalized_workspace_id)
    .fetch_one(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    let latest_run = sqlx::query(
        r#"
        SELECT completed_at
        FROM llm_wiki_sync_run
        WHERE workspace_id = ? AND status = ?
        ORDER BY created_at DESC
        LIMIT 1;
        "#,
    )
    .bind(normalized_workspace_id)
    .bind(RUN_STATUS_COMPLETED)
    .fetch_optional(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(LocalLlmWikiCorpusStatus {
        indexed_note_count: aggregate_row.try_get::<i64, _>("total_docs").unwrap_or(0).max(0),
        managed_workspace_note_count: aggregate_row
            .try_get::<i64, _>("managed_docs")
            .unwrap_or(0)
            .max(0),
        legacy_vault_note_count: aggregate_row
            .try_get::<i64, _>("legacy_docs")
            .unwrap_or(0)
            .max(0),
        pending_note_count: sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(CASE WHEN deleted_at IS NULL AND index_status = ? THEN 1 ELSE 0 END), 0) FROM llm_wiki_document WHERE workspace_id = ?;",
        )
        .bind(INDEX_STATUS_PENDING)
        .bind(normalized_workspace_id)
        .fetch_one(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .max(0),
        failed_note_count: sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(CASE WHEN deleted_at IS NULL AND index_status = ? THEN 1 ELSE 0 END), 0) FROM llm_wiki_document WHERE workspace_id = ?;",
        )
        .bind(INDEX_STATUS_FAILED)
        .bind(normalized_workspace_id)
        .fetch_one(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .max(0),
        queued_change_count: sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM llm_wiki_change_queue WHERE workspace_id = ? AND completed_at IS NULL;",
        )
        .bind(normalized_workspace_id)
        .fetch_one(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .max(0),
        last_synced_at: latest_run
            .as_ref()
            .and_then(|row| row.try_get::<Option<String>, _>("completed_at").ok())
            .flatten(),
    })
}

pub(crate) async fn bootstrap_corpus(
    store: &McpStore,
    vault_root: &Path,
    workspace_path: &Path,
    trigger_source: &str,
) -> Result<CorpusSyncResult, McpError> {
    sync_internal(store, vault_root, workspace_path, trigger_source, RUN_KIND_BOOTSTRAP).await
}

pub(crate) async fn reconcile_corpus(
    store: &McpStore,
    vault_root: &Path,
    workspace_path: &Path,
    trigger_source: &str,
) -> Result<CorpusSyncResult, McpError> {
    sync_internal(store, vault_root, workspace_path, trigger_source, RUN_KIND_RECONCILE).await
}

pub(crate) async fn clear_legacy_projection_assets(app_state: &AppState) -> Result<(), McpError> {
    let assets = app_state
        .memory
        .service
        .list_assets_catalog()
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let legacy_ids = assets
        .into_iter()
        .filter(|asset| {
            asset.get("asset_type").and_then(Value::as_str) == Some("llm_wiki_note")
                && asset.get("source_type").and_then(Value::as_str) == Some("llm_wiki_corpus")
        })
        .filter_map(|asset| {
            asset
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    if legacy_ids.is_empty() {
        return Ok(());
    }
    app_state
        .memory
        .service
        .delete_assets_by_ids(&legacy_ids)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))
}

pub(crate) async fn rebuild_projection_assets(
    app_state: &AppState,
    workspace_id: &str,
    changed_doc_ids: &[String],
) -> Result<i64, McpError> {
    let normalized_workspace_id = workspace_id.trim();
    if normalized_workspace_id.is_empty() || changed_doc_ids.is_empty() {
        return Ok(0);
    }

    let catalog = list_documents(app_state.mcp.store.as_ref(), normalized_workspace_id).await?;
    let changed_ids = changed_doc_ids.iter().cloned().collect::<HashSet<_>>();
    let mut projected = 0_i64;

    for document in catalog
        .into_iter()
        .filter(|document| changed_ids.contains(&document.doc_id))
    {
        app_state
            .memory
            .service
            .delete_assets_by_package(&document.doc_id)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        if document.is_deleted() || document.index_status != INDEX_STATUS_INDEXED {
            continue;
        }

        for chunk in list_chunks_for_document(app_state.mcp.store.as_ref(), &document.doc_id).await? {
            let vector = app_state
                .providers
                .embedding
                .embed_text(&chunk.text)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            app_state
                .memory
                .service
                .upsert_asset(
                    format!("llm_wiki_chunk::{}", chunk.chunk_id),
                    document.title.clone(),
                    truncate_text_chars(&chunk.text, 220),
                    CHUNK_ASSET_TYPE.to_string(),
                    CHUNK_SOURCE_TYPE.to_string(),
                    Some(document.doc_id.clone()),
                    vector,
                    Some(serde_json::json!({
                        "workspace_id": normalized_workspace_id,
                        "doc_id": document.doc_id,
                        "chunk_id": chunk.chunk_id,
                        "chunk_index": chunk.chunk_index,
                        "relative_path": document.relative_path,
                        "scope": document.scope,
                        "title": document.title,
                        "token_count": chunk.token_count,
                    })),
                )
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            projected += 1;
        }
    }

    Ok(projected)
}

pub(crate) async fn search_corpus(
    store: &McpStore,
    app_state: &AppState,
    workspace_id: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<LlmWikiQueryHit>, McpError> {
    let normalized_workspace_id = workspace_id.trim();
    let normalized_query = query.trim();
    if normalized_workspace_id.is_empty() || normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let lexical_query = build_fts_query(normalized_query);
    let mut candidates = HashMap::<String, LlmWikiQueryHit>::new();

    if let Some(fts_query) = lexical_query.as_deref() {
        let rows = sqlx::query(
            r#"
            SELECT
              d.doc_id,
              d.relative_path,
              d.title,
              d.scope,
              c.chunk_id,
              c.chunk_index,
              c.text_content,
              bm25(llm_wiki_document_fts) AS lexical_rank
            FROM llm_wiki_document_fts
            INNER JOIN llm_wiki_document d ON d.doc_id = llm_wiki_document_fts.doc_id
            LEFT JOIN llm_wiki_chunk c ON c.chunk_id = (
              SELECT c2.chunk_id
              FROM llm_wiki_chunk c2
              WHERE c2.doc_id = d.doc_id
              ORDER BY c2.chunk_index ASC
              LIMIT 1
            )
            WHERE llm_wiki_document_fts.workspace_id = ?
              AND llm_wiki_document_fts MATCH ?
              AND d.deleted_at IS NULL
              AND d.index_status = ?
            ORDER BY lexical_rank
            LIMIT ?;
            "#,
        )
        .bind(normalized_workspace_id)
        .bind(fts_query)
        .bind(INDEX_STATUS_INDEXED)
        .bind(limit.clamp(1, 12) as i64)
        .fetch_all(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        for row in rows {
            let chunk_id = row.try_get::<String, _>("chunk_id").unwrap_or_default();
            if chunk_id.trim().is_empty() {
                continue;
            }
            let lexical_rank = row.try_get::<f64, _>("lexical_rank").unwrap_or(0.0).max(0.0);
            let lexical_score = 1.0 / (1.0 + lexical_rank);
            candidates.insert(
                chunk_id.clone(),
                LlmWikiQueryHit {
                    doc_id: row.try_get::<String, _>("doc_id").unwrap_or_default(),
                    chunk_id,
                    chunk_index: row.try_get::<i64, _>("chunk_index").unwrap_or(0).max(0),
                    relative_path: row.try_get::<String, _>("relative_path").unwrap_or_default(),
                    title: row.try_get::<String, _>("title").unwrap_or_default(),
                    scope: row.try_get::<String, _>("scope").unwrap_or_default(),
                    snippet: truncate_text_chars(
                        &row.try_get::<String, _>("text_content").unwrap_or_default(),
                        240,
                    ),
                    lexical_score,
                    semantic_score: 0.0,
                    final_score: lexical_score,
                },
            );
        }
    }

    let vector = app_state
        .providers
        .embedding
        .embed_text(normalized_query)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let semantic_hits = app_state
        .memory
        .service
        .search_assets(vector, limit.clamp(1, 12) * 3, Some(CHUNK_ASSET_TYPE))
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

    for hit in semantic_hits {
        let metadata = hit.get("metadata");
        let hit_workspace = metadata
            .and_then(|value| value.get("workspace_id"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if hit_workspace != normalized_workspace_id {
            continue;
        }
        let Some(chunk_id) = metadata
            .and_then(|value| value.get("chunk_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
        else {
            continue;
        };
        let semantic_score = hit
            .get("_distance")
            .and_then(Value::as_f64)
            .map(|distance| 1.0 / (1.0 + distance.max(0.0)))
            .unwrap_or(0.0);

        if let Some(existing) = candidates.get_mut(&chunk_id) {
            existing.semantic_score = semantic_score;
            existing.final_score = existing.lexical_score + existing.semantic_score;
            continue;
        }

        if let Some(candidate) = load_query_hit_for_chunk(store, &chunk_id).await? {
            candidates.insert(
                chunk_id,
                LlmWikiQueryHit {
                    semantic_score,
                    final_score: semantic_score,
                    ..candidate
                },
            );
        }
    }

    let mut results = candidates.into_values().collect::<Vec<_>>();
    results.sort_by(|left, right| {
        right
            .final_score
            .partial_cmp(&left.final_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
            .then_with(|| left.chunk_index.cmp(&right.chunk_index))
    });
    results.truncate(limit.clamp(1, 12));
    Ok(results)
}

pub(crate) async fn list_preview_hits(
    store: &McpStore,
    workspace_id: &str,
    limit: usize,
) -> Result<Vec<LlmWikiQueryHit>, McpError> {
    let normalized_workspace_id = workspace_id.trim();
    if normalized_workspace_id.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query(
        r#"
        SELECT
          d.doc_id,
          d.relative_path,
          d.title,
          d.scope,
          c.chunk_id,
          c.chunk_index,
          c.text_content
        FROM llm_wiki_document d
        LEFT JOIN llm_wiki_chunk c ON c.chunk_id = (
          SELECT c2.chunk_id
          FROM llm_wiki_chunk c2
          WHERE c2.doc_id = d.doc_id
          ORDER BY c2.chunk_index ASC
          LIMIT 1
        )
        WHERE d.workspace_id = ?
          AND d.deleted_at IS NULL
          AND d.index_status = ?
        ORDER BY CASE d.scope WHEN ? THEN 0 ELSE 1 END ASC, d.updated_at DESC
        LIMIT ?;
        "#,
    )
    .bind(normalized_workspace_id)
    .bind(INDEX_STATUS_INDEXED)
    .bind(SCOPE_MANAGED_WORKSPACE)
    .bind(limit.clamp(1, 12) as i64)
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let chunk_id = row.try_get::<String, _>("chunk_id").unwrap_or_default();
            if chunk_id.trim().is_empty() {
                return None;
            }
            Some(LlmWikiQueryHit {
                doc_id: row.try_get::<String, _>("doc_id").unwrap_or_default(),
                chunk_id,
                chunk_index: row.try_get::<i64, _>("chunk_index").unwrap_or(0).max(0),
                relative_path: row.try_get::<String, _>("relative_path").unwrap_or_default(),
                title: row.try_get::<String, _>("title").unwrap_or_default(),
                scope: row.try_get::<String, _>("scope").unwrap_or_default(),
                snippet: truncate_text_chars(
                    &row.try_get::<String, _>("text_content").unwrap_or_default(),
                    180,
                ),
                lexical_score: 0.0,
                semantic_score: 0.0,
                final_score: 0.0,
            })
        })
        .collect())
}

async fn sync_internal(
    store: &McpStore,
    vault_root: &Path,
    workspace_path: &Path,
    trigger_source: &str,
    run_kind: &str,
) -> Result<CorpusSyncResult, McpError> {
    let workspace_id = workspace_id_from_path(workspace_path);
    let now = mcp_storage::helpers::now_rfc3339()?;
    let run_id = uuid::Uuid::new_v4().to_string();
    let started_at = std::time::Instant::now();
    let normalized_trigger = normalize_non_empty(trigger_source, "manual_sync");

    sqlx::query(
        r#"
        INSERT INTO llm_wiki_sync_run (
          run_id, workspace_id, run_kind, trigger_source, status,
          duration_ms, discovered_count, changed_count, deleted_count,
          projected_count, queued_count, error_json, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, NULL, ?, NULL);
        "#,
    )
    .bind(&run_id)
    .bind(&workspace_id)
    .bind(run_kind)
    .bind(normalized_trigger)
    .bind(RUN_STATUS_RUNNING)
    .bind(&now)
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    let discovered = collect_filesystem_documents(vault_root, workspace_path)
        .map_err(McpError::Storage)?;
    let existing = list_documents(store, &workspace_id).await?;
    let existing_by_path = existing
        .iter()
        .map(|row| (row.relative_path.clone(), row.clone()))
        .collect::<HashMap<_, _>>();
    let current_paths = discovered
        .iter()
        .map(|row| row.relative_path.clone())
        .collect::<HashSet<_>>();

    let mut indexed_files = 0_i64;
    let mut removed_files = 0_i64;
    let mut failed_files = 0_i64;
    let mut changed_doc_ids = Vec::new();

    for stub in &discovered {
        let existing_row = existing_by_path.get(&stub.relative_path);
        let unchanged = existing_row
            .map(|row| {
                !row.is_deleted()
                    && row.mtime_unix_ms == stub.mtime_unix_ms
                    && row.size_bytes == stub.size_bytes
                    && row.index_status == INDEX_STATUS_INDEXED
            })
            .unwrap_or(false);
        if unchanged {
            continue;
        }

        match build_document_snapshot(stub) {
            Ok(snapshot) => {
                upsert_document_snapshot(store, &workspace_id, &snapshot, &now).await?;
                enqueue_change(
                    store,
                    &workspace_id,
                    Some(snapshot.doc_id.as_str()),
                    snapshot.relative_path.as_str(),
                    Some(snapshot.absolute_path.as_str()),
                    CHANGE_KIND_UPSERT,
                    normalized_trigger,
                    &now,
                )
                .await?;
                indexed_files += 1;
                changed_doc_ids.push(snapshot.doc_id);
            }
            Err(error) => {
                mark_document_failed(store, &workspace_id, stub, &error.to_string(), &now).await?;
                failed_files += 1;
                changed_doc_ids.push(stub.doc_id.clone());
            }
        }
    }

    for stale in existing
        .iter()
        .filter(|row| !row.is_deleted() && !current_paths.contains(&row.relative_path))
    {
        tombstone_document(store, &workspace_id, stale, normalized_trigger, &now).await?;
        removed_files += 1;
        changed_doc_ids.push(stale.doc_id.clone());
    }

    let changed_doc_ids = changed_doc_ids
        .into_iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let queued_count = changed_doc_ids.len() as i64;
    let duration_ms = i64::try_from(started_at.elapsed().as_millis()).unwrap_or(i64::MAX);

    sqlx::query(
        r#"
        UPDATE llm_wiki_sync_run
        SET status = ?,
            duration_ms = ?,
            discovered_count = ?,
            changed_count = ?,
            deleted_count = ?,
            queued_count = ?,
            completed_at = ?
        WHERE run_id = ?;
        "#,
    )
    .bind(RUN_STATUS_COMPLETED)
    .bind(duration_ms)
    .bind(discovered.len() as i64)
    .bind(indexed_files + failed_files)
    .bind(removed_files)
    .bind(queued_count)
    .bind(&now)
    .bind(&run_id)
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    let status = load_corpus_status(store, &workspace_id).await?;
    let _ = failed_files;
    Ok(CorpusSyncResult {
        indexed_files,
        removed_files,
        changed_doc_ids,
        status,
    })
}

async fn list_documents(store: &McpStore, workspace_id: &str) -> Result<Vec<CatalogRow>, McpError> {
    let rows = sqlx::query(
        r#"
        SELECT doc_id, relative_path, title, scope, mtime_unix_ms, size_bytes, index_status, deleted_at
        FROM llm_wiki_document
        WHERE workspace_id = ?;
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| CatalogRow {
            doc_id: row.try_get::<String, _>("doc_id").unwrap_or_default(),
            relative_path: row.try_get::<String, _>("relative_path").unwrap_or_default(),
            title: row.try_get::<String, _>("title").unwrap_or_default(),
            scope: row.try_get::<String, _>("scope").unwrap_or_default(),
            mtime_unix_ms: row.try_get::<i64, _>("mtime_unix_ms").unwrap_or(0),
            size_bytes: row.try_get::<i64, _>("size_bytes").unwrap_or(0),
            index_status: row.try_get::<String, _>("index_status").unwrap_or_default(),
            deleted_at: row.try_get::<Option<String>, _>("deleted_at").ok().flatten(),
        })
        .collect())
}

async fn list_chunks_for_document(
    store: &McpStore,
    doc_id: &str,
) -> Result<Vec<LlmWikiChunkRow>, McpError> {
    let rows = sqlx::query(
        r#"
        SELECT chunk_id, doc_id, chunk_index, text_content, token_count, chunk_hash
        FROM llm_wiki_chunk
        WHERE doc_id = ?
        ORDER BY chunk_index ASC;
        "#,
    )
    .bind(doc_id)
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(rows
        .into_iter()
        .map(|row| LlmWikiChunkRow {
            chunk_id: row.try_get::<String, _>("chunk_id").unwrap_or_default(),
            chunk_index: row.try_get::<i64, _>("chunk_index").unwrap_or(0).max(0),
            text: row.try_get::<String, _>("text_content").unwrap_or_default(),
            token_count: row.try_get::<i64, _>("token_count").unwrap_or(0).max(0),
            chunk_hash: row.try_get::<String, _>("chunk_hash").unwrap_or_default(),
        })
        .collect())
}

async fn load_query_hit_for_chunk(
    store: &McpStore,
    chunk_id: &str,
) -> Result<Option<LlmWikiQueryHit>, McpError> {
    let row = sqlx::query(
        r#"
        SELECT
          d.doc_id,
          d.relative_path,
          d.title,
          d.scope,
          c.chunk_id,
          c.chunk_index,
          c.text_content
        FROM llm_wiki_chunk c
        INNER JOIN llm_wiki_document d ON d.doc_id = c.doc_id
        WHERE c.chunk_id = ?
          AND d.deleted_at IS NULL
          AND d.index_status = ?
        LIMIT 1;
        "#,
    )
    .bind(chunk_id)
    .bind(INDEX_STATUS_INDEXED)
    .fetch_optional(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(row.map(|row| LlmWikiQueryHit {
        doc_id: row.try_get::<String, _>("doc_id").unwrap_or_default(),
        chunk_id: row.try_get::<String, _>("chunk_id").unwrap_or_default(),
        chunk_index: row.try_get::<i64, _>("chunk_index").unwrap_or(0).max(0),
        relative_path: row.try_get::<String, _>("relative_path").unwrap_or_default(),
        title: row.try_get::<String, _>("title").unwrap_or_default(),
        scope: row.try_get::<String, _>("scope").unwrap_or_default(),
        snippet: truncate_text_chars(
            &row.try_get::<String, _>("text_content").unwrap_or_default(),
            240,
        ),
        lexical_score: 0.0,
        semantic_score: 0.0,
        final_score: 0.0,
    }))
}

async fn upsert_document_snapshot(
    store: &McpStore,
    workspace_id: &str,
    snapshot: &LlmWikiDocumentSnapshot,
    now: &str,
) -> Result<(), McpError> {
    let mut tx = store.begin_write().await?;

    sqlx::query(
        r#"
        INSERT INTO llm_wiki_document (
          workspace_id, doc_id, relative_path, absolute_path, scope, title, summary,
          mtime_unix_ms, size_bytes, content_hash, index_status, last_indexed_at,
          embedding_version, discovered_at, updated_at, deleted_at, tombstoned_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
        ON CONFLICT(doc_id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          relative_path = excluded.relative_path,
          absolute_path = excluded.absolute_path,
          scope = excluded.scope,
          title = excluded.title,
          summary = excluded.summary,
          mtime_unix_ms = excluded.mtime_unix_ms,
          size_bytes = excluded.size_bytes,
          content_hash = excluded.content_hash,
          index_status = excluded.index_status,
          last_indexed_at = excluded.last_indexed_at,
          embedding_version = excluded.embedding_version,
          updated_at = excluded.updated_at,
          deleted_at = NULL,
          tombstoned_at = NULL,
          last_error = NULL;
        "#,
    )
    .bind(workspace_id)
    .bind(&snapshot.doc_id)
    .bind(&snapshot.relative_path)
    .bind(&snapshot.absolute_path)
    .bind(&snapshot.scope)
    .bind(&snapshot.title)
    .bind(&snapshot.summary)
    .bind(snapshot.mtime_unix_ms)
    .bind(snapshot.size_bytes)
    .bind(&snapshot.content_hash)
    .bind(INDEX_STATUS_INDEXED)
    .bind(now)
    .bind("llm_wiki.v1")
    .bind(now)
    .bind(now)
    .execute(tx.as_mut())
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query("DELETE FROM llm_wiki_chunk WHERE doc_id = ?;")
        .bind(&snapshot.doc_id)
        .execute(tx.as_mut())
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

    for chunk in &snapshot.chunks {
        sqlx::query(
            r#"
            INSERT INTO llm_wiki_chunk (
              chunk_id, workspace_id, doc_id, chunk_index, text_content, token_count, chunk_hash, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&chunk.chunk_id)
        .bind(workspace_id)
        .bind(&snapshot.doc_id)
        .bind(chunk.chunk_index)
        .bind(&chunk.text)
        .bind(chunk.token_count)
        .bind(&chunk.chunk_hash)
        .bind(now)
        .bind(now)
        .execute(tx.as_mut())
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    }

    sqlx::query("DELETE FROM llm_wiki_document_fts WHERE doc_id = ?;")
        .bind(&snapshot.doc_id)
        .execute(tx.as_mut())
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    sqlx::query(
        r#"
        INSERT INTO llm_wiki_document_fts (doc_id, workspace_id, relative_path, title, summary, content)
        VALUES (?, ?, ?, ?, ?, ?);
        "#,
    )
    .bind(&snapshot.doc_id)
    .bind(workspace_id)
    .bind(&snapshot.relative_path)
    .bind(&snapshot.title)
    .bind(&snapshot.summary)
    .bind(&snapshot.content)
    .execute(tx.as_mut())
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    tx.commit()
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(())
}

async fn mark_document_failed(
    store: &McpStore,
    workspace_id: &str,
    stub: &FilesystemDocumentStub,
    error: &str,
    now: &str,
) -> Result<(), McpError> {
    let title = PathBuf::from(&stub.absolute_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled Note")
        .to_string();
    let mut tx = store.begin_write().await?;

    sqlx::query(
        r#"
        INSERT INTO llm_wiki_document (
          workspace_id, doc_id, relative_path, absolute_path, scope, title, summary,
          mtime_unix_ms, size_bytes, content_hash, index_status, last_indexed_at,
          embedding_version, discovered_at, updated_at, deleted_at, tombstoned_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, NULL, ?, NULL, NULL, ?, ?, NULL, NULL, ?)
        ON CONFLICT(doc_id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          relative_path = excluded.relative_path,
          absolute_path = excluded.absolute_path,
          scope = excluded.scope,
          title = excluded.title,
          mtime_unix_ms = excluded.mtime_unix_ms,
          size_bytes = excluded.size_bytes,
          index_status = excluded.index_status,
          updated_at = excluded.updated_at,
          deleted_at = NULL,
          tombstoned_at = NULL,
          last_error = excluded.last_error;
        "#,
    )
    .bind(workspace_id)
    .bind(&stub.doc_id)
    .bind(&stub.relative_path)
    .bind(&stub.absolute_path)
    .bind(&stub.scope)
    .bind(title)
    .bind(stub.mtime_unix_ms)
    .bind(stub.size_bytes)
    .bind(INDEX_STATUS_FAILED)
    .bind(now)
    .bind(now)
    .bind(truncate_text_chars(error, 300))
    .execute(tx.as_mut())
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query("DELETE FROM llm_wiki_chunk WHERE doc_id = ?;")
        .bind(&stub.doc_id)
        .execute(tx.as_mut())
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    sqlx::query("DELETE FROM llm_wiki_document_fts WHERE doc_id = ?;")
        .bind(&stub.doc_id)
        .execute(tx.as_mut())
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

    tx.commit()
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(())
}

async fn tombstone_document(
    store: &McpStore,
    workspace_id: &str,
    document: &CatalogRow,
    trigger_source: &str,
    now: &str,
) -> Result<(), McpError> {
    let mut tx = store.begin_write().await?;

    sqlx::query(
        r#"
        UPDATE llm_wiki_document
        SET index_status = ?, deleted_at = ?, tombstoned_at = ?, updated_at = ?
        WHERE doc_id = ?;
        "#,
    )
    .bind(INDEX_STATUS_FAILED)
    .bind(now)
    .bind(now)
    .bind(now)
    .bind(&document.doc_id)
    .execute(tx.as_mut())
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query("DELETE FROM llm_wiki_chunk WHERE doc_id = ?;")
        .bind(&document.doc_id)
        .execute(tx.as_mut())
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    sqlx::query("DELETE FROM llm_wiki_document_fts WHERE doc_id = ?;")
        .bind(&document.doc_id)
        .execute(tx.as_mut())
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

    tx.commit()
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

    enqueue_change(
        store,
        workspace_id,
        Some(document.doc_id.as_str()),
        document.relative_path.as_str(),
        None,
        CHANGE_KIND_DELETE,
        trigger_source,
        now,
    )
    .await
}

async fn enqueue_change(
    store: &McpStore,
    workspace_id: &str,
    doc_id: Option<&str>,
    relative_path: &str,
    absolute_path: Option<&str>,
    change_kind: &str,
    trigger_source: &str,
    now: &str,
) -> Result<(), McpError> {
    sqlx::query(
        r#"
        INSERT INTO llm_wiki_change_queue (
          queue_id, workspace_id, doc_id, relative_path, absolute_path,
          change_kind, trigger_source, attempt_count, queued_at, claimed_at, completed_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL);
        "#,
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(workspace_id)
    .bind(doc_id)
    .bind(relative_path)
    .bind(absolute_path)
    .bind(change_kind)
    .bind(trigger_source)
    .bind(now)
    .execute(&store.write_pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(())
}

fn collect_filesystem_documents(
    vault_root: &Path,
    workspace_path: &Path,
) -> Result<Vec<FilesystemDocumentStub>, String> {
    let mut stubs = Vec::new();
    let mut stack = vec![vault_root.to_path_buf()];

    while let Some(current_dir) = stack.pop() {
        let entries = std::fs::read_dir(&current_dir)
            .map_err(|err| format!("failed to read {}: {}", current_dir.display(), err))?;
        for entry in entries {
            let entry = entry
                .map_err(|err| format!("failed to inspect {}: {}", current_dir.display(), err))?;
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            let lower_name = file_name.to_ascii_lowercase();
            let file_type = entry
                .file_type()
                .map_err(|err| format!("failed to inspect {}: {}", path.display(), err))?;

            if file_type.is_dir() {
                if matches!(lower_name.as_str(), ".git" | ".trash" | "node_modules" | ".next") {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| !value.eq_ignore_ascii_case("md"))
                .unwrap_or(true)
            {
                continue;
            }

            let metadata = std::fs::metadata(&path)
                .map_err(|err| format!("failed to inspect {}: {}", path.display(), err))?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|value| i64::try_from(value.as_millis()).unwrap_or(i64::MAX))
                .unwrap_or(0);
            let size_bytes = i64::try_from(metadata.len()).unwrap_or(i64::MAX);
            let relative_path = path
                .strip_prefix(vault_root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let scope = if path.starts_with(workspace_path) {
                SCOPE_MANAGED_WORKSPACE
            } else {
                SCOPE_LEGACY_VAULT
            };
            stubs.push(FilesystemDocumentStub {
                doc_id: format!("llm_wiki_doc::{}", hash_text(&relative_path)),
                relative_path,
                absolute_path: path.to_string_lossy().to_string(),
                scope: scope.to_string(),
                mtime_unix_ms: modified,
                size_bytes,
            });
        }
    }

    stubs.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(stubs)
}

fn build_document_snapshot(
    stub: &FilesystemDocumentStub,
) -> Result<LlmWikiDocumentSnapshot, McpError> {
    let raw = std::fs::read_to_string(&stub.absolute_path)
        .map_err(|err| McpError::Storage(format!("failed to read {}: {}", stub.absolute_path, err)))?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(McpError::Storage(format!(
            "llm wiki corpus file is empty: {}",
            stub.relative_path
        )));
    }

    let content = truncate_to_byte_limit(trimmed, MAX_INDEXED_NOTE_BYTES).to_string();
    let title = PathBuf::from(&stub.absolute_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled Note")
        .to_string();
    let summary = summarize_markdown(&content);
    let content_hash = hash_text(&content);
    let chunks = split_text_into_chunks(&content)
        .into_iter()
        .enumerate()
        .map(|(index, chunk)| LlmWikiChunkRow {
            chunk_id: format!("{}::{}", stub.doc_id, index),
            chunk_index: index as i64,
            token_count: estimate_tokens(&chunk),
            chunk_hash: hash_text(&chunk),
            text: chunk,
        })
        .collect::<Vec<_>>();

    Ok(LlmWikiDocumentSnapshot {
        doc_id: stub.doc_id.clone(),
        relative_path: stub.relative_path.clone(),
        absolute_path: stub.absolute_path.clone(),
        scope: stub.scope.clone(),
        title,
        summary,
        content,
        content_hash,
        mtime_unix_ms: stub.mtime_unix_ms,
        size_bytes: stub.size_bytes,
        chunks,
    })
}

fn build_fts_query(query: &str) -> Option<String> {
    let tokens = query
        .split(|ch: char| !(ch.is_alphanumeric() || ch == '_' || ch == '-'))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" OR "))
    }
}

fn split_text_into_chunks(text: &str) -> Vec<String> {
    const MAX_CHARS: usize = 1200;
    const OVERLAP_CHARS: usize = 120;

    let normalized = text.trim();
    if normalized.is_empty() {
        return Vec::new();
    }

    let chars: Vec<char> = normalized.chars().collect();
    if chars.len() <= MAX_CHARS {
        return vec![normalized.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let mut end = (start + MAX_CHARS).min(chars.len());
        if end < chars.len() {
            let scan_floor = start + (MAX_CHARS / 2);
            let mut cursor = end;
            while cursor > scan_floor {
                let current = chars[cursor - 1];
                if current.is_whitespace() || matches!(current, '.' | '!' | '?' | ',' | ';' | '\n') {
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
        let next_start = end.saturating_sub(OVERLAP_CHARS);
        start = if next_start == start { end } else { next_start };
    }

    chunks
}

fn summarize_markdown(content: &str) -> String {
    let single_line = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(4)
        .collect::<Vec<_>>()
        .join(" ");
    truncate_text_chars(&single_line, 220)
}

fn truncate_to_byte_limit(content: &str, max_bytes: usize) -> &str {
    if content.len() <= max_bytes {
        return content;
    }

    let mut end = max_bytes;
    while end > 0 && !content.is_char_boundary(end) {
        end -= 1;
    }
    &content[..end]
}

fn estimate_tokens(text: &str) -> i64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    ((trimmed.chars().count() as f64) / 4.0).ceil() as i64
}

fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn normalize_non_empty<'a>(raw: &'a str, fallback: &'a str) -> &'a str {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    }
}
