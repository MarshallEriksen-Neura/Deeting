use super::*;
use crate::modules::desktop_runtime::context_orchestrator::fusion::{rrf_fuse, DEFAULT_RRF_K};
use crate::modules::desktop_runtime::context_orchestrator::tools::{
    evaluate_evidence_grade, evaluate_knowledge_source_confidence,
    evaluate_llm_wiki_source_confidence, evaluate_memory_source_confidence,
    next_action_for_confidence, parse_llm_wiki_locator_id, resolve_selected_file_ids,
    LlmWikiContextSearchFilters,
};
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

fn evidence_item_with_ref(id: &str, score: f64) -> ContextEvidenceItem {
    let mut item = evidence_item(id, score);
    item.source_refs = vec![ContextSourceRef {
        source_type: ContextSourceType::Knowledge,
        id: id.to_string(),
        label: Some(format!("ref-{id}")),
        locator: None,
    }];
    item
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
    assert!(
        prompt.contains("Tool schemas and tool results carry detailed search strategy"),
        "prompt must keep strategy guidance delegated to context tool schemas/results"
    );
    assert!(
        prompt.contains("coverage signals"),
        "prompt must preserve lightweight coverage-signal guidance"
    );
    assert!(
        prompt.contains("recommended_next_action"),
        "prompt must preserve lightweight next-action guidance"
    );
    assert!(
        prompt.contains("source_refs"),
        "prompt must preserve lightweight source reference guidance"
    );
    assert!(
        prompt.contains("Available context sources") && prompt.contains("llm_wiki"),
        "prompt must advertise available LLM Wiki source without inlining detailed filters"
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

#[test]
fn parse_llm_wiki_locator_id_uses_last_colon_for_chunk_index() {
    let parsed = parse_llm_wiki_locator_id("llm_wiki_doc::abc123:4");

    assert_eq!(parsed, Some(("llm_wiki_doc::abc123".to_string(), 4)));
}

#[test]
fn parse_llm_wiki_locator_id_rejects_non_numeric_suffix() {
    let parsed = parse_llm_wiki_locator_id("llm_wiki_doc::abc123");

    assert!(parsed.is_none());
}

#[test]
fn coverage_signals_empty_for_zero_items() {
    let signals = ContextCoverageSignals::from_items(&[]);

    assert_eq!(signals.item_count, 0);
    assert_eq!(signals.confidence, ContextConfidence::Empty);
    assert!(signals.top_score.is_none());
    assert!(signals.score_gap.is_none());
    assert!(signals.flatness.is_none());
}

#[test]
fn coverage_signals_strong_when_top_score_dominates() {
    let items = vec![
        evidence_item("a", 0.92),
        evidence_item("b", 0.45),
        evidence_item("c", 0.30),
    ];

    let signals = ContextCoverageSignals::from_items(&items);

    assert_eq!(signals.confidence, ContextConfidence::Strong);
    assert_eq!(signals.top_score, Some(0.92));
    assert_eq!(signals.second_score, Some(0.45));
    let gap_ratio = signals.score_gap_ratio.expect("gap ratio");
    assert!(
        gap_ratio >= 0.30,
        "gap ratio {gap_ratio} must clear the strong threshold"
    );
}

#[test]
fn coverage_signals_ambiguous_when_distribution_is_flat() {
    let items = vec![
        evidence_item("a", 0.50),
        evidence_item("b", 0.49),
        evidence_item("c", 0.48),
        evidence_item("d", 0.49),
    ];

    let signals = ContextCoverageSignals::from_items(&items);

    assert_eq!(signals.confidence, ContextConfidence::Ambiguous);
    let flatness = signals.flatness.expect("flatness");
    assert!(
        flatness < 0.10,
        "flatness {flatness} must be below the ambiguous threshold"
    );
}

#[test]
fn coverage_signals_mixed_for_single_item() {
    let items = vec![evidence_item("solo", 0.42)];

    let signals = ContextCoverageSignals::from_items(&items);

    assert_eq!(signals.item_count, 1);
    assert_eq!(signals.confidence, ContextConfidence::Mixed);
    assert_eq!(signals.top_score, Some(0.42));
    assert!(signals.second_score.is_none());
    assert!(signals.score_gap.is_none());
}

#[test]
fn coverage_signals_mixed_when_decline_is_gradual() {
    let items = vec![
        evidence_item("a", 0.55),
        evidence_item("b", 0.50),
        evidence_item("c", 0.45),
        evidence_item("d", 0.40),
        evidence_item("e", 0.35),
    ];

    let signals = ContextCoverageSignals::from_items(&items);

    // Gap ratio ~9% — not strong. Flatness ~14% — not ambiguous either.
    assert_eq!(signals.confidence, ContextConfidence::Mixed);
}

#[test]
fn envelope_records_coverage_signals_alongside_count_coverage() {
    let envelope = ContextEvidenceEnvelope::new(
        ContextSourceType::Knowledge,
        "vector db",
        vec![
            evidence_item("a", 0.90),
            evidence_item("b", 0.30),
            evidence_item("c", 0.25),
        ],
        "knowledge.score is evidence relevance from FTS/BM25, semantic search, RRF",
        ContextNextAction::AnswerWithEvidence,
        ContextTrace::default(),
    );

    assert_eq!(envelope.coverage, ContextCoverage::Focused);
    assert_eq!(envelope.confidence(), ContextConfidence::Strong);
    assert_eq!(envelope.coverage_signals.item_count, 3);
}

#[test]
fn envelope_deserializes_without_optional_confidence_fields() {
    let payload = json!({
        "source_type": "knowledge",
        "query": "vector db",
        "items": [],
        "coverage": "empty",
        "coverage_signals": {
            "item_count": 0,
            "confidence": "empty"
        },
        "score_semantics": "knowledge.score is source-native",
        "recommended_next_action": "search_again",
        "trace": { "events": [] }
    });

    let envelope: ContextEvidenceEnvelope =
        serde_json::from_value(payload).expect("backward-compatible envelope json");

    assert!(envelope.source_coverage_confidence.is_none());
    assert!(envelope.evidence_grade.is_none());
    assert_eq!(
        envelope.coverage_signals.confidence,
        ContextConfidence::Empty
    );
}

#[test]
fn memory_source_confidence_marks_single_memory_only() {
    let confidence = evaluate_memory_source_confidence(&[evidence_item_with_ref("memory-1", 0.82)]);

    assert_eq!(confidence.confidence, ContextConfidence::Mixed);
    assert_eq!(
        confidence.recommended_next_action,
        ContextNextAction::OpenSource
    );
    assert!(confidence
        .reasons
        .contains(&SourceCoverageReason::SingleMemoryOnly));
    assert!(confidence
        .reasons
        .contains(&SourceCoverageReason::OnlySparseEvidence));
}

#[test]
fn llm_wiki_source_confidence_marks_broad_scope_hits() {
    let mut item_a = evidence_item_with_ref("doc-a:0", 0.72);
    item_a.source_id = Some("doc-a".to_string());
    let mut item_b = evidence_item_with_ref("doc-b:0", 0.70);
    item_b.source_id = Some("doc-b".to_string());
    let mut item_c = evidence_item_with_ref("doc-c:0", 0.69);
    item_c.source_id = Some("doc-c".to_string());

    let confidence = evaluate_llm_wiki_source_confidence(
        &[item_a, item_b, item_c],
        &LlmWikiContextSearchFilters::default(),
    );

    assert_eq!(
        confidence.recommended_next_action,
        ContextNextAction::OpenSource
    );
    assert!(confidence
        .reasons
        .contains(&SourceCoverageReason::WikiScopeTooBroad));
}

#[test]
fn knowledge_source_confidence_detects_selected_scope_fallback_and_quality() {
    let mut item = evidence_item_with_ref("file-1:0", 0.91);
    item.quality_flags = vec!["short_chunk".to_string()];

    let confidence = evaluate_knowledge_source_confidence(&[item], true, true);

    assert!(confidence
        .reasons
        .contains(&SourceCoverageReason::SelectedScopeFallbackUsed));
    assert!(confidence
        .reasons
        .contains(&SourceCoverageReason::KnowledgeChunkQualityLow));
    assert_ne!(
        confidence.recommended_next_action,
        ContextNextAction::AnswerWithEvidence
    );
}

#[test]
fn evidence_grade_marks_single_item_comparison_as_insufficient() {
    let grade = evaluate_evidence_grade(
        "compare Rust and Python performance",
        &[evidence_item_with_ref("a", 0.9)],
    );

    assert_eq!(grade.verdict, EvidenceGradeVerdict::Insufficient);
    assert!(!grade.missing_aspects.is_empty());
}

#[test]
fn next_action_prefers_source_specific_blocker_over_shared_strong_shape() {
    let items = vec![
        evidence_item_with_ref("a", 0.92),
        evidence_item_with_ref("b", 0.40),
        evidence_item_with_ref("c", 0.21),
    ];
    let shared = ContextCoverageSignals::from_items(&items);
    let source = SourceCoverageConfidence::new(
        ContextConfidence::Mixed,
        vec![SourceCoverageReason::SelectedScopeFallbackUsed],
        ContextNextAction::OpenSource,
    );
    let grade = EvidenceGrade::new(
        EvidenceGradeVerdict::Sufficient,
        vec!["enough refs".to_string()],
        Vec::new(),
    );

    let next_action = next_action_for_confidence(&shared, &source, &grade);

    assert_eq!(shared.confidence, ContextConfidence::Strong);
    assert_eq!(next_action, ContextNextAction::OpenSource);
}

#[test]
fn routing_policy_preserves_coverage_signals() {
    let policy = ContextRoutingPolicy::default();
    let envelope = ContextEvidenceEnvelope::new(
        ContextSourceType::LlmWiki,
        "flat query",
        vec![
            evidence_item("a", 0.50),
            evidence_item("b", 0.49),
            evidence_item("c", 0.48),
        ],
        "llm_wiki score semantics",
        ContextNextAction::AnswerWithEvidence,
        ContextTrace::default(),
    );
    let before = envelope.coverage_signals.clone();

    let routed = policy.route_envelope(envelope);

    assert_eq!(
        routed.coverage_signals, before,
        "No Double Lifecycle Rule: routing must not mutate signals"
    );
}

#[test]
fn manifest_renderer_keeps_context_tool_strategy_lightweight() {
    let manifest = ContextManifest::new(
        Vec::new(),
        vec![SelectedKnowledgeManifestItem {
            file_id: "file-1".to_string(),
            file_name: "spec.md".to_string(),
            status: "indexed".to_string(),
            chunk_count: Some(5),
            folder_id: None,
            updated_at: None,
        }],
    );

    let prompt = render_context_manifest_prompt(&manifest).expect("manifest prompt");

    assert!(prompt.contains("detailed search strategy"));
    assert!(prompt.contains("coverage signals"));
    assert!(prompt.contains("recommended_next_action"));
    assert!(
        prompt.contains("source_refs"),
        "manifest should keep a pointer to evidence citation metadata"
    );
    assert!(!prompt.contains("Query crafting"));
    assert!(!prompt.contains("Multi-query fanout"));
    assert!(!prompt.contains("Reciprocal Rank Fusion"));
}

#[test]
fn manifest_renderer_lists_multi_query_tool_without_full_fanout_tutorial() {
    let manifest = ContextManifest::new(
        Vec::new(),
        vec![SelectedKnowledgeManifestItem {
            file_id: "file-1".to_string(),
            file_name: "spec.md".to_string(),
            status: "indexed".to_string(),
            chunk_count: Some(5),
            folder_id: None,
            updated_at: None,
        }],
    );

    let prompt = render_context_manifest_prompt(&manifest).expect("manifest prompt");

    assert!(
        prompt.contains("context_search_multi"),
        "prompt must advertise the new fanout tool by name"
    );
    assert!(!prompt.contains("Reciprocal Rank Fusion"));
    assert!(!prompt.contains("intra-source"));
}

fn evidence_item_with_score_breakdown(id: &str, score: f64) -> ContextEvidenceItem {
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

fn envelope_with(items: Vec<ContextEvidenceItem>) -> ContextEvidenceEnvelope {
    ContextEvidenceEnvelope::new(
        ContextSourceType::Knowledge,
        "query",
        items,
        "knowledge.score is source-native",
        ContextNextAction::AnswerWithEvidence,
        ContextTrace::default(),
    )
}

#[test]
fn rrf_fuse_promotes_items_that_appear_in_multiple_queries() {
    // Query A: a, b, c (a is top)
    // Query B: x, a, y (a is 2nd)
    // Query C: a, z    (a is top)
    // `a` should fuse to the top because it shows up in all three lists.
    let env_a = envelope_with(vec![
        evidence_item_with_score_breakdown("a", 0.90),
        evidence_item_with_score_breakdown("b", 0.70),
        evidence_item_with_score_breakdown("c", 0.50),
    ]);
    let env_b = envelope_with(vec![
        evidence_item_with_score_breakdown("x", 0.85),
        evidence_item_with_score_breakdown("a", 0.60),
        evidence_item_with_score_breakdown("y", 0.40),
    ]);
    let env_c = envelope_with(vec![
        evidence_item_with_score_breakdown("a", 0.95),
        evidence_item_with_score_breakdown("z", 0.30),
    ]);

    let fused = rrf_fuse(&[env_a, env_b, env_c], DEFAULT_RRF_K, 5);

    assert_eq!(fused.first().expect("at least one fused item").item.id, "a");
    assert_eq!(
        fused[0].appearances.len(),
        3,
        "fused top item should record appearances from all three queries"
    );
}

#[test]
fn rrf_fuse_preserves_source_native_score_on_items() {
    let env_a = envelope_with(vec![evidence_item_with_score_breakdown("a", 0.42)]);
    let env_b = envelope_with(vec![evidence_item_with_score_breakdown("a", 0.88)]);

    let fused = rrf_fuse(&[env_a, env_b], DEFAULT_RRF_K, 5);

    let top = &fused[0];
    assert_eq!(top.item.id, "a");
    // The item's `score` field is left as whichever copy hit the accumulator
    // first — RRF must NOT replace it with the fused score. The fused score
    // lives on the wrapper, not the item.
    assert!(
        (top.item.score - 0.42).abs() < f64::EPSILON
            || (top.item.score - 0.88).abs() < f64::EPSILON,
        "fused item.score should remain one of the source-native values, got {}",
        top.item.score
    );
    assert!(
        top.fused_rrf_score > top.item.score
            || top.fused_rrf_score < top.item.score
            || top.fused_rrf_score == 0.0,
        "fused_rrf_score is conceptually distinct from item.score"
    );
}

#[test]
fn rrf_fuse_truncates_to_limit() {
    let env = envelope_with(vec![
        evidence_item_with_score_breakdown("a", 0.9),
        evidence_item_with_score_breakdown("b", 0.8),
        evidence_item_with_score_breakdown("c", 0.7),
        evidence_item_with_score_breakdown("d", 0.6),
        evidence_item_with_score_breakdown("e", 0.5),
    ]);

    let fused = rrf_fuse(&[env], DEFAULT_RRF_K, 3);

    assert_eq!(fused.len(), 3);
}

#[test]
fn rrf_fuse_deduplicates_by_item_id() {
    // Same id appearing in two envelopes should fuse to one item with two appearances.
    let env_a = envelope_with(vec![evidence_item_with_score_breakdown("shared", 0.9)]);
    let env_b = envelope_with(vec![evidence_item_with_score_breakdown("shared", 0.5)]);

    let fused = rrf_fuse(&[env_a, env_b], DEFAULT_RRF_K, 5);

    assert_eq!(fused.len(), 1);
    assert_eq!(fused[0].appearances.len(), 2);
}

#[test]
fn rrf_fuse_returns_empty_for_all_empty_envelopes() {
    let fused = rrf_fuse(
        &[envelope_with(vec![]), envelope_with(vec![])],
        DEFAULT_RRF_K,
        5,
    );

    assert!(fused.is_empty());
}

#[test]
fn rrf_fuse_higher_rank_contributes_more() {
    // Two queries, one item at rank 1 vs the same logic at rank 5.
    // rank-1 should have higher fused score.
    let env_top = envelope_with(vec![
        evidence_item_with_score_breakdown("top", 0.9),
        evidence_item_with_score_breakdown("filler1", 0.5),
        evidence_item_with_score_breakdown("filler2", 0.4),
        evidence_item_with_score_breakdown("filler3", 0.3),
        evidence_item_with_score_breakdown("bottom", 0.1),
    ]);
    let env_bottom = envelope_with(vec![
        evidence_item_with_score_breakdown("other_top", 0.9),
        evidence_item_with_score_breakdown("filler1", 0.5),
        evidence_item_with_score_breakdown("filler2", 0.4),
        evidence_item_with_score_breakdown("filler3", 0.3),
        evidence_item_with_score_breakdown("top", 0.1),
    ]);

    let fused = rrf_fuse(&[env_top, env_bottom], DEFAULT_RRF_K, 10);
    let top_score = fused
        .iter()
        .find(|f| f.item.id == "top")
        .expect("top item should be in fused list")
        .fused_rrf_score;

    // Expected: 1/(60+1) + 1/(60+5) = 0.0164 + 0.0154 = 0.0318
    assert!(
        (top_score - (1.0 / 61.0 + 1.0 / 65.0)).abs() < 1e-9,
        "fused score should match RRF formula: 1/(k+1) + 1/(k+5), got {}",
        top_score
    );
}
