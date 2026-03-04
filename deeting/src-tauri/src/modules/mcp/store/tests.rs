use super::helpers::{
    compute_local_knowledge_match_score, extract_local_document_text,
    split_local_document_text_into_chunks, tokenize_local_search_query,
    truncate_local_document_error_message,
};

#[test]
fn extract_local_document_text_prefers_raw_text() {
    let meta = serde_json::json!({
        "text": "secondary",
        "raw_text": "primary"
    });
    let extracted = extract_local_document_text(&meta).expect("text should exist");
    assert_eq!(extracted, "primary");
}

#[test]
fn extract_local_document_text_falls_back_to_chunks() {
    let meta = serde_json::json!({
        "chunks": ["first", " ", "second"]
    });
    let extracted = extract_local_document_text(&meta).expect("text should exist");
    assert_eq!(extracted, "first\n\nsecond");
}

#[test]
fn split_local_document_text_into_chunks_splits_long_text() {
    let source = "abc ".repeat(2000);
    let chunks = split_local_document_text_into_chunks(&source);
    assert!(chunks.len() > 1);
    assert!(chunks.iter().all(|chunk| !chunk.trim().is_empty()));
}

#[test]
fn split_local_document_text_into_chunks_keeps_short_text() {
    let chunks = split_local_document_text_into_chunks("short text");
    assert_eq!(chunks, vec!["short text".to_string()]);
}

#[test]
fn truncate_local_document_error_message_limits_length() {
    let source = "x".repeat(500);
    let truncated = truncate_local_document_error_message(&source);
    assert_eq!(truncated.chars().count(), 300);
}

#[test]
fn tokenize_local_search_query_extracts_terms() {
    let tokens = tokenize_local_search_query("How to deploy Rust service?");
    assert!(tokens.contains(&"how".to_string()));
    assert!(tokens.contains(&"deploy".to_string()));
    assert!(tokens.contains(&"rust".to_string()));
    assert!(tokens.contains(&"service".to_string()));
}

#[test]
fn compute_local_knowledge_match_score_prefers_phrase_match() {
    let query = "deploy rust service";
    let tokens = tokenize_local_search_query(query);
    let strong = compute_local_knowledge_match_score(
        query,
        &tokens,
        "how to deploy rust service to production",
    );
    let weak = compute_local_knowledge_match_score(query, &tokens, "rust notes and tricks");
    assert!(strong > weak);
}
