#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ToolAffinityScore {
    pub(crate) tool_name: String,
    pub(crate) score: f64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct SearchFeedbackContext {
    pub(crate) recent_tools: Vec<String>,
    pub(crate) historical_affinity: Vec<ToolAffinityScore>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct SearchFeedbackBoost {
    pub(crate) score: f64,
    pub(crate) reasons: Vec<String>,
}

const SEARCH_META_TOOLS: &[&str] = &[
    "search_sdk",
    "get_tool_schema",
    "execute_code_plan",
    "consult_expert_network",
    "attach_capability",
    "detach_capability",
];
const RECENT_EXACT_TOOL_BOOST: f64 = 18.0;
const RECENT_NAMESPACE_SIBLING_BOOST: f64 = 8.0;
const HISTORICAL_EXACT_TOOL_MAX_BOOST: f64 = 16.0;
const HISTORICAL_NAMESPACE_FACTOR: f64 = 0.35;
const HISTORICAL_NAMESPACE_MAX_BOOST: f64 = 6.0;

pub(crate) fn compute_feedback_boost(
    tool_name: &str,
    context: &SearchFeedbackContext,
) -> SearchFeedbackBoost {
    let normalized_tool_name = normalize_tool_name(tool_name);
    if normalized_tool_name.is_empty() {
        return SearchFeedbackBoost::default();
    }

    let mut boost = SearchFeedbackBoost::default();
    let tool_namespace = namespace_key(&normalized_tool_name);

    if context
        .recent_tools
        .iter()
        .map(|tool| normalize_tool_name(tool))
        .any(|tool| tool == normalized_tool_name)
    {
        boost.score += RECENT_EXACT_TOOL_BOOST;
        boost.reasons.push("session:exact_tool".to_string());
    } else if tool_namespace
        .as_ref()
        .is_some_and(|namespace| context.recent_tools.iter().any(|tool| same_namespace(tool, namespace)))
    {
        boost.score += RECENT_NAMESPACE_SIBLING_BOOST;
        boost.reasons.push("session:namespace_sibling".to_string());
    }

    if let Some(score) = context
        .historical_affinity
        .iter()
        .find(|item| normalize_tool_name(&item.tool_name) == normalized_tool_name)
        .map(|item| item.score.clamp(0.0, HISTORICAL_EXACT_TOOL_MAX_BOOST))
    {
        if score > 0.0 {
            boost.score += score;
            boost
                .reasons
                .push(format!("history:exact_tool:{score:.2}"));
        }
    } else if let Some(namespace) = tool_namespace.as_ref() {
        let namespace_score = context
            .historical_affinity
            .iter()
            .filter(|item| same_namespace(&item.tool_name, namespace))
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
    let recent_tools = tool_call_meta
        .iter()
        .rev()
        .filter(|item| {
            item.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| status.eq_ignore_ascii_case("success"))
        })
        .filter_map(|item| item.get("name").and_then(serde_json::Value::as_str))
        .map(normalize_tool_name)
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
        recent_tools,
        historical_affinity: Vec::new(),
    }
}

fn same_namespace(tool_name: &str, namespace: &str) -> bool {
    namespace_key(&normalize_tool_name(tool_name))
        .as_deref()
        .is_some_and(|candidate| candidate == namespace)
}

fn normalize_tool_name(tool_name: &str) -> String {
    tool_name.trim().to_ascii_lowercase()
}

fn namespace_key(tool_name: &str) -> Option<String> {
    let trimmed = tool_name.trim();
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
                recent_tools: vec!["browser_open_tab".to_string()],
                historical_affinity: Vec::new(),
            },
        );
        let sibling = compute_feedback_boost(
            "browser_wait_for_element",
            &SearchFeedbackContext {
                recent_tools: vec!["browser_open_tab".to_string()],
                historical_affinity: Vec::new(),
            },
        );

        assert!(exact.score > sibling.score);
        assert!(exact.reasons.iter().any(|reason| reason == "session:exact_tool"));
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
                recent_tools: Vec::new(),
                historical_affinity: vec![ToolAffinityScore {
                    tool_name: "skill.openclaw_weather.fetch_weather".to_string(),
                    score: 9.5,
                }],
            },
        );
        let sibling = compute_feedback_boost(
            "skill.openclaw_weather.fetch_alerts",
            &SearchFeedbackContext {
                recent_tools: Vec::new(),
                historical_affinity: vec![ToolAffinityScore {
                    tool_name: "skill.openclaw_weather.fetch_weather".to_string(),
                    score: 9.5,
                }],
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
            context.recent_tools,
            vec![
                "browser_wait_for_element".to_string(),
                "browser_open_tab".to_string(),
            ]
        );
    }
}
