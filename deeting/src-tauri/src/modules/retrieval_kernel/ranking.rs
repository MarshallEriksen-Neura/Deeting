use std::collections::{BTreeMap, HashMap};

use serde_json::Value;

const BM25_K1: f64 = 1.2;
const BM25_B: f64 = 0.75;
const RRF_K: f64 = 60.0;

pub(crate) fn bm25_asset_match_scores(
    normalized_query: &str,
    items: &[Value],
) -> HashMap<String, f64> {
    let query_terms = ranking_terms(normalized_query);
    if query_terms.is_empty() || items.is_empty() {
        return HashMap::new();
    }

    let documents = items
        .iter()
        .filter_map(|item| {
            let key = asset_score_key(item)?;
            let terms = ranking_document_terms(item);
            if terms.is_empty() {
                return None;
            }
            Some((key, terms))
        })
        .collect::<Vec<_>>();
    if documents.is_empty() {
        return HashMap::new();
    }

    let mut document_frequency = HashMap::<String, usize>::new();
    let mut total_doc_len = 0_usize;
    for (_, terms) in &documents {
        total_doc_len += terms.len();
        let mut seen = BTreeMap::<String, bool>::new();
        for term in terms {
            seen.entry(term.clone()).or_insert(true);
        }
        for term in seen.keys() {
            *document_frequency.entry(term.clone()).or_insert(0) += 1;
        }
    }
    let average_doc_len = (total_doc_len as f64 / documents.len() as f64).max(1.0);

    let mut raw_scores = HashMap::<String, f64>::new();
    let mut max_score = 0.0_f64;
    for (key, terms) in &documents {
        let doc_len = terms.len() as f64;
        let mut term_frequency = HashMap::<String, usize>::new();
        for term in terms {
            *term_frequency.entry(term.clone()).or_insert(0) += 1;
        }

        let mut score = 0.0_f64;
        for query_term in &query_terms {
            let tf = term_frequency.get(query_term).copied().unwrap_or(0) as f64;
            if tf <= 0.0 {
                continue;
            }
            let df = document_frequency.get(query_term).copied().unwrap_or(0) as f64;
            if df <= 0.0 {
                continue;
            }
            let n = documents.len() as f64;
            let idf = (((n - df + 0.5) / (df + 0.5)) + 1.0).ln();
            let numerator = tf * (BM25_K1 + 1.0);
            let denominator = tf + BM25_K1 * (1.0 - BM25_B + BM25_B * (doc_len / average_doc_len));
            score += idf * (numerator / denominator);
        }

        if score > 0.0 {
            max_score = max_score.max(score);
            raw_scores.insert(key.clone(), score);
        }
    }

    if max_score <= 0.0 {
        return HashMap::new();
    }

    raw_scores
        .into_iter()
        .map(|(key, score)| (key, (score / max_score).clamp(0.0, 1.0)))
        .collect()
}

pub(crate) fn reciprocal_rank_fusion(score_maps: &[&HashMap<String, f64>]) -> HashMap<String, f64> {
    let mut fused = HashMap::<String, f64>::new();

    for score_map in score_maps {
        let mut ranked = score_map
            .iter()
            .map(|(key, score)| (key.clone(), *score))
            .collect::<Vec<_>>();
        ranked.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.0.cmp(&right.0))
        });

        for (index, (key, _)) in ranked.into_iter().enumerate() {
            let rank = index as f64 + 1.0;
            *fused.entry(key).or_insert(0.0) += 1.0 / (RRF_K + rank);
        }
    }

    let max_score = fused.values().copied().fold(0.0_f64, f64::max);
    if max_score <= 0.0 {
        return HashMap::new();
    }

    fused
        .into_iter()
        .map(|(key, score)| (key, (score / max_score).clamp(0.0, 1.0)))
        .collect()
}

pub(crate) fn normalize_score_map(scores: HashMap<String, f64>) -> HashMap<String, f64> {
    let max_score = scores.values().copied().fold(0.0_f64, f64::max);
    if max_score <= 0.0 {
        return HashMap::new();
    }
    scores
        .into_iter()
        .map(|(key, score)| (key, (score / max_score).clamp(0.0, 1.0)))
        .collect()
}

pub(crate) fn asset_score_key(item: &Value) -> Option<String> {
    item.get("id")
        .and_then(Value::as_str)
        .or_else(|| item.get("capability_id").and_then(Value::as_str))
        .or_else(|| item.get("name").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

fn ranking_document_terms(item: &Value) -> Vec<String> {
    let mut terms = Vec::new();
    for field in lexical_identifier_fields(item) {
        terms.extend(ranking_terms(&field));
    }
    if let Some(name) = item.get("name").and_then(Value::as_str) {
        terms.extend(ranking_terms(name));
    }
    if let Some(description) = item.get("description").and_then(Value::as_str) {
        terms.extend(ranking_terms(description));
    }
    terms
}

fn lexical_identifier_fields(item: &Value) -> Vec<String> {
    let mut fields = Vec::new();

    for key in ["id", "capability_id", "pkg_name"] {
        if let Some(value) = item
            .get(key)
            .and_then(Value::as_str)
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
                .and_then(Value::as_str)
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

fn ranking_terms(input: &str) -> Vec<String> {
    let mut units = Vec::new();
    let mut ascii_buffer = String::new();
    for ch in input.trim().to_lowercase().chars() {
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
    use super::{
        asset_score_key, bm25_asset_match_scores, normalize_score_map, reciprocal_rank_fusion,
    };
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn bm25_asset_match_scores_prefers_exact_identifierish_asset() {
        let items = vec![
            json!({
                "id": "skill.provider_registry",
                "name": "Provider Registry",
                "description": "Desktop provider registry",
                "pkg_name": "official.skills.provider_registry"
            }),
            json!({
                "id": "skill.other",
                "name": "Other Skill",
                "description": "Something unrelated"
            }),
        ];

        let scores = bm25_asset_match_scores("official skills provider registry", &items);
        let provider_score = scores
            .get("skill.provider_registry")
            .copied()
            .expect("provider score");
        let other_score = scores.get("skill.other").copied().unwrap_or(0.0);

        assert!(provider_score > other_score);
    }

    #[test]
    fn bm25_asset_match_scores_normalizes_top_result_to_one() {
        let items = vec![
            json!({
                "id": "core.browser_open_tab",
                "name": "browser_open_tab",
                "description": "Open a browser tab"
            }),
            json!({
                "id": "core.shell_execute",
                "name": "shell_execute",
                "description": "Execute shell commands"
            }),
        ];

        let scores = bm25_asset_match_scores("browser open tab", &items);
        let top_score = scores.values().copied().fold(0.0_f64, f64::max);
        assert!((top_score - 1.0).abs() < 1e-9);
    }

    #[test]
    fn reciprocal_rank_fusion_rewards_items_present_in_multiple_rankings() {
        let bm25 = HashMap::from([
            ("asset.shared".to_string(), 1.0),
            ("asset.bm25_only".to_string(), 0.8),
        ]);
        let structured = HashMap::from([
            ("asset.shared".to_string(), 1.0),
            ("asset.structured_only".to_string(), 0.9),
        ]);

        let fused = reciprocal_rank_fusion(&[&bm25, &structured]);
        assert!(
            fused["asset.shared"] > fused["asset.bm25_only"]
                && fused["asset.shared"] > fused["asset.structured_only"]
        );
    }

    #[test]
    fn normalize_score_map_scales_max_to_one() {
        let normalized = normalize_score_map(HashMap::from([
            ("a".to_string(), 2.0),
            ("b".to_string(), 1.0),
        ]));

        assert_eq!(normalized["a"], 1.0);
        assert_eq!(normalized["b"], 0.5);
    }

    #[test]
    fn asset_score_key_prefers_id_and_normalizes_case() {
        let item = json!({ "id": " Core.Tool " });
        assert_eq!(asset_score_key(&item).as_deref(), Some("core.tool"));
    }
}
