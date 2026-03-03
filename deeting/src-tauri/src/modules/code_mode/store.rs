use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;

use crate::modules::code_mode::error::CodeModeError;
use crate::modules::code_mode::types::{
    CodeModeExecutionDetail, CodeModeExecutionItem, CodeModeExecutionPage, CodeModeSyncPayloadItem,
    RuntimeToolCallsEnvelope,
};

#[derive(Clone)]
pub struct CodeModeExecutionStore {
    pool: SqlitePool,
}

impl CodeModeExecutionStore {
    pub async fn new(database_url: &str) -> Result<Self, CodeModeError> {
        let options = SqliteConnectOptions::from_str(database_url)
            .map_err(|err| CodeModeError::Storage(err.to_string()))?
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        let store = Self { pool };
        store.init().await?;
        Ok(store)
    }

    async fn init(&self) -> Result<(), CodeModeError> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS code_mode_executions (
              id TEXT PRIMARY KEY,
              execution_id TEXT NOT NULL UNIQUE,
              user_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              trace_id TEXT,
              language TEXT NOT NULL,
              status TEXT NOT NULL,
              format_version TEXT,
              runtime_protocol_version TEXT,
              runtime_context_json TEXT NOT NULL,
              tool_plan_results_json TEXT NOT NULL,
              runtime_tool_calls_json TEXT NOT NULL,
              render_blocks_json TEXT NOT NULL,
              error TEXT,
              error_code TEXT,
              duration_ms INTEGER NOT NULL,
              request_meta_json TEXT NOT NULL,
              created_at TEXT
            )
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_code_mode_exec_created_at ON code_mode_executions(created_at DESC)",
        )
        .execute(&self.pool)
        .await
        .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_code_mode_exec_status_session ON code_mode_executions(status, session_id)",
        )
        .execute(&self.pool)
        .await
        .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        self.ensure_column(
            "code_mode_executions",
            "code",
            "ALTER TABLE code_mode_executions ADD COLUMN code TEXT",
        )
        .await?;
        self.ensure_column(
            "code_mode_executions",
            "sync_status",
            "ALTER TABLE code_mode_executions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending'",
        )
        .await?;
        self.ensure_column(
            "code_mode_executions",
            "sync_attempts",
            "ALTER TABLE code_mode_executions ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0",
        )
        .await?;
        self.ensure_column(
            "code_mode_executions",
            "last_sync_error",
            "ALTER TABLE code_mode_executions ADD COLUMN last_sync_error TEXT",
        )
        .await?;
        self.ensure_column(
            "code_mode_executions",
            "last_synced_at",
            "ALTER TABLE code_mode_executions ADD COLUMN last_synced_at TEXT",
        )
        .await?;
        self.ensure_column(
            "code_mode_executions",
            "cloud_id",
            "ALTER TABLE code_mode_executions ADD COLUMN cloud_id TEXT",
        )
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_code_mode_exec_sync_status ON code_mode_executions(sync_status, created_at)",
        )
        .execute(&self.pool)
        .await
        .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE code_mode_executions
            SET code = json_extract(runtime_context_json, '$.code')
            WHERE (code IS NULL OR code = '')
              AND json_extract(runtime_context_json, '$.code') IS NOT NULL
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE code_mode_executions
            SET sync_status = 'pending'
            WHERE sync_status IS NULL OR trim(sync_status) = ''
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn insert(&self, record: CodeModeExecutionDetail) -> Result<(), CodeModeError> {
        let code = record
            .runtime_context
            .get("code")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let runtime_context_json = serde_json::to_string(&record.runtime_context)
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        let tool_plan_results_json = serde_json::to_string(&record.tool_plan_results)
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        let runtime_tool_calls_json = serde_json::to_string(&record.runtime_tool_calls)
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        let render_blocks_json = serde_json::to_string(&record.render_blocks)
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        let request_meta_json = serde_json::to_string(&record.request_meta)
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            INSERT INTO code_mode_executions (
              id, execution_id, user_id, session_id, trace_id, language, status,
              format_version, runtime_protocol_version, runtime_context_json,
              tool_plan_results_json, runtime_tool_calls_json, render_blocks_json,
              error, error_code, duration_ms, request_meta_json, created_at,
              code, sync_status, sync_attempts, last_sync_error, last_synced_at, cloud_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL)
            "#,
        )
        .bind(record.id)
        .bind(record.execution_id)
        .bind(record.user_id)
        .bind(record.session_id)
        .bind(record.trace_id)
        .bind(record.language)
        .bind(record.status)
        .bind(record.format_version)
        .bind(record.runtime_protocol_version)
        .bind(runtime_context_json)
        .bind(tool_plan_results_json)
        .bind(runtime_tool_calls_json)
        .bind(render_blocks_json)
        .bind(record.error)
        .bind(record.error_code)
        .bind(record.duration_ms)
        .bind(request_meta_json)
        .bind(record.created_at)
        .bind(code)
        .execute(&self.pool)
        .await
        .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn list(
        &self,
        size: usize,
        status: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<CodeModeExecutionPage, CodeModeError> {
        let mut sql = String::from(
            "SELECT id, execution_id, session_id, language, status, error, error_code, duration_ms, runtime_tool_calls_json, created_at FROM code_mode_executions WHERE 1=1",
        );
        if status.is_some() {
            sql.push_str(" AND status = ?");
        }
        if session_id.is_some() {
            sql.push_str(" AND session_id = ?");
        }
        sql.push_str(" ORDER BY datetime(created_at) DESC, rowid DESC LIMIT ?");

        let mut query = sqlx::query(&sql);
        if let Some(expected_status) = status {
            query = query.bind(expected_status.trim());
        }
        if let Some(expected_session_id) = session_id {
            query = query.bind(expected_session_id.trim());
        }
        query = query.bind(size as i64);

        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let calls_json: String = row
                .try_get("runtime_tool_calls_json")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?;
            let tool_calls: RuntimeToolCallsEnvelope = serde_json::from_str(&calls_json)
                .unwrap_or_else(|_| RuntimeToolCallsEnvelope::default());
            items.push(CodeModeExecutionItem {
                id: row
                    .try_get("id")
                    .map_err(|err| CodeModeError::Storage(err.to_string()))?,
                execution_id: row
                    .try_get("execution_id")
                    .map_err(|err| CodeModeError::Storage(err.to_string()))?,
                session_id: row
                    .try_get("session_id")
                    .map_err(|err| CodeModeError::Storage(err.to_string()))?,
                language: row
                    .try_get("language")
                    .map_err(|err| CodeModeError::Storage(err.to_string()))?,
                status: row
                    .try_get("status")
                    .map_err(|err| CodeModeError::Storage(err.to_string()))?,
                error: row
                    .try_get("error")
                    .map_err(|err| CodeModeError::Storage(err.to_string()))?,
                error_code: row
                    .try_get("error_code")
                    .map_err(|err| CodeModeError::Storage(err.to_string()))?,
                duration_ms: row
                    .try_get("duration_ms")
                    .map_err(|err| CodeModeError::Storage(err.to_string()))?,
                tool_call_count: tool_calls.calls.len() as i64,
                created_at: row
                    .try_get("created_at")
                    .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            });
        }

        Ok(CodeModeExecutionPage {
            items,
            next_page: None,
            previous_page: None,
        })
    }

    pub async fn get_by_identifier(
        &self,
        identifier: &str,
    ) -> Result<Option<CodeModeExecutionDetail>, CodeModeError> {
        let normalized = identifier.trim();
        if normalized.is_empty() {
            return Ok(None);
        }
        let row = sqlx::query(
            r#"
            SELECT id, execution_id, user_id, session_id, trace_id, language, status,
                   format_version, runtime_protocol_version, runtime_context_json,
                   tool_plan_results_json, runtime_tool_calls_json, render_blocks_json,
                   error, error_code, duration_ms, request_meta_json, created_at
            FROM code_mode_executions
            WHERE id = ? OR execution_id = ?
            ORDER BY datetime(created_at) DESC, rowid DESC
            LIMIT 1
            "#,
        )
        .bind(normalized)
        .bind(normalized)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        let Some(row) = row else {
            return Ok(None);
        };

        Ok(Some(self.row_to_execution_detail(&row)?))
    }

    pub async fn list_pending_sync(
        &self,
        limit: usize,
    ) -> Result<Vec<CodeModeSyncPayloadItem>, CodeModeError> {
        let rows = sqlx::query(
            r#"
            SELECT id, execution_id, user_id, session_id, trace_id, language, status,
                   format_version, runtime_protocol_version, runtime_context_json,
                   tool_plan_results_json, runtime_tool_calls_json, render_blocks_json,
                   error, error_code, duration_ms, request_meta_json, created_at, code
            FROM code_mode_executions
            WHERE COALESCE(sync_status, 'pending') <> 'synced'
            ORDER BY datetime(created_at) ASC, rowid ASC
            LIMIT ?
            "#,
        )
        .bind(limit.max(1) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let detail = self.row_to_execution_detail(&row)?;
            let mut code = row
                .try_get::<Option<String>, _>("code")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?
                .unwrap_or_default();
            if code.trim().is_empty() {
                code = detail
                    .runtime_context
                    .get("code")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string();
            }
            items.push(CodeModeSyncPayloadItem {
                execution_id: detail.execution_id,
                session_id: detail.session_id,
                trace_id: detail.trace_id,
                language: detail.language,
                status: detail.status,
                format_version: detail.format_version,
                runtime_protocol_version: detail.runtime_protocol_version,
                code,
                runtime_context: detail.runtime_context,
                tool_plan_results: detail.tool_plan_results,
                runtime_tool_calls: detail.runtime_tool_calls,
                render_blocks: detail.render_blocks,
                error: detail.error,
                error_code: detail.error_code,
                duration_ms: detail.duration_ms,
                request_meta: detail.request_meta,
                created_at: detail.created_at,
            });
        }

        Ok(items)
    }

    pub async fn mark_sync_success_by_execution_id(
        &self,
        execution_id: &str,
        cloud_id: Option<&str>,
        synced_at: &str,
    ) -> Result<(), CodeModeError> {
        sqlx::query(
            r#"
            UPDATE code_mode_executions
            SET sync_status = 'synced',
                sync_attempts = COALESCE(sync_attempts, 0) + 1,
                last_sync_error = NULL,
                last_synced_at = ?,
                cloud_id = COALESCE(?, cloud_id)
            WHERE execution_id = ?
            "#,
        )
        .bind(synced_at)
        .bind(cloud_id)
        .bind(execution_id.trim())
        .execute(&self.pool)
        .await
        .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn mark_sync_failed_by_execution_id(
        &self,
        execution_id: &str,
        error_message: &str,
    ) -> Result<(), CodeModeError> {
        let message = if error_message.chars().count() > 1000 {
            error_message.chars().take(1000).collect::<String>()
        } else {
            error_message.to_string()
        };
        sqlx::query(
            r#"
            UPDATE code_mode_executions
            SET sync_status = 'failed',
                sync_attempts = COALESCE(sync_attempts, 0) + 1,
                last_sync_error = ?
            WHERE execution_id = ?
            "#,
        )
        .bind(message)
        .bind(execution_id.trim())
        .execute(&self.pool)
        .await
        .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        Ok(())
    }

    fn row_to_execution_detail(
        &self,
        row: &SqliteRow,
    ) -> Result<CodeModeExecutionDetail, CodeModeError> {
        let runtime_context_json: String = row
            .try_get("runtime_context_json")
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        let tool_plan_results_json: String = row
            .try_get("tool_plan_results_json")
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        let runtime_tool_calls_json: String = row
            .try_get("runtime_tool_calls_json")
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        let render_blocks_json: String = row
            .try_get("render_blocks_json")
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        let request_meta_json: String = row
            .try_get("request_meta_json")
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;

        Ok(CodeModeExecutionDetail {
            id: row
                .try_get("id")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            execution_id: row
                .try_get("execution_id")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            user_id: row
                .try_get("user_id")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            session_id: row
                .try_get("session_id")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            trace_id: row
                .try_get("trace_id")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            language: row
                .try_get("language")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            status: row
                .try_get("status")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            format_version: row
                .try_get("format_version")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            runtime_protocol_version: row
                .try_get("runtime_protocol_version")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            runtime_context: serde_json::from_str(&runtime_context_json)
                .unwrap_or_else(|_| serde_json::json!({})),
            tool_plan_results: serde_json::from_str(&tool_plan_results_json)
                .unwrap_or_else(|_| serde_json::json!({})),
            runtime_tool_calls: serde_json::from_str(&runtime_tool_calls_json)
                .unwrap_or_else(|_| RuntimeToolCallsEnvelope::default()),
            render_blocks: serde_json::from_str(&render_blocks_json)
                .unwrap_or_else(|_| serde_json::json!([])),
            error: row
                .try_get("error")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            error_code: row
                .try_get("error_code")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            duration_ms: row
                .try_get("duration_ms")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
            request_meta: serde_json::from_str(&request_meta_json)
                .unwrap_or_else(|_| serde_json::json!({})),
            created_at: row
                .try_get("created_at")
                .map_err(|err| CodeModeError::Storage(err.to_string()))?,
        })
    }

    async fn ensure_column(
        &self,
        table: &str,
        column: &str,
        ddl: &str,
    ) -> Result<(), CodeModeError> {
        let sql = format!("PRAGMA table_info({})", table);
        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        let exists = rows.iter().any(|row: &SqliteRow| {
            row.try_get::<String, _>("name")
                .map(|name| name == column)
                .unwrap_or(false)
        });
        if !exists {
            sqlx::query(ddl)
                .execute(&self.pool)
                .await
                .map_err(|err| CodeModeError::Storage(err.to_string()))?;
        }
        Ok(())
    }
}
