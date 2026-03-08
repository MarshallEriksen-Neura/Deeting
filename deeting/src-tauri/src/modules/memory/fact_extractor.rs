use std::sync::Arc;

use crate::modules::memory::service::MemoryService;
use crate::modules::memory::types::CreateLocalMemoryRequest;
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

const FACT_EXTRACTION_MAX_TOKENS: u32 = 512;

/// Extract user facts from a conversation and store them as memories.
///
/// This is a fire-and-forget operation — errors are logged but never propagated.
pub async fn extract_and_store_facts(
    app_state: &AppState,
    memory_service: Arc<MemoryService>,
    provider_model_id: &str,
    model_id: &str,
    conversation_text: &str,
    session_id: &str,
    assistant_id: Option<&str>,
) {
    let trimmed = conversation_text.trim();
    if trimmed.is_empty() || trimmed.len() < 50 {
        return;
    }

    // Truncate very long conversations to avoid token limits
    let truncated = if trimmed.len() > 4000 {
        &trimmed[trimmed.len() - 4000..]
    } else {
        trimmed
    };

    let prompt = FACT_EXTRACTION_PROMPT_TEMPLATE.replace("{conversation}", truncated);

    let extracted = match crate::modules::mcp::commands::request_local_auxiliary_text(
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
        Ok(None) => return,
        Err(e) => {
            log::warn!("fact extraction LLM call failed: {}", e);
            return;
        }
    };

    let facts = match parse_fact_array(&extracted) {
        Some(facts) => facts,
        None => {
            log::warn!("fact extraction: failed to parse response as JSON array");
            return;
        }
    };

    if facts.is_empty() {
        return;
    }

    log::info!("fact extraction: extracted {} facts from session {}", facts.len(), session_id);

    for fact in facts {
        let fact_trimmed = fact.trim().to_string();
        if fact_trimmed.is_empty() {
            continue;
        }

        let payload = CreateLocalMemoryRequest {
            content: fact_trimmed,
            session_id: Some(session_id.to_string()),
            assistant_id: assistant_id.map(|s| s.to_string()),
            meta_info: Some(serde_json::json!({ "source": "auto_extraction" })),
            category: Some("fact".to_string()),
            source: Some("auto_extraction".to_string()),
            tags: None,
        };

        if let Err(e) = memory_service.append(payload).await {
            log::warn!("fact extraction: failed to store fact: {}", e);
        }
    }
}

/// Parse a JSON array of strings from LLM output.
/// Handles markdown code blocks and whitespace.
fn parse_fact_array(raw: &str) -> Option<Vec<String>> {
    let cleaned = raw.trim();
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

    let parsed: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let arr = parsed.as_array()?;
    let facts: Vec<String> = arr
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .take(5)
        .collect();
    Some(facts)
}

#[cfg(test)]
mod tests {
    use super::parse_fact_array;

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
    fn caps_at_five_facts() {
        let input = r#"["a","b","c","d","e","f","g"]"#;
        let result = parse_fact_array(input).unwrap();
        assert_eq!(result.len(), 5);
    }
}
