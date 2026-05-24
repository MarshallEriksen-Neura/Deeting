use crate::modules::custom_task_agents::types::CustomTaskAgentProfile;
use crate::state::AppState;
use serde_json::{json, Value};

pub(super) async fn build_bound_asset_reference(
    app_state: &AppState,
    profile: &CustomTaskAgentProfile,
) -> Option<Value> {
    let asset_id = profile
        .bound_asset_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let record = app_state
        .mcp
        .store
        .get_local_asset_record(asset_id)
        .await
        .ok()
        .flatten()?;
    if record.is_archived
        || !record.status.eq_ignore_ascii_case("active")
        || !record.asset_kind.eq_ignore_ascii_case("html_asset")
    {
        return None;
    }
    Some(json!({
        "asset_id": record.asset_id,
        "title": record.title,
        "summary": record.summary,
        "render_hint": record.render_hint,
        "data_mode": record.data_mode,
        "match_hints": parse_json_string_list(record.match_hints_json.as_deref()),
        "props_hint": parse_json_string_list(record.props_hint_json.as_deref()),
        "output_example": parse_json_value(record.output_example_json.as_deref()),
    }))
}

fn parse_json_string_list(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .unwrap_or_default()
}

fn parse_json_value(raw: Option<&str>) -> Option<Value> {
    raw.and_then(|value| serde_json::from_str::<Value>(value).ok())
}
