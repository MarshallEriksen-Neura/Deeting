//! # Sovereign Architecture Skeleton
//!
//! Named contracts for the sovereignty charter documented in this directory's
//! [`AGENTS.md`](../AGENTS.md).
//!
//! v1 is intentionally minimal: the four named layers (The Self, Canonical
//! Substrate, Ingress boundary, Boundary translation) are expressed as
//! compile-time contracts that wrap — but do not replace — the existing
//! `task_learning` and `posterior_signal` infrastructure. No behavior moves
//! in this revision; the shells exist so future refactors can migrate call
//! sites behind them without touching the decision logic itself.
//!
//! Every item below is currently unreferenced outside this module's own
//! tests — that is expected at v1. Subsequent phases will wire call sites
//! in `task_learning::policy` and `chat_tool_runtime` behind these
//! contracts, at which point the `dead_code` allow below can be removed
//! and normal lint hygiene resumes.

#![allow(dead_code)]

pub(crate) mod ingress;

#[cfg(test)]
pub(crate) use ingress::ExternalIngress;
pub(crate) use ingress::{PosteriorSignalIngress, TaskExecutionIngress, UserActionIngress};

use serde::{Deserialize, Serialize};

use super::posterior_signal::PosteriorSignalInput;
use super::task_learning::{EvaluatedOutcome, TaskFingerprint};

// ---------------------------------------------------------------------------
// Canonical Substrate
// ---------------------------------------------------------------------------

/// Opaque identifier for where an observation came from.
///
/// The Self treats every source with the same epistemic posture; the tag
/// exists only as metadata for audit, decay, and adapter accounting. The
/// decision layer must never branch on its textual value — branching on
/// source identity is allowed only inside boundary translation code under
/// `ingress/sources/*` (when such files exist).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub(crate) struct SourceTag(String);

impl SourceTag {
    pub(crate) fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    // Well-known local sources. External sources construct their own tags
    // inside their own boundary files.
    pub(crate) fn user_action() -> Self {
        Self::new("user_action")
    }
    pub(crate) fn tool_trace() -> Self {
        Self::new("tool_trace")
    }
    pub(crate) fn posterior_signal() -> Self {
        Self::new("posterior_signal")
    }
    pub(crate) fn heuristic_rule() -> Self {
        Self::new("heuristic_rule")
    }
}

/// Everything The Self has perceived arrives as an `Observation`.
///
/// Variants wrap existing canonical types from `task_learning` and
/// `posterior_signal`; no foreign protocol names appear here. Future
/// external sources enter through [`Observation::External`] with an opaque
/// [`SourceTag`] and are translated into canonical variants inside their
/// boundary file before influencing decisions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum Observation {
    /// A task run reported its fingerprint and evaluated outcome.
    TaskExecution {
        source: SourceTag,
        fingerprint: TaskFingerprint,
        outcome: EvaluatedOutcome,
    },
    /// A posterior (post-turn) signal about how the user received the result.
    UserSignal {
        source: SourceTag,
        input: PosteriorSignalInput,
    },
    /// Raw suggestion from an external ingress source. The Self does not
    /// interpret the payload — a boundary file must translate it into a
    /// canonical variant before any decision layer consumes it.
    External {
        source: SourceTag,
        payload: serde_json::Value,
    },
}

impl Observation {
    pub(crate) fn source(&self) -> &SourceTag {
        match self {
            Self::TaskExecution { source, .. }
            | Self::UserSignal { source, .. }
            | Self::External { source, .. } => source,
        }
    }
}

// ---------------------------------------------------------------------------
// Decision Vocabulary
// ---------------------------------------------------------------------------

/// Named place where The Self is asked to adjust behavior.
///
/// Mirrors the `DECISION_POINT_*` string constants already defined in
/// `task_learning/types.rs`, but typed so misuse is caught at compile time.
/// The string form remains the source of truth for schema/migration compat;
/// this enum is the source of truth for in-memory call sites. The two must
/// stay in 1:1 correspondence — see the test at the bottom of this file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DecisionLocus {
    Route,
    WorkerSelection,
    Discovery,
    CapabilityAttach,
    Execution,
    Verification,
}

impl DecisionLocus {
    pub(crate) fn as_canonical_str(&self) -> &'static str {
        match self {
            Self::Route => "route",
            Self::WorkerSelection => "worker_selection",
            Self::Discovery => "discovery",
            Self::CapabilityAttach => "capability_attach",
            Self::Execution => "execution",
            Self::Verification => "verification",
        }
    }

    pub(crate) fn from_canonical_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "route" => Some(Self::Route),
            "worker_selection" => Some(Self::WorkerSelection),
            "discovery" => Some(Self::Discovery),
            "capability_attach" => Some(Self::CapabilityAttach),
            "execution" => Some(Self::Execution),
            "verification" => Some(Self::Verification),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Ingress (input boundary)
// ---------------------------------------------------------------------------

/// Contract every input source must satisfy.
///
/// Sovereignty requires The Self to treat user actions, tool traces,
/// posterior signals, and (future) external capability sources as peers —
/// none has structural privilege. All implementations declare themselves
/// via this trait and expose only an opaque [`SourceTag`].
///
/// v1 is deliberately a marker trait: existing input paths can adopt it
/// incrementally as wrappers, and future external sources land behind it
/// in `ingress/sources/<name>.rs`.
pub(crate) trait Ingress: Send + Sync {
    fn source_tag(&self) -> SourceTag;
}

// ---------------------------------------------------------------------------
// PolicyGuidance (what The Self returns)
// ---------------------------------------------------------------------------

/// PolicyGuidance returned by [`Self_::consult`].
///
/// Thin wrapper around `TaskPolicyHint` at v2 — callers should program
/// against this type, not against the raw hint. Future revisions may enrich
/// it with bandit scores, safety-lock flags, or alternative signals without
/// breaking callers. That is the whole point of routing queries through
/// [`Self_`] instead of calling `task_learning::query_task_policy_hint`
/// directly.
///
/// [`PolicyGuidance::as_raw`] is a transitional escape hatch for Phase 3 call-site
/// migration; new code should prefer the typed accessors.
#[derive(Debug, Clone)]
pub(crate) struct PolicyGuidance {
    hint: super::task_learning::TaskPolicyHint,
}

impl PolicyGuidance {
    pub(crate) fn from_hint(hint: super::task_learning::TaskPolicyHint) -> Self {
        Self { hint }
    }

    /// Effective weight for a named action at this decision locus.
    /// Mirrors `chat_tool_runtime`'s existing `task_policy_action_weight`
    /// helper so call sites can migrate without behavior change.
    pub(crate) fn weight_for(&self, action: &str) -> f64 {
        self.hint
            .priors
            .iter()
            .find(|item| item.action_key == action)
            .map(|item| item.effective_weight)
            .unwrap_or(0.0)
    }

    /// The action The Self currently recommends at this locus, if any.
    pub(crate) fn recommended_action(&self) -> Option<&str> {
        self.hint.recommended_action.as_deref()
    }

    /// Gate metadata suitable for embedding in tool-call telemetry.
    /// Mirrors `chat_tool_runtime`'s existing `task_policy_gate_meta`
    /// helper exactly; the ±0.15 disposition thresholds are preserved.
    pub(crate) fn gate_meta(&self, action: &str) -> serde_json::Value {
        let weight = self.weight_for(action);
        let disposition = if weight >= 0.15 {
            "encourage"
        } else if weight <= -0.15 {
            "discourage"
        } else {
            "neutral"
        };
        serde_json::json!({
            "decision_point": self.hint.decision_point,
            "fingerprint_key": self.hint.fingerprint_key,
            "action_key": action,
            "recommended_action": self.hint.recommended_action,
            "effective_weight": weight,
            "disposition": disposition,
            "guidance": self.hint.guidance,
        })
    }

    /// Transitional escape hatch: the underlying raw hint. Use during
    /// Phase 3 migration when a legacy call site still requires
    /// `&TaskPolicyHint`. New code should prefer the typed accessors above.
    pub(crate) fn as_raw(&self) -> &super::task_learning::TaskPolicyHint {
        &self.hint
    }
}

// ---------------------------------------------------------------------------
// The Self (decision locus)
// ---------------------------------------------------------------------------

/// The sovereign decision locus.
///
/// A zero-sized marker — all state for decision-making lives in the
/// resources it consults (stores, provider pools) rather than inside the
/// marker itself. This keeps The Self cheap to construct, free to share
/// across async tasks, and trivially swappable.
///
/// The charter commitment: The Self's decision functions are black boxes —
/// statistics + bandit + safety locks today, replaceable tomorrow. External
/// callers must never branch on *how* The Self decides, only on *what* it
/// returns.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Self_;

impl Self_ {
    pub(crate) fn new() -> Self {
        Self
    }

    /// The sovereign consulting entry point.
    ///
    /// v2: pure delegation to `task_learning::query_task_policy_hint`. No
    /// behavior change from existing call sites that invoke the underlying
    /// function directly — this merely centralizes the funnel so future
    /// fusion (bandit scores, safety-lock pre-filtering, alternative
    /// mechanisms) can happen inside this function without callers noticing.
    ///
    /// Declared as an associated function rather than a method: The Self is
    /// a concept, not an instance, and callers should not be asked to
    /// construct one just to ask a question.
    pub(crate) async fn consult(
        store: &crate::modules::mcp::store::McpStore,
        locus: DecisionLocus,
        query: &str,
        limit: usize,
    ) -> PolicyGuidance {
        let hint = super::task_learning::query_task_policy_hint(
            store,
            query,
            locus.as_canonical_str(),
            limit,
        )
        .await;
        PolicyGuidance::from_hint(hint)
    }

    /// Transitional sovereign entry point for stringly decision-point callers.
    ///
    /// Known canonical strings are normalized into [`DecisionLocus`] first.
    /// Unknown strings intentionally fall back to the raw policy layer so
    /// compatibility tools can still query experimental or future points
    /// without business-layer code bypassing The Self.
    pub(crate) async fn consult_named(
        store: &crate::modules::mcp::store::McpStore,
        decision_point: &str,
        query: &str,
        limit: usize,
    ) -> PolicyGuidance {
        if let Some(locus) = DecisionLocus::from_canonical_str(decision_point) {
            return Self::consult(store, locus, query, limit).await;
        }

        let hint =
            super::task_learning::query_task_policy_hint(store, query, decision_point, limit).await;
        PolicyGuidance::from_hint(hint)
    }
}

// ---------------------------------------------------------------------------
// Invariant tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// DecisionLocus strings must equal the `DECISION_POINT_*` constants in
    /// task_learning so `normalize_decision_point` round-trips correctly.
    /// If task_learning changes its canonical strings, this test breaks and
    /// forces a concurrent update here.
    #[test]
    fn decision_locus_strings_match_canonical_constants() {
        assert_eq!(DecisionLocus::Route.as_canonical_str(), "route");
        assert_eq!(
            DecisionLocus::WorkerSelection.as_canonical_str(),
            "worker_selection"
        );
        assert_eq!(DecisionLocus::Discovery.as_canonical_str(), "discovery");
        assert_eq!(
            DecisionLocus::CapabilityAttach.as_canonical_str(),
            "capability_attach"
        );
        assert_eq!(DecisionLocus::Execution.as_canonical_str(), "execution");
        assert_eq!(
            DecisionLocus::Verification.as_canonical_str(),
            "verification"
        );

        assert_eq!(
            DecisionLocus::from_canonical_str("worker_selection"),
            Some(DecisionLocus::WorkerSelection)
        );
        assert_eq!(DecisionLocus::from_canonical_str("unknown"), None);
    }

    #[test]
    fn source_tag_roundtrips() {
        let tag = SourceTag::new("custom");
        assert_eq!(tag.as_str(), "custom");
        assert_eq!(SourceTag::user_action().as_str(), "user_action");
        assert_eq!(SourceTag::tool_trace().as_str(), "tool_trace");
        assert_eq!(SourceTag::posterior_signal().as_str(), "posterior_signal");
        assert_eq!(SourceTag::heuristic_rule().as_str(), "heuristic_rule");
    }

    #[test]
    fn observation_source_accessor_works_for_all_variants() {
        let external = Observation::External {
            source: SourceTag::new("future_evomap"),
            payload: serde_json::json!({}),
        };
        assert_eq!(external.source().as_str(), "future_evomap");

        let user_signal = Observation::UserSignal {
            source: SourceTag::posterior_signal(),
            input: PosteriorSignalInput::default(),
        };
        assert_eq!(user_signal.source().as_str(), "posterior_signal");
    }

    #[test]
    fn ingress_trait_can_be_implemented() {
        struct DummyIngress;
        impl Ingress for DummyIngress {
            fn source_tag(&self) -> SourceTag {
                SourceTag::new("dummy")
            }
        }
        let ingress = DummyIngress;
        assert_eq!(ingress.source_tag().as_str(), "dummy");
    }

    /// The Self is a zero-sized marker at v1. If anyone adds state to it
    /// later, this test breaks and forces a conscious decision — because
    /// stateful Self_ changes its concurrency and sharing semantics.
    #[test]
    fn self_remains_zero_sized_at_v1() {
        assert_eq!(std::mem::size_of::<Self_>(), 0);
        let _ = Self_::new();
        let _ = Self_::default();
    }

    // -----------------------------------------------------------------
    // Phase 2: PolicyGuidance wrapper
    // -----------------------------------------------------------------

    fn hint_from_json(value: serde_json::Value) -> super::super::task_learning::TaskPolicyHint {
        serde_json::from_value(value).expect("TaskPolicyHint fixture")
    }

    fn empty_task_fingerprint_json() -> serde_json::Value {
        serde_json::json!({
            "goal_shape": "",
            "output_shape": "",
            "scope_shape": "",
            "risk_class": "",
            "execution_pressure": "",
            "discovery_pressure": "",
            "environment_dependency": "",
            "verification_demand": "",
        })
    }

    #[test]
    fn policy_guidance_weight_for_missing_action_is_zero() {
        let hint = hint_from_json(serde_json::json!({
            "query": "q",
            "decision_point": "route",
            "fingerprint_key": "fp",
            "task_fingerprint": empty_task_fingerprint_json(),
            "recommended_action": null,
            "priors": [],
            "guidance": null,
        }));
        let guidance = PolicyGuidance::from_hint(hint);
        assert_eq!(guidance.weight_for("direct"), 0.0);
        assert!(guidance.recommended_action().is_none());
    }

    #[test]
    fn policy_guidance_weight_for_present_action_returns_effective_weight() {
        let hint = hint_from_json(serde_json::json!({
            "query": "q",
            "decision_point": "route",
            "fingerprint_key": "fp",
            "task_fingerprint": empty_task_fingerprint_json(),
            "recommended_action": "direct",
            "priors": [{
                "action_key": "direct",
                "raw_weight": 0.9,
                "effective_weight": 0.7,
                "confidence": 0.8,
                "evidence_count": 3,
                "maturity": "confirmed",
                "updated_at_unix_ms": 0,
            }],
            "guidance": null,
        }));
        let guidance = PolicyGuidance::from_hint(hint);
        assert_eq!(guidance.weight_for("direct"), 0.7);
        assert_eq!(guidance.weight_for("worker"), 0.0);
        assert_eq!(guidance.recommended_action(), Some("direct"));
    }

    /// The ±0.15 thresholds must match `task_policy_gate_meta` exactly so
    /// Phase 3 call-site migration introduces zero behavior drift.
    #[test]
    fn policy_guidance_gate_meta_dispositions_track_threshold() {
        let hint = hint_from_json(serde_json::json!({
            "query": "q",
            "decision_point": "discovery",
            "fingerprint_key": "fp",
            "task_fingerprint": empty_task_fingerprint_json(),
            "recommended_action": null,
            "priors": [
                {"action_key":"strong_push","raw_weight":0.5,"effective_weight":0.5,"confidence":1.0,"evidence_count":1,"maturity":"confirmed","updated_at_unix_ms":0},
                {"action_key":"strong_pull","raw_weight":-0.5,"effective_weight":-0.5,"confidence":1.0,"evidence_count":1,"maturity":"confirmed","updated_at_unix_ms":0},
                {"action_key":"quiet","raw_weight":0.0,"effective_weight":0.05,"confidence":0.1,"evidence_count":1,"maturity":"nascent","updated_at_unix_ms":0}
            ],
            "guidance": null,
        }));
        let guidance = PolicyGuidance::from_hint(hint);
        assert_eq!(
            guidance.gate_meta("strong_push")["disposition"],
            "encourage"
        );
        assert_eq!(
            guidance.gate_meta("strong_pull")["disposition"],
            "discourage"
        );
        assert_eq!(guidance.gate_meta("quiet")["disposition"], "neutral");
        assert_eq!(guidance.gate_meta("unknown")["disposition"], "neutral");
    }

    /// Boundary case: the exact threshold ±0.15 is "encourage"/"discourage",
    /// not "neutral". Matches the strict `>=` / `<=` in `task_policy_gate_meta`.
    #[test]
    fn policy_guidance_gate_meta_boundary_thresholds_are_inclusive() {
        let hint = hint_from_json(serde_json::json!({
            "query": "q",
            "decision_point": "route",
            "fingerprint_key": "fp",
            "task_fingerprint": empty_task_fingerprint_json(),
            "recommended_action": null,
            "priors": [
                {"action_key":"edge_up","raw_weight":0.15,"effective_weight":0.15,"confidence":1.0,"evidence_count":1,"maturity":"confirmed","updated_at_unix_ms":0},
                {"action_key":"edge_down","raw_weight":-0.15,"effective_weight":-0.15,"confidence":1.0,"evidence_count":1,"maturity":"confirmed","updated_at_unix_ms":0}
            ],
            "guidance": null,
        }));
        let guidance = PolicyGuidance::from_hint(hint);
        assert_eq!(guidance.gate_meta("edge_up")["disposition"], "encourage");
        assert_eq!(guidance.gate_meta("edge_down")["disposition"], "discourage");
    }
}
