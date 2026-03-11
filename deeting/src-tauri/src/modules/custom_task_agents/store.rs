use serde_json::Value;
use sqlx::{sqlite::SqliteRow, Row};
use uuid::Uuid;

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
          model_config TEXT,
          bound_tool_ids TEXT NOT NULL DEFAULT '[]',
          bound_skill_ids TEXT NOT NULL DEFAULT '[]',
          tags TEXT NOT NULL DEFAULT '[]',
          discoverable INTEGER NOT NULL DEFAULT 1,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          is_deleted INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#
    ))
    .execute(&store.pool)
    .await
    .map_err(|err| McpError::Storage(err.to_string()))?;

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

    Ok(())
}

pub(crate) async fn list_custom_task_agents(
    store: &McpStore,
) -> Result<Vec<CustomTaskAgentProfile>, McpError> {
    ensure_schema(store).await?;
    let rows = sqlx::query(&format!(
        r#"
        SELECT id, name, description, task_prompt, invocation_kind, model_config,
               bound_tool_ids, bound_skill_ids, tags, discoverable, is_enabled, is_deleted,
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
        SELECT id, name, description, task_prompt, invocation_kind, model_config,
               bound_tool_ids, bound_skill_ids, tags, discoverable, is_enabled, is_deleted,
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
    let tags = normalize_string_list(payload.tags.unwrap_or_default());
    let bound_tool_ids = normalize_string_list(payload.bound_tool_ids);
    let bound_skill_ids = normalize_string_list(payload.bound_skill_ids);

    sqlx::query(&format!(
        r#"
        INSERT INTO {TABLE_NAME}
          (id, name, description, task_prompt, invocation_kind, model_config, bound_tool_ids,
           bound_skill_ids, tags, discoverable, is_enabled, is_deleted, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?);
        "#
    ))
    .bind(&id)
    .bind(&name)
    .bind(payload.description.as_deref())
    .bind(&task_prompt)
    .bind(invocation_kind.as_str())
    .bind(serialize_optional_json_value(
        payload.model_config.as_ref(),
    )?)
    .bind(serialize_json(&Some(bound_tool_ids.clone()))?)
    .bind(serialize_json(&Some(bound_skill_ids.clone()))?)
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
        model_config: payload.model_config,
        bound_tool_ids,
        bound_skill_ids,
        tags,
        discoverable: payload.discoverable.unwrap_or(true),
        is_enabled: payload.is_enabled.unwrap_or(true),
        is_deleted: false,
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
    let model_config = payload.model_config.or(existing.model_config.clone());
    let bound_tool_ids = normalize_string_list(
        payload
            .bound_tool_ids
            .unwrap_or(existing.bound_tool_ids.clone()),
    );
    let bound_skill_ids = normalize_string_list(
        payload
            .bound_skill_ids
            .unwrap_or(existing.bound_skill_ids.clone()),
    );
    let tags = normalize_string_list(payload.tags.unwrap_or(existing.tags.clone()));
    let discoverable = payload.discoverable.unwrap_or(existing.discoverable);
    let is_enabled = payload.is_enabled.unwrap_or(existing.is_enabled);
    let now = now_rfc3339()?;

    sqlx::query(&format!(
        r#"
        UPDATE {TABLE_NAME}
        SET name = ?, description = ?, task_prompt = ?, invocation_kind = ?, model_config = ?,
            bound_tool_ids = ?, bound_skill_ids = ?, tags = ?, discoverable = ?,
            is_enabled = ?, updated_at = ?
        WHERE id = ? AND is_deleted = 0;
        "#
    ))
    .bind(&name)
    .bind(description.as_deref())
    .bind(&task_prompt)
    .bind(invocation_kind.as_str())
    .bind(serialize_optional_json_value(model_config.as_ref())?)
    .bind(serialize_json(&Some(bound_tool_ids.clone()))?)
    .bind(serialize_json(&Some(bound_skill_ids.clone()))?)
    .bind(serialize_json(&Some(tags.clone()))?)
    .bind(if discoverable { 1 } else { 0 })
    .bind(if is_enabled { 1 } else { 0 })
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
        model_config,
        bound_tool_ids,
        bound_skill_ids,
        tags,
        discoverable,
        is_enabled,
        is_deleted: false,
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
        model_config,
        bound_tool_ids: row_json_string_list(row, "bound_tool_ids")?,
        bound_skill_ids: row_json_string_list(row, "bound_skill_ids")?,
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
        created_at: row
            .try_get("created_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|err| McpError::Storage(err.to_string()))?,
    })
}

fn row_json_string_list(row: &SqliteRow, column: &str) -> Result<Vec<String>, McpError> {
    row.try_get::<Option<String>, _>(column)
        .map_err(|err| McpError::Storage(err.to_string()))?
        .as_deref()
        .map(parse_json_string_list)
        .transpose()
        .map(|value| value.unwrap_or_default())
}

fn parse_json_string_list(raw: &str) -> Result<Vec<String>, McpError> {
    let value = serde_json::from_str::<Vec<String>>(raw)
        .map_err(|err| McpError::Storage(format!("invalid json string list: {}", err)))?;
    Ok(normalize_string_list(value))
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

fn now_rfc3339() -> Result<String, McpError> {
    Ok(time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| McpError::Storage(err.to_string()))?)
}

#[cfg(test)]
mod tests {
    use super::normalize_string_list;

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
}
