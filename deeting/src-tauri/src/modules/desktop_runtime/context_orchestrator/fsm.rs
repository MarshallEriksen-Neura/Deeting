use serde::{Deserialize, Serialize};

use crate::modules::desktop_runtime::context_orchestrator::envelope::ContextSourceType;
use crate::modules::desktop_runtime::context_orchestrator::policy::ContextRoutingPolicy;
use crate::modules::desktop_runtime::context_orchestrator::trace::ContextTrace;

pub const CONTEXT_TOOL_NAMES: &[&str] = &[
    "context_search",
    "context_search_multi",
    "context_open",
    "context_expand",
    "context_summarize_evidence",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextOrchestratorState {
    BuildManifest,
    ClassifyNeed,
    PlanSources,
    Retrieve,
    EvaluateCoverage,
    ExpandIfNeeded,
    CompressIfNeeded,
    EmitBundle,
    RecordTrace,
}

#[derive(Debug, Clone)]
pub struct ContextOrchestrator {
    pub policy: ContextRoutingPolicy,
}

impl Default for ContextOrchestrator {
    fn default() -> Self {
        Self {
            policy: ContextRoutingPolicy::default(),
        }
    }
}

impl ContextOrchestrator {
    pub fn trace_for_manifest(
        &self,
        trace_id: Option<String>,
        manifest: &ContextManifest,
    ) -> ContextTrace {
        ContextTrace::new(trace_id).record(
            "build_manifest",
            serde_json::json!({
                "core_memory_count": manifest.core_memories.len(),
                "selected_knowledge_count": manifest.selected_knowledge.len(),
                "available_sources": manifest
                    .available_sources
                    .iter()
                    .map(|source| source.as_str())
                    .collect::<Vec<_>>(),
                "available_tools": manifest.available_tools,
            }),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectedKnowledgeManifestItem {
    pub file_id: String,
    pub file_name: String,
    pub status: String,
    pub chunk_count: Option<i64>,
    pub folder_id: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextManifest {
    pub core_memories: Vec<String>,
    pub selected_knowledge: Vec<SelectedKnowledgeManifestItem>,
    pub available_sources: Vec<ContextSourceType>,
    pub available_tools: Vec<String>,
}

impl ContextManifest {
    pub fn new(
        core_memories: Vec<String>,
        selected_knowledge: Vec<SelectedKnowledgeManifestItem>,
    ) -> Self {
        Self {
            core_memories,
            selected_knowledge,
            available_sources: vec![
                ContextSourceType::Memory,
                ContextSourceType::LlmWiki,
                ContextSourceType::Knowledge,
            ],
            available_tools: CONTEXT_TOOL_NAMES
                .iter()
                .map(|tool| (*tool).to_string())
                .collect(),
        }
    }
}

pub fn render_context_manifest_prompt(manifest: &ContextManifest) -> Option<String> {
    if manifest.core_memories.is_empty()
        && manifest.selected_knowledge.is_empty()
        && manifest.available_tools.is_empty()
    {
        return None;
    }

    let mut lines = vec![
        "## Context Manifest".to_string(),
        "Use this manifest to decide whether to call context tools. It lists available sources but does not include retrieved knowledge chunks.".to_string(),
    ];

    if !manifest.core_memories.is_empty() {
        lines.push("### Core Memories".to_string());
        for memory in &manifest.core_memories {
            let trimmed = memory.trim();
            if !trimmed.is_empty() {
                lines.push(format!("- {trimmed}"));
            }
        }
    }

    if !manifest.selected_knowledge.is_empty() {
        lines.push("### Selected Knowledge Files".to_string());
        for item in &manifest.selected_knowledge {
            let chunk_count = item
                .chunk_count
                .map(|count| count.max(0).to_string())
                .unwrap_or_else(|| "unknown".to_string());
            lines.push(format!(
                "- {} (file_id: {}, status: {}, chunks: {})",
                item.file_name, item.file_id, item.status, chunk_count
            ));
        }
        lines.push("Open or search selected knowledge through context tools before using document evidence.".to_string());
        let selected_file_ids_inline = manifest
            .selected_knowledge
            .iter()
            .map(|item| format!("\"{}\"", item.file_id))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!(
            "To search inside these selected files, call `context_search` with `scope: \"selected\"` and `filters.selected_file_ids: [{selected_file_ids_inline}]`. If `selected_file_ids` is omitted in selected scope, the runtime falls back to the files listed here."
        ));
        lines.push(
            "To open a specific chunk, call `context_open` with `source_type: \"knowledge\"`, `file_id`, and optional `chunk_index`.".to_string(),
        );
    }

    if !manifest.available_sources.is_empty() {
        let sources = manifest
            .available_sources
            .iter()
            .map(|source| source.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("Available context sources: {sources}."));
    }

    if !manifest.available_tools.is_empty() {
        lines.push(format!(
            "Available context tools: {}.",
            manifest.available_tools.join(", ")
        ));
        lines.push("Context tool strategy: search before using document or wiki evidence; open the strongest hit before citing it; expand when adjacent chunks are needed; summarize only to reduce already-returned evidence.".to_string());
        lines.push("Query crafting: before calling `context_search`, rewrite the user's wording into a search-friendly form — replace pronouns with specific entities, expand acronyms or jargon, and split multi-intent questions into separate targeted queries. When you rewrite, pass `original_query`, `rewritten_query`, `rewrite_reason`, and increment `search_attempt` so the runtime trace can explain why this search happened. Vague queries usually return `coverage_signals.confidence: ambiguous` envelopes that force a re-search anyway, so spend the effort up front.".to_string());
        lines.push("Multi-query fanout: when one query is unlikely to capture all relevant evidence (broad topics, synonyms, term ambiguity) OR when an earlier `context_search` returned `coverage_signals.confidence: ambiguous`, call `context_search_multi` with 2-5 semantically distinct rewrites of the same intent. The runtime concurrently retrieves from one source per query and merges results via Reciprocal Rank Fusion. Pick rewrites that differ in vocabulary or perspective, not surface paraphrases. Fanout is intra-source only — choose `source: memory | llm_wiki | knowledge`, not auto.".to_string());
        lines.push("Source-local filters: memory supports filters.session_id, capability_id, category, source, tags; llm_wiki supports filters.scope, doc_id, relative_path, relative_path_prefix; knowledge supports filters.selected_file_ids/file_ids for selected document search.".to_string());
        lines.push("Evidence envelopes include a `coverage_signals` object describing the score distribution. Read `coverage_signals.confidence` before acting:".to_string());
        lines.push("- `strong`: the top hit clearly dominates; answer with that evidence and cite source_refs.".to_string());
        lines.push("- `ambiguous`: hits are similarly scored, which usually means the query is too generic — call `context_search` again with a more specific or technical reformulation instead of answering from these hits.".to_string());
        lines.push("- `mixed`: results are sparse or middling; consider `context_expand` for neighbors or `context_open` on the top hit before deciding to answer.".to_string());
        lines.push("- `empty`: nothing matched; try a different query, switch sources, or ask the user a clarifying question instead of guessing.".to_string());
        lines.push("Evidence envelopes may also include `source_coverage_confidence` and `evidence_grade`. Treat those as higher-level safety signals above shared score shape: if source-specific reasons say the wiki scope is broad, selected knowledge fallback was used, chunk quality is low, or only a single memory supports the claim, follow that recommendation even when `coverage_signals.confidence` looks strong.".to_string());
        lines.push("Also respect `recommended_next_action` — when it says `search_again`, `open_source`, or `expand_context`, do not answer from the current evidence until you do that follow-up.".to_string());
        lines.push("Grounded answering rule: when answering from context evidence, cite matching `source_refs`. If `evidence_grade.verdict` is `partial` or `insufficient`, or if source refs are missing, search again / open the source / expand context instead of presenting unsupported certainty.".to_string());
    }

    Some(lines.join("\n"))
}
