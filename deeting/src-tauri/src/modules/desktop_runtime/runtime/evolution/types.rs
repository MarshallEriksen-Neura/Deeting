//! Evolution boundary types.
//!
//! `EvolutionSignal` is the persistence projection of `sovereign::Observation`.
//! See `.omx/plans/2026-05-21-evolution-signal-boundary-plan.md` (Sovereign
//! Boundary Alignment section) for the fixed source ↔ observation mapping.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvolutionSignalSource {
    DeetingThink,
    ExplicitTraceFeedback,
    ManualTaskLearningRevision,
    MonitorObservation,
    MonitorFeedback,
}

impl EvolutionSignalSource {
    pub(crate) fn as_canonical_str(&self) -> &'static str {
        match self {
            Self::DeetingThink => "deeting_think",
            Self::ExplicitTraceFeedback => "explicit_trace_feedback",
            Self::ManualTaskLearningRevision => "manual_task_learning_revision",
            Self::MonitorObservation => "monitor_observation",
            Self::MonitorFeedback => "monitor_feedback",
        }
    }

    pub(crate) fn from_canonical_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "deeting_think" => Some(Self::DeetingThink),
            "explicit_trace_feedback" => Some(Self::ExplicitTraceFeedback),
            "manual_task_learning_revision" => Some(Self::ManualTaskLearningRevision),
            "monitor_observation" => Some(Self::MonitorObservation),
            "monitor_feedback" => Some(Self::MonitorFeedback),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvolutionSignalStatus {
    Observed,
    Classified,
    Correlated,
    Applied,
    Ignored,
}

impl EvolutionSignalStatus {
    pub(crate) fn as_canonical_str(&self) -> &'static str {
        match self {
            Self::Observed => "observed",
            Self::Classified => "classified",
            Self::Correlated => "correlated",
            Self::Applied => "applied",
            Self::Ignored => "ignored",
        }
    }

    pub(crate) fn from_canonical_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "observed" => Some(Self::Observed),
            "classified" => Some(Self::Classified),
            "correlated" => Some(Self::Correlated),
            "applied" => Some(Self::Applied),
            "ignored" => Some(Self::Ignored),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvolutionSignalClassification {
    Accepted,
    Corrected,
    Rejected,
    Neutral,
    Unknown,
}

impl EvolutionSignalClassification {
    pub(crate) fn as_canonical_str(&self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Corrected => "corrected",
            Self::Rejected => "rejected",
            Self::Neutral => "neutral",
            Self::Unknown => "unknown",
        }
    }

    pub(crate) fn from_canonical_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "accepted" => Some(Self::Accepted),
            "corrected" => Some(Self::Corrected),
            "rejected" => Some(Self::Rejected),
            "neutral" => Some(Self::Neutral),
            "unknown" => Some(Self::Unknown),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct EvolutionSignal {
    pub(crate) id: String,
    pub(crate) source: EvolutionSignalSource,
    pub(crate) status: EvolutionSignalStatus,
    pub(crate) classification: EvolutionSignalClassification,
    pub(crate) session_id: Option<String>,
    pub(crate) trace_id: Option<String>,
    pub(crate) run_id: Option<String>,
    pub(crate) monitor_task_id: Option<String>,
    pub(crate) monitor_log_id: Option<String>,
    pub(crate) fingerprint_key: Option<String>,
    pub(crate) confidence: f64,
    pub(crate) payload_json: serde_json::Value,
    pub(crate) note: Option<String>,
    pub(crate) created_at_unix_ms: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct EvolutionSignalDraft {
    pub(crate) source: EvolutionSignalSource,
    pub(crate) classification: EvolutionSignalClassification,
    pub(crate) session_id: Option<String>,
    pub(crate) trace_id: Option<String>,
    pub(crate) run_id: Option<String>,
    pub(crate) monitor_task_id: Option<String>,
    pub(crate) monitor_log_id: Option<String>,
    pub(crate) fingerprint_key: Option<String>,
    pub(crate) confidence: f64,
    pub(crate) payload_json: serde_json::Value,
    pub(crate) note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvolutionCaseType {
    Reference,
    Negative,
    Constraint,
}

impl EvolutionCaseType {
    pub(crate) fn as_canonical_str(&self) -> &'static str {
        match self {
            Self::Reference => "reference",
            Self::Negative => "negative",
            Self::Constraint => "constraint",
        }
    }

    pub(crate) fn from_canonical_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "reference" => Some(Self::Reference),
            "negative" => Some(Self::Negative),
            "constraint" => Some(Self::Constraint),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct EvolutionCase {
    pub(crate) id: String,
    pub(crate) fingerprint_key: String,
    pub(crate) case_type: EvolutionCaseType,
    pub(crate) summary: String,
    pub(crate) evidence_signal_ids: Vec<String>,
    pub(crate) source_run_id: Option<String>,
    pub(crate) confidence: f64,
    pub(crate) created_at_unix_ms: i64,
}

/// Cold-start packet handed to the workflow's system-message injector.
///
/// Slice 1 only populates `negative_cases`; later slices fill `priors_summary`
/// and `reference_cases`.
#[derive(Debug, Clone, Default)]
pub(crate) struct ColdStartPacket {
    pub(crate) fingerprint_key: String,
    pub(crate) priors_summary: Option<String>,
    pub(crate) reference_cases: Vec<ColdStartCaseEntry>,
    pub(crate) negative_cases: Vec<ColdStartCaseEntry>,
}

impl ColdStartPacket {
    pub(crate) fn is_empty(&self) -> bool {
        self.priors_summary.is_none()
            && self.reference_cases.is_empty()
            && self.negative_cases.is_empty()
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ColdStartCaseEntry {
    pub(crate) summary: String,
    pub(crate) confidence: f64,
    pub(crate) created_at_unix_ms: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signal_source_roundtrips_all_variants() {
        let all = [
            EvolutionSignalSource::DeetingThink,
            EvolutionSignalSource::ExplicitTraceFeedback,
            EvolutionSignalSource::ManualTaskLearningRevision,
            EvolutionSignalSource::MonitorObservation,
            EvolutionSignalSource::MonitorFeedback,
        ];
        for variant in all {
            let s = variant.as_canonical_str();
            assert_eq!(EvolutionSignalSource::from_canonical_str(s), Some(variant));
        }
        assert_eq!(EvolutionSignalSource::from_canonical_str("nope"), None);
    }

    #[test]
    fn signal_status_roundtrips_all_variants() {
        let all = [
            EvolutionSignalStatus::Observed,
            EvolutionSignalStatus::Classified,
            EvolutionSignalStatus::Correlated,
            EvolutionSignalStatus::Applied,
            EvolutionSignalStatus::Ignored,
        ];
        for variant in all {
            let s = variant.as_canonical_str();
            assert_eq!(EvolutionSignalStatus::from_canonical_str(s), Some(variant));
        }
    }

    #[test]
    fn signal_classification_roundtrips_all_variants() {
        let all = [
            EvolutionSignalClassification::Accepted,
            EvolutionSignalClassification::Corrected,
            EvolutionSignalClassification::Rejected,
            EvolutionSignalClassification::Neutral,
            EvolutionSignalClassification::Unknown,
        ];
        for variant in all {
            let s = variant.as_canonical_str();
            assert_eq!(
                EvolutionSignalClassification::from_canonical_str(s),
                Some(variant)
            );
        }
    }

    #[test]
    fn case_type_roundtrips_all_variants() {
        let all = [
            EvolutionCaseType::Reference,
            EvolutionCaseType::Negative,
            EvolutionCaseType::Constraint,
        ];
        for variant in all {
            let s = variant.as_canonical_str();
            assert_eq!(EvolutionCaseType::from_canonical_str(s), Some(variant));
        }
    }

    #[test]
    fn cold_start_packet_is_empty_when_no_data() {
        let packet = ColdStartPacket::default();
        assert!(packet.is_empty());
    }

    #[test]
    fn cold_start_packet_is_not_empty_when_negative_case_present() {
        let packet = ColdStartPacket {
            fingerprint_key: "fp-abc".to_string(),
            negative_cases: vec![ColdStartCaseEntry {
                summary: "avoid X".to_string(),
                confidence: 0.9,
                created_at_unix_ms: 1,
            }],
            ..Default::default()
        };
        assert!(!packet.is_empty());
    }
}
