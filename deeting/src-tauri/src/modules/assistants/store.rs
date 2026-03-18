use std::collections::{HashMap, HashSet};

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use mcp_session::admin::{
    LocalGatewayLogItem, LocalGatewayLogListResponse, LocalGatewayLogQuery,
    LocalGatewayLogStatsBucket, LocalGatewayLogStatsResponse, LocalMaintenanceLogItem,
    LocalMaintenanceLogListResponse, LocalMaintenanceLogQuery, LocalTraceFeedback,
    LocalTraceFeedbackRequest,
};
use mcp_session::assistant::{
    CloudSystemAssistantSnapshot, CreateAssistantMessageRequest, CreateLocalAssistantRequest,
    LocalAssistant, LocalAssistantEntity,
    LocalAssistantInstallCreateRequest, LocalAssistantInstallItem, LocalAssistantInstallPage,
    LocalAssistantInstallQuery, LocalAssistantInstallUpdateRequest, LocalAssistantMessage,
    LocalAssistantRatingRequest, LocalAssistantRatingResponse,
    LocalAssistantRoutingFeedbackRequest, LocalAssistantRoutingReportItem,
    LocalAssistantRoutingReportQuery, LocalAssistantRoutingReportResponse,
    LocalAssistantRoutingReportSummary, LocalAssistantRoutingState, LocalAssistantSummary,
    LocalAssistantSummaryVersion, LocalAssistantTag, LocalAssistantVersion, UpdateLocalAssistantRequest,
};
use mcp_storage::helpers::{
    deserialize_json, normalize_assistant_tag_names, normalize_feedback_tags, now_rfc3339,
    parse_assistant_routing_feedback_event, round_to_4, serialize_json,
};
use sqlx::sqlite::SqliteRow;
use sqlx::Row;
use uuid::Uuid;

const LOCAL_DESKTOP_USER_ID: &str = "00000000-0000-0000-0000-000000000000";

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
}

fn normalize_gateway_log_query(
    query: LocalGatewayLogQuery,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<i64>,
    Option<String>,
) {
    let start_time = normalize_optional_text(query.start_time.as_deref());
    let end_time = normalize_optional_text(query.end_time.as_deref());
    let user_id = normalize_optional_text(query.user_id.as_deref());
    let api_key_id = normalize_optional_text(query.api_key_id.as_deref());
    let preset_id = normalize_optional_text(query.preset_id.as_deref());
    let model = normalize_optional_text(query.model.as_deref());
    let status_code = query.status_code.map(|value| value.max(0));
    let is_cached = query
        .is_cached
        .map(|value| if value { 1_i64 } else { 0_i64 });
    let error_code = normalize_optional_text(query.error_code.as_deref());

    (
        start_time,
        end_time,
        user_id,
        api_key_id,
        preset_id,
        model,
        status_code,
        is_cached,
        error_code,
    )
}

pub(crate) async fn init_assistant_tables(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assistants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          avatar TEXT,
          system_prompt TEXT NOT NULL,
          model_config TEXT,
          tags TEXT,
          visibility TEXT NOT NULL,
          source TEXT NOT NULL,
          cloud_id TEXT,
          is_deleted INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assistant (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT,
          visibility TEXT NOT NULL DEFAULT 'private',
          status TEXT NOT NULL DEFAULT 'draft',
          share_slug TEXT UNIQUE,
          summary TEXT,
          icon_id TEXT,
          install_count INTEGER NOT NULL DEFAULT 0,
          rating_avg REAL NOT NULL DEFAULT 0,
          rating_count INTEGER NOT NULL DEFAULT 0,
          current_version_id TEXT,
          published_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_owner_user_id
        ON assistant(owner_user_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_visibility_status
        ON assistant(visibility, status);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_published_at
        ON assistant(published_at);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assistant_version (
          id TEXT PRIMARY KEY,
          assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
          version TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          system_prompt TEXT NOT NULL,
          model_config TEXT,
          tags TEXT,
          changelog TEXT,
          published_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assistant_install (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
          alias TEXT,
          icon_override TEXT,
          pinned_version_id TEXT REFERENCES assistant_version(id) ON DELETE SET NULL,
          follow_latest INTEGER NOT NULL DEFAULT 1,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_install_user_assistant
        ON assistant_install(user_id, assistant_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_install_user
        ON assistant_install(user_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_install_assistant
        ON assistant_install(assistant_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assistant_rating (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
          rating REAL NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_rating_user_assistant
        ON assistant_rating(user_id, assistant_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_rating_user
        ON assistant_rating(user_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_rating_assistant
        ON assistant_rating(assistant_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assistant_routing_state (
          id TEXT PRIMARY KEY,
          assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
          total_trials INTEGER NOT NULL DEFAULT 0,
          positive_feedback INTEGER NOT NULL DEFAULT 0,
          negative_feedback INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT,
          last_feedback_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_routing_state_assistant
        ON assistant_routing_state(assistant_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_routing_state_assistant_id
        ON assistant_routing_state(assistant_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assistant_tag (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_tag_name
        ON assistant_tag(name);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_tag_name
        ON assistant_tag(name);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assistant_tag_link (
          assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES assistant_tag(id) ON DELETE CASCADE,
          PRIMARY KEY (assistant_id, tag_id)
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_tag_link_assistant
        ON assistant_tag_link(assistant_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_tag_link_tag
        ON assistant_tag_link(tag_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_version_semver
        ON assistant_version(assistant_id, version);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_version_assistant
        ON assistant_version(assistant_id);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        INSERT OR IGNORE INTO assistant (
          id, owner_user_id, visibility, status, share_slug, summary, icon_id,
          install_count, rating_avg, rating_count, current_version_id, published_at, created_at, updated_at
        )
        SELECT
          a.id,
          NULL,
          COALESCE(NULLIF(a.visibility, ''), 'private'),
          CASE
            WHEN a.is_deleted = 1 THEN 'archived'
            ELSE 'published'
          END,
          NULL,
          a.description,
          a.avatar,
          0,
          0,
          0,
          NULL,
          CASE
            WHEN a.is_deleted = 1 THEN NULL
            ELSE a.created_at
          END,
          a.created_at,
          a.updated_at
        FROM assistants a;
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assistant_messages (
          id TEXT PRIMARY KEY,
          assistant_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          is_deleted INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (assistant_id) REFERENCES assistants(id)
        );
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_assistant_messages_assistant_id_created_at
        ON assistant_messages(assistant_id, created_at);
        "#,
    )
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    store.migrate_assistant_version_drop_skill_refs().await?;
    store.repair_assistant_install_foreign_key_target().await?;
    store.migrate_assistant_versions_from_legacy().await?;
    store.migrate_assistant_installs_from_assistant().await?;

    Ok(())
}

pub(crate) fn row_to_assistant(row: &SqliteRow) -> Result<LocalAssistant, McpError> {
    let tags: Option<Vec<String>> = deserialize_json(row.try_get("tags")?)?;
    let model_config: Option<serde_json::Value> = deserialize_json(row.try_get("model_config")?)?;
    Ok(LocalAssistant {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        avatar: row.try_get("avatar")?,
        system_prompt: row.try_get("system_prompt")?,
        model_config,
        tags: tags.unwrap_or_default(),
        visibility: row.try_get("visibility")?,
        source: row.try_get("source")?,
        cloud_id: row.try_get("cloud_id")?,
        is_deleted: row.try_get::<i64, _>("is_deleted")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn row_to_assistant_entity(row: &SqliteRow) -> Result<LocalAssistantEntity, McpError> {
    Ok(LocalAssistantEntity {
        id: row.try_get("id")?,
        owner_user_id: row.try_get("owner_user_id")?,
        visibility: row.try_get("visibility")?,
        status: row.try_get("status")?,
        share_slug: row.try_get("share_slug")?,
        summary: row.try_get("summary")?,
        icon_id: row.try_get("icon_id")?,
        install_count: row.try_get("install_count")?,
        rating_avg: row.try_get("rating_avg")?,
        rating_count: row.try_get("rating_count")?,
        current_version_id: row.try_get("current_version_id")?,
        published_at: row.try_get("published_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn row_to_assistant_version(
    row: &SqliteRow,
) -> Result<LocalAssistantVersion, McpError> {
    let model_config: Option<serde_json::Value> = deserialize_json(row.try_get("model_config")?)?;
    let tags: Option<Vec<String>> = deserialize_json(row.try_get("tags")?)?;
    Ok(LocalAssistantVersion {
        id: row.try_get("id")?,
        assistant_id: row.try_get("assistant_id")?,
        version: row.try_get("version")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        system_prompt: row.try_get("system_prompt")?,
        model_config,
        tags: tags.unwrap_or_default(),
        changelog: row.try_get("changelog")?,
        published_at: row.try_get("published_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn row_to_assistant_install_item(
    row: &SqliteRow,
) -> Result<LocalAssistantInstallItem, McpError> {
    let follow_latest = row.try_get::<i64, _>("install_follow_latest").unwrap_or(1) != 0;
    let pinned_version_id: Option<String> = row.try_get("install_pinned_version_id")?;
    let use_pinned = !follow_latest
        && pinned_version_id.is_some()
        && row.try_get::<Option<String>, _>("pinned_id")?.is_some();

    let version_id = if use_pinned {
        row.try_get::<Option<String>, _>("pinned_id")?
    } else {
        row.try_get::<Option<String>, _>("current_version_id")?
    }
    .ok_or_else(|| McpError::validation("assistant version missing"))?;

    let version = LocalAssistantSummaryVersion {
        id: version_id,
        version: if use_pinned {
            row.try_get::<Option<String>, _>("pinned_version")?
        } else {
            row.try_get::<Option<String>, _>("current_version")?
        }
        .unwrap_or_else(|| "1.0.0".to_string()),
        name: if use_pinned {
            row.try_get::<Option<String>, _>("pinned_name")?
        } else {
            row.try_get::<Option<String>, _>("current_name")?
        }
        .unwrap_or_else(|| "Assistant".to_string()),
        description: if use_pinned {
            row.try_get("pinned_description")?
        } else {
            row.try_get("current_description")?
        },
        system_prompt: if use_pinned {
            row.try_get("pinned_system_prompt")?
        } else {
            row.try_get("current_system_prompt")?
        },
        tags: if use_pinned {
            deserialize_json(row.try_get("pinned_tags")?)?.unwrap_or_default()
        } else {
            deserialize_json(row.try_get("current_tags")?)?.unwrap_or_default()
        },
        published_at: if use_pinned {
            row.try_get("pinned_published_at")?
        } else {
            row.try_get("current_published_at")?
        },
    };

    let assistant = LocalAssistantSummary {
        assistant_id: row.try_get("install_assistant_id")?,
        owner_user_id: row.try_get("assistant_owner_user_id")?,
        icon_id: row.try_get("assistant_icon_id")?,
        share_slug: row.try_get("assistant_share_slug")?,
        summary: row.try_get("assistant_summary")?,
        published_at: row.try_get("assistant_published_at")?,
        current_version_id: row.try_get("assistant_current_version_id")?,
        install_count: row.try_get("assistant_install_count").unwrap_or(0),
        rating_avg: row.try_get("assistant_rating_avg").unwrap_or(0.0),
        rating_count: row.try_get("assistant_rating_count").unwrap_or(0),
        tags: version.tags.clone(),
        version,
    };

    Ok(LocalAssistantInstallItem {
        id: row.try_get("install_id")?,
        assistant_id: assistant.assistant_id.clone(),
        alias: row.try_get("install_alias")?,
        icon_override: row.try_get("install_icon_override")?,
        pinned_version_id,
        follow_latest,
        is_enabled: row.try_get::<i64, _>("install_is_enabled").unwrap_or(1) != 0,
        sort_order: row.try_get("install_sort_order").unwrap_or(0),
        assistant,
    })
}

pub(crate) fn row_to_assistant_message(
    row: &SqliteRow,
) -> Result<LocalAssistantMessage, McpError> {
    Ok(LocalAssistantMessage {
        id: row.try_get("id")?,
        assistant_id: row.try_get("assistant_id")?,
        role: row.try_get("role")?,
        content: row.try_get("content")?,
        is_deleted: row.try_get::<i64, _>("is_deleted")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

impl McpStore {
    pub async fn list_local_assistants(&self) -> Result<Vec<LocalAssistant>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT
              a.id,
              COALESCE(av.name, 'Assistant') AS name,
              COALESCE(av.description, a.summary) AS description,
              a.icon_id AS avatar,
              COALESCE(av.system_prompt, '') AS system_prompt,
              av.model_config AS model_config,
              av.tags AS tags,
              a.visibility AS visibility,
              'local' AS source,
              NULL AS cloud_id,
              CASE WHEN a.status = 'archived' THEN 1 ELSE 0 END AS is_deleted,
              a.created_at AS created_at,
              a.updated_at AS updated_at
            FROM assistant a
            LEFT JOIN assistant_version av
              ON av.id = (
                SELECT v.id
                FROM assistant_version v
                WHERE v.assistant_id = a.id
                ORDER BY v.created_at DESC, v.id DESC
                LIMIT 1
              )
            WHERE a.status <> 'archived'
            ORDER BY a.updated_at DESC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut assistants = Vec::with_capacity(rows.len());
        for row in rows {
            assistants.push(row_to_assistant(&row)?);
        }
        Ok(assistants)
    }

    pub async fn list_local_assistant_entities(
        &self,
    ) -> Result<Vec<LocalAssistantEntity>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, owner_user_id, visibility, status, share_slug, summary, icon_id,
                   install_count, rating_avg, rating_count, current_version_id, published_at,
                   created_at, updated_at
            FROM assistant
            ORDER BY updated_at DESC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut assistants = Vec::with_capacity(rows.len());
        for row in rows {
            assistants.push(row_to_assistant_entity(&row)?);
        }
        Ok(assistants)
    }

    pub async fn list_local_assistant_versions(
        &self,
        assistant_id: Option<&str>,
    ) -> Result<Vec<LocalAssistantVersion>, McpError> {
        let rows = if let Some(assistant_id) = assistant_id {
            sqlx::query(
                r#"
                SELECT id, assistant_id, version, name, description, system_prompt,
                       model_config, tags, changelog, published_at,
                       created_at, updated_at
                FROM assistant_version
                WHERE assistant_id = ?
                ORDER BY created_at DESC, id DESC;
                "#,
            )
            .bind(assistant_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        } else {
            sqlx::query(
                r#"
                SELECT id, assistant_id, version, name, description, system_prompt,
                       model_config, tags, changelog, published_at,
                       created_at, updated_at
                FROM assistant_version
                ORDER BY updated_at DESC, id DESC;
                "#,
            )
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
        };

        let mut versions = Vec::with_capacity(rows.len());
        for row in rows {
            versions.push(row_to_assistant_version(&row)?);
        }
        Ok(versions)
    }

    pub async fn get_local_assistant_current_version(
        &self,
        assistant_id: &str,
    ) -> Result<Option<LocalAssistantVersion>, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT av.id, av.assistant_id, av.version, av.name, av.description, av.system_prompt,
                   av.model_config, av.tags, av.changelog, av.published_at,
                   av.created_at, av.updated_at
            FROM assistant a
            JOIN assistant_version av ON av.id = a.current_version_id
            WHERE a.id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| row_to_assistant_version(&row)).transpose()
    }

    pub async fn get_local_assistant(&self, id: &str) -> Result<Option<LocalAssistant>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT
              a.id,
              COALESCE(av.name, 'Assistant') AS name,
              COALESCE(av.description, a.summary) AS description,
              a.icon_id AS avatar,
              COALESCE(av.system_prompt, '') AS system_prompt,
              av.model_config AS model_config,
              av.tags AS tags,
              a.visibility AS visibility,
              'local' AS source,
              NULL AS cloud_id,
              CASE WHEN a.status = 'archived' THEN 1 ELSE 0 END AS is_deleted,
              a.created_at AS created_at,
              a.updated_at AS updated_at
            FROM assistant a
            LEFT JOIN assistant_version av
              ON av.id = (
                SELECT v.id
                FROM assistant_version v
                WHERE v.assistant_id = a.id
                ORDER BY v.created_at DESC, v.id DESC
                LIMIT 1
              )
            WHERE a.id = ?
            LIMIT 1;
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        match row {
            Some(row) => Ok(Some(row_to_assistant(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn create_local_assistant(
        &self,
        payload: CreateLocalAssistantRequest,
    ) -> Result<String, McpError> {
        let name = payload.name.trim().to_string();
        if name.is_empty() {
            return Err(McpError::validation("assistant name is required"));
        }
        let system_prompt = payload.system_prompt.trim().to_string();
        if system_prompt.is_empty() {
            return Err(McpError::validation("system_prompt is required"));
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;
        let visibility = payload.visibility.unwrap_or_else(|| "private".to_string());
        let source = payload.source.unwrap_or_else(|| "local".to_string());
        let description = payload.description;
        let avatar = payload.avatar;
        let tags = payload.tags.unwrap_or_default();
        let tags_json = serialize_json(&Some(tags))?;
        let model_config_json = serialize_json(&payload.model_config)?;

        sqlx::query(
            r#"
            INSERT INTO assistants
              (id, name, description, avatar, system_prompt, model_config, tags, visibility, source,
               cloud_id, is_deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&name)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&system_prompt)
        .bind(model_config_json.as_deref())
        .bind(tags_json.as_deref())
        .bind(&visibility)
        .bind(&source)
        .bind(payload.cloud_id)
        .bind(0)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            INSERT OR REPLACE INTO assistant (
              id, owner_user_id, visibility, status, share_slug, summary, icon_id,
              install_count, rating_avg, rating_count, current_version_id, published_at, created_at, updated_at
            )
            VALUES (?, NULL, ?, 'published', NULL, ?, ?, 0, 0, 0, NULL, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&visibility)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.ensure_assistant_version_synced(
            &id,
            &name,
            description.as_deref(),
            &system_prompt,
            model_config_json.as_deref(),
            tags_json.as_deref(),
            Some(&now),
            &now,
            &now,
        )
        .await?;
        self.sync_assistant_registry_entry(&id).await?;

        Ok(id)
    }

    pub async fn update_local_assistant(
        &self,
        id: &str,
        payload: UpdateLocalAssistantRequest,
    ) -> Result<LocalAssistant, McpError> {
        let existing = self
            .get_local_assistant(id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?;

        if existing.is_deleted {
            return Err(McpError::validation("assistant already deleted"));
        }

        let LocalAssistant {
            name: existing_name,
            description: existing_description,
            avatar: existing_avatar,
            system_prompt: existing_system_prompt,
            model_config: existing_model_config,
            tags: existing_tags,
            visibility: existing_visibility,
            source: existing_source,
            cloud_id: existing_cloud_id,
            created_at: existing_created_at,
            ..
        } = existing;

        let name = payload.name.unwrap_or(existing_name);
        if name.trim().is_empty() {
            return Err(McpError::validation("assistant name is required"));
        }
        let system_prompt = payload.system_prompt.unwrap_or(existing_system_prompt);
        if system_prompt.trim().is_empty() {
            return Err(McpError::validation("system_prompt is required"));
        }

        let description = payload.description.or(existing_description);
        let avatar = payload.avatar.or(existing_avatar);
        let model_config = payload.model_config.or(existing_model_config);
        let tags = payload.tags.unwrap_or(existing_tags);
        let visibility = payload.visibility.unwrap_or(existing_visibility);
        let source = payload.source.unwrap_or(existing_source);
        let cloud_id = payload.cloud_id.or(existing_cloud_id);
        let now = now_rfc3339()?;

        let tags_json = serialize_json(&Some(tags))?;
        let model_config_json = serialize_json(&model_config)?;

        sqlx::query(
            r#"
            UPDATE assistants
            SET name = ?, description = ?, avatar = ?, system_prompt = ?, model_config = ?,
                tags = ?, visibility = ?, source = ?, cloud_id = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&name)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&system_prompt)
        .bind(model_config_json.as_deref())
        .bind(tags_json.as_deref())
        .bind(&visibility)
        .bind(&source)
        .bind(cloud_id.as_deref())
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE assistant
            SET visibility = ?, summary = ?, icon_id = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&visibility)
        .bind(description.as_deref())
        .bind(avatar.as_deref())
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.ensure_assistant_version_synced(
            id,
            &name,
            description.as_deref(),
            &system_prompt,
            model_config_json.as_deref(),
            tags_json.as_deref(),
            None,
            &existing_created_at,
            &now,
        )
        .await?;
        self.sync_assistant_registry_entry(id).await?;

        self.get_local_assistant(id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant missing after update".to_string()))
    }

    pub async fn delete_local_assistant(&self, id: &str) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            UPDATE assistants
            SET is_deleted = 1, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE assistant
            SET status = 'archived', published_at = NULL, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }
        self.delete_assistant_messages(id).await?;
        let _ = self.delete_local_capability_registry_entries(id).await?;
        Ok(())
    }

    pub async fn list_assistant_messages(
        &self,
        assistant_id: &str,
    ) -> Result<Vec<LocalAssistantMessage>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, assistant_id, role, content, is_deleted, created_at, updated_at
            FROM assistant_messages
            WHERE assistant_id = ? AND is_deleted = 0
            ORDER BY created_at ASC;
            "#,
        )
        .bind(assistant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut messages = Vec::with_capacity(rows.len());
        for row in rows {
            messages.push(row_to_assistant_message(&row)?);
        }
        Ok(messages)
    }

    pub async fn append_assistant_message(
        &self,
        payload: CreateAssistantMessageRequest,
    ) -> Result<LocalAssistantMessage, McpError> {
        let role = payload.role.trim();
        if role.is_empty() {
            return Err(McpError::validation("role is required"));
        }
        let content = payload.content.trim().to_string();
        if content.is_empty() {
            return Err(McpError::validation("content is required"));
        }
        if payload.assistant_id.trim().is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO assistant_messages
              (id, assistant_id, role, content, is_deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&payload.assistant_id)
        .bind(role)
        .bind(&content)
        .bind(0)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalAssistantMessage {
            id,
            assistant_id: payload.assistant_id,
            role: role.to_string(),
            content,
            is_deleted: false,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn delete_assistant_messages(&self, assistant_id: &str) -> Result<(), McpError> {
        let now = now_rfc3339()?;
        sqlx::query(
            r#"
            UPDATE assistant_messages
            SET is_deleted = 1, updated_at = ?
            WHERE assistant_id = ?;
            "#,
        )
        .bind(&now)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    async fn upsert_cloud_system_assistants_internal(
        &self,
        assistants: &[CloudSystemAssistantSnapshot],
    ) -> Result<(i64, Vec<String>), McpError> {
        let now = now_rfc3339()?;
        let mut tx = self.begin_write().await?;
        let mut snapshot_ids: Vec<String> = Vec::new();
        let mut upserted_count = 0_i64;
        let mut tag_jobs: Vec<(String, Option<String>)> = Vec::new();

        for item in assistants {
            let assistant_id = item.assistant_id.trim().to_string();
            let version_id = item.version.id.trim().to_string();
            if assistant_id.is_empty() || version_id.is_empty() {
                continue;
            }
            let version_name = item.version.name.trim().to_string();
            if version_name.is_empty() {
                continue;
            }

            let version_label = {
                let normalized = item.version.version.trim();
                if normalized.is_empty() {
                    "1.0.0".to_string()
                } else {
                    normalized.to_string()
                }
            };

            let summary = normalize_optional_text(item.summary.as_deref());
            let icon_id = normalize_optional_text(item.icon_id.as_deref());
            let share_slug = normalize_optional_text(item.share_slug.as_deref());
            let published_at = normalize_optional_text(item.published_at.as_deref())
                .or_else(|| normalize_optional_text(item.version.published_at.as_deref()));
            let tags = normalize_assistant_tag_names(item.version.tags.clone());
            let tags_json = serialize_json(&Some(tags))?;
            let version_description = normalize_optional_text(item.version.description.as_deref())
                .or_else(|| summary.clone());
            let system_prompt = item
                .version
                .system_prompt
                .as_deref()
                .unwrap_or("")
                .trim()
                .to_string();
            let install_count = item.install_count.max(0);
            let rating_count = item.rating_count.max(0);
            let rating_avg = if item.rating_avg.is_finite() {
                round_to_4(item.rating_avg.max(0.0))
            } else {
                0.0
            };

            snapshot_ids.push(assistant_id.clone());

            sqlx::query(
                r#"
                INSERT INTO assistant (
                  id, owner_user_id, visibility, status, share_slug, summary, icon_id,
                  install_count, rating_avg, rating_count, current_version_id, published_at,
                  created_at, updated_at
                )
                VALUES (?, NULL, 'public', 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  owner_user_id = NULL,
                  visibility = 'public',
                  status = 'published',
                  share_slug = excluded.share_slug,
                  summary = excluded.summary,
                  icon_id = excluded.icon_id,
                  install_count = excluded.install_count,
                  rating_avg = excluded.rating_avg,
                  rating_count = excluded.rating_count,
                  current_version_id = excluded.current_version_id,
                  published_at = excluded.published_at,
                  updated_at = excluded.updated_at;
                "#,
            )
            .bind(&assistant_id)
            .bind(share_slug.as_deref())
            .bind(summary.as_deref())
            .bind(icon_id.as_deref())
            .bind(install_count)
            .bind(rating_avg)
            .bind(rating_count)
            .bind(&version_id)
            .bind(published_at.as_deref())
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                INSERT INTO assistant_version (
                  id, assistant_id, version, name, description, system_prompt,
                  model_config, tags, changelog, published_at, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  assistant_id = excluded.assistant_id,
                  version = excluded.version,
                  name = excluded.name,
                  description = excluded.description,
                  system_prompt = excluded.system_prompt,
                  tags = excluded.tags,
                  published_at = excluded.published_at,
                  updated_at = excluded.updated_at;
                "#,
            )
            .bind(&version_id)
            .bind(&assistant_id)
            .bind(version_label)
            .bind(version_name)
            .bind(version_description.as_deref())
            .bind(system_prompt)
            .bind(tags_json.as_deref())
            .bind(published_at.as_deref())
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            tag_jobs.push((assistant_id, tags_json));
            upserted_count += 1;
        }

        tx.commit().await?;

        for (assistant_id, tags_json) in tag_jobs {
            self.sync_local_assistant_tags(&assistant_id, tags_json.as_deref(), &now)
                .await?;
        }

        Ok((upserted_count, snapshot_ids))
    }

    pub async fn upsert_cloud_system_assistants(
        &self,
        assistants: &[CloudSystemAssistantSnapshot],
    ) -> Result<i64, McpError> {
        let (upserted_count, _) = self
            .upsert_cloud_system_assistants_internal(assistants)
            .await?;
        Ok(upserted_count)
    }

    pub async fn sync_cloud_system_assistants(
        &self,
        assistants: &[CloudSystemAssistantSnapshot],
    ) -> Result<(i64, i64), McpError> {
        let (upserted_count, snapshot_ids) = self
            .upsert_cloud_system_assistants_internal(assistants)
            .await?;
        let archived_count = self
            .archive_missing_cloud_system_assistants_by_ids(&snapshot_ids)
            .await?;

        Ok((upserted_count, archived_count))
    }

    pub async fn archive_missing_cloud_system_assistants_by_ids(
        &self,
        assistant_ids: &[String],
    ) -> Result<i64, McpError> {
        let now = now_rfc3339()?;
        let mut ids: Vec<String> = assistant_ids
            .iter()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .collect();
        ids.sort();
        ids.dedup();

        let result = if ids.is_empty() {
            sqlx::query(
                r#"
                UPDATE assistant
                SET status = 'archived',
                    published_at = NULL,
                    updated_at = ?
                WHERE owner_user_id IS NULL
                  AND visibility = 'public'
                  AND status = 'published';
                "#,
            )
            .bind(&now)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?
            .rows_affected() as i64
        } else {
            let placeholders = vec!["?"; ids.len()].join(", ");
            let sql = format!(
                "UPDATE assistant
                 SET status = 'archived',
                     published_at = NULL,
                     updated_at = ?
                 WHERE owner_user_id IS NULL
                   AND visibility = 'public'
                   AND status = 'published'
                   AND id NOT IN ({placeholders});"
            );
            let mut query = sqlx::query(&sql).bind(&now);
            for id in &ids {
                query = query.bind(id);
            }
            query
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?
                .rows_affected() as i64
        };

        Ok(result)
    }

    pub async fn list_enabled_local_assistant_ids(&self) -> Result<HashSet<String>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT assistant_id
            FROM assistant_install
            WHERE user_id = ? AND is_enabled = 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut ids = HashSet::with_capacity(rows.len());
        for row in rows {
            let assistant_id = row.try_get::<String, _>("assistant_id")?;
            let normalized = assistant_id.trim().to_string();
            if !normalized.is_empty() {
                ids.insert(normalized);
            }
        }
        Ok(ids)
    }

    pub async fn disable_local_assistant_installs_by_ids(
        &self,
        assistant_ids: &[String],
    ) -> Result<i64, McpError> {
        let normalized_assistant_ids: Vec<String> = assistant_ids
            .iter()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .collect();
        if normalized_assistant_ids.is_empty() {
            return Ok(0);
        }

        let now = now_rfc3339()?;
        let placeholders = vec!["?"; normalized_assistant_ids.len()].join(", ");
        let sql = format!(
            "UPDATE assistant_install\n             SET is_enabled = 0, updated_at = ?\n             WHERE user_id = ?\n               AND is_enabled = 1\n               AND assistant_id IN ({placeholders});"
        );
        let mut query = sqlx::query(&sql).bind(&now).bind(LOCAL_DESKTOP_USER_ID);
        for assistant_id in normalized_assistant_ids {
            query = query.bind(assistant_id);
        }
        let result = query
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected() as i64)
    }

    pub async fn archive_cloud_system_assistants_by_ids(
        &self,
        assistant_ids: &[String],
    ) -> Result<i64, McpError> {
        let normalized_assistant_ids: Vec<String> = assistant_ids
            .iter()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .collect();
        if normalized_assistant_ids.is_empty() {
            return Ok(0);
        }

        let now = now_rfc3339()?;
        let placeholders = vec!["?"; normalized_assistant_ids.len()].join(", ");
        let sql = format!(
            "UPDATE assistant\n             SET status = 'archived', published_at = NULL, updated_at = ?\n             WHERE owner_user_id IS NULL\n               AND visibility = 'public'\n               AND status <> 'archived'\n               AND id IN ({placeholders});"
        );
        let mut query = sqlx::query(&sql).bind(&now);
        for assistant_id in normalized_assistant_ids {
            query = query.bind(assistant_id);
        }
        let result = query
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(result.rows_affected() as i64)
    }

    pub async fn is_local_assistant_enabled_install(
        &self,
        assistant_id: &str,
    ) -> Result<bool, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Ok(false);
        }

        let row = sqlx::query(
            r#"
            SELECT 1
            FROM assistant_install
            WHERE user_id = ? AND assistant_id = ? AND is_enabled = 1
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(row.is_some())
    }

    pub async fn list_local_assistant_tags(&self) -> Result<Vec<LocalAssistantTag>, McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, created_at, updated_at
            FROM assistant_tag
            ORDER BY name ASC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut tags = Vec::with_capacity(rows.len());
        for row in rows {
            tags.push(LocalAssistantTag {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            });
        }
        Ok(tags)
    }

    pub async fn list_local_assistant_installs(
        &self,
        query: LocalAssistantInstallQuery,
    ) -> Result<LocalAssistantInstallPage, McpError> {
        let size = query.size.unwrap_or(50).clamp(1, 200);
        let offset = query
            .cursor
            .as_deref()
            .unwrap_or("0")
            .trim()
            .parse::<i64>()
            .unwrap_or(0)
            .max(0);

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(1) AS total
            FROM assistant_install
            WHERE user_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              ai.id AS install_id,
              ai.assistant_id AS install_assistant_id,
              ai.alias AS install_alias,
              ai.icon_override AS install_icon_override,
              ai.pinned_version_id AS install_pinned_version_id,
              ai.follow_latest AS install_follow_latest,
              ai.is_enabled AS install_is_enabled,
              ai.sort_order AS install_sort_order,
              a.owner_user_id AS assistant_owner_user_id,
              a.icon_id AS assistant_icon_id,
              a.share_slug AS assistant_share_slug,
              a.summary AS assistant_summary,
              a.published_at AS assistant_published_at,
              a.current_version_id AS assistant_current_version_id,
              a.install_count AS assistant_install_count,
              a.rating_avg AS assistant_rating_avg,
              a.rating_count AS assistant_rating_count,
              cv.id AS current_version_id,
              cv.version AS current_version,
              cv.name AS current_name,
              cv.description AS current_description,
              cv.system_prompt AS current_system_prompt,
              cv.tags AS current_tags,
              cv.published_at AS current_published_at,
              pv.id AS pinned_id,
              pv.version AS pinned_version,
              pv.name AS pinned_name,
              pv.description AS pinned_description,
              pv.system_prompt AS pinned_system_prompt,
              pv.tags AS pinned_tags,
              pv.published_at AS pinned_published_at
            FROM assistant_install ai
            INNER JOIN assistant a ON a.id = ai.assistant_id
            LEFT JOIN assistant_version cv ON cv.id = a.current_version_id
            LEFT JOIN assistant_version pv ON pv.id = ai.pinned_version_id
            WHERE ai.user_id = ?
            ORDER BY ai.sort_order ASC, ai.created_at DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(size)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(row_to_assistant_install_item(&row)?);
        }

        let next_offset = offset + size;
        let next_page = if next_offset < total {
            Some(next_offset.to_string())
        } else {
            None
        };
        let previous_page = if offset > 0 {
            Some((offset - size).max(0).to_string())
        } else {
            None
        };

        Ok(LocalAssistantInstallPage {
            items,
            next_page,
            previous_page,
        })
    }

    pub async fn install_local_assistant(
        &self,
        assistant_id: &str,
        payload: LocalAssistantInstallCreateRequest,
    ) -> Result<LocalAssistantInstallItem, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let assistant_row = sqlx::query(
            r#"
            SELECT id, current_version_id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let assistant_row =
            assistant_row.ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?;
        let assistant_current_version_id: Option<String> =
            assistant_row.try_get("current_version_id")?;

        let existing_row = sqlx::query(
            r#"
            SELECT id
            FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if existing_row.is_some() {
            let now = now_rfc3339()?;
            self.refresh_assistant_install_count(&normalized_assistant_id, &now)
                .await?;
            return self
                .get_local_assistant_install_item(&normalized_assistant_id)
                .await?
                .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()));
        }

        let mut pinned_version_id = payload.pinned_version_id.and_then(|raw| {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let mut follow_latest = payload.follow_latest.unwrap_or(true);

        if let Some(pinned_id) = pinned_version_id.as_deref() {
            let version_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE id = ? AND assistant_id = ?
                LIMIT 1;
                "#,
            )
            .bind(pinned_id)
            .bind(&normalized_assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if version_row.is_none() {
                return Err(McpError::validation("pinned_version_id is invalid"));
            }
            follow_latest = false;
        }

        if !follow_latest && pinned_version_id.is_none() {
            pinned_version_id = assistant_current_version_id;
        }

        let max_row = sqlx::query(
            r#"
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort
            FROM assistant_install
            WHERE user_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let install_id = Uuid::new_v4().to_string();
        let sort_order = max_row.try_get::<i64, _>("next_sort").unwrap_or(0);
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            INSERT INTO assistant_install (
              id, user_id, assistant_id, alias, icon_override, pinned_version_id,
              follow_latest, is_enabled, sort_order, created_at, updated_at
            )
            VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?, ?);
            "#,
        )
        .bind(&install_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .bind(pinned_version_id.as_deref())
        .bind(if follow_latest { 1 } else { 0 })
        .bind(sort_order)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.refresh_assistant_install_count(&normalized_assistant_id, &now)
            .await?;
        self.sync_assistant_registry_entry(&normalized_assistant_id)
            .await?;

        self.get_local_assistant_install_item(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()))
    }

    pub async fn update_local_assistant_install(
        &self,
        assistant_id: &str,
        payload: LocalAssistantInstallUpdateRequest,
    ) -> Result<LocalAssistantInstallItem, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let assistant_row = sqlx::query(
            r#"
            SELECT current_version_id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let assistant_current_version_id: Option<String> = assistant_row
            .ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?
            .try_get("current_version_id")?;

        let existing_row = sqlx::query(
            r#"
            SELECT id, alias, icon_override, pinned_version_id, follow_latest, is_enabled, sort_order
            FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()))?;

        let install_id: String = existing_row.try_get("id")?;
        let alias_existing: Option<String> = existing_row.try_get("alias")?;
        let icon_override_existing: Option<String> = existing_row.try_get("icon_override")?;
        let pinned_existing: Option<String> = existing_row.try_get("pinned_version_id")?;
        let follow_latest_existing =
            existing_row.try_get::<i64, _>("follow_latest").unwrap_or(1) != 0;
        let is_enabled_existing = existing_row.try_get::<i64, _>("is_enabled").unwrap_or(1) != 0;
        let sort_order_existing = existing_row.try_get::<i64, _>("sort_order").unwrap_or(0);

        let alias = payload
            .alias
            .map(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or(alias_existing);
        let icon_override = payload
            .icon_override
            .map(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or(icon_override_existing);

        let payload_follow_latest = payload.follow_latest;
        let payload_has_pinned_version = payload.pinned_version_id.is_some();
        let mut pinned_version_id = payload
            .pinned_version_id
            .map(|raw| {
                let trimmed = raw.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or(pinned_existing);

        let mut follow_latest = payload_follow_latest.unwrap_or(follow_latest_existing);
        if let Some(pinned_id) = pinned_version_id.as_deref() {
            let version_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE id = ? AND assistant_id = ?
                LIMIT 1;
                "#,
            )
            .bind(pinned_id)
            .bind(&normalized_assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            if version_row.is_none() {
                return Err(McpError::validation("pinned_version_id is invalid"));
            }
            if payload_follow_latest.is_none() {
                follow_latest = false;
            }
        }

        if payload_follow_latest == Some(true) {
            pinned_version_id = None;
        } else if payload_follow_latest == Some(false) && !payload_has_pinned_version {
            pinned_version_id = assistant_current_version_id.clone();
        } else if !follow_latest && pinned_version_id.is_none() {
            pinned_version_id = assistant_current_version_id;
        }

        let is_enabled = payload.is_enabled.unwrap_or(is_enabled_existing);
        let sort_order = payload.sort_order.unwrap_or(sort_order_existing).max(0);
        let now = now_rfc3339()?;

        sqlx::query(
            r#"
            UPDATE assistant_install
            SET alias = ?, icon_override = ?, pinned_version_id = ?, follow_latest = ?, is_enabled = ?, sort_order = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(alias.as_deref())
        .bind(icon_override.as_deref())
        .bind(pinned_version_id.as_deref())
        .bind(if follow_latest { 1 } else { 0 })
        .bind(if is_enabled { 1 } else { 0 })
        .bind(sort_order)
        .bind(&now)
        .bind(&install_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        self.sync_assistant_registry_entry(&normalized_assistant_id)
            .await?;

        self.get_local_assistant_install_item(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::NotFound("assistant install not found".to_string()))
    }

    pub async fn uninstall_local_assistant(&self, assistant_id: &str) -> Result<(), McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let now = now_rfc3339()?;
        let result = sqlx::query(
            r#"
            DELETE FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(McpError::NotFound(
                "assistant install not found".to_string(),
            ));
        }

        self.refresh_assistant_install_count(&normalized_assistant_id, &now)
            .await?;
        self.sync_assistant_registry_entry(&normalized_assistant_id)
            .await?;

        Ok(())
    }

    pub async fn rate_local_assistant(
        &self,
        assistant_id: &str,
        payload: LocalAssistantRatingRequest,
    ) -> Result<LocalAssistantRatingResponse, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        if payload.rating < 1.0 || payload.rating > 5.0 {
            return Err(McpError::validation("rating must be between 1 and 5"));
        }

        let assistant_row = sqlx::query(
            r#"
            SELECT id, rating_avg, rating_count
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?
        .ok_or_else(|| McpError::NotFound("assistant not found".to_string()))?;

        let install_row = sqlx::query(
            r#"
            SELECT id
            FROM assistant_install
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if install_row.is_none() {
            return Err(McpError::validation("assistant is not installed"));
        }

        let existing_row = sqlx::query(
            r#"
            SELECT id, rating
            FROM assistant_rating
            WHERE user_id = ? AND assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut rating_avg = assistant_row.try_get::<f64, _>("rating_avg").unwrap_or(0.0);
        let mut rating_count = assistant_row.try_get::<i64, _>("rating_count").unwrap_or(0);
        let now = now_rfc3339()?;

        if let Some(row) = existing_row {
            let rating_id: String = row.try_get("id")?;
            let old_rating = row.try_get::<f64, _>("rating").unwrap_or(0.0);
            if old_rating == payload.rating {
                return Ok(LocalAssistantRatingResponse {
                    assistant_id: normalized_assistant_id,
                    rating_avg,
                    rating_count,
                });
            }

            sqlx::query(
                r#"
                UPDATE assistant_rating
                SET rating = ?, updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(payload.rating)
            .bind(&now)
            .bind(&rating_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if rating_count <= 0 {
                let refreshed = self
                    .refresh_assistant_rating(&normalized_assistant_id, &now)
                    .await?;
                rating_avg = refreshed.0;
                rating_count = refreshed.1;
            } else {
                let new_avg = (rating_avg * rating_count as f64 - old_rating + payload.rating)
                    / rating_count as f64;
                rating_avg = round_to_4(new_avg);
                sqlx::query(
                    r#"
                    UPDATE assistant
                    SET rating_avg = ?, updated_at = ?
                    WHERE id = ?;
                    "#,
                )
                .bind(rating_avg)
                .bind(&now)
                .bind(&normalized_assistant_id)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            }
        } else {
            let rating_id = Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO assistant_rating (
                  id, user_id, assistant_id, rating, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?);
                "#,
            )
            .bind(&rating_id)
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&normalized_assistant_id)
            .bind(payload.rating)
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            let new_count = rating_count + 1;
            let new_avg = (rating_avg * rating_count as f64 + payload.rating) / new_count as f64;
            rating_count = new_count;
            rating_avg = round_to_4(new_avg);
            sqlx::query(
                r#"
                UPDATE assistant
                SET rating_count = ?, rating_avg = ?, updated_at = ?
                WHERE id = ?;
                "#,
            )
            .bind(rating_count)
            .bind(rating_avg)
            .bind(&now)
            .bind(&normalized_assistant_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        Ok(LocalAssistantRatingResponse {
            assistant_id: normalized_assistant_id,
            rating_avg,
            rating_count,
        })
    }

    pub async fn record_local_assistant_routing_trial(
        &self,
        assistant_id: &str,
    ) -> Result<LocalAssistantRoutingState, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let assistant_exists = sqlx::query(
            r#"
            SELECT id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if assistant_exists.is_none() {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }

        let now = now_rfc3339()?;
        let state_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO assistant_routing_state (
              id, assistant_id, total_trials, positive_feedback, negative_feedback,
              last_used_at, last_feedback_at, created_at, updated_at
            )
            VALUES (?, ?, 1, 0, 0, ?, NULL, ?, ?)
            ON CONFLICT(assistant_id) DO UPDATE
            SET total_trials = assistant_routing_state.total_trials + 1,
                last_used_at = excluded.last_used_at,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&state_id)
        .bind(&normalized_assistant_id)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_local_assistant_routing_state(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::Storage("assistant routing state not found".to_string()))
    }

    pub async fn record_local_assistant_routing_feedback(
        &self,
        assistant_id: &str,
        payload: LocalAssistantRoutingFeedbackRequest,
    ) -> Result<LocalAssistantRoutingState, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let is_positive = parse_assistant_routing_feedback_event(&payload.event)
            .ok_or_else(|| McpError::validation("unknown feedback event"))?;

        let assistant_exists = sqlx::query(
            r#"
            SELECT id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        if assistant_exists.is_none() {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }

        let positive_inc = if is_positive { 1_i64 } else { 0_i64 };
        let negative_inc = if is_positive { 0_i64 } else { 1_i64 };
        let now = now_rfc3339()?;
        let state_id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO assistant_routing_state (
              id, assistant_id, total_trials, positive_feedback, negative_feedback,
              last_used_at, last_feedback_at, created_at, updated_at
            )
            VALUES (?, ?, 0, ?, ?, NULL, ?, ?, ?)
            ON CONFLICT(assistant_id) DO UPDATE
            SET positive_feedback = assistant_routing_state.positive_feedback + ?,
                negative_feedback = assistant_routing_state.negative_feedback + ?,
                last_feedback_at = excluded.last_feedback_at,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(&state_id)
        .bind(&normalized_assistant_id)
        .bind(positive_inc)
        .bind(negative_inc)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .bind(positive_inc)
        .bind(negative_inc)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.get_local_assistant_routing_state(&normalized_assistant_id)
            .await?
            .ok_or_else(|| McpError::Storage("assistant routing state not found".to_string()))
    }

    pub async fn get_local_assistant_routing_report(
        &self,
        query: LocalAssistantRoutingReportQuery,
    ) -> Result<LocalAssistantRoutingReportResponse, McpError> {
        let limit = query.limit.unwrap_or(50).clamp(1, 500) as usize;
        let sort_key = query
            .sort
            .as_deref()
            .unwrap_or("score_desc")
            .trim()
            .to_ascii_lowercase();
        let allowed_sorts = [
            "score_desc",
            "routing_score_desc",
            "rating_desc",
            "trials_desc",
            "recent_desc",
        ];
        if !allowed_sorts.contains(&sort_key.as_str()) {
            return Err(McpError::validation("invalid sort option"));
        }

        let rows = sqlx::query(
            r#"
            SELECT
              ars.assistant_id AS assistant_id,
              ars.total_trials AS total_trials,
              ars.positive_feedback AS positive_feedback,
              ars.negative_feedback AS negative_feedback,
              ars.last_used_at AS last_used_at,
              ars.last_feedback_at AS last_feedback_at,
              a.summary AS assistant_summary,
              av.name AS version_name
            FROM assistant_routing_state ars
            JOIN assistant a ON a.id = ars.assistant_id
            LEFT JOIN assistant_version av ON a.current_version_id = av.id;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let total_trials = row.try_get::<i64, _>("total_trials").unwrap_or(0);
            let positive_feedback = row.try_get::<i64, _>("positive_feedback").unwrap_or(0);
            let negative_feedback = row.try_get::<i64, _>("negative_feedback").unwrap_or(0);
            let rating_score = (positive_feedback as f64 + 1.0)
                / (positive_feedback as f64 + negative_feedback as f64 + 2.0);
            let mab_score = rating_score;
            let exploration_bonus = if total_trials < 10 { 0.2 } else { 0.0 };
            let routing_score = (rating_score * 0.75) + (exploration_bonus * 0.25);
            items.push(LocalAssistantRoutingReportItem {
                assistant_id: row.try_get::<String, _>("assistant_id")?,
                name: row
                    .try_get::<Option<String>, _>("version_name")
                    .ok()
                    .flatten(),
                summary: row
                    .try_get::<Option<String>, _>("assistant_summary")
                    .ok()
                    .flatten(),
                total_trials,
                positive_feedback,
                negative_feedback,
                rating_score,
                mab_score,
                routing_score,
                exploration_bonus,
                last_used_at: row
                    .try_get::<Option<String>, _>("last_used_at")
                    .ok()
                    .flatten(),
                last_feedback_at: row
                    .try_get::<Option<String>, _>("last_feedback_at")
                    .ok()
                    .flatten(),
            });
        }

        if let Some(min_trials) = query.min_trials {
            items.retain(|item| item.total_trials >= min_trials.max(0));
        }
        if let Some(min_rating) = query.min_rating {
            items.retain(|item| item.rating_score >= min_rating.max(0.0));
        }

        match sort_key.as_str() {
            "rating_desc" => {
                items.sort_by(|a, b| b.rating_score.total_cmp(&a.rating_score));
            }
            "trials_desc" => {
                items.sort_by(|a, b| b.total_trials.cmp(&a.total_trials));
            }
            "recent_desc" => {
                items.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at));
            }
            _ => {
                items.sort_by(|a, b| b.routing_score.total_cmp(&a.routing_score));
            }
        }

        if items.len() > limit {
            items.truncate(limit);
        }

        let total_assistants = items.len() as i64;
        let total_trials: i64 = items.iter().map(|item| item.total_trials).sum();
        let total_positive: i64 = items.iter().map(|item| item.positive_feedback).sum();
        let total_negative: i64 = items.iter().map(|item| item.negative_feedback).sum();
        let overall_rating = if total_assistants > 0 {
            items.iter().map(|item| item.rating_score).sum::<f64>() / total_assistants as f64
        } else {
            0.0
        };

        Ok(LocalAssistantRoutingReportResponse {
            summary: LocalAssistantRoutingReportSummary {
                total_assistants,
                total_trials,
                total_positive,
                total_negative,
                overall_rating,
            },
            items,
        })
    }

    pub async fn get_local_assistant_routing_state(
        &self,
        assistant_id: &str,
    ) -> Result<Option<LocalAssistantRoutingState>, McpError> {
        let normalized_assistant_id = assistant_id.trim().to_string();
        if normalized_assistant_id.is_empty() {
            return Err(McpError::validation("assistant_id is required"));
        }

        let row = sqlx::query(
            r#"
            SELECT assistant_id, total_trials, positive_feedback, negative_feedback, last_used_at, last_feedback_at
            FROM assistant_routing_state
            WHERE assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(&normalized_assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        row.map(|row| {
            Ok(LocalAssistantRoutingState {
                assistant_id: row.try_get("assistant_id")?,
                total_trials: row.try_get::<i64, _>("total_trials").unwrap_or(0),
                positive_feedback: row.try_get::<i64, _>("positive_feedback").unwrap_or(0),
                negative_feedback: row.try_get::<i64, _>("negative_feedback").unwrap_or(0),
                last_used_at: row
                    .try_get::<Option<String>, _>("last_used_at")
                    .ok()
                    .flatten(),
                last_feedback_at: row
                    .try_get::<Option<String>, _>("last_feedback_at")
                    .ok()
                    .flatten(),
            })
        })
        .transpose()
    }

    pub async fn create_local_trace_feedback(
        &self,
        payload: LocalTraceFeedbackRequest,
    ) -> Result<LocalTraceFeedback, McpError> {
        let trace_id = payload.trace_id.trim().to_string();
        if trace_id.is_empty() {
            return Err(McpError::validation("trace_id is required"));
        }
        if trace_id.len() > 64 {
            return Err(McpError::validation("trace_id must be <= 64 characters"));
        }
        if !payload.score.is_finite() || payload.score < -1.0 || payload.score > 1.0 {
            return Err(McpError::validation("score must be between -1.0 and 1.0"));
        }

        let comment = payload.comment.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let tags = payload.tags.map(normalize_feedback_tags);
        let tags_json = serialize_json(&tags)?;
        let now = now_rfc3339()?;
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO trace_feedback (
              id, trace_id, user_id, score, comment, tags, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&trace_id)
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(payload.score)
        .bind(comment.as_deref())
        .bind(tags_json.as_deref())
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalTraceFeedback {
            id,
            trace_id,
            user_id: Some(LOCAL_DESKTOP_USER_ID.to_string()),
            score: payload.score,
            comment,
            tags,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn create_local_gateway_log(
        &self,
        trace_id: Option<&str>,
        user_id: Option<&str>,
        api_key_id: Option<&str>,
        preset_id: Option<&str>,
        model: &str,
        status_code: i64,
        duration_ms: i64,
        ttft_ms: Option<i64>,
        upstream_url: Option<&str>,
        retry_count: i64,
        input_tokens: i64,
        output_tokens: i64,
        total_tokens: i64,
        cost_upstream: f64,
        cost_user: f64,
        is_cached: bool,
        error_code: Option<&str>,
        meta: Option<&serde_json::Value>,
    ) -> Result<(), McpError> {
        let normalized_model = model.trim().to_string();
        if normalized_model.is_empty() {
            return Err(McpError::validation("model is required"));
        }
        let normalized_trace_id = trace_id.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let normalized_user_id =
            normalize_optional_text(user_id).unwrap_or_else(|| LOCAL_DESKTOP_USER_ID.to_string());
        let normalized_api_key_id = normalize_optional_text(api_key_id);
        let normalized_preset_id = normalize_optional_text(preset_id);
        if let Some(value) = normalized_trace_id.as_deref() {
            if value.len() > 64 {
                return Err(McpError::validation("trace_id must be <= 64 characters"));
            }
        }
        let normalized_error_code = error_code.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let normalized_upstream_url = upstream_url.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });
        let meta_json = meta
            .map(serde_json::to_string)
            .transpose()
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let now = now_rfc3339()?;
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO gateway_log (
              id, user_id, trace_id, api_key_id, preset_id, model, status_code, duration_ms, ttft_ms,
              upstream_url, retry_count, input_tokens, output_tokens, total_tokens,
              cost_upstream, cost_user, is_cached, error_code, meta, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(normalized_user_id)
        .bind(normalized_trace_id.as_deref())
        .bind(normalized_api_key_id.as_deref())
        .bind(normalized_preset_id.as_deref())
        .bind(&normalized_model)
        .bind(status_code.max(0))
        .bind(duration_ms.max(0))
        .bind(ttft_ms.filter(|value| *value > 0))
        .bind(normalized_upstream_url.as_deref())
        .bind(retry_count.max(0))
        .bind(input_tokens.max(0))
        .bind(output_tokens.max(0))
        .bind(total_tokens.max(0))
        .bind(if cost_upstream.is_finite() {
            cost_upstream.max(0.0)
        } else {
            0.0
        })
        .bind(if cost_user.is_finite() {
            cost_user.max(0.0)
        } else {
            0.0
        })
        .bind(if is_cached { 1 } else { 0 })
        .bind(normalized_error_code.as_deref())
        .bind(meta_json.as_deref())
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(())
    }

    pub async fn list_local_gateway_logs(
        &self,
        query: LocalGatewayLogQuery,
    ) -> Result<LocalGatewayLogListResponse, McpError> {
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(100).clamp(1, 1000);
        let (
            start_time,
            end_time,
            user_id,
            api_key_id,
            preset_id,
            model,
            status_code,
            is_cached,
            error_code,
        ) = normalize_gateway_log_query(query);

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE (? IS NULL OR user_id = ?)
              AND (? IS NULL OR api_key_id = ?)
              AND (? IS NULL OR preset_id = ?)
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
              AND (? IS NULL OR error_code = ?)
              AND (? IS NULL OR julianday(created_at) >= julianday(?))
              AND (? IS NULL OR julianday(created_at) <= julianday(?));
            "#,
        )
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .bind(error_code.as_deref())
        .bind(error_code.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT
              id, trace_id, user_id, api_key_id, preset_id, model, status_code, duration_ms, ttft_ms,
              input_tokens, output_tokens, total_tokens, cost_upstream, cost_user, is_cached,
              error_code, created_at
            FROM gateway_log
            WHERE (? IS NULL OR user_id = ?)
              AND (? IS NULL OR api_key_id = ?)
              AND (? IS NULL OR preset_id = ?)
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
              AND (? IS NULL OR error_code = ?)
              AND (? IS NULL OR julianday(created_at) >= julianday(?))
              AND (? IS NULL OR julianday(created_at) <= julianday(?))
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .bind(error_code.as_deref())
        .bind(error_code.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(LocalGatewayLogItem {
                id: row.try_get("id")?,
                trace_id: row.try_get("trace_id")?,
                user_id: row.try_get("user_id")?,
                api_key_id: row.try_get("api_key_id")?,
                preset_id: row.try_get("preset_id")?,
                model: row.try_get("model")?,
                status_code: row.try_get("status_code")?,
                duration_ms: row.try_get::<i64, _>("duration_ms")?.max(0),
                ttft_ms: row.try_get("ttft_ms")?,
                input_tokens: row.try_get::<i64, _>("input_tokens")?.max(0),
                output_tokens: row.try_get::<i64, _>("output_tokens")?.max(0),
                total_tokens: row.try_get::<i64, _>("total_tokens")?.max(0),
                cost_upstream: row.try_get::<f64, _>("cost_upstream").unwrap_or(0.0),
                cost_user: row.try_get::<f64, _>("cost_user").unwrap_or(0.0),
                is_cached: row.try_get::<i64, _>("is_cached")? != 0,
                error_code: row.try_get("error_code")?,
                created_at: row.try_get("created_at")?,
            });
        }

        Ok(LocalGatewayLogListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn create_local_maintenance_log(
        &self,
        kind: &str,
        status: &str,
        message: &str,
        details: Option<&serde_json::Value>,
    ) -> Result<LocalMaintenanceLogItem, McpError> {
        let normalized_kind = kind.trim().to_string();
        let normalized_status = status.trim().to_string();
        let normalized_message = message.trim().to_string();
        if normalized_kind.is_empty() {
            return Err(McpError::validation("kind is required"));
        }
        if normalized_status.is_empty() {
            return Err(McpError::validation("status is required"));
        }
        if normalized_message.is_empty() {
            return Err(McpError::validation("message is required"));
        }

        let id = Uuid::new_v4().to_string();
        let created_at = now_rfc3339()?;
        let details_json = details
            .map(serde_json::to_string)
            .transpose()
            .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            INSERT INTO maintenance_log (id, kind, status, message, details, created_at)
            VALUES (?, ?, ?, ?, ?, ?);
            "#,
        )
        .bind(&id)
        .bind(&normalized_kind)
        .bind(&normalized_status)
        .bind(&normalized_message)
        .bind(details_json.as_deref())
        .bind(&created_at)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok(LocalMaintenanceLogItem {
            id,
            kind: normalized_kind,
            status: normalized_status,
            message: normalized_message,
            details: details.cloned(),
            created_at,
        })
    }

    pub async fn list_local_maintenance_logs(
        &self,
        query: LocalMaintenanceLogQuery,
    ) -> Result<LocalMaintenanceLogListResponse, McpError> {
        let skip = query.skip.unwrap_or(0).max(0);
        let limit = query.limit.unwrap_or(20).clamp(1, 100);
        let kind = normalize_optional_text(query.kind.as_deref());
        let status = normalize_optional_text(query.status.as_deref());

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM maintenance_log
            WHERE (? IS NULL OR kind = ?)
              AND (? IS NULL OR status = ?);
            "#,
        )
        .bind(kind.as_deref())
        .bind(kind.as_deref())
        .bind(status.as_deref())
        .bind(status.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let rows = sqlx::query(
            r#"
            SELECT id, kind, status, message, details, created_at
            FROM maintenance_log
            WHERE (? IS NULL OR kind = ?)
              AND (? IS NULL OR status = ?)
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?;
            "#,
        )
        .bind(kind.as_deref())
        .bind(kind.as_deref())
        .bind(status.as_deref())
        .bind(status.as_deref())
        .bind(limit)
        .bind(skip)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let details = row
                .try_get::<Option<String>, _>("details")?
                .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok());
            items.push(LocalMaintenanceLogItem {
                id: row.try_get("id")?,
                kind: row.try_get("kind")?,
                status: row.try_get("status")?,
                message: row.try_get("message")?,
                details,
                created_at: row.try_get("created_at")?,
            });
        }

        Ok(LocalMaintenanceLogListResponse {
            total,
            skip,
            limit,
            items,
        })
    }

    pub async fn get_local_gateway_log_stats(
        &self,
        query: LocalGatewayLogQuery,
    ) -> Result<LocalGatewayLogStatsResponse, McpError> {
        let (
            start_time,
            end_time,
            user_id,
            api_key_id,
            preset_id,
            model,
            status_code,
            is_cached,
            error_code,
        ) = normalize_gateway_log_query(query);

        let total_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE (? IS NULL OR user_id = ?)
              AND (? IS NULL OR api_key_id = ?)
              AND (? IS NULL OR preset_id = ?)
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
              AND (? IS NULL OR error_code = ?)
              AND (? IS NULL OR julianday(created_at) >= julianday(?))
              AND (? IS NULL OR julianday(created_at) <= julianday(?));
            "#,
        )
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .bind(error_code.as_deref())
        .bind(error_code.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let total: i64 = total_row.try_get("total")?;

        let success_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE status_code >= 200
              AND status_code < 400
              AND (? IS NULL OR user_id = ?)
              AND (? IS NULL OR api_key_id = ?)
              AND (? IS NULL OR preset_id = ?)
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
              AND (? IS NULL OR error_code = ?)
              AND (? IS NULL OR julianday(created_at) >= julianday(?))
              AND (? IS NULL OR julianday(created_at) <= julianday(?));
            "#,
        )
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .bind(error_code.as_deref())
        .bind(error_code.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let success_count: i64 = success_row.try_get("total")?;

        let cached_row = sqlx::query(
            r#"
            SELECT COUNT(*) AS total
            FROM gateway_log
            WHERE is_cached = 1
              AND (? IS NULL OR user_id = ?)
              AND (? IS NULL OR api_key_id = ?)
              AND (? IS NULL OR preset_id = ?)
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
              AND (? IS NULL OR error_code = ?)
              AND (? IS NULL OR julianday(created_at) >= julianday(?))
              AND (? IS NULL OR julianday(created_at) <= julianday(?));
            "#,
        )
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .bind(error_code.as_deref())
        .bind(error_code.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let cached_count: i64 = cached_row.try_get("total")?;

        let aggregate_row = sqlx::query(
            r#"
            SELECT
              COALESCE(ROUND(AVG(duration_ms)), 0) AS avg_duration_ms,
              COALESCE(SUM(cost_user), 0) AS total_cost_user
            FROM gateway_log
            WHERE (? IS NULL OR user_id = ?)
              AND (? IS NULL OR api_key_id = ?)
              AND (? IS NULL OR preset_id = ?)
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
              AND (? IS NULL OR error_code = ?)
              AND (? IS NULL OR julianday(created_at) >= julianday(?))
              AND (? IS NULL OR julianday(created_at) <= julianday(?));
            "#,
        )
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .bind(error_code.as_deref())
        .bind(error_code.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let avg_duration_ms = aggregate_row
            .try_get::<f64, _>("avg_duration_ms")
            .map(|value| value.round() as i64)
            .or_else(|_| aggregate_row.try_get::<i64, _>("avg_duration_ms"))
            .unwrap_or(0)
            .max(0);
        let total_cost_user = aggregate_row
            .try_get::<f64, _>("total_cost_user")
            .unwrap_or(0.0)
            .max(0.0);

        let error_rows = sqlx::query(
            r#"
            SELECT COALESCE(error_code, CAST(status_code AS TEXT)) AS bucket, COUNT(*) AS count
            FROM gateway_log
            WHERE (? IS NULL OR user_id = ?)
              AND (? IS NULL OR api_key_id = ?)
              AND (? IS NULL OR preset_id = ?)
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
              AND (? IS NULL OR error_code = ?)
              AND (? IS NULL OR julianday(created_at) >= julianday(?))
              AND (? IS NULL OR julianday(created_at) <= julianday(?))
            GROUP BY bucket
            ORDER BY COUNT(*) DESC
            LIMIT 20;
            "#,
        )
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .bind(error_code.as_deref())
        .bind(error_code.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let mut error_distribution = Vec::with_capacity(error_rows.len());
        for row in error_rows {
            error_distribution.push(LocalGatewayLogStatsBucket {
                key: row.try_get::<String, _>("bucket")?,
                count: row.try_get::<i64, _>("count")?,
            });
        }

        let model_rows = sqlx::query(
            r#"
            SELECT model AS bucket, COUNT(*) AS count
            FROM gateway_log
            WHERE (? IS NULL OR user_id = ?)
              AND (? IS NULL OR api_key_id = ?)
              AND (? IS NULL OR preset_id = ?)
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
              AND (? IS NULL OR error_code = ?)
              AND (? IS NULL OR julianday(created_at) >= julianday(?))
              AND (? IS NULL OR julianday(created_at) <= julianday(?))
            GROUP BY model
            ORDER BY COUNT(*) DESC
            LIMIT 20;
            "#,
        )
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .bind(error_code.as_deref())
        .bind(error_code.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let mut model_ranking = Vec::with_capacity(model_rows.len());
        for row in model_rows {
            model_ranking.push(LocalGatewayLogStatsBucket {
                key: row.try_get::<String, _>("bucket")?,
                count: row.try_get::<i64, _>("count")?,
            });
        }

        let latency_rows = sqlx::query(
            r#"
            SELECT
              CASE
                WHEN duration_ms < 200 THEN 'lt_200ms'
                WHEN duration_ms < 500 THEN '200_500ms'
                WHEN duration_ms < 1000 THEN '500_1000ms'
                ELSE 'gte_1000ms'
              END AS bucket,
              COUNT(*) AS count
            FROM gateway_log
            WHERE (? IS NULL OR user_id = ?)
              AND (? IS NULL OR api_key_id = ?)
              AND (? IS NULL OR preset_id = ?)
              AND (? IS NULL OR model = ?)
              AND (? IS NULL OR status_code = ?)
              AND (? IS NULL OR is_cached = ?)
              AND (? IS NULL OR error_code = ?)
              AND (? IS NULL OR julianday(created_at) >= julianday(?))
              AND (? IS NULL OR julianday(created_at) <= julianday(?))
            GROUP BY bucket
            ORDER BY COUNT(*) DESC;
            "#,
        )
        .bind(user_id.as_deref())
        .bind(user_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(api_key_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(preset_id.as_deref())
        .bind(model.as_deref())
        .bind(model.as_deref())
        .bind(status_code)
        .bind(status_code)
        .bind(is_cached)
        .bind(is_cached)
        .bind(error_code.as_deref())
        .bind(error_code.as_deref())
        .bind(start_time.as_deref())
        .bind(start_time.as_deref())
        .bind(end_time.as_deref())
        .bind(end_time.as_deref())
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        let mut latency_histogram = Vec::with_capacity(latency_rows.len());
        for row in latency_rows {
            latency_histogram.push(LocalGatewayLogStatsBucket {
                key: row.try_get::<String, _>("bucket")?,
                count: row.try_get::<i64, _>("count")?,
            });
        }

        let success_rate = if total > 0 {
            ((success_count as f64 / total as f64) * 100.0 * 100.0).round() / 100.0
        } else {
            0.0
        };
        let cache_hit_rate = if total > 0 {
            ((cached_count as f64 / total as f64) * 100.0 * 100.0).round() / 100.0
        } else {
            0.0
        };

        Ok(LocalGatewayLogStatsResponse {
            total,
            success_rate,
            cache_hit_rate,
            avg_duration_ms,
            total_cost_user,
            error_distribution,
            model_ranking,
            latency_histogram,
        })
    }

    pub(crate) async fn migrate_assistant_versions_from_legacy(&self) -> Result<(), McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, description, system_prompt, model_config, tags, is_deleted, created_at, updated_at
            FROM assistants;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        for row in rows {
            let assistant_id: String = row.try_get("id")?;
            let name: String = row.try_get("name")?;
            let description: Option<String> = row.try_get("description")?;
            let system_prompt: String = row.try_get("system_prompt")?;
            let model_config: Option<String> = row.try_get("model_config")?;
            let tags: Option<String> = row.try_get("tags")?;
            let is_deleted = row.try_get::<i64, _>("is_deleted").unwrap_or(0) != 0;
            let created_at: String = row.try_get("created_at")?;
            let updated_at: String = row.try_get("updated_at")?;
            let published_at = if is_deleted {
                None
            } else {
                Some(created_at.as_str())
            };

            self.ensure_assistant_version_synced(
                &assistant_id,
                &name,
                description.as_deref(),
                &system_prompt,
                model_config.as_deref(),
                tags.as_deref(),
                published_at,
                &created_at,
                &updated_at,
            )
            .await?;
        }

        Ok(())
    }

    pub(crate) async fn migrate_assistant_installs_from_assistant(&self) -> Result<(), McpError> {
        let rows = sqlx::query(
            r#"
            SELECT id, status, created_at
            FROM assistant
            ORDER BY created_at ASC, id ASC;
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut sort_order = 0_i64;
        for row in rows {
            let assistant_id: String = row.try_get("id")?;
            let status: String = row.try_get("status")?;
            let created_at: String = row.try_get("created_at")?;
            if status == "archived" {
                continue;
            }

            let existing = sqlx::query(
                r#"
                SELECT id
                FROM assistant_install
                WHERE user_id = ? AND assistant_id = ?
                LIMIT 1;
                "#,
            )
            .bind(LOCAL_DESKTOP_USER_ID)
            .bind(&assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if existing.is_none() {
                let install_id = Uuid::new_v4().to_string();
                sqlx::query(
                    r#"
                    INSERT INTO assistant_install (
                      id, user_id, assistant_id, alias, icon_override, pinned_version_id,
                      follow_latest, is_enabled, sort_order, created_at, updated_at
                    )
                    VALUES (?, ?, ?, NULL, NULL, NULL, 1, 1, ?, ?, ?);
                    "#,
                )
                .bind(&install_id)
                .bind(LOCAL_DESKTOP_USER_ID)
                .bind(&assistant_id)
                .bind(sort_order)
                .bind(&created_at)
                .bind(&created_at)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            }

            self.refresh_assistant_install_count(&assistant_id, &created_at)
                .await?;
            sort_order += 1;
        }

        Ok(())
    }

    pub(crate) async fn refresh_assistant_install_count(
        &self,
        assistant_id: &str,
        updated_at: &str,
    ) -> Result<(), McpError> {
        sqlx::query(
            r#"
            UPDATE assistant
            SET install_count = (
                SELECT COUNT(1)
                FROM assistant_install
                WHERE assistant_id = ?
            ),
            updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(assistant_id)
        .bind(updated_at)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
        Ok(())
    }

    pub(crate) async fn sync_local_assistant_tags(
        &self,
        assistant_id: &str,
        tags_json: Option<&str>,
        updated_at: &str,
    ) -> Result<(), McpError> {
        let raw_tags: Vec<String> = match tags_json {
            Some(value) if !value.trim().is_empty() => {
                serde_json::from_str(value).unwrap_or_default()
            }
            _ => Vec::new(),
        };
        let normalized = normalize_assistant_tag_names(raw_tags);

        let existing_rows = sqlx::query(
            r#"
            SELECT t.id AS tag_id, t.name AS tag_name
            FROM assistant_tag_link l
            INNER JOIN assistant_tag t ON t.id = l.tag_id
            WHERE l.assistant_id = ?;
            "#,
        )
        .bind(assistant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let mut existing_by_name: HashMap<String, String> = HashMap::new();
        let mut current_ids: HashSet<String> = HashSet::new();
        for row in existing_rows {
            let tag_id: String = row.try_get("tag_id")?;
            let tag_name: String = row.try_get("tag_name")?;
            current_ids.insert(tag_id.clone());
            existing_by_name.insert(tag_name, tag_id);
        }

        let mut desired_ids: HashSet<String> = HashSet::new();
        for name in normalized {
            if let Some(existing_id) = existing_by_name.get(&name) {
                desired_ids.insert(existing_id.clone());
                continue;
            }

            let existing_tag_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_tag
                WHERE name = ?
                LIMIT 1;
                "#,
            )
            .bind(&name)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
            let tag_id = if let Some(row) = existing_tag_row {
                row.try_get::<String, _>("id")?
            } else {
                let new_id = Uuid::new_v4().to_string();
                sqlx::query(
                    r#"
                    INSERT INTO assistant_tag (id, name, created_at, updated_at)
                    VALUES (?, ?, ?, ?);
                    "#,
                )
                .bind(&new_id)
                .bind(&name)
                .bind(updated_at)
                .bind(updated_at)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
                new_id
            };

            existing_by_name.insert(name, tag_id.clone());
            desired_ids.insert(tag_id);
        }

        for tag_id in current_ids.difference(&desired_ids) {
            sqlx::query(
                r#"
                DELETE FROM assistant_tag_link
                WHERE assistant_id = ? AND tag_id = ?;
                "#,
            )
            .bind(assistant_id)
            .bind(tag_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        for tag_id in desired_ids.difference(&current_ids) {
            sqlx::query(
                r#"
                INSERT OR IGNORE INTO assistant_tag_link (assistant_id, tag_id)
                VALUES (?, ?);
                "#,
            )
            .bind(assistant_id)
            .bind(tag_id)
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        }

        Ok(())
    }

    pub(crate) async fn refresh_assistant_rating(
        &self,
        assistant_id: &str,
        updated_at: &str,
    ) -> Result<(f64, i64), McpError> {
        let row = sqlx::query(
            r#"
            SELECT
              COALESCE(AVG(rating), 0.0) AS avg_rating,
              COUNT(1) AS total_count
            FROM assistant_rating
            WHERE assistant_id = ?;
            "#,
        )
        .bind(assistant_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        let avg_rating = round_to_4(row.try_get::<f64, _>("avg_rating").unwrap_or(0.0));
        let total_count = row.try_get::<i64, _>("total_count").unwrap_or(0);

        sqlx::query(
            r#"
            UPDATE assistant
            SET rating_avg = ?, rating_count = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(avg_rating)
        .bind(total_count)
        .bind(updated_at)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        Ok((avg_rating, total_count))
    }

    pub(crate) async fn get_local_assistant_install_item(
        &self,
        assistant_id: &str,
    ) -> Result<Option<LocalAssistantInstallItem>, McpError> {
        let row = sqlx::query(
            r#"
            SELECT
              ai.id AS install_id,
              ai.assistant_id AS install_assistant_id,
              ai.alias AS install_alias,
              ai.icon_override AS install_icon_override,
              ai.pinned_version_id AS install_pinned_version_id,
              ai.follow_latest AS install_follow_latest,
              ai.is_enabled AS install_is_enabled,
              ai.sort_order AS install_sort_order,
              a.owner_user_id AS assistant_owner_user_id,
              a.icon_id AS assistant_icon_id,
              a.share_slug AS assistant_share_slug,
              a.summary AS assistant_summary,
              a.published_at AS assistant_published_at,
              a.current_version_id AS assistant_current_version_id,
              a.install_count AS assistant_install_count,
              a.rating_avg AS assistant_rating_avg,
              a.rating_count AS assistant_rating_count,
              cv.id AS current_version_id,
              cv.version AS current_version,
              cv.name AS current_name,
              cv.description AS current_description,
              cv.system_prompt AS current_system_prompt,
              cv.tags AS current_tags,
              cv.published_at AS current_published_at,
              pv.id AS pinned_id,
              pv.version AS pinned_version,
              pv.name AS pinned_name,
              pv.description AS pinned_description,
              pv.system_prompt AS pinned_system_prompt,
              pv.tags AS pinned_tags,
              pv.published_at AS pinned_published_at
            FROM assistant_install ai
            INNER JOIN assistant a ON a.id = ai.assistant_id
            LEFT JOIN assistant_version cv ON cv.id = a.current_version_id
            LEFT JOIN assistant_version pv ON pv.id = ai.pinned_version_id
            WHERE ai.user_id = ? AND ai.assistant_id = ?
            LIMIT 1;
            "#,
        )
        .bind(LOCAL_DESKTOP_USER_ID)
        .bind(assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        match row {
            Some(row) => Ok(Some(row_to_assistant_install_item(&row)?)),
            None => Ok(None),
        }
    }

    pub(crate) async fn ensure_assistant_version_synced(
        &self,
        assistant_id: &str,
        name: &str,
        description: Option<&str>,
        system_prompt: &str,
        model_config_json: Option<&str>,
        tags_json: Option<&str>,
        published_at: Option<&str>,
        created_at: &str,
        updated_at: &str,
    ) -> Result<String, McpError> {
        let current_version_row = sqlx::query(
            r#"
            SELECT current_version_id
            FROM assistant
            WHERE id = ?
            LIMIT 1;
            "#,
        )
        .bind(assistant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        if current_version_row.is_none() {
            return Err(McpError::NotFound("assistant not found".to_string()));
        }

        let current_version_id: Option<String> =
            current_version_row.unwrap().try_get("current_version_id")?;

        let selected_version_id = if let Some(version_id) = current_version_id {
            let row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE id = ?
                LIMIT 1;
                "#,
            )
            .bind(&version_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if row.is_some() {
                version_id
            } else {
                let fallback_row = sqlx::query(
                    r#"
                    SELECT id
                    FROM assistant_version
                    WHERE assistant_id = ?
                    ORDER BY created_at DESC, id DESC
                    LIMIT 1;
                    "#,
                )
                .bind(assistant_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

                if let Some(row) = fallback_row {
                    row.try_get("id")?
                } else {
                    let new_version_id = Uuid::new_v4().to_string();
                    sqlx::query(
                        r#"
                        INSERT INTO assistant_version (
                          id, assistant_id, version, name, description, system_prompt, model_config,
                          tags, changelog, published_at, created_at, updated_at
                        )
                        VALUES (?, ?, '1.0.0', ?, ?, ?, ?, ?, NULL, ?, ?, ?);
                        "#,
                    )
                    .bind(&new_version_id)
                    .bind(assistant_id)
                    .bind(name)
                    .bind(description)
                    .bind(system_prompt)
                    .bind(model_config_json)
                    .bind(tags_json)
                    .bind(published_at)
                    .bind(created_at)
                    .bind(updated_at)
                    .execute(&self.pool)
                    .await
                    .map_err(|err| McpError::Storage(err.to_string()))?;
                    new_version_id
                }
            }
        } else {
            let existing_row = sqlx::query(
                r#"
                SELECT id
                FROM assistant_version
                WHERE assistant_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT 1;
                "#,
            )
            .bind(assistant_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            if let Some(row) = existing_row {
                row.try_get("id")?
            } else {
                let new_version_id = Uuid::new_v4().to_string();
                sqlx::query(
                    r#"
                    INSERT INTO assistant_version (
                      id, assistant_id, version, name, description, system_prompt, model_config,
                      tags, changelog, published_at, created_at, updated_at
                    )
                    VALUES (?, ?, '1.0.0', ?, ?, ?, ?, ?, NULL, ?, ?, ?);
                    "#,
                )
                .bind(&new_version_id)
                .bind(assistant_id)
                .bind(name)
                .bind(description)
                .bind(system_prompt)
                .bind(model_config_json)
                .bind(tags_json)
                .bind(published_at)
                .bind(created_at)
                .bind(updated_at)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
                new_version_id
            }
        };

        sqlx::query(
            r#"
            UPDATE assistant_version
            SET name = ?, description = ?, system_prompt = ?, model_config = ?,
                tags = ?, updated_at = ?, published_at = COALESCE(?, published_at)
            WHERE id = ?;
            "#,
        )
        .bind(name)
        .bind(description)
        .bind(system_prompt)
        .bind(model_config_json)
        .bind(tags_json)
        .bind(updated_at)
        .bind(published_at)
        .bind(&selected_version_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        sqlx::query(
            r#"
            UPDATE assistant
            SET current_version_id = ?, updated_at = ?
            WHERE id = ?;
            "#,
        )
        .bind(&selected_version_id)
        .bind(updated_at)
        .bind(assistant_id)
        .execute(&self.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;

        self.sync_local_assistant_tags(assistant_id, tags_json, updated_at)
            .await?;

        Ok(selected_version_id)
    }

    pub(crate) async fn ensure_column(
        &self,
        table: &str,
        column: &str,
        ddl: &str,
    ) -> Result<(), McpError> {
        let sql = format!("PRAGMA table_info({})", table);
        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let exists = rows.iter().any(|row: &SqliteRow| {
            row.try_get::<String, _>("name")
                .map(|name| name == column)
                .unwrap_or(false)
        });
        if !exists {
            sqlx::query(ddl)
                .execute(&self.pool)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
        }
        Ok(())
    }

    pub(crate) async fn migrate_assistant_version_drop_skill_refs(&self) -> Result<(), McpError> {
        let rows = sqlx::query("PRAGMA table_info(assistant_version)")
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let has_skill_refs = rows.iter().any(|row: &SqliteRow| {
            row.try_get::<String, _>("name")
                .map(|name| name == "skill_refs")
                .unwrap_or(false)
        });
        if !has_skill_refs {
            return Ok(());
        }

        sqlx::query("PRAGMA foreign_keys=OFF;")
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        let result = async {
            let mut tx = self.begin_write().await?;
            sqlx::query(
                r#"
                DROP TABLE IF EXISTS assistant_version_new;
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE TABLE assistant_version_new (
                  id TEXT PRIMARY KEY,
                  assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
                  version TEXT NOT NULL,
                  name TEXT NOT NULL,
                  description TEXT,
                  system_prompt TEXT NOT NULL,
                  model_config TEXT,
                  tags TEXT,
                  changelog TEXT,
                  published_at TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                INSERT INTO assistant_version_new (
                  id, assistant_id, version, name, description, system_prompt,
                  model_config, tags, changelog, published_at, created_at, updated_at
                )
                SELECT id, assistant_id, version, name, description, system_prompt,
                       model_config, tags, changelog, published_at, created_at, updated_at
                FROM assistant_version;
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query("DROP TABLE assistant_version;")
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query("ALTER TABLE assistant_version_new RENAME TO assistant_version;")
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_version_semver
                ON assistant_version(assistant_id, version);
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE INDEX IF NOT EXISTS idx_assistant_version_assistant
                ON assistant_version(assistant_id);
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            tx.commit()
                .await
                .map_err(|err| McpError::Storage(err.to_string()))
        }
        .await;

        sqlx::query("PRAGMA foreign_keys=ON;")
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        result
    }

    pub(crate) async fn repair_assistant_install_foreign_key_target(&self) -> Result<(), McpError> {
        let rows = sqlx::query("PRAGMA foreign_key_list(assistant_install)")
            .fetch_all(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let references_legacy = rows.iter().any(|row: &SqliteRow| {
            row.try_get::<String, _>("table")
                .map(|name| name == "assistant_version_legacy")
                .unwrap_or(false)
        });
        if !references_legacy {
            return Ok(());
        }

        sqlx::query("PRAGMA foreign_keys=OFF;")
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        let result = async {
            let mut tx = self.begin_write().await?;
            sqlx::query(
                r#"
                DROP TABLE IF EXISTS assistant_install_new;
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE TABLE assistant_install_new (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  assistant_id TEXT NOT NULL REFERENCES assistant(id) ON DELETE CASCADE,
                  alias TEXT,
                  icon_override TEXT,
                  pinned_version_id TEXT REFERENCES assistant_version(id) ON DELETE SET NULL,
                  follow_latest INTEGER NOT NULL DEFAULT 1,
                  is_enabled INTEGER NOT NULL DEFAULT 1,
                  sort_order INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                INSERT INTO assistant_install_new (
                  id, user_id, assistant_id, alias, icon_override, pinned_version_id,
                  follow_latest, is_enabled, sort_order, created_at, updated_at
                )
                SELECT id, user_id, assistant_id, alias, icon_override, pinned_version_id,
                       follow_latest, is_enabled, sort_order, created_at, updated_at
                FROM assistant_install;
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query("DROP TABLE assistant_install;")
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query("ALTER TABLE assistant_install_new RENAME TO assistant_install;")
                .execute(&mut *tx)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                UPDATE assistant_install
                SET pinned_version_id = NULL
                WHERE pinned_version_id IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM assistant_version
                    WHERE assistant_version.id = assistant_install.pinned_version_id
                  );
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_install_user_assistant
                ON assistant_install(user_id, assistant_id);
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE INDEX IF NOT EXISTS idx_assistant_install_user
                ON assistant_install(user_id);
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            sqlx::query(
                r#"
                CREATE INDEX IF NOT EXISTS idx_assistant_install_assistant
                ON assistant_install(assistant_id);
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

            tx.commit()
                .await
                .map_err(|err| McpError::Storage(err.to_string()))
        }
        .await;

        sqlx::query("PRAGMA foreign_keys=ON;")
            .execute(&self.pool)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;

        result
    }
}
