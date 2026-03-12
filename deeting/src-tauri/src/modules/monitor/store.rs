use std::str::FromStr;

use serde_json::{json, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;
use uuid::Uuid;

use crate::modules::monitor::types::{
    LocalExecutionResult, LocalMonitorExecutionLog, LocalMonitorExecutionLogListResponse,
    LocalMonitorStatsResponse, LocalMonitorTask, LocalMonitorTaskCreateRequest,
    LocalMonitorTaskListResponse, LocalMonitorTaskUpdateRequest, LocalNotificationChannel,
    LocalNotificationChannelCreateRequest, LocalNotificationChannelListResponse,
    LocalNotificationChannelUpdateRequest,
};

const LOCAL_MONITOR_USER_ID: &str = "00000000-0000-0000-0000-000000000000";
const DEFAULT_MONITOR_CRON: &str = "0 */6 * * *";
const DEFAULT_INTERVAL_MINUTES: i64 = 360;
const MAX_ERROR_COUNT: i64 = 3;
const FAILURE_RETRY_SECONDS: i64 = 60;
const DEFAULT_CHANNEL_PRIORITY: i64 = 100;

#[derive(Clone)]
pub struct MonitorStore {
    pool: SqlitePool,
}

impl MonitorStore {
    pub async fn new(database_url: &str) -> Result<Self, String> {
        let options = SqliteConnectOptions::from_str(database_url)
            .map_err(|err| err.to_string())?
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .map_err(|err| err.to_string())?;
        let store = Self { pool };
        store.init().await?;
        Ok(store)
    }

    pub async fn with_pool(pool: SqlitePool) -> Result<Self, String> {
        let store = Self { pool };
        store.init().await?;
        Ok(store)
    }

    async fn init(&self) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS local_monitor_tasks (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              title TEXT NOT NULL,
              objective TEXT NOT NULL,
              cron_expr TEXT NOT NULL,
              status TEXT NOT NULL,
              last_snapshot_json TEXT NOT NULL,
              last_executed_ts INTEGER,
              error_count INTEGER NOT NULL DEFAULT 0,
              notify_config_json TEXT NOT NULL,
              allowed_tools_json TEXT NOT NULL,
              execution_target TEXT NOT NULL DEFAULT 'desktop',
              total_tokens INTEGER NOT NULL DEFAULT 0,
              current_interval_minutes INTEGER NOT NULL DEFAULT 360,
              next_run_ts INTEGER,
              assistant_id TEXT,
              model_id TEXT,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_local_monitor_tasks_status_active ON local_monitor_tasks(status, is_active, next_run_ts)",
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS local_monitor_execution_logs (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              triggered_at TEXT NOT NULL,
              status TEXT NOT NULL,
              input_data_json TEXT NOT NULL,
              output_data_json TEXT NOT NULL,
              tokens_used INTEGER NOT NULL DEFAULT 0,
              error_message TEXT,
              created_at TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_local_monitor_logs_task_time ON local_monitor_execution_logs(task_id, triggered_at DESC)",
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS local_monitor_feedback (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              log_id TEXT NOT NULL,
              score REAL NOT NULL,
              created_at TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS local_notification_channels (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              channel TEXT NOT NULL,
              config_json TEXT NOT NULL,
              display_name TEXT,
              is_active INTEGER NOT NULL DEFAULT 1,
              priority INTEGER NOT NULL DEFAULT 100,
              last_used_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_local_notification_channels_user_channel ON local_notification_channels(user_id, channel)",
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_local_notification_channels_priority ON local_notification_channels(user_id, is_active, priority)",
        )
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub async fn list_tasks(
        &self,
        skip: i64,
        limit: i64,
        status: Option<&str>,
    ) -> Result<LocalMonitorTaskListResponse, String> {
        let safe_skip = skip.max(0);
        let safe_limit = limit.clamp(1, 200);
        let normalized_status = status
            .map(|value| normalize_status(value).to_string())
            .filter(|value| !value.is_empty());

        let total = if let Some(status_value) = normalized_status.as_deref() {
            let row = sqlx::query(
                "SELECT COUNT(1) AS total FROM local_monitor_tasks WHERE is_active = 1 AND status = ?",
            )
            .bind(status_value)
            .fetch_one(&self.pool)
            .await
            .map_err(|err| err.to_string())?;
            row.try_get::<i64, _>("total").unwrap_or(0).max(0)
        } else {
            let row = sqlx::query(
                "SELECT COUNT(1) AS total FROM local_monitor_tasks WHERE is_active = 1",
            )
            .fetch_one(&self.pool)
            .await
            .map_err(|err| err.to_string())?;
            row.try_get::<i64, _>("total").unwrap_or(0).max(0)
        };

        let rows = if let Some(status_value) = normalized_status.as_deref() {
            sqlx::query(
                r#"
                SELECT * FROM local_monitor_tasks
                WHERE is_active = 1 AND status = ?
                ORDER BY datetime(created_at) DESC, rowid DESC
                LIMIT ? OFFSET ?
                "#,
            )
            .bind(status_value)
            .bind(safe_limit)
            .bind(safe_skip)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| err.to_string())?
        } else {
            sqlx::query(
                r#"
                SELECT * FROM local_monitor_tasks
                WHERE is_active = 1
                ORDER BY datetime(created_at) DESC, rowid DESC
                LIMIT ? OFFSET ?
                "#,
            )
            .bind(safe_limit)
            .bind(safe_skip)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| err.to_string())?
        };

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(row_to_task(&row)?);
        }
        Ok(LocalMonitorTaskListResponse {
            items,
            total,
            skip: safe_skip,
            limit: safe_limit,
        })
    }

    pub async fn get_task(&self, task_id: &str) -> Result<Option<LocalMonitorTask>, String> {
        let row =
            sqlx::query("SELECT * FROM local_monitor_tasks WHERE id = ? AND is_active = 1 LIMIT 1")
                .bind(task_id.trim())
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| err.to_string())?;
        let Some(row) = row else {
            return Ok(None);
        };
        Ok(Some(row_to_task(&row)?))
    }

    pub async fn create_task(
        &self,
        payload: LocalMonitorTaskCreateRequest,
    ) -> Result<LocalMonitorTask, String> {
        let title = payload.title.trim().to_string();
        let objective = payload.objective.trim().to_string();
        if title.is_empty() {
            return Err("title 不能为空".to_string());
        }
        if objective.is_empty() {
            return Err("objective 不能为空".to_string());
        }
        let cron_expr = normalize_cron_expr(payload.cron_expr.as_deref())?;
        let interval_minutes = estimate_cron_interval_minutes(&cron_expr);
        let now_ts = now_unix_timestamp();
        let now_iso = now_rfc3339();
        let next_run_ts = now_ts + interval_minutes * 60;
        let notify_config = payload.notify_config.unwrap_or_else(|| json!({}));
        let allowed_tools = normalize_allowed_tools(payload.allowed_tools.unwrap_or_default());
        let execution_target = normalize_execution_target(payload.execution_target.as_deref());

        let id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO local_monitor_tasks (
              id, user_id, title, objective, cron_expr, status, last_snapshot_json,
              last_executed_ts, error_count, notify_config_json, allowed_tools_json, execution_target,
              total_tokens, current_interval_minutes, next_run_ts, assistant_id, model_id, is_active,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, 0, ?, ?, ?, 0, ?, ?, NULL, NULL, 1, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(LOCAL_MONITOR_USER_ID)
        .bind(title)
        .bind(objective)
        .bind(cron_expr)
        .bind("{}")
        .bind(json_to_string(&notify_config))
        .bind(json_to_string(&json!(allowed_tools)))
        .bind(execution_target)
        .bind(interval_minutes)
        .bind(next_run_ts)
        .bind(&now_iso)
        .bind(&now_iso)
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        self.get_task(&id)
            .await?
            .ok_or_else(|| "创建任务失败".to_string())
    }

    pub async fn update_task(
        &self,
        task_id: &str,
        payload: LocalMonitorTaskUpdateRequest,
    ) -> Result<LocalMonitorTask, String> {
        let Some(current) = self.get_task(task_id).await? else {
            return Err("任务不存在".to_string());
        };

        let title = payload
            .title
            .map(|value| value.trim().to_string())
            .unwrap_or(current.title);
        let objective = payload
            .objective
            .map(|value| value.trim().to_string())
            .unwrap_or(current.objective);
        if title.is_empty() {
            return Err("title 不能为空".to_string());
        }
        if objective.is_empty() {
            return Err("objective 不能为空".to_string());
        }

        let cron_expr = if let Some(value) = payload.cron_expr.as_deref() {
            normalize_cron_expr(Some(value))?
        } else {
            current.cron_expr
        };
        let interval_minutes = estimate_cron_interval_minutes(&cron_expr);
        let status = payload
            .status
            .as_deref()
            .map(normalize_status)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or(current.status.clone());
        let notify_config = payload.notify_config.unwrap_or(current.notify_config);
        let allowed_tools = payload
            .allowed_tools
            .map(normalize_allowed_tools)
            .unwrap_or(current.allowed_tools);
        let execution_target =
            normalize_execution_target(payload.execution_target.as_deref().or(Some("desktop")));

        let now_iso = now_rfc3339();
        let now_ts = now_unix_timestamp();
        let mut next_run_ts = current
            .next_run_at
            .as_deref()
            .and_then(parse_rfc3339_to_unix)
            .unwrap_or(now_ts + interval_minutes * 60);
        if payload.cron_expr.is_some() || status == "active" {
            next_run_ts = now_ts + interval_minutes * 60;
        }
        if status != "active" {
            next_run_ts = 0;
        }

        sqlx::query(
            r#"
            UPDATE local_monitor_tasks
            SET title = ?,
                objective = ?,
                cron_expr = ?,
                status = ?,
                notify_config_json = ?,
                allowed_tools_json = ?,
                execution_target = ?,
                current_interval_minutes = ?,
                next_run_ts = ?,
                updated_at = ?
            WHERE id = ? AND is_active = 1
            "#,
        )
        .bind(title)
        .bind(objective)
        .bind(cron_expr)
        .bind(status)
        .bind(json_to_string(&notify_config))
        .bind(json_to_string(&json!(allowed_tools)))
        .bind(execution_target)
        .bind(interval_minutes)
        .bind(if next_run_ts > 0 {
            Some(next_run_ts)
        } else {
            None
        })
        .bind(now_iso)
        .bind(task_id.trim())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        self.get_task(task_id)
            .await?
            .ok_or_else(|| "任务不存在".to_string())
    }

    pub async fn pause_task(&self, task_id: &str) -> Result<Option<LocalMonitorTask>, String> {
        self.update_status(task_id, "paused", None).await
    }

    pub async fn resume_task(&self, task_id: &str) -> Result<Option<LocalMonitorTask>, String> {
        let Some(task) = self.get_task(task_id).await? else {
            return Ok(None);
        };
        let interval_minutes = task
            .current_interval_minutes
            .unwrap_or(DEFAULT_INTERVAL_MINUTES);
        let next_run_ts = now_unix_timestamp() + interval_minutes * 60;
        self.update_status(task_id, "active", Some(next_run_ts))
            .await
    }

    pub async fn delete_task(&self, task_id: &str) -> Result<bool, String> {
        let result = sqlx::query(
            r#"
            UPDATE local_monitor_tasks
            SET is_active = 0,
                status = 'paused',
                next_run_ts = NULL,
                updated_at = ?
            WHERE id = ? AND is_active = 1
            "#,
        )
        .bind(now_rfc3339())
        .bind(task_id.trim())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn trigger_task(&self, task_id: &str) -> Result<Option<LocalMonitorTask>, String> {
        let now_ts = now_unix_timestamp();
        let result = sqlx::query(
            r#"
            UPDATE local_monitor_tasks
            SET next_run_ts = ?,
                updated_at = ?
            WHERE id = ? AND status = 'active' AND is_active = 1
            "#,
        )
        .bind(now_ts)
        .bind(now_rfc3339())
        .bind(task_id.trim())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        if result.rows_affected() == 0 {
            return Ok(None);
        }
        self.get_task(task_id).await
    }

    pub async fn get_stats(&self) -> Result<LocalMonitorStatsResponse, String> {
        let task_row = sqlx::query(
            r#"
            SELECT
              COUNT(1) AS total_tasks,
              SUM(CASE WHEN status = 'active' AND is_active = 1 THEN 1 ELSE 0 END) AS active_tasks,
              SUM(CASE WHEN status = 'paused' AND is_active = 1 THEN 1 ELSE 0 END) AS paused_tasks,
              SUM(CASE WHEN status = 'failed_suspended' AND is_active = 1 THEN 1 ELSE 0 END) AS failed_suspended_tasks,
              SUM(CASE WHEN is_active = 1 THEN total_tokens ELSE 0 END) AS total_tokens
            FROM local_monitor_tasks
            WHERE is_active = 1
            "#,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        let log_row =
            sqlx::query("SELECT COUNT(1) AS total_executions FROM local_monitor_execution_logs")
                .fetch_one(&self.pool)
                .await
                .map_err(|err| err.to_string())?;

        Ok(LocalMonitorStatsResponse {
            total_tasks: task_row
                .try_get::<i64, _>("total_tasks")
                .unwrap_or(0)
                .max(0),
            active_tasks: task_row
                .try_get::<i64, _>("active_tasks")
                .unwrap_or(0)
                .max(0),
            paused_tasks: task_row
                .try_get::<i64, _>("paused_tasks")
                .unwrap_or(0)
                .max(0),
            failed_suspended_tasks: task_row
                .try_get::<i64, _>("failed_suspended_tasks")
                .unwrap_or(0)
                .max(0),
            total_tokens: task_row
                .try_get::<i64, _>("total_tokens")
                .unwrap_or(0)
                .max(0),
            total_executions: log_row
                .try_get::<i64, _>("total_executions")
                .unwrap_or(0)
                .max(0),
        })
    }

    pub async fn list_logs(
        &self,
        task_id: &str,
        skip: i64,
        limit: i64,
    ) -> Result<LocalMonitorExecutionLogListResponse, String> {
        let safe_skip = skip.max(0);
        let safe_limit = limit.clamp(1, 200);
        let total_row = sqlx::query(
            "SELECT COUNT(1) AS total FROM local_monitor_execution_logs WHERE task_id = ?",
        )
        .bind(task_id.trim())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        let total = total_row.try_get::<i64, _>("total").unwrap_or(0).max(0);

        let rows = sqlx::query(
            r#"
            SELECT * FROM local_monitor_execution_logs
            WHERE task_id = ?
            ORDER BY datetime(triggered_at) DESC, rowid DESC
            LIMIT ? OFFSET ?
            "#,
        )
        .bind(task_id.trim())
        .bind(safe_limit)
        .bind(safe_skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(row_to_log(&row)?);
        }
        Ok(LocalMonitorExecutionLogListResponse {
            items,
            total,
            skip: safe_skip,
            limit: safe_limit,
        })
    }

    pub async fn submit_feedback(
        &self,
        task_id: &str,
        log_id: &str,
        score: f64,
    ) -> Result<(), String> {
        sqlx::query(
            r#"
            INSERT INTO local_monitor_feedback (id, task_id, log_id, score, created_at)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(task_id.trim())
        .bind(log_id.trim())
        .bind(score)
        .bind(now_rfc3339())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn list_notification_channels(
        &self,
    ) -> Result<LocalNotificationChannelListResponse, String> {
        let total_row = sqlx::query(
            "SELECT COUNT(1) AS total FROM local_notification_channels WHERE user_id = ?",
        )
        .bind(LOCAL_MONITOR_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        let total = total_row.try_get::<i64, _>("total").unwrap_or(0).max(0);

        let rows = sqlx::query(
            r#"
            SELECT * FROM local_notification_channels
            WHERE user_id = ?
            ORDER BY priority ASC, datetime(created_at) ASC, rowid ASC
            "#,
        )
        .bind(LOCAL_MONITOR_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(row_to_notification_channel(&row)?);
        }
        Ok(LocalNotificationChannelListResponse { items, total })
    }

    pub async fn get_notification_channel(
        &self,
        channel_id: &str,
    ) -> Result<Option<LocalNotificationChannel>, String> {
        let row = sqlx::query(
            r#"
            SELECT * FROM local_notification_channels
            WHERE id = ? AND user_id = ?
            LIMIT 1
            "#,
        )
        .bind(channel_id.trim())
        .bind(LOCAL_MONITOR_USER_ID)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        let Some(row) = row else {
            return Ok(None);
        };
        Ok(Some(row_to_notification_channel(&row)?))
    }

    pub async fn create_notification_channel(
        &self,
        payload: LocalNotificationChannelCreateRequest,
    ) -> Result<LocalNotificationChannel, String> {
        let channel = normalize_notification_channel(payload.channel.as_str())?.to_string();
        if !payload.config.is_object() {
            return Err("config 必须是 object".to_string());
        }
        let display_name = normalize_display_name(payload.display_name);
        let priority = payload
            .priority
            .unwrap_or(DEFAULT_CHANNEL_PRIORITY)
            .clamp(0, 1000);
        let now = now_rfc3339();
        let id = Uuid::new_v4().to_string();

        let result = sqlx::query(
            r#"
            INSERT INTO local_notification_channels (
              id, user_id, channel, config_json, display_name,
              is_active, priority, last_used_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(LOCAL_MONITOR_USER_ID)
        .bind(channel)
        .bind(json_to_string(&payload.config))
        .bind(display_name)
        .bind(priority)
        .bind(now.as_str())
        .bind(now.as_str())
        .execute(&self.pool)
        .await;
        if let Err(err) = result {
            let detail = err.to_string();
            if detail.to_lowercase().contains("unique") {
                return Err("该通知渠道已存在".to_string());
            }
            return Err(detail);
        }

        self.get_notification_channel(id.as_str())
            .await?
            .ok_or_else(|| "创建通知渠道失败".to_string())
    }

    pub async fn update_notification_channel(
        &self,
        channel_id: &str,
        payload: LocalNotificationChannelUpdateRequest,
    ) -> Result<Option<LocalNotificationChannel>, String> {
        let Some(current) = self.get_notification_channel(channel_id).await? else {
            return Ok(None);
        };

        let config = payload.config.unwrap_or(current.config.clone());
        if !config.is_object() {
            return Err("config 必须是 object".to_string());
        }
        let display_name = if let Some(raw) = payload.display_name {
            normalize_display_name(Some(raw))
        } else {
            current.display_name.clone()
        };
        let priority = payload.priority.unwrap_or(current.priority).clamp(0, 1000);
        let is_active = payload.is_active.unwrap_or(current.is_active);
        let updated_at = now_rfc3339();

        let result = sqlx::query(
            r#"
            UPDATE local_notification_channels
            SET config_json = ?,
                display_name = ?,
                is_active = ?,
                priority = ?,
                updated_at = ?
            WHERE id = ? AND user_id = ?
            "#,
        )
        .bind(json_to_string(&config))
        .bind(display_name)
        .bind(if is_active { 1 } else { 0 })
        .bind(priority)
        .bind(updated_at)
        .bind(channel_id.trim())
        .bind(LOCAL_MONITOR_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        if result.rows_affected() == 0 {
            return Ok(None);
        }
        self.get_notification_channel(channel_id).await
    }

    pub async fn delete_notification_channel(&self, channel_id: &str) -> Result<bool, String> {
        let result = sqlx::query(
            r#"
            DELETE FROM local_notification_channels
            WHERE id = ? AND user_id = ?
            "#,
        )
        .bind(channel_id.trim())
        .bind(LOCAL_MONITOR_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn list_active_notification_channels(
        &self,
    ) -> Result<Vec<LocalNotificationChannel>, String> {
        let rows = sqlx::query(
            r#"
            SELECT * FROM local_notification_channels
            WHERE user_id = ? AND is_active = 1
            ORDER BY priority ASC, datetime(created_at) ASC, rowid ASC
            "#,
        )
        .bind(LOCAL_MONITOR_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(row_to_notification_channel(&row)?);
        }
        Ok(items)
    }

    pub async fn list_active_notification_channels_by_ids(
        &self,
        channel_ids: &[String],
    ) -> Result<Vec<LocalNotificationChannel>, String> {
        let mut unique_ids = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for raw in channel_ids {
            let id = raw.trim().to_string();
            if id.is_empty() {
                continue;
            }
            if seen.insert(id.clone()) {
                unique_ids.push(id);
            }
        }
        if unique_ids.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders = std::iter::repeat("?")
            .take(unique_ids.len())
            .collect::<Vec<&str>>()
            .join(", ");
        let sql = format!(
            "SELECT * FROM local_notification_channels \
             WHERE user_id = ? AND is_active = 1 AND id IN ({}) \
             ORDER BY priority ASC, datetime(created_at) ASC, rowid ASC",
            placeholders
        );

        let mut query = sqlx::query(&sql).bind(LOCAL_MONITOR_USER_ID);
        for id in &unique_ids {
            query = query.bind(id);
        }
        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|err| err.to_string())?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(row_to_notification_channel(&row)?);
        }
        Ok(items)
    }

    pub async fn touch_notification_channel(&self, channel_id: &str) -> Result<(), String> {
        let now = now_rfc3339();
        sqlx::query(
            r#"
            UPDATE local_notification_channels
            SET last_used_at = ?,
                updated_at = ?
            WHERE id = ? AND user_id = ?
            "#,
        )
        .bind(now.as_str())
        .bind(now.as_str())
        .bind(channel_id.trim())
        .bind(LOCAL_MONITOR_USER_ID)
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn list_due_tasks(&self, limit: i64) -> Result<Vec<LocalMonitorTask>, String> {
        let safe_limit = limit.clamp(1, 50);
        let now_ts = now_unix_timestamp();
        let rows = sqlx::query(
            r#"
            SELECT * FROM local_monitor_tasks
            WHERE is_active = 1
              AND status = 'active'
              AND next_run_ts IS NOT NULL
              AND next_run_ts <= ?
            ORDER BY next_run_ts ASC, rowid ASC
            LIMIT ?
            "#,
        )
        .bind(now_ts)
        .bind(safe_limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(row_to_task(&row)?);
        }
        Ok(items)
    }

    pub async fn record_execution_success(
        &self,
        task: &LocalMonitorTask,
        result: &LocalExecutionResult,
    ) -> Result<(), String> {
        let now_ts = now_unix_timestamp();
        let now_iso = now_rfc3339();
        let interval_minutes = estimate_cron_interval_minutes(&task.cron_expr);
        let next_run_ts = now_ts + interval_minutes * 60;
        let summary = truncate(&result.change_summary, 4000);
        let output_data = json!({
            "is_significant_change": result.is_significant_change,
            "change_summary": summary,
            "new_snapshot": result.new_snapshot,
            "events": result.events,
        });
        let input_data = json!({
            "source": "desktop_local_worker",
            "model": result.model_id,
            "strategy": "desktop_local_worker",
        });

        sqlx::query(
            r#"
            INSERT INTO local_monitor_execution_logs (
              id, task_id, triggered_at, status, input_data_json, output_data_json,
              tokens_used, error_message, created_at
            ) VALUES (?, ?, ?, 'success', ?, ?, ?, NULL, ?)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(task.id.as_str())
        .bind(now_iso.as_str())
        .bind(json_to_string(&input_data))
        .bind(json_to_string(&output_data))
        .bind(result.tokens_used.max(0))
        .bind(now_iso.as_str())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        let snapshot = if result.new_snapshot.is_object() {
            result.new_snapshot.clone()
        } else {
            task.last_snapshot.clone().unwrap_or_else(|| json!({}))
        };
        sqlx::query(
            r#"
            UPDATE local_monitor_tasks
            SET last_snapshot_json = ?,
                last_executed_ts = ?,
                error_count = 0,
                total_tokens = total_tokens + ?,
                current_interval_minutes = ?,
                next_run_ts = ?,
                updated_at = ?
            WHERE id = ? AND is_active = 1
            "#,
        )
        .bind(json_to_string(&snapshot))
        .bind(now_ts)
        .bind(result.tokens_used.max(0))
        .bind(interval_minutes)
        .bind(next_run_ts)
        .bind(now_iso)
        .bind(task.id.as_str())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn record_execution_failure(
        &self,
        task: &LocalMonitorTask,
        error_message: &str,
    ) -> Result<(), String> {
        let now_ts = now_unix_timestamp();
        let now_iso = now_rfc3339();
        let next_error_count = task.error_count + 1;
        let next_status = if next_error_count > MAX_ERROR_COUNT {
            "failed_suspended"
        } else {
            "active"
        };
        let next_run_ts = if next_status == "active" {
            Some(now_ts + FAILURE_RETRY_SECONDS)
        } else {
            None
        };
        let error_text = truncate(error_message, 1900);

        sqlx::query(
            r#"
            INSERT INTO local_monitor_execution_logs (
              id, task_id, triggered_at, status, input_data_json, output_data_json,
              tokens_used, error_message, created_at
            ) VALUES (?, ?, ?, 'failure', ?, ?, 0, ?, ?)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(task.id.as_str())
        .bind(now_iso.as_str())
        .bind(json_to_string(&json!({"source": "desktop_local_worker"})))
        .bind(json_to_string(&json!({})))
        .bind(error_text)
        .bind(now_iso.as_str())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            r#"
            UPDATE local_monitor_tasks
            SET status = ?,
                error_count = ?,
                last_executed_ts = ?,
                next_run_ts = ?,
                updated_at = ?
            WHERE id = ? AND is_active = 1
            "#,
        )
        .bind(next_status)
        .bind(next_error_count)
        .bind(now_ts)
        .bind(next_run_ts)
        .bind(now_iso)
        .bind(task.id.as_str())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    async fn update_status(
        &self,
        task_id: &str,
        status: &str,
        next_run_ts: Option<i64>,
    ) -> Result<Option<LocalMonitorTask>, String> {
        let normalized_status = normalize_status(status);
        if normalized_status.is_empty() {
            return Err("非法 status".to_string());
        }
        let result = sqlx::query(
            r#"
            UPDATE local_monitor_tasks
            SET status = ?,
                next_run_ts = ?,
                updated_at = ?
            WHERE id = ? AND is_active = 1
            "#,
        )
        .bind(normalized_status)
        .bind(next_run_ts)
        .bind(now_rfc3339())
        .bind(task_id.trim())
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        if result.rows_affected() == 0 {
            return Ok(None);
        }
        self.get_task(task_id).await
    }
}

fn row_to_task(row: &SqliteRow) -> Result<LocalMonitorTask, String> {
    let last_snapshot_json: String = row
        .try_get("last_snapshot_json")
        .map_err(|err| err.to_string())?;
    let notify_config_json: String = row
        .try_get("notify_config_json")
        .map_err(|err| err.to_string())?;
    let allowed_tools_json: String = row
        .try_get("allowed_tools_json")
        .map_err(|err| err.to_string())?;
    let last_executed_ts: Option<i64> = row
        .try_get("last_executed_ts")
        .map_err(|err| err.to_string())?;
    let next_run_ts: Option<i64> = row.try_get("next_run_ts").map_err(|err| err.to_string())?;
    let is_active_raw: i64 = row.try_get("is_active").map_err(|err| err.to_string())?;
    Ok(LocalMonitorTask {
        id: row.try_get("id").map_err(|err| err.to_string())?,
        user_id: row.try_get("user_id").map_err(|err| err.to_string())?,
        title: row.try_get("title").map_err(|err| err.to_string())?,
        objective: row.try_get("objective").map_err(|err| err.to_string())?,
        cron_expr: row.try_get("cron_expr").map_err(|err| err.to_string())?,
        status: row.try_get("status").map_err(|err| err.to_string())?,
        last_snapshot: Some(parse_json_value(&last_snapshot_json)),
        last_executed_at: last_executed_ts.and_then(ts_to_rfc3339),
        next_run_at: next_run_ts.and_then(ts_to_rfc3339),
        current_interval_minutes: row
            .try_get::<Option<i64>, _>("current_interval_minutes")
            .map_err(|err| err.to_string())?,
        strategy_variants: None,
        assistant_id: row
            .try_get::<Option<String>, _>("assistant_id")
            .map_err(|err| err.to_string())?,
        model_id: row
            .try_get::<Option<String>, _>("model_id")
            .map_err(|err| err.to_string())?,
        error_count: row.try_get("error_count").map_err(|err| err.to_string())?,
        notify_config: parse_json_value(&notify_config_json),
        allowed_tools: parse_json_value(&allowed_tools_json)
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default(),
        execution_target: row
            .try_get("execution_target")
            .map_err(|err| err.to_string())?,
        total_tokens: row.try_get("total_tokens").map_err(|err| err.to_string())?,
        is_active: is_active_raw > 0,
        created_at: row.try_get("created_at").map_err(|err| err.to_string())?,
        updated_at: row.try_get("updated_at").map_err(|err| err.to_string())?,
    })
}

fn row_to_log(row: &SqliteRow) -> Result<LocalMonitorExecutionLog, String> {
    let input_data_json: String = row
        .try_get("input_data_json")
        .map_err(|err| err.to_string())?;
    let output_data_json: String = row
        .try_get("output_data_json")
        .map_err(|err| err.to_string())?;
    Ok(LocalMonitorExecutionLog {
        id: row.try_get("id").map_err(|err| err.to_string())?,
        task_id: row.try_get("task_id").map_err(|err| err.to_string())?,
        triggered_at: row.try_get("triggered_at").map_err(|err| err.to_string())?,
        status: row.try_get("status").map_err(|err| err.to_string())?,
        input_data: Some(parse_json_value(&input_data_json)),
        output_data: Some(parse_json_value(&output_data_json)),
        tokens_used: row.try_get("tokens_used").map_err(|err| err.to_string())?,
        error_message: row
            .try_get::<Option<String>, _>("error_message")
            .map_err(|err| err.to_string())?,
        created_at: row.try_get("created_at").map_err(|err| err.to_string())?,
    })
}

fn row_to_notification_channel(row: &SqliteRow) -> Result<LocalNotificationChannel, String> {
    let config_json: String = row.try_get("config_json").map_err(|err| err.to_string())?;
    let is_active_raw: i64 = row.try_get("is_active").map_err(|err| err.to_string())?;
    Ok(LocalNotificationChannel {
        id: row.try_get("id").map_err(|err| err.to_string())?,
        user_id: row.try_get("user_id").map_err(|err| err.to_string())?,
        channel: row.try_get("channel").map_err(|err| err.to_string())?,
        config: parse_json_value(&config_json),
        display_name: row
            .try_get::<Option<String>, _>("display_name")
            .map_err(|err| err.to_string())?,
        is_active: is_active_raw > 0,
        priority: row.try_get("priority").map_err(|err| err.to_string())?,
        last_used_at: row
            .try_get::<Option<String>, _>("last_used_at")
            .map_err(|err| err.to_string())?,
        created_at: row.try_get("created_at").map_err(|err| err.to_string())?,
        updated_at: row.try_get("updated_at").map_err(|err| err.to_string())?,
    })
}

fn normalize_cron_expr(raw: Option<&str>) -> Result<String, String> {
    let cron_expr = raw.unwrap_or(DEFAULT_MONITOR_CRON).trim();
    let parts: Vec<&str> = cron_expr.split_whitespace().collect();
    if parts.len() != 5 {
        return Err("Cron 表达式非法: 必须是 5 段".to_string());
    }
    Ok(cron_expr.to_string())
}

fn normalize_status(raw: &str) -> &'static str {
    match raw.trim().to_lowercase().as_str() {
        "active" => "active",
        "paused" => "paused",
        "failed_suspended" => "failed_suspended",
        _ => "",
    }
}

fn normalize_execution_target(raw: Option<&str>) -> String {
    let _ = raw;
    "desktop".to_string()
}

fn normalize_notification_channel(raw: &str) -> Result<&'static str, String> {
    match raw.trim().to_lowercase().as_str() {
        "feishu" => Ok("feishu"),
        "dingtalk" => Ok("dingtalk"),
        "telegram" => Ok("telegram"),
        "email" => Ok("email"),
        "webhook" => Ok("webhook"),
        _ => Err("不支持的通知渠道类型".to_string()),
    }
}

fn normalize_display_name(raw: Option<String>) -> Option<String> {
    raw.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_allowed_tools(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for raw in values {
        let item = raw.trim().to_string();
        if item.is_empty() {
            continue;
        }
        if seen.insert(item.clone()) {
            normalized.push(item);
        }
    }
    normalized
}

fn estimate_cron_interval_minutes(cron_expr: &str) -> i64 {
    let parts: Vec<&str> = cron_expr.split_whitespace().collect();
    if parts.len() != 5 {
        return DEFAULT_INTERVAL_MINUTES;
    }
    let minute = parts[0];
    let hour = parts[1];
    let day = parts[2];
    let month = parts[3];
    let weekday = parts[4];

    if day == "*" && month == "*" && weekday == "*" {
        if minute == "*" && hour == "*" {
            return 1;
        }
        if let Some(step) = parse_step(minute) {
            if hour == "*" {
                return step.max(1);
            }
        }
        if minute.parse::<i64>().is_ok() {
            if hour == "*" {
                return 60;
            }
            if let Some(step_hour) = parse_step(hour) {
                return (step_hour * 60).max(60);
            }
            if hour.parse::<i64>().is_ok() {
                return 24 * 60;
            }
        }
    }
    DEFAULT_INTERVAL_MINUTES
}

fn parse_step(part: &str) -> Option<i64> {
    let part = part.trim();
    if !part.starts_with("*/") {
        return None;
    }
    let raw = part.trim_start_matches("*/");
    raw.parse::<i64>().ok().filter(|value| *value > 0)
}

fn parse_json_value(raw: &str) -> Value {
    serde_json::from_str(raw).unwrap_or_else(|_| json!({}))
}

fn json_to_string(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

fn parse_rfc3339_to_unix(raw: &str) -> Option<i64> {
    time::OffsetDateTime::parse(raw, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(|value| value.unix_timestamp())
}

fn now_unix_timestamp() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

fn ts_to_rfc3339(ts: i64) -> Option<String> {
    time::OffsetDateTime::from_unix_timestamp(ts)
        .ok()
        .and_then(|value| {
            value
                .format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
}

fn truncate(raw: &str, max_chars: usize) -> String {
    if raw.chars().count() <= max_chars {
        return raw.to_string();
    }
    raw.chars().take(max_chars).collect::<String>()
}
