use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextSourceType {
    Memory,
    LlmWiki,
    Knowledge,
}

impl ContextSourceType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Memory => "memory",
            Self::LlmWiki => "llm_wiki",
            Self::Knowledge => "knowledge",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextCoverage {
    Empty,
    Sparse,
    Focused,
    Broad,
}

impl ContextCoverage {
    pub fn from_item_count(count: usize) -> Self {
        match count {
            0 => Self::Empty,
            1..=2 => Self::Sparse,
            3..=8 => Self::Focused,
            _ => Self::Broad,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextNextAction {
    AnswerWithEvidence,
    SearchAgain,
    OpenSource,
    ExpandContext,
    AskClarifyingQuestion,
}

/// Shape-based confidence label derived from the score distribution of a
/// single envelope. **Purely descriptive** — does not rescore items, does
/// not compare across sources, does not embed source-specific thresholds.
///
/// Current product decision: this is intentionally the shared baseline for
/// Memory / LLM Wiki / Knowledge. Do not treat it as the final source-specific
/// `coverage_confidence` layer; that later layer should add reasons such as
/// `needs_open_source`, `single_memory_only`, or `selected_scope_fallback_used`
/// without replacing these generic distribution statistics.
/// The thresholds below operate on the distribution's *shape* (gap ratio,
/// coefficient of variation), so they are unit-invariant and respect the
/// No Double Lifecycle Rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextConfidence {
    /// Zero items.
    Empty,
    /// Top score is clearly separated from the rest. Safe to answer.
    Strong,
    /// Multiple hits with near-identical scores. Likely needs query refinement.
    Ambiguous,
    /// Items present but no clear shape — sparse or middling.
    Mixed,
}

impl Default for ContextConfidence {
    fn default() -> Self {
        Self::Empty
    }
}

/// Distribution statistics and confidence hint computed from envelope items.
///
/// This struct answers only: "what does this source's returned score shape look
/// like?" It does not answer: "is this source-specific evidence enough to make
/// a final claim?" Keep that separation clear so the context layer stays a
/// router/diagnostic layer instead of silently becoming another ranking system.
///
/// All fields except `item_count` and `confidence` are `Option<f64>` because
/// they are undefined for empty or single-item envelopes. Frontend / model
/// reads should always check `item_count` and `confidence` first.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ContextCoverageSignals {
    pub item_count: usize,
    #[serde(default)]
    pub top_score: Option<f64>,
    #[serde(default)]
    pub second_score: Option<f64>,
    /// `top_score - second_score`, defined only when at least two items exist.
    #[serde(default)]
    pub score_gap: Option<f64>,
    /// `(top - second) / top`. Large values (>= 0.3) signal a clear winner.
    #[serde(default)]
    pub score_gap_ratio: Option<f64>,
    #[serde(default)]
    pub score_mean: Option<f64>,
    #[serde(default)]
    pub score_stddev: Option<f64>,
    /// Coefficient of variation `stddev / mean`. Low values (< 0.1) signal a
    /// flat distribution — every hit is similarly relevant, model should
    /// refine the query.
    #[serde(default)]
    pub flatness: Option<f64>,
    pub confidence: ContextConfidence,
}

impl ContextCoverageSignals {
    /// Shape thresholds. Universal across sources because they operate on
    /// score *ratios* and *coefficients of variation*, not absolute values.
    const STRONG_GAP_RATIO: f64 = 0.30;
    const AMBIGUOUS_FLATNESS: f64 = 0.10;
    const AMBIGUOUS_MIN_ITEMS: usize = 3;

    pub fn from_items(items: &[ContextEvidenceItem]) -> Self {
        let item_count = items.len();
        if item_count == 0 {
            return Self {
                item_count: 0,
                confidence: ContextConfidence::Empty,
                ..Self::default()
            };
        }

        let mut sorted: Vec<f64> = items.iter().map(|item| item.score).collect();
        sorted.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
        let top_score = sorted.first().copied();
        let second_score = sorted.get(1).copied();

        let mean = sorted.iter().sum::<f64>() / sorted.len() as f64;
        let variance = if sorted.len() > 1 {
            sorted
                .iter()
                .map(|score| (score - mean).powi(2))
                .sum::<f64>()
                / sorted.len() as f64
        } else {
            0.0
        };
        let stddev = variance.sqrt();

        let score_gap = match (top_score, second_score) {
            (Some(top), Some(second)) => Some(top - second),
            _ => None,
        };
        let score_gap_ratio = match (top_score, score_gap) {
            (Some(top), Some(gap)) if top.abs() > f64::EPSILON => Some(gap / top),
            _ => None,
        };
        let flatness = if sorted.len() >= 2 && mean.abs() > f64::EPSILON {
            Some(stddev / mean)
        } else {
            None
        };

        let confidence = classify_confidence(item_count, score_gap_ratio, flatness);

        Self {
            item_count,
            top_score,
            second_score,
            score_gap,
            score_gap_ratio,
            score_mean: Some(mean),
            score_stddev: if sorted.len() >= 2 {
                Some(stddev)
            } else {
                None
            },
            flatness,
            confidence,
        }
    }
}

fn classify_confidence(
    item_count: usize,
    score_gap_ratio: Option<f64>,
    flatness: Option<f64>,
) -> ContextConfidence {
    if item_count == 0 {
        return ContextConfidence::Empty;
    }
    if item_count >= ContextCoverageSignals::AMBIGUOUS_MIN_ITEMS {
        if let Some(flat) = flatness {
            if flat < ContextCoverageSignals::AMBIGUOUS_FLATNESS {
                return ContextConfidence::Ambiguous;
            }
        }
    }
    if item_count >= 2 {
        if let Some(ratio) = score_gap_ratio {
            if ratio >= ContextCoverageSignals::STRONG_GAP_RATIO {
                return ContextConfidence::Strong;
            }
        }
    }
    ContextConfidence::Mixed
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextSourceRef {
    pub source_type: ContextSourceType,
    pub id: String,
    pub label: Option<String>,
    pub locator: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextEvidenceItem {
    pub id: String,
    pub source_id: Option<String>,
    pub title: Option<String>,
    pub content: String,
    pub score: f64,
    pub score_breakdown: Value,
    pub source_refs: Vec<ContextSourceRef>,
    pub quality_flags: Vec<String>,
    pub lifecycle: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextEvidenceEnvelope {
    pub source_type: ContextSourceType,
    pub query: String,
    pub items: Vec<ContextEvidenceItem>,
    pub coverage: ContextCoverage,
    #[serde(default)]
    pub coverage_signals: ContextCoverageSignals,
    pub score_semantics: String,
    pub recommended_next_action: ContextNextAction,
    pub trace: crate::modules::desktop_runtime::context_orchestrator::trace::ContextTrace,
}

impl ContextEvidenceEnvelope {
    pub fn new(
        source_type: ContextSourceType,
        query: impl Into<String>,
        items: Vec<ContextEvidenceItem>,
        score_semantics: impl Into<String>,
        recommended_next_action: ContextNextAction,
        trace: crate::modules::desktop_runtime::context_orchestrator::trace::ContextTrace,
    ) -> Self {
        let coverage = ContextCoverage::from_item_count(items.len());
        let coverage_signals = ContextCoverageSignals::from_items(&items);
        Self {
            source_type,
            query: query.into(),
            items,
            coverage,
            coverage_signals,
            score_semantics: score_semantics.into(),
            recommended_next_action,
            trace,
        }
    }

    pub fn source_scores(&self) -> Vec<f64> {
        self.items.iter().map(|item| item.score).collect()
    }

    pub fn confidence(&self) -> ContextConfidence {
        self.coverage_signals.confidence
    }
}
