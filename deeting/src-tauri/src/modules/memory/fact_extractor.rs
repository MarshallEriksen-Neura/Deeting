use std::sync::Arc;

use crate::modules::memory::service::MemoryService;
use crate::modules::memory::types::{CreateLocalMemoryRequest, WriteAction};
use crate::modules::providers::model_guard::resolve_local_secretary_model_connection;
use crate::state::AppState;

const FACT_EXTRACTION_PROMPT_TEMPLATE: &str = r#"You are a fact extraction system. Analyze the following conversation and extract key facts about the user that would be useful to remember for future conversations.

Rules:
- Extract only factual statements about the user (preferences, personal info, technical context, goals)
- Each fact should be a single, self-contained sentence
- Do not extract opinions about general topics, only user-specific facts
- Do not extract transient information (current task details, temporary state)
- Return a JSON array of strings. Return an empty array [] if no meaningful facts are found
- Maximum 5 facts per extraction

Conversation:
{conversation}

Respond with ONLY a JSON array of fact strings, no other text."#;

const FACT_EXTRACTION_CONVERSATION_MAX_CHARS: usize = 4000;
const FACT_EXTRACTION_MAX_TOKENS: u32 = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct FactExtractionWriteSummary {
    pub extracted: usize,
    pub added: usize,
    pub updated: usize,
    pub noop: usize,
    pub failed: usize,
}

impl FactExtractionWriteSummary {
    pub(crate) fn successful_count(self) -> usize {
        self.added + self.updated + self.noop
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FactExtractionOutcome {
    Processed(FactExtractionWriteSummary),
    NoFacts,
    Skipped,
}

impl FactExtractionOutcome {
    pub(crate) fn should_mark_processed(self) -> bool {
        matches!(self, Self::Processed(_) | Self::NoFacts)
    }
}

/// Extract user facts from a conversation and store them as memories.
///
pub(crate) async fn extract_and_store_facts(
    app_state: &AppState,
    memory_service: Arc<MemoryService>,
    provider_model_id: &str,
    model_id: &str,
    conversation_text: &str,
    session_id: &str,
    capability_id: Option<&str>,
) -> Result<FactExtractionOutcome, String> {
    let trimmed = conversation_text.trim();
    if trimmed.is_empty() || trimmed.len() < 50 {
        return Ok(FactExtractionOutcome::Skipped);
    }

    // Keep the most recent conversation context without slicing through UTF-8 bytes.
    let truncated = take_last_chars(trimmed, FACT_EXTRACTION_CONVERSATION_MAX_CHARS);

    let prompt = FACT_EXTRACTION_PROMPT_TEMPLATE.replace("{conversation}", truncated.as_str());

    let extracted =
        match crate::modules::conversations::summary_generation::request_local_auxiliary_text(
            app_state,
            provider_model_id,
            model_id,
            &prompt,
            FACT_EXTRACTION_MAX_TOKENS,
            Some(session_id),
        )
        .await
        {
            Ok(Some(text)) => text,
            Ok(None) => {
                log::info!(
                    "fact extraction: no auxiliary text returned for session {}",
                    session_id
                );
                return Ok(FactExtractionOutcome::NoFacts);
            }
            Err(e) => return Err(format!("fact extraction LLM call failed: {}", e)),
        };

    let facts = match parse_fact_array(&extracted) {
        Some(facts) => facts,
        None => return Err("fact extraction: failed to parse response as JSON array".to_string()),
    };

    if facts.is_empty() {
        log::info!(
            "fact extraction: model returned empty fact array for session {}",
            session_id
        );
        return Ok(FactExtractionOutcome::NoFacts);
    }

    let mut summary = FactExtractionWriteSummary {
        extracted: facts.len(),
        ..FactExtractionWriteSummary::default()
    };
    let mut first_store_error = None;
    for fact in facts {
        let fact_trimmed = fact.trim().to_string();
        if fact_trimmed.is_empty() {
            continue;
        }

        let payload = CreateLocalMemoryRequest {
            content: fact_trimmed,
            session_id: Some(session_id.to_string()),
            capability_id: capability_id.map(|s| s.to_string()),
            meta_info: Some(serde_json::json!({ "source": "auto_extraction" })),
            category: Some("fact".to_string()),
            source: Some("auto_extraction".to_string()),
            tags: None,
        };

        match memory_service.append_guarded(payload).await {
            Ok(result) => match result.action {
                WriteAction::Add => {
                    summary.added = summary.added.saturating_add(1);
                }
                WriteAction::Update => {
                    summary.updated = summary.updated.saturating_add(1);
                }
                WriteAction::Noop => {
                    summary.noop = summary.noop.saturating_add(1);
                }
            },
            Err(e) => {
                summary.failed = summary.failed.saturating_add(1);
                log::warn!("fact extraction: failed to store fact: {}", e);
                if first_store_error.is_none() {
                    first_store_error = Some(e.to_string());
                }
            }
        }
    }

    if summary.successful_count() > 0 {
        log::info!(
            "fact extraction: processed {} facts from session {} add={} update={} noop={} failed={}",
            summary.extracted,
            session_id,
            summary.added,
            summary.updated,
            summary.noop,
            summary.failed
        );
        return Ok(FactExtractionOutcome::Processed(summary));
    }

    if let Some(error) = first_store_error {
        return Err(format!(
            "fact extraction: failed to store extracted facts: {}",
            error
        ));
    }

    Ok(FactExtractionOutcome::NoFacts)
}

pub(crate) async fn extract_and_store_facts_with_secretary_model(
    app_state: &AppState,
    memory_service: Arc<MemoryService>,
    conversation_text: &str,
    session_id: &str,
    capability_id: Option<&str>,
) -> Result<FactExtractionOutcome, String> {
    let model_connection = resolve_local_secretary_model_connection(app_state)
        .await
        .map_err(|err| format!("fact extraction secretary model resolve failed: {}", err))?;

    extract_and_store_facts(
        app_state,
        memory_service,
        &model_connection.provider_model_id,
        &model_connection.model_id,
        conversation_text,
        session_id,
        capability_id,
    )
    .await
}

/// Parse a JSON array of strings from LLM output.
/// Handles markdown code blocks and whitespace.
fn parse_fact_array(raw: &str) -> Option<Vec<String>> {
    let cleaned = raw.trim();
    if cleaned.is_empty() {
        return None;
    }

    // Strip markdown code block if present
    let json_str = if cleaned.starts_with("```") {
        cleaned
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        cleaned
    };

    parse_json_fact_array(json_str)
        .or_else(|| extract_json_array_substring(json_str).and_then(parse_json_fact_array))
}

fn parse_json_fact_array(raw: &str) -> Option<Vec<String>> {
    let parsed: serde_json::Value = serde_json::from_str(raw).ok()?;
    let arr = parsed.as_array()?;
    let facts: Vec<String> = arr
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .take(5)
        .collect();
    Some(facts)
}

fn take_last_chars(input: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }

    let char_count = input.chars().count();
    if char_count <= max_chars {
        return input.to_string();
    }

    input
        .chars()
        .skip(char_count - max_chars)
        .collect::<String>()
}

fn extract_json_array_substring(raw: &str) -> Option<&str> {
    let start = raw.find('[')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in raw[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '[' => depth = depth.saturating_add(1),
            ']' => {
                if depth == 0 {
                    return None;
                }
                depth -= 1;
                if depth == 0 {
                    let end = start + index + ch.len_utf8();
                    return Some(&raw[start..end]);
                }
            }
            _ => {}
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{parse_fact_array, take_last_chars, FACT_EXTRACTION_CONVERSATION_MAX_CHARS};
    use super::{FactExtractionOutcome, FactExtractionWriteSummary};

    #[test]
    fn parses_clean_json_array() {
        let input = r#"["The user prefers Rust", "The user works on a desktop app"]"#;
        let result = parse_fact_array(input).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], "The user prefers Rust");
    }

    #[test]
    fn parses_markdown_wrapped_json() {
        let input = "```json\n[\"Fact one\", \"Fact two\"]\n```";
        let result = parse_fact_array(input).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn returns_empty_for_empty_array() {
        let input = "[]";
        let result = parse_fact_array(input).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn returns_none_for_invalid_json() {
        let input = "not json at all";
        assert!(parse_fact_array(input).is_none());
    }

    #[test]
    fn parses_json_array_embedded_in_explanatory_text() {
        let input = r#"Here are the facts:
["The user prefers Rust", "The user is building a desktop app"]"#;
        let result = parse_fact_array(input).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[1], "The user is building a desktop app");
    }

    #[test]
    fn parses_markdown_wrapped_array_with_extra_text() {
        let input = "Result:\n```json\n[\"Fact one\", \"Fact two\"]\n```\nDone.";
        let result = parse_fact_array(input).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn caps_at_five_facts() {
        let input = r#"["a","b","c","d","e","f","g"]"#;
        let result = parse_fact_array(input).unwrap();
        assert_eq!(result.len(), 5);
    }

    #[test]
    fn take_last_chars_keeps_recent_chinese_text_without_panicking() {
        let input = format!("{}听", "a".repeat(FACT_EXTRACTION_CONVERSATION_MAX_CHARS));

        let result = take_last_chars(&input, FACT_EXTRACTION_CONVERSATION_MAX_CHARS);

        assert_eq!(
            result.chars().count(),
            FACT_EXTRACTION_CONVERSATION_MAX_CHARS
        );
        assert!(result.ends_with('听'));
        assert_eq!(result.chars().next(), Some('a'));
    }

    #[test]
    fn take_last_chars_returns_full_text_when_under_limit() {
        let input = "用户偏好中文总结";

        let result = take_last_chars(input, FACT_EXTRACTION_CONVERSATION_MAX_CHARS);

        assert_eq!(result, input);
    }

    #[test]
    fn processed_outcome_marks_session_processed() {
        let outcome = FactExtractionOutcome::Processed(FactExtractionWriteSummary {
            extracted: 2,
            added: 1,
            updated: 1,
            noop: 0,
            failed: 0,
        });

        assert!(outcome.should_mark_processed());
    }

    #[test]
    fn write_summary_successful_count_includes_guarded_non_add_actions() {
        let summary = FactExtractionWriteSummary {
            extracted: 3,
            added: 1,
            updated: 1,
            noop: 1,
            failed: 0,
        };

        assert_eq!(summary.successful_count(), 3);
    }
}
