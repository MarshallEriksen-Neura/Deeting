fn row_to_local_knowledge_file(row: &SqliteRow) -> Result<LocalKnowledgeFile, McpError> {
    let filename: String = row.try_get("filename")?;
    let status_raw: String = row.try_get("status")?;
    let chunk_count = row.try_get::<i64, _>("chunk_count").unwrap_or(0).max(0);
    let meta_info_text: String = row.try_get("meta_info")?;
    let meta_info = if meta_info_text.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str::<serde_json::Value>(&meta_info_text)
            .unwrap_or_else(|_| serde_json::json!({}))
    };

    let file_type = meta_info
        .get("file_type")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| infer_file_type_from_filename(&filename));
    let size = meta_info
        .get("size")
        .and_then(|value| value.as_i64())
        .unwrap_or(0)
        .max(0);

    Ok(LocalKnowledgeFile {
        id: row.try_get("id")?,
        name: filename,
        file_type,
        size,
        status: normalize_local_document_status(&status_raw).to_string(),
        chunks: Some(chunk_count),
        error_message: row.try_get("error_message")?,
        folder_id: row.try_get("folder_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn infer_file_type_from_filename(filename: &str) -> String {
    let lower = filename.trim().to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or_default();
    match ext {
        "pdf" => "pdf".to_string(),
        "docx" => "docx".to_string(),
        "txt" => "txt".to_string(),
        "md" => "md".to_string(),
        "csv" => "csv".to_string(),
        "xlsx" => "xlsx".to_string(),
        "html" | "htm" => "html".to_string(),
        "json" => "json".to_string(),
        _ => "txt".to_string(),
    }
}

fn normalize_local_document_status(status: &str) -> &'static str {
    match status.trim().to_ascii_lowercase().as_str() {
        "active" | "indexed" | "success" => "active",
        "processing" | "pending" | "running" => "processing",
        "failed" | "error" => "failed",
        _ => "processing",
    }
}

fn normalize_storage_document_status(status: Option<&str>) -> &'static str {
    match status
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_else(|| "processing".to_string())
        .as_str()
    {
        "active" | "indexed" | "success" => "indexed",
        "failed" | "error" => "failed",
        "processing" | "pending" | "running" => "processing",
        _ => "processing",
    }
}

fn truncate_local_document_error_message(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "local document processing failed".to_string();
    }
    trimmed.chars().take(300).collect::<String>()
}

fn extract_local_document_text(meta_info: &serde_json::Value) -> Option<String> {
    const CANDIDATE_KEYS: [&str; 5] = ["raw_text", "text", "content", "markdown", "body"];
    for key in CANDIDATE_KEYS {
        if let Some(value) = meta_info.get(key).and_then(|value| value.as_str()) {
            let normalized = value.trim().to_string();
            if !normalized.is_empty() {
                return Some(normalized);
            }
        }
    }

    let mut composed_segments = Vec::new();
    if let Some(items) = meta_info.get("chunks").and_then(|value| value.as_array()) {
        for item in items {
            if let Some(text) = item.as_str() {
                let normalized = text.trim();
                if !normalized.is_empty() {
                    composed_segments.push(normalized.to_string());
                }
            }
        }
    }
    if composed_segments.is_empty() {
        None
    } else {
        Some(composed_segments.join("\n\n"))
    }
}

fn split_local_document_text_into_chunks(text: &str) -> Vec<String> {
    let normalized = text.trim();
    if normalized.is_empty() {
        return Vec::new();
    }

    let chars: Vec<char> = normalized.chars().collect();
    if chars.len() <= LOCAL_KNOWLEDGE_CHUNK_MAX_CHARS {
        return vec![normalized.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let mut end = (start + LOCAL_KNOWLEDGE_CHUNK_MAX_CHARS).min(chars.len());
        if end < chars.len() {
            let scan_floor = start + (LOCAL_KNOWLEDGE_CHUNK_MAX_CHARS / 2);
            let mut cursor = end;
            while cursor > scan_floor {
                let current = chars[cursor - 1];
                if current.is_whitespace()
                    || matches!(current, '。' | '！' | '？' | '.' | '!' | '?' | '\n')
                {
                    end = cursor;
                    break;
                }
                cursor -= 1;
            }
        }

        let chunk = chars[start..end]
            .iter()
            .collect::<String>()
            .trim()
            .to_string();
        if !chunk.is_empty() {
            chunks.push(chunk);
        }

        if end >= chars.len() {
            break;
        }
        let next_start = end.saturating_sub(LOCAL_KNOWLEDGE_CHUNK_OVERLAP_CHARS);
        if next_start == start {
            start = end;
        } else {
            start = next_start;
        }
    }

    chunks
}

fn tokenize_local_search_query(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut seen = HashSet::new();
    let normalized = query.to_ascii_lowercase();
    for token in normalized.split(|ch: char| !ch.is_alphanumeric()) {
        let trimmed = token.trim();
        if trimmed.len() < 2 {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            tokens.push(trimmed.to_string());
        }
    }
    if tokens.is_empty() && !normalized.trim().is_empty() {
        tokens.push(normalized.trim().to_string());
    }
    tokens.truncate(8);
    tokens
}

fn compute_local_knowledge_match_score(
    query_lower: &str,
    tokens_lower: &[String],
    content_lower: &str,
) -> f64 {
    if content_lower.is_empty() {
        return 0.0;
    }
    let mut score = 0.0;
    if !query_lower.is_empty() && content_lower.contains(query_lower) {
        score += 8.0;
    }
    for token in tokens_lower {
        let mut start = 0usize;
        let mut token_hits = 0usize;
        while start < content_lower.len() {
            let Some(pos) = content_lower[start..].find(token) else {
                break;
            };
            token_hits += 1;
            start += pos + token.len();
        }
        if token_hits > 0 {
            score += (token_hits as f64) * (1.0 + (token.len() as f64 / 10.0));
        }
    }
    score
}

fn estimate_local_tokens(text: &str) -> i64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    trimmed.split_whitespace().count() as i64
}

fn sort_local_knowledge_folders(
    folders: &mut [LocalKnowledgeFolder],
    sort_field: &str,
    sort_direction: &str,
) {
    folders.sort_by(|left, right| {
        let base = match sort_field {
            "name" => left
                .name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase()),
            _ => left.created_at.cmp(&right.created_at),
        };
        if sort_direction == "asc" {
            base
        } else {
            reverse_ordering(base)
        }
    });
}

fn sort_local_knowledge_files(
    files: &mut [LocalKnowledgeFile],
    sort_field: &str,
    sort_direction: &str,
) {
    files.sort_by(|left, right| {
        let base = match sort_field {
            "name" => left
                .name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase()),
            "size" => left.size.cmp(&right.size),
            "status" => left
                .status
                .to_ascii_lowercase()
                .cmp(&right.status.to_ascii_lowercase()),
            "chunks" => left.chunks.unwrap_or(0).cmp(&right.chunks.unwrap_or(0)),
            _ => left.created_at.cmp(&right.created_at),
        };
        if sort_direction == "asc" {
            base
        } else {
            reverse_ordering(base)
        }
    });
}

fn reverse_ordering(value: Ordering) -> Ordering {
    match value {
        Ordering::Less => Ordering::Greater,
        Ordering::Greater => Ordering::Less,
        Ordering::Equal => Ordering::Equal,
    }
}

fn row_to_source(row: &SqliteRow) -> Result<McpSource, McpError> {
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

fn row_to_tool(row: &SqliteRow) -> Result<McpTool, McpError> {
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

fn row_to_assistant(row: &SqliteRow) -> Result<LocalAssistant, McpError> {
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

fn row_to_assistant_entity(row: &SqliteRow) -> Result<LocalAssistantEntity, McpError> {
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

fn row_to_assistant_version(row: &SqliteRow) -> Result<LocalAssistantVersion, McpError> {
    let model_config: Option<serde_json::Value> = deserialize_json(row.try_get("model_config")?)?;
    let skill_refs: Option<Vec<serde_json::Value>> = deserialize_json(row.try_get("skill_refs")?)?;
    let tags: Option<Vec<String>> = deserialize_json(row.try_get("tags")?)?;
    Ok(LocalAssistantVersion {
        id: row.try_get("id")?,
        assistant_id: row.try_get("assistant_id")?,
        version: row.try_get("version")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        system_prompt: row.try_get("system_prompt")?,
        model_config,
        skill_refs: skill_refs.unwrap_or_default(),
        tags: tags.unwrap_or_default(),
        changelog: row.try_get("changelog")?,
        published_at: row.try_get("published_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_to_assistant_install_item(row: &SqliteRow) -> Result<LocalAssistantInstallItem, McpError> {
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

fn row_to_assistant_message(row: &SqliteRow) -> Result<LocalAssistantMessage, McpError> {
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

fn deserialize_json<T>(value: Option<String>) -> Result<Option<T>, McpError>
where
    T: serde::de::DeserializeOwned,
{
    match value {
        Some(text) => Ok(Some(serde_json::from_str(&text)?)),
        None => Ok(None),
    }
}

fn serialize_json<T>(value: &Option<T>) -> Result<Option<String>, McpError>
where
    T: serde::Serialize,
{
    match value {
        Some(data) => Ok(Some(serde_json::to_string(data)?)),
        None => Ok(None),
    }
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
}

fn normalize_assistant_tag_names(tags: Vec<String>) -> Vec<String> {
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

fn normalize_feedback_tags(tags: Vec<String>) -> Vec<String> {
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

fn round_to_4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn now_rfc3339() -> Result<String, McpError> {
    Ok(time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| McpError::Storage(err.to_string()))?)
}

fn now_unix_epoch() -> Result<i64, McpError> {
    Ok(time::OffsetDateTime::now_utc().unix_timestamp())
}

fn parse_rfc3339_to_unix_epoch(value: &str) -> Option<i64> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(|dt| dt.unix_timestamp())
}

fn estimate_token_count(text: &str) -> i64 {
    if text.trim().is_empty() {
        return 0;
    }
    let chars = text.chars().count() as i64;
    (chars / 4).max(1)
}

fn parse_assistant_routing_feedback_event(event: &str) -> Option<bool> {
    let normalized = event.trim().to_ascii_lowercase();
    if ["thumbs_up", "like", "up", "positive"].contains(&normalized.as_str()) {
        return Some(true);
    }
    if ["thumbs_down", "dislike", "down", "negative", "regenerate"].contains(&normalized.as_str()) {
        return Some(false);
    }
    None
}

fn hash_json(value: &serde_json::Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn expand_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return PathBuf::from(trimmed);
    }

    if trimmed == "~" {
        if let Some(home) = home_dir_from_env() {
            return home;
        }
    }

    if let Some(stripped) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        if let Some(home) = home_dir_from_env() {
            return home.join(stripped);
        }
    }

    PathBuf::from(trimmed)
}

fn home_dir_from_env() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let trimmed = user_profile.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    let home_drive = std::env::var("HOMEDRIVE").ok();
    let home_path = std::env::var("HOMEPATH").ok();
    match (home_drive, home_path) {
        (Some(drive), Some(path)) => {
            let combined = format!("{}{}", drive.trim(), path.trim());
            if combined.is_empty() {
                None
            } else {
                Some(PathBuf::from(combined))
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compute_local_knowledge_match_score, extract_local_document_text,
        split_local_document_text_into_chunks, tokenize_local_search_query,
        truncate_local_document_error_message,
    };

    #[test]
    fn extract_local_document_text_prefers_raw_text() {
        let meta = serde_json::json!({
            "text": "secondary",
            "raw_text": "primary"
        });
        let extracted = extract_local_document_text(&meta).expect("text should exist");
        assert_eq!(extracted, "primary");
    }

    #[test]
    fn extract_local_document_text_falls_back_to_chunks() {
        let meta = serde_json::json!({
            "chunks": ["first", " ", "second"]
        });
        let extracted = extract_local_document_text(&meta).expect("text should exist");
        assert_eq!(extracted, "first\n\nsecond");
    }

    #[test]
    fn split_local_document_text_into_chunks_splits_long_text() {
        let source = "abc ".repeat(2000);
        let chunks = split_local_document_text_into_chunks(&source);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| !chunk.trim().is_empty()));
    }

    #[test]
    fn split_local_document_text_into_chunks_keeps_short_text() {
        let chunks = split_local_document_text_into_chunks("short text");
        assert_eq!(chunks, vec!["short text".to_string()]);
    }

    #[test]
    fn truncate_local_document_error_message_limits_length() {
        let source = "x".repeat(500);
        let truncated = truncate_local_document_error_message(&source);
        assert_eq!(truncated.chars().count(), 300);
    }

    #[test]
    fn tokenize_local_search_query_extracts_terms() {
        let tokens = tokenize_local_search_query("How to deploy Rust service?");
        assert!(tokens.contains(&"how".to_string()));
        assert!(tokens.contains(&"deploy".to_string()));
        assert!(tokens.contains(&"rust".to_string()));
        assert!(tokens.contains(&"service".to_string()));
    }

    #[test]
    fn compute_local_knowledge_match_score_prefers_phrase_match() {
        let query = "deploy rust service";
        let tokens = tokenize_local_search_query(query);
        let strong = compute_local_knowledge_match_score(
            query,
            &tokens,
            "how to deploy rust service to production",
        );
        let weak = compute_local_knowledge_match_score(query, &tokens, "rust notes and tricks");
        assert!(strong > weak);
    }
}
