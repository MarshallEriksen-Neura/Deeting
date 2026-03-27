use std::collections::{BTreeSet, HashSet};

use serde_json::Value;

const MISSING_CAPABILITIES_ERROR: &str = "search_sdk result is missing capabilities";
const NO_CALLABLE_DIRECT_CAPABILITIES_ERROR: &str =
    "search_sdk returned no callable direct capabilities; refine the search before execute_code_plan";

pub fn extract_callable_direct_capability_names(search_result: &Value) -> Result<Vec<String>, String> {
    let capabilities = search_result
        .get("capabilities")
        .and_then(Value::as_array)
        .ok_or_else(|| MISSING_CAPABILITIES_ERROR.to_string())?;

    let mut seen = HashSet::new();
    let mut names = Vec::new();

    for capability in capabilities {
        if !is_direct_callable_capability(capability) {
            continue;
        }
        let Some(name) = capability
            .get("name")
            .and_then(Value::as_str)
            .and_then(normalize_tool_name)
        else {
            continue;
        };
        if seen.insert(name.clone()) {
            names.push(name);
        }
    }

    if names.is_empty() {
        return Err(NO_CALLABLE_DIRECT_CAPABILITIES_ERROR.to_string());
    }

    Ok(names)
}

pub fn merge_allowed_tool_names(
    base_allowed_tool_names: &[String],
    capability_snapshot: Option<&Value>,
) -> Vec<String> {
    let mut merged = base_allowed_tool_names.to_vec();

    if let Some(snapshot) = capability_snapshot {
        if let Some(items) = snapshot.get("allowed_tool_names").and_then(Value::as_array) {
            for item in items {
                if let Some(text) = item.as_str() {
                    merged.push(text.to_string());
                }
            }
        }

        if let Ok(capability_names) = extract_callable_direct_capability_names(snapshot) {
            merged.extend(capability_names);
        }
    }

    merged
        .into_iter()
        .filter_map(|name| normalize_tool_name(name.as_str()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn is_direct_callable_capability(capability: &Value) -> bool {
    capability
        .pointer("/status/callable")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && capability
            .get("invocation_mode")
            .and_then(Value::as_str)
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("direct"))
}

fn normalize_tool_name(name: &str) -> Option<String> {
    let normalized = name.trim().to_lowercase();
    (!normalized.is_empty()).then_some(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_callable_direct_capability_names_preserves_result_order() {
        let names = extract_callable_direct_capability_names(&json!({
            "capabilities": [
                {"name": "search_web", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "fetch_page", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "search_web", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "ignored_code_mode", "invocation_mode": "code_mode", "status": {"callable": true}},
                {"name": "ignored_disabled", "invocation_mode": "direct", "status": {"callable": false}}
            ]
        }))
        .expect("callable direct capabilities");

        assert_eq!(
            names,
            vec!["search_web".to_string(), "fetch_page".to_string()]
        );
    }

    #[test]
    fn merge_allowed_tool_names_adds_legacy_and_snapshot_direct_tools() {
        let merged = merge_allowed_tool_names(
            &["search_sdk".to_string(), "SEARCH_SDK".to_string()],
            Some(&json!({
                "allowed_tool_names": ["browser_open_tab"],
                "capabilities": [
                    {"name": "browser_get_page_snapshot", "invocation_mode": "direct", "status": {"callable": true}},
                    {"name": "execute_code_plan", "invocation_mode": "code_mode", "status": {"callable": true}}
                ]
            })),
        );

        assert_eq!(
            merged,
            vec![
                "browser_get_page_snapshot".to_string(),
                "browser_open_tab".to_string(),
                "search_sdk".to_string(),
            ]
        );
    }
}
