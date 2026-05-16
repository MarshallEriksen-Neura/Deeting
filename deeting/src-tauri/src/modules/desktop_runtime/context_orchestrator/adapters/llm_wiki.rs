//! LLM Wiki corpus source adapter for the Context Orchestrator.
//!
//! No Double Lifecycle Rule: corpus scores come from the existing
//! `search_local_llm_wiki_corpus` pipeline (lexical + semantic + final).
//! This adapter must not apply freshness, recency, or trust multipliers on
//! top of those scores — ranking ownership stays with the `llm_wiki` module.

use crate::modules::desktop_runtime::context_orchestrator::adapters::ContextSourceAdapter;
use crate::modules::desktop_runtime::context_orchestrator::envelope::ContextSourceType;

#[derive(Debug, Clone, Copy, Default)]
pub struct LlmWikiContextAdapter;

impl ContextSourceAdapter for LlmWikiContextAdapter {
    fn source_type(&self) -> ContextSourceType {
        ContextSourceType::LlmWiki
    }

    fn score_semantics(&self) -> &'static str {
        "llm_wiki.score is corpus lexical and semantic relevance from llm_wiki search"
    }
}
