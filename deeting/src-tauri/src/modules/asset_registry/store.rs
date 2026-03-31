use super::types::{ListLocalAssetsRequest, LocalAssetRecord, UpdateLocalAssetRequest};
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use sqlx::Row;
use time::OffsetDateTime;

const LOCAL_ASSET_REGISTRY_TABLE: &str = "local_asset_registry";
const LOCAL_ASSET_SELECT_COLUMNS: &str = r#"
    asset_id, asset_kind, title, summary, origin_session_id, origin_turn_index, source_block_id,
    source_view_type, render_hint, template_id, template_version, html_entry, data_mode,
    match_hints_json, props_hint_json, output_example_json, latest_snapshot_html,
    latest_render_data_json, refresh_spec_json, status, is_pinned, is_archived,
    created_at, updated_at, last_refreshed_at, last_opened_at
"#;

pub(crate) async fn init_asset_registry_tables(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {LOCAL_ASSET_REGISTRY_TABLE} (
          asset_id TEXT PRIMARY KEY,
          asset_kind TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT,
          origin_session_id TEXT NOT NULL,
          origin_turn_index INTEGER NOT NULL,
          source_block_id TEXT,
          source_view_type TEXT NOT NULL,
          render_hint TEXT,
          template_id TEXT,
          template_version TEXT,
          html_entry TEXT,
          data_mode TEXT,
          match_hints_json TEXT,
          props_hint_json TEXT,
          output_example_json TEXT,
          latest_snapshot_html TEXT,
          latest_render_data_json TEXT,
          refresh_spec_json TEXT,
          status TEXT NOT NULL,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_refreshed_at TEXT,
          last_opened_at TEXT
        );
        "#
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    ensure_asset_registry_column(store, "html_entry", "TEXT").await?;
    ensure_asset_registry_column(store, "data_mode", "TEXT").await?;
    ensure_asset_registry_column(store, "match_hints_json", "TEXT").await?;
    ensure_asset_registry_column(store, "props_hint_json", "TEXT").await?;
    ensure_asset_registry_column(store, "output_example_json", "TEXT").await?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{LOCAL_ASSET_REGISTRY_TABLE}_origin ON {LOCAL_ASSET_REGISTRY_TABLE}(origin_session_id, origin_turn_index);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{LOCAL_ASSET_REGISTRY_TABLE}_status ON {LOCAL_ASSET_REGISTRY_TABLE}(status, is_archived, is_pinned);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(())
}

async fn ensure_asset_registry_column(
    store: &McpStore,
    column_name: &str,
    column_definition: &str,
) -> Result<(), McpError> {
    let query = format!(
        "ALTER TABLE {LOCAL_ASSET_REGISTRY_TABLE} ADD COLUMN {column_name} {column_definition};"
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
    pub async fn upsert_local_asset_record(
        &self,
        record: &LocalAssetRecord,
    ) -> Result<(), McpError> {
        sqlx::query(&format!(
            r#"
            INSERT INTO {LOCAL_ASSET_REGISTRY_TABLE}
              (asset_id, asset_kind, title, summary, origin_session_id, origin_turn_index, source_block_id,
               source_view_type, render_hint, template_id, template_version, html_entry, data_mode,
               match_hints_json, props_hint_json, output_example_json, latest_snapshot_html,
               latest_render_data_json, refresh_spec_json, status, is_pinned, is_archived,
               created_at, updated_at, last_refreshed_at, last_opened_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(asset_id) DO UPDATE SET
              title = excluded.title,
              summary = excluded.summary,
              render_hint = excluded.render_hint,
              template_id = excluded.template_id,
              template_version = excluded.template_version,
              html_entry = excluded.html_entry,
              data_mode = excluded.data_mode,
              match_hints_json = excluded.match_hints_json,
              props_hint_json = excluded.props_hint_json,
              output_example_json = excluded.output_example_json,
              latest_snapshot_html = excluded.latest_snapshot_html,
              latest_render_data_json = excluded.latest_render_data_json,
              refresh_spec_json = excluded.refresh_spec_json,
              status = excluded.status,
              updated_at = excluded.updated_at,
              last_refreshed_at = excluded.last_refreshed_at,
              last_opened_at = excluded.last_opened_at
            "#
        ))
        .bind(&record.asset_id)
        .bind(&record.asset_kind)
        .bind(&record.title)
        .bind(&record.summary)
        .bind(&record.origin_session_id)
        .bind(record.origin_turn_index)
        .bind(&record.source_block_id)
        .bind(&record.source_view_type)
        .bind(&record.render_hint)
        .bind(&record.template_id)
        .bind(&record.template_version)
        .bind(&record.html_entry)
        .bind(&record.data_mode)
        .bind(&record.match_hints_json)
        .bind(&record.props_hint_json)
        .bind(&record.output_example_json)
        .bind(&record.latest_snapshot_html)
        .bind(&record.latest_render_data_json)
        .bind(&record.refresh_spec_json)
        .bind(&record.status)
        .bind(if record.is_pinned { 1_i64 } else { 0_i64 })
        .bind(if record.is_archived { 1_i64 } else { 0_i64 })
        .bind(&record.created_at)
        .bind(&record.updated_at)
        .bind(&record.last_refreshed_at)
        .bind(&record.last_opened_at)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn list_recent_local_assets(
        &self,
        limit: usize,
    ) -> Result<Vec<LocalAssetRecord>, McpError> {
        let rows = sqlx::query(&format!(
            r#"
            SELECT {LOCAL_ASSET_SELECT_COLUMNS}
            FROM {LOCAL_ASSET_REGISTRY_TABLE}
            WHERE is_archived = 0
            ORDER BY updated_at DESC, created_at DESC
            LIMIT ?
            "#
        ))
        .bind(limit.max(1) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter().map(row_to_local_asset_record).collect()
    }

    pub async fn list_active_local_assets_by_kind(
        &self,
        asset_kind: &str,
    ) -> Result<Vec<LocalAssetRecord>, McpError> {
        let normalized_asset_kind = asset_kind.trim();
        if normalized_asset_kind.is_empty() {
            return Ok(Vec::new());
        }

        let rows = sqlx::query(&format!(
            r#"
            SELECT {LOCAL_ASSET_SELECT_COLUMNS}
            FROM {LOCAL_ASSET_REGISTRY_TABLE}
            WHERE is_archived = 0
              AND LOWER(status) = 'active'
              AND asset_kind = ?
            ORDER BY is_pinned DESC, updated_at DESC, created_at DESC
            "#
        ))
        .bind(normalized_asset_kind)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter().map(row_to_local_asset_record).collect()
    }

    pub async fn get_local_asset_record(
        &self,
        asset_id: &str,
    ) -> Result<Option<LocalAssetRecord>, McpError> {
        let normalized_asset_id = asset_id.trim();
        if normalized_asset_id.is_empty() {
            return Ok(None);
        }

        let row = sqlx::query(&format!(
            r#"
            SELECT {LOCAL_ASSET_SELECT_COLUMNS}
            FROM {LOCAL_ASSET_REGISTRY_TABLE}
            WHERE asset_id = ?
            LIMIT 1
            "#
        ))
        .bind(normalized_asset_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(row_to_local_asset_record).transpose()
    }
}

pub(crate) async fn list_local_assets(
    store: &McpStore,
    request: ListLocalAssetsRequest,
) -> Result<Vec<LocalAssetRecord>, McpError> {
    let asset_id = request
        .asset_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let limit = request.limit.unwrap_or(50).max(1) as i64;
    let pinned_only = request.pinned_only.unwrap_or(false);
    let include_archived = request.include_archived.unwrap_or(false);

    let rows = sqlx::query(&format!(
        r#"
        SELECT {LOCAL_ASSET_SELECT_COLUMNS}
        FROM {LOCAL_ASSET_REGISTRY_TABLE}
        WHERE (? = 1 OR is_archived = 0)
          AND (? = 0 OR is_pinned = 1)
          AND (? IS NULL OR asset_id = ?)
        ORDER BY is_pinned DESC, updated_at DESC, created_at DESC
        LIMIT ?
        "#
    ))
    .bind(if include_archived { 1_i64 } else { 0_i64 })
    .bind(if pinned_only { 1_i64 } else { 0_i64 })
    .bind(asset_id.as_deref())
    .bind(asset_id.as_deref())
    .bind(limit)
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    rows.into_iter().map(row_to_local_asset_record).collect()
}

pub(crate) async fn update_local_asset_record(
    store: &McpStore,
    asset_id: &str,
    request: UpdateLocalAssetRequest,
) -> Result<LocalAssetRecord, McpError> {
    let mut record = store
        .get_local_asset_record(asset_id)
        .await?
        .ok_or_else(|| McpError::NotFound("local asset not found".to_string()))?;
    let now = OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| McpError::Storage(err.to_string()))?;

    if let Some(value) = request.is_pinned {
        record.is_pinned = value;
    }
    if let Some(value) = request.is_archived {
        record.is_archived = value;
    }
    if request.mark_opened.unwrap_or(false) {
        record.last_opened_at = Some(now.clone());
    }
    record.updated_at = now;

    store.upsert_local_asset_record(&record).await?;
    Ok(record)
}

fn row_to_local_asset_record(row: sqlx::sqlite::SqliteRow) -> Result<LocalAssetRecord, McpError> {
    Ok(LocalAssetRecord {
        asset_id: row
            .try_get("asset_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        asset_kind: row
            .try_get("asset_kind")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        title: row
            .try_get("title")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        summary: row
            .try_get("summary")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        origin_session_id: row
            .try_get("origin_session_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        origin_turn_index: row
            .try_get("origin_turn_index")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        source_block_id: row
            .try_get("source_block_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        source_view_type: row
            .try_get("source_view_type")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        render_hint: row
            .try_get("render_hint")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        template_id: row
            .try_get("template_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        template_version: row
            .try_get("template_version")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        html_entry: row
            .try_get("html_entry")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        data_mode: row
            .try_get("data_mode")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        match_hints_json: row
            .try_get("match_hints_json")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        props_hint_json: row
            .try_get("props_hint_json")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        output_example_json: row
            .try_get("output_example_json")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        latest_snapshot_html: row
            .try_get("latest_snapshot_html")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        latest_render_data_json: row
            .try_get("latest_render_data_json")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        refresh_spec_json: row
            .try_get("refresh_spec_json")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        status: row
            .try_get("status")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        is_pinned: row
            .try_get::<i64, _>("is_pinned")
            .map_err(|err| McpError::Storage(err.to_string()))?
            != 0,
        is_archived: row
            .try_get::<i64, _>("is_archived")
            .map_err(|err| McpError::Storage(err.to_string()))?
            != 0,
        created_at: row
            .try_get("created_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        last_refreshed_at: row
            .try_get("last_refreshed_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        last_opened_at: row
            .try_get("last_opened_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
    })
}
