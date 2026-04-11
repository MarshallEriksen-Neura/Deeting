use super::resolve_asset_registry_bundle_dir;
use super::types::{LocalAssetRecord, SaveLocalAssetManifest, SaveLocalAssetRequest};
use crate::modules::desktop_runtime::runtime::search_feedback::{
    historical_affinity_from_asset_rows, query_affinity_from_asset_rows, SearchFeedbackContext,
};
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use crate::state::AppState;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::Path;
use tauri::Manager;
use time::OffsetDateTime;

pub(crate) async fn save_local_asset<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    _app_state: &AppState,
    store: &McpStore,
    request: SaveLocalAssetRequest,
) -> Result<LocalAssetRecord, McpError> {
    let prepared = PreparedAssetSave::from_request(request)?;
    let app_data_dir = app_handle.path().app_data_dir().ok();
    let bundle_root = resolve_asset_registry_bundle_dir(app_data_dir);
    let bundle = persist_asset_bundle(&bundle_root, &prepared)?;
    let now = current_time_rfc3339();

    let record = LocalAssetRecord {
        asset_id: prepared.asset_id.clone(),
        asset_kind: prepared.asset_kind.clone(),
        title: prepared.title.clone(),
        summary: prepared.summary.clone(),
        origin_session_id: prepared.origin_session_id.clone().unwrap_or_default(),
        origin_turn_index: prepared.origin_turn_index.unwrap_or(0),
        source_block_id: prepared.source_block_id.clone(),
        source_view_type: prepared.source_view_type.clone(),
        render_hint: Some(prepared.render_hint.clone()),
        template_id: Some(format!("asset://{}", prepared.asset_id)),
        template_version: prepared.template_version.clone(),
        html_entry: Some(bundle.html_entry),
        data_mode: Some(prepared.data_mode.clone()),
        match_hints_json: to_json_string(&prepared.match_hints),
        props_hint_json: to_json_string(&prepared.props_hint),
        output_example_json: prepared
            .output_example
            .as_ref()
            .and_then(|value| serde_json::to_string(value).ok()),
        latest_snapshot_html: Some(prepared.html.clone()),
        latest_render_data_json: None,
        refresh_spec_json: None,
        status: "active".to_string(),
        is_pinned: false,
        is_archived: false,
        created_at: now.clone(),
        updated_at: now,
        last_refreshed_at: None,
        last_opened_at: None,
    };

    store.upsert_local_asset_record(&record).await?;
    store
        .get_local_asset_record(&prepared.asset_id)
        .await?
        .ok_or_else(|| McpError::Storage("saved local asset could not be reloaded".to_string()))
}

#[allow(dead_code)]
pub(crate) async fn register_render_assets_for_assistant_message(
    store: &McpStore,
    session_id: &str,
    turn_index: i64,
    meta_info: Option<&Value>,
) -> Result<usize, McpError> {
    let blocks = meta_info
        .and_then(|value: &Value| value.get("blocks"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if blocks.is_empty() {
        return Ok(0);
    }

    let mut registered = 0usize;
    for block in blocks {
        let Some(record) = render_asset_record_from_block(session_id, turn_index, &block) else {
            continue;
        };
        store.upsert_local_asset_record(&record).await?;
        registered = registered.saturating_add(1);
    }

    Ok(registered)
}

#[derive(Debug, Clone)]
struct PreparedAssetSave {
    asset_id: String,
    asset_kind: String,
    title: String,
    summary: Option<String>,
    html: String,
    source_view_type: String,
    render_hint: String,
    template_version: Option<String>,
    origin_session_id: Option<String>,
    origin_turn_index: Option<i64>,
    source_block_id: Option<String>,
    data_mode: String,
    match_hints: Vec<String>,
    props_hint: Vec<String>,
    output_example: Option<Value>,
}

impl PreparedAssetSave {
    fn from_request(request: SaveLocalAssetRequest) -> Result<Self, McpError> {
        let asset_id = request.asset_id.trim().to_string();
        if asset_id.is_empty() {
            return Err(McpError::validation("asset_id is required"));
        }

        let title = request.title.trim().to_string();
        if title.is_empty() {
            return Err(McpError::validation("title is required"));
        }

        let html = request.html.trim().to_string();
        if html.is_empty() {
            return Err(McpError::validation("html is required"));
        }

        let data_mode = request
            .data_mode
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("ai_data")
            .to_string();
        if data_mode != "ai_data" && data_mode != "self_fetch" {
            return Err(McpError::validation(
                "data_mode must be either ai_data or self_fetch",
            ));
        }

        let render_hint = request
            .render_hint
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(title.as_str())
            .to_string();
        let mut match_hints = normalize_string_list(request.match_hints.unwrap_or_default());
        if match_hints.is_empty() {
            match_hints.push(title.clone());
            if render_hint != title {
                match_hints.push(render_hint.clone());
            }
        }

        Ok(Self {
            asset_id,
            asset_kind: request
                .asset_kind
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("html_asset")
                .to_string(),
            title,
            summary: request
                .summary
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            html,
            source_view_type: request
                .source_view_type
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("html.v1")
                .to_string(),
            render_hint,
            template_version: request
                .template_version
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .or_else(|| Some("v1".to_string())),
            origin_session_id: request
                .origin_session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            origin_turn_index: request.origin_turn_index,
            source_block_id: request
                .source_block_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            data_mode,
            match_hints,
            props_hint: normalize_string_list(request.props_hint.unwrap_or_default()),
            output_example: request.output_example,
        })
    }
}

#[derive(Debug, Clone)]
struct PersistedAssetBundle {
    html_entry: String,
}

fn persist_asset_bundle(
    bundle_root: &Path,
    prepared: &PreparedAssetSave,
) -> Result<PersistedAssetBundle, McpError> {
    std::fs::create_dir_all(bundle_root).map_err(|err| McpError::Storage(err.to_string()))?;

    let bundle_name = build_asset_bundle_name(&prepared.asset_id);
    let bundle_dir = bundle_root.join(&bundle_name);
    std::fs::create_dir_all(&bundle_dir).map_err(|err| McpError::Storage(err.to_string()))?;

    let html_path = bundle_dir.join("index.html");
    let manifest_path = bundle_dir.join("manifest.json");
    let manifest = SaveLocalAssetManifest {
        asset_id: prepared.asset_id.clone(),
        title: prepared.title.clone(),
        summary: prepared.summary.clone(),
        data_mode: prepared.data_mode.clone(),
        html_entry: "index.html".to_string(),
        render_hint: Some(prepared.render_hint.clone()),
        match_hints: prepared.match_hints.clone(),
        props_hint: prepared.props_hint.clone(),
        output_example: prepared.output_example.clone(),
        template_version: prepared.template_version.clone(),
    };

    std::fs::write(&html_path, prepared.html.as_bytes())
        .map_err(|err| McpError::Storage(err.to_string()))?;
    std::fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest)
            .map_err(|err| McpError::Storage(err.to_string()))?,
    )
    .map_err(|err| McpError::Storage(err.to_string()))?;

    Ok(PersistedAssetBundle {
        html_entry: format!("bundles/{bundle_name}/index.html"),
    })
}

fn build_asset_bundle_name(asset_id: &str) -> String {
    let slug = sanitize_path_segment(asset_id);
    let digest = Sha256::digest(asset_id.as_bytes());
    let digest_hex = hex::encode(digest);
    format!("{slug}-{}", &digest_hex[..12])
}

fn sanitize_path_segment(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|char| match char {
            char if char.is_ascii_alphanumeric() => char.to_ascii_lowercase(),
            char if char.is_alphanumeric() => char,
            _ => '-',
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if sanitized.is_empty() {
        "asset".to_string()
    } else {
        sanitized
    }
}

fn normalize_string_list(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::<String>::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if normalized.iter().any(|existing| existing == trimmed) {
            continue;
        }
        normalized.push(trimmed.to_string());
    }
    normalized
}

fn to_json_string<T: serde::Serialize>(value: &T) -> Option<String> {
    serde_json::to_string(value).ok()
}

async fn build_local_asset_feedback_context(
    store: &McpStore,
    query: &str,
    session_id: Option<&str>,
) -> SearchFeedbackContext {
    let mut context = SearchFeedbackContext::default();

    if let Some(normalized_session_id) = session_id.map(str::trim).filter(|value| !value.is_empty())
    {
        if let Ok(recent_targets) = store
            .list_recent_session_asset_ids(normalized_session_id, 4)
            .await
        {
            context.recent_targets = recent_targets;
        }
    }

    let now_unix_ms = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    if let Ok(rows) = store.list_asset_execution_affinity_rows(32).await {
        context.historical_affinity =
            historical_affinity_from_asset_rows(&rows, now_unix_ms as i64);
    }
    if let Ok(rows) = store.list_asset_query_affinity_rows(64).await {
        context.query_affinity = query_affinity_from_asset_rows(query, &rows, now_unix_ms as i64);
    }

    context
}

fn build_local_asset_memory_text(record: &LocalAssetRecord) -> String {
    let mut sections = vec![format!("title: {}", record.title)];
    if let Some(summary) = record
        .summary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sections.push(format!("summary: {summary}"));
    }
    if let Some(render_hint) = record
        .render_hint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sections.push(format!("render_hint: {render_hint}"));
    }
    if let Some(data_mode) = record
        .data_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sections.push(format!("data_mode: {data_mode}"));
    }
    let match_hints = parse_string_list_json(record.match_hints_json.as_deref());
    if !match_hints.is_empty() {
        sections.push(format!("match_hints: {}", match_hints.join(", ")));
    }
    let props_hint = parse_string_list_json(record.props_hint_json.as_deref());
    if !props_hint.is_empty() {
        sections.push(format!("props_hint: {}", props_hint.join(", ")));
    }
    if let Some(output_example) = parse_value_json(record.output_example_json.as_deref()) {
        sections.push(format!(
            "output_example: {}",
            serde_json::to_string(&output_example).unwrap_or_else(|_| "{}".to_string())
        ));
    }
    sections.join("\n")
}

fn local_asset_record_to_memory_metadata(record: &LocalAssetRecord) -> Value {
    serde_json::json!({
        "asset_id": record.asset_id,
        "render_hint": record.render_hint,
        "data_mode": record.data_mode,
        "html_entry": record.html_entry,
        "template_id": record.template_id,
        "template_version": record.template_version,
        "match_hints": parse_string_list_json(record.match_hints_json.as_deref()),
        "props_hint": parse_string_list_json(record.props_hint_json.as_deref()),
        "output_example": parse_value_json(record.output_example_json.as_deref()),
        "source_view_type": record.source_view_type,
    })
}

fn local_asset_record_to_search_document(record: &LocalAssetRecord) -> Value {
    serde_json::json!({
        "id": record.asset_id,
        "name": record.title,
        "description": build_local_asset_memory_text(record),
        "asset_type": "html_asset",
        "source_type": "local_asset_registry",
        "pkg_name": record.asset_id,
        "metadata": local_asset_record_to_memory_metadata(record),
    })
}

pub(crate) async fn sync_local_asset_memory_index(
    app_state: &AppState,
    record: &LocalAssetRecord,
) -> Result<(), String> {
    if !record.asset_kind.eq_ignore_ascii_case("html_asset") {
        return Ok(());
    }

    let text = build_local_asset_memory_text(record);
    let vector = app_state
        .providers
        .embedding
        .embed_text(&text)
        .await
        .map_err(|err| err.to_string())?;

    app_state
        .memory
        .service
        .upsert_asset(
            record.asset_id.clone(),
            record.title.clone(),
            text,
            "html_asset".to_string(),
            "local_asset_registry".to_string(),
            Some(record.asset_id.clone()),
            vector,
            Some(local_asset_record_to_memory_metadata(record)),
        )
        .await
        .map_err(|err| err.to_string())
}

fn parse_string_list_json(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .map(normalize_string_list)
        .unwrap_or_default()
}

fn parse_value_json(raw: Option<&str>) -> Option<Value> {
    raw.and_then(|value| serde_json::from_str::<Value>(value).ok())
}

fn normalize_match_text(input: &str) -> String {
    input
        .trim()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn asset_candidate_has_grounded_recall_support(
    asset_key: &str,
    lexical_scores: &std::collections::HashMap<String, f64>,
    query_affinity_targets: &BTreeSet<String>,
) -> bool {
    lexical_scores.contains_key(asset_key) || query_affinity_targets.contains(asset_key)
}

fn render_asset_record_from_block(
    session_id: &str,
    turn_index: i64,
    block: &Value,
) -> Option<LocalAssetRecord> {
    let view_type = block.get("viewType").and_then(Value::as_str)?.trim();
    if view_type != "html.v1" {
        return None;
    }

    let payload = block.get("payload").and_then(Value::as_object)?;
    let snapshot_html = payload
        .get("snapshot_html")
        .and_then(Value::as_str)
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then_some(trimmed)
        })?
        .to_string();
    let refresh_spec = payload.get("refresh_spec").cloned();
    if refresh_spec.is_none() {
        return None;
    }

    let metadata = block.get("metadata").and_then(Value::as_object);
    let title = block
        .get("title")
        .and_then(Value::as_str)
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then_some(trimmed)
        })
        .or_else(|| {
            metadata
                .and_then(|value| value.get("render_hint"))
                .and_then(Value::as_str)
                .and_then(|value| {
                    let trimmed = value.trim();
                    (!trimmed.is_empty()).then_some(trimmed)
                })
        })
        .unwrap_or("Rendered Asset")
        .to_string();
    let render_hint = payload
        .get("render_hint")
        .and_then(Value::as_str)
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then_some(trimmed.to_string())
        });
    let template_id = metadata
        .and_then(|value| value.get("template_id"))
        .and_then(Value::as_str)
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then_some(trimmed.to_string())
        });
    let template_version = metadata
        .and_then(|value| value.get("template_version"))
        .and_then(Value::as_str)
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then_some(trimmed.to_string())
        });
    let summary = payload
        .get("summary")
        .and_then(Value::as_str)
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then_some(trimmed.to_string())
        });
    let render_data_json = payload
        .get("render_data")
        .or_else(|| payload.get("initial_data"))
        .and_then(|value| serde_json::to_string(value).ok());
    let refresh_spec_json = refresh_spec.and_then(|value| serde_json::to_string(&value).ok());
    let source_block_id = block
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then_some(trimmed.to_string())
        });
    let asset_id = derive_asset_id(
        session_id,
        turn_index,
        source_block_id.as_deref().unwrap_or("render"),
    );
    let now = current_time_rfc3339();

    Some(LocalAssetRecord {
        asset_id,
        asset_kind: "render_card".to_string(),
        title,
        summary,
        origin_session_id: session_id.trim().to_string(),
        origin_turn_index: turn_index,
        source_block_id,
        source_view_type: view_type.to_string(),
        render_hint,
        template_id,
        template_version,
        html_entry: None,
        data_mode: Some("ai_data".to_string()),
        match_hints_json: None,
        props_hint_json: None,
        output_example_json: None,
        latest_snapshot_html: Some(snapshot_html),
        latest_render_data_json: render_data_json,
        refresh_spec_json,
        status: "active".to_string(),
        is_pinned: false,
        is_archived: false,
        created_at: now.clone(),
        updated_at: now,
        last_refreshed_at: None,
        last_opened_at: None,
    })
}

fn derive_asset_id(session_id: &str, turn_index: i64, block_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("render_asset|{session_id}|{turn_index}|{block_id}").as_bytes());
    format!("render_asset:{}", hex::encode(hasher.finalize()))
}

fn current_time_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_asset_bundle_name_is_stable_and_safe() {
        let bundle = build_asset_bundle_name("weather/ios18:card");
        assert!(bundle.starts_with("weather-ios18-card-"));
        assert!(!bundle.contains('/'));
        assert_eq!(bundle, build_asset_bundle_name("weather/ios18:card"));
    }

    #[test]
    fn persist_asset_bundle_writes_index_and_manifest() {
        let temp_dir = std::env::temp_dir().join(format!(
            "deeting-asset-registry-test-{}",
            OffsetDateTime::now_utc().unix_timestamp_nanos()
        ));
        let prepared = PreparedAssetSave {
            asset_id: "weather-ios18-card".to_string(),
            asset_kind: "html_asset".to_string(),
            title: "Weather iOS18".to_string(),
            summary: Some("Compact weather card".to_string()),
            html: "<div>weather</div>".to_string(),
            source_view_type: "html.v1".to_string(),
            render_hint: "weather-card".to_string(),
            template_version: Some("v1".to_string()),
            origin_session_id: Some("session-1".to_string()),
            origin_turn_index: Some(1),
            source_block_id: None,
            data_mode: "ai_data".to_string(),
            match_hints: vec!["weather".to_string()],
            props_hint: vec!["location".to_string()],
            output_example: Some(json!({ "temp_c": 22 })),
        };

        let bundle = persist_asset_bundle(&temp_dir, &prepared).expect("persist asset bundle");
        let html_path = bundle
            .html_entry
            .split('/')
            .fold(temp_dir.clone(), |path, segment| path.join(segment));
        let html_raw = std::fs::read_to_string(&html_path).expect("read html");
        assert_eq!(html_raw, "<div>weather</div>");
        let manifest_path = html_path
            .parent()
            .expect("bundle dir")
            .join("manifest.json");
        let manifest_raw = std::fs::read_to_string(manifest_path).expect("read manifest");
        assert!(manifest_raw.contains("\"asset_id\": \"weather-ios18-card\""));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn render_asset_record_from_block_extracts_html_widget_with_refresh_spec() {
        let block = json!({
            "id": "render-abc",
            "type": "ui",
            "viewType": "html.v1",
            "title": "Weather Card",
            "payload": {
                "snapshot_html": "<div>snapshot</div>",
                "summary": "Cloudy",
                "render_hint": "weather-card",
                "render_data": { "temp_c": 22 },
                "refresh_spec": {
                    "kind": "chat_replay",
                    "input": { "message": "refresh weather" }
                }
            },
            "metadata": {
                "template_id": "manual://weather-card",
                "template_version": "v1"
            }
        });

        let record = render_asset_record_from_block("session-1", 3, &block).expect("asset record");

        assert_eq!(record.asset_kind, "render_card");
        assert_eq!(record.origin_session_id, "session-1");
        assert_eq!(record.origin_turn_index, 3);
        assert_eq!(record.template_id.as_deref(), Some("manual://weather-card"));
        assert_eq!(record.summary.as_deref(), Some("Cloudy"));
    }

    #[test]
    fn build_local_asset_memory_text_includes_recall_hints() {
        let record = LocalAssetRecord {
            asset_id: "weather-ios18-card".to_string(),
            asset_kind: "html_asset".to_string(),
            title: "Weather iOS18".to_string(),
            summary: Some("Compact weather card".to_string()),
            origin_session_id: "".to_string(),
            origin_turn_index: 0,
            source_block_id: None,
            source_view_type: "html.v1".to_string(),
            render_hint: Some("weather-card".to_string()),
            template_id: Some("asset://weather-ios18-card".to_string()),
            template_version: Some("v1".to_string()),
            html_entry: Some("bundles/weather/index.html".to_string()),
            data_mode: Some("ai_data".to_string()),
            match_hints_json: Some("[\"天气\",\"weather\"]".to_string()),
            props_hint_json: Some("[\"location\"]".to_string()),
            output_example_json: Some("{\"temp_c\":22}".to_string()),
            latest_snapshot_html: None,
            latest_render_data_json: None,
            refresh_spec_json: None,
            status: "active".to_string(),
            is_pinned: false,
            is_archived: false,
            created_at: "2026-03-31T00:00:00Z".to_string(),
            updated_at: "2026-03-31T00:00:00Z".to_string(),
            last_refreshed_at: None,
            last_opened_at: None,
        };

        let text = build_local_asset_memory_text(&record);
        assert!(text.contains("title: Weather iOS18"));
        assert!(text.contains("summary: Compact weather card"));
        assert!(text.contains("render_hint: weather-card"));
        assert!(text.contains("match_hints: 天气, weather"));
        assert!(text.contains("props_hint: location"));
        assert!(text.contains("\"temp_c\":22"));
    }

    #[test]
    fn asset_candidate_requires_lexical_or_query_affinity_support() {
        let lexical = std::collections::HashMap::from([("weather-ios18-card".to_string(), 1.0)]);
        let query_affinity_targets = BTreeSet::from(["stocks-market-card".to_string()]);

        assert!(asset_candidate_has_grounded_recall_support(
            "weather-ios18-card",
            &lexical,
            &BTreeSet::new()
        ));
        assert!(asset_candidate_has_grounded_recall_support(
            "stocks-market-card",
            &std::collections::HashMap::new(),
            &query_affinity_targets
        ));
        assert!(!asset_candidate_has_grounded_recall_support(
            "wiki-card",
            &std::collections::HashMap::new(),
            &BTreeSet::new()
        ));
    }

    #[test]
    fn local_asset_search_document_exposes_hint_text_to_bm25() {
        let weather = LocalAssetRecord {
            asset_id: "weather-ios18-card".to_string(),
            asset_kind: "html_asset".to_string(),
            title: "Weather iOS18".to_string(),
            summary: Some("Compact weather card".to_string()),
            origin_session_id: "".to_string(),
            origin_turn_index: 0,
            source_block_id: None,
            source_view_type: "html.v1".to_string(),
            render_hint: Some("weather-card".to_string()),
            template_id: Some("asset://weather-ios18-card".to_string()),
            template_version: Some("v1".to_string()),
            html_entry: Some("bundles/weather/index.html".to_string()),
            data_mode: Some("ai_data".to_string()),
            match_hints_json: Some("[\"天气\",\"weather\"]".to_string()),
            props_hint_json: None,
            output_example_json: None,
            latest_snapshot_html: None,
            latest_render_data_json: None,
            refresh_spec_json: None,
            status: "active".to_string(),
            is_pinned: false,
            is_archived: false,
            created_at: "2026-03-31T00:00:00Z".to_string(),
            updated_at: "2026-03-31T00:00:00Z".to_string(),
            last_refreshed_at: None,
            last_opened_at: None,
        };
        let stocks = LocalAssetRecord {
            asset_id: "stocks-market-card".to_string(),
            asset_kind: "html_asset".to_string(),
            title: "Market Movers".to_string(),
            summary: Some("Stock dashboard".to_string()),
            origin_session_id: "".to_string(),
            origin_turn_index: 0,
            source_block_id: None,
            source_view_type: "html.v1".to_string(),
            render_hint: Some("stocks-card".to_string()),
            template_id: Some("asset://stocks-market-card".to_string()),
            template_version: Some("v1".to_string()),
            html_entry: Some("bundles/stocks/index.html".to_string()),
            data_mode: Some("ai_data".to_string()),
            match_hints_json: Some("[\"股价\",\"stocks\"]".to_string()),
            props_hint_json: None,
            output_example_json: None,
            latest_snapshot_html: None,
            latest_render_data_json: None,
            refresh_spec_json: None,
            status: "active".to_string(),
            is_pinned: false,
            is_archived: false,
            created_at: "2026-03-31T00:00:00Z".to_string(),
            updated_at: "2026-03-31T00:00:00Z".to_string(),
            last_refreshed_at: None,
            last_opened_at: None,
        };

        let documents = vec![
            local_asset_record_to_search_document(&weather),
            local_asset_record_to_search_document(&stocks),
        ];
        let scores = bm25_asset_match_scores(&normalize_match_text("帮我查一下天气"), &documents);

        assert!(
            scores
                .get("weather-ios18-card")
                .copied()
                .unwrap_or_default()
                > scores
                    .get("stocks-market-card")
                    .copied()
                    .unwrap_or_default()
        );
    }
}
