use std::str::FromStr;

use serde_json::{json, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;
use uuid::Uuid;

use crate::modules::monitor::types::{
    monitor_task_input_source_for_run, normalize_monitor_notify_config, LocalExecutionResult,
    LocalMonitorDeliveryStateListResponse, LocalMonitorDeliveryStateRecord,
    LocalMonitorExecutionLog, LocalMonitorExecutionLogListResponse, LocalMonitorStatsResponse,
    LocalMonitorTask, LocalMonitorTaskCreateRequest, LocalMonitorTaskListResponse,
    LocalMonitorTaskUpdateRequest, LocalNotificationChannel, LocalNotificationChannelCreateRequest,
    LocalNotificationChannelListResponse, LocalNotificationChannelUpdateRequest,
};

const LOCAL_MONITOR_USER_ID: &str = "00000000-0000-0000-0000-000000000000";
const DEFAULT_MONITOR_CRON: &str = "0 */6 * * *";
const DEFAULT_INTERVAL_MINUTES: i64 = 360;
const MAX_LOCAL_MONITOR_TASKS: i64 = 50;
const MIN_MONITOR_INTERVAL_MINUTES: i64 = 5;
const MAX_ERROR_COUNT: i64 = 3;
const FAILURE_RETRY_SECONDS: i64 = 60;
const DEFAULT_CLAIM_LEASE_SECONDS: i64 = 180;
const DEFAULT_CHANNEL_PRIORITY: i64 = 100;
const DEFAULT_ANALYSIS_MODE: &str = "concise";

#[derive(Clone)]
pub struct MonitorStore {
    pool: SqlitePool,
    write_pool: SqlitePool,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MonitorDeliveryState {
    pub(crate) anchor_message_id: Option<String>,
    pub(crate) anchor_context: Value,
    pub(crate) updated_at: String,
}

impl MonitorStore {
    pub async fn new(database_url: &str) -> Result<Self, String> {
        let options = SqliteConnectOptions::from_str(database_url)
            .map_err(|err| err.to_string())?
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options.clone())
            .await
            .map_err(|err| err.to_string())?;
        let write_pool =
            if database_url == "sqlite::memory:" || database_url.contains("mode=memory") {
                pool.clone()
            } else {
                SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(options)
                    .await
                    .map_err(|err| err.to_string())?
            };
        let store = Self { pool, write_pool };
        store.init().await?;
        Ok(store)
    }

    pub async fn with_pool(pool: SqlitePool) -> Result<Self, String> {
        let store = Self {
            write_pool: pool.clone(),
            pool,
        };
        store.init().await?;
        Ok(store)
    }

    pub async fn with_pools(pool: SqlitePool, write_pool: SqlitePool) -> Result<Self, String> {
        let store = Self { pool, write_pool };
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
              claim_until_ts INTEGER,
              assistant_id TEXT,
              model_id TEXT,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_local_monitor_tasks_status_active ON local_monitor_tasks(status, is_active, next_run_ts)",
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| err.to_string())?;

        ensure_column(
            &self.write_pool,
            "local_monitor_tasks",
            "analysis_mode",
            &format!("TEXT NOT NULL DEFAULT '{}'", DEFAULT_ANALYSIS_MODE),
        )
        .await?;
        ensure_column(
            &self.write_pool,
            "local_monitor_tasks",
            "policy_state_json",
            "TEXT NOT NULL DEFAULT '{}'",
        )
        .await?;
        ensure_column(
            &self.write_pool,
            "local_monitor_tasks",
            "claim_until_ts",
            "INTEGER",
        )
        .await?;

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
        .execute(&self.write_pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_local_monitor_logs_task_time ON local_monitor_execution_logs(task_id, triggered_at DESC)",
        )
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_local_notification_channels_user_channel ON local_notification_channels(user_id, channel)",
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_local_notification_channels_priority ON local_notification_channels(user_id, is_active, priority)",
        )
        .execute(&self.write_pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS local_monitor_delivery_state (
              task_id TEXT NOT NULL,
              channel_id TEXT NOT NULL,
              target_key TEXT NOT NULL,
              anchor_message_id TEXT,
              anchor_context_json TEXT NOT NULL DEFAULT '{}',
              updated_at TEXT NOT NULL,
              PRIMARY KEY (task_id, channel_id, target_key)
            )
            "#,
        )
        .execute(&self.write_pool)
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
        let existing_task_count =
            sqlx::query("SELECT COUNT(1) AS total FROM local_monitor_tasks WHERE is_active = 1")
                .fetch_one(&self.pool)
                .await
                .map_err(|err| err.to_string())?
                .try_get::<i64, _>("total")
                .unwrap_or(0)
                .max(0);
        if existing_task_count >= MAX_LOCAL_MONITOR_TASKS {
            return Err(format!(
                "desktop local monitor 最多允许 {} 个任务，请先删除或停用不再需要的任务",
                MAX_LOCAL_MONITOR_TASKS
            ));
        }
        let title = payload.title.trim().to_string();
        let objective = payload.objective.trim().to_string();
        let assistant_id = normalize_assistant_id(payload.assistant_id)?;
        if title.is_empty() {
            return Err("title 不能为空".to_string());
        }
        if objective.is_empty() {
            return Err("objective 不能为空".to_string());
        }
        let cron_expr = normalize_supported_cron_expr(payload.cron_expr.as_deref())?;
        let now_ts = now_unix_timestamp();
        let now_iso = now_rfc3339();
        let (next_run_ts, interval_minutes) = schedule_metadata_for_cron_expr(&cron_expr, now_ts)?;
        ensure_minimum_monitor_interval_minutes(interval_minutes)?;
        let notify_config =
            normalize_monitor_notify_config(&payload.notify_config.unwrap_or_else(|| json!({})));
        let allowed_tools = normalize_allowed_tools(payload.allowed_tools.unwrap_or_default());
        let execution_target =
            normalize_desktop_execution_target(payload.execution_target.as_deref())?;
        let analysis_mode = normalize_analysis_mode(payload.analysis_mode.as_deref());
        let policy_state = json!({});

        let id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO local_monitor_tasks (
              id, user_id, title, objective, cron_expr, status, last_snapshot_json,
              last_executed_ts, error_count, notify_config_json, allowed_tools_json, execution_target,
              total_tokens, current_interval_minutes, next_run_ts, assistant_id, model_id, analysis_mode, policy_state_json, is_active,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, 0, ?, ?, ?, 0, ?, ?, ?, NULL, ?, ?, 1, ?, ?)
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
        .bind(assistant_id)
        .bind(analysis_mode)
        .bind(json_to_string(&policy_state))
        .bind(&now_iso)
        .bind(&now_iso)
        .execute(&self.write_pool)
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
            normalize_supported_cron_expr(Some(value))?
        } else {
            current.cron_expr
        };
        let assistant_id = match payload.assistant_id {
            Some(value) => Some(normalize_assistant_id(value)?),
            None => current.assistant_id.clone(),
        };
        let assistant_id = assistant_id.ok_or_else(|| "assistant_id 不能为空".to_string())?;
        let now_iso = now_rfc3339();
        let now_ts = now_unix_timestamp();
        let (next_scheduled_run_ts, interval_minutes) =
            schedule_metadata_for_cron_expr(&cron_expr, now_ts)?;
        ensure_minimum_monitor_interval_minutes(interval_minutes)?;
        let analysis_mode = match payload.analysis_mode.as_deref() {
            Some(value) => normalize_analysis_mode(Some(value)),
            None => current.analysis_mode.clone(),
        };
        let status = payload
            .status
            .as_deref()
            .map(normalize_status)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or(current.status.clone());
        let notify_config = normalize_monitor_notify_config(
            &payload.notify_config.unwrap_or(current.notify_config),
        );
        let allowed_tools = payload
            .allowed_tools
            .map(normalize_allowed_tools)
            .unwrap_or(current.allowed_tools);
        let execution_target = normalize_desktop_execution_target(
            payload
                .execution_target
                .as_deref()
                .or(Some(current.execution_target.as_str())),
        )?;
        let mut next_run_ts = current
            .next_run_at
            .as_deref()
            .and_then(parse_rfc3339_to_unix)
            .unwrap_or(next_scheduled_run_ts);
        if payload.cron_expr.is_some() || status == "active" {
            next_run_ts = next_scheduled_run_ts;
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
                assistant_id = ?,
                analysis_mode = ?,
                current_interval_minutes = ?,
                next_run_ts = ?,
                claim_until_ts = NULL,
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
        .bind(assistant_id)
        .bind(analysis_mode)
        .bind(interval_minutes)
        .bind(if next_run_ts > 0 {
            Some(next_run_ts)
        } else {
            None
        })
        .bind(now_iso)
        .bind(task_id.trim())
        .execute(&self.write_pool)
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
        let now_ts = now_unix_timestamp();
        let (next_run_ts, _) = schedule_metadata_for_cron_expr(task.cron_expr.as_str(), now_ts)?;
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
                claim_until_ts = NULL,
                updated_at = ?
            WHERE id = ? AND is_active = 1
            "#,
        )
        .bind(now_rfc3339())
        .bind(task_id.trim())
        .execute(&self.write_pool)
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
                claim_until_ts = NULL,
                updated_at = ?
            WHERE id = ? AND status = 'active' AND is_active = 1
            "#,
        )
        .bind(now_ts)
        .bind(now_rfc3339())
        .bind(task_id.trim())
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub(crate) async fn get_delivery_state(
        &self,
        task_id: &str,
        channel_id: &str,
        target_key: &str,
    ) -> Result<Option<MonitorDeliveryState>, String> {
        let row = sqlx::query(
            r#"
            SELECT anchor_message_id, anchor_context_json, updated_at
            FROM local_monitor_delivery_state
            WHERE task_id = ? AND channel_id = ? AND target_key = ?
            LIMIT 1
            "#,
        )
        .bind(task_id.trim())
        .bind(channel_id.trim())
        .bind(target_key.trim())
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        let Some(row) = row else {
            return Ok(None);
        };

        Ok(Some(MonitorDeliveryState {
            anchor_message_id: row
                .try_get::<Option<String>, _>("anchor_message_id")
                .map_err(|err| err.to_string())?,
            anchor_context: parse_json_value(
                &row.try_get::<String, _>("anchor_context_json")
                    .map_err(|err| err.to_string())?,
            ),
            updated_at: row.try_get("updated_at").map_err(|err| err.to_string())?,
        }))
    }

    pub(crate) async fn upsert_delivery_state(
        &self,
        task_id: &str,
        channel_id: &str,
        target_key: &str,
        anchor_message_id: Option<&str>,
        anchor_context: Option<&Value>,
    ) -> Result<(), String> {
        let updated_at = now_rfc3339();
        let normalized_message_id = anchor_message_id
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let context_json = json_to_string(anchor_context.unwrap_or(&json!({})));
        sqlx::query(
            r#"
            INSERT INTO local_monitor_delivery_state (
              task_id, channel_id, target_key, anchor_message_id, anchor_context_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(task_id, channel_id, target_key)
            DO UPDATE SET
              anchor_message_id = excluded.anchor_message_id,
              anchor_context_json = excluded.anchor_context_json,
              updated_at = excluded.updated_at
            "#,
        )
        .bind(task_id.trim())
        .bind(channel_id.trim())
        .bind(target_key.trim())
        .bind(normalized_message_id)
        .bind(context_json)
        .bind(updated_at)
        .execute(&self.write_pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn list_delivery_states(
        &self,
        task_id: &str,
    ) -> Result<LocalMonitorDeliveryStateListResponse, String> {
        let task = self
            .get_task(task_id)
            .await?
            .ok_or_else(|| "任务不存在".to_string())?;
        let channel_ids = task
            .notify_config
            .get("channel_ids")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let configured_channels = if channel_ids.is_empty() {
            Vec::new()
        } else {
            self.list_active_notification_channels_by_ids(&channel_ids)
                .await?
        };

        let rows = sqlx::query(
            r#"
            SELECT
              state.task_id,
              state.channel_id,
              channel.channel,
              channel.display_name,
              state.target_key,
              state.anchor_message_id,
              state.anchor_context_json,
              state.updated_at
            FROM local_monitor_delivery_state AS state
            LEFT JOIN local_notification_channels AS channel
              ON channel.id = state.channel_id
            WHERE task_id = ?
            ORDER BY datetime(state.updated_at) DESC, state.rowid DESC
            "#,
        )
        .bind(task_id.trim())
        .fetch_all(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        let persisted_items = rows
            .into_iter()
            .map(|row| -> Result<LocalMonitorDeliveryStateRecord, String> {
                let anchor_context_json: String = row
                    .try_get("anchor_context_json")
                    .map_err(|err| err.to_string())?;
                let anchor_context = parse_json_value(&anchor_context_json);
                let anchor_message_id = row
                    .try_get::<Option<String>, _>("anchor_message_id")
                    .map_err(|err| err.to_string())?;
                Ok(LocalMonitorDeliveryStateRecord {
                    task_id: row.try_get("task_id").map_err(|err| err.to_string())?,
                    channel_id: row.try_get("channel_id").map_err(|err| err.to_string())?,
                    channel_kind: row
                        .try_get::<Option<String>, _>("channel")
                        .map_err(|err| err.to_string())?
                        .unwrap_or_default(),
                    channel_display_name: row
                        .try_get::<Option<String>, _>("display_name")
                        .map_err(|err| err.to_string())?,
                    status: derive_delivery_state_status(
                        anchor_message_id.clone(),
                        anchor_context.clone(),
                    ),
                    target_key: row.try_get("target_key").map_err(|err| err.to_string())?,
                    anchor_message_id,
                    anchor_context,
                    updated_at: row.try_get("updated_at").map_err(|err| err.to_string())?,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        let mut items = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for item in persisted_items {
            seen.insert(item.target_key.clone());
            items.push(item);
        }
        for channel in configured_channels {
            for item in derive_channel_target_records(task.id.as_str(), &channel) {
                if seen.insert(item.target_key.clone()) {
                    items.push(item);
                }
            }
        }
        items.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

        Ok(LocalMonitorDeliveryStateListResponse {
            total: items.len() as i64,
            items,
        })
    }

    pub async fn list_due_tasks(&self, limit: i64) -> Result<Vec<LocalMonitorTask>, String> {
        let safe_limit = limit.clamp(1, 50);
        let now_ts = now_unix_timestamp();
        let claim_until_ts = now_ts + DEFAULT_CLAIM_LEASE_SECONDS;
        let rows = sqlx::query(
            r#"
            SELECT id FROM local_monitor_tasks
            WHERE is_active = 1
              AND status = 'active'
              AND next_run_ts IS NOT NULL
              AND next_run_ts <= ?
              AND (claim_until_ts IS NULL OR claim_until_ts <= ?)
            ORDER BY next_run_ts ASC, rowid ASC
            LIMIT ?
            "#,
        )
        .bind(now_ts)
        .bind(now_ts)
        .bind(safe_limit)
        .fetch_all(&self.write_pool)
        .await
        .map_err(|err| err.to_string())?;
        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let task_id: String = row.try_get("id").map_err(|err| err.to_string())?;
            let claim_result = sqlx::query(
                r#"
                UPDATE local_monitor_tasks
                SET claim_until_ts = ?,
                    updated_at = ?
                WHERE id = ?
                  AND is_active = 1
                  AND status = 'active'
                  AND next_run_ts IS NOT NULL
                  AND next_run_ts <= ?
                  AND (claim_until_ts IS NULL OR claim_until_ts <= ?)
                "#,
            )
            .bind(claim_until_ts)
            .bind(now_rfc3339())
            .bind(task_id.as_str())
            .bind(now_ts)
            .bind(now_ts)
            .execute(&self.write_pool)
            .await
            .map_err(|err| err.to_string())?;
            if claim_result.rows_affected() == 0 {
                continue;
            }
            if let Some(task) = self.get_task(task_id.as_str()).await? {
                items.push(task);
            }
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
        let (next_run_ts, interval_minutes) =
            schedule_metadata_for_cron_expr(task.cron_expr.as_str(), now_ts)?;
        let summary = truncate(&result.change_summary, 4000);
        let output_data = json!({
            "is_significant_change": result.is_significant_change,
            "change_summary": summary,
            "new_snapshot": result.new_snapshot,
            "strategy_tag": result.strategy_tag,
            "observations": result.observations,
            "events": result.events,
        });
        let input_data = json!({
            "source": "desktop_local_worker",
            "model": result.model_id,
            "assistant_id": task.assistant_id,
            "analysis_mode": task.analysis_mode,
            "strategy": result.strategy_tag.clone().unwrap_or_else(|| task.analysis_mode.clone()),
            "task_input_source": monitor_task_input_source_for_run(task, Some(result.execution_id.as_str())),
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
        .execute(&self.write_pool)
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
                claim_until_ts = NULL,
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
        .execute(&self.write_pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn record_execution_failure(
        &self,
        task: &LocalMonitorTask,
        error_message: &str,
        events: Option<Vec<Value>>,
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
        let execution_events = events.unwrap_or_default();
        let execution_id = execution_events
            .first()
            .and_then(|event| event.get("execution_id"))
            .and_then(Value::as_str);
        let output_data = json!({
            "events": execution_events,
        });
        let input_data = json!({
            "source": "desktop_local_worker",
            "assistant_id": task.assistant_id,
            "analysis_mode": task.analysis_mode,
            "task_input_source": monitor_task_input_source_for_run(task, execution_id),
        });

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
        .bind(json_to_string(&input_data))
        .bind(json_to_string(&output_data))
        .bind(error_text)
        .bind(now_iso.as_str())
        .execute(&self.write_pool)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            r#"
            UPDATE local_monitor_tasks
            SET status = ?,
                error_count = ?,
                last_executed_ts = ?,
                next_run_ts = ?,
                claim_until_ts = NULL,
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
        .execute(&self.write_pool)
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
                claim_until_ts = NULL,
                updated_at = ?
            WHERE id = ? AND is_active = 1
            "#,
        )
        .bind(normalized_status)
        .bind(next_run_ts)
        .bind(now_rfc3339())
        .bind(task_id.trim())
        .execute(&self.write_pool)
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
    let policy_state_json: String = row
        .try_get("policy_state_json")
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
        display_status: row.try_get("status").map_err(|err| err.to_string())?,
        strategy_variants: None,
        analysis_mode: row
            .try_get::<String, _>("analysis_mode")
            .map(|value| normalize_analysis_mode(Some(value.as_str())))
            .map_err(|err| err.to_string())?,
        policy_state: parse_json_value(&policy_state_json),
        binding_state: "ok".to_string(),
        binding_error: None,
        assistant_id: row
            .try_get::<Option<String>, _>("assistant_id")
            .map_err(|err| err.to_string())?,
        assistant_name: None,
        model_id: row
            .try_get::<Option<String>, _>("model_id")
            .map_err(|err| err.to_string())?,
        error_count: row.try_get("error_count").map_err(|err| err.to_string())?,
        notify_config: normalize_monitor_notify_config(&parse_json_value(&notify_config_json)),
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

#[allow(dead_code)]
fn normalize_execution_target(raw: Option<&str>) -> String {
    let _ = raw;
    "desktop".to_string()
}

fn normalize_supported_cron_expr(raw: Option<&str>) -> Result<String, String> {
    let cron_expr = normalize_cron_expr(raw)?;
    parse_supported_cron_expr(&cron_expr)?;
    Ok(cron_expr)
}

fn normalize_desktop_execution_target(raw: Option<&str>) -> Result<String, String> {
    let normalized = raw.unwrap_or("desktop").trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" | "desktop" | "desktop_preferred" => Ok("desktop".to_string()),
        other => Err(format!(
            "desktop local monitor only supports execution_target=desktop, got '{}'",
            other
        )),
    }
}

fn normalize_assistant_id(raw: String) -> Result<String, String> {
    let value = raw.trim().to_string();
    if value.is_empty() {
        return Err("assistant_id 不能为空".to_string());
    }
    Ok(value)
}

fn normalize_analysis_mode(raw: Option<&str>) -> String {
    match raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_ANALYSIS_MODE)
        .to_ascii_lowercase()
        .as_str()
    {
        "deep" => "deep".to_string(),
        "alert_first" => "alert_first".to_string(),
        _ => DEFAULT_ANALYSIS_MODE.to_string(),
    }
}

fn normalize_notification_channel(raw: &str) -> Result<&'static str, String> {
    match raw.trim().to_lowercase().as_str() {
        "feishu" => Ok("feishu"),
        "wechat" => Ok("wechat"),
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

fn derive_delivery_state_status(
    anchor_message_id: Option<String>,
    anchor_context: Value,
) -> String {
    if anchor_message_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return "anchored".to_string();
    }
    if anchor_context
        .get("context_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return "context_ready".to_string();
    }
    "pending".to_string()
}

fn derive_channel_target_records(
    task_id: &str,
    channel: &LocalNotificationChannel,
) -> Vec<LocalMonitorDeliveryStateRecord> {
    match channel.channel.trim().to_lowercase().as_str() {
        "telegram" => config_string(&channel.config, "chat_id")
            .map(|chat_id| {
                vec![LocalMonitorDeliveryStateRecord {
                    task_id: task_id.to_string(),
                    channel_id: channel.id.clone(),
                    channel_kind: "telegram".to_string(),
                    channel_display_name: channel.display_name.clone(),
                    status: "pending".to_string(),
                    target_key: format!("telegram:{}", chat_id),
                    anchor_message_id: None,
                    anchor_context: json!({
                        "chat_id": chat_id,
                    }),
                    updated_at: channel.updated_at.clone(),
                }]
            })
            .unwrap_or_default(),
        "feishu" => config_string_list(&channel.config, "chat_ids")
            .into_iter()
            .map(|chat_id| LocalMonitorDeliveryStateRecord {
                task_id: task_id.to_string(),
                channel_id: channel.id.clone(),
                channel_kind: "feishu".to_string(),
                channel_display_name: channel.display_name.clone(),
                status: "pending".to_string(),
                target_key: format!("feishu:{}", chat_id),
                anchor_message_id: None,
                anchor_context: json!({
                    "chat_id": chat_id,
                }),
                updated_at: channel.updated_at.clone(),
            })
            .collect(),
        "wechat" => config_string_list(&channel.config, "notify_contact_ids")
            .into_iter()
            .map(|contact_id| LocalMonitorDeliveryStateRecord {
                task_id: task_id.to_string(),
                channel_id: channel.id.clone(),
                channel_kind: "wechat".to_string(),
                channel_display_name: channel.display_name.clone(),
                status: "waiting_for_contact_message".to_string(),
                target_key: format!("wechat:{}", contact_id),
                anchor_message_id: None,
                anchor_context: json!({
                    "contact_id": contact_id,
                }),
                updated_at: channel.updated_at.clone(),
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn config_string(config: &Value, key: &str) -> Option<String> {
    config
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn config_string_list(config: &Value, key: &str) -> Vec<String> {
    let Some(value) = config.get(key) else {
        return Vec::new();
    };
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        Value::String(text) => text
            .split(|ch| ch == '\n' || ch == ',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
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

#[allow(dead_code)]
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

#[allow(dead_code)]
fn parse_step(part: &str) -> Option<i64> {
    let part = part.trim();
    if !part.starts_with("*/") {
        return None;
    }
    let raw = part.trim_start_matches("*/");
    raw.parse::<i64>().ok().filter(|value| *value > 0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CronFieldMatcher {
    Any,
    Step(u8),
    Exact(u8),
}

fn parse_supported_cron_expr(
    cron_expr: &str,
) -> Result<(CronFieldMatcher, CronFieldMatcher), String> {
    let parts: Vec<&str> = cron_expr.split_whitespace().collect();
    if parts.len() != 5 {
        return Err("Cron 表达式非法: 必须是 5 段".to_string());
    }
    if parts[2] != "*" || parts[3] != "*" || parts[4] != "*" {
        return Err(
            "desktop local monitor 目前仅支持按分钟/小时的 5 段 Cron，且日/月/周字段必须为 *"
                .to_string(),
        );
    }
    Ok((
        parse_cron_field(parts[0], 59, "minute")?,
        parse_cron_field(parts[1], 23, "hour")?,
    ))
}

fn parse_cron_field(part: &str, max: u8, field_name: &str) -> Result<CronFieldMatcher, String> {
    let part = part.trim();
    if part == "*" {
        return Ok(CronFieldMatcher::Any);
    }
    if let Some(raw_step) = part.strip_prefix("*/") {
        let step = raw_step
            .parse::<u8>()
            .map_err(|_| format!("Cron 表达式非法: {} 字段步长无效", field_name))?;
        if step == 0 || step > max {
            return Err(format!(
                "Cron 表达式非法: {} 字段步长必须在 1..={} 之间",
                field_name, max
            ));
        }
        return Ok(CronFieldMatcher::Step(step));
    }
    let exact = part
        .parse::<u8>()
        .map_err(|_| format!("Cron 表达式非法: {} 字段仅支持 *, */n, 或整数", field_name))?;
    if exact > max {
        return Err(format!(
            "Cron 表达式非法: {} 字段必须在 0..={} 之间",
            field_name, max
        ));
    }
    Ok(CronFieldMatcher::Exact(exact))
}

fn schedule_metadata_for_cron_expr(cron_expr: &str, after_ts: i64) -> Result<(i64, i64), String> {
    let first = next_run_timestamp_after(cron_expr, after_ts)?;
    let second = next_run_timestamp_after(cron_expr, first)?;
    Ok((first, ((second - first) / 60).max(1)))
}

fn ensure_minimum_monitor_interval_minutes(interval_minutes: i64) -> Result<(), String> {
    if interval_minutes < MIN_MONITOR_INTERVAL_MINUTES {
        return Err(format!(
            "desktop local monitor 最小执行间隔为 {} 分钟，当前约为 {} 分钟",
            MIN_MONITOR_INTERVAL_MINUTES, interval_minutes
        ));
    }
    Ok(())
}

fn next_run_timestamp_after(cron_expr: &str, after_ts: i64) -> Result<i64, String> {
    let (minute_matcher, hour_matcher) = parse_supported_cron_expr(cron_expr)?;
    let mut candidate_ts = after_ts - after_ts.rem_euclid(60) + 60;
    for _ in 0..(366 * 24 * 60) {
        let candidate = time::OffsetDateTime::from_unix_timestamp(candidate_ts)
            .map_err(|err| err.to_string())?;
        if cron_field_matches(hour_matcher, candidate.hour())
            && cron_field_matches(minute_matcher, candidate.minute())
        {
            return Ok(candidate_ts);
        }
        candidate_ts += 60;
    }
    Err("Cron 表达式非法: 无法在一年内求出下一次执行时间".to_string())
}

fn cron_field_matches(matcher: CronFieldMatcher, value: u8) -> bool {
    match matcher {
        CronFieldMatcher::Any => true,
        CronFieldMatcher::Step(step) => value % step == 0,
        CronFieldMatcher::Exact(expected) => value == expected,
    }
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

async fn ensure_column(
    pool: &SqlitePool,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let pragma = format!("PRAGMA table_info({table})");
    let rows = sqlx::query(&pragma)
        .fetch_all(pool)
        .await
        .map_err(|err| err.to_string())?;
    let exists = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == column)
            .unwrap_or(false)
    });
    if exists {
        return Ok(());
    }

    let statement = format!("ALTER TABLE {table} ADD COLUMN {column} {definition}");
    sqlx::query(&statement)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn build_store() -> MonitorStore {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory sqlite pool");
        MonitorStore::with_pool(pool).await.expect("monitor store")
    }

    #[tokio::test]
    async fn create_task_rejects_blank_assistant_id() {
        let store = build_store().await;

        let error = store
            .create_task(LocalMonitorTaskCreateRequest {
                title: "Iran watch".to_string(),
                objective: "Monitor developments".to_string(),
                assistant_id: "   ".to_string(),
                cron_expr: None,
                analysis_mode: None,
                notify_config: None,
                allowed_tools: None,
                execution_target: None,
            })
            .await
            .expect_err("blank assistant_id should fail");

        assert_eq!(error, "assistant_id 不能为空");
    }

    #[tokio::test]
    async fn create_task_persists_analysis_mode_and_policy_state() {
        let store = build_store().await;

        let created = store
            .create_task(LocalMonitorTaskCreateRequest {
                title: "Iran watch".to_string(),
                objective: "Monitor developments".to_string(),
                assistant_id: "agent-1".to_string(),
                cron_expr: Some("0 */6 * * *".to_string()),
                analysis_mode: Some("alert_first".to_string()),
                notify_config: None,
                allowed_tools: None,
                execution_target: None,
            })
            .await
            .expect("task should be created");

        assert_eq!(created.assistant_id.as_deref(), Some("agent-1"));
        assert_eq!(created.analysis_mode, "alert_first");
        assert_eq!(created.policy_state, json!({}));
    }

    #[tokio::test]
    async fn record_execution_success_persists_cron_task_input_source() {
        let store = build_store().await;
        let task = store
            .create_task(LocalMonitorTaskCreateRequest {
                title: "Iran watch".to_string(),
                objective: "Monitor developments".to_string(),
                assistant_id: "agent-1".to_string(),
                cron_expr: Some("0 */6 * * *".to_string()),
                analysis_mode: Some("alert_first".to_string()),
                notify_config: None,
                allowed_tools: Some(vec!["search_sdk".to_string()]),
                execution_target: Some("desktop".to_string()),
            })
            .await
            .expect("task should be created");

        store
            .record_execution_success(
                &task,
                &LocalExecutionResult {
                    execution_id: "exec-success-1".to_string(),
                    is_significant_change: true,
                    change_summary: "changed".to_string(),
                    new_snapshot: json!({"state": "new"}),
                    strategy_tag: Some("alert_first".to_string()),
                    observations: Some(json!({"confidence": 0.9})),
                    tokens_used: 42,
                    model_id: "gpt-4.1".to_string(),
                    events: Vec::new(),
                },
            )
            .await
            .expect("success log should persist");

        let logs = store
            .list_logs(task.id.as_str(), 0, 10)
            .await
            .expect("logs should list");
        let input_data = logs.items[0]
            .input_data
            .as_ref()
            .expect("input data should exist");

        assert_eq!(
            input_data
                .pointer("/task_input_source/cron_monitor/task_id")
                .and_then(Value::as_str),
            Some(task.id.as_str())
        );
        assert_eq!(
            input_data
                .pointer("/task_input_source/cron_monitor/capability_lease/allowed_tools/0")
                .and_then(Value::as_str),
            Some("search_sdk")
        );
        assert_eq!(
            input_data
                .pointer("/task_input_source/cron_monitor/next_run_at")
                .and_then(Value::as_str),
            task.next_run_at.as_deref()
        );
        assert_eq!(
            input_data.pointer("/task_input_source/cron_monitor/capability_lease/expires_at"),
            Some(&Value::Null)
        );
        assert_eq!(
            input_data
                .pointer("/task_input_source/cron_monitor/execution_id")
                .and_then(Value::as_str),
            Some("exec-success-1")
        );
        assert_eq!(
            input_data
                .pointer("/task_input_source/cron_monitor/execution_frame_id")
                .and_then(Value::as_str),
            Some(format!("monitor:{}:execution:exec-success-1", task.id).as_str())
        );
    }

    #[tokio::test]
    async fn record_execution_failure_persists_cron_task_input_source() {
        let store = build_store().await;
        let task = store
            .create_task(LocalMonitorTaskCreateRequest {
                title: "Iran watch".to_string(),
                objective: "Monitor developments".to_string(),
                assistant_id: "agent-1".to_string(),
                cron_expr: Some("0 */6 * * *".to_string()),
                analysis_mode: None,
                notify_config: None,
                allowed_tools: Some(vec!["search_sdk".to_string()]),
                execution_target: Some("desktop".to_string()),
            })
            .await
            .expect("task should be created");

        store
            .record_execution_failure(
                &task,
                "provider failed",
                Some(vec![
                    json!({"stage": "run", "execution_id": "exec-failure-1"}),
                ]),
            )
            .await
            .expect("failure log should persist");

        let logs = store
            .list_logs(task.id.as_str(), 0, 10)
            .await
            .expect("logs should list");
        let input_data = logs.items[0]
            .input_data
            .as_ref()
            .expect("input data should exist");

        assert_eq!(
            input_data
                .pointer("/task_input_source/cron_monitor/task_id")
                .and_then(Value::as_str),
            Some(task.id.as_str())
        );
        assert_eq!(
            input_data
                .pointer("/task_input_source/cron_monitor/checkpoint_policy")
                .and_then(Value::as_str),
            Some("on_change_only")
        );
        assert_eq!(
            input_data
                .pointer("/task_input_source/cron_monitor/next_run_at")
                .and_then(Value::as_str),
            task.next_run_at.as_deref()
        );
        assert_eq!(
            input_data.pointer("/task_input_source/cron_monitor/capability_lease/expires_at"),
            Some(&Value::Null)
        );
        assert_eq!(
            input_data
                .pointer("/task_input_source/cron_monitor/execution_id")
                .and_then(Value::as_str),
            Some("exec-failure-1")
        );
        assert_eq!(
            input_data
                .pointer("/task_input_source/cron_monitor/execution_frame_id")
                .and_then(Value::as_str),
            Some(format!("monitor:{}:execution:exec-failure-1", task.id).as_str())
        );
    }

    #[tokio::test]
    async fn create_task_rejects_when_task_cap_is_reached() {
        let store = build_store().await;

        for index in 0..MAX_LOCAL_MONITOR_TASKS {
            store
                .create_task(LocalMonitorTaskCreateRequest {
                    title: format!("task-{index}"),
                    objective: "Monitor developments".to_string(),
                    assistant_id: "agent-1".to_string(),
                    cron_expr: Some("0 */6 * * *".to_string()),
                    analysis_mode: None,
                    notify_config: None,
                    allowed_tools: None,
                    execution_target: None,
                })
                .await
                .expect("task should be created");
        }

        let error = store
            .create_task(LocalMonitorTaskCreateRequest {
                title: "task-over-limit".to_string(),
                objective: "Monitor developments".to_string(),
                assistant_id: "agent-1".to_string(),
                cron_expr: Some("0 */6 * * *".to_string()),
                analysis_mode: None,
                notify_config: None,
                allowed_tools: None,
                execution_target: None,
            })
            .await
            .expect_err("task cap should be enforced");

        assert!(error.contains("最多允许"));
    }

    #[test]
    fn schedule_metadata_aligns_fixed_daily_cron_to_wall_clock() {
        let now = time::OffsetDateTime::parse(
            "2026-03-25T08:10:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("timestamp")
        .unix_timestamp();

        let (next_run_ts, cadence_minutes) =
            schedule_metadata_for_cron_expr("0 9 * * *", now).expect("schedule");

        assert_eq!(
            ts_to_rfc3339(next_run_ts).as_deref(),
            Some("2026-03-25T09:00:00Z")
        );
        assert_eq!(cadence_minutes, 24 * 60);
    }

    #[test]
    fn schedule_metadata_aligns_hour_step_cron_to_wall_clock() {
        let now = time::OffsetDateTime::parse(
            "2026-03-25T08:10:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("timestamp")
        .unix_timestamp();

        let (next_run_ts, cadence_minutes) =
            schedule_metadata_for_cron_expr("0 */6 * * *", now).expect("schedule");

        assert_eq!(
            ts_to_rfc3339(next_run_ts).as_deref(),
            Some("2026-03-25T12:00:00Z")
        );
        assert_eq!(cadence_minutes, 6 * 60);
    }

    #[test]
    fn normalize_supported_cron_expr_rejects_unsupported_day_of_month() {
        let error = normalize_supported_cron_expr(Some("0 9 1 * *")).expect_err("cron should fail");
        assert!(error.contains("desktop local monitor"));
    }

    #[test]
    fn minimum_interval_rejects_every_minute_cron() {
        let now = time::OffsetDateTime::parse(
            "2026-03-25T08:10:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("timestamp")
        .unix_timestamp();

        let (_, cadence_minutes) =
            schedule_metadata_for_cron_expr("*/1 * * * *", now).expect("schedule");
        let error = ensure_minimum_monitor_interval_minutes(cadence_minutes)
            .expect_err("interval should fail");

        assert!(error.contains("最小执行间隔"));
    }

    #[tokio::test]
    async fn create_task_rejects_every_minute_cron() {
        let store = build_store().await;

        let error = store
            .create_task(LocalMonitorTaskCreateRequest {
                title: "too-fast".to_string(),
                objective: "Monitor developments".to_string(),
                assistant_id: "agent-1".to_string(),
                cron_expr: Some("*/1 * * * *".to_string()),
                analysis_mode: None,
                notify_config: None,
                allowed_tools: None,
                execution_target: None,
            })
            .await
            .expect_err("fast cron should fail");

        assert!(error.contains("最小执行间隔"));
    }

    #[tokio::test]
    async fn list_due_tasks_claims_rows_until_execution_finishes() {
        let store = build_store().await;

        let created = store
            .create_task(LocalMonitorTaskCreateRequest {
                title: "Iran watch".to_string(),
                objective: "Monitor developments".to_string(),
                assistant_id: "agent-1".to_string(),
                cron_expr: Some("*/30 * * * *".to_string()),
                analysis_mode: None,
                notify_config: None,
                allowed_tools: None,
                execution_target: None,
            })
            .await
            .expect("task should be created");

        store
            .trigger_task(created.id.as_str())
            .await
            .expect("trigger should succeed");

        let first = store.list_due_tasks(5).await.expect("claim should succeed");
        let second = store
            .list_due_tasks(5)
            .await
            .expect("second claim should succeed");

        assert_eq!(first.len(), 1);
        assert_eq!(first[0].id, created.id);
        assert!(second.is_empty());
    }

    #[test]
    fn normalize_notification_channel_accepts_wechat() {
        assert_eq!(
            normalize_notification_channel("wechat").expect("wechat should be accepted"),
            "wechat"
        );
    }

    #[tokio::test]
    async fn delivery_state_round_trips_anchor_message_and_context() {
        let store = build_store().await;

        store
            .upsert_delivery_state(
                "task-1",
                "channel-1",
                "telegram:chat-1",
                Some("msg-1"),
                Some(&json!({
                    "chat_id": "chat-1"
                })),
            )
            .await
            .expect("state should persist");

        let state = store
            .get_delivery_state("task-1", "channel-1", "telegram:chat-1")
            .await
            .expect("query should succeed")
            .expect("state should exist");

        assert_eq!(state.anchor_message_id.as_deref(), Some("msg-1"));
        assert_eq!(state.anchor_context, json!({"chat_id": "chat-1"}));
    }

    #[tokio::test]
    async fn delivery_state_upsert_replaces_existing_anchor() {
        let store = build_store().await;

        store
            .upsert_delivery_state(
                "task-1",
                "channel-1",
                "feishu:chat-1",
                Some("msg-1"),
                Some(&json!({"root_id": "msg-1"})),
            )
            .await
            .expect("initial state should persist");
        store
            .upsert_delivery_state(
                "task-1",
                "channel-1",
                "feishu:chat-1",
                Some("msg-2"),
                Some(&json!({"root_id": "msg-2"})),
            )
            .await
            .expect("updated state should persist");

        let state = store
            .get_delivery_state("task-1", "channel-1", "feishu:chat-1")
            .await
            .expect("query should succeed")
            .expect("state should exist");

        assert_eq!(state.anchor_message_id.as_deref(), Some("msg-2"));
        assert_eq!(state.anchor_context, json!({"root_id": "msg-2"}));
    }

    #[tokio::test]
    async fn list_delivery_states_returns_all_records_for_task() {
        let store = build_store().await;

        let task = store
            .create_task(LocalMonitorTaskCreateRequest {
                title: "Iran watch".to_string(),
                objective: "Monitor developments".to_string(),
                assistant_id: "agent-1".to_string(),
                cron_expr: None,
                analysis_mode: None,
                notify_config: Some(json!({})),
                allowed_tools: None,
                execution_target: None,
            })
            .await
            .expect("task should be created");

        store
            .upsert_delivery_state(
                task.id.as_str(),
                "channel-1",
                "telegram:chat-1",
                Some("msg-1"),
                Some(&json!({"chat_id": "chat-1"})),
            )
            .await
            .expect("telegram anchor should persist");
        store
            .upsert_delivery_state(
                task.id.as_str(),
                "channel-2",
                "wechat:user-1",
                None,
                Some(&json!({"context_token": "ctx-1"})),
            )
            .await
            .expect("wechat anchor should persist");

        let states = store
            .list_delivery_states(task.id.as_str())
            .await
            .expect("list should succeed");

        assert_eq!(states.total, 2);
        assert!(states
            .items
            .iter()
            .any(|item| item.target_key == "telegram:chat-1"));
        assert!(states
            .items
            .iter()
            .any(|item| item.target_key == "wechat:user-1"));
    }

    #[tokio::test]
    async fn list_delivery_states_derives_pending_targets_from_task_channel_config() {
        let store = build_store().await;

        let telegram = store
            .create_notification_channel(LocalNotificationChannelCreateRequest {
                channel: "telegram".to_string(),
                config: json!({
                    "bot_token": "bot-token",
                    "chat_id": "12345"
                }),
                display_name: Some("Telegram 战情群".to_string()),
                priority: None,
            })
            .await
            .expect("telegram channel should be created");
        let wechat = store
            .create_notification_channel(LocalNotificationChannelCreateRequest {
                channel: "wechat".to_string(),
                config: json!({
                    "im_enabled": true,
                    "notify_contact_ids": ["wx-user-1"]
                }),
                display_name: Some("微信值班人".to_string()),
                priority: None,
            })
            .await
            .expect("wechat channel should be created");

        let task = store
            .create_task(LocalMonitorTaskCreateRequest {
                title: "Iran watch".to_string(),
                objective: "Monitor developments".to_string(),
                assistant_id: "agent-1".to_string(),
                cron_expr: None,
                analysis_mode: None,
                notify_config: Some(json!({
                    "channel_ids": [telegram.id, wechat.id]
                })),
                allowed_tools: None,
                execution_target: None,
            })
            .await
            .expect("task should be created");

        let states = store
            .list_delivery_states(task.id.as_str())
            .await
            .expect("list should succeed");

        assert_eq!(states.total, 2);
        assert!(states.items.iter().any(|item| {
            item.channel_kind == "telegram"
                && item.target_key == "telegram:12345"
                && item.status == "pending"
        }));
        assert!(states.items.iter().any(|item| {
            item.channel_kind == "wechat"
                && item.target_key == "wechat:wx-user-1"
                && item.status == "waiting_for_contact_message"
        }));
    }
}
