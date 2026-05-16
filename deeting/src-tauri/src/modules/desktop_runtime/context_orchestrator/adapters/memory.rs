//! Memory source adapter for the Context Orchestrator.
//!
//! No Double Lifecycle Rule: this adapter exposes scores produced by
//! `MemoryService::search`, which already apply lifecycle, vitality, and
//! supersession reranking. Do not rescale, decay, or recompute those scores
//! inside this adapter — that ownership belongs to MemoryService and the
//! `retrieval_kernel` lifecycle/write_guard/supersession modules.

use crate::modules::desktop_runtime::context_orchestrator::adapters::ContextSourceAdapter;
use crate::modules::desktop_runtime::context_orchestrator::envelope::ContextSourceType;

#[derive(Debug, Clone, Copy, Default)]
pub struct MemoryContextAdapter;

impl ContextSourceAdapter for MemoryContextAdapter {
    fn source_type(&self) -> ContextSourceType {
        ContextSourceType::Memory
    }

    fn score_semantics(&self) -> &'static str {
        "memory.score is semantic relevance after MemoryService lifecycle/vitality/supersession handling"
    }
}
