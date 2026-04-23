use serde_json::Value;
use sha1::{Digest, Sha1};
use sqlx::Row;
use uuid::Uuid;

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

use super::types::{
    normalize_sync_interval_minutes, CreateExternalSourceRequest,
    CreateManualExternalRawRecordRequest, ExternalRawRecord, ExternalSourceConnectorType,
    ExternalSourceRecord, ExternalSourceStatus, ExternalSourceSyncMode, NewExternalRawRecord,
    UpdateExternalSourceRequest,
};

fn now_rfc3339() -> Result<String, McpError> {
    mcp_storage::helpers::now_rfc3339().map_err(|err| McpError::Storage(err.to_string()))
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_required_text(value: &str, field: &str) -> Result<String, McpError> {
    normalize_optional_text(Some(value))
        .ok_or_else(|| McpError::validation(format!("{field} is required")))
}

fn normalize_https_base_url(
    connector_type: ExternalSourceConnectorType,
    value: Option<&str>,
) -> Result<Option<String>, McpError> {
    let candidate = normalize_optional_text(value)
        .or_else(|| connector_type.default_base_url().map(str::to_string));
    let Some(candidate) = candidate else {
        return Ok(None);
    };
    let parsed = reqwest::Url::parse(candidate.as_str())
        .map_err(|err| McpError::validation(format!("invalid base_url: {err}")))?;
    let scheme = parsed.scheme();
    if scheme != "https" && scheme != "http" {
        return Err(McpError::validation(
            "base_url must start with http:// or https://".to_string(),
        ));
    }
    Ok(Some(parsed.to_string().trim_end_matches('/').to_string()))
}

fn normalize_source_status(
    is_enabled: bool,
    connector_type: ExternalSourceConnectorType,
    has_credentials: bool,
) -> ExternalSourceStatus {
    if !is_enabled {
        return ExternalSourceStatus::Disabled;
    }
    if connector_type.auth_mode().as_str() == "api_key" && !has_credentials {
        return ExternalSourceStatus::Draft;
    }
    ExternalSourceStatus::Ready
}

fn connector_trust_level(connector_type: ExternalSourceConnectorType) -> &'static str {
    match connector_type {
        ExternalSourceConnectorType::ManualImport => "private",
        ExternalSourceConnectorType::EvomapPublicFeed => "community",
        ExternalSourceConnectorType::EvomapKg => "private",
    }
}

fn payload_to_json_string(payload: &Value) -> Result<String, McpError> {
    serde_json::to_string(payload).map_err(|err| McpError::Storage(err.to_string()))
}

fn row_to_external_source(row: &sqlx::sqlite::SqliteRow) -> Result<ExternalSourceRecord, McpError> {
    let connector_type: String = row
        .try_get("connector_type")
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let auth_mode: String = row
        .try_get("auth_mode")
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let sync_mode: String = row
        .try_get("sync_mode")
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let status: String = row
        .try_get("status")
        .map_err(|err| McpError::Storage(err.to_string()))?;
    let metadata_json: String = row
        .try_get("metadata_json")
        .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(ExternalSourceRecord {
        id: row
            .try_get("id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        display_name: row
            .try_get("display_name")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        connector_type: connector_type.parse().map_err(McpError::validation)?,
        auth_mode: auth_mode.parse().map_err(McpError::validation)?,
        base_url: row
            .try_get("base_url")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        is_enabled: row
            .try_get::<i64, _>("is_enabled")
            .map_err(|err| McpError::Storage(err.to_string()))?
            != 0,
        sync_mode: sync_mode.parse().map_err(McpError::validation)?,
        sync_interval_minutes: row
            .try_get("sync_interval_minutes")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        status: status.parse().map_err(McpError::validation)?,
        last_synced_at: row
            .try_get("last_synced_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        last_error: row
            .try_get("last_error")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        trust_level: row
            .try_get("trust_level")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        has_credentials: row
            .try_get::<i64, _>("has_credentials")
            .map_err(|err| McpError::Storage(err.to_string()))?
            != 0,
        metadata_json: serde_json::from_str(&metadata_json)
            .unwrap_or_else(|_| serde_json::json!({})),
        created_at: row
            .try_get("created_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
    })
}

fn row_to_external_raw_record(
    row: &sqlx::sqlite::SqliteRow,
) -> Result<ExternalRawRecord, McpError> {
    Ok(ExternalRawRecord {
        id: row
            .try_get("id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        source_id: row
            .try_get("source_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        source_asset_id: row
            .try_get("source_asset_id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        source_version: row
            .try_get("source_version")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        asset_family: row
            .try_get("asset_family")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        observed_at_unix_ms: row
            .try_get("observed_at_unix_ms")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        freshness_hint: row
            .try_get("freshness_hint")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        content_hash: row
            .try_get("content_hash")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        raw_payload_json: row
            .try_get("raw_payload_json")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        translation_status: row
            .try_get("translation_status")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        translated_at_unix_ms: row
            .try_get("translated_at_unix_ms")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        translation_error: row
            .try_get("translation_error")
            .map_err(|err| McpError::Storage(err.to_string()))?,
    })
}

pub(crate) fn build_content_hash(raw_payload_json: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(raw_payload_json.as_bytes());
    hex::encode(hasher.finalize())
}

fn build_record_key(
    source_id: &str,
    source_asset_id: &str,
    source_version: Option<&str>,
    content_hash: &str,
) -> String {
    let version = source_version.unwrap_or("none");
    format!(
        "{}:{}:{}:{}",
        source_id.trim(),
        source_asset_id.trim(),
        version.trim(),
        content_hash.trim()
    )
}

pub(crate) fn manual_payload_to_json(payload_text: &str) -> Value {
    match serde_json::from_str::<Value>(payload_text) {
        Ok(value) => value,
        Err(_) => serde_json::json!({ "text": payload_text }),
    }
}

impl McpStore {
    pub async fn list_external_sources(&self) -> Result<Vec<ExternalSourceRecord>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT
              s.id,
              s.display_name,
              s.connector_type,
              s.auth_mode,
              s.base_url,
              s.is_enabled,
              s.sync_mode,
              s.sync_interval_minutes,
              s.status,
              s.last_synced_at,
              s.last_error,
              s.trust_level,
              s.metadata_json,
              s.created_at,
              s.updated_at,
              CASE WHEN c.id IS NULL THEN 0 ELSE 1 END AS has_credentials
            FROM external_sources s
            LEFT JOIN external_source_credentials c ON c.source_id = s.id
            ORDER BY s.created_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| row_to_external_source(&row))
            .collect()
    }

    pub async fn get_external_source(
        &self,
        source_id: &str,
    ) -> Result<Option<ExternalSourceRecord>, McpError> {
        let normalized_source_id = source_id.trim();
        if normalized_source_id.is_empty() {
            return Ok(None);
        }
        let row = sqlx::query(
            r#"
            SELECT
              s.id,
              s.display_name,
              s.connector_type,
              s.auth_mode,
              s.base_url,
              s.is_enabled,
              s.sync_mode,
              s.sync_interval_minutes,
              s.status,
              s.last_synced_at,
              s.last_error,
              s.trust_level,
              s.metadata_json,
              s.created_at,
              s.updated_at,
              CASE WHEN c.id IS NULL THEN 0 ELSE 1 END AS has_credentials
            FROM external_sources s
            LEFT JOIN external_source_credentials c ON c.source_id = s.id
            WHERE s.id = ?
            LIMIT 1
            "#,
        )
        .bind(normalized_source_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|value| row_to_external_source(&value)).transpose()
    }

    pub async fn create_external_source(
        &self,
        payload: CreateExternalSourceRequest,
    ) -> Result<ExternalSourceRecord, McpError> {
        let connector_type = payload.connector_type;
        let id = Uuid::new_v4().to_string();
        let display_name = normalize_required_text(&payload.display_name, "display_name")?;
        let base_url = normalize_https_base_url(connector_type, payload.base_url.as_deref())?;
        let sync_mode = payload.sync_mode.unwrap_or(ExternalSourceSyncMode::Manual);
        let sync_interval_minutes = normalize_sync_interval_minutes(payload.sync_interval_minutes);
        let has_credentials = normalize_optional_text(payload.api_key.as_deref()).is_some();
        let is_enabled = payload.is_enabled.unwrap_or(false);
        let status = normalize_source_status(is_enabled, connector_type, has_credentials);
        let now = now_rfc3339()?;
        let trust_level = connector_trust_level(connector_type).to_string();

        sqlx::query(
            r#"
            INSERT INTO external_sources (
              id, display_name, connector_type, auth_mode, base_url,
              is_enabled, sync_mode, sync_interval_minutes, status,
              last_synced_at, last_error, trust_level, metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(&display_name)
        .bind(connector_type.as_str())
        .bind(connector_type.auth_mode().as_str())
        .bind(base_url.as_deref())
        .bind(if is_enabled { 1 } else { 0 })
        .bind(sync_mode.as_str())
        .bind(sync_interval_minutes)
        .bind(status.as_str())
        .bind::<Option<String>>(None)
        .bind::<Option<String>>(None)
        .bind(&trust_level)
        .bind("{}")
        .bind(&now)
        .bind(&now)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if let Some(api_key) = normalize_optional_text(payload.api_key.as_deref()) {
            self.set_external_source_api_key(&id, "api_key", &api_key)
                .await?;
        }

        self.get_external_source(&id)
            .await?
            .ok_or_else(|| McpError::NotFound("external source missing after insert".to_string()))
    }

    pub async fn update_external_source(
        &self,
        source_id: &str,
        payload: UpdateExternalSourceRequest,
    ) -> Result<ExternalSourceRecord, McpError> {
        let existing = self
            .get_external_source(source_id)
            .await?
            .ok_or_else(|| McpError::NotFound("external source not found".to_string()))?;

        let display_name = payload
            .display_name
            .as_deref()
            .map(|value| normalize_required_text(value, "display_name"))
            .transpose()?
            .unwrap_or(existing.display_name.clone());
        let base_url = if payload.base_url.is_some() {
            normalize_https_base_url(existing.connector_type, payload.base_url.as_deref())?
        } else {
            existing.base_url.clone()
        };
        let sync_mode = payload.sync_mode.unwrap_or(existing.sync_mode);
        let sync_interval_minutes = normalize_sync_interval_minutes(
            payload
                .sync_interval_minutes
                .or(Some(existing.sync_interval_minutes)),
        );
        let clear_api_key = payload.clear_api_key.unwrap_or(false);
        if clear_api_key {
            self.clear_external_source_credentials(&existing.id).await?;
        }
        if let Some(api_key) = normalize_optional_text(payload.api_key.as_deref()) {
            self.set_external_source_api_key(&existing.id, "api_key", &api_key)
                .await?;
        }
        let has_credentials = self
            .get_external_source_api_key(&existing.id)
            .await?
            .is_some();
        let is_enabled = payload.is_enabled.unwrap_or(existing.is_enabled);
        let status = if existing.status == ExternalSourceStatus::Syncing {
            existing.status
        } else {
            normalize_source_status(is_enabled, existing.connector_type, has_credentials)
        };
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            UPDATE external_sources
            SET display_name = ?,
                base_url = ?,
                is_enabled = ?,
                sync_mode = ?,
                sync_interval_minutes = ?,
                status = ?,
                updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(&display_name)
        .bind(base_url.as_deref())
        .bind(if is_enabled { 1 } else { 0 })
        .bind(sync_mode.as_str())
        .bind(sync_interval_minutes)
        .bind(status.as_str())
        .bind(&now)
        .bind(existing.id.as_str())
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_external_source(&existing.id)
            .await?
            .ok_or_else(|| McpError::NotFound("external source missing after update".to_string()))
    }

    pub async fn delete_external_source(&self, source_id: &str) -> Result<(), McpError> {
        let normalized_source_id = source_id.trim();
        if normalized_source_id.is_empty() {
            return Ok(());
        }
        sqlx::query("DELETE FROM external_sources WHERE id = ?")
            .bind(normalized_source_id)
            .execute(&self.write_pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn set_external_source_api_key(
        &self,
        source_id: &str,
        credential_kind: &str,
        api_key: &str,
    ) -> Result<(), McpError> {
        let normalized_source_id = source_id.trim();
        let normalized_api_key = normalize_required_text(api_key, "api_key")?;
        let normalized_credential_kind =
            normalize_required_text(credential_kind, "credential_kind")?;
        let existing =
            sqlx::query("SELECT id FROM external_source_credentials WHERE source_id = ? LIMIT 1")
                .bind(normalized_source_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
        let credential_id = existing
            .and_then(|row| row.try_get::<String, _>("id").ok())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = now_rfc3339()?;
        let (secret_ciphertext, secret_key_version) = self
            .secret_store
            .encrypt_for_db(&credential_id, &normalized_api_key)
            .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            INSERT INTO external_source_credentials (
              id, source_id, credential_kind, secret_ciphertext, secret_key_version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id) DO UPDATE SET
              credential_kind = excluded.credential_kind,
              secret_ciphertext = excluded.secret_ciphertext,
              secret_key_version = excluded.secret_key_version,
              updated_at = excluded.updated_at
            "#,
        )
        .bind(&credential_id)
        .bind(normalized_source_id)
        .bind(&normalized_credential_kind)
        .bind(&secret_ciphertext)
        .bind(secret_key_version)
        .bind(&now)
        .bind(&now)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn clear_external_source_credentials(&self, source_id: &str) -> Result<(), McpError> {
        let normalized_source_id = source_id.trim();
        if normalized_source_id.is_empty() {
            return Ok(());
        }
        sqlx::query("DELETE FROM external_source_credentials WHERE source_id = ?")
            .bind(normalized_source_id)
            .execute(&self.write_pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn get_external_source_api_key(
        &self,
        source_id: &str,
    ) -> Result<Option<String>, McpError> {
        let normalized_source_id = source_id.trim();
        if normalized_source_id.is_empty() {
            return Ok(None);
        }
        let row = sqlx::query(
            "SELECT id, secret_ciphertext, secret_key_version FROM external_source_credentials WHERE source_id = ? LIMIT 1",
        )
        .bind(normalized_source_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let Some(row) = row else {
            return Ok(None);
        };
        let credential_id: String = row
            .try_get("id")
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let secret_ciphertext: String = row
            .try_get("secret_ciphertext")
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let secret_key_version: i64 = row
            .try_get("secret_key_version")
            .map_err(|err| McpError::Storage(err.to_string()))?;
        self.secret_store
            .decrypt_from_db(&credential_id, &secret_ciphertext, secret_key_version)
            .map_err(|err| McpError::Storage(err.to_string()))
    }

    pub async fn update_external_source_sync_state(
        &self,
        source_id: &str,
        status: ExternalSourceStatus,
        last_synced_at: Option<&str>,
        last_error: Option<&str>,
    ) -> Result<(), McpError> {
        let normalized_source_id = source_id.trim();
        if normalized_source_id.is_empty() {
            return Ok(());
        }
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE external_sources
            SET status = ?,
                last_synced_at = ?,
                last_error = ?,
                updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(status.as_str())
        .bind(normalize_optional_text(last_synced_at))
        .bind(normalize_optional_text(last_error))
        .bind(&now)
        .bind(normalized_source_id)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub async fn list_external_raw_records(
        &self,
        source_id: &str,
        limit: usize,
    ) -> Result<Vec<ExternalRawRecord>, McpError> {
        let normalized_source_id = source_id.trim();
        if normalized_source_id.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query(
            r#"
            SELECT
              id,
              source_id,
              source_asset_id,
              source_version,
              asset_family,
              observed_at_unix_ms,
              freshness_hint,
              content_hash,
              raw_payload_json,
              translation_status,
              translated_at_unix_ms,
              translation_error
            FROM external_raw_records
            WHERE source_id = ?
            ORDER BY observed_at_unix_ms DESC
            LIMIT ?
            "#,
        )
        .bind(normalized_source_id)
        .bind(limit.max(1) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        rows.into_iter()
            .map(|row| row_to_external_raw_record(&row))
            .collect()
    }

    pub(crate) async fn upsert_external_raw_record(
        &self,
        payload: NewExternalRawRecord,
    ) -> Result<ExternalRawRecord, McpError> {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO external_raw_records (
              id,
              record_key,
              source_id,
              source_asset_id,
              source_version,
              asset_family,
              observed_at_unix_ms,
              freshness_hint,
              content_hash,
              raw_payload_json,
              translation_status,
              translated_at_unix_ms,
              translation_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(record_key) DO UPDATE SET
              observed_at_unix_ms = excluded.observed_at_unix_ms,
              freshness_hint = excluded.freshness_hint,
              raw_payload_json = excluded.raw_payload_json,
              translation_status = excluded.translation_status,
              translated_at_unix_ms = NULL,
              translation_error = NULL
            "#,
        )
        .bind(&id)
        .bind(&payload.record_key)
        .bind(&payload.source_id)
        .bind(&payload.source_asset_id)
        .bind(payload.source_version.as_deref())
        .bind(&payload.asset_family)
        .bind(payload.observed_at_unix_ms)
        .bind(payload.freshness_hint)
        .bind(&payload.content_hash)
        .bind(&payload.raw_payload_json)
        .bind(&payload.translation_status)
        .bind::<Option<i64>>(None)
        .bind::<Option<String>>(None)
        .execute(&self.write_pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let row = sqlx::query(
            r#"
            SELECT
              id,
              source_id,
              source_asset_id,
              source_version,
              asset_family,
              observed_at_unix_ms,
              freshness_hint,
              content_hash,
              raw_payload_json,
              translation_status,
              translated_at_unix_ms,
              translation_error
            FROM external_raw_records
            WHERE record_key = ?
            LIMIT 1
            "#,
        )
        .bind(&payload.record_key)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row_to_external_raw_record(&row)
    }

    pub async fn create_manual_external_raw_record(
        &self,
        source_id: &str,
        payload: CreateManualExternalRawRecordRequest,
    ) -> Result<ExternalRawRecord, McpError> {
        let source = self
            .get_external_source(source_id)
            .await?
            .ok_or_else(|| McpError::NotFound("external source not found".to_string()))?;
        if source.connector_type != ExternalSourceConnectorType::ManualImport {
            return Err(McpError::validation(
                "manual raw records can only be added to manual_import sources".to_string(),
            ));
        }

        let asset_family = normalize_required_text(&payload.asset_family, "asset_family")?;
        let source_asset_id = normalize_required_text(&payload.source_asset_id, "source_asset_id")?;
        let payload_text = normalize_required_text(&payload.payload_text, "payload_text")?;
        let payload_value = manual_payload_to_json(&payload_text);
        let raw_payload_json = payload_to_json_string(&payload_value)?;
        let content_hash = build_content_hash(&raw_payload_json);
        let source_version = normalize_optional_text(payload.source_version.as_deref());
        let record_key = build_record_key(
            &source.id,
            &source_asset_id,
            source_version.as_deref(),
            &content_hash,
        );
        let observed_at_unix_ms =
            (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;

        self.upsert_external_raw_record(NewExternalRawRecord {
            record_key,
            source_id: source.id,
            source_asset_id,
            source_version,
            asset_family,
            observed_at_unix_ms,
            freshness_hint: payload.freshness_hint,
            content_hash,
            raw_payload_json,
            translation_status: "pending".to_string(),
        })
        .await
    }
}

pub(crate) fn build_new_external_raw_record(
    source_id: &str,
    source_asset_id: &str,
    source_version: Option<&str>,
    asset_family: &str,
    payload: &Value,
    freshness_hint: Option<f64>,
) -> Result<NewExternalRawRecord, McpError> {
    let normalized_source_id = normalize_required_text(source_id, "source_id")?;
    let normalized_asset_id = normalize_required_text(source_asset_id, "source_asset_id")?;
    let normalized_asset_family = normalize_required_text(asset_family, "asset_family")?;
    let source_version = normalize_optional_text(source_version);
    let raw_payload_json = payload_to_json_string(payload)?;
    let content_hash = build_content_hash(&raw_payload_json);
    let record_key = build_record_key(
        &normalized_source_id,
        &normalized_asset_id,
        source_version.as_deref(),
        &content_hash,
    );
    let observed_at_unix_ms =
        (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;
    Ok(NewExternalRawRecord {
        record_key,
        source_id: normalized_source_id,
        source_asset_id: normalized_asset_id,
        source_version,
        asset_family: normalized_asset_family,
        observed_at_unix_ms,
        freshness_hint,
        content_hash,
        raw_payload_json,
        translation_status: "pending".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{build_content_hash, build_record_key, manual_payload_to_json};

    #[test]
    fn record_key_includes_version_and_hash() {
        let key = build_record_key("source", "asset", Some("v1"), "hash123");
        assert_eq!(key, "source:asset:v1:hash123");
    }

    #[test]
    fn content_hash_is_stable() {
        let left = build_content_hash(r#"{"hello":"world"}"#);
        let right = build_content_hash(r#"{"hello":"world"}"#);
        assert_eq!(left, right);
    }

    #[test]
    fn manual_payload_wraps_plain_text() {
        let payload = manual_payload_to_json("hello world");
        assert_eq!(
            payload.get("text").and_then(|value| value.as_str()),
            Some("hello world")
        );
    }
}
