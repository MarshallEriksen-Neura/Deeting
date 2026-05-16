//! Context routing policy for the Context Orchestrator.
//!
//! # No Double Lifecycle Rule
//!
//! This layer is allowed to:
//! - route evidence requests by `ContextSourceType`,
//! - decide whether a source surfaces as auto-injected core content,
//!   a manifest entry, a tool-only source, or any combination,
//! - record traces and emit envelope metadata,
//! - label coverage (empty / sparse / focused / broad).
//!
//! This layer is **forbidden** from:
//! - multiplying `item.score` by freshness, recency, vitality, or trust,
//! - reimplementing write-guard thresholds,
//! - downgrading older knowledge documents,
//! - introducing a second supersession algorithm.
//!
//! Lifecycle, vitality, and supersession remain owned by:
//! - `retrieval_kernel/lifecycle.rs`
//! - `retrieval_kernel/write_guard.rs`
//! - `retrieval_kernel/supersession.rs`
//! - source-native ranking inside `memory`, `knowledge`, and `llm_wiki`.
//!
//! When in doubt: route, don't rescore.

use crate::modules::desktop_runtime::context_orchestrator::envelope::{
    ContextEvidenceEnvelope, ContextSourceType,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextInjectionMode {
    CoreOnly,
    ManifestOnly,
    ManifestAndTools,
    ToolOnly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextSourcePolicy {
    pub source_type: ContextSourceType,
    pub injection_mode: ContextInjectionMode,
    pub score_semantics: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextRoutingPolicy {
    sources: Vec<ContextSourcePolicy>,
}

impl Default for ContextRoutingPolicy {
    fn default() -> Self {
        Self {
            sources: vec![
                ContextSourcePolicy {
                    source_type: ContextSourceType::Memory,
                    injection_mode: ContextInjectionMode::CoreOnly,
                    score_semantics:
                        "source-native memory relevance after MemoryService lifecycle handling",
                },
                ContextSourcePolicy {
                    source_type: ContextSourceType::LlmWiki,
                    injection_mode: ContextInjectionMode::ManifestAndTools,
                    score_semantics: "source-native llm_wiki corpus relevance",
                },
                ContextSourcePolicy {
                    source_type: ContextSourceType::Knowledge,
                    injection_mode: ContextInjectionMode::ManifestOnly,
                    score_semantics: "source-native knowledge evidence relevance",
                },
            ],
        }
    }
}

impl ContextRoutingPolicy {
    pub fn source_policy(&self, source_type: ContextSourceType) -> Option<&ContextSourcePolicy> {
        self.sources
            .iter()
            .find(|policy| policy.source_type == source_type)
    }

    pub fn sources(&self) -> &[ContextSourcePolicy] {
        &self.sources
    }

    pub fn route_envelope(&self, envelope: ContextEvidenceEnvelope) -> ContextEvidenceEnvelope {
        // No Double Lifecycle Rule: this layer routes evidence but never applies
        // freshness, recency, vitality, trust, or supersession multipliers.
        envelope
    }

    pub fn allows_automatic_body_injection(&self, source_type: ContextSourceType) -> bool {
        matches!(
            self.source_policy(source_type)
                .map(|policy| policy.injection_mode),
            Some(ContextInjectionMode::CoreOnly)
        )
    }
}
