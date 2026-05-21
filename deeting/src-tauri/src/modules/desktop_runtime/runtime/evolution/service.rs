//! Evolution signal service: persistence + explicit-feedback case promotion.
//!
//! Case routing:
//! - Only `ExplicitTraceFeedback` is allowed to promote into a case. Monitor /
//!   manual / deeting_think land as signals only, even when classified
//!   Rejected/Accepted/Corrected.
//! - `(ExplicitTraceFeedback, Rejected)`  → `Negative` case.
//! - `(ExplicitTraceFeedback, Accepted)`  → `Reference` case.
//! - `(ExplicitTraceFeedback, Corrected)` → `Constraint` case.
//! - All require a non-empty `fingerprint_key`.

use crate::modules::mcp::store::McpStore;
use mcp_session::admin::{
    LocalEvolutionSignalItem, LocalEvolutionSignalListResponse, LocalEvolutionSignalQuery,
};

use super::store as evolution_store;
use super::types::{
    EvolutionCaseType, EvolutionSignal, EvolutionSignalClassification, EvolutionSignalDraft,
    EvolutionSignalSource, EvolutionSignalStatus,
};

const CASE_SUMMARY_MAX_LEN: usize = 280;
const DEFAULT_NEGATIVE_CASE_PLACEHOLDER: &str =
    "User rejected the assistant's prior response on a task in this fingerprint; \
     no explicit reason was provided. Approach with a different framing.";
const DEFAULT_REFERENCE_CASE_PLACEHOLDER: &str =
    "User accepted the assistant's prior response on a task in this fingerprint; \
     treat as a successful exemplar of the kind of answer that lands.";
const DEFAULT_CONSTRAINT_CASE_PLACEHOLDER: &str =
    "Persistent boundary surfaced via correction: user corrected a prior response on a task \
     in this fingerprint; honor this boundary on future similar tasks.";

/// Persist an evolution signal and, when applicable, promote it into a case.
///
/// Behavior matrix (Slice 3):
/// - All drafts persist as `Classified` rows (classifier supplied at the call
///   site — no inline reclassification yet).
/// - When `signal.source == ExplicitTraceFeedback` and `fingerprint_key` is
///   present, the signal is routed to a case type by classification:
///     - `Rejected`  → `Negative` case
///     - `Accepted`  → `Reference` case
///     - `Corrected` → `Constraint` case
///   The signal status is advanced to `Applied` after the case is written.
/// - All other (source, classification) combinations stay at `Classified`.
///
/// Returns the persisted signal (with its final status).
pub(crate) async fn submit_evolution_signal(
    store: &McpStore,
    draft: EvolutionSignalDraft,
) -> Result<EvolutionSignal, String> {
    let initial_status = if matches!(draft.classification, EvolutionSignalClassification::Unknown) {
        EvolutionSignalStatus::Observed
    } else {
        EvolutionSignalStatus::Classified
    };

    let signal = evolution_store::insert_signal(store, draft, initial_status).await?;

    if let Some(case_type) = route_case_type(&signal) {
        if let Some(fingerprint_key) = signal.fingerprint_key.as_deref() {
            let summary = render_case_summary(&signal, case_type);
            evolution_store::insert_case(
                store,
                fingerprint_key,
                case_type,
                &summary,
                std::slice::from_ref(&signal.id),
                signal.run_id.as_deref(),
                signal.confidence,
            )
            .await?;
            evolution_store::update_signal_status(
                store,
                &signal.id,
                EvolutionSignalStatus::Applied,
            )
            .await?;
            return Ok(EvolutionSignal {
                status: EvolutionSignalStatus::Applied,
                ..signal
            });
        }
    }

    Ok(signal)
}

pub(crate) async fn list_evolution_signals_for_query(
    store: &McpStore,
    query: &LocalEvolutionSignalQuery,
) -> Result<LocalEvolutionSignalListResponse, String> {
    let skip = query.skip.unwrap_or(0).max(0) as usize;
    let limit = query.limit.unwrap_or(50).clamp(1, 200) as usize;
    let total = evolution_store::count_signals_for_query(store, query).await?;
    let items = evolution_store::list_signals_for_query(store, query, skip, limit)
        .await?
        .into_iter()
        .map(signal_item_from_row)
        .collect();

    Ok(LocalEvolutionSignalListResponse {
        total,
        skip: skip as i64,
        limit: limit as i64,
        items,
    })
}

fn signal_item_from_row(signal: EvolutionSignal) -> LocalEvolutionSignalItem {
    LocalEvolutionSignalItem {
        id: signal.id,
        source: signal.source.as_canonical_str().to_string(),
        status: signal.status.as_canonical_str().to_string(),
        classification: signal.classification.as_canonical_str().to_string(),
        session_id: signal.session_id,
        trace_id: signal.trace_id,
        run_id: signal.run_id,
        monitor_task_id: signal.monitor_task_id,
        monitor_log_id: signal.monitor_log_id,
        fingerprint_key: signal.fingerprint_key,
        confidence: signal.confidence,
        payload_json: signal.payload_json,
        note: signal.note,
        created_at_unix_ms: signal.created_at_unix_ms,
    }
}

/// Decide which `EvolutionCaseType`, if any, this signal should be promoted
/// into. Returns `None` when the source is not allowed to write cases or the
/// classification has no case mapping.
///
/// Hard rule: only `ExplicitTraceFeedback` is allowed to produce cases.
/// Monitor / manual / deeting_think stay as signals. Fingerprint presence is
/// checked at the call site in `submit_evolution_signal`.
fn route_case_type(signal: &EvolutionSignal) -> Option<EvolutionCaseType> {
    if !matches!(signal.source, EvolutionSignalSource::ExplicitTraceFeedback) {
        return None;
    }
    match signal.classification {
        EvolutionSignalClassification::Rejected => Some(EvolutionCaseType::Negative),
        EvolutionSignalClassification::Accepted => Some(EvolutionCaseType::Reference),
        EvolutionSignalClassification::Corrected => Some(EvolutionCaseType::Constraint),
        EvolutionSignalClassification::Neutral | EvolutionSignalClassification::Unknown => None,
    }
}

/// Slice 1 back-compat wrapper. Kept so legacy callers/tests can ask the
/// narrow question "is this a negative-case trigger?" without recomputing the
/// case-type match. New code should call `route_case_type` directly.
fn should_build_negative_case(signal: &EvolutionSignal) -> bool {
    matches!(route_case_type(signal), Some(EvolutionCaseType::Negative))
}

fn render_case_summary(signal: &EvolutionSignal, case_type: EvolutionCaseType) -> String {
    let user_note = signal
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let body = match (case_type, user_note) {
        (EvolutionCaseType::Negative, Some(note)) => format!(
            "User marked a prior response as rejected with note: {}",
            note
        ),
        (EvolutionCaseType::Negative, None) => DEFAULT_NEGATIVE_CASE_PLACEHOLDER.to_string(),
        (EvolutionCaseType::Reference, Some(note)) => format!(
            "User accepted the assistant's prior response with note: {}",
            note
        ),
        (EvolutionCaseType::Reference, None) => DEFAULT_REFERENCE_CASE_PLACEHOLDER.to_string(),
        (EvolutionCaseType::Constraint, Some(note)) => {
            format!("Persistent boundary surfaced via correction: {}", note)
        }
        (EvolutionCaseType::Constraint, None) => DEFAULT_CONSTRAINT_CASE_PLACEHOLDER.to_string(),
    };

    truncate_summary(&body, CASE_SUMMARY_MAX_LEN)
}

fn truncate_summary(text: &str, max_len: usize) -> String {
    if text.chars().count() <= max_len {
        return text.to_string();
    }
    let truncated: String = text.chars().take(max_len.saturating_sub(1)).collect();
    format!("{}…", truncated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn fixture_signal(
        source: EvolutionSignalSource,
        classification: EvolutionSignalClassification,
        fingerprint_key: Option<&str>,
        note: Option<&str>,
    ) -> EvolutionSignal {
        EvolutionSignal {
            id: "sig-1".to_string(),
            source,
            status: EvolutionSignalStatus::Classified,
            classification,
            session_id: None,
            trace_id: Some("trace-1".to_string()),
            run_id: Some("run-1".to_string()),
            monitor_task_id: None,
            monitor_log_id: None,
            fingerprint_key: fingerprint_key.map(str::to_string),
            confidence: 0.9,
            payload_json: json!({}),
            note: note.map(str::to_string),
            created_at_unix_ms: 0,
        }
    }

    async fn create_test_store(name: &str) -> McpStore {
        let db_path =
            std::env::temp_dir().join(format!("deeting-evolution-{name}-{}.db", Uuid::new_v4()));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        let store = McpStore::new(&database_url)
            .await
            .expect("test store should be created");
        store.init().await.expect("test store schema should init");
        store
    }

    #[tokio::test]
    async fn existing_explicit_sources_still_persist() {
        let store = create_test_store("all-explicit-sources").await;
        for source in [
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalSource::DeetingThink,
            EvolutionSignalSource::ManualTaskLearningRevision,
            EvolutionSignalSource::MonitorObservation,
            EvolutionSignalSource::MonitorFeedback,
        ] {
            submit_evolution_signal(
                &store,
                EvolutionSignalDraft {
                    source,
                    classification: EvolutionSignalClassification::Neutral,
                    session_id: Some("session-1".to_string()),
                    trace_id: Some(format!("trace-{}", source.as_canonical_str())),
                    run_id: Some(format!("run-{}", source.as_canonical_str())),
                    monitor_task_id: None,
                    monitor_log_id: None,
                    fingerprint_key: Some("fp-x".to_string()),
                    confidence: 0.5,
                    payload_json: json!({"source": source.as_canonical_str()}),
                    note: None,
                },
            )
            .await
            .expect("signal should persist");
        }

        for source in [
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalSource::DeetingThink,
            EvolutionSignalSource::ManualTaskLearningRevision,
            EvolutionSignalSource::MonitorObservation,
            EvolutionSignalSource::MonitorFeedback,
        ] {
            let trace_id = format!("trace-{}", source.as_canonical_str());
            let signals = evolution_store::list_signals_by_trace(&store, &trace_id, 10)
                .await
                .expect("trace query should work");
            assert_eq!(signals.len(), 1, "source={source:?}");
            assert_eq!(signals[0].source, source);
        }
    }

    // ----- Slice 1 regression tests (negative case path) -----

    #[test]
    fn negative_case_triggers_for_rejected_explicit_feedback_with_fingerprint() {
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Rejected,
            Some("fp-x"),
            None,
        );
        assert!(should_build_negative_case(&signal));
        assert_eq!(route_case_type(&signal), Some(EvolutionCaseType::Negative));
    }

    #[test]
    fn negative_case_does_not_trigger_for_rejected_without_explicit_source() {
        let signal = fixture_signal(
            EvolutionSignalSource::ManualTaskLearningRevision,
            EvolutionSignalClassification::Rejected,
            Some("fp-x"),
            None,
        );
        assert!(!should_build_negative_case(&signal));
        assert_eq!(route_case_type(&signal), None);
    }

    #[test]
    fn negative_case_does_not_trigger_for_accepted_explicit_feedback() {
        // Slice 1 narrow gate: accepted explicit feedback did not produce a
        // case. In Slice 3 it now produces a Reference case (see the
        // `reference_case_triggers_*` tests). The `should_build_negative_case`
        // narrow gate must still return false for Accepted.
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Accepted,
            Some("fp-x"),
            None,
        );
        assert!(!should_build_negative_case(&signal));
    }

    #[test]
    fn negative_case_summary_uses_user_note_when_present() {
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Rejected,
            Some("fp-x"),
            Some("answer ignored constraint about offline mode"),
        );
        let summary = render_case_summary(&signal, EvolutionCaseType::Negative);
        assert!(summary.contains("offline mode"));
    }

    #[test]
    fn negative_case_summary_falls_back_to_placeholder_when_note_blank() {
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Rejected,
            Some("fp-x"),
            Some("   "),
        );
        let summary = render_case_summary(&signal, EvolutionCaseType::Negative);
        assert!(summary.starts_with("User rejected"));
    }

    #[test]
    fn truncate_summary_keeps_short_text_intact() {
        assert_eq!(truncate_summary("hello", 32), "hello");
    }

    #[test]
    fn truncate_summary_clamps_long_text_with_ellipsis() {
        let long = "a".repeat(400);
        let truncated = truncate_summary(&long, 100);
        let char_count = truncated.chars().count();
        assert_eq!(char_count, 100);
        assert!(truncated.ends_with('…'));
    }

    // ----- Slice 2 ingress shape tests (case-gate is closed for non-explicit sources) -----

    #[test]
    fn manual_revision_rejected_does_not_trigger_negative_case() {
        let signal = fixture_signal(
            EvolutionSignalSource::ManualTaskLearningRevision,
            EvolutionSignalClassification::Rejected,
            Some("fp-x"),
            None,
        );
        assert!(!should_build_negative_case(&signal));
    }

    #[test]
    fn manual_revision_classification_maps_canonical_user_response_signal() {
        assert_eq!(
            EvolutionSignalClassification::from_canonical_str("accepted"),
            Some(EvolutionSignalClassification::Accepted),
        );
        assert_eq!(
            EvolutionSignalClassification::from_canonical_str("rejected"),
            Some(EvolutionSignalClassification::Rejected),
        );
        assert_eq!(
            EvolutionSignalClassification::from_canonical_str("corrected"),
            Some(EvolutionSignalClassification::Corrected),
        );
        // Unknown values fall back to Unknown at the call site.
        assert!(EvolutionSignalClassification::from_canonical_str("garbled").is_none());
    }

    #[test]
    fn deeting_think_unknown_preflight_does_not_trigger_negative_case() {
        let signal = fixture_signal(
            EvolutionSignalSource::DeetingThink,
            EvolutionSignalClassification::Unknown,
            Some("fp-x"),
            None,
        );
        assert!(!should_build_negative_case(&signal));
    }

    #[test]
    fn deeting_think_payload_shape_carries_planning_fields() {
        // Mirrors the payload built in chat_tool_runtime: any missing field
        // arrives as Null but the keys remain stable so downstream slices
        // can correlate against execution outcome.
        let payload = json!({
            "intent": "summarize",
            "context_assessment": serde_json::Value::Null,
            "tool_plan": "call summarizer",
            "constraints": serde_json::Value::Null,
            "task_query": "summarize the meeting notes",
            "trace_id": "trace-1",
            "session_id": "sess-1",
            "request_id": serde_json::Value::Null,
        });
        assert!(payload.get("intent").is_some());
        assert!(payload.get("tool_plan").is_some());
        assert!(payload.get("context_assessment").is_some());
        assert!(payload.get("constraints").is_some());
        assert!(payload.get("trace_id").is_some());
        assert!(payload.get("session_id").is_some());
        assert!(payload.get("task_query").is_some());
    }

    #[test]
    fn monitor_observation_unknown_does_not_trigger_negative_case() {
        let signal = fixture_signal(
            EvolutionSignalSource::MonitorObservation,
            EvolutionSignalClassification::Unknown,
            Some("fp-x"),
            None,
        );
        assert!(!should_build_negative_case(&signal));
    }

    #[test]
    fn monitor_feedback_rejected_does_not_trigger_negative_case() {
        // Hard rule: monitor signals never promote into negative cases or
        // priors. Even with Rejected classification + fingerprint, the gate
        // is closed because the source is not ExplicitTraceFeedback.
        let signal = fixture_signal(
            EvolutionSignalSource::MonitorFeedback,
            EvolutionSignalClassification::Rejected,
            Some("fp-x"),
            None,
        );
        assert!(!should_build_negative_case(&signal));
    }

    #[test]
    fn monitor_feedback_score_to_classification_heuristic() {
        // Mirrors the heuristic in MonitorState::submit_feedback:
        //   score > 0.5 → Accepted
        //   score < 0.0 → Rejected
        //   otherwise   → Neutral
        fn classify(score: f64) -> EvolutionSignalClassification {
            if score > 0.5 {
                EvolutionSignalClassification::Accepted
            } else if score < 0.0 {
                EvolutionSignalClassification::Rejected
            } else {
                EvolutionSignalClassification::Neutral
            }
        }
        assert_eq!(classify(0.8), EvolutionSignalClassification::Accepted);
        assert_eq!(classify(-0.4), EvolutionSignalClassification::Rejected);
        assert_eq!(classify(0.0), EvolutionSignalClassification::Neutral);
        assert_eq!(classify(0.3), EvolutionSignalClassification::Neutral);
    }

    // ----- Slice 3 case routing tests -----

    #[test]
    fn reference_case_triggers_for_accepted_explicit_feedback() {
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Accepted,
            Some("fp-x"),
            None,
        );
        assert_eq!(route_case_type(&signal), Some(EvolutionCaseType::Reference));
    }

    #[test]
    fn reference_case_does_not_trigger_for_other_sources_with_accepted() {
        // Even with Accepted + fingerprint, non-explicit sources never produce
        // a reference case. Monitor / manual / deeting_think stay signals-only.
        for source in [
            EvolutionSignalSource::ManualTaskLearningRevision,
            EvolutionSignalSource::MonitorObservation,
            EvolutionSignalSource::MonitorFeedback,
            EvolutionSignalSource::DeetingThink,
        ] {
            let signal = fixture_signal(
                source,
                EvolutionSignalClassification::Accepted,
                Some("fp-x"),
                None,
            );
            assert_eq!(route_case_type(&signal), None, "source={:?}", source);
        }
    }

    #[test]
    fn constraint_case_triggers_for_corrected_explicit_feedback() {
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Corrected,
            Some("fp-x"),
            None,
        );
        assert_eq!(
            route_case_type(&signal),
            Some(EvolutionCaseType::Constraint)
        );
    }

    #[test]
    fn constraint_case_does_not_trigger_for_other_sources_with_corrected() {
        for source in [
            EvolutionSignalSource::ManualTaskLearningRevision,
            EvolutionSignalSource::MonitorObservation,
            EvolutionSignalSource::MonitorFeedback,
            EvolutionSignalSource::DeetingThink,
        ] {
            let signal = fixture_signal(
                source,
                EvolutionSignalClassification::Corrected,
                Some("fp-x"),
                None,
            );
            assert_eq!(route_case_type(&signal), None, "source={:?}", source);
        }
    }

    #[test]
    fn route_case_type_returns_none_for_neutral_explicit_feedback() {
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Neutral,
            Some("fp-x"),
            None,
        );
        assert_eq!(route_case_type(&signal), None);
    }

    #[test]
    fn route_case_type_returns_none_for_unknown_explicit_feedback() {
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Unknown,
            Some("fp-x"),
            None,
        );
        assert_eq!(route_case_type(&signal), None);
    }

    #[test]
    fn reference_case_summary_uses_user_note_when_present() {
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Accepted,
            Some("fp-x"),
            Some("the answer hit the right level of detail"),
        );
        let summary = render_case_summary(&signal, EvolutionCaseType::Reference);
        assert!(summary.contains("right level of detail"));
        assert!(summary.starts_with("User accepted"));
    }

    #[test]
    fn reference_case_summary_falls_back_to_placeholder_when_note_blank() {
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Accepted,
            Some("fp-x"),
            None,
        );
        let summary = render_case_summary(&signal, EvolutionCaseType::Reference);
        assert!(summary.starts_with("User accepted"));
        assert!(summary.contains("successful exemplar"));
    }

    #[test]
    fn constraint_case_summary_uses_user_note_when_present() {
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Corrected,
            Some("fp-x"),
            Some("never call the tool without confirming the path first"),
        );
        let summary = render_case_summary(&signal, EvolutionCaseType::Constraint);
        assert!(summary.contains("confirming the path"));
        assert!(summary.starts_with("Persistent boundary"));
    }

    #[test]
    fn constraint_case_summary_falls_back_to_placeholder_when_note_blank() {
        let signal = fixture_signal(
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalClassification::Corrected,
            Some("fp-x"),
            None,
        );
        let summary = render_case_summary(&signal, EvolutionCaseType::Constraint);
        assert!(summary.starts_with("Persistent boundary"));
        assert!(summary.contains("corrected"));
    }
}
