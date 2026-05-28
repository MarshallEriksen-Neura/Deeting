//! # Sovereign Ingress Implementations
//!
//! Concrete [`Ingress`](super::Ingress) wrappers that claim source identity
//! for each of Deeting's input streams and translate raw signals into
//! canonical [`Observation`](super::Observation) values.
//!
//! Phase 4 started as shape-level wrappers only. It now lightly routes
//! selected live call sites through the ingress boundary while preserving
//! the existing decision logic and payload shapes.
//!
//! Three canonical ingress kinds cover the three variants of
//! [`Observation`](super::Observation):
//! - [`PosteriorSignalIngress`] → `Observation::UserSignal`
//! - [`TaskExecutionIngress`] → `Observation::TaskExecution`
//! - [`UserActionIngress`] → `Observation::External` translated into
//!   canonical posterior-signal input for follow-up user feedback paths
//! - [`ExternalIngress`] → `Observation::External` (entry point for future
//!   external sources such as EvoMap GEP capsules, friend-shared skills,
//!   synthetic data; each such source should translate its native format
//!   into an internal-variant observation when the mapping is clean, and
//!   fall back to `ExternalIngress` only when no clean mapping exists).

#![allow(dead_code)]

use super::super::posterior_signal::PosteriorSignalInput;
use super::super::task_learning::{EvaluatedOutcome, TaskFingerprint};
use super::{Ingress, Observation, SourceTag};

// ---------------------------------------------------------------------------
// Posterior signal ingress
// ---------------------------------------------------------------------------

/// Wraps a raw posterior-signal input as a sovereign [`Ingress`].
///
/// The wrapped `PosteriorSignalInput` is the same type already produced by
/// `posterior_signal::resolver`. This wrapper exists to declare source
/// identity and produce a canonical [`Observation`] without touching the
/// existing resolution pipeline.
#[derive(Debug, Clone)]
pub(crate) struct PosteriorSignalIngress {
    input: PosteriorSignalInput,
}

impl PosteriorSignalIngress {
    pub(crate) fn new(input: PosteriorSignalInput) -> Self {
        Self { input }
    }

    pub(crate) fn input(&self) -> &PosteriorSignalInput {
        &self.input
    }

    /// Consume and translate into a canonical observation.
    pub(crate) fn into_observation(self) -> Observation {
        Observation::UserSignal {
            source: self.source_tag(),
            input: self.input,
        }
    }
}

impl Ingress for PosteriorSignalIngress {
    fn source_tag(&self) -> SourceTag {
        SourceTag::posterior_signal()
    }
}

// ---------------------------------------------------------------------------
// Task execution ingress
// ---------------------------------------------------------------------------

/// Wraps a completed task execution (fingerprint + outcome) as a sovereign
/// [`Ingress`].
///
/// Mirrors the (fingerprint, EvaluatedOutcome) pair produced by
/// `task_learning::evaluator` when a task run finishes. Declares source
/// identity and produces an `Observation::TaskExecution`.
#[derive(Debug, Clone)]
pub(crate) struct TaskExecutionIngress {
    fingerprint: TaskFingerprint,
    outcome: EvaluatedOutcome,
}

impl TaskExecutionIngress {
    pub(crate) fn new(fingerprint: TaskFingerprint, outcome: EvaluatedOutcome) -> Self {
        Self {
            fingerprint,
            outcome,
        }
    }

    pub(crate) fn fingerprint(&self) -> &TaskFingerprint {
        &self.fingerprint
    }

    pub(crate) fn outcome(&self) -> &EvaluatedOutcome {
        &self.outcome
    }

    pub(crate) fn into_observation(self) -> Observation {
        Observation::TaskExecution {
            source: self.source_tag(),
            fingerprint: self.fingerprint,
            outcome: self.outcome,
        }
    }
}

impl Ingress for TaskExecutionIngress {
    fn source_tag(&self) -> SourceTag {
        SourceTag::tool_trace()
    }
}

// ---------------------------------------------------------------------------
// User action ingress
// ---------------------------------------------------------------------------

/// Wraps raw follow-up user feedback as sovereign ingress data.
///
/// The raw user action stays source-tagged as `user_action`, but the current
/// runtime can also translate it into the canonical `PosteriorSignalInput`
/// shape used by posterior-signal resolution.
#[derive(Debug, Clone)]
pub(crate) struct UserActionIngress {
    session_id: Option<String>,
    trace_id: Option<String>,
    user_text: String,
}

impl UserActionIngress {
    pub(crate) fn new(
        session_id: Option<String>,
        trace_id: Option<String>,
        user_text: impl Into<String>,
    ) -> Self {
        Self {
            session_id,
            trace_id,
            user_text: user_text.into(),
        }
    }

    pub(crate) fn posterior_signal_input(&self) -> PosteriorSignalInput {
        PosteriorSignalInput {
            session_id: self.session_id.clone(),
            trace_id: self.trace_id.clone(),
            user_text: Some(self.user_text.clone()),
            ..Default::default()
        }
    }

    pub(crate) fn into_observation(self) -> Observation {
        Observation::External {
            source: self.source_tag(),
            payload: serde_json::json!({
                "session_id": self.session_id,
                "trace_id": self.trace_id,
                "user_text": self.user_text,
            }),
        }
    }
}

impl Ingress for UserActionIngress {
    fn source_tag(&self) -> SourceTag {
        SourceTag::user_action()
    }
}

// ---------------------------------------------------------------------------
// External ingress (template for future third-party sources)
// ---------------------------------------------------------------------------

/// Generic ingress for third-party / external sources.
///
/// Carries an opaque [`SourceTag`] so The Self never needs to know *which*
/// external system produced the payload. Concrete boundary files (e.g.
/// future `sovereign/ingress/sources/evomap.rs`) should translate their
/// native format into either (a) a domain-specific canonical observation
/// via [`TaskExecutionIngress`] / [`PosteriorSignalIngress`] when the
/// foreign signal maps cleanly, or (b) `ExternalIngress` as a last-resort
/// passthrough when the payload has no canonical equivalent.
pub(crate) struct ExternalIngress {
    source: SourceTag,
    payload: serde_json::Value,
}

impl ExternalIngress {
    pub(crate) fn new(source: SourceTag, payload: serde_json::Value) -> Self {
        Self { source, payload }
    }

    pub(crate) fn into_observation(self) -> Observation {
        Observation::External {
            source: self.source,
            payload: self.payload,
        }
    }
}

impl Ingress for ExternalIngress {
    fn source_tag(&self) -> SourceTag {
        self.source.clone()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_fingerprint() -> TaskFingerprint {
        // Construction via serde_json keeps us off the private module path
        // for TaskFingerprint's fields; the charter's principle is to not
        // couple to any specific construction API.
        serde_json::from_value(serde_json::json!({
            "goal_shape": "",
            "output_shape": "",
            "scope_shape": "",
            "risk_class": "",
            "execution_pressure": "",
            "discovery_pressure": "",
            "environment_dependency": "",
            "verification_demand": "",
        }))
        .expect("TaskFingerprint fixture")
    }

    fn dummy_outcome() -> EvaluatedOutcome {
        serde_json::from_value(serde_json::json!({
            "final_status": "completed",
            "verification_result": "verified",
            "user_response_signal": "accepted",
            "judgment_mode": "automatic",
            "discovery_judgment": "not_needed",
            "execution_judgment": "not_needed",
            "cost_class": "low",
            "retry_profile": "none",
            "error_profile": "none",
            "confidence": 0.9,
            "finish_reason": "stop",
            "tool_call_count": 0,
            "search_sdk_calls": 0,
            "used_attach_capability": false,
            "used_execute_code_plan": false,
            "had_delegated_execution": false,
            "observed_error_codes": []
        }))
        .expect("EvaluatedOutcome fixture")
    }

    #[test]
    fn posterior_signal_ingress_tags_itself_correctly() {
        let ingress = PosteriorSignalIngress::new(PosteriorSignalInput::default());
        assert_eq!(ingress.source_tag().as_str(), "posterior_signal");
    }

    #[test]
    fn posterior_signal_ingress_produces_user_signal_observation() {
        let ingress = PosteriorSignalIngress::new(PosteriorSignalInput::default());
        match ingress.into_observation() {
            Observation::UserSignal { source, .. } => {
                assert_eq!(source.as_str(), "posterior_signal");
            }
            other => panic!("expected UserSignal, got {:?}", other),
        }
    }

    #[test]
    fn task_execution_ingress_tags_itself_correctly() {
        let ingress = TaskExecutionIngress::new(dummy_fingerprint(), dummy_outcome());
        assert_eq!(ingress.source_tag().as_str(), "tool_trace");
    }

    #[test]
    fn task_execution_ingress_produces_task_execution_observation() {
        let ingress = TaskExecutionIngress::new(dummy_fingerprint(), dummy_outcome());
        match ingress.into_observation() {
            Observation::TaskExecution { source, .. } => {
                assert_eq!(source.as_str(), "tool_trace");
            }
            other => panic!("expected TaskExecution, got {:?}", other),
        }
    }

    #[test]
    fn user_action_ingress_tags_itself_correctly() {
        let ingress = UserActionIngress::new(
            Some("session".to_string()),
            Some("trace".to_string()),
            "please fix this",
        );
        assert_eq!(ingress.source_tag().as_str(), "user_action");
    }

    #[test]
    fn user_action_ingress_translates_to_posterior_signal_input() {
        let ingress = UserActionIngress::new(
            Some("session".to_string()),
            Some("trace".to_string()),
            "please fix this",
        );
        let input = ingress.posterior_signal_input();
        assert_eq!(input.session_id.as_deref(), Some("session"));
        assert_eq!(input.trace_id.as_deref(), Some("trace"));
        assert_eq!(input.user_text.as_deref(), Some("please fix this"));
    }

    #[test]
    fn user_action_ingress_produces_external_observation() {
        let ingress = UserActionIngress::new(None, Some("trace".to_string()), "needs work");
        match ingress.into_observation() {
            Observation::External { source, payload } => {
                assert_eq!(source.as_str(), "user_action");
                assert_eq!(payload["trace_id"], "trace");
                assert_eq!(payload["user_text"], "needs work");
            }
            other => panic!("expected External, got {:?}", other),
        }
    }

    #[test]
    fn external_ingress_preserves_source_tag() {
        let ingress = ExternalIngress::new(
            SourceTag::new("future_evomap"),
            serde_json::json!({"capsule_id": "abc"}),
        );
        assert_eq!(ingress.source_tag().as_str(), "future_evomap");
    }

    #[test]
    fn external_ingress_produces_external_observation_with_opaque_source() {
        let ingress = ExternalIngress::new(
            SourceTag::new("synthetic"),
            serde_json::json!({"hint": "foo"}),
        );
        match ingress.into_observation() {
            Observation::External { source, payload } => {
                assert_eq!(source.as_str(), "synthetic");
                assert_eq!(payload["hint"], "foo");
            }
            other => panic!("expected External, got {:?}", other),
        }
    }

    /// Charter invariant: any Ingress implementation must be usable as a
    /// trait object so future code can hold a heterogeneous collection of
    /// input sources without knowing their concrete types.
    #[test]
    fn all_ingresses_usable_as_trait_objects() {
        let sources: Vec<Box<dyn Ingress>> = vec![
            Box::new(PosteriorSignalIngress::new(PosteriorSignalInput::default())),
            Box::new(TaskExecutionIngress::new(
                dummy_fingerprint(),
                dummy_outcome(),
            )),
            Box::new(UserActionIngress::new(
                Some("session".to_string()),
                None,
                "feedback",
            )),
            Box::new(ExternalIngress::new(
                SourceTag::new("test"),
                serde_json::json!({}),
            )),
        ];
        let tags: Vec<String> = sources
            .iter()
            .map(|s| s.source_tag().as_str().to_string())
            .collect();
        assert_eq!(
            tags,
            vec!["posterior_signal", "tool_trace", "user_action", "test"]
        );
    }
}
