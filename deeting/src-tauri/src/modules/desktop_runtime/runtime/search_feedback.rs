#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SearchAffinityScore {
    pub(crate) target_name: String,
    pub(crate) score: f64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct SearchFeedbackContext {
    pub(crate) recent_targets: Vec<String>,
    pub(crate) historical_affinity: Vec<SearchAffinityScore>,
    pub(crate) query_affinity: Vec<SearchAffinityScore>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct SearchFeedbackBoost {
    pub(crate) score: f64,
    pub(crate) reasons: Vec<String>,
}

const SEARCH_META_TOOLS: &[&str] = &["search_sdk", "get_tool_schema", "execute_code_plan"];
const HISTORICAL_HALF_LIFE_MS: f64 = 7.0 * 24.0 * 60.0 * 60.0 * 1000.0;
const QUERY_AFFINITY_HALF_LIFE_MS: f64 = 14.0 * 24.0 * 60.0 * 60.0 * 1000.0;
const RECENT_EXACT_TOOL_BOOST: f64 = 18.0;
const RECENT_NAMESPACE_SIBLING_BOOST: f64 = 8.0;
const HISTORICAL_EXACT_TOOL_MAX_BOOST: f64 = 16.0;
const HISTORICAL_NAMESPACE_FACTOR: f64 = 0.35;
const HISTORICAL_NAMESPACE_MAX_BOOST: f64 = 6.0;
const QUERY_AFFINITY_EXACT_MAX_BOOST: f64 = 14.0;
const QUERY_AFFINITY_MIN_SUCCESS_COUNT: i64 = 2;
const QUERY_AFFINITY_MIN_TOKENS: usize = 2;
const QUERY_AFFINITY_MIN_MATCH_STRENGTH: f64 = 0.65;

pub(crate) fn compute_feedback_boost(
    target_name: &str,
    context: &SearchFeedbackContext,
) -> SearchFeedbackBoost {
    let normalized_target_name = normalize_target_name(target_name);
    if normalized_target_name.is_empty() {
        return SearchFeedbackBoost::default();
    }

    let mut boost = SearchFeedbackBoost::default();
    let target_namespace = namespace_key(&normalized_target_name);

    if context
        .recent_targets
        .iter()
        .map(|target| normalize_target_name(target))
        .any(|target| target == normalized_target_name)
    {
        boost.score += RECENT_EXACT_TOOL_BOOST;
        boost.reasons.push("session:exact_tool".to_string());
    } else if target_namespace.as_ref().is_some_and(|namespace| {
        context
            .recent_targets
            .iter()
            .any(|target| same_namespace(target, namespace))
    }) {
        boost.score += RECENT_NAMESPACE_SIBLING_BOOST;
        boost.reasons.push("session:namespace_sibling".to_string());
    }

    if let Some(score) = context
        .query_affinity
        .iter()
        .find(|item| normalize_target_name(&item.target_name) == normalized_target_name)
        .map(|item| item.score.clamp(0.0, QUERY_AFFINITY_EXACT_MAX_BOOST))
    {
        if score > 0.0 {
            boost.score += score;
            boost
                .reasons
                .push(format!("query_affinity:exact_tool:{score:.2}"));
        }
    }

    if let Some(score) = context
        .historical_affinity
        .iter()
        .find(|item| normalize_target_name(&item.target_name) == normalized_target_name)
        .map(|item| item.score.clamp(0.0, HISTORICAL_EXACT_TOOL_MAX_BOOST))
    {
        if score > 0.0 {
            boost.score += score;
            boost.reasons.push(format!("history:exact_tool:{score:.2}"));
        }
    } else if let Some(namespace) = target_namespace.as_ref() {
        let namespace_score = context
            .historical_affinity
            .iter()
            .filter(|item| same_namespace(&item.target_name, namespace))
            .map(|item| item.score)
            .fold(0.0_f64, f64::max)
            * HISTORICAL_NAMESPACE_FACTOR;
        let namespace_score = namespace_score.clamp(0.0, HISTORICAL_NAMESPACE_MAX_BOOST);
        if namespace_score > 0.0 {
            boost.score += namespace_score;
            boost
                .reasons
                .push(format!("history:namespace_sibling:{namespace_score:.2}"));
        }
    }

    boost
}

pub(crate) fn search_feedback_context_from_tool_call_meta(
    tool_call_meta: &[serde_json::Value],
) -> SearchFeedbackContext {
    let recent_targets = tool_call_meta
        .iter()
        .rev()
        .filter(|item| {
            item.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| status.eq_ignore_ascii_case("success"))
        })
        .filter_map(|item| item.get("name").and_then(serde_json::Value::as_str))
        .map(normalize_target_name)
        .filter(|name| {
            !name.is_empty()
                && !SEARCH_META_TOOLS
                    .iter()
                    .any(|reserved| reserved.eq_ignore_ascii_case(name))
        })
        .fold(Vec::<String>::new(), |mut acc, name| {
            if !acc.iter().any(|existing| existing == &name) {
                acc.push(name);
            }
            acc
        });

    SearchFeedbackContext {
        recent_targets,
        historical_affinity: Vec::new(),
        query_affinity: Vec::new(),
    }
}

fn historical_affinity_from_records<'a>(
    rows: impl IntoIterator<Item = (&'a str, i64, i64)>,
    now_unix_ms: i64,
) -> Vec<SearchAffinityScore> {
    rows.into_iter()
        .filter_map(|(target_name, success_count, last_used_at_unix_ms)| {
            let normalized_target_name = normalize_target_name(target_name);
            if normalized_target_name.is_empty() {
                return None;
            }
            let age_ms = (now_unix_ms - last_used_at_unix_ms).max(0) as f64;
            let decay = 0.5_f64.powf(age_ms / HISTORICAL_HALF_LIFE_MS);
            let score = ((success_count as f64).sqrt() * 6.0 * decay)
                .clamp(0.0, HISTORICAL_EXACT_TOOL_MAX_BOOST);
            (score > 0.0).then_some(SearchAffinityScore {
                target_name: normalized_target_name,
                score,
            })
        })
        .collect()
}

pub(crate) fn historical_affinity_from_rows(
    rows: &[crate::modules::mcp::store::ToolExecutionAffinityRow],
    now_unix_ms: i64,
) -> Vec<SearchAffinityScore> {
    historical_affinity_from_records(
        rows.iter().map(|row| {
            (
                row.tool_name.as_str(),
                row.success_count,
                row.last_used_at_unix_ms,
            )
        }),
        now_unix_ms,
    )
}

fn query_affinity_from_records<'a>(
    current_query: &str,
    rows: impl IntoIterator<Item = (&'a str, &'a str, i64, i64)>,
    now_unix_ms: i64,
) -> Vec<SearchAffinityScore> {
    let normalized_query = current_query.trim().to_lowercase();
    if normalized_query.is_empty() {
        return Vec::new();
    }
    let current_tokens = query_tokens(&normalized_query);
    if current_tokens.len() < QUERY_AFFINITY_MIN_TOKENS {
        return Vec::new();
    }

    let mut by_target = std::collections::BTreeMap::<String, f64>::new();
    for (query_text, target_name, success_count, last_matched_at_unix_ms) in rows {
        let normalized_row_query = query_text.trim().to_lowercase();
        let normalized_target_name = normalize_target_name(target_name);
        if normalized_row_query.is_empty() || normalized_target_name.is_empty() {
            continue;
        }
        if success_count < QUERY_AFFINITY_MIN_SUCCESS_COUNT {
            continue;
        }
        if query_tokens(&normalized_row_query).len() < QUERY_AFFINITY_MIN_TOKENS {
            continue;
        }

        let match_strength = query_match_strength(&normalized_query, &normalized_row_query);
        if match_strength < QUERY_AFFINITY_MIN_MATCH_STRENGTH {
            continue;
        }

        let age_ms = (now_unix_ms - last_matched_at_unix_ms).max(0) as f64;
        let decay = 0.5_f64.powf(age_ms / QUERY_AFFINITY_HALF_LIFE_MS);
        let score = ((success_count as f64).sqrt() * 5.0 * decay * match_strength)
            .clamp(0.0, QUERY_AFFINITY_EXACT_MAX_BOOST);
        if score <= 0.0 {
            continue;
        }
        by_target
            .entry(normalized_target_name)
            .and_modify(|existing| *existing = existing.max(score))
            .or_insert(score);
    }

    by_target
        .into_iter()
        .map(|(target_name, score)| SearchAffinityScore { target_name, score })
        .collect()
}

pub(crate) fn query_affinity_from_rows(
    current_query: &str,
    rows: &[crate::modules::mcp::store::ToolQueryAffinityRow],
    now_unix_ms: i64,
) -> Vec<SearchAffinityScore> {
    query_affinity_from_records(
        current_query,
        rows.iter().map(|row| {
            (
                row.query_text.as_str(),
                row.tool_name.as_str(),
                row.success_count,
                row.last_matched_at_unix_ms,
            )
        }),
        now_unix_ms,
    )
}

fn same_namespace(target_name: &str, namespace: &str) -> bool {
    namespace_key(&normalize_target_name(target_name))
        .as_deref()
        .is_some_and(|candidate| candidate == namespace)
}

fn normalize_target_name(target_name: &str) -> String {
    target_name.trim().to_ascii_lowercase()
}

fn query_match_strength(current_query: &str, stored_query: &str) -> f64 {
    if current_query == stored_query {
        return 1.0;
    }
    if current_query.contains(stored_query) || stored_query.contains(current_query) {
        return 0.8;
    }

    let current_tokens = query_tokens(current_query);
    let stored_tokens = query_tokens(stored_query);
    if current_tokens.is_empty() || stored_tokens.is_empty() {
        return 0.0;
    }
    let overlap = stored_tokens
        .iter()
        .filter(|token| current_tokens.contains(*token))
        .count();
    if overlap == 0 {
        return 0.0;
    }
    (overlap as f64 / stored_tokens.len() as f64).clamp(0.0, 0.7)
}

fn query_tokens(text: &str) -> std::collections::BTreeSet<String> {
    let mut tokens = std::collections::BTreeSet::new();
    let mut ascii_buffer = String::new();
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            ascii_buffer.push(ch);
            continue;
        }
        if !ascii_buffer.is_empty() {
            tokens.insert(ascii_buffer.clone());
            ascii_buffer.clear();
        }
        if !ch.is_whitespace() {
            tokens.insert(ch.to_string());
        }
    }
    if !ascii_buffer.is_empty() {
        tokens.insert(ascii_buffer);
    }
    tokens
}

fn namespace_key(target_name: &str) -> Option<String> {
    let trimmed = target_name.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some((prefix, _)) = trimmed.rsplit_once('.') {
        return (!prefix.is_empty()).then_some(prefix.to_string());
    }
    trimmed
        .split_once('_')
        .map(|(prefix, _)| prefix.to_string())
        .filter(|prefix| !prefix.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feedback_boost_prefers_exact_recent_tool_over_namespace_only() {
        let exact = compute_feedback_boost(
            "browser_open_tab",
            &SearchFeedbackContext {
                recent_targets: vec!["browser_open_tab".to_string()],
                historical_affinity: Vec::new(),
                query_affinity: Vec::new(),
            },
        );
        let sibling = compute_feedback_boost(
            "browser_wait_for_element",
            &SearchFeedbackContext {
                recent_targets: vec!["browser_open_tab".to_string()],
                historical_affinity: Vec::new(),
                query_affinity: Vec::new(),
            },
        );

        assert!(exact.score > sibling.score);
        assert!(exact
            .reasons
            .iter()
            .any(|reason| reason == "session:exact_tool"));
        assert!(sibling
            .reasons
            .iter()
            .any(|reason| reason == "session:namespace_sibling"));
    }

    #[test]
    fn feedback_boost_applies_historical_affinity_with_namespace_fallback() {
        let exact = compute_feedback_boost(
            "skill.openclaw_weather.fetch_weather",
            &SearchFeedbackContext {
                recent_targets: Vec::new(),
                historical_affinity: vec![SearchAffinityScore {
                    target_name: "skill.openclaw_weather.fetch_weather".to_string(),
                    score: 9.5,
                }],
                query_affinity: Vec::new(),
            },
        );
        let sibling = compute_feedback_boost(
            "skill.openclaw_weather.fetch_alerts",
            &SearchFeedbackContext {
                recent_targets: Vec::new(),
                historical_affinity: vec![SearchAffinityScore {
                    target_name: "skill.openclaw_weather.fetch_weather".to_string(),
                    score: 9.5,
                }],
                query_affinity: Vec::new(),
            },
        );

        assert!(exact.score > sibling.score);
        assert!(exact
            .reasons
            .iter()
            .any(|reason| reason.starts_with("history:exact_tool")));
        assert!(sibling
            .reasons
            .iter()
            .any(|reason| reason.starts_with("history:namespace_sibling")));
    }

    #[test]
    fn search_feedback_context_from_tool_call_meta_keeps_recent_successful_non_meta_tools() {
        let context = search_feedback_context_from_tool_call_meta(&[
            serde_json::json!({
                "name": "search_sdk",
                "status": "success"
            }),
            serde_json::json!({
                "name": "browser_open_tab",
                "status": "error"
            }),
            serde_json::json!({
                "name": "browser_wait_for_element",
                "status": "success"
            }),
            serde_json::json!({
                "name": "browser_open_tab",
                "status": "success"
            }),
            serde_json::json!({
                "name": "browser_wait_for_element",
                "status": "success"
            }),
        ]);

        assert_eq!(
            context.recent_targets,
            vec![
                "browser_wait_for_element".to_string(),
                "browser_open_tab".to_string(),
            ]
        );
    }

    #[test]
    fn historical_affinity_from_rows_decays_older_usage() {
        let now_unix_ms = 10_000_i64;
        let scores = historical_affinity_from_rows(
            &[
                crate::modules::mcp::store::ToolExecutionAffinityRow {
                    tool_name: "browser_open_tab".to_string(),
                    success_count: 4,
                    last_used_at_unix_ms: 9_000,
                },
                crate::modules::mcp::store::ToolExecutionAffinityRow {
                    tool_name: "browser_wait_for_element".to_string(),
                    success_count: 4,
                    last_used_at_unix_ms: 1_000,
                },
            ],
            now_unix_ms,
        );

        assert_eq!(scores.len(), 2);
        assert!(scores[0].score > scores[1].score);
    }

    #[test]
    fn query_affinity_from_rows_prefers_exact_and_recent_query_matches() {
        let now_unix_ms = 20_000_i64;
        let scores = query_affinity_from_rows(
            "check bug",
            &[
                crate::modules::mcp::store::ToolQueryAffinityRow {
                    query_text: "check bug".to_string(),
                    tool_name: "eslint_check".to_string(),
                    success_count: 3,
                    last_matched_at_unix_ms: 19_000,
                },
                crate::modules::mcp::store::ToolQueryAffinityRow {
                    query_text: "browser inspect".to_string(),
                    tool_name: "browser_get_page_snapshot".to_string(),
                    success_count: 5,
                    last_matched_at_unix_ms: 19_500,
                },
            ],
            now_unix_ms,
        );

        assert_eq!(scores.len(), 1);
        assert_eq!(scores[0].target_name, "eslint_check");
        assert!(scores[0].score > 0.0);
    }

    #[test]
    fn query_affinity_from_rows_ignores_low_confidence_rows() {
        let now_unix_ms = 20_000_i64;
        let scores = query_affinity_from_rows(
            "check bug",
            &[
                crate::modules::mcp::store::ToolQueryAffinityRow {
                    query_text: "check".to_string(),
                    tool_name: "eslint_check".to_string(),
                    success_count: 10,
                    last_matched_at_unix_ms: 19_000,
                },
                crate::modules::mcp::store::ToolQueryAffinityRow {
                    query_text: "check bug".to_string(),
                    tool_name: "eslint_check".to_string(),
                    success_count: 1,
                    last_matched_at_unix_ms: 19_500,
                },
            ],
            now_unix_ms,
        );

        assert!(scores.is_empty());
    }
}
