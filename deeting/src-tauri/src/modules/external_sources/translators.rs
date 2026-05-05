use serde_json::Value;

use crate::modules::mcp::error::McpError;

use super::types::{
    ExternalRawRecordForTranslation, ExternalSourceConnectorType, NewExternalExperienceCandidate,
};

pub(crate) fn translate_external_record(
    item: &ExternalRawRecordForTranslation,
) -> Result<NewExternalExperienceCandidate, McpError> {
    let raw_payload = serde_json::from_str::<Value>(&item.record.raw_payload_json)
        .map_err(|err| McpError::validation(format!("invalid raw payload json: {err}")))?;
    let (candidate_kind, title, summary, canonical_payload, confidence) = match item.connector_type
    {
        ExternalSourceConnectorType::ManualImport => translate_manual_record(item, &raw_payload),
        ExternalSourceConnectorType::EvomapPublicFeed | ExternalSourceConnectorType::EvomapKg => {
            translate_evomap_record(item, &raw_payload)
        }
    };
    let provenance = serde_json::json!({
        "source_id": item.record.source_id,
        "source_display_name": item.source_display_name,
        "connector_type": item.connector_type.as_str(),
        "raw_record_id": item.record.id,
        "source_asset_id": item.record.source_asset_id,
        "source_version": item.record.source_version,
        "asset_family": item.record.asset_family,
        "content_hash": item.record.content_hash,
        "observed_at_unix_ms": item.record.observed_at_unix_ms
    });

    Ok(NewExternalExperienceCandidate {
        source_id: item.record.source_id.clone(),
        raw_record_id: item.record.id.clone(),
        candidate_kind,
        title,
        summary,
        canonical_payload_json: serde_json::to_string(&canonical_payload)
            .map_err(|err| McpError::Storage(err.to_string()))?,
        provenance_json: serde_json::to_string(&provenance)
            .map_err(|err| McpError::Storage(err.to_string()))?,
        confidence,
        validation_status: "provisional".to_string(),
        review_status: "pending".to_string(),
    })
}

fn translate_manual_record(
    item: &ExternalRawRecordForTranslation,
    payload: &Value,
) -> (String, String, String, Value, f64) {
    let text = extract_text(payload).unwrap_or_else(|| payload.to_string());
    let metadata = payload
        .get("_manual_import")
        .cloned()
        .unwrap_or(Value::Null);
    let filename = metadata
        .get("filename")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    let title = extract_markdown_title(&text)
        .or_else(|| filename.map(clean_file_stem))
        .unwrap_or_else(|| item.record.source_asset_id.clone());
    let haystack = format!(
        "{} {} {}",
        item.record.asset_family.to_ascii_lowercase(),
        title.to_ascii_lowercase(),
        text.to_ascii_lowercase()
    );
    let candidate_kind = if haystack.contains("hermes")
        || haystack.contains("self-evolution")
        || haystack.contains("self evolution")
        || haystack.contains("自我进化")
    {
        "task_strategy"
    } else {
        "wiki_source"
    };
    let summary = summarize_text(&text, 420);
    let canonical = serde_json::json!({
        "kind": candidate_kind,
        "title": title,
        "summary": summary,
        "text": text,
        "manual_import": metadata
    });
    (candidate_kind.to_string(), title, summary, canonical, 0.72)
}

fn translate_evomap_record(
    item: &ExternalRawRecordForTranslation,
    payload: &Value,
) -> (String, String, String, Value, f64) {
    let candidate_kind = match item.record.asset_family.as_str() {
        "skill_catalog" => "skill_candidate",
        "validation_reports" => "validation_report",
        "mutation_feed" | "evolution_events" => "task_strategy",
        "kg_graph" | "kg_status" => "knowledge_graph_observation",
        _ => "unknown_note",
    };
    let title = payload
        .get("title")
        .and_then(Value::as_str)
        .or_else(|| payload.get("name").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("EvoMap {}", item.record.asset_family));
    let text = extract_text(payload).unwrap_or_else(|| payload.to_string());
    let summary = summarize_text(&text, 420);
    let canonical = serde_json::json!({
        "kind": candidate_kind,
        "title": title,
        "summary": summary,
        "asset_family": item.record.asset_family,
        "payload": payload
    });
    (candidate_kind.to_string(), title, summary, canonical, 0.64)
}

fn extract_text(payload: &Value) -> Option<String> {
    payload
        .get("text")
        .and_then(Value::as_str)
        .or_else(|| payload.get("content").and_then(Value::as_str))
        .or_else(|| payload.get("markdown").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_markdown_title(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn clean_file_stem(filename: &str) -> String {
    std::path::Path::new(filename)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(filename)
        .trim()
        .to_string()
}

fn summarize_text(value: &str, limit: usize) -> String {
    let compact = value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(12)
        .collect::<Vec<_>>()
        .join(" ");
    if compact.chars().count() <= limit {
        return compact;
    }
    compact.chars().take(limit).collect::<String>() + "..."
}

#[cfg(test)]
mod tests {
    use super::translate_external_record;
    use crate::modules::external_sources::types::{
        ExternalRawRecord, ExternalRawRecordForTranslation, ExternalSourceConnectorType,
    };

    fn raw_record(asset_family: &str, payload: &str) -> ExternalRawRecordForTranslation {
        ExternalRawRecordForTranslation {
            record: ExternalRawRecord {
                id: "raw-1".to_string(),
                source_id: "source-1".to_string(),
                source_asset_id: "asset-1".to_string(),
                source_version: None,
                asset_family: asset_family.to_string(),
                observed_at_unix_ms: 1,
                freshness_hint: None,
                content_hash: "hash".to_string(),
                raw_payload_json: payload.to_string(),
                translation_status: "pending".to_string(),
                translated_at_unix_ms: None,
                translation_error: None,
            },
            connector_type: ExternalSourceConnectorType::ManualImport,
            source_display_name: "Manual".to_string(),
        }
    }

    #[test]
    fn manual_hermes_markdown_maps_to_task_strategy() {
        let item = raw_record(
            "hermes_agent_note",
            r##"{"text":"# Hermes self-evolution\nKeep validated strategy notes."}"##,
        );
        let candidate = translate_external_record(&item).expect("candidate");
        assert_eq!(candidate.candidate_kind, "task_strategy");
        assert_eq!(candidate.title, "Hermes self-evolution");
    }
}
