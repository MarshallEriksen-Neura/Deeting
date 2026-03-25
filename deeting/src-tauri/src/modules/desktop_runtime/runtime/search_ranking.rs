pub(crate) fn lexical_rank_asset_hits(
    normalized_query: &str,
    assets: Vec<serde_json::Value>,
    limit: usize,
) -> Vec<serde_json::Value> {
    let mut ranked = assets
        .into_iter()
        .filter_map(|mut item| {
            let score = lexical_asset_match_score(normalized_query, &item)?;
            if let Some(object) = item.as_object_mut() {
                object.insert("_distance".to_string(), serde_json::json!(score));
            }
            Some(item)
        })
        .collect::<Vec<_>>();

    ranked.sort_by(|left, right| {
        let lhs = left
            .get("_distance")
            .and_then(|value| value.as_f64())
            .unwrap_or(f64::NEG_INFINITY);
        let rhs = right
            .get("_distance")
            .and_then(|value| value.as_f64())
            .unwrap_or(f64::NEG_INFINITY);
        rhs.partial_cmp(&lhs).unwrap_or(std::cmp::Ordering::Equal)
    });
    if ranked.len() > limit {
        ranked.truncate(limit);
    }
    ranked
}

pub(crate) fn lexical_asset_match_score(
    normalized_query: &str,
    item: &serde_json::Value,
) -> Option<f64> {
    let normalized_query = normalized_query.trim();
    if normalized_query.is_empty() {
        return None;
    }
    let name = item
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_lowercase();
    let description = item
        .get("description")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_lowercase();
    let identifier_fields = lexical_identifier_fields(item);
    let haystack = if identifier_fields.is_empty() {
        format!("{name}\n{description}")
    } else {
        format!("{}\n{name}\n{description}", identifier_fields.join("\n"))
    };
    if haystack.trim().is_empty() {
        return None;
    }
    if identifier_fields
        .iter()
        .any(|value| value == normalized_query)
    {
        return Some(2200.0);
    }
    if name == normalized_query {
        return Some(1800.0);
    }
    if identifier_fields
        .iter()
        .any(|value| value.starts_with(normalized_query))
    {
        return Some(1300.0);
    }
    if identifier_fields
        .iter()
        .any(|value| value.contains(normalized_query))
    {
        return Some(1200.0);
    }
    if name.contains(normalized_query) {
        return Some(1000.0);
    }
    if description.contains(normalized_query) {
        return Some(900.0);
    }

    let overlap = lexical_units(normalized_query)
        .into_iter()
        .filter(|unit| !unit.is_empty() && haystack.contains(unit))
        .count();
    if overlap == 0 {
        return None;
    }

    let prefix_bonus =
        if name.starts_with(normalized_query) || description.starts_with(normalized_query) {
            100.0
        } else {
            0.0
        };
    Some(prefix_bonus + overlap as f64)
}

fn lexical_identifier_fields(item: &serde_json::Value) -> Vec<String> {
    let mut fields = Vec::new();

    for key in ["id", "capability_id", "pkg_name"] {
        if let Some(value) = item
            .get(key)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            fields.push(value.to_lowercase());
        }
    }

    if let Some(metadata) = item.get("metadata") {
        for key in ["skill_id", "binding_id", "callable_name", "tool_name"] {
            if let Some(value) = metadata
                .get(key)
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                fields.push(value.to_lowercase());
            }
        }
    }

    fields.sort();
    fields.dedup();
    fields
}

fn lexical_units(input: &str) -> Vec<String> {
    let mut units = Vec::new();
    let mut ascii_buffer = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            ascii_buffer.push(ch);
            continue;
        }
        if !ascii_buffer.is_empty() {
            units.push(ascii_buffer.clone());
            ascii_buffer.clear();
        }
        if !ch.is_whitespace() {
            units.push(ch.to_string());
        }
    }
    if !ascii_buffer.is_empty() {
        units.push(ascii_buffer);
    }
    units
}

#[cfg(test)]
mod tests {
    use super::lexical_asset_match_score;
    use serde_json::json;

    #[test]
    fn lexical_asset_match_score_prefers_exact_pkg_name_match() {
        let score = lexical_asset_match_score(
            "official.skills.provider_registry",
            &json!({
                "name": "Provider Registry",
                "description": "Desktop provider registry",
                "pkg_name": "official.skills.provider_registry"
            }),
        )
        .expect("score");

        assert!(score >= 2200.0);
    }

    #[test]
    fn lexical_asset_match_score_prefers_exact_metadata_skill_id_match() {
        let score = lexical_asset_match_score(
            "official.skills.provider_registry",
            &json!({
                "name": "Provider Registry",
                "description": "Desktop provider registry",
                "metadata": {
                    "skill_id": "official.skills.provider_registry"
                }
            }),
        )
        .expect("score");

        assert!(score >= 2200.0);
    }
}
