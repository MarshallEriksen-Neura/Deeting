use super::*;

pub(super) fn row_to_source(row: &SqliteRow) -> Result<McpSource, McpError> {
    let source_type: String = row.try_get("source_type")?;
    let trust_level: String = row.try_get("trust_level")?;
    let status: String = row.try_get("status")?;
    Ok(McpSource {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        source_type: source_type.parse().map_err(McpError::validation)?,
        path_or_url: row.try_get("path_or_url")?,
        trust_level: trust_level.parse().map_err(McpError::validation)?,
        status: status.parse().map_err(McpError::validation)?,
        last_synced_at: row.try_get("last_synced_at")?,
        is_read_only: row.try_get::<i64, _>("is_read_only")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(super) fn row_to_tool(row: &SqliteRow) -> Result<McpTool, McpError> {
    let source_type: String = row.try_get("source_type")?;
    let status: String = row.try_get("status")?;
    let conflict_status: String = row.try_get("conflict_status")?;
    let capabilities: String = row.try_get("capabilities")?;
    let args: Option<String> = row.try_get("args")?;
    let env: Option<String> = row.try_get("env")?;
    Ok(McpTool {
        id: row.try_get("id")?,
        identifier: row.try_get("identifier")?,
        name: row.try_get("name")?,
        source_type: source_type.parse().map_err(McpError::validation)?,
        source_id: row.try_get("source_id")?,
        status: status.parse().map_err(McpError::validation)?,
        ping_ms: row.try_get("ping_ms")?,
        capabilities: serde_json::from_str(&capabilities)?,
        description: row.try_get("description")?,
        error: row.try_get("error")?,
        command: row.try_get("command")?,
        args: deserialize_json(args)?,
        env: deserialize_json(env)?,
        config_json: row.try_get("config_json")?,
        pending_config_json: row.try_get("pending_config_json")?,
        config_hash: row.try_get("config_hash")?,
        pending_config_hash: row.try_get("pending_config_hash")?,
        conflict_status: conflict_status.parse().map_err(McpError::validation)?,
        is_read_only: row.try_get::<i64, _>("is_read_only")? != 0,
        is_new: row.try_get::<i64, _>("is_new")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(super) fn row_to_assistant(row: &SqliteRow) -> Result<LocalAssistant, McpError> {
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

pub(super) fn row_to_assistant_entity(row: &SqliteRow) -> Result<LocalAssistantEntity, McpError> {
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

pub(super) fn row_to_assistant_version(row: &SqliteRow) -> Result<LocalAssistantVersion, McpError> {
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

pub(super) fn row_to_assistant_install_item(
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

pub(super) fn row_to_assistant_message(row: &SqliteRow) -> Result<LocalAssistantMessage, McpError> {
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

pub(super) fn deserialize_json<T>(value: Option<String>) -> Result<Option<T>, McpError>
where
    T: serde::de::DeserializeOwned,
{
    match value {
        Some(text) => Ok(Some(serde_json::from_str(&text)?)),
        None => Ok(None),
    }
}

pub(super) fn serialize_json<T>(value: &Option<T>) -> Result<Option<String>, McpError>
where
    T: serde::Serialize,
{
    match value {
        Some(data) => Ok(Some(serde_json::to_string(data)?)),
        None => Ok(None),
    }
}

pub(super) fn normalize_assistant_tag_names(tags: Vec<String>) -> Vec<String> {
    let mut cleaned = Vec::new();
    let mut seen = HashSet::new();
    for raw in tags {
        let mut name = raw.trim().to_string();
        if name.is_empty() {
            continue;
        }
        if !name.starts_with('#') {
            name = format!("#{name}");
        }
        if seen.insert(name.clone()) {
            cleaned.push(name);
        }
    }
    cleaned
}

pub(super) fn normalize_feedback_tags(tags: Vec<String>) -> Vec<String> {
    let mut cleaned = Vec::new();
    let mut seen = HashSet::new();
    for raw in tags {
        let name = raw.trim().to_string();
        if name.is_empty() {
            continue;
        }
        if seen.insert(name.clone()) {
            cleaned.push(name);
        }
    }
    cleaned
}

pub(super) fn round_to_4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

pub(super) fn now_rfc3339() -> Result<String, McpError> {
    Ok(time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| McpError::Storage(err.to_string()))?)
}

pub(super) fn now_unix_epoch() -> Result<i64, McpError> {
    Ok(time::OffsetDateTime::now_utc().unix_timestamp())
}

pub(super) fn parse_rfc3339_to_unix_epoch(value: &str) -> Option<i64> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(|dt| dt.unix_timestamp())
}

pub(super) fn estimate_token_count(text: &str) -> i64 {
    if text.trim().is_empty() {
        return 0;
    }
    let chars = text.chars().count() as i64;
    (chars / 4).max(1)
}

pub(super) fn parse_assistant_routing_feedback_event(event: &str) -> Option<bool> {
    let normalized = event.trim().to_ascii_lowercase();
    if ["thumbs_up", "like", "up", "positive"].contains(&normalized.as_str()) {
        return Some(true);
    }
    if ["thumbs_down", "dislike", "down", "negative", "regenerate"].contains(&normalized.as_str()) {
        return Some(false);
    }
    None
}

pub(super) fn hash_json(value: &serde_json::Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}
