use serde_json::Value;
use sqlx::{sqlite::SqliteRow, Row};
use uuid::Uuid;

use crate::modules::custom_task_agents::types::CustomTaskAgentSkillActionRef;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

use super::types::{
    CreateCustomTaskAgentRequest, CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
    UpdateCustomTaskAgentRequest,
};

const TABLE_NAME: &str = "custom_task_agent_profiles";

pub(crate) async fn ensure_schema(store: &McpStore) -> Result<(), McpError> {
    sqlx::query(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          task_prompt TEXT NOT NULL,
          invocation_kind TEXT NOT NULL,
          preferred_for_image_generation INTEGER NOT NULL DEFAULT 0,
          model_config TEXT,
          bound_tool_ids TEXT NOT NULL DEFAULT '[]',
          bound_skill_ids TEXT NOT NULL DEFAULT '[]',
          tags TEXT NOT NULL DEFAULT '[]',
          discoverable INTEGER NOT NULL DEFAULT 1,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          is_deleted INTEGER NOT NULL DEFAULT 0,
          source_kind TEXT,
          source_path TEXT,
          source_repo TEXT,
          source_ref TEXT,
          source_hash TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    ensure_column(store, "guidance_skill_ids", "TEXT NOT NULL DEFAULT '[]'").await?;
    ensure_column(store, "callable_mcp_tool_ids", "TEXT NOT NULL DEFAULT '[]'").await?;
    ensure_column(
        store,
        "callable_skill_action_refs",
        "TEXT NOT NULL DEFAULT '[]'",
    )
    .await?;
    ensure_column(
        store,
        "preferred_for_image_generation",
        "INTEGER NOT NULL DEFAULT 0",
    )
    .await?;
    ensure_column(store, "source_kind", "TEXT").await?;
    ensure_column(store, "source_path", "TEXT").await?;
    ensure_column(store, "source_repo", "TEXT").await?;
    ensure_column(store, "source_ref", "TEXT").await?;
    ensure_column(store, "source_hash", "TEXT").await?;

    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_discoverable ON {TABLE_NAME}(discoverable);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;
    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_enabled ON {TABLE_NAME}(is_enabled);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;
    sqlx::query(&format!(
        "CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_deleted ON {TABLE_NAME}(is_deleted);"
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    migrate_legacy_binding_columns(store).await?;

    Ok(())
}

pub(crate) async fn list_custom_task_agents(
    store: &McpStore,
) -> Result<Vec<CustomTaskAgentProfile>, McpError> {
    ensure_schema(store).await?;
    let rows = sqlx::query(&format!(
        r#"
        SELECT id, name, description, task_prompt, invocation_kind, preferred_for_image_generation, model_config,
               callable_mcp_tool_ids, guidance_skill_ids, callable_skill_action_refs, tags,
               discoverable, is_enabled, is_deleted, source_kind, source_path, source_repo, source_ref, source_hash,
               created_at, updated_at
        FROM {TABLE_NAME}
        WHERE is_deleted = 0
        ORDER BY updated_at DESC, created_at DESC;
        "#
    ))
    .fetch_all(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    rows.iter().map(row_to_profile).collect()
}

impl McpStore {
    pub async fn list_custom_task_agents(&self) -> Result<Vec<CustomTaskAgentProfile>, McpError> {
        list_custom_task_agents(self).await
    }
}

pub(crate) async fn get_custom_task_agent(
    store: &McpStore,
    id: &str,
) -> Result<Option<CustomTaskAgentProfile>, McpError> {
    ensure_schema(store).await?;
    let row = sqlx::query(&format!(
        r#"
        SELECT id, name, description, task_prompt, invocation_kind, preferred_for_image_generation, model_config,
               callable_mcp_tool_ids, guidance_skill_ids, callable_skill_action_refs, tags,
               discoverable, is_enabled, is_deleted, source_kind, source_path, source_repo, source_ref, source_hash,
               created_at, updated_at
        FROM {TABLE_NAME}
        WHERE id = ? AND is_deleted = 0;
        "#
    ))
    .bind(id.trim())
    .fetch_optional(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    row.as_ref().map(row_to_profile).transpose()
}

pub(crate) async fn create_custom_task_agent(
    store: &McpStore,
    payload: CreateCustomTaskAgentRequest,
) -> Result<CustomTaskAgentProfile, McpError> {
    ensure_schema(store).await?;
    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Err(McpError::validation("custom task agent name is required"));
    }
    let task_prompt = payload.task_prompt.trim().to_string();
    if task_prompt.is_empty() {
        return Err(McpError::validation("task_prompt is required"));
    }
    let id = Uuid::new_v4().to_string();
    let now = now_rfc3339()?;
    let invocation_kind = payload.invocation_kind.unwrap_or_default();
    let preferred_for_image_generation = payload.preferred_for_image_generation.unwrap_or(false);
    let tags = normalize_string_list(payload.tags.unwrap_or_default());
    let callable_mcp_tool_ids = normalize_string_list(payload.callable_mcp_tool_ids);
    let guidance_skill_ids = normalize_string_list(payload.guidance_skill_ids);
    let callable_skill_action_refs =
        normalize_skill_action_refs(payload.callable_skill_action_refs);

    sqlx::query(&format!(
        r#"
        INSERT INTO {TABLE_NAME}
          (id, name, description, task_prompt, invocation_kind, preferred_for_image_generation, model_config, callable_mcp_tool_ids,
           guidance_skill_ids, callable_skill_action_refs, tags, discoverable, is_enabled, is_deleted,
           source_kind, source_path, source_repo, source_ref, source_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?);
        "#
    ))
    .bind(&id)
    .bind(&name)
    .bind(payload.description.as_deref())
    .bind(&task_prompt)
    .bind(invocation_kind.as_str())
    .bind(if preferred_for_image_generation { 1 } else { 0 })
    .bind(serialize_optional_json_value(payload.model_config.as_ref())?)
    .bind(serialize_json(&Some(callable_mcp_tool_ids.clone()))?)
    .bind(serialize_json(&Some(guidance_skill_ids.clone()))?)
    .bind(serialize_json(&Some(callable_skill_action_refs.clone()))?)
    .bind(serialize_json(&Some(tags.clone()))?)
    .bind(if payload.discoverable.unwrap_or(true) {
        1
    } else {
        0
    })
    .bind(if payload.is_enabled.unwrap_or(true) {
        1
    } else {
        0
    })
    .bind(payload.source_kind.as_deref())
    .bind(payload.source_path.as_deref())
    .bind(payload.source_repo.as_deref())
    .bind(payload.source_ref.as_deref())
    .bind(payload.source_hash.as_deref())
    .bind(&now)
    .bind(&now)
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(CustomTaskAgentProfile {
        id,
        name,
        description: payload.description,
        task_prompt,
        invocation_kind,
        preferred_for_image_generation,
        model_config: payload.model_config,
        callable_mcp_tool_ids,
        guidance_skill_ids,
        callable_skill_action_refs,
        tags,
        discoverable: payload.discoverable.unwrap_or(true),
        is_enabled: payload.is_enabled.unwrap_or(true),
        is_deleted: false,
        source_kind: payload.source_kind,
        source_path: payload.source_path,
        source_repo: payload.source_repo,
        source_ref: payload.source_ref,
        source_hash: payload.source_hash,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub(crate) async fn update_custom_task_agent(
    store: &McpStore,
    id: &str,
    payload: UpdateCustomTaskAgentRequest,
) -> Result<CustomTaskAgentProfile, McpError> {
    ensure_schema(store).await?;
    let existing = get_custom_task_agent(store, id)
        .await?
        .ok_or_else(|| McpError::NotFound("custom task agent not found".to_string()))?;

    let name = payload
        .name
        .unwrap_or(existing.name.clone())
        .trim()
        .to_string();
    if name.is_empty() {
        return Err(McpError::validation("custom task agent name is required"));
    }
    let task_prompt = payload
        .task_prompt
        .unwrap_or(existing.task_prompt.clone())
        .trim()
        .to_string();
    if task_prompt.is_empty() {
        return Err(McpError::validation("task_prompt is required"));
    }

    let description = payload.description.or(existing.description.clone());
    let invocation_kind = payload
        .invocation_kind
        .unwrap_or(existing.invocation_kind.clone());
    let preferred_for_image_generation = payload
        .preferred_for_image_generation
        .unwrap_or(existing.preferred_for_image_generation);
    let model_config = payload.model_config.or(existing.model_config.clone());
    let callable_mcp_tool_ids = normalize_string_list(
        payload
            .callable_mcp_tool_ids
            .unwrap_or(existing.callable_mcp_tool_ids.clone()),
    );
    let guidance_skill_ids = normalize_string_list(
        payload
            .guidance_skill_ids
            .unwrap_or(existing.guidance_skill_ids.clone()),
    );
    let callable_skill_action_refs = normalize_skill_action_refs(
        payload
            .callable_skill_action_refs
            .unwrap_or(existing.callable_skill_action_refs.clone()),
    );
    let tags = normalize_string_list(payload.tags.unwrap_or(existing.tags.clone()));
    let discoverable = payload.discoverable.unwrap_or(existing.discoverable);
    let is_enabled = payload.is_enabled.unwrap_or(existing.is_enabled);
    let source_kind = payload.source_kind.or(existing.source_kind.clone());
    let source_path = payload.source_path.or(existing.source_path.clone());
    let source_repo = payload.source_repo.or(existing.source_repo.clone());
    let source_ref = payload.source_ref.or(existing.source_ref.clone());
    let source_hash = payload.source_hash.or(existing.source_hash.clone());
    let now = now_rfc3339()?;

    sqlx::query(&format!(
        r#"
        UPDATE {TABLE_NAME}
        SET name = ?, description = ?, task_prompt = ?, invocation_kind = ?, preferred_for_image_generation = ?, model_config = ?,
            callable_mcp_tool_ids = ?, guidance_skill_ids = ?, callable_skill_action_refs = ?,
            tags = ?, discoverable = ?, is_enabled = ?, source_kind = ?, source_path = ?, source_repo = ?, source_ref = ?, source_hash = ?, updated_at = ?
        WHERE id = ? AND is_deleted = 0;
        "#
    ))
    .bind(&name)
    .bind(description.as_deref())
    .bind(&task_prompt)
    .bind(invocation_kind.as_str())
    .bind(if preferred_for_image_generation { 1 } else { 0 })
    .bind(serialize_optional_json_value(model_config.as_ref())?)
    .bind(serialize_json(&Some(callable_mcp_tool_ids.clone()))?)
    .bind(serialize_json(&Some(guidance_skill_ids.clone()))?)
    .bind(serialize_json(&Some(callable_skill_action_refs.clone()))?)
    .bind(serialize_json(&Some(tags.clone()))?)
    .bind(if discoverable { 1 } else { 0 })
    .bind(if is_enabled { 1 } else { 0 })
    .bind(source_kind.as_deref())
    .bind(source_path.as_deref())
    .bind(source_repo.as_deref())
    .bind(source_ref.as_deref())
    .bind(source_hash.as_deref())
    .bind(&now)
    .bind(id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(CustomTaskAgentProfile {
        id: existing.id,
        name,
        description,
        task_prompt,
        invocation_kind,
        preferred_for_image_generation,
        model_config,
        callable_mcp_tool_ids,
        guidance_skill_ids,
        callable_skill_action_refs,
        tags,
        discoverable,
        is_enabled,
        is_deleted: false,
        source_kind,
        source_path,
        source_repo,
        source_ref,
        source_hash,
        created_at: existing.created_at,
        updated_at: now,
    })
}

pub(crate) async fn delete_custom_task_agent(store: &McpStore, id: &str) -> Result<(), McpError> {
    ensure_schema(store).await?;
    let now = now_rfc3339()?;
    let result = sqlx::query(&format!(
        r#"
        UPDATE {TABLE_NAME}
        SET is_deleted = 1, updated_at = ?
        WHERE id = ? AND is_deleted = 0;
        "#
    ))
    .bind(&now)
    .bind(id.trim())
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(McpError::NotFound(
            "custom task agent not found".to_string(),
        ));
    }
    Ok(())
}

fn row_to_profile(row: &SqliteRow) -> Result<CustomTaskAgentProfile, McpError> {
    let invocation_kind = match row
        .try_get::<String, _>("invocation_kind")
        .map_err(|err| McpError::Storage(err.to_string()))?
        .as_str()
    {
        "image_generation" => CustomTaskAgentInvocationKind::ImageGeneration,
        "text_to_speech" => CustomTaskAgentInvocationKind::TextToSpeech,
        _ => CustomTaskAgentInvocationKind::Chat,
    };
    let model_config = row
        .try_get::<Option<String>, _>("model_config")
        .map_err(|err| McpError::Storage(err.to_string()))?
        .as_deref()
        .map(parse_json_value)
        .transpose()?
        .filter(|value| !value.is_null());
    Ok(CustomTaskAgentProfile {
        id: row
            .try_get("id")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        name: row
            .try_get("name")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        description: row
            .try_get("description")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        task_prompt: row
            .try_get("task_prompt")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        invocation_kind,
        preferred_for_image_generation: row
            .try_get::<i64, _>("preferred_for_image_generation")
            .map_err(|err| McpError::Storage(err.to_string()))?
            != 0,
        model_config,
        callable_mcp_tool_ids: row_json_string_list(row, "callable_mcp_tool_ids")?,
        guidance_skill_ids: row_json_string_list(row, "guidance_skill_ids")?,
        callable_skill_action_refs: row_json_skill_action_refs(row, "callable_skill_action_refs")?,
        tags: row_json_string_list(row, "tags")?,
        discoverable: row
            .try_get::<i64, _>("discoverable")
            .map_err(|err| McpError::Storage(err.to_string()))?
            != 0,
        is_enabled: row
            .try_get::<i64, _>("is_enabled")
            .map_err(|err| McpError::Storage(err.to_string()))?
            != 0,
        is_deleted: row
            .try_get::<i64, _>("is_deleted")
            .map_err(|err| McpError::Storage(err.to_string()))?
            != 0,
        source_kind: row
            .try_get("source_kind")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        source_path: row
            .try_get("source_path")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        source_repo: row
            .try_get("source_repo")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        source_ref: row
            .try_get("source_ref")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        source_hash: row
            .try_get("source_hash")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        created_at: row
            .try_get("created_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
    })
}

async fn ensure_column(
    store: &McpStore,
    column_name: &str,
    column_def: &str,
) -> Result<(), McpError> {
    if !table_has_column(store, column_name).await? {
        sqlx::query(&format!(
            "ALTER TABLE {TABLE_NAME} ADD COLUMN {column_name} {column_def};"
        ))
        .execute(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    }
    Ok(())
}

async fn table_has_column(store: &McpStore, column_name: &str) -> Result<bool, McpError> {
    let rows = sqlx::query(&format!("PRAGMA table_info({TABLE_NAME});"))
        .fetch_all(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|value| value == column_name)
            .unwrap_or(false)
    }))
}

async fn migrate_legacy_binding_columns(store: &McpStore) -> Result<(), McpError> {
    if table_has_column(store, "bound_tool_ids").await? {
        sqlx::query(&format!(
            r#"
            UPDATE {TABLE_NAME}
            SET callable_mcp_tool_ids = bound_tool_ids
            WHERE COALESCE(callable_mcp_tool_ids, '[]') = '[]'
              AND COALESCE(bound_tool_ids, '[]') <> '[]';
            "#
        ))
        .execute(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    }
    if table_has_column(store, "bound_skill_ids").await? {
        sqlx::query(&format!(
            r#"
            UPDATE {TABLE_NAME}
            SET guidance_skill_ids = bound_skill_ids
            WHERE COALESCE(guidance_skill_ids, '[]') = '[]'
              AND COALESCE(bound_skill_ids, '[]') <> '[]';
            "#
        ))
        .execute(&store.pool)
        .await
        .map_err(|err| McpError::Storage(err.to_string()))?;
    }
    Ok(())
}

fn row_json_string_list(row: &SqliteRow, column: &str) -> Result<Vec<String>, McpError> {
    row.try_get::<Option<String>, _>(column)
        .map_err(|err| McpError::Storage(err.to_string()))?
        .as_deref()
        .map(parse_json_string_list)
        .transpose()
        .map(|value| value.unwrap_or_default())
}

fn row_json_skill_action_refs(
    row: &SqliteRow,
    column: &str,
) -> Result<Vec<CustomTaskAgentSkillActionRef>, McpError> {
    row.try_get::<Option<String>, _>(column)
        .map_err(|err| McpError::Storage(err.to_string()))?
        .as_deref()
        .map(parse_json_skill_action_refs)
        .transpose()
        .map(|value| value.unwrap_or_default())
}

fn parse_json_string_list(raw: &str) -> Result<Vec<String>, McpError> {
    let value = serde_json::from_str::<Vec<String>>(raw)
        .map_err(|err| McpError::Storage(format!("invalid json string list: {}", err)))?;
    Ok(normalize_string_list(value))
}

fn parse_json_skill_action_refs(raw: &str) -> Result<Vec<CustomTaskAgentSkillActionRef>, McpError> {
    let value = serde_json::from_str::<Vec<CustomTaskAgentSkillActionRef>>(raw)
        .map_err(|err| McpError::Storage(format!("invalid skill action refs json: {}", err)))?;
    Ok(normalize_skill_action_refs(value))
}

fn parse_json_value(raw: &str) -> Result<Value, McpError> {
    serde_json::from_str::<Value>(raw)
        .map_err(|err| McpError::Storage(format!("invalid json value: {}", err)))
}

fn serialize_json<T: serde::Serialize>(value: &T) -> Result<Option<String>, McpError> {
    serde_json::to_string(value)
        .map(Some)
        .map_err(|err| McpError::Storage(err.to_string()))
}

fn serialize_optional_json_value(value: Option<&Value>) -> Result<Option<String>, McpError> {
    match value {
        Some(value) => serde_json::to_string(value)
            .map(Some)
            .map_err(|err| McpError::Storage(err.to_string())),
        None => Ok(None),
    }
}

fn normalize_string_list(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut normalized = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
            continue;
        }
        normalized.push(trimmed.to_string());
    }
    normalized
}

fn normalize_skill_action_refs(
    values: Vec<CustomTaskAgentSkillActionRef>,
) -> Vec<CustomTaskAgentSkillActionRef> {
    let mut seen = std::collections::HashSet::new();
    let mut normalized = Vec::new();
    for value in values {
        let skill_id = value.skill_id.trim().to_string();
        let action_id = value.action_id.trim().to_string();
        if skill_id.is_empty() || action_id.is_empty() {
            continue;
        }
        let key = format!("{}#{}", skill_id, action_id);
        if !seen.insert(key) {
            continue;
        }
        normalized.push(CustomTaskAgentSkillActionRef {
            skill_id,
            action_id,
        });
    }
    normalized
}

fn now_rfc3339() -> Result<String, McpError> {
    Ok(time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| McpError::Storage(err.to_string()))?)
}

#[cfg(test)]
mod tests {
    use super::{normalize_skill_action_refs, normalize_string_list};
    use crate::modules::custom_task_agents::types::{
        CustomTaskAgentInvocationKind, CustomTaskAgentProfile, CustomTaskAgentSkillActionRef,
    };

    #[test]
    fn normalize_string_list_trims_dedupes_and_drops_empty_values() {
        let normalized = normalize_string_list(vec![
            " tool.search_web ".to_string(),
            "".to_string(),
            "tool.search_web".to_string(),
            "skill.image".to_string(),
        ]);

        assert_eq!(
            normalized,
            vec!["tool.search_web".to_string(), "skill.image".to_string()]
        );
    }

    #[test]
    fn normalize_skill_action_refs_trims_and_dedupes() {
        let normalized = normalize_skill_action_refs(vec![
            CustomTaskAgentSkillActionRef {
                skill_id: " official.skills.crawler ".to_string(),
                action_id: " fetch_web_content ".to_string(),
            },
            CustomTaskAgentSkillActionRef {
                skill_id: "official.skills.crawler".to_string(),
                action_id: "fetch_web_content".to_string(),
            },
        ]);
        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0].skill_id, "official.skills.crawler");
        assert_eq!(normalized[0].action_id, "fetch_web_content");
    }

    #[test]
    fn profile_can_mark_preferred_for_image_generation() {
        let profile = CustomTaskAgentProfile {
            id: "agent-image".to_string(),
            name: "Image Agent".to_string(),
            description: None,
            task_prompt: "Generate images".to_string(),
            invocation_kind: CustomTaskAgentInvocationKind::ImageGeneration,
            preferred_for_image_generation: true,
            model_config: None,
            callable_mcp_tool_ids: vec![],
            guidance_skill_ids: vec![],
            callable_skill_action_refs: vec![],
            tags: vec![],
            discoverable: true,
            is_enabled: true,
            is_deleted: false,
            source_kind: None,
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "2026-03-12T00:00:00Z".to_string(),
            updated_at: "2026-03-12T00:00:00Z".to_string(),
        };

        assert!(profile.preferred_for_image_generation);
    }
}
