use std::collections::HashSet;
use std::path::PathBuf;

use mcp_core::error::McpError;
use sha2::{Digest, Sha256};

pub fn deserialize_json<T>(value: Option<String>) -> Result<Option<T>, McpError>
where
    T: serde::de::DeserializeOwned,
{
    match value {
        Some(text) => Ok(Some(serde_json::from_str(&text)?)),
        None => Ok(None),
    }
}

pub fn serialize_json<T>(value: &Option<T>) -> Result<Option<String>, McpError>
where
    T: serde::Serialize,
{
    match value {
        Some(data) => Ok(Some(serde_json::to_string(data)?)),
        None => Ok(None),
    }
}

pub fn normalize_assistant_tag_names(tags: Vec<String>) -> Vec<String> {
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

pub fn normalize_feedback_tags(tags: Vec<String>) -> Vec<String> {
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

pub fn round_to_4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

pub fn now_rfc3339() -> Result<String, McpError> {
    Ok(time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|err| McpError::Storage(err.to_string()))?)
}

pub fn now_unix_epoch() -> Result<i64, McpError> {
    Ok(time::OffsetDateTime::now_utc().unix_timestamp())
}

pub fn parse_rfc3339_to_unix_epoch(value: &str) -> Option<i64> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(|dt| dt.unix_timestamp())
}

pub fn estimate_token_count(text: &str) -> i64 {
    if text.trim().is_empty() {
        return 0;
    }
    let chars = text.chars().count() as i64;
    (chars / 4).max(1)
}

pub fn parse_assistant_routing_feedback_event(event: &str) -> Option<bool> {
    let normalized = event.trim().to_ascii_lowercase();
    if ["thumbs_up", "like", "up", "positive"].contains(&normalized.as_str()) {
        return Some(true);
    }
    if ["thumbs_down", "dislike", "down", "negative", "regenerate"].contains(&normalized.as_str()) {
        return Some(false);
    }
    None
}

pub fn hash_json(value: &serde_json::Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn expand_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    }
    PathBuf::from(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_assistant_tag_names_adds_hash_and_dedups() {
        let tags = normalize_assistant_tag_names(vec![
            "foo".to_string(),
            "#foo".to_string(),
            "  bar ".to_string(),
        ]);
        assert_eq!(tags, vec!["#foo".to_string(), "#bar".to_string()]);
    }

    #[test]
    fn parse_assistant_routing_feedback_event_supports_positive_and_negative() {
        assert_eq!(
            parse_assistant_routing_feedback_event("thumbs_up"),
            Some(true)
        );
        assert_eq!(
            parse_assistant_routing_feedback_event("regenerate"),
            Some(false)
        );
        assert_eq!(parse_assistant_routing_feedback_event("unknown"), None);
    }
}
