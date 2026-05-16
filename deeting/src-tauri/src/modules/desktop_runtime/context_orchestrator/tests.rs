use super::*;
use crate::modules::desktop_runtime::context_orchestrator::tools::resolve_selected_file_ids;
use serde_json::json;

fn evidence_item(id: &str, score: f64) -> ContextEvidenceItem {
    ContextEvidenceItem {
        id: id.to_string(),
        source_id: None,
        title: None,
        content: format!("evidence {id}"),
        score,
        score_breakdown: json!({ "source_score": score }),
        source_refs: vec![],
        quality_flags: vec![],
        lifecycle: None,
    }
}

#[test]
fn routing_policy_preserves_source_scores() {
    let policy = ContextRoutingPolicy::default();
    let envelope = ContextEvidenceEnvelope::new(
        ContextSourceType::Memory,
        "where do I live",
        vec![evidence_item("a", 0.91), evidence_item("b", 0.42)],
        "memory score already reranked by MemoryService",
        ContextNextAction::AnswerWithEvidence,
        ContextTrace::default(),
    );
    let before = envelope.source_scores();

    let routed = policy.route_envelope(envelope);

    assert_eq!(routed.source_scores(), before);
}

#[test]
fn default_policy_routes_sources_without_body_chunk_injection() {
    let policy = ContextRoutingPolicy::default();

    assert_eq!(
        policy
            .source_policy(ContextSourceType::Memory)
            .map(|source| source.injection_mode),
        Some(ContextInjectionMode::CoreOnly)
    );
    assert_eq!(
        policy
            .source_policy(ContextSourceType::Knowledge)
            .map(|source| source.injection_mode),
        Some(ContextInjectionMode::ManifestOnly)
    );
    assert_eq!(
        policy
            .source_policy(ContextSourceType::LlmWiki)
            .map(|source| source.injection_mode),
        Some(ContextInjectionMode::ManifestAndTools)
    );
    assert!(!policy.allows_automatic_body_injection(ContextSourceType::Knowledge));
    assert!(!policy.allows_automatic_body_injection(ContextSourceType::LlmWiki));
}

#[test]
fn manifest_renderer_lists_selected_files_without_chunks() {
    let manifest = ContextManifest::new(
        vec!["Always use Simplified Chinese.".to_string()],
        vec![SelectedKnowledgeManifestItem {
            file_id: "file-1".to_string(),
            file_name: "roadmap.md".to_string(),
            status: "indexed".to_string(),
            chunk_count: Some(12),
            folder_id: None,
            updated_at: Some("2026-05-16T00:00:00Z".to_string()),
        }],
    );

    let prompt = render_context_manifest_prompt(&manifest).expect("manifest prompt");

    assert!(prompt.contains("## Context Manifest"));
    assert!(prompt.contains("Always use Simplified Chinese."));
    assert!(prompt.contains("roadmap.md"));
    assert!(prompt.contains("context_search"));
    assert!(!prompt.contains("Selected Document Excerpts"));
    assert!(!prompt.contains("secret chunk body"));
}

#[test]
fn manifest_renderer_includes_selected_scope_invocation_instruction() {
    let manifest = ContextManifest::new(
        Vec::new(),
        vec![
            SelectedKnowledgeManifestItem {
                file_id: "file-1".to_string(),
                file_name: "alpha.md".to_string(),
                status: "indexed".to_string(),
                chunk_count: Some(3),
                folder_id: None,
                updated_at: None,
            },
            SelectedKnowledgeManifestItem {
                file_id: "file-2".to_string(),
                file_name: "beta.md".to_string(),
                status: "indexed".to_string(),
                chunk_count: Some(4),
                folder_id: None,
                updated_at: None,
            },
        ],
    );

    let prompt = render_context_manifest_prompt(&manifest).expect("manifest prompt");

    assert!(
        prompt.contains("scope: \"selected\""),
        "prompt must teach the model how to call context_search with selected scope"
    );
    assert!(
        prompt.contains("filters.selected_file_ids"),
        "prompt must reference the filters key for selected scope"
    );
    assert!(
        prompt.contains("\"file-1\""),
        "prompt must inline file ids from the manifest"
    );
    assert!(
        prompt.contains("\"file-2\""),
        "prompt must inline every selected file id"
    );
    assert!(
        prompt.contains("falls back"),
        "prompt must advertise the runtime fallback behavior"
    );
    assert!(
        prompt.contains("context_open"),
        "prompt must mention context_open for opening specific chunks"
    );
}

#[test]
fn context_tool_name_guard_accepts_only_context_tools() {
    assert!(is_context_tool("context_search"));
    assert!(is_context_tool("context_open"));
    assert!(is_context_tool("context_expand"));
    assert!(is_context_tool("context_summarize_evidence"));
    assert!(!is_context_tool("search_sdk"));
}

#[test]
fn resolve_selected_file_ids_prefers_filter_ids_when_present() {
    let resolved = resolve_selected_file_ids(
        vec!["filter-1".to_string(), "filter-2".to_string()],
        &["ctx-1".to_string(), "ctx-2".to_string()],
        true,
    );

    assert_eq!(
        resolved,
        vec!["filter-1".to_string(), "filter-2".to_string()],
        "explicit filter ids must win over the context fallback"
    );
}

#[test]
fn resolve_selected_file_ids_falls_back_to_context_when_selected_scope_and_filter_empty() {
    let resolved = resolve_selected_file_ids(
        Vec::new(),
        &["ctx-1".to_string(), " ctx-2 ".to_string(), "".to_string()],
        true,
    );

    assert_eq!(
        resolved,
        vec!["ctx-1".to_string(), "ctx-2".to_string()],
        "selected scope without filter ids must fall back to context ids, trimmed and non-empty"
    );
}

#[test]
fn resolve_selected_file_ids_returns_empty_when_not_selected_scope_and_filter_empty() {
    let resolved = resolve_selected_file_ids(Vec::new(), &["ctx-1".to_string()], false);

    assert!(
        resolved.is_empty(),
        "non-selected scope must not implicitly scope to context-provided ids"
    );
}
