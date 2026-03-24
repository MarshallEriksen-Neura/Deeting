use sqlx::{sqlite::SqliteRow, Row};
use uuid::Uuid;

use crate::modules::image_generation::types::{
    LocalImageGenerationOutputItem, LocalImageGenerationTaskCreateRequest,
    LocalImageGenerationTaskCreateResponse, LocalImageGenerationTaskDetail,
    LocalImageGenerationTaskItem, LocalImageGenerationTaskPage, LocalImageGenerationTasksQuery,
};
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

const TASK_TABLE: &str = "local_image_generation_task";

#[derive(Debug, Clone)]
pub struct LocalImageGenerationTaskRecord {
    pub task_id: String,
    pub session_id: Option<String>,
    pub request_id: Option<String>,
    pub model: String,
    pub provider_model_id: String,
    pub prompt: String,
    pub prompt_encrypted: bool,
    pub negative_prompt: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub aspect_ratio: Option<String>,
    pub num_outputs: Option<i64>,
    pub steps: Option<i64>,
    pub cfg_scale: Option<f64>,
    pub seed: Option<i64>,
    pub sampler_name: Option<String>,
    pub quality: Option<String>,
    pub style: Option<String>,
    pub response_format: Option<String>,
    pub image_url: Option<String>,
    pub extra_params: Option<serde_json::Value>,
    pub status: String,
}

pub async fn ensure_schema(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {TASK_TABLE} (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          request_id TEXT,
          status TEXT NOT NULL,
          model TEXT NOT NULL,
          provider_model_id TEXT NOT NULL,
          prompt TEXT NOT NULL,
          prompt_encrypted INTEGER NOT NULL DEFAULT 0,
          negative_prompt TEXT,
          width INTEGER,
          height INTEGER,
          aspect_ratio TEXT,
          num_outputs INTEGER,
          steps INTEGER,
          cfg_scale REAL,
          seed INTEGER,
          sampler_name TEXT,
          quality TEXT,
          style TEXT,
          response_format TEXT,
          image_url TEXT,
          extra_params_json TEXT,
          outputs_json TEXT NOT NULL DEFAULT '[]',
          upstream_mode TEXT NOT NULL DEFAULT 'direct',
          error_code TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        );
        "#
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;
    ensure_column(store, "width", "INTEGER").await?;
    ensure_column(store, "height", "INTEGER").await?;
    ensure_column(store, "num_outputs", "INTEGER").await?;
    ensure_column(store, "sampler_name", "TEXT").await?;
    ensure_column(store, "quality", "TEXT").await?;
    ensure_column(store, "style", "TEXT").await?;
    ensure_column(store, "response_format", "TEXT").await?;
    ensure_column(store, "image_url", "TEXT").await?;
    ensure_column(store, "extra_params_json", "TEXT").await?;
    Ok(())
}

pub async fn create_task(
    store: &McpStore,
    payload: &LocalImageGenerationTaskCreateRequest,
) -> Result<LocalImageGenerationTaskCreateResponse, McpError> {
    ensure_schema(store).await?;
    let id = Uuid::new_v4().to_string();
    let now = now_rfc3339()?;
    sqlx::query(&format!(
        r#"
        INSERT INTO {TASK_TABLE}
          (id, session_id, request_id, status, model, provider_model_id, prompt, prompt_encrypted,
           negative_prompt, width, height, aspect_ratio, num_outputs, steps, cfg_scale, seed,
           sampler_name, quality, style, response_format, image_url, extra_params_json,
           outputs_json, upstream_mode, error_code, error_message, created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'unknown', NULL, NULL, ?, ?, NULL);
        "#
    ))
    .bind(&id)
    .bind(payload.session_id.as_deref())
    .bind(payload.request_id.as_deref())
    .bind("queued")
    .bind(payload.model.trim())
    .bind(payload.provider_model_id.trim())
    .bind(payload.prompt.trim())
    .bind(if payload.encrypt_prompt.unwrap_or(false) {
        1
    } else {
        0
    })
    .bind(payload.negative_prompt.as_deref())
    .bind(payload.width)
    .bind(payload.height)
    .bind(payload.aspect_ratio.as_deref())
    .bind(payload.num_outputs)
    .bind(payload.steps)
    .bind(payload.cfg_scale)
    .bind(payload.seed)
    .bind(payload.sampler_name.as_deref())
    .bind(payload.quality.as_deref())
    .bind(payload.style.as_deref())
    .bind(payload.response_format.as_deref())
    .bind(payload.image_url.as_deref())
    .bind(serialize_optional_json(payload.extra_params.as_ref())?)
    .bind(&now)
    .bind(&now)
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(LocalImageGenerationTaskCreateResponse {
        task_id: id,
        status: "queued".to_string(),
        created_at: now,
        deduped: Some(false),
    })
}

pub async fn get_task(
    store: &McpStore,
    task_id: &str,
) -> Result<Option<LocalImageGenerationTaskDetail>, McpError> {
    ensure_schema(store).await?;
    let row = sqlx::query(&format!("SELECT * FROM {TASK_TABLE} WHERE id = ? LIMIT 1"))
        .bind(task_id.trim())
        .fetch_optional(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    row.as_ref().map(row_to_detail).transpose()
}

pub async fn get_task_record(
    store: &McpStore,
    task_id: &str,
) -> Result<Option<LocalImageGenerationTaskRecord>, McpError> {
    ensure_schema(store).await?;
    let row = sqlx::query(&format!("SELECT * FROM {TASK_TABLE} WHERE id = ? LIMIT 1"))
        .bind(task_id.trim())
        .fetch_optional(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    row.as_ref().map(row_to_record).transpose()
}

pub async fn list_tasks(
    store: &McpStore,
    query: &LocalImageGenerationTasksQuery,
) -> Result<LocalImageGenerationTaskPage, McpError> {
    ensure_schema(store).await?;
    let mut sql = format!("SELECT * FROM {TASK_TABLE}");
    let mut conditions = Vec::new();
    if query
        .session_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        conditions.push("session_id = ?".to_string());
    }
    if query
        .status
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        conditions.push("status = ?".to_string());
    }
    if !conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
    }
    sql.push_str(" ORDER BY updated_at DESC, created_at DESC");
    if let Some(size) = query.size {
        sql.push_str(&format!(" LIMIT {}", size.max(1)));
    }
    let mut statement = sqlx::query(&sql);
    if let Some(session_id) = query
        .session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        statement = statement.bind(session_id.trim());
    }
    if let Some(status) = query
        .status
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        statement = statement.bind(status.trim());
    }
    let rows = statement
        .fetch_all(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let items = rows
        .iter()
        .map(row_to_item)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(LocalImageGenerationTaskPage {
        items,
        next_page: None,
        previous_page: None,
    })
}

pub async fn cancel_task_by_request_id(
    store: &McpStore,
    request_id: &str,
) -> Result<crate::modules::image_generation::types::LocalImageGenerationCancelResponse, McpError> {
    ensure_schema(store).await?;
    let now = now_rfc3339()?;
    sqlx::query(&format!(
        "UPDATE {TASK_TABLE} SET status = 'canceled', updated_at = ?, completed_at = COALESCE(completed_at, ?) WHERE request_id = ? AND status NOT IN ('succeeded','failed','canceled')"
    ))
    .bind(&now)
    .bind(&now)
    .bind(request_id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(
        crate::modules::image_generation::types::LocalImageGenerationCancelResponse {
            request_id: request_id.trim().to_string(),
            status: "canceled".to_string(),
        },
    )
}

pub async fn mark_task_running(store: &McpStore, task_id: &str) -> Result<(), McpError> {
    update_task_status(store, task_id, "running", None, None, None, None).await
}

pub async fn mark_task_failed(
    store: &McpStore,
    task_id: &str,
    error_message: &str,
) -> Result<(), McpError> {
    update_task_status(
        store,
        task_id,
        "failed",
        None,
        Some("upstream_failed"),
        Some(error_message),
        Some(now_rfc3339()?),
    )
    .await
}

pub async fn mark_task_succeeded(
    store: &McpStore,
    task_id: &str,
    outputs: &[LocalImageGenerationOutputItem],
    upstream_mode: &str,
) -> Result<(), McpError> {
    update_task_status(
        store,
        task_id,
        "succeeded",
        Some(outputs),
        None,
        None,
        Some(now_rfc3339()?),
    )
    .await?;
    sqlx::query(&format!(
        "UPDATE {TASK_TABLE} SET upstream_mode = ? WHERE id = ?"
    ))
    .bind(upstream_mode)
    .bind(task_id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(())
}

async fn update_task_status(
    store: &McpStore,
    task_id: &str,
    status: &str,
    outputs: Option<&[LocalImageGenerationOutputItem]>,
    error_code: Option<&str>,
    error_message: Option<&str>,
    completed_at: Option<String>,
) -> Result<(), McpError> {
    let now = now_rfc3339()?;
    let outputs_json = match outputs {
        Some(items) => {
            serde_json::to_string(items).map_err(|err| McpError::Storage(err.to_string()))?
        }
        None => "[]".to_string(),
    };
    sqlx::query(&format!(
        r#"
        UPDATE {TASK_TABLE}
        SET status = ?, outputs_json = ?, error_code = ?, error_message = ?, updated_at = ?, completed_at = ?
        WHERE id = ?;
        "#
    ))
    .bind(status)
    .bind(outputs_json)
    .bind(error_code)
    .bind(error_message)
    .bind(&now)
    .bind(completed_at.as_deref())
    .bind(task_id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(())
}

fn row_to_detail(row: &SqliteRow) -> Result<LocalImageGenerationTaskDetail, McpError> {
    let outputs = parse_outputs(row)?;
    Ok(LocalImageGenerationTaskDetail {
        task_id: row.try_get("id").map_err(storage_err)?,
        status: row.try_get("status").map_err(storage_err)?,
        model: row.try_get("model").map_err(storage_err)?,
        created_at: row.try_get("created_at").map_err(storage_err)?,
        updated_at: row.try_get("updated_at").map_err(storage_err)?,
        completed_at: row.try_get("completed_at").map_err(storage_err)?,
        error_code: row.try_get("error_code").map_err(storage_err)?,
        error_message: row.try_get("error_message").map_err(storage_err)?,
        outputs,
    })
}

fn row_to_item(row: &SqliteRow) -> Result<LocalImageGenerationTaskItem, McpError> {
    let outputs = parse_outputs(row)?;
    let preview = outputs.first().cloned();
    Ok(LocalImageGenerationTaskItem {
        task_id: row.try_get("id").map_err(storage_err)?,
        status: row.try_get("status").map_err(storage_err)?,
        model: row.try_get("model").map_err(storage_err)?,
        session_id: row.try_get("session_id").map_err(storage_err)?,
        prompt: row.try_get("prompt").map_err(storage_err)?,
        prompt_encrypted: Some(
            row.try_get::<i64, _>("prompt_encrypted")
                .map_err(storage_err)
                .map(|value| value != 0)?,
        ),
        negative_prompt: row.try_get("negative_prompt").map_err(storage_err)?,
        aspect_ratio: row.try_get("aspect_ratio").map_err(storage_err)?,
        steps: row.try_get("steps").map_err(storage_err)?,
        cfg_scale: row.try_get("cfg_scale").map_err(storage_err)?,
        seed: row.try_get("seed").map_err(storage_err)?,
        provider_model_id: row.try_get("provider_model_id").map_err(storage_err)?,
        created_at: row.try_get("created_at").map_err(storage_err)?,
        updated_at: row.try_get("updated_at").map_err(storage_err)?,
        completed_at: row.try_get("completed_at").map_err(storage_err)?,
        error_code: row.try_get("error_code").map_err(storage_err)?,
        error_message: row.try_get("error_message").map_err(storage_err)?,
        preview,
    })
}

fn row_to_record(row: &SqliteRow) -> Result<LocalImageGenerationTaskRecord, McpError> {
    Ok(LocalImageGenerationTaskRecord {
        task_id: row.try_get("id").map_err(storage_err)?,
        session_id: row.try_get("session_id").map_err(storage_err)?,
        request_id: row.try_get("request_id").map_err(storage_err)?,
        model: row.try_get("model").map_err(storage_err)?,
        provider_model_id: row.try_get("provider_model_id").map_err(storage_err)?,
        prompt: row.try_get("prompt").map_err(storage_err)?,
        prompt_encrypted: row
            .try_get::<i64, _>("prompt_encrypted")
            .map_err(storage_err)
            .map(|value| value != 0)?,
        negative_prompt: row.try_get("negative_prompt").map_err(storage_err)?,
        width: row.try_get("width").map_err(storage_err)?,
        height: row.try_get("height").map_err(storage_err)?,
        aspect_ratio: row.try_get("aspect_ratio").map_err(storage_err)?,
        num_outputs: row.try_get("num_outputs").map_err(storage_err)?,
        steps: row.try_get("steps").map_err(storage_err)?,
        cfg_scale: row.try_get("cfg_scale").map_err(storage_err)?,
        seed: row.try_get("seed").map_err(storage_err)?,
        sampler_name: row.try_get("sampler_name").map_err(storage_err)?,
        quality: row.try_get("quality").map_err(storage_err)?,
        style: row.try_get("style").map_err(storage_err)?,
        response_format: row.try_get("response_format").map_err(storage_err)?,
        image_url: row.try_get("image_url").map_err(storage_err)?,
        extra_params: parse_optional_json_value(
            row.try_get("extra_params_json").map_err(storage_err)?,
        )?,
        status: row.try_get("status").map_err(storage_err)?,
    })
}

fn parse_outputs(row: &SqliteRow) -> Result<Vec<LocalImageGenerationOutputItem>, McpError> {
    let raw: String = row.try_get("outputs_json").map_err(storage_err)?;
    serde_json::from_str(&raw).map_err(|err| McpError::Storage(err.to_string()))
}

fn now_rfc3339() -> Result<String, McpError> {
    Ok(time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| McpError::Storage(err.to_string()))?)
}

fn storage_err(err: sqlx::Error) -> McpError {
    McpError::Storage(err.to_string())
}

async fn ensure_column(
    store: &McpStore,
    column_name: &str,
    column_def: &str,
) -> Result<(), McpError> {
    if !table_has_column(store, column_name).await? {
        sqlx::query(&format!(
            "ALTER TABLE {TASK_TABLE} ADD COLUMN {column_name} {column_def};"
        ))
        .execute(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    }
    Ok(())
}

async fn table_has_column(store: &McpStore, column_name: &str) -> Result<bool, McpError> {
    let rows = sqlx::query(&format!("PRAGMA table_info({TASK_TABLE});"))
        .fetch_all(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|value| value == column_name)
            .unwrap_or(false)
    }))
}

fn serialize_optional_json(value: Option<&serde_json::Value>) -> Result<Option<String>, McpError> {
    value
        .map(|item| serde_json::to_string(item).map_err(|err| McpError::Storage(err.to_string())))
        .transpose()
}

fn parse_optional_json_value(raw: Option<String>) -> Result<Option<serde_json::Value>, McpError> {
    raw.filter(|value| !value.trim().is_empty())
        .map(|value| serde_json::from_str(&value).map_err(|err| McpError::Storage(err.to_string())))
        .transpose()
}
