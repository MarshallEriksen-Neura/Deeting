//! Knowledge source adapter for the Context Orchestrator.
//!
//! No Double Lifecycle Rule: knowledge evidence scores come from the
//! existing FTS/BM25 lexical path, semantic search, chunk quality flags, and
//! reciprocal rank fusion inside `KnowledgeStore`. This adapter must not
//! re-decay older documents, re-fuse hits, or rescale scores — ranking
//! ownership stays with the `knowledge` module.

use crate::modules::desktop_runtime::context_orchestrator::adapters::ContextSourceAdapter;
use crate::modules::desktop_runtime::context_orchestrator::envelope::ContextSourceType;

#[derive(Debug, Clone, Copy, Default)]
pub struct KnowledgeContextAdapter;

impl ContextSourceAdapter for KnowledgeContextAdapter {
    fn source_type(&self) -> ContextSourceType {
        ContextSourceType::Knowledge
    }

    fn score_semantics(&self) -> &'static str {
        "knowledge.score is evidence relevance from FTS/BM25, semantic search, chunk quality, and RRF fusion"
    }
}
