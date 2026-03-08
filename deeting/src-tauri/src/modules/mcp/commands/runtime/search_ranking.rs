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

fn lexical_asset_match_score(normalized_query: &str, item: &serde_json::Value) -> Option<f64> {
    if normalized_query.trim().is_empty() {
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
    let haystack = format!("{name}\n{description}");
    if haystack.trim().is_empty() {
        return None;
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

    let prefix_bonus = if name.starts_with(normalized_query) || description.starts_with(normalized_query)
    {
        100.0
    } else {
        0.0
    };
    Some(prefix_bonus + overlap as f64)
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