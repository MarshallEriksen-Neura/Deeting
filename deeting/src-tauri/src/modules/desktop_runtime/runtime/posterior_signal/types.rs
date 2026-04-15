use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PosteriorSignalKind {
    Accepted,
    Corrected,
    Rejected,
    Unknown,
}

impl PosteriorSignalKind {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Corrected => "corrected",
            Self::Rejected => "rejected",
            Self::Unknown => "unknown",
        }
    }

    pub(crate) fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "accepted" | "accept" | "positive" | "up" => Some(Self::Accepted),
            "corrected" | "correct" => Some(Self::Corrected),
            "rejected" | "reject" | "negative" | "down" => Some(Self::Rejected),
            "unknown" => Some(Self::Unknown),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PosteriorSignalSource {
    ExplicitOutcome,
    ManualRevision,
    TraceFeedback,
    HeuristicRules,
    Unknown,
}

impl PosteriorSignalSource {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::ExplicitOutcome => "explicit_outcome",
            Self::ManualRevision => "manual_revision",
            Self::TraceFeedback => "trace_feedback",
            Self::HeuristicRules => "heuristic_rules",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub(crate) struct PosteriorSignalInput {
    pub(crate) session_id: Option<String>,
    pub(crate) trace_id: Option<String>,
    pub(crate) run_id: Option<String>,
    pub(crate) user_text: Option<String>,
    pub(crate) explicit_outcome: Option<String>,
    pub(crate) feedback_score: Option<f64>,
    pub(crate) feedback_comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct PosteriorSignalDecision {
    pub(crate) signal: PosteriorSignalKind,
    pub(crate) confidence: f64,
    pub(crate) source: PosteriorSignalSource,
    pub(crate) version: String,
    pub(crate) rationale: Option<String>,
}

impl PosteriorSignalDecision {
    pub(crate) fn unknown() -> Self {
        Self {
            signal: PosteriorSignalKind::Unknown,
            confidence: 0.0,
            source: PosteriorSignalSource::Unknown,
            version: "posterior-signal/v1".to_string(),
            rationale: None,
        }
    }
}

pub(crate) trait PosteriorSignalBackend: Send + Sync {
    fn infer(&self, input: &PosteriorSignalInput) -> PosteriorSignalDecision;
}
