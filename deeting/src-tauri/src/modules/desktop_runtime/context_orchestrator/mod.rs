pub mod adapters;
pub mod envelope;
pub mod fsm;
pub mod fusion;
pub mod policy;
pub mod tools;
pub mod trace;

pub use envelope::{
    ContextConfidence, ContextCoverage, ContextCoverageSignals, ContextEvidenceEnvelope,
    ContextEvidenceItem, ContextNextAction, ContextSourceRef, ContextSourceType,
};
pub use fsm::{
    render_context_manifest_prompt, ContextManifest, ContextOrchestrator, ContextOrchestratorState,
    SelectedKnowledgeManifestItem, CONTEXT_TOOL_NAMES,
};
pub use policy::{ContextInjectionMode, ContextRoutingPolicy, ContextSourcePolicy};
pub use tools::{execute_context_tool, is_context_tool};
pub use trace::{ContextTrace, ContextTraceEvent};

#[cfg(test)]
mod tests;
